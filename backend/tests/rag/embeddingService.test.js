/**
 * backend/tests/rag/embeddingService.test.js
 *
 * Comprehensive unit tests for vector validation, Float32 overflow detection,
 * batchEmbedContents API batching, selective unsupported-method fallback,
 * transient retry handling, and non-retryable failure defense.
 * Run with: node --test tests/rag/embeddingService.test.js
 */

'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

const {
  EmbeddingService,
  validateVector,
  DEFAULT_MODEL,
  DEFAULT_DIMENSIONS,
} = require('../../services/rag/embeddingService');

describe('embeddingService - validateVector & Float32 bounds', () => {
  test('accepts valid Array and converts to Float32Array', () => {
    const raw = [0.1, 0.2, 0.3, 0.4];
    const validated = validateVector(raw, 4);
    assert.ok(validated instanceof Float32Array);
    assert.equal(validated.length, 4);
    assert.ok(Math.abs(validated[0] - 0.1) < 1e-6);
  });

  test('accepts valid Float32Array directly', () => {
    const raw = new Float32Array([1.0, 2.0, 3.0]);
    const validated = validateVector(raw, 3);
    assert.equal(validated.length, 3);
    assert.equal(validated[0], 1.0);
  });

  test('throws on null, undefined, or non-array inputs', () => {
    assert.throws(() => validateVector(null, 4), /Vector validation error.*must be an Array/);
    assert.throws(() => validateVector(undefined, 4), /Vector validation error.*must be an Array/);
    assert.throws(() => validateVector('not a vector', 4), /Vector validation error.*must be an Array/);
    assert.throws(() => validateVector(12345, 4), /Vector validation error.*must be an Array/);
  });

  test('throws on dimension mismatch', () => {
    assert.throws(
      () => validateVector([1, 2, 3], 4),
      /Vector dimension mismatch: expected 4 dimensions, received 3/
    );
    assert.throws(
      () => validateVector([1, 2, 3, 4, 5], 4),
      /Vector dimension mismatch: expected 4 dimensions, received 5/
    );
  });

  test('throws when vector contains NaN or Infinity', () => {
    assert.throws(
      () => validateVector([1.0, NaN, 2.0], 3),
      /not a finite Float32 number \(NaN\)/
    );
    assert.throws(
      () => validateVector([1.0, Infinity, 2.0], 3),
      /not a finite Float32 number \(Infinity\)/
    );
    assert.throws(
      () => validateVector([1.0, -Infinity, 2.0], 3),
      /not a finite Float32 number \(-Infinity\)/
    );
  });

  test('rejects numbers that overflow 32-bit float to Infinity (e.g. 1e39)', () => {
    // 1e39 fits in 64-bit float but overflows 32-bit float (~3.4e38) to Infinity
    assert.throws(
      () => validateVector([1.0, 1e39, 2.0], 3),
      /not a finite Float32 number \(Infinity\)/
    );
    assert.throws(
      () => validateVector([1.0, -1e39, 2.0], 3),
      /not a finite Float32 number \(-Infinity\)/
    );
  });
});

describe('embeddingService - Batch Error Handling & Selective Fallback', () => {
  test('batch success: calls batchEmbedContents exactly once per batch', async () => {
    let batchCallCount = 0;
    let singleCallCount = 0;

    const mockClient = {
      getGenerativeModel: () => ({
        batchEmbedContents: async (req) => {
          batchCallCount++;
          return {
            embeddings: req.requests.map(() => ({ values: [0.1, 0.2] })),
          };
        },
        embedContent: async () => {
          singleCallCount++;
          return { embedding: { values: [0.1, 0.2] } };
        },
      }),
    };

    const service = new EmbeddingService({
      client: mockClient,
      dimensions: 2,
      batchSize: 4,
    });

    const chunks = [{ content: '1' }, { content: '2' }, { content: '3' }, { content: '4' }];
    const vectors = await service.embedChunks(chunks);

    assert.equal(vectors.length, 4);
    assert.equal(batchCallCount, 1);
    assert.equal(singleCallCount, 0); // No single calls made
  });

  test('unsupported-method fallback: falls back to concurrent embedContent when batchEmbedContents throws 404', async () => {
    let batchCallCount = 0;
    let singleCallCount = 0;

    const mockClient = {
      getGenerativeModel: () => ({
        batchEmbedContents: async () => {
          batchCallCount++;
          const err = new Error('Method not found for this API version [404]');
          err.status = 404;
          throw err;
        },
        embedContent: async () => {
          singleCallCount++;
          return { embedding: { values: [0.5, 0.5] } };
        },
      }),
    };

    const service = new EmbeddingService({
      client: mockClient,
      dimensions: 2,
      batchSize: 3,
    });

    const chunks = [{ content: '1' }, { content: '2' }, { content: '3' }];
    const vectors = await service.embedChunks(chunks);

    assert.equal(vectors.length, 3);
    assert.equal(batchCallCount, 1); // Attempted batch once, learned unsupported
    assert.equal(singleCallCount, 3); // Fell back to 3 individual calls
    assert.ok(service._batchUnsupported); // Marked unsupported for subsequent calls
  });

  test('retryable batch failure: retries batchEmbedContents on 429 and does NOT fall back to individual requests', async () => {
    let batchAttempts = 0;
    let singleCallCount = 0;

    const mockClient = {
      getGenerativeModel: () => ({
        batchEmbedContents: async (req) => {
          batchAttempts++;
          if (batchAttempts === 1) {
            const err = new Error('Rate limit exceeded [429]');
            err.status = 429;
            throw err;
          }
          return {
            embeddings: req.requests.map(() => ({ values: [0.7, 0.7] })),
          };
        },
        embedContent: async () => {
          singleCallCount++;
          return { embedding: { values: [0.7, 0.7] } };
        },
      }),
    };

    const service = new EmbeddingService({
      client: mockClient,
      dimensions: 2,
      batchSize: 2,
      maxRetries: 2,
    });

    const chunks = [{ content: 'A' }, { content: 'B' }];
    const vectors = await service.embedChunks(chunks);

    assert.equal(vectors.length, 2);
    assert.equal(batchAttempts, 2); // Retried batch
    assert.equal(singleCallCount, 0); // Did NOT inappropriately fall back to single calls
  });

  test('non-retryable batch failure: fails immediately on 400 without retrying or falling back', async () => {
    let batchAttempts = 0;
    let singleCallCount = 0;

    const mockClient = {
      getGenerativeModel: () => ({
        batchEmbedContents: async () => {
          batchAttempts++;
          const err = new Error('Bad request: invalid arguments [400]');
          err.status = 400;
          throw err;
        },
        embedContent: async () => {
          singleCallCount++;
          return { embedding: { values: [0.1, 0.1] } };
        },
      }),
    };

    const service = new EmbeddingService({
      client: mockClient,
      dimensions: 2,
      batchSize: 2,
      maxRetries: 3,
    });

    await assert.rejects(
      () => service.embedChunks([{ content: 'bad' }]),
      /Bad request: invalid arguments \[400\]/
    );

    assert.equal(batchAttempts, 1); // Fast-failed; no retries burned
    assert.equal(singleCallCount, 0); // No fallback to single calls
  });
});
