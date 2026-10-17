/**
 * backend/services/rag/retrievalService.js
 *
 * RAG retrieval coordinator:
 * - Normalizes and deduplicates source records from external search (Tavily).
 * - Coordinates boundary-aware chunking, batch embedding, and transactional SQLite persistence.
 * - Embeds queries and performs scoped similarity retrieval over indexed chunks.
 * - Formats grounded evidence context for model prompts with clear citation markers.
 * - Provides safe fallback on empty, malformed, or failed retrieval operations.
 */

'use strict';

const defaultDb = require('../../db/database');
const { cleanText, chunkDocument, computeContentHash } = require('./chunkingService');
const { EmbeddingService } = require('./embeddingService');
const { SqliteVectorStore } = require('./sqliteVectorStore');

/**
 * Normalize and deduplicate raw search results from Tavily into structured source records.
 *
 * @param {Array<object>} rawResults - Raw search results array
 * @param {number|string} ideaId - Associated idea session ID
 * @returns {Array<object>} Normalized, deduplicated source documents
 */
function normalizeSourceRecords(rawResults, ideaId) {
  if (!Array.isArray(rawResults) || rawResults.length === 0) {
    return [];
  }

  const normalizedMap = new Map();

  for (const item of rawResults) {
    if (!item || typeof item !== 'object') continue;

    // Validate and normalize URL
    const rawUrl = typeof item.url === 'string' ? item.url.trim() : '';
    if (!rawUrl) continue;

    // Basic URL validation
    let normalizedUrl = rawUrl;
    try {
      const parsedUrl = new URL(rawUrl);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        continue;
      }
      // Strip trailing slash and URL hash for consistent deduplication
      parsedUrl.hash = '';
      normalizedUrl = parsedUrl.toString().replace(/\/$/, '');
    } catch {
      // If URL parsing fails, ignore invalid URL
      continue;
    }

    // Extract and clean content/text
    const rawText = item.content || item.text || item.snippet || '';
    const cleaned = cleanText(rawText);
    if (!cleaned) continue;

    // Extract title
    let title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title) {
      try {
        title = new URL(normalizedUrl).hostname;
      } catch {
        title = 'Untitled Source';
      }
    }

    const doc = {
      ideaId,
      url: normalizedUrl,
      title,
      text: cleaned,
      contentHash: computeContentHash(cleaned),
    };

    // Deduplicate by normalized URL: keep the record with richer content
    if (normalizedMap.has(normalizedUrl)) {
      const existing = normalizedMap.get(normalizedUrl);
      if (cleaned.length > existing.text.length) {
        normalizedMap.set(normalizedUrl, doc);
      }
    } else {
      normalizedMap.set(normalizedUrl, doc);
    }
  }

  return Array.from(normalizedMap.values());
}

/**
 * Format retrieved chunks into a clearly demarcated prompt context block.
 *
 * @param {Array<object>} retrievedChunks
 * @returns {string} Formatted context string
 */
function formatPromptContext(retrievedChunks) {
  if (!Array.isArray(retrievedChunks) || retrievedChunks.length === 0) {
    return '';
  }

  const sections = retrievedChunks.map((chunk, idx) => {
    const evidenceId = `EVIDENCE_${idx + 1}`;
    const scoreStr = typeof chunk.score === 'number' ? ` (Relevance Score: ${chunk.score.toFixed(3)})` : '';
    return `[${evidenceId}] "${chunk.title || 'Untitled'}"${scoreStr}\nSource URL: ${chunk.url}\nExcerpt: ${chunk.content}`;
  });

  return `\n\n=== RETRIEVED MARKET RESEARCH CONTEXT (VIA VECTOR SEARCH) ===\n${sections.join('\n\n')}\n`;
}

/**
 * Extract unique source list from retrieved chunks for citation display.
 *
 * @param {Array<object>} retrievedChunks
 * @returns {Array<{ title: string, url: string }>}
 */
function extractSourcesFromChunks(retrievedChunks) {
  if (!Array.isArray(retrievedChunks) || retrievedChunks.length === 0) {
    return [];
  }

  const sourcesMap = new Map();
  for (const chunk of retrievedChunks) {
    if (chunk.url && !sourcesMap.has(chunk.url)) {
      sourcesMap.set(chunk.url, {
        title: chunk.title || chunk.url,
        url: chunk.url,
      });
    }
  }

  return Array.from(sourcesMap.values());
}

class RetrievalService {
  /**
   * @param {object} [dependencies]
   * @param {object} [dependencies.embeddingService] - Injected or default EmbeddingService
   * @param {object} [dependencies.vectorStore] - Injected or default SqliteVectorStore
   * @param {object} [dependencies.db] - Optional SQLite db instance
   * @param {object} [options]
   * @param {number} [options.topK=5]
   * @param {number} [options.minScore=0.50]
   * @param {object} [options.chunkingOptions]
   */
  constructor(dependencies = {}, options = {}) {
    this.db = dependencies.db || defaultDb;
    this.embeddingService = dependencies.embeddingService || new EmbeddingService();
    this.vectorStore = dependencies.vectorStore || new SqliteVectorStore(this.db);
    this.topK = options.topK !== undefined ? options.topK : 5;
    this.minScore = options.minScore !== undefined ? options.minScore : 0.50;
    this.chunkingOptions = options.chunkingOptions || { chunkSize: 500, overlap: 100, minChunkSize: 40 };
  }

  /**
   * Chunk, embed, and transactionally index normalized documents into SQLite.
   *
   * @param {number|string} ideaId
   * @param {Array<object>} normalizedDocs
   * @returns {Promise<{ indexedDocCount: number, chunkCount: number, durationMs: number }>}
   */
  async indexSources(ideaId, normalizedDocs) {
    const startTime = Date.now();
    if (!ideaId) {
      throw new Error('indexSources: ideaId is required');
    }
    if (!Array.isArray(normalizedDocs) || normalizedDocs.length === 0) {
      return { indexedDocCount: 0, chunkCount: 0, durationMs: 0 };
    }

    // 1. Chunk documents while preserving source metadata
    const docChunkMap = [];
    const allChunksToEmbed = [];

    for (const doc of normalizedDocs) {
      const chunks = chunkDocument(doc, this.chunkingOptions);
      docChunkMap.push({ doc, chunks });
      for (const ch of chunks) {
        allChunksToEmbed.push(ch);
      }
    }

    if (allChunksToEmbed.length === 0) {
      return { indexedDocCount: 0, chunkCount: 0, durationMs: Date.now() - startTime };
    }

    // 2. Generate embeddings for all chunks in batches
    const embeddings = await this.embeddingService.embedChunks(allChunksToEmbed);

    if (embeddings.length !== allChunksToEmbed.length) {
      throw new Error(
        `Embedding count mismatch: expected ${allChunksToEmbed.length} embeddings, received ${embeddings.length}`
      );
    }

    // 3. Attach validated embeddings and metadata to chunk objects
    for (let i = 0; i < allChunksToEmbed.length; i++) {
      allChunksToEmbed[i].embedding = embeddings[i];
      allChunksToEmbed[i].modelName = this.embeddingService.modelName;
      allChunksToEmbed[i].dimensions = this.embeddingService.dimensions;
    }

    // 4. Construct documentsWithChunks structure for SqliteVectorStore
    const documentsWithChunks = docChunkMap.map(({ doc, chunks }) => ({
      url: doc.url,
      title: doc.title,
      contentHash: doc.contentHash,
      chunks,
    }));

    // 5. Transactionally replace index for this idea session
    this.vectorStore.replaceIdeaChunks(ideaId, documentsWithChunks, this.db);

    return {
      indexedDocCount: normalizedDocs.length,
      chunkCount: allChunksToEmbed.length,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Embed query and perform similarity retrieval over chunks for this idea session.
   *
   * @param {number|string} ideaId
   * @param {string} queryText
   * @param {object} [options]
   * @returns {Promise<{ retrievedChunks: Array<object>, sources: Array<object>, durationMs: number }>}
   */
  async retrieve(ideaId, queryText, options = {}) {
    const startTime = Date.now();
    if (!ideaId) {
      throw new Error('retrieve: ideaId is required');
    }
    const query = typeof queryText === 'string' ? queryText.trim() : '';
    if (!query) {
      return { retrievedChunks: [], sources: [], durationMs: 0 };
    }

    const topK = options.topK !== undefined ? options.topK : this.topK;
    const minScore = options.minScore !== undefined ? options.minScore : this.minScore;

    // 1. Embed retrieval query
    const queryVector = await this.embeddingService.embedQuery(query);

    // 2. Perform exact cosine similarity search
    const results = this.vectorStore.similaritySearch(
      ideaId,
      queryVector,
      {
        topK,
        minScore,
        modelName: this.embeddingService.modelName,
        dimensions: this.embeddingService.dimensions,
      },
      this.db
    );

    const retrievedChunks = results.map((r) => ({
      chunkId: r.id,
      documentId: r.documentId,
      ideaId: r.ideaId,
      chunkIndex: r.chunkIndex,
      totalChunks: r.totalChunks,
      content: r.content,
      title: r.title,
      url: r.url,
      score: r.score,
    }));

    const sources = extractSourcesFromChunks(retrievedChunks);

    return {
      retrievedChunks,
      sources,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Full pipeline: normalize → index → query embed → retrieve → format prompt context.
   *
   * @param {number|string} ideaId
   * @param {object} idea - Idea definition containing title and problem
   * @param {Array<object>} rawSearchResults - Raw results from Tavily
   * @param {object} [options]
   * @returns {Promise<object>} Pipeline result with structured diagnostics
   */
  async run(ideaId, idea, rawSearchResults, options = {}) {
    const startTime = Date.now();

    if (!ideaId) {
      return {
        success: false,
        reason: 'MISSING_IDEA_ID',
        retrievedChunks: [],
        sources: [],
        promptContext: '',
        diagnostics: {
          status: 'error',
          reason: 'MISSING_IDEA_ID',
          durationMs: Date.now() - startTime,
          candidateDocCount: 0,
          candidateChunkCount: 0,
          retrievedChunkCount: 0,
        },
      };
    }

    // 1. Normalize source records
    const normalizedDocs = normalizeSourceRecords(rawSearchResults, ideaId);
    if (normalizedDocs.length === 0) {
      return {
        success: false,
        reason: 'NO_VALID_DOCUMENTS',
        retrievedChunks: [],
        sources: [],
        promptContext: '',
        diagnostics: {
          status: 'empty',
          reason: 'NO_VALID_DOCUMENTS',
          durationMs: Date.now() - startTime,
          candidateDocCount: 0,
          candidateChunkCount: 0,
          retrievedChunkCount: 0,
        },
      };
    }

    // 2. Chunk, embed, and transactionally store
    const indexResult = await this.indexSources(ideaId, normalizedDocs);

    // 3. Build retrieval query from idea title and problem
    const queryParts = [idea.title, idea.problem].filter(Boolean);
    const queryText = queryParts.join(' ').trim() || 'startup problem market validation competitors';

    // 4. Retrieve matching chunks
    const { retrievedChunks, sources, durationMs: retrievalDurationMs } = await this.retrieve(ideaId, queryText, options);

    if (retrievedChunks.length === 0) {
      return {
        success: false,
        reason: 'NO_RELEVANT_CHUNKS',
        retrievedChunks: [],
        sources: [],
        promptContext: '',
        diagnostics: {
          status: 'fallback',
          reason: 'NO_RELEVANT_CHUNKS',
          durationMs: Date.now() - startTime,
          indexingDurationMs: indexResult.durationMs,
          retrievalDurationMs,
          candidateDocCount: normalizedDocs.length,
          candidateChunkCount: indexResult.chunkCount,
          retrievedChunkCount: 0,
        },
      };
    }

    // 5. Format prompt context
    const promptContext = formatPromptContext(retrievedChunks);

    return {
      success: true,
      reason: 'OK',
      retrievedChunks,
      sources,
      promptContext,
      queryText,
      ideaId,
      diagnostics: {
        status: 'grounded',
        reason: 'OK',
        durationMs: Date.now() - startTime,
        indexingDurationMs: indexResult.durationMs,
        retrievalDurationMs,
        candidateDocCount: normalizedDocs.length,
        candidateChunkCount: indexResult.chunkCount,
        retrievedChunkCount: retrievedChunks.length,
      },
    };
  }
}

module.exports = {
  RetrievalService,
  normalizeSourceRecords,
  formatPromptContext,
  extractSourcesFromChunks,
};
