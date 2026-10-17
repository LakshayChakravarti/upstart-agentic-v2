/**
 * backend/tests/rag/retrievalService.test.js
 *
 * Comprehensive unit and integration tests for Phase 2C RAG retrieval pipeline:
 * - Source record normalization and URL deduplication
 * - Chunking and embedding coordination
 * - Scoped similarity retrieval and SQLite isolation
 * - Blueprint prompt assembly with retrieved chunks
 * - Truthful fallback behavior on retrieval or provider failures
 * - Complete end-to-end evidence trace
 *
 * All external APIs (Tavily, Gemini) are mocked — isolated and fast.
 * Run with: node --test tests/rag/retrievalService.test.js
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
// Helpers and Mocks
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
    INSERT INTO ideas (id, user_id, domain, idea_data) VALUES (101, 1, 'Legal Tech', '[]');
    INSERT INTO ideas (id, user_id, domain, idea_data) VALUES (202, 1, 'Agri Tech', '[]');
  `);
  return db;
}

/**
 * Deterministic Mock Embedding Client with 4 dimensions:
 * - Text containing "target" or "nda" gets [1.0, 0.0, 0.0, 0.0]
 * - Unrelated text gets [0.0, 1.0, 0.0, 0.0]
 */
function createMockEmbeddingClient() {
  return {
    getGenerativeModel: () => ({
      batchEmbedContents: async ({ requests }) => ({
        embeddings: requests.map((req) => {
          const t = req.content.parts[0].text.toLowerCase();
          const vec = t.includes('target') || t.includes('nda') || t.includes('legal') || t.includes('indemnity')
            ? [1.0, 0.0, 0.0, 0.0]
            : [0.0, 1.0, 0.0, 0.0];
          return { values: vec };
        }),
      }),
      embedContent: async ({ content }) => {
        const t = content.parts[0].text.toLowerCase();
        const vec = t.includes('target') || t.includes('nda') || t.includes('legal') || t.includes('indemnity')
          ? [1.0, 0.0, 0.0, 0.0]
          : [0.0, 1.0, 0.0, 0.0];
        return { embedding: { values: vec } };
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Unit Tests: Source Normalization
// ---------------------------------------------------------------------------

describe('retrievalService - normalizeSourceRecords', () => {
  test('normalizes valid Tavily items and generates deterministic hashes', () => {
    const raw = [
      {
        title: 'Solo Lawyer Workflows',
        url: 'https://example.com/lawyers/guide/',
        content: '<p>Solo lawyers spend 40% of time reviewing boilerplate NDAs.</p>',
      },
    ];
    const docs = normalizeSourceRecords(raw, 101);
    assert.equal(docs.length, 1);
    assert.equal(docs[0].ideaId, 101);
    assert.equal(docs[0].url, 'https://example.com/lawyers/guide');
    assert.equal(docs[0].title, 'Solo Lawyer Workflows');
    assert.equal(docs[0].text, 'Solo lawyers spend 40% of time reviewing boilerplate NDAs.');
    assert.equal(docs[0].contentHash.length, 64);
  });

  test('safely filters out invalid, non-http, and empty records', () => {
    const raw = [
      null,
      {},
      { url: 'javascript:void(0)', content: 'Evil' },
      { url: 'ftp://bad.com', content: 'Unsupported protocol' },
      { url: 'not a valid url', content: 'Broken' },
      { url: 'https://example.com/empty', content: '   ' },
      { url: '', content: 'No URL' },
    ];
    const docs = normalizeSourceRecords(raw, 101);
    assert.deepEqual(docs, []);
  });

  test('deduplicates identical URLs by keeping the richer content', () => {
    const raw = [
      {
        title: 'Short snippet',
        url: 'https://example.com/feature#section1',
        content: 'Short content.',
      },
      {
        title: 'Detailed full text',
        url: 'https://example.com/feature#section2',
        content: 'This is much longer and richer content with extensive customer research data.',
      },
    ];
    const docs = normalizeSourceRecords(raw, 101);
    // Both point to normalized 'https://example.com/feature'
    assert.equal(docs.length, 1);
    assert.equal(docs[0].url, 'https://example.com/feature');
    assert.equal(docs[0].title, 'Detailed full text');
    assert.ok(docs[0].text.includes('much longer'));
  });
});

// ---------------------------------------------------------------------------
// Unit Tests: Chunking, Indexing, and Persistence
// ---------------------------------------------------------------------------

describe('retrievalService - Indexing & Isolation', () => {
  let db;
  let embeddingService;
  let vectorStore;
  let service;

  beforeEach(() => {
    db = createTestDb();
    embeddingService = new EmbeddingService({
      client: createMockEmbeddingClient(),
      dimensions: 4,
    });
    vectorStore = new SqliteVectorStore(db);
    service = new RetrievalService({ embeddingService, vectorStore, db });
  });

  test('indexes chunks and associates them with correct ideaId and docId', async () => {
    const docs = [
      {
        ideaId: 101,
        url: 'https://legal.ai/ndas',
        title: 'NDA Automation',
        text: 'Automated contract generation reduces legal review overhead significantly.',
        contentHash: 'hash1',
      },
    ];

    const result = await service.indexSources(101, docs);
    assert.equal(result.indexedDocCount, 1);
    assert.ok(result.chunkCount >= 1);

    // Verify database rows
    const docRow = db.prepare('SELECT * FROM rag_documents WHERE idea_id = ?').get(101);
    assert.ok(docRow);
    assert.equal(docRow.url, 'https://legal.ai/ndas');
    assert.equal(docRow.title, 'NDA Automation');

    const chunks = db.prepare('SELECT * FROM rag_chunks WHERE idea_id = ?').all(101);
    assert.equal(chunks.length, result.chunkCount);
    assert.equal(chunks[0].document_id, docRow.id);
    assert.equal(chunks[0].dimensions, 4);
    assert.equal(chunks[0].embedding_blob.length, 4 * 4);
  });

  test('re-indexing replaces stale chunks without accumulating duplicates', async () => {
    const v1Docs = [
      {
        ideaId: 101,
        url: 'https://legal.ai/ndas',
        title: 'V1 Title',
        text: 'First version text that produces a chunk.',
        contentHash: 'v1hash',
      },
    ];
    await service.indexSources(101, v1Docs);
    const initialCount = vectorStore.getChunkCount(101, db);
    assert.equal(initialCount, 1);

    const v2Docs = [
      {
        ideaId: 101,
        url: 'https://legal.ai/ndas',
        title: 'V2 Title (Updated)',
        text: 'Second updated version text with new content.',
        contentHash: 'v2hash',
      },
    ];
    await service.indexSources(101, v2Docs);

    // Count should remain 1 (not 2)
    const updatedCount = vectorStore.getChunkCount(101, db);
    assert.equal(updatedCount, 1);

    const docRow = db.prepare('SELECT title FROM rag_documents WHERE idea_id = ?').get(101);
    assert.equal(docRow.title, 'V2 Title (Updated)');
  });

  test('keeps different idea IDs completely isolated', async () => {
    const idea1Docs = [
      { ideaId: 101, url: 'https://legal.ai', title: 'Legal', text: 'Target legal clause automation.', contentHash: 'h1' },
    ];
    const idea2Docs = [
      { ideaId: 202, url: 'https://agri.ai', title: 'Agri', text: 'Target crop rotation monitoring.', contentHash: 'h2' },
    ];

    await service.indexSources(101, idea1Docs);
    await service.indexSources(202, idea2Docs);

    assert.equal(vectorStore.getChunkCount(101, db), 1);
    assert.equal(vectorStore.getChunkCount(202, db), 1);

    // Searching idea 101 only returns idea 101 chunks
    const res1 = await service.retrieve(101, 'target legal');
    assert.equal(res1.retrievedChunks.length, 1);
    assert.equal(res1.retrievedChunks[0].ideaId, 101);
    assert.equal(res1.retrievedChunks[0].title, 'Legal');

    // Deleting idea 101 leaves idea 202 untouched
    vectorStore.deleteIdeaChunks(101, db);
    assert.equal(vectorStore.getChunkCount(101, db), 0);
    assert.equal(vectorStore.getChunkCount(202, db), 1);
  });
});

// ---------------------------------------------------------------------------
// Unit Tests: Similarity Retrieval and Empty Results
// ---------------------------------------------------------------------------

describe('retrievalService - Similarity Retrieval', () => {
  let db;
  let embeddingService;
  let vectorStore;
  let service;

  beforeEach(() => {
    db = createTestDb();
    embeddingService = new EmbeddingService({
      client: createMockEmbeddingClient(),
      dimensions: 4,
    });
    vectorStore = new SqliteVectorStore(db);
    service = new RetrievalService({ embeddingService, vectorStore, db }, { minScore: 0.8 });
  });

  test('retrieves relevant matching chunks and ignores non-matching chunks', async () => {
    const docs = [
      {
        ideaId: 101,
        url: 'https://relevant.com',
        title: 'Target Relevant Document',
        text: 'This is the target matching document for NDA analysis.',
        contentHash: 'hashA',
      },
      {
        ideaId: 101,
        url: 'https://unrelated.com',
        title: 'Unrelated Weather Document',
        text: 'Weather forecasting in coastal zones.',
        contentHash: 'hashB',
      },
    ];

    await service.indexSources(101, docs);

    // Query targeting "target NDA" (yields vector [1,0,0,0])
    const { retrievedChunks, sources } = await service.retrieve(101, 'target nda review');

    // Only the relevant document should match with similarity >= 0.8
    assert.equal(retrievedChunks.length, 1);
    assert.equal(retrievedChunks[0].title, 'Target Relevant Document');
    assert.equal(retrievedChunks[0].url, 'https://relevant.com');
    assert.ok(retrievedChunks[0].score >= 0.99);

    // sources should contain only the relevant source
    assert.equal(sources.length, 1);
    assert.equal(sources[0].url, 'https://relevant.com');
  });

  test('truthfully returns empty when no chunks exceed minScore', async () => {
    const docs = [
      {
        ideaId: 101,
        url: 'https://other.com',
        title: 'Other',
        text: 'Weather forecasting in coastal zones.', // vector [0,1,0,0]
        contentHash: 'hashO',
      },
    ];
    await service.indexSources(101, docs);

    // Query generates [1,0,0,0], similarity against [0,1,0,0] is 0.0 < 0.8
    const { retrievedChunks, sources } = await service.retrieve(101, 'target nda');
    assert.deepEqual(retrievedChunks, []);
    assert.deepEqual(sources, []);
  });
});

// ---------------------------------------------------------------------------
// Integration Tests: Blueprint Generation with RAG
// ---------------------------------------------------------------------------

describe('analyzeIdeaBusinessBlueprint - RAG Integration & Fallback', () => {
  let db;
  let embeddingService;
  let vectorStore;
  let retrievalService;

  beforeEach(() => {
    db = createTestDb();
    embeddingService = new EmbeddingService({
      client: createMockEmbeddingClient(),
      dimensions: 4,
    });
    vectorStore = new SqliteVectorStore(db);
    retrievalService = new RetrievalService({ embeddingService, vectorStore, db }, { minScore: 0.5 });
  });

  test('injects retrieved chunk into Gemini prompt and returns matching researchSources', async () => {
    let capturedPrompt = '';

    const mockTavily = async () => ({
      results: [
        {
          title: 'Solo Legal Pain Report',
          url: 'https://legaltech.org/pain-points',
          content: 'Target solo attorneys report 15 hours wasted weekly on manual indemnity clause review.',
        },
      ],
      urls: [{ title: 'Solo Legal Pain Report', url: 'https://legaltech.org/pain-points' }],
      context: 'Raw fallback text',
    });

    const mockGemini = async (prompt) => {
      capturedPrompt = prompt;
      return JSON.stringify({
        startupName: 'ClauseFlow',
        tagline: 'Automated Indemnity Clauses',
        summary: 'A workflow tool for solo attorneys.',
        scores: { technicalFeasibility: 85, marketReadiness: 75, regulatoryRisk: 40, competitiveAdvantage: 80, executionComplexity: 60, scoreRationale: 'Strong market demand.' },
        theReaper: [{ point: 'Bar regulations might require manual attorney signoff.' }],
        thePainMiner: [{ frustration: '15 hours wasted weekly on manual clause reviews.' }],
        pricingArchitect: {
          starter: { price: '$49/mo', features: ['Standard templates'] },
          pro: { price: '$149/mo', features: ['AI indemnity generation'] },
          enterprise: { price: '$499/mo', features: ['Custom risk rules'] },
        },
        thePivotMaster: { winningEdge: 'Direct integration with Clio and MS Word.' },
      });
    };

    const idea = {
      title: 'Target Clause Drafter',
      problem: 'Solo attorneys waste too much time reviewing contracts.',
      solution: 'Automated clause extraction tool.',
    };

    const blueprint = await analyzeIdeaBusinessBlueprint(
      idea,
      'Node.js, React',
      '10 hrs/wk',
      'Low',
      'Intermediate',
      null,
      null,
      101, // Authenticated ideaSessionId
      {
        retrievalService,
        tavilySearchFn: mockTavily,
        geminiFn: mockGemini,
      }
    );

    // 1. Verify RAG prompt grounding
    assert.ok(capturedPrompt.includes('RETRIEVED MARKET RESEARCH CONTEXT (VIA VECTOR SEARCH)'));
    assert.ok(capturedPrompt.includes('15 hours wasted weekly on manual indemnity clause review'));
    assert.ok(!capturedPrompt.includes('Raw fallback text'), 'Should not use raw Tavily context when RAG succeeds');

    // 2. Verify returned researchSources
    assert.equal(blueprint.researchSources.length, 1);
    assert.equal(blueprint.researchSources[0].url, 'https://legaltech.org/pain-points');
    assert.equal(blueprint.researchSources[0].title, 'Solo Legal Pain Report');
    assert.equal(blueprint.ragGrounded, true);
  });

  test('gracefully falls back to raw Tavily context when embedding service throws', async () => {
    let capturedPrompt = '';

    const failingEmbeddingService = {
      modelName: 'gemini-embedding-001',
      dimensions: 4,
      embedChunks: async () => {
        throw new Error('Gemini API quota exhausted [429]');
      },
      embedQuery: async () => {
        throw new Error('Gemini API quota exhausted [429]');
      },
    };

    const failingRetrievalService = new RetrievalService({
      embeddingService: failingEmbeddingService,
      vectorStore,
      db,
    });

    const mockTavily = async () => ({
      results: [{ title: 'Doc', url: 'https://test.com', content: 'Some content' }],
      urls: [{ title: 'Doc', url: 'https://test.com' }],
      context: 'Raw fallback content from Tavily API.',
    });

    const mockGemini = async (prompt) => {
      capturedPrompt = prompt;
      return JSON.stringify({
        startupName: 'FallbackStartup',
        tagline: 'Still Works',
        summary: 'Summary.',
        scores: { technicalFeasibility: 50 },
        theReaper: [], thePainMiner: [], pricingArchitect: {}, thePivotMaster: {},
      });
    };

    const idea = { title: 'Target Idea', problem: 'Problem' };

    const blueprint = await analyzeIdeaBusinessBlueprint(
      idea, 'JS', '5h', 'Low', 'Beg', null, null, 101,
      {
        retrievalService: failingRetrievalService,
        tavilySearchFn: mockTavily,
        geminiFn: mockGemini,
      }
    );

    // Must not crash! Prompt should contain the fallback text
    assert.ok(capturedPrompt.includes('TAVILY RESEARCH CONTEXT (FALLBACK)'));
    assert.ok(capturedPrompt.includes('Raw fallback content from Tavily API'));
    assert.equal(blueprint.researchSources.length, 1);
    assert.equal(blueprint.researchSources[0].url, 'https://test.com');
  });

  test('handles empty Tavily search results without crashing', async () => {
    let capturedPrompt = '';

    const mockTavily = async () => ({
      results: [],
      urls: [],
      context: '',
    });

    const mockGemini = async (prompt) => {
      capturedPrompt = prompt;
      return JSON.stringify({
        startupName: 'OfflineCo',
        tagline: 'Offline',
        summary: 'Summary.',
        scores: {}, theReaper: [], thePainMiner: [], pricingArchitect: {}, thePivotMaster: {},
      });
    };

    const blueprint = await analyzeIdeaBusinessBlueprint(
      { title: 'Idea', problem: 'Prob' },
      'JS', '5h', 'Low', 'Beg', null, null, 101,
      {
        retrievalService,
        tavilySearchFn: mockTavily,
        geminiFn: mockGemini,
      }
    );

    assert.ok(capturedPrompt.includes('No external market research context is available'));
    assert.deepEqual(blueprint.researchSources, []);
  });

  test('gracefully falls back to raw Tavily context when similarity search throws', async () => {
    let capturedPrompt = '';

    const failingVectorStore = {
      similaritySearch: () => {
        throw new Error('SQLite database disk I/O error');
      },
      replaceIdeaChunks: () => {},
    };

    const failingRetrievalService = new RetrievalService({
      embeddingService,
      vectorStore: failingVectorStore,
      db,
    });

    const mockTavily = async () => ({
      results: [{ title: 'Doc', url: 'https://test.com', content: 'Some content' }],
      urls: [{ title: 'Doc', url: 'https://test.com' }],
      context: 'Raw fallback content from Tavily API.',
    });

    const mockGemini = async (prompt) => {
      capturedPrompt = prompt;
      return JSON.stringify({
        startupName: 'FallbackStartup2',
        tagline: 'Still Works',
        summary: 'Summary.',
        scores: { technicalFeasibility: 50 },
        theReaper: [], thePainMiner: [], pricingArchitect: {}, thePivotMaster: {},
      });
    };

    const idea = { title: 'Target Idea', problem: 'Problem' };

    const blueprint = await analyzeIdeaBusinessBlueprint(
      idea, 'JS', '5h', 'Low', 'Beg', null, null, 101,
      {
        retrievalService: failingRetrievalService,
        tavilySearchFn: mockTavily,
        geminiFn: mockGemini,
      }
    );

    assert.ok(capturedPrompt.includes('TAVILY RESEARCH CONTEXT (FALLBACK)'));
    assert.equal(blueprint.researchSources[0].url, 'https://test.com');
  });

  test('failed re-indexing operation does not wipe out previously indexed chunks', async () => {
    // 1. Initially index valid documents
    const initialDocs = [
      {
        ideaId: 101,
        url: 'https://initial.com',
        title: 'Initial Good Doc',
        text: 'Initial good text.',
        contentHash: 'hashInit',
      },
    ];
    await retrievalService.indexSources(101, initialDocs);
    assert.equal(vectorStore.getChunkCount(101, db), 1);

    // 2. Attempt to index a batch where embeddingService fails
    const failingEmbedding = {
      modelName: 'gemini-embedding-001',
      dimensions: 4,
      embedChunks: async () => {
        throw new Error('Embedding network timeout');
      },
    };
    const brokenService = new RetrievalService({
      embeddingService: failingEmbedding,
      vectorStore,
      db,
    });

    const badDocs = [
      {
        ideaId: 101,
        url: 'https://bad.com',
        title: 'Bad Doc',
        text: 'Bad doc text.',
        contentHash: 'hashBad',
      },
    ];

    await assert.rejects(
      () => brokenService.indexSources(101, badDocs),
      /Embedding network timeout/
    );

    // Verify initial chunk is still present and intact!
    assert.equal(vectorStore.getChunkCount(101, db), 1);
    const existingDoc = db.prepare('SELECT title FROM rag_documents WHERE idea_id = ?').get(101);
    assert.equal(existingDoc.title, 'Initial Good Doc');
  });

  test('formulates query embedding from intended idea title and problem', async () => {
    let capturedQuery = '';
    const spyEmbeddingService = {
      modelName: 'gemini-embedding-001',
      dimensions: 4,
      embedChunks: async (chunks) => chunks.map(() => new Float32Array([1, 0, 0, 0])),
      embedQuery: async (q) => {
        capturedQuery = q;
        return new Float32Array([1, 0, 0, 0]);
      },
    };

    const spyService = new RetrievalService({
      embeddingService: spyEmbeddingService,
      vectorStore,
      db,
    });

    const idea = {
      title: 'Solo Legal Automator',
      problem: 'High costs of manual drafting.',
    };

    const rawResults = [
      {
        title: 'Test',
        url: 'https://test.com',
        content: 'Content about legal automation.',
      },
    ];

    await spyService.run(101, idea, rawResults);
    assert.equal(capturedQuery, 'Solo Legal Automator High costs of manual drafting.');
  });

  test('analysis route in ideaRoutes passes verified ideaSessionId to analyzeIdeaBusinessBlueprint', () => {
    const fs = require('fs');
    const path = require('path');
    const routeSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'ideaRoutes.js'), 'utf8');

    // Ensure analyzeIdeaBusinessBlueprint is invoked with ideaSessionId
    const match = routeSrc.match(/analyzeIdeaBusinessBlueprint\s*\([\s\S]*?\)/);
    assert.ok(match, 'analyzeIdeaBusinessBlueprint call must exist in ideaRoutes.js');
    assert.ok(
      match[0].includes('ideaSessionId'),
      'analyzeIdeaBusinessBlueprint call must pass ideaSessionId as argument'
    );
  });
});

// ---------------------------------------------------------------------------
// End-to-End Deterministic Evidence Trace (Section 9)
// ---------------------------------------------------------------------------

describe('End-to-End Deterministic Evidence Trace', () => {
  test('traces identifiable source through the entire RAG pipeline into prompt and researchSources', async () => {
    const db = createTestDb();
    const embeddingService = new EmbeddingService({
      client: createMockEmbeddingClient(),
      dimensions: 4,
    });
    const vectorStore = new SqliteVectorStore(db);
    const retrievalService = new RetrievalService({ embeddingService, vectorStore, db }, { minScore: 0.5 });

    // Distinctive traceable tokens
    const TRACE_ID = 101;
    const TRACE_TITLE = 'Unique Case Law Database Analysis 2026';
    const TRACE_URL = 'https://legal-evidence-trace.org/findings';
    const TRACE_SENTENCE = 'Solo litigators spend 38.5 hours per case reconstructing broken indemnity chains.';

    const UNRELATED_TITLE = 'Global Fertilizer Pricing Outlook';
    const UNRELATED_URL = 'https://fertilizer-daily.com/report';
    const UNRELATED_SENTENCE = 'Potash deliveries were delayed by maritime canal congestion.';

    let capturedGeminiPrompt = '';

    const mockTavilyResults = [
      {
        title: TRACE_TITLE,
        url: TRACE_URL,
        content: TRACE_SENTENCE,
      },
      {
        title: UNRELATED_TITLE,
        url: UNRELATED_URL,
        content: UNRELATED_SENTENCE,
      },
    ];

    const mockTavily = async () => ({
      results: mockTavilyResults,
      urls: mockTavilyResults.map((r) => ({ title: r.title, url: r.url })),
      context: 'Raw combined context',
    });

    const mockGemini = async (prompt) => {
      capturedGeminiPrompt = prompt;
      return JSON.stringify({
        startupName: 'IndemniChain',
        tagline: 'Fixing Broken Chains',
        summary: 'Automated indemnity chain reconstructor.',
        scores: { technicalFeasibility: 80 },
        theReaper: [], thePainMiner: [], pricingArchitect: {}, thePivotMaster: {},
      });
    };

    const idea = {
      title: 'Target Indemnity Chain Verifier',
      problem: 'Broken indemnity chains in solo litigation.',
      solution: 'Automated chain verification graph.',
    };

    // Execute the complete unified blueprint generation path
    const blueprint = await analyzeIdeaBusinessBlueprint(
      idea, 'TypeScript, SQLite', '15h/wk', 'Medium', 'Expert', null, null, TRACE_ID,
      {
        retrievalService,
        tavilySearchFn: mockTavily,
        geminiFn: mockGemini,
      }
    );

    // TRACE STAGE 1: Normalized source in SQLite rag_documents
    const docRow = db.prepare('SELECT * FROM rag_documents WHERE idea_id = ? AND url = ?').get(TRACE_ID, TRACE_URL);
    assert.ok(docRow, 'Stage 1 Failed: Trace document was not indexed in rag_documents');
    assert.equal(docRow.title, TRACE_TITLE);

    // TRACE STAGE 2: Chunk in SQLite rag_chunks
    const chunkRow = db.prepare('SELECT * FROM rag_chunks WHERE idea_id = ? AND document_id = ?').get(TRACE_ID, docRow.id);
    assert.ok(chunkRow, 'Stage 2 Failed: Trace chunk was not indexed in rag_chunks');
    assert.ok(chunkRow.content.includes(TRACE_SENTENCE), 'Stage 2 Failed: Chunk content does not match source sentence');

    // TRACE STAGE 3: Final Gemini Prompt Grounding
    assert.ok(
      capturedGeminiPrompt.includes(TRACE_SENTENCE),
      'Stage 3 Failed: Gemini prompt did not receive the retrieved chunk sentence'
    );
    assert.ok(
      capturedGeminiPrompt.includes(TRACE_URL),
      'Stage 3 Failed: Gemini prompt did not contain the retrieved source URL'
    );
    assert.ok(
      !capturedGeminiPrompt.includes(UNRELATED_SENTENCE),
      'Stage 3 Failed: Unrelated document was incorrectly included in the RAG prompt'
    );

    // TRACE STAGE 4: Returned researchSources Output
    assert.equal(blueprint.researchSources.length, 1, 'Stage 4 Failed: Expected exactly 1 retrieved source in researchSources');
    assert.equal(blueprint.researchSources[0].url, TRACE_URL);
    assert.equal(blueprint.researchSources[0].title, TRACE_TITLE);
    assert.equal(blueprint.ragGrounded, true);
  });
});
