'use strict';

/**
 * backend/tests/councilOrchestrator.test.js
 *
 * Phase 3.2 — Independent Council Orchestration Test Suite
 *
 * Deterministic tests verifying:
 *  1. Four registered personas produce distinct prompts and retain output keys.
 *  2. Each persona receives the expected idea and research context.
 *  3. All four persona calls are executed independently (in parallel).
 *  4. Synthesis input contains all four correctly labeled outputs.
 *  5. Synthesis result contains the required existing blueprint fields.
 *  6. Malformed persona JSON throws CouncilPersonaError.
 *  7. Persona failure triggers safe fallback to single-call in analyzeIdeaBusinessBlueprint.
 *  8. Synthesis failure triggers safe fallback to single-call in analyzeIdeaBusinessBlueprint.
 *  9. Retrieved evidence marker reaches persona prompts and synthesis prompt.
 * 10. Provenance fields (researchSources, ragGrounded, ragDiagnostics) match contract.
 * 11. Single-call path remains default when options.useCouncil is absent/false.
 * 12. RAG fallback context is correctly propagated when retrieval yields 0 chunks.
 *
 * All tests use in-memory dependency injection with deterministic mock clients.
 * Zero live API calls (Gemini/Groq/Tavily) and zero SQLite database modifications.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  runCouncil,
  buildSynthesisPrompt,
  validatePersonaResult,
  validateSynthesizedBlueprint,
  extractJSON,
  sanitizeErrorMessage,
  CouncilPersonaError,
  CouncilSynthesisError,
} = require('../services/councilOrchestrator');

const {
  COUNCIL_PERSONAS,
  buildCouncilInput,
} = require('../services/councilPersonas');

const {
  analyzeIdeaBusinessBlueprint,
} = require('../services/aiService');

// ---------------------------------------------------------------------------
// Deterministic Fixtures
// ---------------------------------------------------------------------------

const MOCK_IDEA = {
  title: 'AuditFlow AI',
  problem: 'Automated compliance auditing is expensive and error-prone.',
  solution: 'AI agent that continuously ingests audit logs and verifies SOC2 controls.',
};

const MOCK_PERSONA_PAYLOADS = {
  theReaper: [
    { point: 'Auditors require human liability underwriting' },
    { point: 'Enterprise sales cycles exceed runway' },
    { point: 'Data ingress security fears prevent adoption' },
  ],
  thePainMiner: [
    { frustration: 'Manual evidence collection takes 200 hours per quarter' },
    { frustration: 'Screenshot tools break on dashboard updates' },
    { frustration: 'Auditors reject automated exports without provenance' },
  ],
  pricingArchitect: {
    starter: { price: '$499/mo', features: ['Single framework', '5 connectors'] },
    pro: { price: '$1,499/mo', features: ['Multi-framework', '25 connectors', 'Daily sync'] },
    enterprise: { price: 'Custom', features: ['Custom audit frameworks', 'Dedicated auditor portal'] },
  },
  thePivotMaster: {
    winningEdge: 'Partner directly with boutique CPA firms to act as their white-label automation backend.',
  },
};

const MOCK_SYNTHESIS_BLUEPRINT = {
  startupName: 'AuditFlow AI',
  tagline: 'Autonomous SOC2 compliance auditing for engineering teams',
  summary: 'AuditFlow continuously ingests system audit logs and maps them directly to SOC2 trust services criteria. It reduces audit prep time by 80% while preserving strict evidence provenance. Built for rapid adoption by enterprise cloud teams.',
  scores: {
    technicalFeasibility: 75,
    marketReadiness: 70,
    regulatoryRisk: 65,
    competitiveAdvantage: 80,
    executionComplexity: 60,
    scoreRationale: 'Strong technical automation opportunity with high market demand despite enterprise sales headwinds.',
  },
  theReaper: MOCK_PERSONA_PAYLOADS.theReaper,
  thePainMiner: MOCK_PERSONA_PAYLOADS.thePainMiner,
  pricingArchitect: MOCK_PERSONA_PAYLOADS.pricingArchitect,
  thePivotMaster: MOCK_PERSONA_PAYLOADS.thePivotMaster,
};

const MOCK_SINGLE_CALL_BLUEPRINT = {
  startupName: 'SingleCallFallbackCo',
  tagline: 'Single call fallback analysis',
  summary: 'Safe single-call fallback description. Operates as baseline.',
  scores: {
    technicalFeasibility: 50,
    marketReadiness: 50,
    regulatoryRisk: 50,
    competitiveAdvantage: 50,
    executionComplexity: 50,
    scoreRationale: 'Default single call rationale.',
  },
  theReaper: [{ point: 'Single call risk' }],
  thePainMiner: [{ frustration: 'Single call pain' }],
  pricingArchitect: {
    starter: { price: '$10', features: ['basic'] },
    pro: { price: '$20', features: ['pro'] },
    enterprise: { price: '$50', features: ['all'] },
  },
  thePivotMaster: { winningEdge: 'Single call pivot edge' },
};

/**
 * Creates a mock Gemini function that responds accurately based on prompt inspection.
 */
function createMockCouncilGeminiFn(overrides = {}) {
  const calls = [];

  const mockFn = async (prompt) => {
    calls.push(prompt);

    if (overrides.throwOnPromptMatch && overrides.throwOnPromptMatch.test(prompt)) {
      throw new Error(`Injected model rejection for pattern: ${overrides.throwOnPromptMatch}`);
    }

    if (overrides.malformedJsonOnMatch && overrides.malformedJsonOnMatch.test(prompt)) {
      return '```json\n{"invalid_json": incomplete...\n```';
    }

    // Chairman Synthesis
    if (prompt.includes('You are the CHAIRMAN of the Council of Experts')) {
      if (overrides.synthesisResponse !== undefined) return overrides.synthesisResponse;
      return JSON.stringify(MOCK_SYNTHESIS_BLUEPRINT);
    }

    // Persona: The Reaper
    if (prompt.includes('You are THE REAPER')) {
      if (overrides.reaperResponse !== undefined) return overrides.reaperResponse;
      return JSON.stringify({ theReaper: MOCK_PERSONA_PAYLOADS.theReaper });
    }

    // Persona: The Pain Miner
    if (prompt.includes('You are THE PAIN MINER')) {
      if (overrides.painMinerResponse !== undefined) return overrides.painMinerResponse;
      return JSON.stringify({ thePainMiner: MOCK_PERSONA_PAYLOADS.thePainMiner });
    }

    // Persona: The Pricing Architect
    if (prompt.includes('You are THE PRICING ARCHITECT')) {
      if (overrides.pricingArchitectResponse !== undefined) return overrides.pricingArchitectResponse;
      return JSON.stringify({ pricingArchitect: MOCK_PERSONA_PAYLOADS.pricingArchitect });
    }

    // Persona: The Pivot Master
    if (prompt.includes('You are THE PIVOT MASTER')) {
      if (overrides.pivotMasterResponse !== undefined) return overrides.pivotMasterResponse;
      return JSON.stringify({ thePivotMaster: MOCK_PERSONA_PAYLOADS.thePivotMaster });
    }

    // Fallback single-call prompt
    if (prompt.includes('You are a "Council of Experts"')) {
      if (overrides.singleCallResponse !== undefined) return overrides.singleCallResponse;
      return JSON.stringify(MOCK_SINGLE_CALL_BLUEPRINT);
    }

    throw new Error(`Unrecognized prompt in mockGeminiFn:\n${prompt.slice(0, 150)}...`);
  };

  mockFn.calls = calls;
  return mockFn;
}

// ---------------------------------------------------------------------------
// Unit & Integration Tests
// ---------------------------------------------------------------------------

describe('Phase 3.2 — Council Orchestrator Unit Tests', () => {

  // Test 1
  test('1. Four registered personas produce four distinct prompts and retain expected output keys', () => {
    const input = buildCouncilInput(MOCK_IDEA, 'Sample context', true);
    assert.equal(COUNCIL_PERSONAS.length, 4);

    const prompts = COUNCIL_PERSONAS.map((p) => p.buildPrompt(input));
    const uniquePrompts = new Set(prompts);
    assert.equal(uniquePrompts.size, 4, 'All four prompts must be distinct');

    const expectedKeys = ['theReaper', 'thePainMiner', 'pricingArchitect', 'thePivotMaster'];
    const actualKeys = COUNCIL_PERSONAS.map((p) => p.outputKey);
    assert.deepEqual(actualKeys, expectedKeys);
  });

  // Test 2
  test('2. Each persona prompt receives the expected idea and research context', () => {
    const uniqueContextMarker = 'MARKET_EVIDENCE_CONTEXT_XYZ_789';
    const input = buildCouncilInput(MOCK_IDEA, uniqueContextMarker, true);

    for (const persona of COUNCIL_PERSONAS) {
      const prompt = persona.buildPrompt(input);
      assert.ok(prompt.includes(MOCK_IDEA.title), `Prompt for ${persona.id} must include idea title`);
      assert.ok(prompt.includes(MOCK_IDEA.problem), `Prompt for ${persona.id} must include idea problem`);
      assert.ok(prompt.includes(uniqueContextMarker), `Prompt for ${persona.id} must include context marker`);
      assert.ok(prompt.includes('retrieved market research context (via semantic vector search)'));
    }
  });

  // Test 3
  test('3. All four persona calls and synthesis call are made when successful (5 total calls)', async () => {
    const mockGemini = createMockCouncilGeminiFn();
    const result = await runCouncil(MOCK_IDEA, 'Evidence block', true, mockGemini);

    assert.equal(mockGemini.calls.length, 5, 'Must make exactly 4 persona calls + 1 synthesis call');
    assert.equal(result.startupName, MOCK_SYNTHESIS_BLUEPRINT.startupName);
    assert.equal(result.scores.technicalFeasibility, 75);
  });

  // Test 4
  test('4. Synthesis prompt contains all four correctly labeled outputs', () => {
    const input = buildCouncilInput(MOCK_IDEA, 'Market context', true);
    const synthPrompt = buildSynthesisPrompt(input, MOCK_PERSONA_PAYLOADS);

    assert.ok(synthPrompt.includes('1. THE REAPER (Fatal Flaws & Failure Risks):'));
    assert.ok(synthPrompt.includes('Auditors require human liability underwriting'));

    assert.ok(synthPrompt.includes('2. THE PAIN MINER (Real Customer Frustrations & Market Friction):'));
    assert.ok(synthPrompt.includes('Manual evidence collection takes 200 hours per quarter'));

    assert.ok(synthPrompt.includes('3. THE PRICING ARCHITECT (Tiers & Monetization Structure):'));
    assert.ok(synthPrompt.includes('$499/mo'));

    assert.ok(synthPrompt.includes('4. THE PIVOT MASTER (Strategic Differentiation / Winning Edge):'));
    assert.ok(synthPrompt.includes('Partner directly with boutique CPA firms'));
  });

  // Test 5
  test('5. Synthesis result contains the required existing blueprint fields', async () => {
    const mockGemini = createMockCouncilGeminiFn();
    const result = await runCouncil(MOCK_IDEA, 'Evidence block', true, mockGemini);

    // Assert base blueprint contract
    assert.equal(typeof result.startupName, 'string');
    assert.equal(typeof result.tagline, 'string');
    assert.equal(typeof result.summary, 'string');
    assert.equal(typeof result.scores, 'object');
    assert.equal(typeof result.scores.technicalFeasibility, 'number');
    assert.equal(typeof result.scores.marketReadiness, 'number');
    assert.equal(typeof result.scores.regulatoryRisk, 'number');
    assert.equal(typeof result.scores.competitiveAdvantage, 'number');
    assert.equal(typeof result.scores.executionComplexity, 'number');
    assert.equal(typeof result.scores.scoreRationale, 'string');

    // Assert persona fields
    assert.ok(Array.isArray(result.theReaper));
    assert.ok(Array.isArray(result.thePainMiner));
    assert.ok(typeof result.pricingArchitect === 'object');
    assert.ok(typeof result.pricingArchitect.starter === 'object');
    assert.ok(typeof result.pricingArchitect.pro === 'object');
    assert.ok(typeof result.pricingArchitect.enterprise === 'object');
    assert.ok(typeof result.thePivotMaster === 'object');
    assert.equal(typeof result.thePivotMaster.winningEdge, 'string');
  });

  // Test 6
  test('6. Malformed persona JSON throws CouncilPersonaError identifying the persona', async () => {
    const mockGemini = createMockCouncilGeminiFn({
      reaperResponse: 'NOT_VALID_JSON{bad: syntax}',
    });

    await assert.rejects(
      async () => runCouncil(MOCK_IDEA, 'Evidence block', true, mockGemini),
      (err) => {
        assert.ok(err instanceof CouncilPersonaError);
        assert.equal(err.personaId, 'reaper');
        assert.ok(err.message.includes('reaper'));
        return true;
      }
    );
  });

  test('6b. Persona response missing expected output key throws CouncilPersonaError', async () => {
    const mockGemini = createMockCouncilGeminiFn({
      pivotMasterResponse: JSON.stringify({ wrongKey: 'something' }),
    });

    await assert.rejects(
      async () => runCouncil(MOCK_IDEA, 'Evidence block', true, mockGemini),
      (err) => {
        assert.ok(err instanceof CouncilPersonaError);
        assert.equal(err.personaId, 'pivotMaster');
        assert.ok(err.message.includes('Missing expected output key "thePivotMaster"'));
        return true;
      }
    );
  });

  test('6c. Synthesis validation catches missing required blueprint fields', () => {
    const incompleteBlueprint = {
      startupName: 'IncompleteCo',
      // Missing tagline, summary, scores, etc.
    };
    assert.throws(
      () => validateSynthesizedBlueprint(incompleteBlueprint),
      (err) => {
        assert.ok(err instanceof CouncilSynthesisError);
        assert.ok(err.message.includes('tagline'));
        return true;
      }
    );
  });

  test('6d. Synthesis malformed JSON throws CouncilSynthesisError', async () => {
    const mockGemini = createMockCouncilGeminiFn({
      synthesisResponse: '```json\n{"invalid": "unclosed\n```',
    });

    await assert.rejects(
      async () => runCouncil(MOCK_IDEA, 'Evidence block', true, mockGemini),
      (err) => {
        assert.ok(err instanceof CouncilSynthesisError);
        return true;
      }
    );
  });

});

// ---------------------------------------------------------------------------
// Integration with aiService & Fallback Behavior Tests
// ---------------------------------------------------------------------------

describe('Phase 3.2 — aiService Council Integration & Fallback', () => {

  // Test 7
  test('7. Persona-call rejection triggers safe fallback to single-call blueprint without loop', async () => {
    const mockGemini = createMockCouncilGeminiFn({
      throwOnPromptMatch: /You are THE REAPER/,
    });

    const mockTavily = async () => ({
      context: 'Tavily market context',
      urls: ['https://example.com/audit'],
      results: [],
    });

    const blueprint = await analyzeIdeaBusinessBlueprint(
      MOCK_IDEA,
      'javascript',
      'full_time',
      'medium',
      'advanced',
      null,
      null,
      null,
      {
        useCouncil: true,
        geminiFn: mockGemini,
        tavilySearchFn: mockTavily,
      }
    );

    // Fallback should yield single-call blueprint
    assert.equal(blueprint.startupName, 'SingleCallFallbackCo');
    assert.deepEqual(blueprint.researchSources, ['https://example.com/audit']);
    assert.equal(blueprint.ragDiagnostics.status, 'fallback');
  });

  // Test 8
  test('8. Synthesis failure triggers safe fallback to single-call blueprint', async () => {
    const mockGemini = createMockCouncilGeminiFn({
      synthesisResponse: 'MALFORMED_SYNTHESIS_NOT_JSON',
    });

    const mockTavily = async () => ({
      context: 'Tavily market context',
      urls: ['https://example.com/audit'],
      results: [],
    });

    const blueprint = await analyzeIdeaBusinessBlueprint(
      MOCK_IDEA,
      'javascript',
      'full_time',
      'medium',
      'advanced',
      null,
      null,
      null,
      {
        useCouncil: true,
        geminiFn: mockGemini,
        tavilySearchFn: mockTavily,
      }
    );

    assert.equal(blueprint.startupName, 'SingleCallFallbackCo');
    assert.deepEqual(blueprint.researchSources, ['https://example.com/audit']);
  });

  // Test 9: Deterministic evidence trace
  test('9. Retrieved evidence marker reaches persona and synthesis prompts, preserving source provenance', async () => {
    const evidenceMarker = 'EVIDENCE_TOKEN_DETERMINISTIC_99999';
    const mockGemini = createMockCouncilGeminiFn();

    const mockTavily = async () => ({
      context: '',
      urls: ['https://provenance-domain.com/evidence'],
      results: [{ url: 'https://provenance-domain.com/evidence', content: `Evidence with ${evidenceMarker}` }],
    });

    const mockRetrievalService = {
      run: async () => ({
        success: true,
        retrievedChunks: [{ content: `Chunk with ${evidenceMarker}`, score: 0.95, url: 'https://provenance-domain.com/evidence' }],
        sources: ['https://provenance-domain.com/evidence'],
        promptContext: `\n\n=== RETRIEVED MARKET RESEARCH CONTEXT (VIA VECTOR SEARCH) ===\n[Source 1] (https://provenance-domain.com/evidence)\nChunk with ${evidenceMarker}\n`,
        diagnostics: { status: 'grounded', reason: 'OK' },
      }),
    };

    const blueprint = await analyzeIdeaBusinessBlueprint(
      MOCK_IDEA,
      'javascript',
      'full_time',
      'medium',
      'advanced',
      null,
      null,
      'idea-session-uuid-1',
      {
        useCouncil: true,
        geminiFn: mockGemini,
        tavilySearchFn: mockTavily,
        retrievalService: mockRetrievalService,
      }
    );

    // Verify evidence marker reached all 4 persona prompts + 1 synthesis prompt
    assert.equal(mockGemini.calls.length, 5);
    for (let i = 0; i < 5; i++) {
      assert.ok(
        mockGemini.calls[i].includes(evidenceMarker),
        `Call ${i} must include evidence marker ${evidenceMarker}`
      );
    }

    // Verify provenance on returned blueprint
    assert.equal(blueprint.ragGrounded, true);
    assert.deepEqual(blueprint.researchSources, ['https://provenance-domain.com/evidence']);
    assert.equal(blueprint.ragDiagnostics.status, 'grounded');
    assert.equal(blueprint.startupName, MOCK_SYNTHESIS_BLUEPRINT.startupName);
  });

  // Test 10
  test('10. researchSources, ragGrounded, and ragDiagnostics remain compatible with existing contract in council path', async () => {
    const mockGemini = createMockCouncilGeminiFn();
    const mockTavily = async () => ({
      context: 'Context line',
      urls: ['https://source-a.com', 'https://source-b.com'],
      results: [],
    });

    const blueprint = await analyzeIdeaBusinessBlueprint(
      MOCK_IDEA,
      'skills',
      'time',
      'budget',
      'exp',
      null,
      null,
      'test-idea-id',
      {
        useCouncil: true,
        geminiFn: mockGemini,
        tavilySearchFn: mockTavily,
      }
    );

    assert.equal(blueprint.startupName, MOCK_SYNTHESIS_BLUEPRINT.startupName);
    assert.equal(blueprint.ragGrounded, undefined, 'ragGrounded should be undefined when not vector grounded');
    assert.deepEqual(blueprint.researchSources, ['https://source-a.com', 'https://source-b.com']);
    assert.equal(blueprint.ragDiagnostics.status, 'fallback');
    assert.equal(blueprint.ragDiagnostics.reason, 'NO_STRUCTURED_RESULTS');
  });

  // Test 11
  test('11. Existing single-call path remains default when options.useCouncil is absent or false', async () => {
    const mockGemini = createMockCouncilGeminiFn();
    const mockTavily = async () => ({
      context: 'Tavily fallback text',
      urls: ['https://default-path.com'],
      results: [],
    });

    // Default call without useCouncil
    const blueprintDefault = await analyzeIdeaBusinessBlueprint(
      MOCK_IDEA,
      'skills',
      'time',
      'budget',
      'exp',
      null,
      null,
      null,
      {
        geminiFn: mockGemini,
        tavilySearchFn: mockTavily,
      }
    );

    assert.equal(mockGemini.calls.length, 1, 'Default path must make exactly 1 model call');
    assert.equal(blueprintDefault.startupName, 'SingleCallFallbackCo');
    assert.deepEqual(blueprintDefault.researchSources, ['https://default-path.com']);

    // Explicit useCouncil: false
    mockGemini.calls.length = 0;
    const blueprintExplicitFalse = await analyzeIdeaBusinessBlueprint(
      MOCK_IDEA,
      'skills',
      'time',
      'budget',
      'exp',
      null,
      null,
      null,
      {
        useCouncil: false,
        geminiFn: mockGemini,
        tavilySearchFn: mockTavily,
      }
    );

    assert.equal(mockGemini.calls.length, 1, 'useCouncil: false must make exactly 1 model call');
    assert.equal(blueprintExplicitFalse.startupName, 'SingleCallFallbackCo');
  });

  // Test 12
  test('12. Existing RAG fallback behavior is not regressed when retrieval yields 0 chunks', async () => {
    const mockGemini = createMockCouncilGeminiFn();
    const mockTavily = async () => ({
      context: 'Raw fallback context content',
      urls: ['https://raw-fallback.com'],
      results: [{ url: 'https://raw-fallback.com', content: 'fallback raw text' }],
    });

    const mockRetrievalServiceNoChunks = {
      run: async () => ({
        success: false,
        reason: 'NO_CHUNKS_ABOVE_THRESHOLD',
        retrievedChunks: [],
        sources: [],
        promptContext: '',
        diagnostics: { status: 'fallback', reason: 'NO_CHUNKS_ABOVE_THRESHOLD' },
      }),
    };

    const blueprint = await analyzeIdeaBusinessBlueprint(
      MOCK_IDEA,
      'skills',
      'time',
      'budget',
      'exp',
      null,
      null,
      'idea-session-zero-chunks',
      {
        useCouncil: true,
        geminiFn: mockGemini,
        tavilySearchFn: mockTavily,
        retrievalService: mockRetrievalServiceNoChunks,
      }
    );

    assert.equal(blueprint.startupName, MOCK_SYNTHESIS_BLUEPRINT.startupName);
    assert.equal(blueprint.ragGrounded, undefined);
    assert.deepEqual(blueprint.researchSources, ['https://raw-fallback.com']);
    assert.equal(blueprint.ragDiagnostics.status, 'fallback');
    assert.equal(blueprint.ragDiagnostics.reason, 'NO_CHUNKS_ABOVE_THRESHOLD');

    // Confirm that the fallback text reached the council persona prompts
    const reaperPrompt = mockGemini.calls.find((c) => c.includes('THE REAPER'));
    assert.ok(reaperPrompt.includes('TAVILY RESEARCH CONTEXT (FALLBACK: UNFILTERED)'));
    assert.ok(reaperPrompt.includes('market research context (unfiltered research fallback)'));
  });

});

// ---------------------------------------------------------------------------
// Phase 3.3 — Reliability, Validation, and Diagnostics Hardening Tests
// ---------------------------------------------------------------------------

describe('Phase 3.3 — Reliability, Validation, and Diagnostics Hardening', () => {

  const reaperPersona = COUNCIL_PERSONAS.find(p => p.id === 'reaper');
  const painMinerPersona = COUNCIL_PERSONAS.find(p => p.id === 'painMiner');
  const pricingArchitectPersona = COUNCIL_PERSONAS.find(p => p.id === 'pricingArchitect');
  const pivotMasterPersona = COUNCIL_PERSONAS.find(p => p.id === 'pivotMaster');

  // Test 13: validatePersonaResult structural validation
  test('13. validatePersonaResult rejects primitive, null, array, and structurally invalid persona responses', () => {
    // Non-object or null responses
    assert.throws(() => validatePersonaResult(reaperPersona, null), /Expected JSON object/);
    assert.throws(() => validatePersonaResult(reaperPersona, 'a string'), /Expected JSON object/);
    assert.throws(() => validatePersonaResult(reaperPersona, 42), /Expected JSON object/);
    assert.throws(() => validatePersonaResult(reaperPersona, [{ point: 'in an array' }]), /Expected JSON object/);

    // Missing outputKey
    assert.throws(() => validatePersonaResult(reaperPersona, { wrongKey: [] }), /Missing expected output key "theReaper"/);

    // theReaper structural checks
    assert.throws(() => validatePersonaResult(reaperPersona, { theReaper: 'not an array' }), /Invalid "theReaper" output/);
    assert.throws(() => validatePersonaResult(reaperPersona, { theReaper: [] }), /Invalid "theReaper" output/);
    assert.throws(() => validatePersonaResult(reaperPersona, { theReaper: ['string instead of obj'] }), /Invalid "theReaper" entry at index 0/);
    assert.throws(() => validatePersonaResult(reaperPersona, { theReaper: [{ point: '   ' }] }), /Invalid "theReaper" entry at index 0/);

    // thePainMiner structural checks
    assert.throws(() => validatePersonaResult(painMinerPersona, { thePainMiner: 'not array' }), /Invalid "thePainMiner" output/);
    assert.throws(() => validatePersonaResult(painMinerPersona, { thePainMiner: [] }), /Invalid "thePainMiner" output/);
    assert.throws(() => validatePersonaResult(painMinerPersona, { thePainMiner: [{ notFrustration: 'val' }] }), /Invalid "thePainMiner" entry at index 0/);
    assert.throws(() => validatePersonaResult(painMinerPersona, { thePainMiner: [{ frustration: '' }] }), /Invalid "thePainMiner" entry at index 0/);

    // pricingArchitect structural checks
    assert.throws(() => validatePersonaResult(pricingArchitectPersona, { pricingArchitect: 'not obj' }), /Invalid "pricingArchitect" output/);
    assert.throws(() => validatePersonaResult(pricingArchitectPersona, { pricingArchitect: [] }), /Invalid "pricingArchitect" output/);
    assert.throws(() => validatePersonaResult(pricingArchitectPersona, {
      pricingArchitect: {
        starter: { price: '$10', features: ['a'] },
        pro: { price: '$20', features: ['b'] },
        // missing enterprise
      }
    }), /Invalid "pricingArchitect" tier "enterprise"/);
    assert.throws(() => validatePersonaResult(pricingArchitectPersona, {
      pricingArchitect: {
        starter: { price: '', features: ['a'] },
        pro: { price: '$20', features: ['b'] },
        enterprise: { price: '$50', features: ['c'] },
      }
    }), /Invalid "price" for tier "starter"/);
    assert.throws(() => validatePersonaResult(pricingArchitectPersona, {
      pricingArchitect: {
        starter: { price: '$10', features: [] },
        pro: { price: '$20', features: ['b'] },
        enterprise: { price: '$50', features: ['c'] },
      }
    }), /Invalid "features" for tier "starter"/);

    // thePivotMaster structural checks
    assert.throws(() => validatePersonaResult(pivotMasterPersona, { thePivotMaster: 'not obj' }), /Invalid "thePivotMaster" output/);
    assert.throws(() => validatePersonaResult(pivotMasterPersona, { thePivotMaster: {} }), /Invalid "winningEdge"/);
    assert.throws(() => validatePersonaResult(pivotMasterPersona, { thePivotMaster: { winningEdge: '   ' } }), /Invalid "winningEdge"/);

    // Valid payloads pass
    assert.deepEqual(validatePersonaResult(reaperPersona, { theReaper: [{ point: 'Valid risk' }] }), [{ point: 'Valid risk' }]);
    assert.deepEqual(validatePersonaResult(painMinerPersona, { thePainMiner: [{ frustration: 'Valid pain' }] }), [{ frustration: 'Valid pain' }]);
    assert.ok(validatePersonaResult(pricingArchitectPersona, { pricingArchitect: MOCK_PERSONA_PAYLOADS.pricingArchitect }));
    assert.deepEqual(validatePersonaResult(pivotMasterPersona, { thePivotMaster: { winningEdge: 'Valid edge' } }), { winningEdge: 'Valid edge' });
  });

  // Test 14: validateSynthesizedBlueprint deep validation
  test('14. validateSynthesizedBlueprint validates required base fields, score ranges, and nested persona structures', () => {
    // Non-object / array / null
    assert.throws(() => validateSynthesizedBlueprint(null), (err) => err instanceof CouncilSynthesisError && err.code === 'SYNTHESIS_VALIDATION_FAILED');
    assert.throws(() => validateSynthesizedBlueprint('string'), (err) => err instanceof CouncilSynthesisError);
    assert.throws(() => validateSynthesizedBlueprint([]), (err) => err instanceof CouncilSynthesisError);

    // Missing base string fields
    assert.throws(() => validateSynthesizedBlueprint({ ...MOCK_SYNTHESIS_BLUEPRINT, startupName: '' }), /required string field "startupName"/);
    assert.throws(() => validateSynthesizedBlueprint({ ...MOCK_SYNTHESIS_BLUEPRINT, tagline: '   ' }), /required string field "tagline"/);
    assert.throws(() => validateSynthesizedBlueprint({ ...MOCK_SYNTHESIS_BLUEPRINT, summary: null }), /required string field "summary"/);

    // Missing or invalid scores object
    assert.throws(() => validateSynthesizedBlueprint({ ...MOCK_SYNTHESIS_BLUEPRINT, scores: null }), /Missing or invalid "scores" object/);
    assert.throws(() => validateSynthesizedBlueprint({ ...MOCK_SYNTHESIS_BLUEPRINT, scores: [] }), /Missing or invalid "scores" object/);

    // Out-of-range or missing scores
    assert.throws(() => validateSynthesizedBlueprint({
      ...MOCK_SYNTHESIS_BLUEPRINT,
      scores: { ...MOCK_SYNTHESIS_BLUEPRINT.scores, technicalFeasibility: -1 },
    }), /Invalid score "technicalFeasibility"/);

    assert.throws(() => validateSynthesizedBlueprint({
      ...MOCK_SYNTHESIS_BLUEPRINT,
      scores: { ...MOCK_SYNTHESIS_BLUEPRINT.scores, marketReadiness: 105 },
    }), /Invalid score "marketReadiness"/);

    assert.throws(() => validateSynthesizedBlueprint({
      ...MOCK_SYNTHESIS_BLUEPRINT,
      scores: { ...MOCK_SYNTHESIS_BLUEPRINT.scores, regulatoryRisk: 'high' },
    }), /Invalid score "regulatoryRisk"/);

    assert.throws(() => validateSynthesizedBlueprint({
      ...MOCK_SYNTHESIS_BLUEPRINT,
      scores: { ...MOCK_SYNTHESIS_BLUEPRINT.scores, scoreRationale: '   ' },
    }), /Missing or invalid "scoreRationale" string/);

    // Malformed persona blocks in blueprint
    assert.throws(() => validateSynthesizedBlueprint({ ...MOCK_SYNTHESIS_BLUEPRINT, theReaper: [] }), /Missing or empty "theReaper" array/);
    assert.throws(() => validateSynthesizedBlueprint({ ...MOCK_SYNTHESIS_BLUEPRINT, theReaper: [{ wrong: 'format' }] }), /Invalid entry in "theReaper" at index 0/);
    assert.throws(() => validateSynthesizedBlueprint({ ...MOCK_SYNTHESIS_BLUEPRINT, thePainMiner: [] }), /Missing or empty "thePainMiner" array/);
    assert.throws(() => validateSynthesizedBlueprint({
      ...MOCK_SYNTHESIS_BLUEPRINT,
      pricingArchitect: { starter: { price: '$10', features: ['feature1'] } }
    }), /Missing or invalid pricing tier "pro"/);
    assert.throws(() => validateSynthesizedBlueprint({
      ...MOCK_SYNTHESIS_BLUEPRINT,
      pricingArchitect: {
        starter: { price: '$10', features: [] },
        pro: { price: '$20', features: ['b'] },
        enterprise: { price: '$50', features: ['c'] },
      }
    }), /Missing or invalid "features" array for tier "starter"/);
    assert.throws(() => validateSynthesizedBlueprint({ ...MOCK_SYNTHESIS_BLUEPRINT, thePivotMaster: { winningEdge: '' } }), /Missing or invalid "thePivotMaster.winningEdge"/);

    // Valid blueprint passes
    const validated = validateSynthesizedBlueprint(MOCK_SYNTHESIS_BLUEPRINT);
    assert.equal(validated.startupName, 'AuditFlow AI');
  });

  // Test 15: Concurrency and execution order
  test('15. All four persona calls execute concurrently and synthesis begins only after all four resolve', async () => {
    let activePersonaCalls = 0;
    let maxActivePersonaCalls = 0;
    let completedPersonaCalls = 0;
    let synthesisStartedBeforePersonasDone = false;

    const concurrentMockGemini = async (prompt) => {
      if (prompt.includes('You are the CHAIRMAN')) {
        if (completedPersonaCalls < 4) {
          synthesisStartedBeforePersonasDone = true;
        }
        return JSON.stringify(MOCK_SYNTHESIS_BLUEPRINT);
      }

      // Persona call
      activePersonaCalls++;
      maxActivePersonaCalls = Math.max(maxActivePersonaCalls, activePersonaCalls);

      // Yield execution to event loop so all 4 concurrently queued calls start
      await new Promise((resolve) => setImmediate(resolve));

      activePersonaCalls--;
      completedPersonaCalls++;

      if (prompt.includes('You are THE REAPER')) return JSON.stringify({ theReaper: MOCK_PERSONA_PAYLOADS.theReaper });
      if (prompt.includes('You are THE PAIN MINER')) return JSON.stringify({ thePainMiner: MOCK_PERSONA_PAYLOADS.thePainMiner });
      if (prompt.includes('You are THE PRICING ARCHITECT')) return JSON.stringify({ pricingArchitect: MOCK_PERSONA_PAYLOADS.pricingArchitect });
      if (prompt.includes('You are THE PIVOT MASTER')) return JSON.stringify({ thePivotMaster: MOCK_PERSONA_PAYLOADS.thePivotMaster });

      throw new Error('Unknown prompt');
    };

    const result = await runCouncil(MOCK_IDEA, 'Context', false, concurrentMockGemini);

    assert.equal(maxActivePersonaCalls, 4, 'All four persona calls must run concurrently');
    assert.equal(synthesisStartedBeforePersonasDone, false, 'Synthesis must not start until all 4 personas are complete');
    assert.equal(completedPersonaCalls, 4);
    assert.ok(result.startupName);
  });

  // Test 16: Safe council diagnostics on success with injectable clock
  test('16. Council success produces comprehensive, non-negative diagnostics with injectable clock', async () => {
    let fakeTime = 1000;
    const deterministicClock = () => {
      fakeTime += 50;
      return fakeTime;
    };

    const mockGemini = createMockCouncilGeminiFn();
    const result = await runCouncil(MOCK_IDEA, 'Evidence', true, mockGemini, { clock: deterministicClock });

    assert.ok(result.councilDiagnostics, 'Blueprint must have councilDiagnostics attached');
    const diag = result.councilDiagnostics;

    assert.equal(diag.completed, true);
    assert.equal(diag.fallbackUsed, false);
    assert.equal(diag.fallbackReason, null);
    assert.equal(diag.synthesisSuccess, true);
    assert.equal(diag.successfulPersonaCount, 4);
    assert.equal(diag.failedPersonaCount, 0);

    // Timing assertions are finite and non-negative
    assert.ok(Number.isFinite(diag.totalDurationMs) && diag.totalDurationMs >= 0);
    assert.ok(Number.isFinite(diag.synthesisDurationMs) && diag.synthesisDurationMs >= 0);
    for (const persona of COUNCIL_PERSONAS) {
      assert.ok(
        Number.isFinite(diag.personaDurationsMs[persona.id]) && diag.personaDurationsMs[persona.id] >= 0,
        `Duration for persona ${persona.id} must be finite non-negative`
      );
    }
  });

  // Test 17: Fallback diagnostics for persona call rejection
  test('17. Persona call rejection records stable PERSONA_CALL_REJECTED reason and diagnostics in fallback', async () => {
    const mockGemini = createMockCouncilGeminiFn({
      throwOnPromptMatch: /You are THE REAPER/,
    });

    const blueprint = await analyzeIdeaBusinessBlueprint(
      MOCK_IDEA, 'skills', 'time', 'budget', 'exp', null, null, null,
      {
        useCouncil: true,
        geminiFn: mockGemini,
        tavilySearchFn: async () => ({ context: 'ctx', urls: [], results: [] }),
      }
    );

    assert.equal(blueprint.startupName, 'SingleCallFallbackCo');
    assert.ok(blueprint.councilDiagnostics);
    const diag = blueprint.councilDiagnostics;
    assert.equal(diag.completed, false);
    assert.equal(diag.fallbackUsed, true);
    assert.equal(diag.fallbackReason, 'PERSONA_CALL_REJECTED');
    assert.equal(diag.synthesisSuccess, false);
    assert.ok(diag.failedPersonaCount >= 1);
  });

  // Test 18: Fallback diagnostics for persona malformed JSON
  test('18. Persona malformed JSON records stable PERSONA_MALFORMED_JSON reason and fallback diagnostics', async () => {
    const mockGemini = createMockCouncilGeminiFn({
      malformedJsonOnMatch: /You are THE PAIN MINER/,
    });

    const blueprint = await analyzeIdeaBusinessBlueprint(
      MOCK_IDEA, 'skills', 'time', 'budget', 'exp', null, null, null,
      {
        useCouncil: true,
        geminiFn: mockGemini,
        tavilySearchFn: async () => ({ context: 'ctx', urls: [], results: [] }),
      }
    );

    assert.equal(blueprint.startupName, 'SingleCallFallbackCo');
    assert.ok(blueprint.councilDiagnostics);
    assert.equal(blueprint.councilDiagnostics.fallbackReason, 'PERSONA_MALFORMED_JSON');
    assert.equal(blueprint.councilDiagnostics.fallbackUsed, true);
  });

  // Test 19: Fallback diagnostics for persona validation failure
  test('19. Persona invalid response structure records stable PERSONA_VALIDATION_FAILED reason', async () => {
    const mockGemini = createMockCouncilGeminiFn({
      pivotMasterResponse: JSON.stringify({ thePivotMaster: { winningEdge: '   ' } }),
    });

    const blueprint = await analyzeIdeaBusinessBlueprint(
      MOCK_IDEA, 'skills', 'time', 'budget', 'exp', null, null, null,
      {
        useCouncil: true,
        geminiFn: mockGemini,
        tavilySearchFn: async () => ({ context: 'ctx', urls: [], results: [] }),
      }
    );

    assert.equal(blueprint.startupName, 'SingleCallFallbackCo');
    assert.ok(blueprint.councilDiagnostics);
    assert.equal(blueprint.councilDiagnostics.fallbackReason, 'PERSONA_VALIDATION_FAILED');
  });

  // Test 20: Fallback diagnostics for synthesis model rejection
  test('20. Synthesis call rejection records stable SYNTHESIS_CALL_REJECTED reason', async () => {
    const mockGemini = createMockCouncilGeminiFn({
      throwOnPromptMatch: /You are the CHAIRMAN/,
    });

    const blueprint = await analyzeIdeaBusinessBlueprint(
      MOCK_IDEA, 'skills', 'time', 'budget', 'exp', null, null, null,
      {
        useCouncil: true,
        geminiFn: mockGemini,
        tavilySearchFn: async () => ({ context: 'ctx', urls: [], results: [] }),
      }
    );

    assert.equal(blueprint.startupName, 'SingleCallFallbackCo');
    assert.ok(blueprint.councilDiagnostics);
    assert.equal(blueprint.councilDiagnostics.fallbackReason, 'SYNTHESIS_CALL_REJECTED');
    assert.equal(blueprint.councilDiagnostics.synthesisSuccess, false);
    assert.equal(blueprint.councilDiagnostics.successfulPersonaCount, 4);
  });

  // Test 21: Fallback diagnostics for synthesis validation failure
  test('21. Synthesis schema validation failure records stable SYNTHESIS_VALIDATION_FAILED reason', async () => {
    const invalidSynthesisBlueprint = {
      ...MOCK_SYNTHESIS_BLUEPRINT,
      scores: { ...MOCK_SYNTHESIS_BLUEPRINT.scores, technicalFeasibility: 999 }, // out of range
    };

    const mockGemini = createMockCouncilGeminiFn({
      synthesisResponse: JSON.stringify(invalidSynthesisBlueprint),
    });

    const blueprint = await analyzeIdeaBusinessBlueprint(
      MOCK_IDEA, 'skills', 'time', 'budget', 'exp', null, null, null,
      {
        useCouncil: true,
        geminiFn: mockGemini,
        tavilySearchFn: async () => ({ context: 'ctx', urls: [], results: [] }),
      }
    );

    assert.equal(blueprint.startupName, 'SingleCallFallbackCo');
    assert.ok(blueprint.councilDiagnostics);
    assert.equal(blueprint.councilDiagnostics.fallbackReason, 'SYNTHESIS_VALIDATION_FAILED');
    assert.equal(blueprint.councilDiagnostics.fallbackUsed, true);
  });

  // Test 22: Non-recursive fallback failure handling
  test('22. Single-call fallback failure surfaces error cleanly and does not recurse', async () => {
    let callCount = 0;
    const failingMockGemini = async (prompt) => {
      callCount++;
      if (prompt.includes('You are THE REAPER')) {
        throw new Error('Reaper model exploded');
      }
      if (prompt.includes('You are a "Council of Experts"')) {
        throw new Error('Single-call fallback also exploded');
      }
      return '{}';
    };

    await assert.rejects(
      async () => analyzeIdeaBusinessBlueprint(
        MOCK_IDEA, 'skills', 'time', 'budget', 'exp', null, null, null,
        {
          useCouncil: true,
          geminiFn: failingMockGemini,
          tavilySearchFn: async () => ({ context: '', urls: [], results: [] }),
        }
      ),
      (err) => {
        assert.ok(err.message.includes('Failed to perform deep analysis: Single-call fallback also exploded'));
        return true;
      }
    );

    // Council calls (4 concurrent) + exactly 1 single-call attempt = 5 calls total (no loop/recursion)
    assert.equal(callCount, 5, 'Must not recurse into council after fallback failure');
  });

  // Test 23: Secret and credential sanitization in error logs and exceptions
  test('23. Provider error secrets and API keys are redacted from error messages and logs', async () => {
    const rawSecret = 'AIzaSyD-SuperSecretGeminiKey12345';
    const rawBearer = 'Bearer secret-bearer-token-98765';
    const capturedLogs = [];
    const originalWarn = console.warn;
    const originalError = console.error;

    console.warn = (...args) => capturedLogs.push(args.join(' '));
    console.error = (...args) => capturedLogs.push(args.join(' '));

    try {
      const mockGeminiWithSecret = async (prompt) => {
        if (prompt.includes('You are THE REAPER')) {
          throw new Error(`HTTP 403 Forbidden: key=${rawSecret} and header ${rawBearer}`);
        }
        if (prompt.includes('You are a "Council of Experts"')) {
          throw new Error(`Fallback HTTP 401: key=${rawSecret}`);
        }
        return '{}';
      };

      await assert.rejects(
        async () => analyzeIdeaBusinessBlueprint(
          MOCK_IDEA, 'skills', 'time', 'budget', 'exp', null, null, null,
          {
            useCouncil: true,
            geminiFn: mockGeminiWithSecret,
            tavilySearchFn: async () => ({ context: '', urls: [], results: [] }),
          }
        ),
        (err) => {
          assert.ok(!err.message.includes(rawSecret), 'Error message must not contain raw secret');
          assert.ok(err.message.includes('[REDACTED]'), 'Error message must have redacted key');
          return true;
        }
      );

      // Verify captured console logs do not contain raw secrets
      const logDump = capturedLogs.join('\n');
      assert.ok(!logDump.includes(rawSecret), 'Logs must not contain raw API key');
      assert.ok(!logDump.includes(rawBearer), 'Logs must not contain raw Bearer token');
      assert.ok(logDump.includes('[REDACTED]'), 'Logs must contain redacted markers');
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
  });

  // Test 24: Direct sanitizeErrorMessage helper unit test
  test('24. sanitizeErrorMessage helper redacts keys, bearer tokens, and caps message length', () => {
    const input = 'API error key=AIzaSyXYZ12345 and authorization bearer my-token-abc! ' + 'x'.repeat(400);
    const sanitized = sanitizeErrorMessage(input);

    assert.ok(!sanitized.includes('AIzaSyXYZ12345'));
    assert.ok(!sanitized.includes('my-token-abc'));
    assert.ok(sanitized.includes('key=[REDACTED]'));
    assert.ok(sanitized.includes('Bearer [REDACTED]'));
    assert.ok(sanitized.length <= 300);
    assert.equal(sanitizeErrorMessage(null), 'Unknown error');
  });

});
