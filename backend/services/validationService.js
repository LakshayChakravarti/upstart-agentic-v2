require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const SYSTEM_INSTRUCTION = `You are a Principal Venture Validator and Market Analyst with access to a massive database of millions of extant and failed startups. 
Your sole purpose is to ruthlessly prevent founders from 'reinventing the wheel' by retrieving the closest existing matches to their idea and flagging hidden operational, legal, and technical risks.
You output ONLY valid minified JSON with absolutely zero markdown or conversational text.`;

// qwen/qwen3.8-27b is the only Groq model on this account confirmed to support
// response_format: json_object. Placed first. gpt-oss fallbacks fast-fail (HTTP 400).
const GROQ_MODELS = [
  'qwen/qwen3.8-27b',    // Primary: json_object confirmed, ~150-350ms
  'openai/gpt-oss-120b', // Fallback: no json_object support, fast-fails (400)
  'openai/gpt-oss-20b',  // Last-resort Groq fallback
];

// Non-retryable HTTP status codes — fail over immediately without burning the timeout.
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 422]);

async function callGroqValidation(prompt) {
  let lastError = null;

  for (const model of GROQ_MODELS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_INSTRUCTION },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      // Fast-fail on non-retryable errors
      if (NON_RETRYABLE_STATUS.has(response.status)) {
        throw new Error(`Groq (${model}) non-retryable HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(`Groq (${model}) error: ${data.error?.message || response.statusText}`);
      }
      return data.choices[0].message.content;
    } catch (err) {
      lastError = err;
      console.warn(`Groq validation with ${model} failed, trying next:`, err.message);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Graceful fallback to Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      console.warn('All Groq models failed in validation. Falling back to Gemini...');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: 'gemini-3.5-flash-lite',
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 8192,
        },
      });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (geminiErr) {
      console.error('Gemini validation fallback failed:', geminiErr);
    }
  }

  throw lastError || new Error('Validation service unavailable');
}

function extractJSON(text) {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
  const trimmed = text.trim();
  return JSON.parse(trimmed.startsWith('{') || trimmed.startsWith('[') ? trimmed : text);
}

/**
 * Validates an idea by simulating a VectorDB nearest-neighbor search for similar companies,
 * and checking for explicit risks.
 */
async function checkIdeaViability(idea, domain, targetUsers) {
  const prompt = `Simulate a Vector Database similarity search and risk analysis for the following startup idea.

IDEA PROFILE:
- Title: ${idea.title}
- Problem: ${idea.problem}
- Solution: ${idea.solution}
- Domain: ${domain}
- Target Audience: ${targetUsers}

TASK 1: IDEAL SIMILARITY CHECK (VECTOR RETRIEVAL SIMULATION)
Identify the 5 closest existing or failed startups to this concept. 
Calculate an overall "Similarity Score" (0-100%).
For each of the 5 startups, provide:
- The company name
- What they do/did (1 sentence)
- Where they failed / why they struggled (1 honest sentence. If they are wildly successful, state what their biggest limitation/complaint is).

TASK 2: RISK DETECTION
Evaluate the idea against these 5 specific risk vectors:
1. Overcrowded market
2. Data dependency risk
3. Legal/Regulatory issues
4. API cost risk
5. Hardware requirements

For each risk, assign a level ("High", "Medium", or "Low"), a specific reason based on the idea profile, and a concrete pivot suggestion to mitigate that risk.

Return ONLY valid minified JSON with this exact structure:
{
  "similarity": {
    "score": "integer",
    "companies": [
      {
        "name": "string",
        "description": "string",
        "failureReason": "string"
      }
    ]
  },
  "risks": [
    {
      "category": "Overcrowded market",
      "level": "High|Medium|Low",
      "reason": "string",
      "suggestion": "string"
    },
    {
      "category": "Data dependency risk",
      "level": "High|Medium|Low",
      "reason": "string",
      "suggestion": "string"
    },
    {
      "category": "Legal issues",
      "level": "High|Medium|Low",
      "reason": "string",
      "suggestion": "string"
    },
    {
      "category": "API cost risk",
      "level": "High|Medium|Low",
      "reason": "string",
      "suggestion": "string"
    },
    {
      "category": "Hardware requirement",
      "level": "High|Medium|Low",
      "reason": "string",
      "suggestion": "string"
    }
  ]
}`;

  try {
    const text = await callGroqValidation(prompt);
    return extractJSON(text);
  } catch (e) {
    console.error("Error in checkIdeaViability:", e);
    throw new Error("Failed to validate idea viability: " + (e.message || "Please try again."));
  }
}

module.exports = { checkIdeaViability };
