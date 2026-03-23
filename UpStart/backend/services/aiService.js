require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const SYSTEM_INSTRUCTION = `You are a Master Venture Architect and OSINT Analyst with 20 years of experience. You always output valid minified JSON with zero markdown.`;

async function callGroq(prompt) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 75000); // 75s timeout
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: SYSTEM_INSTRUCTION }, { role: 'user', content: prompt }],
        temperature: 0.7, max_tokens: 8000, response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(`Groq API error: ${data.error?.message || response.statusText}`);
    return data.choices[0].message.content;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Groq API timed out.');
    throw err;
  } finally { clearTimeout(timeoutId); }
}

async function callGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
      console.warn("No GEMINI_API_KEY found. Falling back to Groq.");
      return callGroq(prompt);
  }
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
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
Return ONLY a valid JSON array of exactly 3 objects with exact keys: title, problem, targetUsers, solution, tagline`;
  try {
    const text = await callGroq(prompt);
    const parsed = extractJSON(text);
    if (Array.isArray(parsed)) return parsed;
    const arrayValue = Object.values(parsed).find(v => Array.isArray(v));
    if (arrayValue) return arrayValue;
    throw new Error('Unexpected shape');
  } catch (e) { throw new Error("Failed to generate ideas."); }
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
  } catch (e) { throw new Error("Failed to generate strategic directions."); }
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
  } catch (e) { throw new Error("Failed to expand idea."); }
}

async function analyzeIdeaBusinessBlueprint(idea, skills, timeAvailable, budgetLevel, experienceLevel, strategicDirection, userElaboration) {
  // 1. Tavily Research
  const tavilyQuery = `troubleshooting or complaints or competitors for: ${idea.title} ${idea.problem} site:reddit.com OR alternatives`;
  const tavilyData = await callTavily(tavilyQuery);
  const researchContext = `\n\n=== TAVILY RESEARCH CONTEXT ===\n${tavilyData.context}\n`;

  // 2. Gemini Council of Experts Prompt
  const prompt = `You are a "Council of Experts" — an elite group of 4 adversarial personas analyzing a startup idea.
You have access to live Tavily market research context.${researchContext}
USER IDEA: "${idea.title} — ${idea.problem} — ${idea.solution}"
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
    throw new Error("Failed to perform deep analysis.");
  }
}

module.exports = { generateIdeas, generateStrategicDirections, expandIdea, analyzeIdeaBusinessBlueprint };
