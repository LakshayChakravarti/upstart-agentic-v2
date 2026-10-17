'use strict';

/**
 * backend/services/councilOrchestrator.js
 *
 * Phase 3.2 — Independent Council Orchestration
 *
 * Orchestrates an independent four-persona council with a synthesis step:
 *  1. Executes the 4 personas (The Reaper, Pain Miner, Pricing Architect, Pivot Master)
 *     in parallel via separate LLM calls using prompt builders from councilPersonas.js.
 *  2. Validates each persona response against its expected output key.
 *  3. Constructs a synthesis prompt containing the labeled persona findings and
 *     evidence preamble.
 *  4. Executes the chairman synthesis call to produce the complete blueprint schema.
 *  5. Validates the synthesized blueprint before returning it.
 *
 * Failures at any stage throw specific errors (CouncilPersonaError, CouncilSynthesisError)
 * allowing the calling service to apply a documented, safe fallback policy.
 */

const {
  COUNCIL_PERSONAS,
  buildCouncilInput,
  buildEvidencePreamble,
} = require('./councilPersonas');

// ---------------------------------------------------------------------------
// Custom Errors
// ---------------------------------------------------------------------------

class CouncilPersonaError extends Error {
  constructor(personaId, message, cause, code = 'PERSONA_FAILURE') {
    super(`Council persona [${personaId}] failed: ${message}`);
    this.name = 'CouncilPersonaError';
    this.personaId = personaId;
    this.code = code;
    if (cause) this.cause = cause;
  }
}

class CouncilSynthesisError extends Error {
  constructor(message, cause, code = 'SYNTHESIS_FAILURE') {
    super(`Council synthesis failed: ${message}`);
    this.name = 'CouncilSynthesisError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Sanitization Helper
// ---------------------------------------------------------------------------

/**
 * Sanitizes arbitrary error text to strip potential secrets (API keys, bearer tokens)
 * and prevent long prompt or stack leakage.
 *
 * @param {any} msg
 * @returns {string}
 */
function sanitizeErrorMessage(msg) {
  if (typeof msg !== 'string') return 'Unknown error';
  return msg
    .replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]')
    .replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]')
    .slice(0, 300);
}

// ---------------------------------------------------------------------------
// JSON Extraction Helper
// ---------------------------------------------------------------------------

/**
 * Extracts and parses JSON from raw LLM output, supporting markdown fences.
 *
 * @param {string} text - Raw model response
 * @returns {any} Parsed JSON
 */
function extractJSON(text) {
  if (typeof text !== 'string') {
    throw new TypeError('extractJSON: input must be a string');
  }
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const target = jsonMatch ? jsonMatch[1].trim() : text.trim();
  return JSON.parse(target.startsWith('{') || target.startsWith('[') ? target : text);
}

// ---------------------------------------------------------------------------
// Synthesis Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Builds the synthesis prompt for the Chairman of the Council.
 *
 * Consumes the validated CouncilInput and an object containing the labeled
 * outputs from each of the four council personas.
 *
 * @param {object} councilInput - Validated CouncilInput
 * @param {object} personaResults - Object with theReaper, thePainMiner, pricingArchitect, thePivotMaster
 * @returns {string}
 */
function buildSynthesisPrompt(councilInput, personaResults) {
  const { idea, researchContext, ragGrounded } = councilInput;
  const evidencePreamble = buildEvidencePreamble(researchContext, ragGrounded);

  return `You are the CHAIRMAN of the Council of Experts. Your role is to synthesize the adversarial findings of your four specialist personas into a unified, actionable startup business blueprint.

${evidencePreamble}

STARTUP IDEA: "${idea.title} — ${idea.problem}${idea.solution ? ` — ${idea.solution}` : ''}"

=== COUNCIL SPECIALIST FINDINGS ===

1. THE REAPER (Fatal Flaws & Failure Risks):
${JSON.stringify(personaResults.theReaper, null, 2)}

2. THE PAIN MINER (Real Customer Frustrations & Market Friction):
${JSON.stringify(personaResults.thePainMiner, null, 2)}

3. THE PRICING ARCHITECT (Tiers & Monetization Structure):
${JSON.stringify(personaResults.pricingArchitect, null, 2)}

4. THE PIVOT MASTER (Strategic Differentiation / Winning Edge):
${JSON.stringify(personaResults.thePivotMaster, null, 2)}

=== SYNTHESIS INSTRUCTIONS ===
- Synthesize a coherent business blueprint combining the specialist findings above with startup fundamentals.
- Preserve disagreements, risks, and pricing nuances identified by the specialists rather than smoothing them away.
- Ground scores and descriptions in the provided market research evidence where available. Do not invent citations.
- Include all base fields, scores, and persona findings in the final blueprint.

Return ONLY valid minified JSON with exactly these keys:
{
  "startupName": "string",
  "tagline": "string",
  "summary": "3-sentence description",
  "scores": {"technicalFeasibility": 50, "marketReadiness": 50, "regulatoryRisk": 50, "competitiveAdvantage": 50, "executionComplexity": 50, "scoreRationale": "string"},
  "theReaper": [ {"point": "string"} ],
  "thePainMiner": [ {"frustration": "string"} ],
  "pricingArchitect": {
    "starter": {"price": "string", "features": ["string"]},
    "pro": {"price": "string", "features": ["string"]},
    "enterprise": {"price": "string", "features": ["string"]}
  },
  "thePivotMaster": { "winningEdge": "string" }
}`;
}

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------

/**
 * Validates the output of a single persona against its expected outputKey and structure.
 *
 * @param {object} persona - Entry from COUNCIL_PERSONAS
 * @param {any} parsed - Parsed JSON object from the model
 * @returns {any} The extracted persona data
 */
function validatePersonaResult(persona, parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object from persona [${persona.id}], received ${Array.isArray(parsed) ? 'array' : typeof parsed}`);
  }
  if (!(persona.outputKey in parsed) || parsed[persona.outputKey] === undefined || parsed[persona.outputKey] === null) {
    throw new Error(`Missing expected output key "${persona.outputKey}" in response from persona [${persona.id}]`);
  }

  const val = parsed[persona.outputKey];

  switch (persona.outputKey) {
    case 'theReaper': {
      if (!Array.isArray(val) || val.length === 0) {
        throw new Error(`Invalid "theReaper" output from persona [${persona.id}]: expected non-empty array of objects`);
      }
      for (let i = 0; i < val.length; i++) {
        const item = val[i];
        if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.point !== 'string' || !item.point.trim()) {
          throw new Error(`Invalid "theReaper" entry at index ${i} from persona [${persona.id}]: expected object with non-empty "point" string`);
        }
      }
      break;
    }
    case 'thePainMiner': {
      if (!Array.isArray(val) || val.length === 0) {
        throw new Error(`Invalid "thePainMiner" output from persona [${persona.id}]: expected non-empty array of objects`);
      }
      for (let i = 0; i < val.length; i++) {
        const item = val[i];
        if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.frustration !== 'string' || !item.frustration.trim()) {
          throw new Error(`Invalid "thePainMiner" entry at index ${i} from persona [${persona.id}]: expected object with non-empty "frustration" string`);
        }
      }
      break;
    }
    case 'pricingArchitect': {
      if (!val || typeof val !== 'object' || Array.isArray(val)) {
        throw new Error(`Invalid "pricingArchitect" output from persona [${persona.id}]: expected non-null object`);
      }
      const requiredTiers = ['starter', 'pro', 'enterprise'];
      for (const tier of requiredTiers) {
        const tierData = val[tier];
        if (!tierData || typeof tierData !== 'object' || Array.isArray(tierData)) {
          throw new Error(`Invalid "pricingArchitect" tier "${tier}" from persona [${persona.id}]: expected object`);
        }
        if (typeof tierData.price !== 'string' || !tierData.price.trim()) {
          throw new Error(`Invalid "price" for tier "${tier}" from persona [${persona.id}]: expected non-empty string`);
        }
        if (!Array.isArray(tierData.features) || tierData.features.length === 0 || !tierData.features.every(f => typeof f === 'string' && f.trim())) {
          throw new Error(`Invalid "features" for tier "${tier}" from persona [${persona.id}]: expected non-empty array of strings`);
        }
      }
      break;
    }
    case 'thePivotMaster': {
      if (!val || typeof val !== 'object' || Array.isArray(val)) {
        throw new Error(`Invalid "thePivotMaster" output from persona [${persona.id}]: expected non-null object`);
      }
      if (typeof val.winningEdge !== 'string' || !val.winningEdge.trim()) {
        throw new Error(`Invalid "winningEdge" from persona [${persona.id}]: expected non-empty string`);
      }
      break;
    }
    default:
      break;
  }

  return val;
}

/**
 * Validates that the synthesized blueprint contains all required fields with correct types and ranges.
 *
 * @param {any} blueprint - Parsed blueprint JSON from chairman synthesis
 * @returns {object} Validated blueprint
 */
function validateSynthesizedBlueprint(blueprint) {
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint)) {
    throw new CouncilSynthesisError('Synthesized blueprint must be a non-null object', undefined, 'SYNTHESIS_VALIDATION_FAILED');
  }

  const requiredStringFields = ['startupName', 'tagline', 'summary'];
  for (const field of requiredStringFields) {
    if (typeof blueprint[field] !== 'string' || !blueprint[field].trim()) {
      throw new CouncilSynthesisError(`Missing or invalid required string field "${field}"`, undefined, 'SYNTHESIS_VALIDATION_FAILED');
    }
  }

  if (!blueprint.scores || typeof blueprint.scores !== 'object' || Array.isArray(blueprint.scores)) {
    throw new CouncilSynthesisError('Missing or invalid "scores" object in synthesized blueprint', undefined, 'SYNTHESIS_VALIDATION_FAILED');
  }

  const requiredScoreKeys = [
    'technicalFeasibility',
    'marketReadiness',
    'regulatoryRisk',
    'competitiveAdvantage',
    'executionComplexity',
  ];
  for (const scoreKey of requiredScoreKeys) {
    const val = blueprint.scores[scoreKey];
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 100) {
      throw new CouncilSynthesisError(`Invalid score "${scoreKey}": expected number between 0 and 100, got ${val}`, undefined, 'SYNTHESIS_VALIDATION_FAILED');
    }
  }

  if (typeof blueprint.scores.scoreRationale !== 'string' || !blueprint.scores.scoreRationale.trim()) {
    throw new CouncilSynthesisError('Missing or invalid "scoreRationale" string in scores', undefined, 'SYNTHESIS_VALIDATION_FAILED');
  }

  if (!Array.isArray(blueprint.theReaper) || blueprint.theReaper.length === 0) {
    throw new CouncilSynthesisError('Missing or empty "theReaper" array in synthesized blueprint', undefined, 'SYNTHESIS_VALIDATION_FAILED');
  }
  for (let i = 0; i < blueprint.theReaper.length; i++) {
    const item = blueprint.theReaper[i];
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.point !== 'string' || !item.point.trim()) {
      throw new CouncilSynthesisError(`Invalid entry in "theReaper" at index ${i}: expected object with non-empty "point" string`, undefined, 'SYNTHESIS_VALIDATION_FAILED');
    }
  }

  if (!Array.isArray(blueprint.thePainMiner) || blueprint.thePainMiner.length === 0) {
    throw new CouncilSynthesisError('Missing or empty "thePainMiner" array in synthesized blueprint', undefined, 'SYNTHESIS_VALIDATION_FAILED');
  }
  for (let i = 0; i < blueprint.thePainMiner.length; i++) {
    const item = blueprint.thePainMiner[i];
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.frustration !== 'string' || !item.frustration.trim()) {
      throw new CouncilSynthesisError(`Invalid entry in "thePainMiner" at index ${i}: expected object with non-empty "frustration" string`, undefined, 'SYNTHESIS_VALIDATION_FAILED');
    }
  }

  if (!blueprint.pricingArchitect || typeof blueprint.pricingArchitect !== 'object' || Array.isArray(blueprint.pricingArchitect)) {
    throw new CouncilSynthesisError('Missing or invalid "pricingArchitect" object in synthesized blueprint', undefined, 'SYNTHESIS_VALIDATION_FAILED');
  }
  const requiredTiers = ['starter', 'pro', 'enterprise'];
  for (const tier of requiredTiers) {
    const tierData = blueprint.pricingArchitect[tier];
    if (!tierData || typeof tierData !== 'object' || Array.isArray(tierData)) {
      throw new CouncilSynthesisError(`Missing or invalid pricing tier "${tier}" in pricingArchitect`, undefined, 'SYNTHESIS_VALIDATION_FAILED');
    }
    if (typeof tierData.price !== 'string' || !tierData.price.trim()) {
      throw new CouncilSynthesisError(`Missing or invalid "price" string for tier "${tier}" in pricingArchitect`, undefined, 'SYNTHESIS_VALIDATION_FAILED');
    }
    if (!Array.isArray(tierData.features) || tierData.features.length === 0 || !tierData.features.every(f => typeof f === 'string' && f.trim())) {
      throw new CouncilSynthesisError(`Missing or invalid "features" array for tier "${tier}" in pricingArchitect`, undefined, 'SYNTHESIS_VALIDATION_FAILED');
    }
  }

  if (!blueprint.thePivotMaster || typeof blueprint.thePivotMaster !== 'object' || Array.isArray(blueprint.thePivotMaster)) {
    throw new CouncilSynthesisError('Missing or invalid "thePivotMaster" object in synthesized blueprint', undefined, 'SYNTHESIS_VALIDATION_FAILED');
  }
  if (typeof blueprint.thePivotMaster.winningEdge !== 'string' || !blueprint.thePivotMaster.winningEdge.trim()) {
    throw new CouncilSynthesisError('Missing or invalid "thePivotMaster.winningEdge" string in synthesized blueprint', undefined, 'SYNTHESIS_VALIDATION_FAILED');
  }

  return blueprint;
}

// ---------------------------------------------------------------------------
// Council Execution Orchestrator
// ---------------------------------------------------------------------------

/**
 * Runs the complete four-persona council with chairman synthesis and safe diagnostics.
 *
 * @param {object} idea - Idea object { title, problem, solution? }
 * @param {string} [researchContext=''] - Formatted evidence block
 * @param {boolean} [ragGrounded=false] - Whether evidence is from vector retrieval
 * @param {Function} callGeminiFn - Model caller function (prompt) => Promise<string>
 * @param {object} [options={}] - Options object: { clock?: () => number }
 * @returns {Promise<object>} The synthesized blueprint object with councilDiagnostics
 */
async function runCouncil(idea, researchContext = '', ragGrounded = false, callGeminiFn, options = {}) {
  if (typeof callGeminiFn !== 'function') {
    throw new TypeError('runCouncil: callGeminiFn must be a function');
  }

  const clock = typeof options?.clock === 'function' ? options.clock : Date.now;
  const councilStartTime = clock();

  const diagnostics = {
    totalDurationMs: 0,
    personaDurationsMs: {},
    synthesisDurationMs: null,
    successfulPersonaCount: 0,
    failedPersonaCount: 0,
    synthesisSuccess: false,
    completed: false,
    fallbackUsed: false,
    fallbackReason: null,
  };

  const councilInput = buildCouncilInput(idea, researchContext, ragGrounded);

  // 1. Execute all 4 personas in parallel
  const personaPromises = COUNCIL_PERSONAS.map(async (persona) => {
    const prompt = persona.buildPrompt(councilInput);
    const personaStartTime = clock();
    let rawResponse;

    try {
      rawResponse = await callGeminiFn(prompt);
    } catch (callErr) {
      const safeErr = sanitizeErrorMessage(callErr?.message);
      throw new CouncilPersonaError(
        persona.id,
        `Model call rejected: ${safeErr}`,
        callErr,
        'PERSONA_CALL_REJECTED'
      );
    }

    let parsed;
    try {
      parsed = extractJSON(rawResponse);
    } catch (parseErr) {
      throw new CouncilPersonaError(
        persona.id,
        `Malformed JSON response: ${parseErr.message}`,
        parseErr,
        'PERSONA_MALFORMED_JSON'
      );
    }

    try {
      const data = validatePersonaResult(persona, parsed);
      const duration = Math.max(0, clock() - personaStartTime);
      return { id: persona.id, outputKey: persona.outputKey, data, duration };
    } catch (valErr) {
      throw new CouncilPersonaError(
        persona.id,
        valErr.message,
        valErr,
        'PERSONA_VALIDATION_FAILED'
      );
    }
  });

  const personaSettled = await Promise.allSettled(personaPromises);

  // Inspect results and record individual durations
  const personaResults = {};
  let firstPersonaError = null;

  for (let i = 0; i < COUNCIL_PERSONAS.length; i++) {
    const persona = COUNCIL_PERSONAS[i];
    const outcome = personaSettled[i];

    if (outcome.status === 'fulfilled') {
      diagnostics.successfulPersonaCount++;
      diagnostics.personaDurationsMs[persona.id] = outcome.value.duration;
      personaResults[outcome.value.outputKey] = outcome.value.data;
    } else {
      diagnostics.failedPersonaCount++;
      diagnostics.personaDurationsMs[persona.id] = Math.max(0, clock() - councilStartTime);
      if (!firstPersonaError) {
        firstPersonaError = outcome.reason;
      }
    }
  }

  if (firstPersonaError) {
    diagnostics.totalDurationMs = Math.max(0, clock() - councilStartTime);
    diagnostics.fallbackUsed = true;
    diagnostics.fallbackReason = firstPersonaError.code || 'PERSONA_FAILURE';
    firstPersonaError.diagnostics = diagnostics;
    throw firstPersonaError;
  }

  // 2. Chairman synthesis call
  const synthesisPrompt = buildSynthesisPrompt(councilInput, personaResults);
  const synthStartTime = clock();
  let rawSynthesis;

  try {
    rawSynthesis = await callGeminiFn(synthesisPrompt);
  } catch (synthErr) {
    diagnostics.synthesisDurationMs = Math.max(0, clock() - synthStartTime);
    diagnostics.totalDurationMs = Math.max(0, clock() - councilStartTime);
    diagnostics.fallbackUsed = true;
    diagnostics.fallbackReason = 'SYNTHESIS_CALL_REJECTED';
    const safeErr = sanitizeErrorMessage(synthErr?.message);
    const err = new CouncilSynthesisError(
      `Synthesis model call rejected: ${safeErr}`,
      synthErr,
      'SYNTHESIS_CALL_REJECTED'
    );
    err.diagnostics = diagnostics;
    throw err;
  }

  let parsedSynthesis;
  try {
    parsedSynthesis = extractJSON(rawSynthesis);
  } catch (parseErr) {
    diagnostics.synthesisDurationMs = Math.max(0, clock() - synthStartTime);
    diagnostics.totalDurationMs = Math.max(0, clock() - councilStartTime);
    diagnostics.fallbackUsed = true;
    diagnostics.fallbackReason = 'SYNTHESIS_MALFORMED_JSON';
    const err = new CouncilSynthesisError(
      `Malformed synthesis JSON: ${parseErr.message}`,
      parseErr,
      'SYNTHESIS_MALFORMED_JSON'
    );
    err.diagnostics = diagnostics;
    throw err;
  }

  diagnostics.synthesisDurationMs = Math.max(0, clock() - synthStartTime);

  // 3. Validate final blueprint
  let validatedBlueprint;
  try {
    validatedBlueprint = validateSynthesizedBlueprint(parsedSynthesis);
  } catch (valErr) {
    diagnostics.totalDurationMs = Math.max(0, clock() - councilStartTime);
    diagnostics.fallbackUsed = true;
    diagnostics.fallbackReason = valErr.code || 'SYNTHESIS_VALIDATION_FAILED';
    valErr.diagnostics = diagnostics;
    throw valErr;
  }

  diagnostics.synthesisSuccess = true;
  diagnostics.completed = true;
  diagnostics.fallbackUsed = false;
  diagnostics.fallbackReason = null;
  diagnostics.totalDurationMs = Math.max(0, clock() - councilStartTime);

  validatedBlueprint.councilDiagnostics = diagnostics;
  return validatedBlueprint;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  runCouncil,
  buildSynthesisPrompt,
  validatePersonaResult,
  validateSynthesizedBlueprint,
  extractJSON,
  sanitizeErrorMessage,
  CouncilPersonaError,
  CouncilSynthesisError,
};
