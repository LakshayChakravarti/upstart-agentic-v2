/**
 * backend/services/rag/sqliteVectorStore.js
 *
 * Persistent SQLite-backed vector store for document chunks and embeddings.
 * Includes exact cosine similarity, BLOB integrity validation, strict
 * pre-persistence vector verification, and transactional safe re-indexing.
 */

'use strict';

const defaultDb = require('../../db/database');
const { validateVector } = require('./embeddingService');

/**
 * Convert a numeric array or Float32Array to a Node Buffer for BLOB storage.
 * @param {Array<number>|Float32Array} vector
 * @returns {Buffer}
 */
function vectorToBlob(vector) {
  if (!vector || (!Array.isArray(vector) && !(vector instanceof Float32Array))) {
    throw new Error('vectorToBlob: input must be an Array or Float32Array');
  }
  const f32 = vector instanceof Float32Array ? vector : new Float32Array(vector);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

/**
 * Convert a stored SQLite BLOB Buffer back to a Float32Array.
 * @param {Buffer} buffer
 * @returns {Float32Array}
 */
function blobToVector(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('blobToVector: input must be a Buffer');
  }
  if (buffer.byteLength % 4 !== 0) {
    throw new Error(`blobToVector: invalid BLOB byteLength (${buffer.byteLength}), must be a multiple of 4`);
  }
  // Ensure word alignment by creating a slice/copy if byteOffset is unaligned
  const aligned = buffer.byteOffset % 4 === 0
    ? buffer
    : Buffer.from(buffer);
  return new Float32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4);
}

/**
 * Exact cosine similarity between two vectors.
 * Returns a value between -1.0 and 1.0 (or 0.0 for zero vectors).
 *
 * @param {Float32Array|Array<number>} vecA
 * @param {Float32Array|Array<number>} vecB
 * @returns {number}
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) {
    throw new Error('cosineSimilarity: both vectors must be provided');
  }
  if (vecA.length !== vecB.length) {
    throw new Error(
      `Dimension mismatch in cosineSimilarity: vecA has ${vecA.length} dims, vecB has ${vecB.length} dims`
    );
  }

  let dotProduct = 0;
  let normASq = 0;
  let normBSq = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
      throw new Error(`cosineSimilarity: encountered non-finite number at index ${i}`);
    }
    dotProduct += a * b;
    normASq += a * a;
    normBSq += b * b;
  }

  if (normASq === 0 || normBSq === 0) {
    return 0.0;
  }

  const similarity = dotProduct / (Math.sqrt(normASq) * Math.sqrt(normBSq));
  // Bound to [-1.0, 1.0] to absorb tiny floating point inaccuracies
  return Math.max(-1.0, Math.min(1.0, similarity));
}

/**
 * Strictly validate all document and chunk structures in memory before database operations.
 * @param {Array<object>} documentsWithChunks
 */
function validateDocumentsAndChunks(documentsWithChunks) {
  if (!Array.isArray(documentsWithChunks)) {
    throw new Error('validateDocumentsAndChunks: input must be an array');
  }

  for (let d = 0; d < documentsWithChunks.length; d++) {
    const doc = documentsWithChunks[d];
    if (!doc || typeof doc !== 'object') {
      throw new Error(`validateDocumentsAndChunks: document at index ${d} is invalid`);
    }
    if (!doc.url || typeof doc.url !== 'string') {
      throw new Error(`validateDocumentsAndChunks: document at index ${d} must have a valid url string`);
    }

    if (Array.isArray(doc.chunks)) {
      for (let c = 0; c < doc.chunks.length; c++) {
        const chunk = doc.chunks[c];
        if (!chunk || typeof chunk !== 'object') {
          throw new Error(`validateDocumentsAndChunks: chunk at index ${c} of doc ${d} is invalid`);
        }
        if (!chunk.modelName) {
          throw new Error(`validateDocumentsAndChunks: chunk ${chunk.chunkIndex} is missing modelName`);
        }
        if (typeof chunk.dimensions !== 'number' || chunk.dimensions <= 0) {
          throw new Error(`validateDocumentsAndChunks: chunk ${chunk.chunkIndex} has invalid dimensions (${chunk.dimensions})`);
        }
        if (!chunk.embedding) {
          throw new Error(`validateDocumentsAndChunks: chunk ${chunk.chunkIndex} is missing embedding vector`);
        }
        // Strict vector validation: checks finite Float32 values, dimension match, no NaN/Infinity
        validateVector(chunk.embedding, chunk.dimensions);
      }
    }
  }
}

class SqliteVectorStore {
  /**
   * @param {object} [db] - Optional better-sqlite3 database instance
   */
  constructor(db = defaultDb) {
    this.db = db;
  }

  /**
   * Validate and store documents and their embedded chunks.
   *
   * @param {number|string} ideaId
   * @param {Array<object>} documentsWithChunks
   * @param {object} [dbInstance] - Optional override DB instance
   */
  storeDocumentsAndChunks(ideaId, documentsWithChunks, dbInstance = this.db) {
    if (!ideaId) throw new Error('storeDocumentsAndChunks: ideaId is required');
    if (!Array.isArray(documentsWithChunks) || documentsWithChunks.length === 0) return;

    // 1. Pre-validate in memory before touching DB
    validateDocumentsAndChunks(documentsWithChunks);

    const insertDoc = dbInstance.prepare(`
      INSERT INTO rag_documents (idea_id, url, title, content_hash)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(idea_id, url) DO UPDATE SET
        title = excluded.title,
        content_hash = excluded.content_hash
    `);

    const getDocId = dbInstance.prepare(`
      SELECT id FROM rag_documents WHERE idea_id = ? AND url = ?
    `);

    const insertChunk = dbInstance.prepare(`
      INSERT INTO rag_chunks (
        document_id, idea_id, chunk_index, total_chunks,
        content, embedding_blob, model_name, dimensions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const doc of documentsWithChunks) {
      insertDoc.run(ideaId, doc.url, doc.title || 'Untitled', doc.contentHash || '');
      const docRecord = getDocId.get(ideaId, doc.url);
      const docId = docRecord.id;

      if (Array.isArray(doc.chunks)) {
        for (const chunk of doc.chunks) {
          const blob = vectorToBlob(chunk.embedding);
          insertChunk.run(
            docId,
            ideaId,
            chunk.chunkIndex,
            chunk.totalChunks,
            chunk.content,
            blob,
            chunk.modelName,
            chunk.dimensions
          );
        }
      }
    }
  }

  /**
   * Safely replace all existing RAG records for an idea session inside a transaction.
   * All documents and vectors are pre-validated before any SQL runs.
   * If any step fails, the previous index remains untouched.
   *
   * @param {number|string} ideaId
   * @param {Array<object>} documentsWithChunks
   * @param {object} [dbInstance]
   */
  replaceIdeaChunks(ideaId, documentsWithChunks, dbInstance = this.db) {
    if (!ideaId) throw new Error('replaceIdeaChunks: ideaId is required');

    // Pre-validate before opening transaction or deleting anything
    if (Array.isArray(documentsWithChunks) && documentsWithChunks.length > 0) {
      validateDocumentsAndChunks(documentsWithChunks);
    }

    const transaction = dbInstance.transaction(() => {
      // 1. Delete old records for this idea
      dbInstance.prepare('DELETE FROM rag_chunks WHERE idea_id = ?').run(ideaId);
      dbInstance.prepare('DELETE FROM rag_documents WHERE idea_id = ?').run(ideaId);

      // 2. Insert prepared new documents and chunks
      if (Array.isArray(documentsWithChunks) && documentsWithChunks.length > 0) {
        this.storeDocumentsAndChunks(ideaId, documentsWithChunks, dbInstance);
      }
    });

    transaction();
  }

  /**
   * Perform exact cosine similarity search over chunks stored for a specific idea session.
   *
   * @param {number|string} ideaId
   * @param {Array<number>|Float32Array} queryVector
   * @param {object} [options]
   * @param {number} [options.topK=5] - Maximum number of chunks to return
   * @param {number} [options.minScore=0.60] - Minimum cosine similarity threshold
   * @param {string} [options.modelName] - Expected model identifier
   * @param {number} [options.dimensions] - Expected vector dimensions
   * @param {object} [dbInstance]
   * @returns {Array<object>} Ranked chunks with similarity score
   */
  similaritySearch(ideaId, queryVector, options = {}, dbInstance = this.db) {
    if (!ideaId) throw new Error('similaritySearch: ideaId is required');
    if (!queryVector || queryVector.length === 0) {
      throw new Error('similaritySearch: queryVector must not be empty');
    }

    const topK = options.topK !== undefined ? options.topK : 5;
    const minScore = options.minScore !== undefined ? options.minScore : 0.60;
    const expectedDims = options.dimensions || queryVector.length;
    const expectedModel = options.modelName || null;

    if (queryVector.length !== expectedDims) {
      throw new Error(
        `Dimension mismatch: query vector has ${queryVector.length} dimensions, expected ${expectedDims}`
      );
    }

    // Validate query vector elements
    for (let i = 0; i < queryVector.length; i++) {
      if (!Number.isFinite(queryVector[i])) {
        throw new Error(`similaritySearch: query vector element at index ${i} is not finite (${queryVector[i]})`);
      }
    }

    const rows = dbInstance.prepare(`
      SELECT c.id, c.document_id, c.idea_id, c.chunk_index, c.total_chunks,
             c.content, c.embedding_blob, c.model_name, c.dimensions,
             d.url, d.title, d.content_hash
      FROM rag_chunks c
      JOIN rag_documents d ON d.id = c.document_id
      WHERE c.idea_id = ?
    `).all(ideaId);

    const scored = [];

    for (const row of rows) {
      // Validate BLOB integrity against stored dimensions
      if (row.embedding_blob.length !== row.dimensions * 4) {
        throw new Error(
          `Corrupted BLOB: chunk ${row.id} has ${row.embedding_blob.length} bytes, expected ${row.dimensions * 4} bytes for ${row.dimensions} dimensions`
        );
      }

      // Validate model compatibility
      if (expectedModel && row.model_name !== expectedModel) {
        throw new Error(
          `Model mismatch: query specifies model "${expectedModel}" but stored chunk has model "${row.model_name}"`
        );
      }

      // Validate dimension compatibility
      if (row.dimensions !== queryVector.length) {
        throw new Error(
          `Dimension mismatch: query vector has ${queryVector.length} dimensions but stored chunk has ${row.dimensions} dimensions`
        );
      }

      const chunkVector = blobToVector(row.embedding_blob);
      const score = cosineSimilarity(queryVector, chunkVector);

      if (score >= minScore) {
        scored.push({
          id: row.id,
          documentId: row.document_id,
          ideaId: row.idea_id,
          chunkIndex: row.chunk_index,
          totalChunks: row.total_chunks,
          content: row.content,
          url: row.url,
          title: row.title,
          score,
          modelName: row.model_name,
          dimensions: row.dimensions,
        });
      }
    }

    // Sort descending by similarity score
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topK);
  }

  /**
   * Count total chunks indexed for a specific idea session.
   * @param {number|string} ideaId
   * @param {object} [dbInstance]
   * @returns {number}
   */
  getChunkCount(ideaId, dbInstance = this.db) {
    const res = dbInstance
      .prepare('SELECT COUNT(*) as count FROM rag_chunks WHERE idea_id = ?')
      .get(ideaId);
    return res ? res.count : 0;
  }

  /**
   * Delete all indexed chunks and documents for an idea session.
   * @param {number|string} ideaId
   * @param {object} [dbInstance]
   */
  deleteIdeaChunks(ideaId, dbInstance = this.db) {
    dbInstance.prepare('DELETE FROM rag_chunks WHERE idea_id = ?').run(ideaId);
    dbInstance.prepare('DELETE FROM rag_documents WHERE idea_id = ?').run(ideaId);
  }
}

module.exports = {
  SqliteVectorStore,
  vectorToBlob,
  blobToVector,
  cosineSimilarity,
  validateDocumentsAndChunks,
};
