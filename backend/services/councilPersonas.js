'use strict';

/**
 * backend/services/councilPersonas.js
 *
 * Phase 3.1 — Council Foundation
 *
 * Pure definitions and prompt-building functions for the four adversarial council
 * personas. This module has NO external dependencies, makes NO I/O calls, and
 * preserves the exact intent, responsibilities, and output keys of each persona
 * as they appear in the existing single-call blueprint generation flow.
 *
 * Design principles:
 *  - Each persona definition is a plain object: stable identifier, output key,
 *    human-readable display name, and a pure `buildPrompt(input)` function.
 *  - `buildPrompt` consumes a CouncilInput and returns a self-contained prompt
 *    string suitable for an independent LLM call in a future council orchestrator.
 *  - The public API (`COUNCIL_PERSONAS`, `buildCouncilInput`) is the sole stable
 *    boundary between production orchestration and individual persona logic.
 *  - The existing single-call production flow in `aiService.js` is untouched by
 *    this module — it can adopt these builders incrementally in Phase 3.2.
 *
 * ─── CouncilInput shape ────────────────────────────────────────────────────
 * {
 *   idea: {
 *     title: string,
 *     problem: string,
 *     solution?: string,
 *   },
 *   researchContext: string,   // Formatted RAG/Tavily evidence block (may be '')
 *   ragGrounded: boolean,      // true when researchContext comes from vector retrieval
 * }
 *
 * ─── PersonaResult shape (expected from LLM response) ──────────────────────
 * Each persona targets a single top-level key in the blueprint JSON:
 *  - theReaper:        Array<{ point: string }>
 *  - thePainMiner:     Array<{ frustration: string }>
 *  - pricingArchitect: { starter: {...}, pro: {...}, enterprise: {...} }
 *  - thePivotMaster:   { winningEdge: string }
 */

// ---------------------------------------------------------------------------
// Evidence preamble builder (shared across persona prompts)
// ---------------------------------------------------------------------------

/**
 * Build the evidence preamble section shared by all persona prompts.
 *
 * @param {string} researchContext - Formatted RAG or Tavily evidence block
 * @param {boolean} ragGrounded - Whether the context was vector-retrieved
 * @returns {string}
 */
function buildEvidencePreamble(researchContext, ragGrounded) {
  if (!researchContext) {
    return 'No external market research context is available. Rely on foundational first-principles reasoning.';
  }
  const qualifier = ragGrounded
    ? 'retrieved market research context (via semantic vector search)'
    : 'market research context (unfiltered research fallback)';
  return `You have access to ${qualifier}:${researchContext}
Distinguish sourced evidence from inference. Ground your findings in the provided evidence wherever relevant. Do not invent citations.`;
}

// ---------------------------------------------------------------------------
// Persona: The Reaper
// ---------------------------------------------------------------------------

/**
 * Build a self-contained prompt for The Reaper persona.
 *
 * Responsibility: Identify 3 brutal, evidence-grounded reasons why this startup
 * will fail. Focus on market, technical, and execution risk.
 *
 * @param {object} input - CouncilInput
 * @returns {string}
 */
function buildReaperPrompt(input) {
  const { idea, researchContext, ragGrounded } = input;
  const evidencePreamble = buildEvidencePreamble(researchContext, ragGrounded);
  return `You are THE REAPER — a brutally honest venture analyst whose job is to identify the most likely fatal flaws in startup ideas.
${evidencePreamble}
IDEA: "${idea.title} — ${idea.problem}${idea.solution ? ` — ${idea.solution}` : ''}"

Your task: Find exactly 3 brutal, specific reasons this startup will fail. Each reason must be concrete — not generic platitudes. Ground each reason in market evidence where available.

Return ONLY valid minified JSON:
{"theReaper":[{"point":"string"},{"point":"string"},{"point":"string"}]}`;
}

// ---------------------------------------------------------------------------
// Persona: The Pain Miner
// ---------------------------------------------------------------------------

/**
 * Build a self-contained prompt for The Pain Miner persona.
 *
 * Responsibility: Extract 3 specific, real customer frustrations from the
 * available research. Prioritize evidence-backed pain over hypothetical pain.
 *
 * @param {object} input - CouncilInput
 * @returns {string}
 */
function buildPainMinerPrompt(input) {
  const { idea, researchContext, ragGrounded } = input;
  const evidencePreamble = buildEvidencePreamble(researchContext, ragGrounded);
  return `You are THE PAIN MINER — a customer insight specialist who excavates real, documented frustrations from market research.
${evidencePreamble}
IDEA: "${idea.title} — ${idea.problem}${idea.solution ? ` — ${idea.solution}` : ''}"

Your task: Extract exactly 3 specific, real customer frustrations that this idea addresses or overlooks. Each frustration must be grounded in the provided research evidence where available — not invented.

Return ONLY valid minified JSON:
{"thePainMiner":[{"frustration":"string"},{"frustration":"string"},{"frustration":"string"}]}`;
}

// ---------------------------------------------------------------------------
// Persona: The Pricing Architect
// ---------------------------------------------------------------------------

/**
 * Build a self-contained prompt for The Pricing Architect persona.
 *
 * Responsibility: Design 3 pricing tiers (Starter, Pro, Enterprise) with
 * realistic prices and feature sets grounded in market benchmarks.
 *
 * @param {object} input - CouncilInput
 * @returns {string}
 */
function buildPricingArchitectPrompt(input) {
  const { idea, researchContext, ragGrounded } = input;
  const evidencePreamble = buildEvidencePreamble(researchContext, ragGrounded);
  return `You are THE PRICING ARCHITECT — a monetization strategist who designs optimal SaaS pricing structures grounded in competitive market data.
${evidencePreamble}
IDEA: "${idea.title} — ${idea.problem}${idea.solution ? ` — ${idea.solution}` : ''}"

Your task: Create 3 pricing tiers for this startup. Prices must be realistic, anchored to market benchmarks from the research evidence where available. Each tier must list specific features.

Return ONLY valid minified JSON:
{"pricingArchitect":{"starter":{"price":"string","features":["string"]},"pro":{"price":"string","features":["string"]},"enterprise":{"price":"string","features":["string"]}}}`;
}

// ---------------------------------------------------------------------------
// Persona: The Pivot Master
// ---------------------------------------------------------------------------

/**
 * Build a self-contained prompt for The Pivot Master persona.
 *
 * Responsibility: Identify exactly one high-leverage strategic twist — the
 * "Winning Edge" — that would dramatically improve this idea's market position.
 *
 * @param {object} input - CouncilInput
 * @returns {string}
 */
function buildPivotMasterPrompt(input) {
  const { idea, researchContext, ragGrounded } = input;
  const evidencePreamble = buildEvidencePreamble(researchContext, ragGrounded);
  return `You are THE PIVOT MASTER — a strategic advisor who identifies the single most powerful twist that would give this startup a decisive competitive advantage.
${evidencePreamble}
IDEA: "${idea.title} — ${idea.problem}${idea.solution ? ` — ${idea.solution}` : ''}"

Your task: Identify exactly one "Winning Edge" — a specific, actionable strategic twist grounded in the market research evidence where available. It must be a genuine differentiator, not a generic improvement.

Return ONLY valid minified JSON:
{"thePivotMaster":{"winningEdge":"string"}}`;
}

// ---------------------------------------------------------------------------
// Persona registry
// ---------------------------------------------------------------------------

/**
 * Ordered registry of all four council personas.
 *
 * Each entry provides:
 *  - `id`:          Stable camelCase identifier for use by orchestrators.
 *  - `displayName`: Human-readable name used in logs and future UI labels.
 *  - `outputKey`:   The exact top-level key this persona populates in the
 *                   blueprint JSON. Must match the existing API contract.
 *  - `buildPrompt`: Pure function `(CouncilInput) => string` — produces a
 *                   self-contained prompt for an independent LLM call.
 *
 * @type {ReadonlyArray<object>}
 */
const COUNCIL_PERSONAS = Object.freeze([
  {
    id: 'reaper',
    displayName: 'The Reaper',
    outputKey: 'theReaper',
    buildPrompt: buildReaperPrompt,
  },
  {
    id: 'painMiner',
    displayName: 'The Pain Miner',
    outputKey: 'thePainMiner',
    buildPrompt: buildPainMinerPrompt,
  },
  {
    id: 'pricingArchitect',
    displayName: 'The Pricing Architect',
    outputKey: 'pricingArchitect',
    buildPrompt: buildPricingArchitectPrompt,
  },
  {
    id: 'pivotMaster',
    displayName: 'The Pivot Master',
    outputKey: 'thePivotMaster',
    buildPrompt: buildPivotMasterPrompt,
  },
]);

// ---------------------------------------------------------------------------
// CouncilInput factory
// ---------------------------------------------------------------------------

/**
 * Build a validated CouncilInput from the resolved RAG/Tavily state.
 *
 * This is the canonical way to construct the input object passed to each
 * persona's `buildPrompt`. It does not call any external API.
 *
 * @param {object} idea                  - Idea definition (title, problem, solution?)
 * @param {string} [researchContext='']  - Formatted RAG/Tavily evidence block
 * @param {boolean} [ragGrounded=false]  - Whether context came from vector retrieval
 * @returns {{ idea: object, researchContext: string, ragGrounded: boolean }}
 */
function buildCouncilInput(idea, researchContext = '', ragGrounded = false) {
  if (!idea || typeof idea !== 'object') {
    throw new TypeError('buildCouncilInput: idea must be a non-null object');
  }
  if (typeof idea.title !== 'string' || !idea.title.trim()) {
    throw new TypeError('buildCouncilInput: idea.title must be a non-empty string');
  }
  if (typeof idea.problem !== 'string' || !idea.problem.trim()) {
    throw new TypeError('buildCouncilInput: idea.problem must be a non-empty string');
  }
  return {
    idea: {
      title: idea.title.trim(),
      problem: idea.problem.trim(),
      solution: typeof idea.solution === 'string' ? idea.solution.trim() : '',
    },
    researchContext: typeof researchContext === 'string' ? researchContext : '',
    ragGrounded: Boolean(ragGrounded),
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  COUNCIL_PERSONAS,
  buildCouncilInput,
  buildEvidencePreamble,
  // Individual builders are exported for direct testing without going through registry
  buildReaperPrompt,
  buildPainMinerPrompt,
  buildPricingArchitectPrompt,
  buildPivotMasterPrompt,
};
