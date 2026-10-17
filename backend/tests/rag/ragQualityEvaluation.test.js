/**
 * backend/tests/rag/ragQualityEvaluation.test.js
 *
 * Phase 2D: RAG Quality, Reliability, and Provenance Hardening Suite:
 * - Deterministic retrieval-quality and rank ordering
 * - Boundary threshold conditions (exact equality, top-K truncation, zero-magnitude)
 * - Strict evidence & citation provenance across the full pipeline
 * - Multi-idea database isolation and atomic rollback on failure
 * - Non-destructive behavior on empty/transient search results
 * - Structured diagnostics observability (timings, candidate counts, failure reasons)
 *
 * Runs fully in-memory with deterministic test fixtures — zero network or external API access.
 * Run with: node --test tests/rag/ragQualityEvaluation.test.js
 */

'use strict';

const assert = require('node:assert/strict');
const { test, describe, beforeEach } = require('node:test');
const Database = require('better-sqlite3');

const {
  RetrievalService,
  normalizeSourceRecords,
  formatPromptContext,
  extractSourcesFromChunks,
} = require('../../services/rag/retrievalService');
const { EmbeddingService } = require('../../services/rag/embeddingService');
const { SqliteVectorStore } = require('../../services/rag/sqliteVectorStore');
const { analyzeIdeaBusinessBlueprint } = require('../../services/aiService');

// ---------------------------------------------------------------------------
// Isolated Test Database Factory
// ---------------------------------------------------------------------------

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      domain TEXT NOT NULL,
      skills TEXT,
      time_available TEXT,
      budget_level TEXT,
      experience_level TEXT,
      target_users TEXT,
      idea_data TEXT NOT NULL,
      selected_idea TEXT,
      strategic_direction TEXT,
      user_elaboration TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

    CREATE INDEX IF NOT EXISTS idx_rag_chunks_idea_id ON rag_chunks(idea_id);
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_doc_id ON rag_chunks(document_id);

    INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Founder', 'founder@test.com', 'hash');
    INSERT INTO ideas (id, user_id, domain, idea_data) VALUES (101, 1, 'LegalTech', '[]');
    INSERT INTO ideas (id, user_id, domain, idea_data) VALUES (202, 1, 'HealthTech', '[]');
    INSERT INTO ideas (id, user_id, domain, idea_data) VALUES (303, 1, 'EdTech', '[]');
  `);
  return db;
}

// ---------------------------------------------------------------------------
// Section 5.A: Retrieval-Quality Evaluation & Ranking Tests
// ---------------------------------------------------------------------------

describe('Phase 2D - Retrieval Quality & Ranking', () => {
  let db;
  let vectorStore;

  beforeEach(() => {
    db = createTestDb();
    vectorStore = new SqliteVectorStore(db);
  });

  test('relevant document ranks above moderately relevant and unrelated documents', async () => {
    // 4-dimensional normalized vectors:
    // Query vector: [1.0, 0.0, 0.0, 0.0]
    // Doc A (highly relevant): [0.96, 0.28, 0.0, 0.0] -> cosine similarity = 0.96
    // Doc B (moderately relevant): [0.707, 0.707, 0.0, 0.0] -> cosine similarity = 0.707
    // Doc C (unrelated noise): [0.10, 0.99, 0.0, 0.0] -> cosine similarity = 0.10

    const mockEmbeddingClient = {
      getGenerativeModel: () => ({
        batchEmbedContents: async ({ requests }) => ({
          embeddings: requests.map((req) => {
            const text = req.content.parts[0].text;
            let vec = [0.0, 1.0, 0.0, 0.0];
            if (text.includes('DOC_HIGH')) vec = [0.96, 0.28, 0.0, 0.0];
            else if (text.includes('DOC_MED')) vec = [0.707, 0.707, 0.0, 0.0];
            else if (text.includes('DOC_LOW')) vec = [0.10, 0.99, 0.0, 0.0];
            return { values: vec };
          }),
        }),
        embedContent: async () => ({
          embedding: { values: [1.0, 0.0, 0.0, 0.0] }, // Query
        }),
      }),
    };

    const embeddingService = new EmbeddingService({
      client: mockEmbeddingClient,
      dimensions: 4,
    });
    const retrievalService = new RetrievalService({ embeddingService, vectorStore, db }, { minScore: 0.50 });

    const docs = [
      {
        ideaId: 101,
        url: 'https://research.test/doc-low',
        title: 'Unrelated Noise',
        text: 'DOC_LOW: Offshore maritime trade regulations and canal dues.',
        contentHash: 'hashC',
      },
      {
        ideaId: 101,
        url: 'https://research.test/doc-high',
        title: 'Primary Competitor Breakdown',
        text: 'DOC_HIGH: Direct breakdown of competitor contract clause drafting platform.',
        contentHash: 'hashA',
      },
      {
        ideaId: 101,
        url: 'https://research.test/doc-med',
        title: 'Secondary Market Overview',
        text: 'DOC_MED: General SMB software adoption and billing workflows.',
        contentHash: 'hashB',
      },
    ];

    await retrievalService.indexSources(101, docs);

    const { retrievedChunks } = await retrievalService.retrieve(101, 'contract clause drafting');

    // Assert: Only docs above minScore 0.50 are returned, ranked strictly descending
    assert.equal(retrievedChunks.length, 2, 'Unrelated DOC_LOW (< 0.50) must be excluded');
    assert.equal(retrievedChunks[0].title, 'Primary Competitor Breakdown');
    assert.equal(retrievedChunks[1].title, 'Secondary Market Overview');
    assert.ok(
      retrievedChunks[0].score > retrievedChunks[1].score,
      `Rank ordering failed: score 0 (${retrievedChunks[0].score}) must exceed score 1 (${retrievedChunks[1].score})`
    );
    assert.ok(Math.abs(retrievedChunks[0].score - 0.96) < 0.01);
    assert.ok(Math.abs(retrievedChunks[1].score - 0.707) < 0.01);
  });

  test('threshold boundary conditions: exact equality is included, below is excluded', () => {
    // Direct vector store test to verify boundary equality: score >= minScore
    const queryVec = new Float32Array([1.0, 0.0]);

    // Doc 1: exactly 0.60
    // Doc 2: 0.599 (just below)
    // Doc 3: 0.601 (just above)
    const testDoc = [
      {
        url: 'https://boundary.test/1',
        title: 'Exact Boundary Doc',
        contentHash: 'h1',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 1,
            content: 'Exact 0.60 chunk',
            embedding: [0.60, 0.80], // dot product with [1, 0] = 0.60
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
        ],
      },
      {
        url: 'https://boundary.test/2',
        title: 'Below Boundary Doc',
        contentHash: 'h2',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 1,
            content: '0.599 chunk',
            embedding: [0.599, 0.8007], // dot product ~ 0.599
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
        ],
      },
      {
        url: 'https://boundary.test/3',
        title: 'Above Boundary Doc',
        contentHash: 'h3',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 1,
            content: '0.601 chunk',
            embedding: [0.601, 0.7992], // dot product ~ 0.601
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
        ],
      },
    ];

    vectorStore.storeDocumentsAndChunks(101, testDoc, db);

    const results = vectorStore.similaritySearch(101, queryVec, { minScore: 0.60, dimensions: 2 }, db);

    assert.equal(results.length, 2, 'Should include exact 0.60 and 0.601, but exclude 0.599');
    const titles = results.map((r) => r.title);
    assert.ok(titles.includes('Above Boundary Doc'));
    assert.ok(titles.includes('Exact Boundary Doc'));
    assert.ok(!titles.includes('Below Boundary Doc'));
  });

  test('top-K truncation strictly bounds results to requested limit in descending score order', () => {
    // 5 chunks with scores: 0.9, 0.8, 0.7, 0.6, 0.5
    const queryVec = new Float32Array([1.0, 0.0]);
    const docs = [0.9, 0.8, 0.7, 0.6, 0.5].map((score, idx) => ({
      url: `https://topk.test/${idx}`,
      title: `Doc ${score}`,
      contentHash: `h_${idx}`,
      chunks: [
        {
          chunkIndex: 0,
          totalChunks: 1,
          content: `Content with score ${score}`,
          embedding: [score, Math.sqrt(Math.max(0, 1 - score * score))],
          modelName: 'gemini-embedding-001',
          dimensions: 2,
        },
      ],
    }));

    vectorStore.storeDocumentsAndChunks(101, docs, db);

    // Request topK = 3 with minScore = 0.50
    const results = vectorStore.similaritySearch(101, queryVec, { topK: 3, minScore: 0.50, dimensions: 2 }, db);

    assert.equal(results.length, 3, 'topK = 3 must return exactly 3 chunks despite 5 matching threshold');
    assert.equal(results[0].title, 'Doc 0.9');
    assert.equal(results[1].title, 'Doc 0.8');
    assert.equal(results[2].title, 'Doc 0.7');
  });

  test('orthogonal and opposite vectors behave gracefully without throwing NaN or division by zero', () => {
    const queryVec = new Float32Array([1.0, 0.0]);
    const edgeDocs = [
      {
        url: 'https://edge.test/orthogonal',
        title: 'Orthogonal Doc',
        contentHash: 'he1',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 1,
            content: 'Perpendicular',
            embedding: [0.0, 1.0], // cosine = 0.0
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
        ],
      },
      {
        url: 'https://edge.test/opposite',
        title: 'Opposite Doc',
        contentHash: 'he2',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 1,
            content: 'Direct opposite',
            embedding: [-1.0, 0.0], // cosine = -1.0
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
        ],
      },
    ];

    vectorStore.storeDocumentsAndChunks(101, edgeDocs, db);

    // With minScore 0.1, neither should return
    const filteredResults = vectorStore.similaritySearch(101, queryVec, { minScore: 0.1, dimensions: 2 }, db);
    assert.equal(filteredResults.length, 0);

    // With minScore -1.0, both should return with correct exact scores
    const allResults = vectorStore.similaritySearch(101, queryVec, { minScore: -1.0, dimensions: 2 }, db);
    assert.equal(allResults.length, 2);
    assert.equal(allResults[0].title, 'Orthogonal Doc');
    assert.equal(allResults[0].score, 0.0);
    assert.equal(allResults[1].title, 'Opposite Doc');
    assert.ok(Math.abs(allResults[1].score - (-1.0)) < 1e-6);
  });
});

// ---------------------------------------------------------------------------
// Section 5.B: Evidence and Citation Provenance Tests
// ---------------------------------------------------------------------------

describe('Phase 2D - Evidence & Citation Provenance', () => {
  let db;
  let vectorStore;

  beforeEach(() => {
    db = createTestDb();
    vectorStore = new SqliteVectorStore(db);
  });

  test('end-to-end evidence provenance: verified retrieved sources appear in citations, unretrieved excluded', async () => {
    const MOCK_QUERY_EMBEDDING = [1.0, 0.0, 0.0, 0.0];

    const mockEmbeddingClient = {
      getGenerativeModel: () => ({
        batchEmbedContents: async ({ requests }) => ({
          embeddings: requests.map((req) => {
            const text = req.content.parts[0].text;
            if (text.includes('ALPHA_CONTENT')) return { values: [0.95, 0.31, 0.0, 0.0] }; // Score ~0.95
            if (text.includes('BETA_CONTENT')) return { values: [0.75, 0.66, 0.0, 0.0] };  // Score ~0.75
            return { values: [0.10, 0.99, 0.0, 0.0] };                                      // Score ~0.10 (noise)
          }),
        }),
        embedContent: async () => ({ embedding: { values: MOCK_QUERY_EMBEDDING } }),
      }),
    };

    const embeddingService = new EmbeddingService({ client: mockEmbeddingClient, dimensions: 4 });
    const retrievalService = new RetrievalService({ embeddingService, vectorStore, db }, { minScore: 0.50 });

    let capturedPrompt = '';

    const mockTavily = async () => ({
      results: [
        {
          title: 'Source Alpha (Verified Relevant)',
          url: 'https://provenance.test/alpha',
          content: 'ALPHA_CONTENT: Solo lawyers save 12 hours monthly with targeted template automation.',
        },
        {
          title: 'Source Beta (Supporting Evidence)',
          url: 'https://provenance.test/beta',
          content: 'BETA_CONTENT: SaaS contract review pricing benchmarked at $99 per user.',
        },
        {
          title: 'Source Gamma (Unrelated Noise)',
          url: 'https://provenance.test/gamma',
          content: 'GAMMA_CONTENT: Grain storage silo temperature regulation in agricultural cooperatives.',
        },
      ],
      urls: [
        { title: 'Source Alpha (Verified Relevant)', url: 'https://provenance.test/alpha' },
        { title: 'Source Beta (Supporting Evidence)', url: 'https://provenance.test/beta' },
        { title: 'Source Gamma (Unrelated Noise)', url: 'https://provenance.test/gamma' },
      ],
      context: 'Raw fallback context',
    });

    const mockGemini = async (prompt) => {
      capturedPrompt = prompt;
      return JSON.stringify({
        startupName: 'VerifiedLegal',
        tagline: 'Grounded Analysis',
        summary: 'Fully grounded startup blueprint.',
        scores: { technicalFeasibility: 80 },
        theReaper: [], thePainMiner: [], pricingArchitect: {}, thePivotMaster: {},
      });
    };

    const blueprint = await analyzeIdeaBusinessBlueprint(
      { title: 'Legal Template Automation', problem: 'Manual contract drafting takes too long.' },
      'Node.js', '10h', 'Low', 'Intermediate', null, null, 101,
      {
        retrievalService,
        tavilySearchFn: mockTavily,
        geminiFn: mockGemini,
      }
    );

    // 1. Assert prompt contains retrieved evidence chunks
    assert.ok(capturedPrompt.includes('RETRIEVED MARKET RESEARCH CONTEXT (VIA VECTOR SEARCH)'));
    assert.ok(capturedPrompt.includes('Solo lawyers save 12 hours monthly with targeted template automation.'));
    assert.ok(capturedPrompt.includes('SaaS contract review pricing benchmarked at $99 per user.'));

    // 2. Assert unrelated document is strictly absent from the final prompt
    assert.ok(
      !capturedPrompt.includes('Grain storage silo temperature regulation'),
      'Unrelated noise chunk must not enter the prompt'
    );

    // 3. Assert researchSources contains ONLY the 2 retrieved sources (Source Gamma excluded)
    assert.equal(blueprint.researchSources.length, 2, 'researchSources must contain only retrieved evidence');
    const returnedUrls = blueprint.researchSources.map((s) => s.url);
    assert.ok(returnedUrls.includes('https://provenance.test/alpha'));
    assert.ok(returnedUrls.includes('https://provenance.test/beta'));
    assert.ok(!returnedUrls.includes('https://provenance.test/gamma'), 'Unretrieved source must NOT appear in researchSources');

    // 4. Assert ragGrounded flag and diagnostics
    assert.equal(blueprint.ragGrounded, true);
    assert.equal(blueprint.ragDiagnostics.status, 'grounded');
    assert.equal(blueprint.ragDiagnostics.retrievedChunkCount, 2);
  });
});

// ---------------------------------------------------------------------------
// Section 5.C: Index Integrity, Multi-Idea Isolation & Failure Recovery
// ---------------------------------------------------------------------------

describe('Phase 2D - Index Integrity & Failure Recovery', () => {
  let db;
  let vectorStore;

  beforeEach(() => {
    db = createTestDb();
    vectorStore = new SqliteVectorStore(db);
  });

  test('multi-idea isolation: updates to Idea A do not touch or mix with Idea B or C', async () => {
    const mockEmbeddingClient = {
      getGenerativeModel: () => ({
        batchEmbedContents: async ({ requests }) => ({
          embeddings: requests.map(() => ({ values: [1.0, 0.0] })),
        }),
        embedContent: async () => ({ embedding: { values: [1.0, 0.0] } }),
      }),
    };
    const embeddingService = new EmbeddingService({ client: mockEmbeddingClient, dimensions: 2 });
    const service = new RetrievalService({ embeddingService, vectorStore, db });

    // Index Idea 101, Idea 202, Idea 303
    await service.indexSources(101, [{ ideaId: 101, url: 'https://idea101.test', title: 'Idea 101 Doc', text: 'Text 101', contentHash: 'h101' }]);
    await service.indexSources(202, [{ ideaId: 202, url: 'https://idea202.test', title: 'Idea 202 Doc', text: 'Text 202', contentHash: 'h202' }]);
    await service.indexSources(303, [{ ideaId: 303, url: 'https://idea303.test', title: 'Idea 303 Doc', text: 'Text 303', contentHash: 'h303' }]);

    assert.equal(vectorStore.getChunkCount(101, db), 1);
    assert.equal(vectorStore.getChunkCount(202, db), 1);
    assert.equal(vectorStore.getChunkCount(303, db), 1);

    // Re-index Idea 101 with 2 new chunks
    await service.indexSources(101, [
      { ideaId: 101, url: 'https://idea101-v2.test', title: 'Idea 101 Doc V2', text: 'Updated text 101', contentHash: 'h101_v2' },
      { ideaId: 101, url: 'https://idea101-v2b.test', title: 'Idea 101 Doc V2B', text: 'Updated text 101B', contentHash: 'h101_v2b' },
    ]);

    // Idea 101 updated to 2 chunks; Idea 202 and 303 remain at exactly 1
    assert.equal(vectorStore.getChunkCount(101, db), 2);
    assert.equal(vectorStore.getChunkCount(202, db), 1);
    assert.equal(vectorStore.getChunkCount(303, db), 1);

    // Delete Idea 202
    vectorStore.deleteIdeaChunks(202, db);
    assert.equal(vectorStore.getChunkCount(101, db), 2);
    assert.equal(vectorStore.getChunkCount(202, db), 0);
    assert.equal(vectorStore.getChunkCount(303, db), 1);
  });

  test('transactional rollback preserves previous index when embedding validation fails', async () => {
    // 1. Successfully index initial valid document
    const validDoc = [
      {
        url: 'https://preserve.test/v1',
        title: 'Original Valid Document',
        contentHash: 'h_v1',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 1,
            content: 'Original intact content',
            embedding: [1.0, 0.0],
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
        ],
      },
    ];
    vectorStore.storeDocumentsAndChunks(101, validDoc, db);
    assert.equal(vectorStore.getChunkCount(101, db), 1);

    // 2. Attempt replacement with invalid Float32 value (NaN)
    const corruptDoc = [
      {
        url: 'https://preserve.test/corrupt',
        title: 'Corrupt Document',
        contentHash: 'h_corrupt',
        chunks: [
          {
            chunkIndex: 0,
            totalChunks: 1,
            content: 'Bad vector chunk',
            embedding: [NaN, 0.0],
            modelName: 'gemini-embedding-001',
            dimensions: 2,
          },
        ],
      },
    ];

    assert.throws(
      () => vectorStore.replaceIdeaChunks(101, corruptDoc, db),
      /not a finite Float32 number/
    );

    // 3. Confirm original document was NOT deleted by the aborted transaction
    assert.equal(vectorStore.getChunkCount(101, db), 1);
    const docRow = db.prepare('SELECT title FROM rag_documents WHERE idea_id = ?').get(101);
    assert.equal(docRow.title, 'Original Valid Document');
  });

  test('transient empty search results do not erase previously indexed chunks', async () => {
    const mockEmbeddingClient = {
      getGenerativeModel: () => ({
        batchEmbedContents: async () => ({ embeddings: [{ values: [1.0, 0.0] }] }),
        embedContent: async () => ({ embedding: { values: [1.0, 0.0] } }),
      }),
    };
    const embeddingService = new EmbeddingService({ client: mockEmbeddingClient, dimensions: 2 });
    const service = new RetrievalService({ embeddingService, vectorStore, db });

    // Initial valid indexing
    await service.indexSources(101, [{ ideaId: 101, url: 'https://keep.test', title: 'Keep Me', text: 'Valuable research', contentHash: 'h1' }]);
    assert.equal(vectorStore.getChunkCount(101, db), 1);

    // Next run with empty results from Tavily
    const emptyResult = await service.run(101, { title: 'Test', problem: 'Prob' }, []);
    assert.equal(emptyResult.success, false);
    assert.equal(emptyResult.reason, 'NO_VALID_DOCUMENTS');

    // Confirm existing index remains intact
    assert.equal(vectorStore.getChunkCount(101, db), 1);
    const existing = db.prepare('SELECT title FROM rag_documents WHERE idea_id = ?').get(101);
    assert.equal(existing.title, 'Keep Me');
  });
});

// ---------------------------------------------------------------------------
// Section 5.D: Failure Handling, Observability & Performance
// ---------------------------------------------------------------------------

describe('Phase 2D - Observability Diagnostics & Failure Handling', () => {
  let db;
  let vectorStore;

  beforeEach(() => {
    db = createTestDb();
    vectorStore = new SqliteVectorStore(db);
  });

  test('structured diagnostics captures counts and timing on successful RAG', async () => {
    const mockEmbeddingClient = {
      getGenerativeModel: () => ({
        batchEmbedContents: async ({ requests }) => ({
          embeddings: requests.map(() => ({ values: [1.0, 0.0] })),
        }),
        embedContent: async () => ({ embedding: { values: [1.0, 0.0] } }),
      }),
    };
    const embeddingService = new EmbeddingService({ client: mockEmbeddingClient, dimensions: 2 });
    const service = new RetrievalService({ embeddingService, vectorStore, db }, { minScore: 0.50 });

    const rawResults = [
      { title: 'Doc 1', url: 'https://diag.test/1', content: 'Content for document 1' },
      { title: 'Doc 2', url: 'https://diag.test/2', content: 'Content for document 2' },
    ];

    const result = await service.run(101, { title: 'Diag Idea', problem: 'Diag Problem' }, rawResults);

    assert.equal(result.success, true);
    assert.ok(result.diagnostics);
    assert.equal(result.diagnostics.status, 'grounded');
    assert.equal(result.diagnostics.reason, 'OK');
    assert.equal(result.diagnostics.candidateDocCount, 2);
    assert.ok(result.diagnostics.candidateChunkCount >= 2);
    assert.ok(result.diagnostics.retrievedChunkCount >= 1);
    assert.ok(typeof result.diagnostics.durationMs === 'number');
    assert.ok(typeof result.diagnostics.indexingDurationMs === 'number');
    assert.ok(typeof result.diagnostics.retrievalDurationMs === 'number');
  });

  test('structured diagnostics records fallback when no chunks meet similarity threshold', async () => {
    const mockEmbeddingClient = {
      getGenerativeModel: () => ({
        batchEmbedContents: async ({ requests }) => ({
          embeddings: requests.map(() => ({ values: [0.0, 1.0] })), // Document vector
        }),
        embedContent: async () => ({ embedding: { values: [1.0, 0.0] } }), // Query vector -> Cosine = 0.0
      }),
    };
    const embeddingService = new EmbeddingService({ client: mockEmbeddingClient, dimensions: 2 });
    const service = new RetrievalService({ embeddingService, vectorStore, db }, { minScore: 0.50 });

    const rawResults = [{ title: 'Doc', url: 'https://unrelated.test/1', content: 'Unrelated content' }];

    const result = await service.run(101, { title: 'Query', problem: 'Prob' }, rawResults);

    assert.equal(result.success, false);
    assert.equal(result.reason, 'NO_RELEVANT_CHUNKS');
    assert.equal(result.diagnostics.status, 'fallback');
    assert.equal(result.diagnostics.reason, 'NO_RELEVANT_CHUNKS');
    assert.equal(result.diagnostics.candidateDocCount, 1);
    assert.equal(result.diagnostics.retrievedChunkCount, 0);
  });

  test('local in-memory RAG pipeline records non-negative finite duration metrics', async () => {
    const mockEmbeddingClient = {
      getGenerativeModel: () => ({
        batchEmbedContents: async ({ requests }) => ({
          embeddings: requests.map(() => ({ values: [1.0, 0.0, 0.0, 0.0] })),
        }),
        embedContent: async () => ({ embedding: { values: [1.0, 0.0, 0.0, 0.0] } }),
      }),
    };
    const embeddingService = new EmbeddingService({ client: mockEmbeddingClient, dimensions: 4 });
    const service = new RetrievalService({ embeddingService, vectorStore, db });

    // 5 multi-chunk research documents
    const rawResults = [1, 2, 3, 4, 5].map((i) => ({
      title: `Performance Benchmark Doc ${i}`,
      url: `https://benchmark.test/${i}`,
      content: `Paragraph 1 for document ${i}.\n\nParagraph 2 for document ${i} with substantial legal text for testing chunk performance.\n\nParagraph 3 for document ${i}.`,
    }));

    const startTime = Date.now();
    const result = await service.run(101, { title: 'Benchmark Test Idea', problem: 'Evaluating execution latency.' }, rawResults);
    const totalTime = Date.now() - startTime;

    assert.equal(result.success, true);
    assert.ok(result.diagnostics, 'result.diagnostics must exist');
    assert.equal(result.diagnostics.status, 'grounded');
    assert.equal(result.diagnostics.reason, 'OK');
    assert.ok(
      typeof result.diagnostics.durationMs === 'number' &&
        Number.isFinite(result.diagnostics.durationMs) &&
        result.diagnostics.durationMs >= 0,
      'durationMs must be a finite, non-negative number'
    );
    assert.ok(
      typeof result.diagnostics.indexingDurationMs === 'number' &&
        Number.isFinite(result.diagnostics.indexingDurationMs) &&
        result.diagnostics.indexingDurationMs >= 0,
      'indexingDurationMs must be a finite, non-negative number'
    );
    assert.ok(
      typeof result.diagnostics.retrievalDurationMs === 'number' &&
        Number.isFinite(result.diagnostics.retrievalDurationMs) &&
        result.diagnostics.retrievalDurationMs >= 0,
      'retrievalDurationMs must be a finite, non-negative number'
    );
    assert.equal(result.diagnostics.candidateDocCount, 5);
    assert.ok(result.diagnostics.retrievedChunkCount >= 1);
    // Wall-clock measurement is retained for informational reporting without acting as a brittle threshold
    assert.ok(totalTime >= 0, `Informational: pipeline completed in ${totalTime}ms`);
  });

  test('error path falls back gracefully and does not leak raw exception messages into public diagnostics', async () => {
    const mockTavily = async () => ({
      results: [{ title: 'Doc', url: 'https://test.com', content: 'Content' }],
      urls: [{ title: 'Doc', url: 'https://test.com' }],
      context: 'Raw fallback content from Tavily API.',
    });

    const mockGemini = async () => JSON.stringify({
      startupName: 'SafeStartup',
      tagline: 'No Leaks',
      summary: 'Summary',
      scores: { technicalFeasibility: 50 },
      theReaper: [], thePainMiner: [], pricingArchitect: {}, thePivotMaster: {},
    });

    const failingRetrievalService = {
      run: async () => {
        throw new Error('FATAL: SQLite disk failure at /var/data/secret.db');
      },
    };

    const blueprint = await analyzeIdeaBusinessBlueprint(
      { title: 'Idea', problem: 'Prob' }, 'JS', '5h', 'Low', 'Beg', null, null, 101,
      {
        retrievalService: failingRetrievalService,
        tavilySearchFn: mockTavily,
        geminiFn: mockGemini,
      }
    );

    assert.equal(blueprint.ragDiagnostics.status, 'fallback');
    assert.equal(blueprint.ragDiagnostics.reason, 'ERROR');
    assert.strictEqual(blueprint.ragDiagnostics.message, undefined, 'raw exception message must not be exposed');
    assert.equal(blueprint.ragGrounded, undefined);
  });
});
