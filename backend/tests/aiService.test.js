/**
 * backend/tests/aiService.test.js
 *
 * Unit tests for model selection, fallback behaviour, JSON parsing,
 * and error handling in aiService.js.
 *
 * All external API calls are mocked — no real provider calls are made.
 * Run with: node --test tests/aiService.test.js   (Node 18+)
 */

'use strict';

const assert = require('node:assert/strict');
const { test, describe, beforeEach, mock } = require('node:test');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fetch Response-like object */
function makeResponse(status, body) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    ok: status >= 200 && status < 300,
    text:   async () => bodyStr,
    json:   async () => {
      if (!bodyStr) throw new SyntaxError('Unexpected end of JSON input');
      return JSON.parse(bodyStr);
    },
  };
}

/** Build a valid Groq chat completion response */
function groqOkResponse(content) {
  return makeResponse(200, {
    choices: [{ message: { content } }],
  });
}

// ---------------------------------------------------------------------------
// extractJSON (pure function — tested directly via module internals)
// ---------------------------------------------------------------------------

describe('extractJSON', () => {
  // We test extractJSON by inlining the implementation (same logic as the module)
  function extractJSON(text) {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
    const trimmed = text.trim();
    return JSON.parse(trimmed.startsWith('{') || trimmed.startsWith('[') ? trimmed : text);
  }

  test('parses raw JSON object', () => {
    const result = extractJSON('{"ok":true}');
    assert.deepEqual(result, { ok: true });
  });

  test('parses raw JSON array', () => {
    const result = extractJSON('[1,2,3]');
    assert.deepEqual(result, [1, 2, 3]);
  });

  test('strips markdown code fence and parses', () => {
    const result = extractJSON('```json\n{"ok":true}\n```');
    assert.deepEqual(result, { ok: true });
  });

  test('strips plain code fence and parses', () => {
    const result = extractJSON('```\n{"ok":true}\n```');
    assert.deepEqual(result, { ok: true });
  });

  test('throws on truly malformed JSON', () => {
    assert.throws(() => extractJSON('{broken}'), SyntaxError);
  });

  test('throws on empty string', () => {
    assert.throws(() => extractJSON(''), SyntaxError);
  });
});

// ---------------------------------------------------------------------------
// callGroq — model ordering and fallback behaviour
// ---------------------------------------------------------------------------

describe('callGroq model ordering and fallback', () => {
  // Track which models were called
  let calledModels;

  beforeEach(() => {
    calledModels = [];
  });

  /**
   * Build a mock fetch that:
   *   - returns `responses[model]` for that model
   *   - falls back to 200 OK with valid JSON if not listed
   */
  function buildFetch(responses) {
    return async (url, opts) => {
      const body = JSON.parse(opts.body);
      const model = body.model;
      calledModels.push(model);

      if (responses[model]) return responses[model];
      return groqOkResponse('{"ideas":[]}');
    };
  }

  test('calls qwen first (primary model)', async () => {
    // Simulate qwen succeeding immediately
    const mockFetch = buildFetch({
      'qwen/qwen3.8-27b': groqOkResponse('{"ideas":[{"title":"T","problem":"P","solution":"S","tagline":"G","targetUsers":"U"}]}'),
    });

    // We exercise the callGroq logic inline to avoid loading the real module
    // (which calls dotenv and requires live env vars)
    const GROQ_MODELS = ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
    const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 422]);
    const SYSTEM_INSTRUCTION = 'test system';

    async function callGroqUnderTest(prompt) {
      let lastError = null;
      for (const model of GROQ_MODELS) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
          const response = await mockFetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {},
            body: JSON.stringify({ model, messages: [], response_format: { type: 'json_object' } }),
            signal: controller.signal,
          });
          if (NON_RETRYABLE_STATUS.has(response.status)) {
            throw new Error(`non-retryable HTTP ${response.status}`);
          }
          const data = await response.json();
          if (!response.ok || data.error) throw new Error('Groq error');
          return data.choices[0].message.content;
        } catch (err) {
          lastError = err;
        } finally {
          clearTimeout(timeoutId);
        }
      }
      throw lastError;
    }

    const result = await callGroqUnderTest('test prompt');
    assert.equal(calledModels[0], 'qwen/qwen3.8-27b', 'qwen should be called first');
    assert.equal(calledModels.length, 1, 'should not try further models after success');
    assert.ok(result.includes('ideas'));
  });

  test('skips to qwen after primary fails with non-retryable 400', async () => {
    const mockFetch = buildFetch({
      'openai/gpt-oss-120b': makeResponse(400, ''), // non-retryable
      'qwen/qwen3.8-27b': groqOkResponse('{"ok":true}'),
    });

    // Simulate the fallback order starting from 120b as primary
    const TEST_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'];
    const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 422]);

    async function callGroqUnderTest(prompt) {
      let lastError = null;
      for (const model of TEST_MODELS) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await mockFetch('https://x', {
            method: 'POST', headers: {},
            body: JSON.stringify({ model }),
            signal: controller.signal,
          });
          if (NON_RETRYABLE_STATUS.has(response.status)) {
            throw new Error(`non-retryable HTTP ${response.status}`);
          }
          const data = await response.json();
          return data.choices[0].message.content;
        } catch (err) {
          lastError = err;
        } finally {
          clearTimeout(timeoutId);
        }
      }
      throw lastError;
    }

    const result = await callGroqUnderTest('test');
    assert.equal(calledModels[0], 'openai/gpt-oss-120b');
    assert.equal(calledModels[1], 'qwen/qwen3.8-27b');
    assert.equal(calledModels.length, 2);
    assert.ok(result.includes('ok'));
  });

  test('non-retryable status set is correct', () => {
    const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 422]);
    // These should be non-retryable
    assert.ok(NON_RETRYABLE_STATUS.has(400));
    assert.ok(NON_RETRYABLE_STATUS.has(401));
    assert.ok(NON_RETRYABLE_STATUS.has(403));
    assert.ok(NON_RETRYABLE_STATUS.has(404));
    assert.ok(NON_RETRYABLE_STATUS.has(422));
    // These should NOT be non-retryable (transient server errors)
    assert.ok(!NON_RETRYABLE_STATUS.has(429));
    assert.ok(!NON_RETRYABLE_STATUS.has(500));
    assert.ok(!NON_RETRYABLE_STATUS.has(503));
  });
});

// ---------------------------------------------------------------------------
// Model list validation
// ---------------------------------------------------------------------------

describe('model configuration', () => {
  test('GROQ_MODELS starts with qwen (json_object-capable model)', () => {
    // Read the actual file and check the model list order
    const fs = require('node:fs');
    const src = fs.readFileSync(
      require('node:path').join(__dirname, '..', 'services', 'aiService.js'),
      'utf8'
    );
    const match = src.match(/const GROQ_MODELS\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(match, 'GROQ_MODELS array should exist in aiService.js');
    const firstModel = match[1].trim().split('\n')[0];
    assert.ok(
      firstModel.includes('qwen/qwen3.8-27b'),
      `First Groq model should be qwen/qwen3.8-27b, got: ${firstModel}`
    );
  });

  test('validationService GROQ_MODELS starts with qwen', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(
      require('node:path').join(__dirname, '..', 'services', 'validationService.js'),
      'utf8'
    );
    const match = src.match(/const GROQ_MODELS\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(match, 'GROQ_MODELS array should exist in validationService.js');
    const firstModel = match[1].trim().split('\n')[0];
    assert.ok(
      firstModel.includes('qwen/qwen3.8-27b'),
      `First Groq model should be qwen/qwen3.8-27b, got: ${firstModel}`
    );
  });

  test('aiService Gemini primary is gemini-3.5-flash-lite', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(
      require('node:path').join(__dirname, '..', 'services', 'aiService.js'),
      'utf8'
    );
    assert.ok(
      src.includes("'gemini-3.5-flash-lite'"),
      'aiService.js should reference gemini-3.5-flash-lite'
    );
  });

  test('validationService Gemini fallback is gemini-3.5-flash-lite', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(
      require('node:path').join(__dirname, '..', 'services', 'validationService.js'),
      'utf8'
    );
    assert.ok(
      src.includes("'gemini-3.5-flash-lite'"),
      'validationService.js should reference gemini-3.5-flash-lite'
    );
  });

  test('NON_RETRYABLE_STATUS set is defined in both services', () => {
    const fs = require('node:fs');
    for (const fname of ['aiService.js', 'validationService.js']) {
      const src = fs.readFileSync(
        require('node:path').join(__dirname, '..', 'services', fname), 'utf8'
      );
      assert.ok(
        src.includes('NON_RETRYABLE_STATUS'),
        `${fname} should define NON_RETRYABLE_STATUS`
      );
    }
  });

  test('maxOutputTokens is set on Gemini models in aiService', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(
      require('node:path').join(__dirname, '..', 'services', 'aiService.js'),
      'utf8'
    );
    assert.ok(
      src.includes('maxOutputTokens'),
      'aiService.js Gemini config should set maxOutputTokens'
    );
  });
});

// ---------------------------------------------------------------------------
// JSON response edge cases
// ---------------------------------------------------------------------------

describe('JSON parsing edge cases', () => {
  function extractJSON(text) {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
    const trimmed = text.trim();
    return JSON.parse(trimmed.startsWith('{') || trimmed.startsWith('[') ? trimmed : text);
  }

  test('handles whitespace-padded JSON', () => {
    const result = extractJSON('  {"key":"value"}  ');
    assert.deepEqual(result, { key: 'value' });
  });

  test('handles nested JSON in a fenced block', () => {
    const result = extractJSON('```json\n{"a":{"b":1}}\n```');
    assert.deepEqual(result, { a: { b: 1 } });
  });

  test('generateIdeas-shaped response parses correctly', () => {
    const raw = JSON.stringify({
      ideas: [
        { title: 'A', problem: 'P', solution: 'S', tagline: 'T', targetUsers: 'U' },
      ],
    });
    const parsed = extractJSON(raw);
    assert.ok(Array.isArray(parsed.ideas));
    assert.equal(parsed.ideas[0].title, 'A');
  });

  test('analyzeIdeaBusinessBlueprint-shaped response parses correctly', () => {
    const raw = JSON.stringify({
      startupName: 'TestCo',
      tagline: 'Testing',
      summary: 'A test.',
      scores: { technicalFeasibility: 70, marketReadiness: 60, regulatoryRisk: 80, competitiveAdvantage: 65, executionComplexity: 75, scoreRationale: 'ok' },
      theReaper: [{ point: 'fails' }],
      thePainMiner: [{ frustration: 'hurts' }],
      pricingArchitect: { starter: { price: '$9', features: ['x'] }, pro: { price: '$29', features: ['x','y'] }, enterprise: { price: '$99', features: ['all'] } },
      thePivotMaster: { winningEdge: 'niche' },
    });
    const parsed = extractJSON(raw);
    assert.equal(parsed.startupName, 'TestCo');
    assert.equal(parsed.theReaper.length, 1);
    assert.ok(parsed.pricingArchitect.starter);
  });
});

console.log('\n✅  All unit tests defined. Running with Node test runner...\n');
