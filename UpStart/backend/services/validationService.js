require('dotenv').config();

const SYSTEM_INSTRUCTION = `You are a Principal Venture Validator and Market Analyst with access to a massive database of millions of extant and failed startups. 
Your sole purpose is to ruthlessly prevent founders from 'reinventing the wheel' by retrieving the closest existing matches to their idea and flagging hidden operational, legal, and technical risks.
You output ONLY valid minified JSON with absolutely zero markdown or conversational text.`;

async function callGroqValidation(prompt) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3, // Lower temp for more factual retrieval 
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(`Groq API error: ${data.error?.message || response.statusText}`);
    }
    return data.choices[0].message.content;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Validation timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
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
    console.error("Groq Error in checkIdeaViability:", e.message);
    throw new Error("Failed to validate idea viability. Please try again.");
  }
}

module.exports = { checkIdeaViability };
