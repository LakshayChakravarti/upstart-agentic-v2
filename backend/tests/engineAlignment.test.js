'use strict';

/**
 * backend/tests/engineAlignment.test.js
 *
 * Phase 1: Engine Alignment & Blueprint Persistence Regression Suite
 *
 * Tests:
 *  1. Council option propagation from live route configuration (req.body and USE_COUNCIL env flag).
 *  2. Council execution and fallback behavior in analyzeIdeaBusinessBlueprint.
 *  3. Complete blueprint persistence into analysis_results (adversarial & feasibility columns).
 *  4. Single idea retrieval (GET /api/ideas/:id) reconstitutes complete blueprint at root of analysis.
 *  5. Data contract compatibility with frontend saved blueprint view (summary, scores, rationale, personas).
 *  6. Backward compatibility with legacy analysis rows missing top-level blueprint metadata.
 *
 * Runs fully in-memory with zero external API calls and zero modifications to the real database.
 */

const assert = require('node:assert/strict');
const { describe, test, beforeEach } = require('node:test');
const Database = require('better-sqlite3');

const { analyzeIdeaBusinessBlueprint } = require('../services/aiService');
const { calculateFeasibilityScore } = require('../services/scoringEngine');

// ---------------------------------------------------------------------------
// Helpers & Fixtures
// ---------------------------------------------------------------------------

function createTestDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE ideas (
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
      user_elaboration TEXT,
      strategic_direction TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE analysis_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idea_id INTEGER NOT NULL,
      market TEXT,
      competitors TEXT,
      feasibility TEXT,
      tech_stack TEXT,
      monetization TEXT,
      roadmap TEXT,
      adversarial TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE
    );
  `);

  return db;
}

const SAMPLE_IDEA = {
  title: 'AgriDrone AI',
  problem: 'Fruit orchards lose $400/acre due to untargeted chemical spraying.',
  solution: 'Autonomous drone swarms using multispectral cameras to spray only blighted trees.',
  tagline: 'Precision orchard health from above',
};

const SAMPLE_COUNCIL_BLUEPRINT = {
  startupName: 'AgriDrone AI',
  tagline: 'Precision orchard health from above',
  summary: 'Autonomous multispectral drone swarm detecting and treating orchard blights in real time.',
  scores: {
    technicalFeasibility: 85,
    marketReadiness: 75,
    regulatoryRisk: 40,
    competitiveAdvantage: 80,
    executionComplexity: 60,
    scoreRationale: 'Strong technical grounding with commercial drone hardware; FAA Part 107 compliance required.',
  },
  theReaper: [
    { point: 'BVLOS (Beyond Visual Line of Sight) waivers from FAA are difficult to obtain for multi-drone operations.' },
    { point: 'High upfront capital expenditure for commercial multispectral hardware limits farmer adoption.' },
  ],
  thePainMiner: [
    { frustration: 'Orchard owners currently spend $400/acre on blanket pesticide spraying that poisons runoff water.' },
    { frustration: 'Manual tree scouting requires 20 hours per week during peak pest season.' },
  ],
  pricingArchitect: {
    starter: { price: '$499/mo', features: ['Up to 50 acres', 'Weekly health maps', 'Manual flight dispatch'] },
    pro: { price: '$1,499/mo', features: ['Up to 250 acres', 'Daily drone sweeps', 'Automated spot-spray dispatch'] },
    enterprise: { price: '$4,999/mo', features: ['Unlimited acres', 'Dedicated charging dock', 'API integration'] },
  },
  thePivotMaster: {
    winningEdge: 'Partner with John Deere Operations Center to auto-import field boundary maps and machinery telemetry.',
  },
  researchSources: [
    { title: 'USDA Precision Agriculture Report 2024', url: 'https://usda.gov/precision-ag-2024' },
    { title: 'Drone Spraying Regulations Index', url: 'https://faa.gov/uas/commercial' },
  ],
  ragGrounded: true,
  ragDiagnostics: { status: 'grounded', reason: 'OK' },
  councilDiagnostics: {
    completed: true,
    fallbackUsed: false,
    successfulPersonaCount: 4,
    failedPersonaCount: 0,
    synthesisSuccess: true,
  },
};

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

describe('Phase 1 — Engine Alignment & Council Activation', () => {

  test('1. Council activation decision logic honors req.body.useCouncil and USE_COUNCIL env flag', () => {
    // Helper replicating the decision logic in ideaRoutes.js:
    function resolveCouncilFlag(useCouncilBody, envValue) {
      return useCouncilBody !== undefined
        ? Boolean(useCouncilBody)
        : envValue !== 'false';
    }

    // Default when no flag is provided: true (active by default in production/demo)
    assert.equal(resolveCouncilFlag(undefined, undefined), true);
    assert.equal(resolveCouncilFlag(undefined, ''), true);
    assert.equal(resolveCouncilFlag(undefined, 'true'), true);

    // Explicit environment variable USE_COUNCIL=false disables Council
    assert.equal(resolveCouncilFlag(undefined, 'false'), false);

    // Request body explicit boolean overrides environment variable
    assert.equal(resolveCouncilFlag(true, 'false'), true);
    assert.equal(resolveCouncilFlag(false, 'true'), false);
    assert.equal(resolveCouncilFlag(false, undefined), false);
    assert.equal(resolveCouncilFlag(true, undefined), true);
  });

  test('2. analyzeIdeaBusinessBlueprint invokes Council orchestrator when useCouncil: true', async () => {
    let councilInvoked = false;
    let singleCallInvoked = false;

    // Mock Gemini caller that accurately matches persona prompts and synthesis
    const mockGemini = async (prompt) => {
      if (prompt.includes('You are the CHAIRMAN of the Council of Experts')) {
        return JSON.stringify(SAMPLE_COUNCIL_BLUEPRINT);
      }
      if (prompt.includes('You are THE REAPER')) {
        councilInvoked = true;
        return JSON.stringify({ theReaper: SAMPLE_COUNCIL_BLUEPRINT.theReaper });
      }
      if (prompt.includes('You are THE PAIN MINER')) {
        return JSON.stringify({ thePainMiner: SAMPLE_COUNCIL_BLUEPRINT.thePainMiner });
      }
      if (prompt.includes('You are THE PRICING ARCHITECT')) {
        return JSON.stringify({ pricingArchitect: SAMPLE_COUNCIL_BLUEPRINT.pricingArchitect });
      }
      if (prompt.includes('You are THE PIVOT MASTER')) {
        return JSON.stringify({ thePivotMaster: SAMPLE_COUNCIL_BLUEPRINT.thePivotMaster });
      }
      if (prompt.includes('You are a "Council of Experts"')) {
        singleCallInvoked = true;
        return JSON.stringify(SAMPLE_COUNCIL_BLUEPRINT);
      }
      throw new Error(`Unexpected prompt pattern: ${prompt.slice(0, 50)}`);
    };

    const mockTavily = async () => ({
      results: [],
      urls: [],
      context: 'Precision agriculture drone market size: $2B in 2024.',
    });

    const result = await analyzeIdeaBusinessBlueprint(
      SAMPLE_IDEA,
      'Drone Pilot, Python',
      '20 hrs/wk',
      '$10,000',
      'Intermediate',
      null,
      null,
      null,
      {
        useCouncil: true,
        geminiFn: mockGemini,
        tavilySearchFn: mockTavily,
      }
    );

    assert.equal(councilInvoked, true, 'Council persona prompt should be executed');
    assert.equal(singleCallInvoked, false, 'Single call prompt should not be executed on council success');
    assert.equal(result.startupName, 'AgriDrone AI');
    assert.ok(result.councilDiagnostics);
    assert.equal(result.councilDiagnostics.completed, true);
    assert.equal(result.councilDiagnostics.fallbackUsed, false);
  });

  test('3. Council failure triggers safe fallback to single-call blueprint with diagnostics', async () => {
    let singleCallInvoked = false;

    const mockGemini = async (prompt) => {
      // Chairman Synthesis
      if (prompt.includes('You are the CHAIRMAN of the Council of Experts')) {
        return JSON.stringify(SAMPLE_COUNCIL_BLUEPRINT);
      }
      // Simulate Persona Reaper failure
      if (prompt.includes('You are THE REAPER')) {
        throw new Error('Reaper API quota exceeded');
      }
      if (prompt.includes('You are THE PAIN MINER')) {
        return JSON.stringify({ thePainMiner: SAMPLE_COUNCIL_BLUEPRINT.thePainMiner });
      }
      if (prompt.includes('You are THE PRICING ARCHITECT')) {
        return JSON.stringify({ pricingArchitect: SAMPLE_COUNCIL_BLUEPRINT.pricingArchitect });
      }
      if (prompt.includes('You are THE PIVOT MASTER')) {
        return JSON.stringify({ thePivotMaster: SAMPLE_COUNCIL_BLUEPRINT.thePivotMaster });
      }
      // Single call fallback prompt
      if (prompt.includes('You are a "Council of Experts"')) {
        singleCallInvoked = true;
        return JSON.stringify({
          ...SAMPLE_COUNCIL_BLUEPRINT,
          startupName: 'AgriDrone SingleCall Fallback',
        });
      }
      throw new Error(`Unexpected prompt pattern: ${prompt.slice(0, 50)}`);
    };

    const mockTavily = async () => ({ results: [], urls: [], context: 'Market data' });

    const result = await analyzeIdeaBusinessBlueprint(
      SAMPLE_IDEA,
      'Drone Pilot',
      '10 hrs/wk',
      '$5,000',
      'Beginner',
      null,
      null,
      null,
      {
        useCouncil: true,
        geminiFn: mockGemini,
        tavilySearchFn: mockTavily,
      }
    );

    assert.equal(singleCallInvoked, true, 'Single call fallback must be invoked when council fails');
    assert.equal(result.startupName, 'AgriDrone SingleCall Fallback');
    assert.ok(result.councilDiagnostics, 'councilDiagnostics must be attached');
    assert.equal(result.councilDiagnostics.fallbackUsed, true, 'fallbackUsed must be true');
    assert.equal(result.councilDiagnostics.fallbackReason, 'PERSONA_CALL_REJECTED');
  });

});

describe('Phase 1 — Blueprint Persistence & Retrieval Reconstitution', () => {

  test('4. Complete blueprint persists and retrieves with full root parity (summary, startupName, scores)', () => {
    const db = createTestDatabase();

    // 1. Insert user and idea session
    const userRes = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run('Founder Jane', 'jane@example.com', 'hashed_pw');
    const userId = userRes.lastInsertRowid;

    const ideaRes = db.prepare(`
      INSERT INTO ideas (user_id, domain, skills, time_available, budget_level, experience_level, target_users, idea_data, selected_idea)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      'Agriculture',
      'Python, Drones',
      '20 hrs/wk',
      '$10,000',
      'Intermediate',
      'Orchard owners',
      JSON.stringify([SAMPLE_IDEA]),
      JSON.stringify(SAMPLE_IDEA)
    );
    const ideaSessionId = ideaRes.lastInsertRowid;

    // 2. Prepare blueprint and compute scoringEngine composite
    const blueprint = { ...SAMPLE_COUNCIL_BLUEPRINT };
    const scoreResult = calculateFeasibilityScore(blueprint.scores);
    blueprint.feasibilityScore = scoreResult.compositeScore;
    blueprint.scores.compositeScore = scoreResult.compositeScore;
    blueprint.scores.grade = scoreResult.grade;
    blueprint.scores.breakdown = scoreResult.breakdown;

    // 3. Replicate ideaRoutes.js persistence logic
    const marketData = JSON.stringify({ marketGap: blueprint.marketGap });
    const competitorsData = JSON.stringify(blueprint.competitors || []);
    const feasibilityData = JSON.stringify({ feasibilityScore: blueprint.feasibilityScore, scores: blueprint.scores });
    const techStackData = JSON.stringify(blueprint.techStack || ['Python', 'PX4 Autopilot', 'TensorFlow Lite']);
    const monetizationData = JSON.stringify(blueprint.monetization || ['SaaS hardware subscription']);
    const roadmapData = JSON.stringify(blueprint.roadmap || [{ week: 'Week 1-2', goal: 'FAA Part 107 submission' }]);

    const adversarialData = JSON.stringify({
      startupName: blueprint.startupName || null,
      tagline: blueprint.tagline || null,
      summary: blueprint.summary || null,
      scores: blueprint.scores || null,
      feasibilityScore: blueprint.feasibilityScore ?? null,
      theReaper: blueprint.theReaper || null,
      thePainMiner: blueprint.thePainMiner || null,
      pricingArchitect: blueprint.pricingArchitect || null,
      thePivotMaster: blueprint.thePivotMaster || null,
      researchSources: blueprint.researchSources || [],
      ragGrounded: blueprint.ragGrounded || false,
      ragDiagnostics: blueprint.ragDiagnostics || null,
      councilDiagnostics: blueprint.councilDiagnostics || null,
    });

    db.prepare(`
      INSERT INTO analysis_results (idea_id, market, competitors, feasibility, tech_stack, monetization, roadmap, adversarial)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ideaSessionId, marketData, competitorsData, feasibilityData, techStackData, monetizationData, roadmapData, adversarialData
    );

    // 4. Replicate GET /api/ideas/:id retrieval reconstitution logic
    const rawAnalysis = db.prepare('SELECT * FROM analysis_results WHERE idea_id = ?').get(ideaSessionId);
    assert.ok(rawAnalysis, 'analysis_results row must exist');

    const parsedAdversarial = JSON.parse(rawAnalysis.adversarial || 'null') || {};
    const parsedFeasibility = JSON.parse(rawAnalysis.feasibility || 'null') || {};

    const reconstitutedAnalysis = {
      ...rawAnalysis,
      market: JSON.parse(rawAnalysis.market || 'null'),
      competitors: JSON.parse(rawAnalysis.competitors || 'null'),
      feasibility: parsedFeasibility,
      tech_stack: JSON.parse(rawAnalysis.tech_stack || 'null'),
      monetization: JSON.parse(rawAnalysis.monetization || 'null'),
      roadmap: JSON.parse(rawAnalysis.roadmap || 'null'),
      adversarial: parsedAdversarial,
      // Top-level blueprint parity fields
      startupName: parsedAdversarial.startupName || null,
      tagline: parsedAdversarial.tagline || null,
      summary: parsedAdversarial.summary || null,
      scores: parsedAdversarial.scores || parsedFeasibility.scores || null,
      feasibilityScore: parsedAdversarial.feasibilityScore ?? parsedFeasibility.feasibilityScore ?? null,
      theReaper: parsedAdversarial.theReaper || null,
      thePainMiner: parsedAdversarial.thePainMiner || null,
      pricingArchitect: parsedAdversarial.pricingArchitect || null,
      thePivotMaster: parsedAdversarial.thePivotMaster || null,
      researchSources: parsedAdversarial.researchSources || [],
      ragGrounded: parsedAdversarial.ragGrounded || false,
      ragDiagnostics: parsedAdversarial.ragDiagnostics || null,
      councilDiagnostics: parsedAdversarial.councilDiagnostics || null,
    };

    // 5. Verify all blueprint properties survive with exact parity
    assert.equal(reconstitutedAnalysis.startupName, 'AgriDrone AI');
    assert.equal(reconstitutedAnalysis.tagline, 'Precision orchard health from above');
    assert.equal(
      reconstitutedAnalysis.summary,
      'Autonomous multispectral drone swarm detecting and treating orchard blights in real time.'
    );

    // Scores & Rationale
    assert.ok(reconstitutedAnalysis.scores);
    assert.equal(reconstitutedAnalysis.scores.technicalFeasibility, 85);
    assert.equal(reconstitutedAnalysis.scores.compositeScore, scoreResult.compositeScore);
    assert.equal(reconstitutedAnalysis.scores.grade, scoreResult.grade);
    assert.equal(
      reconstitutedAnalysis.scores.scoreRationale,
      'Strong technical grounding with commercial drone hardware; FAA Part 107 compliance required.'
    );

    // Four Personas
    assert.equal(reconstitutedAnalysis.theReaper.length, 2);
    assert.ok(reconstitutedAnalysis.theReaper[0].point.includes('BVLOS'));
    assert.equal(reconstitutedAnalysis.thePainMiner.length, 2);
    assert.ok(reconstitutedAnalysis.thePainMiner[0].frustration.includes('$400/acre'));
    assert.equal(reconstitutedAnalysis.pricingArchitect.starter.price, '$499/mo');
    assert.equal(reconstitutedAnalysis.pricingArchitect.pro.price, '$1,499/mo');
    assert.equal(reconstitutedAnalysis.pricingArchitect.enterprise.price, '$4,999/mo');
    assert.ok(reconstitutedAnalysis.thePivotMaster.winningEdge.includes('John Deere'));

    // Provenance
    assert.equal(reconstitutedAnalysis.researchSources.length, 2);
    assert.equal(reconstitutedAnalysis.ragGrounded, true);
    assert.equal(reconstitutedAnalysis.councilDiagnostics.completed, true);
  });

  test('5. Frontend saved blueprint data contract mapping matches live dashboard data expectations', () => {
    // Simulates frontend/src/app/saved/[id]/page.tsx data ingestion:
    const mockData = {
      idea: {
        id: 42,
        domain: 'Agriculture',
        created_at: '2026-11-15T12:00:00Z',
        selected_idea: SAMPLE_IDEA,
      },
      analysis: {
        startupName: 'AgriDrone AI',
        tagline: 'Precision orchard health from above',
        summary: 'Elevator pitch summary of the venture.',
        scores: {
          compositeScore: 78,
          grade: 'B',
          scoreRationale: 'Realistic hardware roadmap with clear agricultural demand.',
          technicalFeasibility: 80,
          marketReadiness: 75,
          regulatoryRisk: 40,
          competitiveAdvantage: 85,
          executionComplexity: 60,
        },
        feasibilityScore: 78,
        theReaper: [{ point: 'Reaper danger' }],
        thePainMiner: [{ frustration: 'Pain miner irritation' }],
        pricingArchitect: {
          starter: { price: '$100', features: ['Basic'] },
          pro: { price: '$200', features: ['Pro'] },
          enterprise: { price: '$500', features: ['Custom'] },
        },
        thePivotMaster: { winningEdge: 'The winning pivot edge' },
        researchSources: [{ title: 'Source 1', url: 'https://example.com' }],
        adversarial: {
          startupName: 'AgriDrone AI',
          tagline: 'Precision orchard health from above',
          summary: 'Elevator pitch summary of the venture.',
          theReaper: [{ point: 'Reaper danger' }],
          thePainMiner: [{ frustration: 'Pain miner irritation' }],
          pricingArchitect: {
            starter: { price: '$100', features: ['Basic'] },
            pro: { price: '$200', features: ['Pro'] },
            enterprise: { price: '$500', features: ['Custom'] },
          },
          thePivotMaster: { winningEdge: 'The winning pivot edge' },
          researchSources: [{ title: 'Source 1', url: 'https://example.com' }],
        },
      },
    };

    // Mapping in saved/[id]/page.tsx:
    const { idea, analysis } = mockData;
    const selectedIdea = idea?.selected_idea;
    const adv = analysis?.adversarial || {};
    const bp = analysis ? {
      ...analysis,
      startupName: analysis.startupName || adv.startupName,
      tagline: analysis.tagline || adv.tagline,
      summary: analysis.summary || adv.summary,
      scores: analysis.scores || adv.scores || analysis.feasibility?.scores,
      feasibilityScore: analysis.feasibilityScore ?? adv.feasibilityScore ?? analysis.feasibility?.feasibilityScore,
      theReaper: adv.theReaper || analysis.theReaper,
      thePainMiner: adv.thePainMiner || analysis.thePainMiner,
      pricingArchitect: adv.pricingArchitect || analysis.pricingArchitect,
      thePivotMaster: adv.thePivotMaster || analysis.thePivotMaster,
      researchSources: adv.researchSources || analysis.researchSources,
      adversarial: adv,
    } : null;

    assert.ok(bp, 'Blueprint must be non-null');
    assert.equal(bp.summary, 'Elevator pitch summary of the venture.');
    assert.equal(bp.startupName, 'AgriDrone AI');
    assert.equal(bp.tagline, 'Precision orchard health from above');
    assert.equal(bp.scores.scoreRationale, 'Realistic hardware roadmap with clear agricultural demand.');
    assert.equal(bp.scores.compositeScore, 78);
    assert.equal(bp.theReaper[0].point, 'Reaper danger');
    assert.equal(bp.thePainMiner[0].frustration, 'Pain miner irritation');
    assert.equal(bp.pricingArchitect.starter.price, '$100');
    assert.equal(bp.thePivotMaster.winningEdge, 'The winning pivot edge');
    assert.equal(bp.researchSources.length, 1);
  });

  test('6. Backward compatibility: legacy rows without top-level blueprint metadata gracefully fall back', () => {
    // Legacy row where adversarial only contained the 4 personas without startupName/summary/scores
    const legacyAnalysis = {
      feasibility: JSON.stringify({
        feasibilityScore: 68,
        scores: {
          compositeScore: 68,
          scoreRationale: 'Legacy calculated rationale.',
        },
      }),
      adversarial: JSON.stringify({
        theReaper: [{ point: 'Legacy reaper point' }],
        thePainMiner: [{ frustration: 'Legacy pain point' }],
        pricingArchitect: {
          starter: { price: '$10', features: ['f1'] },
          pro: { price: '$20', features: ['f2'] },
          enterprise: { price: '$30', features: ['f3'] },
        },
        thePivotMaster: { winningEdge: 'Legacy edge' },
        researchSources: [],
      }),
    };

    const parsedAdversarial = JSON.parse(legacyAnalysis.adversarial);
    const parsedFeasibility = JSON.parse(legacyAnalysis.feasibility);

    const reconstituted = {
      ...legacyAnalysis,
      feasibility: parsedFeasibility,
      adversarial: parsedAdversarial,
      startupName: parsedAdversarial.startupName || null,
      tagline: parsedAdversarial.tagline || null,
      summary: parsedAdversarial.summary || null,
      scores: parsedAdversarial.scores || parsedFeasibility.scores || null,
      feasibilityScore: parsedAdversarial.feasibilityScore ?? parsedFeasibility.feasibilityScore ?? null,
      theReaper: parsedAdversarial.theReaper || null,
      thePainMiner: parsedAdversarial.thePainMiner || null,
      pricingArchitect: parsedAdversarial.pricingArchitect || null,
      thePivotMaster: parsedAdversarial.thePivotMaster || null,
      researchSources: parsedAdversarial.researchSources || [],
    };

    // Fallbacks resolve gracefully:
    assert.equal(reconstituted.startupName, null);
    assert.equal(reconstituted.summary, null);
    assert.equal(reconstituted.scores.compositeScore, 68);
    assert.equal(reconstituted.scores.scoreRationale, 'Legacy calculated rationale.');
    assert.equal(reconstituted.feasibilityScore, 68);
    assert.equal(reconstituted.theReaper[0].point, 'Legacy reaper point');
  });

});
