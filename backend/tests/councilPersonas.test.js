'use strict';

/**
 * backend/tests/councilPersonas.test.js
 *
 * Phase 3.1: Council Foundation Tests
 *
 * Covers:
 *  - Persona registry completeness and identity constraints
 *  - CouncilInput factory validation
 *  - Evidence preamble construction (grounded vs. fallback vs. empty)
 *  - Per-persona prompt content: required sections, evidence inclusion, output key contract
 *  - Research context survives through to each persona prompt unchanged
 *  - No live AI, network, or database calls — purely deterministic
 *
 * Run with: node --test tests/councilPersonas.test.js
 */

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const {
  COUNCIL_PERSONAS,
  buildCouncilInput,
  buildEvidencePreamble,
  buildReaperPrompt,
  buildPainMinerPrompt,
  buildPricingArchitectPrompt,
  buildPivotMasterPrompt,
} = require('../services/councilPersonas');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const IDEA = {
  title: 'LegalDraft AI',
  problem: 'Solo lawyers spend 10+ hours per week drafting repetitive contract clauses',
  solution: 'AI-powered clause library with context-aware auto-fill',
};

const IDEA_NO_SOLUTION = {
  title: 'FoodWaste Tracker',
  problem: 'Restaurants cannot quantify daily food waste to reduce costs',
};

const RAG_CONTEXT = `\n\n=== RETRIEVED MARKET RESEARCH CONTEXT (VIA VECTOR SEARCH) ===\n[EVIDENCE_1] "Legal Tech Market 2024"\nSource URL: https://research.test/legal-tech\nExcerpt: Solo practitioners cite document automation as top pain point.\n\n[EVIDENCE_2] "Contract SaaS Pricing Benchmarks"\nSource URL: https://research.test/pricing\nExcerpt: Competing tools charge $79–$149/mo per user.\n`;

const TAVILY_CONTEXT = `\n\n=== TAVILY RESEARCH CONTEXT (FALLBACK: UNFILTERED) ===\nSource: https://tavily.test/article\nContent: Legal tech funding hit $1.2B in 2024.\n`;

// ---------------------------------------------------------------------------
// Section 1: Persona Registry Integrity
// ---------------------------------------------------------------------------

describe('COUNCIL_PERSONAS registry', () => {
  test('contains exactly four personas', () => {
    assert.equal(COUNCIL_PERSONAS.length, 4);
  });

  test('each persona has the required contract fields', () => {
    for (const persona of COUNCIL_PERSONAS) {
      assert.ok(typeof persona.id === 'string' && persona.id.length > 0, `${persona.id}: id must be a non-empty string`);
      assert.ok(typeof persona.displayName === 'string' && persona.displayName.length > 0, `${persona.id}: displayName required`);
      assert.ok(typeof persona.outputKey === 'string' && persona.outputKey.length > 0, `${persona.id}: outputKey required`);
      assert.ok(typeof persona.buildPrompt === 'function', `${persona.id}: buildPrompt must be a function`);
    }
  });

  test('persona ids are unique', () => {
    const ids = COUNCIL_PERSONAS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, 'Persona IDs must be unique');
  });

  test('persona outputKeys are unique', () => {
    const keys = COUNCIL_PERSONAS.map((p) => p.outputKey);
    assert.equal(new Set(keys).size, keys.length, 'Output keys must be unique');
  });

  test('all four expected persona ids are present', () => {
    const ids = COUNCIL_PERSONAS.map((p) => p.id);
    assert.ok(ids.includes('reaper'), 'reaper must be present');
    assert.ok(ids.includes('painMiner'), 'painMiner must be present');
    assert.ok(ids.includes('pricingArchitect'), 'pricingArchitect must be present');
    assert.ok(ids.includes('pivotMaster'), 'pivotMaster must be present');
  });

  test('persona outputKeys match existing blueprint API contract', () => {
    const expectedKeys = ['theReaper', 'thePainMiner', 'pricingArchitect', 'thePivotMaster'];
    const actualKeys = COUNCIL_PERSONAS.map((p) => p.outputKey);
    for (const expected of expectedKeys) {
      assert.ok(actualKeys.includes(expected), `Missing expected output key: ${expected}`);
    }
  });

  test('registry is frozen (immutable)', () => {
    assert.ok(Object.isFrozen(COUNCIL_PERSONAS), 'COUNCIL_PERSONAS must be frozen');
  });

  test('persona order is: reaper, painMiner, pricingArchitect, pivotMaster', () => {
    const ids = COUNCIL_PERSONAS.map((p) => p.id);
    assert.deepEqual(ids, ['reaper', 'painMiner', 'pricingArchitect', 'pivotMaster']);
  });
});

// ---------------------------------------------------------------------------
// Section 2: CouncilInput Factory
// ---------------------------------------------------------------------------

describe('buildCouncilInput', () => {
  test('builds a valid CouncilInput from a complete idea and RAG context', () => {
    const input = buildCouncilInput(IDEA, RAG_CONTEXT, true);
    assert.equal(input.idea.title, IDEA.title.trim());
    assert.equal(input.idea.problem, IDEA.problem.trim());
    assert.equal(input.idea.solution, IDEA.solution.trim());
    assert.equal(input.researchContext, RAG_CONTEXT);
    assert.equal(input.ragGrounded, true);
  });

  test('builds a valid CouncilInput with no solution (optional field)', () => {
    const input = buildCouncilInput(IDEA_NO_SOLUTION, '', false);
    assert.equal(input.idea.title, 'FoodWaste Tracker');
    assert.equal(input.idea.solution, '');
    assert.equal(input.researchContext, '');
    assert.equal(input.ragGrounded, false);
  });

  test('defaults researchContext to empty string when omitted', () => {
    const input = buildCouncilInput(IDEA);
    assert.equal(input.researchContext, '');
    assert.equal(input.ragGrounded, false);
  });

  test('coerces ragGrounded to boolean', () => {
    const input = buildCouncilInput(IDEA, RAG_CONTEXT, 1);
    assert.strictEqual(input.ragGrounded, true);
    const input2 = buildCouncilInput(IDEA, RAG_CONTEXT, 0);
    assert.strictEqual(input2.ragGrounded, false);
  });

  test('throws TypeError when idea is missing', () => {
    assert.throws(() => buildCouncilInput(null), TypeError);
    assert.throws(() => buildCouncilInput(undefined), TypeError);
  });

  test('throws TypeError when idea.title is missing or empty', () => {
    assert.throws(() => buildCouncilInput({ problem: 'P' }), TypeError);
    assert.throws(() => buildCouncilInput({ title: '', problem: 'P' }), TypeError);
  });

  test('throws TypeError when idea.problem is missing or empty', () => {
    assert.throws(() => buildCouncilInput({ title: 'T' }), TypeError);
    assert.throws(() => buildCouncilInput({ title: 'T', problem: '' }), TypeError);
  });

  test('returned input object has exactly the three required top-level fields', () => {
    const input = buildCouncilInput(IDEA, RAG_CONTEXT, true);
    const keys = Object.keys(input).sort();
    assert.deepEqual(keys, ['idea', 'ragGrounded', 'researchContext']);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Evidence Preamble Builder
// ---------------------------------------------------------------------------

describe('buildEvidencePreamble', () => {
  test('returns first-principles fallback when researchContext is empty', () => {
    const preamble = buildEvidencePreamble('', false);
    assert.ok(preamble.includes('first-principles'), 'Must mention first-principles reasoning');
    assert.ok(!preamble.includes('vector'), 'Must not mention vector search when no context');
  });

  test('marks context as retrieved via vector search when ragGrounded is true', () => {
    const preamble = buildEvidencePreamble(RAG_CONTEXT, true);
    assert.ok(preamble.includes('vector search'), 'Must identify vector search provenance');
    assert.ok(preamble.includes('Do not invent citations'), 'Must include anti-hallucination instruction');
  });

  test('marks context as unfiltered fallback when ragGrounded is false', () => {
    const preamble = buildEvidencePreamble(TAVILY_CONTEXT, false);
    assert.ok(preamble.includes('unfiltered research fallback'), 'Must identify unfiltered fallback provenance');
    assert.ok(preamble.includes('Do not invent citations'), 'Must include anti-hallucination instruction');
  });

  test('includes the full research context block verbatim in the preamble', () => {
    const preamble = buildEvidencePreamble(RAG_CONTEXT, true);
    assert.ok(preamble.includes(RAG_CONTEXT), 'Full research context must appear in preamble');
  });
});

// ---------------------------------------------------------------------------
// Section 4: Per-Persona Prompt Builders
// ---------------------------------------------------------------------------

describe('buildReaperPrompt', () => {
  test('contains the idea title and problem', () => {
    const input = buildCouncilInput(IDEA, RAG_CONTEXT, true);
    const prompt = buildReaperPrompt(input);
    assert.ok(prompt.includes(IDEA.title), 'Must include idea title');
    assert.ok(prompt.includes(IDEA.problem), 'Must include idea problem');
  });

  test('contains the idea solution when present', () => {
    const input = buildCouncilInput(IDEA, RAG_CONTEXT, true);
    const prompt = buildReaperPrompt(input);
    assert.ok(prompt.includes(IDEA.solution), 'Must include idea solution when provided');
  });

  test('omits solution separator gracefully when solution is absent', () => {
    const input = buildCouncilInput(IDEA_NO_SOLUTION, '', false);
    const prompt = buildReaperPrompt(input);
    assert.ok(prompt.includes(IDEA_NO_SOLUTION.title));
    assert.ok(!prompt.includes('undefined'), 'Must not emit "undefined" in prompt');
  });

  test('targets the theReaper output key in the JSON schema', () => {
    const input = buildCouncilInput(IDEA, '', false);
    const prompt = buildReaperPrompt(input);
    assert.ok(prompt.includes('"theReaper"'), 'Must specify the theReaper output key in response schema');
  });

  test('includes research evidence context when available', () => {
    const input = buildCouncilInput(IDEA, RAG_CONTEXT, true);
    const prompt = buildReaperPrompt(input);
    assert.ok(prompt.includes('RETRIEVED MARKET RESEARCH CONTEXT'), 'Must include evidence block header');
    assert.ok(prompt.includes('Solo practitioners cite document automation'), 'Must include evidence content');
  });

  test('uses first-principles instruction when no research context is available', () => {
    const input = buildCouncilInput(IDEA, '', false);
    const prompt = buildReaperPrompt(input);
    assert.ok(prompt.includes('first-principles'), 'Must fall back to first-principles instruction');
  });

  test('persona identity is present in the prompt', () => {
    const input = buildCouncilInput(IDEA, '', false);
    const prompt = buildReaperPrompt(input);
    assert.ok(prompt.includes('THE REAPER'), 'Persona name must appear in prompt');
  });

  test('specifies exactly 3 failure reasons', () => {
    const input = buildCouncilInput(IDEA, '', false);
    const prompt = buildReaperPrompt(input);
    assert.ok(prompt.includes('3 brutal'), 'Must request exactly 3 reasons');
  });
});

describe('buildPainMinerPrompt', () => {
  test('contains the idea title and problem', () => {
    const input = buildCouncilInput(IDEA, RAG_CONTEXT, true);
    const prompt = buildPainMinerPrompt(input);
    assert.ok(prompt.includes(IDEA.title));
    assert.ok(prompt.includes(IDEA.problem));
  });

  test('targets the thePainMiner output key in the JSON schema', () => {
    const input = buildCouncilInput(IDEA, '', false);
    const prompt = buildPainMinerPrompt(input);
    assert.ok(prompt.includes('"thePainMiner"'), 'Must specify the thePainMiner output key');
  });

  test('includes research evidence context when available', () => {
    const input = buildCouncilInput(IDEA, RAG_CONTEXT, true);
    const prompt = buildPainMinerPrompt(input);
    assert.ok(prompt.includes('RETRIEVED MARKET RESEARCH CONTEXT'));
    assert.ok(prompt.includes('Solo practitioners cite document automation'));
  });

  test('persona identity is present in the prompt', () => {
    const input = buildCouncilInput(IDEA, '', false);
    const prompt = buildPainMinerPrompt(input);
    assert.ok(prompt.includes('THE PAIN MINER'));
  });

  test('specifies exactly 3 customer frustrations', () => {
    const input = buildCouncilInput(IDEA, '', false);
    const prompt = buildPainMinerPrompt(input);
    assert.ok(prompt.includes('3 specific'), 'Must request exactly 3 frustrations');
  });
});

describe('buildPricingArchitectPrompt', () => {
  test('contains the idea title and problem', () => {
    const input = buildCouncilInput(IDEA, RAG_CONTEXT, true);
    const prompt = buildPricingArchitectPrompt(input);
    assert.ok(prompt.includes(IDEA.title));
    assert.ok(prompt.includes(IDEA.problem));
  });

  test('targets the pricingArchitect output key in the JSON schema', () => {
    const input = buildCouncilInput(IDEA, '', false);
    const prompt = buildPricingArchitectPrompt(input);
    assert.ok(prompt.includes('"pricingArchitect"'), 'Must specify the pricingArchitect output key');
  });

  test('references Starter, Pro, and Enterprise tiers in output schema', () => {
    const input = buildCouncilInput(IDEA, '', false);
    const prompt = buildPricingArchitectPrompt(input);
    assert.ok(prompt.includes('"starter"'), 'Must include starter tier in schema');
    assert.ok(prompt.includes('"pro"'), 'Must include pro tier in schema');
    assert.ok(prompt.includes('"enterprise"'), 'Must include enterprise tier in schema');
  });

  test('includes research evidence context when available', () => {
    const input = buildCouncilInput(IDEA, RAG_CONTEXT, true);
    const prompt = buildPricingArchitectPrompt(input);
    assert.ok(prompt.includes('RETRIEVED MARKET RESEARCH CONTEXT'));
    assert.ok(prompt.includes('$79–$149/mo'), 'Must include pricing benchmark evidence');
  });

  test('persona identity is present in the prompt', () => {
    const input = buildCouncilInput(IDEA, '', false);
    const prompt = buildPricingArchitectPrompt(input);
    assert.ok(prompt.includes('THE PRICING ARCHITECT'));
  });
});

describe('buildPivotMasterPrompt', () => {
  test('contains the idea title and problem', () => {
    const input = buildCouncilInput(IDEA, RAG_CONTEXT, true);
    const prompt = buildPivotMasterPrompt(input);
    assert.ok(prompt.includes(IDEA.title));
    assert.ok(prompt.includes(IDEA.problem));
  });

  test('targets the thePivotMaster output key in the JSON schema', () => {
    const input = buildCouncilInput(IDEA, '', false);
    const prompt = buildPivotMasterPrompt(input);
    assert.ok(prompt.includes('"thePivotMaster"'), 'Must specify the thePivotMaster output key');
  });

  test('targets the winningEdge field in the JSON schema', () => {
    const input = buildCouncilInput(IDEA, '', false);
    const prompt = buildPivotMasterPrompt(input);
    assert.ok(prompt.includes('"winningEdge"'), 'Must specify the winningEdge field in schema');
  });

  test('includes research evidence context when available', () => {
    const input = buildCouncilInput(IDEA, RAG_CONTEXT, true);
    const prompt = buildPivotMasterPrompt(input);
    assert.ok(prompt.includes('RETRIEVED MARKET RESEARCH CONTEXT'));
  });

  test('persona identity is present in the prompt', () => {
    const input = buildCouncilInput(IDEA, '', false);
    const prompt = buildPivotMasterPrompt(input);
    assert.ok(prompt.includes('THE PIVOT MASTER'));
  });

  test('requires exactly one Winning Edge', () => {
    const input = buildCouncilInput(IDEA, '', false);
    const prompt = buildPivotMasterPrompt(input);
    assert.ok(prompt.includes('exactly one'), 'Must specify exactly one strategic twist');
  });
});

// ---------------------------------------------------------------------------
// Section 5: Registry buildPrompt delegation
// ---------------------------------------------------------------------------

describe('COUNCIL_PERSONAS.buildPrompt via registry', () => {
  test('each persona buildPrompt in registry produces the correct output key in its schema', () => {
    const input = buildCouncilInput(IDEA, RAG_CONTEXT, true);
    for (const persona of COUNCIL_PERSONAS) {
      const prompt = persona.buildPrompt(input);
      assert.ok(
        typeof prompt === 'string' && prompt.length > 0,
        `${persona.id}: buildPrompt must return a non-empty string`
      );
      assert.ok(
        prompt.includes(`"${persona.outputKey}"`),
        `${persona.id}: prompt must include its own outputKey "${persona.outputKey}" in the JSON schema`
      );
    }
  });

  test('all four persona prompts include the idea title', () => {
    const input = buildCouncilInput(IDEA, '', false);
    for (const persona of COUNCIL_PERSONAS) {
      const prompt = persona.buildPrompt(input);
      assert.ok(
        prompt.includes(IDEA.title),
        `${persona.id}: prompt must include the idea title`
      );
    }
  });

  test('all four persona prompts include the research evidence when provided', () => {
    const input = buildCouncilInput(IDEA, RAG_CONTEXT, true);
    for (const persona of COUNCIL_PERSONAS) {
      const prompt = persona.buildPrompt(input);
      assert.ok(
        prompt.includes('RETRIEVED MARKET RESEARCH CONTEXT'),
        `${persona.id}: prompt must include research context block`
      );
    }
  });

  test('all four persona prompts use first-principles instruction when no context', () => {
    const input = buildCouncilInput(IDEA, '', false);
    for (const persona of COUNCIL_PERSONAS) {
      const prompt = persona.buildPrompt(input);
      assert.ok(
        prompt.includes('first-principles'),
        `${persona.id}: prompt must include first-principles instruction when no context`
      );
    }
  });

  test('all four persona prompts must not emit undefined', () => {
    const input = buildCouncilInput(IDEA_NO_SOLUTION, '', false);
    for (const persona of COUNCIL_PERSONAS) {
      const prompt = persona.buildPrompt(input);
      assert.ok(
        !prompt.includes('undefined'),
        `${persona.id}: prompt must not contain the string "undefined"`
      );
    }
  });
});
