/**
 * backend/tests/rag/sqliteVectorStore.test.js
 *
 * Hardened unit tests for BLOB conversion, exact cosine similarity, persistence,
 * dimension/model mismatch defense, BLOB size verification, and transactional safe re-indexing.
 * Run with: node --test tests/rag/sqliteVectorStore.test.js
 */

'use strict';

const assert = require('node:assert/strict');
const { test, describe, beforeEach } = require('node:test');
const Database = require('better-sqlite3');

const {
  SqliteVectorStore,
  vectorToBlob,
  blobToVector,
  cosineSimilarity,
  validateDocumentsAndChunks,
} = require('../../services/rag/sqliteVectorStore');

describe('sqliteVectorStore - BLOB Conversion', () => {
  test('vectorToBlob and blobToVector roundtrip preserves float32 values', () => {
    const original = new Float32Array([0.1234, -0.5678, 1.0, -1.0, 0.0]);
    const blob = vectorToBlob(original);
    assert.ok(Buffer.isBuffer(blob));
    assert.equal(blob.length, 5 * 4);

    const recovered = blobToVector(blob);
    assert.equal(recovered.length, original.length);
    for (let i = 0; i < original.length; i++) {
      assert.ok(Math.abs(recovered[i] - original[i]) < 1e-6);
    }
  });

  test('vectorToBlob converts plain numeric array to float32 buffer', () => {
    const raw = [0.5, 0.25, 0.125];
    const blob = vectorToBlob(raw);
    const recovered = blobToVector(blob);
    assert.equal(recovered[0], 0.5);
    assert.equal(recovered[1], 0.25);
  });

  test('blobToVector throws on non-buffer input or unaligned byteLength', () => {
    assert.throws(() => blobToVector('not a buffer'), /input must be a Buffer/);
    assert.throws(() => blobToVector(null), /input must be a Buffer/);
    // 5 bytes cannot form Float32Array
    assert.throws(() => blobToVector(Buffer.alloc(5)), /must be a multiple of 4/);
  });
});

describe('sqliteVectorStore - cosineSimilarity', () => {
  test('computes exact 1.0 for identical normalized vectors', () => {
    const v1 = new Float32Array([0.6, 0.8]);
    const v2 = new Float32Array([0.6, 0.8]);
    assert.ok(Math.abs(cosineSimilarity(v1, v2) - 1.0) < 1e-6);
  });

  test('computes exact -1.0 for opposite vectors', () => {
    const v1 = new Float32Array([1.0, 0.0, 0.0]);
    const v2 = new Float32Array([-1.0, 0.0, 0.0]);
    assert.ok(Math.abs(cosineSimilarity(v1, v2) - (-1.0)) < 1e-6);
  });

  test('computes exact 0.0 for orthogonal vectors', () => {
    const v1 = new Float32Array([1.0, 0.0, 0.0]);
    const v2 = new Float32Array([0.0, 1.0, 0.0]);
    assert.equal(cosineSimilarity(v1, v2), 0.0);
  });

  test('returns 0.0 for zero vector without throwing division by zero', () => {
    const v1 = new Float32Array([0.0, 0.0, 0.0]);
    const v2 = new Float32Array([1.0, 2.0, 3.0]);
    assert.equal(cosineSimilarity(v1, v2), 0.0);
    assert.equal(cosineSimilarity(v1, v1), 0.0);
  });

  test('throws on vector dimension mismatch', () => {
    const v1 = new Float32Array([1, 2]);
    const v2 = new Float32Array([1, 2, 3]);
    assert.throws(
      () => cosineSimilarity(v1, v2),
      /Dimension mismatch in cosineSimilarity: vecA has 2 dims, vecB has 3 dims/
    );
  });

  test('throws on non-finite number inside vector', () => {
    const v1 = new Float32Array([1, NaN]);
    const v2 = new Float32Array([1, 2]);
    assert.throws(
      () => cosineSimilarity(v1, v2),
      /encountered non-finite number/
    );
  });
});

describe('sqliteVectorStore - Database Operations & Search', () => {
  let memDb;
  let store;

  function initTestDb() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS ideas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rag_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idea_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        content_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(idea_id, url),
        FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS rag_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        idea_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        total_chunks INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding_blob BLOB NOT NULL,
        model_name TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (document_id) REFERENCES rag_documents(id) ON DELETE CASCADE,
        FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE
      );

      INSERT INTO ideas (id, domain) VALUES (1, 'Legal Tech');
      INSERT INTO ideas (id, domain) VALUES (2, 'Agriculture');
    `);
    return db;
  }

  beforeEach(() => {
    memDb = initTestDb();
    store = new SqliteVectorStore(memDb);
  });

  test('stores documents and chunks, then retrieves via similarity search', () => {
    const docData = [
      {
        url: 'https://legal.ai/ndas',
        title: 'NDA Automation',
        contentHash: 'hash1',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 2,
            content: 'Auto-clause drafting reduces NDA review by 80%.',
            embedding: [1, 0, 0, 0],
            modelName: 'gemini-embedding-001',
            dimensions: 4,
          },
          {
            chunkIndex: 1,
            totalChunks: 2,
            content: 'GDPR liability in automated contract generation.',
            embedding: [0.8, 0.6, 0, 0],
            modelName: 'gemini-embedding-001',
            dimensions: 4,
          },
        ],
      },
      {
        url: 'https://farm.io/corn',
        title: 'Crop Rotation',
        contentHash: 'hash2',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 1,
            content: 'Corn yields increase with legume intercropping.',
            embedding: [0, 1, 0, 0],
            modelName: 'gemini-embedding-001',
            dimensions: 4,
          },
        ],
      },
    ];

    store.storeDocumentsAndChunks(1, docData, memDb);
    assert.equal(store.getChunkCount(1, memDb), 3);

    const queryVec = new Float32Array([1, 0, 0, 0]);
    const results = store.similaritySearch(1, queryVec, {
      topK: 5,
      minScore: 0.5,
      modelName: 'gemini-embedding-001',
      dimensions: 4,
    }, memDb);

    assert.equal(results.length, 2);
    assert.equal(results[0].title, 'NDA Automation');
    assert.ok(Math.abs(results[0].score - 1.0) < 1e-6);
    assert.ok(Math.abs(results[1].score - 0.8) < 1e-6);
  });

  test('throws explicit error on model mismatch', () => {
    const docData = [
      {
        url: 'https://example.com/doc',
        title: 'Doc',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 1,
            content: 'Test content',
            embedding: [1, 0],
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
        ],
      },
    ];
    store.storeDocumentsAndChunks(1, docData, memDb);

    assert.throws(
      () =>
        store.similaritySearch(
          1,
          new Float32Array([1, 0]),
          { modelName: 'text-embedding-3-small' },
          memDb
        ),
      /Model mismatch: query specifies model "text-embedding-3-small" but stored chunk has model "gemini-embedding-001"/
    );
  });

  test('throws explicit error on dimension mismatch', () => {
    const docData = [
      {
        url: 'https://example.com/doc',
        title: 'Doc',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 1,
            content: 'Test content',
            embedding: [1, 0, 0, 0],
            modelName: 'gemini-embedding-001',
            dimensions: 4,
          },
        ],
      },
    ];
    store.storeDocumentsAndChunks(1, docData, memDb);

    assert.throws(
      () => store.similaritySearch(1, new Float32Array([1, 0]), {}, memDb),
      /Dimension mismatch: query vector has 2 dimensions but stored chunk has 4 dimensions/
    );
  });

  test('detects and throws on corrupted BLOB length mismatch during search', () => {
    memDb.prepare(`
      INSERT INTO rag_documents (id, idea_id, url, title, content_hash)
      VALUES (99, 1, 'https://corrupt.com', 'Corrupt Doc', 'hash')
    `).run();

    // 2 dimensions requires 8 bytes (2 * 4), but we insert 12 bytes
    const badBlob = Buffer.alloc(12);
    memDb.prepare(`
      INSERT INTO rag_chunks (document_id, idea_id, chunk_index, total_chunks, content, embedding_blob, model_name, dimensions)
      VALUES (99, 1, 0, 1, 'Corrupted chunk', ?, 'gemini-embedding-001', 2)
    `).run(badBlob);

    assert.throws(
      () => store.similaritySearch(1, new Float32Array([1, 0]), { dimensions: 2 }, memDb),
      /Corrupted BLOB: chunk \d+ has 12 bytes, expected 8 bytes for 2 dimensions/
    );
  });

  test('pre-persistence validation rejects non-finite values and Float32 overflow (1e39)', () => {
    const overflowDoc = [
      {
        url: 'https://test.com',
        title: 'Overflow',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 1,
            content: 'Bad chunk',
            embedding: [1.0, 1e39], // Overflows Float32 to Infinity
            dimensions: 2,
            modelName: 'gemini-embedding-001',
          },
        ],
      },
    ];

    assert.throws(
      () => store.storeDocumentsAndChunks(1, overflowDoc, memDb),
      /not a finite Float32 number \(Infinity\)/
    );

    const nanDoc = [
      {
        url: 'https://test.com',
        title: 'NaN Doc',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 1,
            content: 'Bad chunk',
            embedding: [1.0, NaN],
            dimensions: 2,
            modelName: 'gemini-embedding-001',
          },
        ],
      },
    ];

    assert.throws(
      () => store.storeDocumentsAndChunks(1, nanDoc, memDb),
      /not a finite Float32 number \(NaN\)/
    );
  });

  test('re-indexing the same document URL replaces prior chunks without duplicate accumulation', () => {
    const v1Docs = [
      {
        url: 'https://example.com/law',
        title: 'V1 Title',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 2,
            content: 'Old chunk 0',
            embedding: [1, 0],
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
          {
            chunkIndex: 1,
            totalChunks: 2,
            content: 'Old chunk 1',
            embedding: [0, 1],
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
        ],
      },
    ];
    store.storeDocumentsAndChunks(1, v1Docs, memDb);
    assert.equal(store.getChunkCount(1, memDb), 2);

    // Re-index same URL with 3 updated chunks
    const v2Docs = [
      {
        url: 'https://example.com/law',
        title: 'V2 Title (Updated)',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 3,
            content: 'New chunk 0',
            embedding: [0.5, 0.5],
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
          {
            chunkIndex: 1,
            totalChunks: 3,
            content: 'New chunk 1',
            embedding: [0.6, 0.4],
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
          {
            chunkIndex: 2,
            totalChunks: 3,
            content: 'New chunk 2',
            embedding: [0.7, 0.3],
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
        ],
      },
    ];

    store.replaceIdeaChunks(1, v2Docs, memDb);

    // Chunk count must be exactly 3, not 5 (no accumulation of old chunks)
    assert.equal(store.getChunkCount(1, memDb), 3);

    // Check title updated on the document
    const docRow = memDb.prepare('SELECT title FROM rag_documents WHERE idea_id = ?').get(1);
    assert.equal(docRow.title, 'V2 Title (Updated)');
  });

  test('replaceIdeaChunks rolls back on invalid input before modifying existing index', () => {
    const initialDocs = [
      {
        url: 'https://safe.com',
        title: 'Safe Doc',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 1,
            content: 'Safe existing chunk',
            embedding: [1, 0],
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
        ],
      },
    ];
    store.storeDocumentsAndChunks(1, initialDocs, memDb);
    assert.equal(store.getChunkCount(1, memDb), 1);

    const badDocs = [
      {
        url: 'https://good.com',
        title: 'Good Doc',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 2,
            content: 'First chunk ok',
            embedding: [0, 1],
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
          {
            chunkIndex: 1,
            totalChunks: 2,
            content: 'Bad chunk',
            embedding: [1, Infinity], // Invalid Float32
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
        ],
      },
    ];

    assert.throws(
      () => store.replaceIdeaChunks(1, badDocs, memDb),
      /not a finite Float32 number \(Infinity\)/
    );

    // Verify previous safe chunk was NOT wiped out by the failed transaction
    assert.equal(store.getChunkCount(1, memDb), 1);
    const safeCheck = store.similaritySearch(1, new Float32Array([1, 0]), { minScore: 0.9 }, memDb);
    assert.equal(safeCheck.length, 1);
    assert.equal(safeCheck[0].title, 'Safe Doc');
  });
});
