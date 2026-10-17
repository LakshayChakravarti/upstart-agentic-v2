/**
 * backend/tests/rag/chunkingService.test.js
 *
 * Comprehensive unit tests for text cleaning, content hashing,
 * overlapping chunking, boundary detection, and edge cases.
 * Run with: node --test tests/rag/chunkingService.test.js
 */

'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

const {
  cleanText,
  chunkDocument,
  computeContentHash,
} = require('../../services/rag/chunkingService');

describe('chunkingService - cleanText', () => {
  test('returns empty string for null, undefined, or non-string input', () => {
    assert.equal(cleanText(null), '');
    assert.equal(cleanText(undefined), '');
    assert.equal(cleanText(''), '');
    assert.equal(cleanText(123), '');
  });

  test('strips HTML tags and decodes common entities', () => {
    const raw = '<p>Hello <strong>World</strong> &amp; friends &lt;3</p>';
    const cleaned = cleanText(raw);
    assert.equal(cleaned, 'Hello World & friends <3');
  });

  test('strips script and style blocks entirely', () => {
    const raw = `
      <html>
        <head>
          <style>body { color: red; }</style>
          <script>alert("evil");</script>
        </head>
        <body>Real content here</body>
      </html>
    `;
    const cleaned = cleanText(raw);
    assert.equal(cleaned, 'Real content here');
  });

  test('normalizes line breaks and collapses excess whitespace', () => {
    const raw = 'Paragraph 1\r\n\r\n\r\n\r\n   Paragraph 2\twith   extra   spaces';
    const cleaned = cleanText(raw);
    assert.equal(cleaned, 'Paragraph 1\n\nParagraph 2 with extra spaces');
  });
});

describe('chunkingService - computeContentHash', () => {
  test('produces consistent SHA-256 hex string', () => {
    const hash1 = computeContentHash('Sample legal content');
    const hash2 = computeContentHash('Sample legal content');
    const hash3 = computeContentHash('Different content');
    assert.equal(hash1, hash2);
    assert.notEqual(hash1, hash3);
    assert.equal(hash1.length, 64);
  });

  test('handles empty and non-string inputs safely', () => {
    assert.equal(computeContentHash(null), '');
    assert.equal(computeContentHash(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('chunkingService - chunkDocument core behaviors', () => {
  test('returns empty array when document or text is missing', () => {
    assert.deepEqual(chunkDocument(null), []);
    assert.deepEqual(chunkDocument({}), []);
    assert.deepEqual(chunkDocument({ text: '' }), []);
    assert.deepEqual(chunkDocument({ text: '    ' }), []);
  });

  test('throws when overlap is >= chunkSize', () => {
    assert.throws(
      () => chunkDocument({ text: 'Some text' }, { chunkSize: 100, overlap: 100 }),
      /Overlap.*must be strictly less than chunkSize/
    );
  });

  test('returns a single chunk when text is shorter than chunkSize', () => {
    const doc = {
      url: 'https://example.com/law',
      title: 'Legal Tech Brief',
      text: 'AI clause drafting platforms reduce boilerplate review time for solos.',
      ideaId: 42,
    };
    const chunks = chunkDocument(doc, { chunkSize: 200, overlap: 50 });
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].chunkIndex, 0);
    assert.equal(chunks[0].totalChunks, 1);
    assert.equal(chunks[0].url, 'https://example.com/law');
    assert.equal(chunks[0].title, 'Legal Tech Brief');
    assert.equal(chunks[0].ideaId, 42);
    assert.equal(chunks[0].charCount, chunks[0].content.length);
    assert.ok(chunks[0].contentHash);
  });
});

describe('chunkingService - boundary, overlap & edge-case hardening', () => {
  test('verifies adjacent-chunk overlap contains shared text', () => {
    const text = [
      'The primary obstacle for solo practitioners is drafting complex indemnity clauses.',
      'Existing boilerplate templates lack context-specific indemnification provisions.',
      'Automated clause generation tools bridge this capability gap effectively.',
      'Pricing must remain accessible to individual attorneys at under $99 per month.',
    ].join(' ');

    const chunks = chunkDocument({ text }, { chunkSize: 140, overlap: 40, minChunkSize: 20 });
    assert.ok(chunks.length >= 2, `Expected multiple chunks, got ${chunks.length}`);

    // Verify consecutive chunks share overlapping tokens
    for (let i = 0; i < chunks.length - 1; i++) {
      const current = chunks[i].content;
      const next = chunks[i + 1].content;

      // Extract last 20 characters of current chunk
      const tailWords = current.split(/\s+/).slice(-3).join(' ');
      const headWords = next.split(/\s+/).slice(0, 3).join(' ');

      // There must be lexical overlap between current and next
      const sharesTokens = current.split(/\s+/).some((w) => w.length > 4 && next.includes(w));
      assert.ok(
        sharesTokens,
        `Expected overlap between chunk ${i} and ${i + 1}.\nChunk ${i}: "${current}"\nChunk ${i + 1}: "${next}"`
      );
    }
  });

  test('handles very long continuous word without spaces without looping or hanging', () => {
    const longWord = 'A'.repeat(600);
    const text = `Start of text ${longWord} end of text`;
    const chunks = chunkDocument({ text }, { chunkSize: 150, overlap: 30 });
    assert.ok(chunks.length >= 4);

    // Monotonic chunk indexing
    chunks.forEach((c, idx) => {
      assert.equal(c.chunkIndex, idx);
      assert.equal(c.totalChunks, chunks.length);
    });
  });

  test('prevents dropped text by merging short final chunks into previous chunk', () => {
    // 100 chars + 15 chars tail
    const mainBody = 'This is the main body of legal research that comfortably exceeds the minimum chunk size boundary.';
    const shortTail = 'Short tail text';
    const text = `${mainBody} ${shortTail}`;

    const chunks = chunkDocument({ text }, { chunkSize: 100, overlap: 20, minChunkSize: 30 });
    const combined = chunks.map((c) => c.content).join(' ');
    // Assert short tail was NOT dropped
    assert.ok(combined.includes('Short tail text'), 'Short final tail text was dropped!');
  });

  test('splits on paragraph boundaries first before sentence or word cuts', () => {
    const para1 = 'First paragraph discusses customer retention and complaints in SMB legal firms.';
    const para2 = 'Second paragraph evaluates competitor pricing benchmarks across three tiers.';
    const text = `${para1}\n\n${para2}`;

    const chunks = chunkDocument({ text }, { chunkSize: para1.length + 20, overlap: 30 });
    assert.ok(chunks.length >= 2);
    assert.ok(chunks[0].content.includes('customer retention'));
    assert.ok(chunks[1].content.includes('competitor pricing'));
  });

  test('ensures no chunk exceeds reasonable maximum length', () => {
    const text = 'Word '.repeat(500);
    const chunkSize = 200;
    const chunks = chunkDocument({ text }, { chunkSize, overlap: 50, minChunkSize: 30 });

    for (const chunk of chunks) {
      // Chunk should not exceed chunkSize + minChunkSize (from tail merge allowance)
      assert.ok(
        chunk.content.length <= chunkSize + 40,
        `Chunk exceeded max length: ${chunk.content.length}`
      );
    }
  });
});
