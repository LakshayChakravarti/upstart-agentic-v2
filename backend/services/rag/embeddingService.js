/**
 * backend/services/rag/embeddingService.js
 *
 * Embedding generation with dimension verification, native batchEmbedContents
 * API batching, retry/backoff, and provider isolation.
 */

'use strict';

const { GoogleGenerativeAI, TaskType } = require('@google/generative-ai');

const DEFAULT_MODEL = process.env.EMBEDDING_MODEL || 'gemini-embedding-001';
const DEFAULT_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS, 10) || 768;
const DEFAULT_BATCH_SIZE = 16;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Validate that an embedding vector is well-formed:
 * - Is an Array or Float32Array
 * - Has exact expected dimensions
 * - Contains only finite Float32 numbers (no NaN, Infinity, or overflow)
 *
 * @param {Array<number>|Float32Array} vector
 * @param {number} expectedDimensions
 * @returns {Float32Array}
 */
function validateVector(vector, expectedDimensions) {
  if (!vector || (!Array.isArray(vector) && !(vector instanceof Float32Array))) {
    throw new Error('Vector validation error: embedding must be an Array or Float32Array');
  }

  if (vector.length !== expectedDimensions) {
    throw new Error(
      `Vector dimension mismatch: expected ${expectedDimensions} dimensions, received ${vector.length}`
    );
  }

  // Convert to Float32Array to detect 32-bit float overflow (e.g. 1e39 -> Infinity)
  const float32 = vector instanceof Float32Array ? vector : new Float32Array(vector);

  for (let i = 0; i < float32.length; i++) {
    const val = float32[i];
    if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val)) {
      throw new Error(`Vector validation error: element at index ${i} is not a finite Float32 number (${val})`);
    }
  }

  return float32;
}

class EmbeddingService {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey]
   * @param {string} [options.modelName]
   * @param {number} [options.dimensions]
   * @param {number} [options.batchSize]
   * @param {number} [options.maxRetries]
   * @param {object} [options.client] - Injected GoogleGenerativeAI client (for testing)
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';
    this.modelName = options.modelName || DEFAULT_MODEL;
    this.dimensions = options.dimensions || DEFAULT_DIMENSIONS;
    this.batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : DEFAULT_MAX_RETRIES;
    this.client = options.client || null;
    this._batchUnsupported = false;
  }

  /**
   * Get or create the underlying GenerativeModel instance
   */
  getModel() {
    if (this.client) {
      return this.client.getGenerativeModel({ model: this.modelName });
    }
    if (!this.apiKey) {
      throw new Error('EmbeddingService: No GEMINI_API_KEY available in environment or options.');
    }
    const genAI = new GoogleGenerativeAI(this.apiKey);
    return genAI.getGenerativeModel({ model: this.modelName });
  }

  /**
   * Execute an operation with exponential backoff on transient errors
   * @private
   */
  async _withRetry(fn, operationName = 'embedding') {
    let lastErr = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const status = err.status || (err.message && err.message.match(/\[(\d{3})\]/)?.[1]);
        const numStatus = Number(status);
        const isRetryable =
          numStatus === 429 ||
          numStatus === 503 ||
          numStatus === 500 ||
          /overloaded|timeout|rate limit/i.test(err.message);

        if (attempt < this.maxRetries && isRetryable) {
          const delay = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 200);
          console.warn(`[EmbeddingService] ${operationName} retry ${attempt + 1}/${this.maxRetries} in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          break;
        }
      }
    }
    throw lastErr;
  }

  /**
   * Embed a single search query text using TaskType.RETRIEVAL_QUERY.
   *
   * @param {string} text - Query text to embed
   * @returns {Promise<Float32Array>}
   */
  async embedQuery(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('embedQuery: query text must be a non-empty string');
    }

    const model = this.getModel();
    const result = await this._withRetry(async () => {
      const res = await model.embedContent({
        content: { parts: [{ text }] },
        taskType: TaskType.RETRIEVAL_QUERY,
        outputDimensionality: this.dimensions,
      });
      return res;
    }, 'embedQuery');

    const rawValues = result.embedding?.values;
    return validateVector(rawValues, this.dimensions);
  }

  /**
   * Embed an array of chunk objects or texts using TaskType.RETRIEVAL_DOCUMENT.
   * Chunks are batched according to this.batchSize using native batchEmbedContents API
   * with fallback to concurrent individual requests ONLY when the batch method is unsupported.
   *
   * @param {Array<object|string>} chunks - Array of chunk objects with a .content property, or plain strings
   * @returns {Promise<Array<Float32Array>>} Array of validated Float32Array vectors
   */
  async embedChunks(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return [];
    }

    const texts = chunks.map((c) => (typeof c === 'string' ? c : c.content || ''));
    const model = this.getModel();
    const allVectors = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batchTexts = texts.slice(i, i + this.batchSize);

      const batchVectors = await this._withRetry(async () => {
        // 1. Try native batchEmbedContents API if supported
        if (!this._batchUnsupported && typeof model.batchEmbedContents === 'function') {
          try {
            const requests = batchTexts.map((text) => ({
              content: { parts: [{ text }] },
              taskType: TaskType.RETRIEVAL_DOCUMENT,
              outputDimensionality: this.dimensions,
            }));
            const batchRes = await model.batchEmbedContents({ requests });
            if (batchRes && Array.isArray(batchRes.embeddings)) {
              return batchRes.embeddings.map((e) => e.values);
            }
          } catch (batchErr) {
            const msg = (batchErr.message || '').toLowerCase();
            const status = Number(batchErr.status || (msg.match(/\[(\d{3})\]/)?.[1]));
            const isUnsupported =
              status === 404 ||
              status === 501 ||
              msg.includes('not supported') ||
              msg.includes('not found') ||
              msg.includes('unsupported');

            if (isUnsupported) {
              console.warn(
                `[EmbeddingService] batchEmbedContents unsupported (${batchErr.message}), falling back to individual embedContent requests.`
              );
              this._batchUnsupported = true;
              // Fall through to concurrent embedContent
            } else {
              // Transient (429/503) or non-retryable (400/401/403): re-throw so _withRetry handles it correctly
              throw batchErr;
            }
          }
        }

        // 2. Fallback path: concurrent individual requests
        const promises = batchTexts.map((text) =>
          model.embedContent({
            content: { parts: [{ text }] },
            taskType: TaskType.RETRIEVAL_DOCUMENT,
            outputDimensionality: this.dimensions,
          })
        );
        const results = await Promise.all(promises);
        return results.map((r) => r.embedding?.values);
      }, `embedChunks[${i}..${i + batchTexts.length}]`);

      for (const rawVec of batchVectors) {
        allVectors.push(validateVector(rawVec, this.dimensions));
      }
    }

    return allVectors;
  }
}

module.exports = {
  EmbeddingService,
  validateVector,
  DEFAULT_MODEL,
  DEFAULT_DIMENSIONS,
  DEFAULT_BATCH_SIZE,
};
