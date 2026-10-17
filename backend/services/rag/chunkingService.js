/**
 * backend/services/rag/chunkingService.js
 *
 * Text normalization, content hashing, and recursive overlapping chunking
 * with full source metadata preservation. Guarantees zero dropped text,
 * strictly bounded chunk sizes (<= chunkSize), and monotonic forward progress.
 */

'use strict';

const crypto = require('crypto');

/**
 * Compute a SHA-256 hex hash of the given string.
 * @param {string} text
 * @returns {string} 64-char hex string
 */
function computeContentHash(text) {
  if (typeof text !== 'string') return '';
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Clean and normalize raw text:
 * - Strips script and style blocks
 * - Strips HTML tags and decodes common entities
 * - Normalizes carriage returns and trims line whitespace
 * @param {string} rawText
 * @returns {string} Cleaned plain text
 */
function cleanText(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';

  let cleaned = rawText
    // Remove script and style elements entirely
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    // Strip HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Normalize newlines
    .replace(/\r\n|\r/g, '\n')
    // Trim leading/trailing spaces per line
    .replace(/^[^\S\n]+/gm, '')
    .replace(/[^\S\n]+$/gm, '')
    // Collapse horizontal whitespace (spaces/tabs) to a single space
    .replace(/[^\S\n]+/g, ' ')
    // Collapse 3 or more consecutive newlines to 2 newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned;
}

/**
 * Split a document into overlapping chunks while preserving source metadata.
 *
 * Invariants Guaranteed:
 * - Length bound: Every chunk's content length is strictly <= chunkSize.
 * - Zero loss: Every character from start to end of cleaned text is captured.
 * - Monotonic progress: Each iteration strictly advances, preventing infinite loops.
 * - Boundary awareness: Favors paragraph, sentence, and word breaks within the overlap zone.
 *
 * @param {object} doc - Document object
 * @param {string} doc.url - Source URL
 * @param {string} [doc.title] - Document title
 * @param {string} doc.text - Raw or cleaned document text
 * @param {number|string} [doc.ideaId] - Associated idea session ID
 * @param {object} [options]
 * @param {number} [options.chunkSize=500] - Maximum chunk length in characters
 * @param {number} [options.overlap=100] - Target overlap length in characters
 * @param {number} [options.minChunkSize=40] - Minimum chunk size for standalone chunks
 * @returns {Array<object>} Array of chunk objects with complete metadata
 */
function chunkDocument(doc, options = {}) {
  if (!doc || !doc.text) return [];

  const chunkSize = options.chunkSize || 500;
  const overlap = options.overlap !== undefined ? options.overlap : 100;
  const minChunkSize = options.minChunkSize !== undefined ? options.minChunkSize : 40;

  if (overlap >= chunkSize) {
    throw new Error(`Overlap (${overlap}) must be strictly less than chunkSize (${chunkSize})`);
  }

  const cleaned = cleanText(doc.text);
  if (!cleaned) return [];

  // Short document fits within a single chunk
  if (cleaned.length <= chunkSize) {
    return [
      {
        chunkIndex: 0,
        totalChunks: 1,
        content: cleaned,
        url: doc.url || '',
        title: doc.title || 'Untitled',
        ideaId: doc.ideaId || null,
        charCount: cleaned.length,
        contentHash: computeContentHash(cleaned),
      },
    ];
  }

  const rawChunks = [];
  let start = 0;
  const textLen = cleaned.length;

  while (start < textLen) {
    // If the remainder of the document fits in chunkSize, form final chunk and finish
    if (textLen - start <= chunkSize) {
      const remainingChunk = cleaned.substring(start, textLen).trim();
      if (remainingChunk.length >= minChunkSize || rawChunks.length === 0) {
        if (remainingChunk.length > 0) {
          rawChunks.push(remainingChunk);
        }
      } else {
        // Remaining tail is shorter than minChunkSize.
        // Construct the final chunk by taking the last chunkSize characters of the document
        // so that all tail content is preserved without violating the maximum chunkSize.
        const finalStart = Math.max(0, textLen - chunkSize);
        const finalChunk = cleaned.substring(finalStart, textLen).trim();
        if (rawChunks[rawChunks.length - 1] !== finalChunk) {
          rawChunks.push(finalChunk);
        }
      }
      break;
    }

    let targetEnd = start + chunkSize;

    // Search backward from targetEnd within the overlap window for natural boundaries
    const searchWindowStart = Math.max(start, targetEnd - overlap);
    const windowText = cleaned.substring(searchWindowStart, targetEnd);

    // 1. Paragraph break (\n\n)
    const lastPara = windowText.lastIndexOf('\n\n');
    if (lastPara !== -1) {
      targetEnd = searchWindowStart + lastPara + 2;
    } else {
      // 2. Sentence boundary (. ! ? followed by space or newline)
      const sentenceMatches = [...windowText.matchAll(/[.!?](?:\s+|$)/g)];
      if (sentenceMatches.length > 0) {
        const lastSentence = sentenceMatches[sentenceMatches.length - 1];
        targetEnd = searchWindowStart + lastSentence.index + lastSentence[0].length;
      } else {
        // 3. Line break (\n)
        const lastLine = windowText.lastIndexOf('\n');
        if (lastLine !== -1) {
          targetEnd = searchWindowStart + lastLine + 1;
        } else {
          // 4. Word boundary (whitespace)
          const lastSpace = windowText.lastIndexOf(' ');
          if (lastSpace !== -1) {
            targetEnd = searchWindowStart + lastSpace + 1;
          }
          // 5. Unbroken text: cuts hard at targetEnd (guarantees chunk length <= chunkSize)
        }
      }
    }

    // Guard: targetEnd must strictly advance past start
    if (targetEnd <= start) {
      targetEnd = Math.min(start + chunkSize, textLen);
    }

    const chunkContent = cleaned.substring(start, targetEnd).trim();
    if (chunkContent.length > 0) {
      rawChunks.push(chunkContent);
    }

    // Step forward: start of next chunk is targetEnd minus overlap
    const nextStart = targetEnd - overlap;
    if (nextStart <= start) {
      // Hard forward progress if overlap did not advance past start
      start = targetEnd;
    } else {
      start = nextStart;
    }
  }

  // Fallback guard
  if (rawChunks.length === 0 && cleaned.length > 0) {
    rawChunks.push(cleaned);
  }

  const total = rawChunks.length;
  return rawChunks.map((content, idx) => ({
    chunkIndex: idx,
    totalChunks: total,
    content,
    url: doc.url || '',
    title: doc.title || 'Untitled',
    ideaId: doc.ideaId || null,
    charCount: content.length,
    contentHash: computeContentHash(content),
  }));
}

module.exports = {
  cleanText,
  chunkDocument,
  computeContentHash,
};
