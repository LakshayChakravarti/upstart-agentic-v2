require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const SYSTEM_INSTRUCTION = `You are a Master Venture Architect and OSINT Analyst with 20 years of experience. You always output valid minified JSON with zero markdown.`;

// Model priority order — qwen/qwen3.8-27b is listed first because it is the only
// Groq model on this account that supports response_format: json_object.
// The gpt-oss models are kept as fallbacks; they do not support json_object and
// will fast-fail (HTTP 400) before qwen is attempted if qwen is unavailable.
const GROQ_MODELS = [
  'qwen/qwen3.8-27b',    // Primary: confirmed json_object support, ~150-350ms
  'openai/gpt-oss-120b', // Fallback: no json_object support — fast-fails (400)
  'openai/gpt-oss-20b',  // Last-resort Groq fallback
];

// HTTP status codes that indicate a non-retryable provider error.
// These cause immediate failover to the next model without waiting for the full timeout.
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 422]);

async function callGroq(prompt) {
  let lastError = null;

  for (const model of GROQ_MODELS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: SYSTEM_INSTRUCTION }, { role: 'user', content: prompt }],
          temperature: 0.7,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      // Fast-fail on non-retryable errors — no point waiting 30s for a 400/404
      if (NON_RETRYABLE_STATUS.has(response.status)) {
        const errText = await response.text().catch(() => response.statusText);
        throw new Error(`Groq (${model}) non-retryable HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(`Groq (${model}) error: ${data.error?.message || response.statusText}`);
      }
      return data.choices[0].message.content;
    } catch (err) {
      lastError = err;
      console.warn(`Groq model ${model} failed, trying next fallback:`, err.message);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  console.warn('All Groq models failed. Falling back to Gemini...');
  try {
    return await callGemini(prompt);
  } catch (geminiErr) {
    console.error('Both Groq and Gemini failed:', geminiErr);
    throw lastError || geminiErr;
  }
}

async function callGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('No GEMINI_API_KEY found in environment.');
  }

  // gemini-3.5-flash-lite is the confirmed primary (working, ~1.6s, STOP finish).
  // gemini-3.5-flash is a thinking model — needs higher maxOutputTokens to avoid
  // MAX_TOKENS truncation on the council prompt (~800 tokens in).
  const geminiModels = [
    { name: 'gemini-3.5-flash-lite', maxOutputTokens: 8192 },
    { name: 'gemini-3.5-flash',      maxOutputTokens: 16384 },
  ];
  let lastErr = null;

  for (const { name: modelName, maxOutputTokens } of geminiModels) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens,
        },
      });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      lastErr = err;
      console.warn(`Gemini model ${modelName} failed, trying next:`, err.message);
    }
  }
  throw lastErr;
}

async function callTavily(query) {
  if (!process.env.TAVILY_API_KEY) {
    console.warn("No TAVILY_API_KEY, returning empty context.");
    return { context: "No external context available.", urls: [] };
  }
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: query,
        search_depth: 'advanced',
        max_results: 5
      })
    });
    const data = await response.json();
    const urls = data.results?.map(r => ({ title: r.title, url: r.url })) || [];
    const context = data.results?.map(r => `Source: ${r.url}\nContent: ${r.content}`).join('\n\n') || "No results found.";
    return { urls, context };
  } catch (e) {
    console.error("Tavily error:", e);
    return { context: "Error fetching data.", urls: [] };
  }
}

function extractJSON(text) {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
  const trimmed = text.trim();
  return JSON.parse(trimmed.startsWith('{') || trimmed.startsWith('[') ? trimmed : text);
}

async function generateIdeas(domain, skills, experience, targetUsers) {
  const prompt = `You are a Master Venture Architect. Generate 3 distinct, high-potential startup concepts.
FOUNDER PROFILE:
- Domain: ${domain}
- Target Audience: ${targetUsers || 'Not specified'}
- Skills: ${skills || 'Not specified'}
Return ONLY a valid JSON object with an "ideas" array containing exactly 3 objects with exact keys: title, problem, targetUsers, solution, tagline`;
  try {
    const text = await callGroq(prompt);
    const parsed = extractJSON(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.ideas && Array.isArray(parsed.ideas)) return parsed.ideas;
    const arrayValue = Object.values(parsed).find(v => Array.isArray(v));
    if (arrayValue) return arrayValue;
    throw new Error('Unexpected response shape from AI model');
  } catch (e) {
    console.error('generateIdeas error:', e);
    throw new Error('Failed to generate ideas: ' + (e.message || 'AI service error'));
  }
}

async function generateStrategicDirections(idea, userElaboration, founderComments) {
  const prompt = `You are a Lead Venture Strategist. Generate THREE distinct "Strategic Directions" for evolving this idea.
IDEA: ${idea.title} - ${idea.problem}
Return ONLY JSON: {"directions": [{"directionName": "string", "corePivot": "string", "keyStack": "string", "description": "string"}]}`;
  try {
    const text = await callGroq(prompt);
    const parsed = extractJSON(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.directions && Array.isArray(parsed.directions)) return parsed.directions;
    const arrayValue = Object.values(parsed).find(v => Array.isArray(v));
    if (arrayValue) return arrayValue;
    throw new Error('Unexpected response shape');
  } catch (e) {
    console.error('generateStrategicDirections error:', e);
    throw new Error("Failed to generate strategic directions: " + e.message);
  }
}

async function expandIdea(idea, userElaboration, budget, previousComments) {
  const prompt = `Expand this idea into a detailed concept. IDEA: ${idea.title} - ${idea.problem}
Return ONLY JSON with exactly: {
  "expandedTitle": "string", "expandedProblem": "string", "expandedSolution": "string",
  "expandedTargetUsers": "string", "uniqueAngle": "string", "revenueModel": "string",
  "estimatedBudget": "string", "coreTechApproach": "string", "marketSize": "string", "competitiveEdge": "string"
}`;
  try {
    return extractJSON(await callGroq(prompt));
  } catch (e) {
    console.error('expandIdea error:', e);
    throw new Error("Failed to expand idea: " + e.message);
  }
}

async function analyzeIdeaBusinessBlueprint(idea, skills, timeAvailable, budgetLevel, experienceLevel, strategicDirection, userElaboration) {
  const tavilyQuery = `troubleshooting or complaints or competitors for: ${idea.title} ${idea.problem} site:reddit.com OR alternatives`;
  const tavilyData = await callTavily(tavilyQuery);
  const researchContext = `\n\n=== TAVILY RESEARCH CONTEXT ===\n${tavilyData.context}\n`;

  const prompt = `You are a "Council of Experts" -- an elite group of 4 adversarial personas analyzing a startup idea.
You have access to live Tavily market research context.${researchContext}
USER IDEA: "${idea.title} -- ${idea.problem} -- ${idea.solution}"
Provide the base fields AND the 4 new specific persona outputs:
PERSONA 1 - THE REAPER: Find 3 brutal reasons why this will fail.
PERSONA 2 - THE PAIN MINER: Extract 3 specific real customer frustrations from research.
PERSONA 3 - THE PRICING ARCHITECT: Create 3 pricing tiers (Starter, Pro, Enterprise) with price and features.
PERSONA 4 - THE PIVOT MASTER: Find the "Winning Edge" (1 specific twist).

Return ONLY valid minified JSON with exactly these keys:
{
  "startupName": "string",
  "tagline": "string",
  "summary": "3-sentence description",
  "scores": {"technicalFeasibility": 50, "marketReadiness": 50, "regulatoryRisk": 50, "competitiveAdvantage": 50, "executionComplexity": 50, "scoreRationale": "string"},
  "theReaper": [ {"point": "string"} ],
  "thePainMiner": [ {"frustration": "string"} ],
  "pricingArchitect": {
    "starter": {"price": "string", "features": ["string"]},
    "pro": {"price": "string", "features": ["string"]},
    "enterprise": {"price": "string", "features": ["string"]}
  },
  "thePivotMaster": { "winningEdge": "string" }
}`;
  try {
    const text = await callGemini(prompt);
    let parsed = extractJSON(text);
    parsed.researchSources = tavilyData.urls;
    return parsed;
  } catch (e) {
    console.error("Error in analyzeIdea:", e);
    throw new Error("Failed to perform deep analysis: " + e.message);
  }
}

module.exports = { generateIdeas, generateStrategicDirections, expandIdea, analyzeIdeaBusinessBlueprint };
