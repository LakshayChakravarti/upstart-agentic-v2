'use strict';

/**
 * backend/tests/evaluationFramework.test.js
 *
 * Phase 4A: Evaluation Framework Deterministic Test Suite
 *
 * Deterministic, offline tests verifying:
 *  1. All three benchmark cases load correctly with complete metadata.
 *  2. Both workflow identifiers ('single_call', 'council') are supported and validated.
 *  3. Mocked runs invoke the correct workflow interfaces (1 call for single_call, 5 calls for council).
 *  4. The same 7-dimension rubric is applied consistently to both workflows.
 *  5. Schema validity is recorded separately from qualitative rubric scores.
 *  6. Failed or fallback runs are represented honestly without masked failures.
 *  7. Aggregates are calculated correctly from known fixture scores.
 *  8. Missing scores or unavailable metrics are not silently coerced to zero or perfect scores.
 *  9. Zero live external API calls (Tavily/Gemini/Groq) are required to run the evaluation suite.
 * 10. The existing single-call default and council opt-in behavior remain untouched.
 *
 * Run with: node --test tests/evaluationFramework.test.js
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  BENCHMARK_DATASET_VERSION,
  HISTORICAL_PILOT_CASE_IDS,
  BENCHMARK_CASES,
  getBenchmarkCase,
  getAllBenchmarkCases,
  createDeterministicMockGemini,
  RUBRIC_DIMENSIONS,
  SHARED_DIMENSION_IDS,
  ARCHITECTURAL_DIMENSION_IDS,
  VALID_SCORE_MIN,
  VALID_SCORE_MAX,
  isValidScore,
  evaluateBlueprintQuality,
  SUPPORTED_WORKFLOWS,
  runCaseEvaluation,
  runComparativeEvaluation,
  aggregateWorkflowMetrics,
  formatEvaluationReport,
} = require('../services/evaluation');

const { analyzeIdeaBusinessBlueprint } = require('../services/aiService');

describe('Phase 4A — Evaluation Framework Tests', () => {

  // Test 1: All benchmark cases load correctly
  test('1. Benchmark cases load correctly with required metadata and considerations (12 cases)', () => {
    const cases = getAllBenchmarkCases();
    assert.equal(cases.length, 12, 'Must contain exactly 12 benchmark cases');

    const expectedHistoricalIds = [
      'crowded-market-weak-differentiation',
      'specific-problem-uncertain-wtp',
      'attractive-idea-high-regulatory-risk',
    ];
    const actualIds = cases.map(c => c.id);
    assert.deepEqual(actualIds.slice(0, 3), expectedHistoricalIds, 'Historical case IDs must be preserved at indices 0..2');

    for (const bCase of cases) {
      assert.ok(bCase.id, 'Case must have id');
      assert.ok(bCase.name, 'Case must have name');
      assert.ok(bCase.category, 'Case must have category');

      // Idea contract
      assert.ok(bCase.idea && typeof bCase.idea === 'object');
      assert.ok(typeof bCase.idea.title === 'string' && bCase.idea.title.trim());
      assert.ok(typeof bCase.idea.problem === 'string' && bCase.idea.problem.trim());
      assert.ok(typeof bCase.idea.solution === 'string' && bCase.idea.solution.trim());

      // Profile & Research
      assert.ok(bCase.userProfile && typeof bCase.userProfile === 'object');
      assert.ok(Array.isArray(bCase.researchSources) && bCase.researchSources.length > 0);
      assert.ok(typeof bCase.researchContext === 'string' && bCase.researchContext.includes('Source 1'));

      // Evaluation considerations
      assert.ok(bCase.evaluationConsiderations && typeof bCase.evaluationConsiderations === 'object');
      assert.ok(Object.keys(bCase.evaluationConsiderations).length >= 3);

      // Deterministic mock responses
      assert.ok(bCase.mockResponses && typeof bCase.mockResponses === 'object');
      assert.ok(bCase.mockResponses.singleCall && typeof bCase.mockResponses.singleCall === 'object');
      assert.ok(bCase.mockResponses.council && typeof bCase.mockResponses.council === 'object');
      assert.ok(bCase.mockResponses.council.synthesis);
    }

    // Direct getter check
    const single = getBenchmarkCase('crowded-market-weak-differentiation');
    assert.equal(single.id, 'crowded-market-weak-differentiation');
    assert.throws(() => getBenchmarkCase('non-existent-case-id'), /Benchmark case not found/);
  });

  // Test 2: Both workflow identifiers are supported
  test('2. Both workflow identifiers are supported and invalid identifiers throw descriptive errors', async () => {
    assert.deepEqual(SUPPORTED_WORKFLOWS, ['single_call', 'council']);

    const bCase = getBenchmarkCase('crowded-market-weak-differentiation');

    // Invalid workflow throws immediately without running models
    await assert.rejects(
      async () => runCaseEvaluation(bCase, 'unsupported_workflow'),
      /Unsupported workflow "unsupported_workflow"/
    );
  });

  // Test 3: Mocked runs invoke the correct workflow interfaces
  test('3. Mocked runs invoke the correct workflow interfaces (1 model call for single_call, 5 for council)', async () => {
    const bCase = getBenchmarkCase('crowded-market-weak-differentiation');

    // 1. Single-Call Workflow
    const singleResult = await runCaseEvaluation(bCase, 'single_call');
    assert.equal(singleResult.workflow, 'single_call');
    assert.equal(singleResult.caseId, bCase.id);
    assert.equal(singleResult.completed, true);
    assert.equal(singleResult.fallbackUsed, false);
    assert.equal(singleResult.schemaValid, true);
    assert.equal(singleResult.modelCallCount, 1, 'Single-call workflow must make exactly 1 model call');
    assert.equal(singleResult.tokenUsage, null, 'Token usage must be null when wrapper does not expose metadata');

    // 2. Council Workflow
    const councilResult = await runCaseEvaluation(bCase, 'council');
    assert.equal(councilResult.workflow, 'council');
    assert.equal(councilResult.caseId, bCase.id);
    assert.equal(councilResult.completed, true);
    assert.equal(councilResult.fallbackUsed, false);
    assert.equal(councilResult.schemaValid, true);
    assert.equal(councilResult.modelCallCount, 5, 'Council workflow must make exactly 5 model calls');
    assert.ok(councilResult.diagnostics, 'Council diagnostics must be present on council run');
    assert.equal(councilResult.diagnostics.successfulPersonaCount, 4);
    assert.equal(councilResult.diagnostics.synthesisSuccess, true);
  });

  // Test 4: The same rubric is applied to both workflows
  test('4. The same 7-dimension rubric is applied consistently to both workflows with 1-5 scale and rationales', async () => {
    assert.equal(RUBRIC_DIMENSIONS.length, 7);
    const expectedDimensionIds = [
      'completeness',
      'problemSpecificity',
      'commercialReasoning',
      'riskAndFeasibility',
      'distinctAnalyticalValue',
      'evidenceGrounding',
      'internalConsistency',
    ];
    assert.deepEqual(RUBRIC_DIMENSIONS.map(d => d.id), expectedDimensionIds);

    const bCase = getBenchmarkCase('specific-problem-uncertain-wtp');

    const singleResult = await runCaseEvaluation(bCase, 'single_call');
    const councilResult = await runCaseEvaluation(bCase, 'council');

    for (const result of [singleResult, councilResult]) {
      const q = result.qualityAssessment;
      assert.ok(q && typeof q === 'object');
      assert.equal(q.assessedDimensionsCount, 7);
      assert.equal(q.unassessedDimensionsCount, 0);
      assert.ok(typeof q.averageScore === 'number' && q.averageScore >= VALID_SCORE_MIN && q.averageScore <= VALID_SCORE_MAX);

      for (const dimId of expectedDimensionIds) {
        const dimAssessment = q.scores[dimId];
        assert.ok(dimAssessment, `Dimension ${dimId} must be present in assessment`);
        assert.ok(
          isValidScore(dimAssessment.score) && dimAssessment.score !== null,
          `Score for ${dimId} must be integer 1-5, got ${dimAssessment.score}`
        );
        assert.ok(
          typeof dimAssessment.rationale === 'string' && dimAssessment.rationale.trim().length > 10,
          `Rationale for ${dimId} must be non-empty string`
        );
      }
    }
  });

  // Test 5: Schema validity is recorded separately from quality scores
  test('5. Schema validity is recorded separately from quality scores', () => {
    const bCase = getBenchmarkCase('crowded-market-weak-differentiation');

    // A valid blueprint schema with intentionally generic/poor content
    const genericValidBlueprint = {
      startupName: 'GenericCo',
      tagline: 'Generic business tagline',
      summary: 'A company doing things for people in a generic way.',
      scores: {
        technicalFeasibility: 50,
        marketReadiness: 50,
        regulatoryRisk: 50,
        competitiveAdvantage: 50,
        executionComplexity: 50,
        scoreRationale: 'Neutral generic rationale.',
      },
      theReaper: [{ point: 'Generic risk statement' }],
      thePainMiner: [{ frustration: 'Users have a generic problem' }],
      pricingArchitect: {
        starter: { price: '$10', features: ['Generic feature'] },
        pro: { price: '$20', features: ['Generic pro'] },
        enterprise: { price: '$50', features: ['Generic ent'] },
      },
      thePivotMaster: { winningEdge: 'Do marketing better' },
    };

    const evaluation = evaluateBlueprintQuality(genericValidBlueprint, bCase, 'single_call');

    // Structural validity does not yield perfect quality scores
    assert.ok(evaluation.averageScore <= 3.5, 'Generic valid blueprint must not automatically receive high quality score');
    assert.equal(evaluation.scores.problemSpecificity.score, 2, 'Generic pain point should receive low specificity score');
  });

  // Test 6: Failed or fallback runs are represented honestly
  test('6. Failed or fallback runs are represented honestly without masked failures', async () => {
    const bCase = getBenchmarkCase('attractive-idea-high-regulatory-risk');

    // 1. Injected model rejection on persona triggers fallback
    const mockGeminiFallback = createDeterministicMockGemini(bCase.id, {
      throwOnPromptMatch: /You are THE REAPER/,
    });

    const fallbackResult = await runCaseEvaluation(bCase, 'council', {
      geminiFn: mockGeminiFallback,
    });

    assert.equal(fallbackResult.workflow, 'council');
    assert.equal(fallbackResult.completed, false, 'Council must not report completed when fallback was used');
    assert.equal(fallbackResult.fallbackUsed, true, 'fallbackUsed must be true');
    assert.equal(fallbackResult.fallbackReason, 'PERSONA_CALL_REJECTED');
    assert.equal(fallbackResult.schemaValid, true, 'Single call fallback produced a schema valid result');

    // 2. Injected total model failure (both council and fallback fail)
    const mockGeminiTotalExplosion = async () => {
      throw new Error('Total model network failure');
    };

    const failedResult = await runCaseEvaluation(bCase, 'council', {
      geminiFn: mockGeminiTotalExplosion,
    });

    assert.equal(failedResult.completed, false);
    assert.equal(failedResult.schemaValid, false);
    assert.ok(failedResult.failureCategory, 'Must capture failure category');
    assert.equal(failedResult.qualityAssessment.averageScore, null, 'Failed execution must have null average quality');
    assert.equal(failedResult.qualityAssessment.unassessedDimensionsCount, 7, 'All dimensions must be unassessed on failed run');
  });

  // Test 7: Aggregates are calculated correctly from known fixture scores
  test('7. Aggregates are calculated correctly from known fixture scores', () => {
    const mockRuns = [
      {
        workflow: 'council',
        completed: true,
        fallbackUsed: false,
        schemaValid: true,
        modelCallCount: 5,
        qualityAssessment: {
          scores: {
            completeness: { score: 4, rationale: 'r' },
            problemSpecificity: { score: 4, rationale: 'r' },
            commercialReasoning: { score: 4, rationale: 'r' },
            riskAndFeasibility: { score: 4, rationale: 'r' },
            distinctAnalyticalValue: { score: 4, rationale: 'r' },
            evidenceGrounding: { score: 4, rationale: 'r' },
            internalConsistency: { score: 4, rationale: 'r' },
          },
        },
      },
      {
        workflow: 'council',
        completed: false,
        fallbackUsed: true,
        schemaValid: true,
        modelCallCount: 5,
        qualityAssessment: {
          scores: {
            completeness: { score: 2, rationale: 'r' },
            problemSpecificity: { score: 2, rationale: 'r' },
            commercialReasoning: { score: 2, rationale: 'r' },
            riskAndFeasibility: { score: 2, rationale: 'r' },
            distinctAnalyticalValue: { score: 2, rationale: 'r' },
            evidenceGrounding: { score: 2, rationale: 'r' },
            internalConsistency: { score: 2, rationale: 'r' },
          },
        },
      },
    ];

    const aggregates = aggregateWorkflowMetrics(mockRuns);

    assert.equal(aggregates.runsCount, 2);
    assert.equal(aggregates.schemaValidRate, 1.0); // 2/2
    assert.equal(aggregates.completionRate, 0.5);   // 1/2
    assert.equal(aggregates.fallbackRate, 0.5);     // 1/2
    assert.equal(aggregates.averageModelCalls, 5.0);
    assert.equal(aggregates.overallAverageQuality, 3.0); // (4 + 2) / 2
    assert.equal(aggregates.averageQualityByDimension.completeness, 3.0);
  });

  // Test 8: Missing scores or unavailable metrics are not silently treated as zero or perfect scores
  test('8. Missing scores or unassessed metrics are not silently treated as zero or perfect scores', () => {
    const emptyQuality = evaluateBlueprintQuality(null, getBenchmarkCase('crowded-market-weak-differentiation'), 'single_call');

    assert.equal(emptyQuality.averageScore, null, 'Empty evaluation must have null averageScore, not 0 or 5');
    assert.equal(emptyQuality.assessedDimensionsCount, 0);
    assert.equal(emptyQuality.unassessedDimensionsCount, 7);

    for (const dim of RUBRIC_DIMENSIONS) {
      assert.equal(emptyQuality.scores[dim.id].score, null, `Dimension ${dim.id} must be null when unassessed`);
      assert.ok(emptyQuality.scores[dim.id].rationale.includes('unassessed'));
    }

    // Verify isValidScore helper rejects 0, 6, -1, '5'
    assert.equal(isValidScore(0), false);
    assert.equal(isValidScore(6), false);
    assert.equal(isValidScore(-1), false);
    assert.equal(isValidScore('5'), false);
    assert.equal(isValidScore(null), true);
    assert.equal(isValidScore(3), true);
  });

  // Test 9: No live external API call is needed to run comparative evaluation
  test('9. No live external API call is needed to run comparative evaluation', async () => {
    const cases = getAllBenchmarkCases();

    const summary = await runComparativeEvaluation(cases);

    assert.equal(summary.evaluatedCasesCount, 12);
    assert.ok(summary.workflows.single_call);
    assert.ok(summary.workflows.council);

    // Verify single-call averaged 1 call per run
    assert.equal(summary.workflows.single_call.averageModelCalls, 1.0);
    assert.equal(summary.workflows.single_call.runsCount, 12);
    assert.equal(summary.workflows.single_call.schemaValidRate, 1.0);

    // Verify council averaged 5 calls per run
    assert.equal(summary.workflows.council.averageModelCalls, 5.0);
    assert.equal(summary.workflows.council.runsCount, 12);
    assert.equal(summary.workflows.council.schemaValidRate, 1.0);
    assert.equal(summary.workflows.council.fallbackRate, 0.0);

    // Verify formatted report contains operational trade-offs
    const reportText = formatEvaluationReport(summary);
    assert.ok(reportText.includes('Operational Comparison'));
    assert.ok(reportText.includes('5 calls (Council: 4 specialists + 1 synthesis) vs 1 call (Single-Call baseline)'));
    assert.ok(reportText.includes('Quality Dimension Averages'));
    assert.ok(reportText.includes('Per-Case Evaluation Breakdown'));
  });

  // Test 10: Existing single-call default and council opt-in behavior remain unchanged
  test('10. Existing single-call default and council opt-in behavior remain unchanged', async () => {
    let callCount = 0;
    const trackingMock = async () => {
      callCount++;
      return JSON.stringify({
        startupName: 'DefaultPathCo',
        tagline: 'Default tagline',
        summary: 'Default summary text for single call.',
        scores: {
          technicalFeasibility: 50, marketReadiness: 50, regulatoryRisk: 50,
          competitiveAdvantage: 50, executionComplexity: 50, scoreRationale: 'Rationale',
        },
        theReaper: [{ point: 'Risk' }],
        thePainMiner: [{ frustration: 'Pain' }],
        pricingArchitect: {
          starter: { price: '$10', features: ['f'] },
          pro: { price: '$20', features: ['f'] },
          enterprise: { price: '$50', features: ['f'] },
        },
        thePivotMaster: { winningEdge: 'Edge' },
      });
    };

    const bCase = getBenchmarkCase('crowded-market-weak-differentiation');

    // 1. Omitted useCouncil option -> single-call default
    callCount = 0;
    const defaultBlueprint = await analyzeIdeaBusinessBlueprint(
      bCase.idea, 'skills', 'time', 'budget', 'exp', null, null, null,
      {
        geminiFn: trackingMock,
        tavilySearchFn: async () => ({ context: '', urls: [], results: [] }),
      }
    );

    assert.equal(callCount, 1, 'Default invocation must make exactly 1 model call');
    assert.equal(defaultBlueprint.councilDiagnostics, undefined, 'Default path must not attach councilDiagnostics');

    // 2. Explicit useCouncil: false -> single-call default
    callCount = 0;
    const explicitFalseBlueprint = await analyzeIdeaBusinessBlueprint(
      bCase.idea, 'skills', 'time', 'budget', 'exp', null, null, null,
      {
        useCouncil: false,
        geminiFn: trackingMock,
        tavilySearchFn: async () => ({ context: '', urls: [], results: [] }),
      }
    );

    assert.equal(callCount, 1, 'Explicit useCouncil: false must make exactly 1 model call');
    assert.equal(explicitFalseBlueprint.councilDiagnostics, undefined);
  });

  // -------------------------------------------------------------------------
  // Phase 4C-2: Rubric Discrimination Tests
  // (These tests verify the rubric produces differentiated scores and can no
  //  longer collapse to a uniform 4 across all six blueprints.)
  // -------------------------------------------------------------------------

  // Test 11: distinctAnalyticalValue is workflow-aware
  test('11. distinctAnalyticalValue scores single_call ≤2 and council ≥3 for valid blueprints', () => {
    const bCase = getBenchmarkCase('crowded-market-weak-differentiation');

    const fullBlueprint = {
      startupName: 'TestCo',
      tagline: 'A test product',
      summary: 'Testing internal consistency.',
      scores: {
        technicalFeasibility: 80,
        marketReadiness: 50,
        regulatoryRisk: 30,
        competitiveAdvantage: 60,
        executionComplexity: 40,
        scoreRationale: 'Scores reflect solid technical feasibility and moderate market conditions.',
      },
      theReaper: [
        { point: 'Entrenched competitor Salesforce dominates with 20% market share.' },
        { point: 'Platform lock-in via API makes switching costs prohibitively high.' },
        { point: 'GDPR compliance requires expensive legal review in EU markets.' },
      ],
      thePainMiner: [
        { frustration: 'Developers spend over 4 hours per week on manual CRM data entry with zero automation.' },
        { frustration: 'Salesforce native integrations cost $150/user/mo, far exceeding SMB budgets.' },
      ],
      pricingArchitect: {
        starter: { price: '$12/mo', features: ['Core sync', 'Email alerts'] },
        pro: { price: '$39/mo', features: ['Advanced sync', 'Slack integration', 'Analytics'] },
        enterprise: { price: '$99/user/mo', features: ['SSO', 'Custom workflows', 'Dedicated support'] },
      },
      thePivotMaster: {
        winningEdge: 'Pivot from general CRM to a developer-native integration mesh that automates the full Salesforce data pipeline using GraphQL subscriptions, targeting engineering teams who are locked out of native automation at SMB price points.',
      },
      researchSources: ['https://market-intel.example.com/crm-automation'],
      ragGrounded: true,
      ragDiagnostics: { status: 'grounded', reason: 'OK' },
    };

    // single_call must score ≤2 for this dimension
    const singleQA = evaluateBlueprintQuality(fullBlueprint, bCase, 'single_call');
    assert.ok(
      singleQA.scores.distinctAnalyticalValue.score <= 2,
      `single_call distinctAnalyticalValue must be ≤2, got ${singleQA.scores.distinctAnalyticalValue.score}`
    );
    assert.ok(
      singleQA.scores.distinctAnalyticalValue.rationale.includes('single_call') ||
      singleQA.scores.distinctAnalyticalValue.rationale.toLowerCase().includes('single-call') ||
      singleQA.scores.distinctAnalyticalValue.rationale.toLowerCase().includes('no specialist'),
      'single_call rationale must explain absence of specialist separation'
    );

    // council must score ≥3 for the same blueprint
    const councilQA = evaluateBlueprintQuality(fullBlueprint, bCase, 'council');
    assert.ok(
      councilQA.scores.distinctAnalyticalValue.score >= 3,
      `council distinctAnalyticalValue must be ≥3, got ${councilQA.scores.distinctAnalyticalValue.score}`
    );
  });

  // Test 12: problemSpecificity discriminates between generic and specific pain text
  test('12. problemSpecificity produces score 2 for generic text and score ≥4 for specific, signal-rich text', () => {
    const bCase = getBenchmarkCase('crowded-market-weak-differentiation');

    const genericBlueprint = {
      startupName: 'X',
      tagline: 'x',
      summary: 'x',
      scores: { technicalFeasibility: 50, marketReadiness: 50, scoreRationale: 'ok' },
      theReaper: [{ point: 'Some risk' }],
      thePainMiner: [
        { frustration: 'Users have a generic problem with productivity.' },
        { frustration: 'Teams face general workflow challenges.' },
      ],
      pricingArchitect: {
        starter: { price: '$10', features: ['f1'] },
        pro: { price: '$20', features: ['f2'] },
        enterprise: { price: '$50', features: ['f3'] },
      },
      thePivotMaster: { winningEdge: 'Do marketing better and grow the user base.' },
    };

    const specificBlueprint = {
      startupName: 'Y',
      tagline: 'y',
      summary: 'y',
      scores: { technicalFeasibility: 50, marketReadiness: 50, scoreRationale: 'ok' },
      theReaper: [{ point: 'Zoom AI Companion and Microsoft Teams Copilot bundle native summaries at $0.' }],
      thePainMiner: [
        { frustration: 'Engineering teams at 500+ employee companies spend 4 hours/week on manual JIRA ticket updates due to Salesforce <> GitHub sync gaps, costing $120/developer/mo in lost productivity.' },
        { frustration: 'HIPAA-regulated healthcare teams cannot use Zoom AI Companion because it stores transcripts on non-BAA-compliant servers, forcing 3-person manual notetaking rotations.' },
        { frustration: 'With over 60 meeting AI tools in the market, procurement teams at Fortune 500 companies spend 6 weeks on vendor evaluation, delaying deployment by an average of 2 quarters.' },
      ],
      pricingArchitect: {
        starter: { price: '$15/mo', features: ['f1'] },
        pro: { price: '$39/mo', features: ['f2'] },
        enterprise: { price: '$99/user/mo', features: ['f3'] },
      },
      thePivotMaster: { winningEdge: 'Pivot to HIPAA-compliant vertical.' },
    };

    const genericQA = evaluateBlueprintQuality(genericBlueprint, bCase, 'single_call');
    assert.equal(
      genericQA.scores.problemSpecificity.score, 2,
      `Generic pain text must score 2, got ${genericQA.scores.problemSpecificity.score}`
    );

    const specificQA = evaluateBlueprintQuality(specificBlueprint, bCase, 'single_call');
    assert.ok(
      specificQA.scores.problemSpecificity.score >= 4,
      `Specific, signal-rich pain text must score ≥4, got ${specificQA.scores.problemSpecificity.score}`
    );
  });

  // Test 13: evidenceGrounding detects evidence markers and RAG status separately
  test('13. evidenceGrounding scores 5 when RAG-grounded with in-text marker, 3 when only sources listed, 2 when absent', () => {
    const bCase = getBenchmarkCase('crowded-market-weak-differentiation');

    const baseBlueprint = {
      startupName: 'X', tagline: 'x', summary: 'Plain summary without sources.',
      scores: { technicalFeasibility: 50, marketReadiness: 50, scoreRationale: 'ok' },
      theReaper: [{ point: 'Risk' }],
      thePainMiner: [{ frustration: 'Pain without any citations or research markers [MARKER_CASE_1_TEST_0001].' }],
      pricingArchitect: {
        starter: { price: '$10', features: ['f1'] },
        pro: { price: '$20', features: ['f2'] },
        enterprise: { price: '$50', features: ['f3'] },
      },
      thePivotMaster: { winningEdge: 'Pivot strategy with evidence grounding.' },
    };

    // No sources, not grounded -> score 2
    const noSourceBP = { ...baseBlueprint };
    const noSourceQA = evaluateBlueprintQuality(noSourceBP, bCase, 'single_call');
    assert.ok(
      noSourceQA.scores.evidenceGrounding.score <= 3,
      `No sources must score ≤3, got ${noSourceQA.scores.evidenceGrounding.score}`
    );

    // Sources listed + RAG grounded + in-text marker -> score 5
    const fullGroundedBP = {
      ...baseBlueprint,
      researchSources: ['https://market-intel.example.com/test-evidence'],
      ragGrounded: true,
      ragDiagnostics: { status: 'grounded', reason: 'OK' },
    };
    const fullGroundedQA = evaluateBlueprintQuality(fullGroundedBP, bCase, 'single_call');
    assert.equal(
      fullGroundedQA.scores.evidenceGrounding.score, 5,
      `RAG-grounded with marker must score 5, got ${fullGroundedQA.scores.evidenceGrounding.score}`
    );

    // Sources listed + RAG grounded but NO in-text marker -> score 4
    const noMarkerBP = {
      ...baseBlueprint,
      thePainMiner: [{ frustration: 'Pain without any marker in the text.' }],
      researchSources: ['https://market-intel.example.com/test-evidence'],
      ragGrounded: true,
      ragDiagnostics: { status: 'grounded', reason: 'OK' },
    };
    const noMarkerQA = evaluateBlueprintQuality(noMarkerBP, bCase, 'single_call');
    assert.equal(
      noMarkerQA.scores.evidenceGrounding.score, 4,
      `Grounded without marker must score 4, got ${noMarkerQA.scores.evidenceGrounding.score}`
    );
  });

  // Test 14: internalConsistency flags contradictions
  test('14. internalConsistency scores ≤3 when quantitative scores contradict narrative claims', () => {
    const bCase = getBenchmarkCase('crowded-market-weak-differentiation');

    // Blueprint with very low competitive advantage but pivot claims dominance
    const contradictoryBlueprint = {
      startupName: 'ContradictCo',
      tagline: 'A contradictory analysis',
      summary: 'Summary.',
      scores: {
        technicalFeasibility: 70,
        marketReadiness: 30,
        regulatoryRisk: 50,
        competitiveAdvantage: 10, // very low
        executionComplexity: 50,
        scoreRationale: 'Scores are assigned.',
      },
      theReaper: [{ point: 'Stiff competition from entrenched rivals.' }],
      thePainMiner: [{ frustration: 'Users struggle with expensive alternatives.' }],
      pricingArchitect: {
        starter: { price: '$199/mo', features: ['Premium tier'] }, // high price with low market readiness
        pro: { price: '$499/mo', features: ['Enterprise premium'] },
        enterprise: { price: '$999/mo', features: ['Dedicated'] },
      },
      thePivotMaster: {
        winningEdge: 'We will dominate the market and crush all competitors to become the unrivalled leader.', // claims dominance with CA=10
      },
    };

    const qa = evaluateBlueprintQuality(contradictoryBlueprint, bCase, 'single_call');
    assert.ok(
      qa.scores.internalConsistency.score <= 3,
      `Contradictory blueprint must score ≤3 on internalConsistency, got ${qa.scores.internalConsistency.score}`
    );
    assert.ok(
      qa.scores.internalConsistency.rationale.toLowerCase().includes('contrad') ||
      qa.scores.internalConsistency.rationale.toLowerCase().includes('tension'),
      'Rationale must describe the contradiction or tension'
    );
  });

  // Test 15: completeness scores 4 (thin) vs 5 (substantive) based on persona word count
  test('15. completeness scores 4 for thin persona sections and 5 for substantive ones', () => {
    const bCase = getBenchmarkCase('crowded-market-weak-differentiation');

    const thinBlueprint = {
      startupName: 'ThinCo',
      tagline: 'Thin content test',
      summary: 'A company.',
      scores: { technicalFeasibility: 50, marketReadiness: 50, scoreRationale: 'Valid rationale here.' },
      theReaper: [{ point: 'Short.' }],
      thePainMiner: [{ frustration: 'Brief.' }],
      pricingArchitect: {
        starter: { price: '$10', features: ['f'] },
        pro: { price: '$20', features: ['f'] },
        enterprise: { price: '$50', features: ['f'] },
      },
      thePivotMaster: { winningEdge: 'Ok.' },
    };

    const thinQA = evaluateBlueprintQuality(thinBlueprint, bCase, 'single_call');
    assert.equal(
      thinQA.scores.completeness.score, 4,
      `Thin persona sections must score 4, got ${thinQA.scores.completeness.score}`
    );

    const substantiveBlueprint = {
      ...thinBlueprint,
      theReaper: [
        { point: 'First major risk: The market is completely dominated by Salesforce, Microsoft, and HubSpot, each commanding between 15 to 35 percent of their respective verticals with deeply embedded enterprise contracts that auto-renew annually.' },
        { point: 'Second major risk: Open-source CRM alternatives like SuiteCRM and EspoCRM offer equivalent core functionality at zero license cost, creating a floor-price collapse that makes any entry-level paid tier commercially unsustainable without differentiation.' },
      ],
      thePainMiner: [
        { frustration: 'Enterprise procurement teams spend an average of 12 weeks evaluating CRM vendors, requiring at minimum 3 rounds of pilot testing, security review, legal review, and executive sign-off before any tool reaches production deployment.' },
        { frustration: 'Small engineering teams lose 6 to 8 hours per developer per month to manual CRM data hygiene tasks because existing API integrations lack bidirectional sync support between GitHub pull requests and Salesforce opportunity records.' },
      ],
      thePivotMaster: {
        winningEdge: 'Abandon general CRM positioning entirely and pivot to a developer-native integration mesh that automates bidirectional Salesforce and GitHub sync using GraphQL subscriptions, targeting seed-stage B2B SaaS companies whose engineering teams are under-served by Salesforce native tools and cannot afford enterprise-tier Zapier plans at $600 per month.',
      },
    };

    const substantiveQA = evaluateBlueprintQuality(substantiveBlueprint, bCase, 'single_call');
    assert.equal(
      substantiveQA.scores.completeness.score, 5,
      `Substantive persona sections must score 5, got ${substantiveQA.scores.completeness.score}`
    );
  });

  // -------------------------------------------------------------------------
  // Phase 4C-3: Fair Evaluation Metrics Tests
  // -------------------------------------------------------------------------

  // Test 16: Identical shared-dimension content produces identical sharedAverageScore for both workflows
  test('16. Identical shared-dimension content produces identical sharedAverageScore for single_call and council', () => {
    const bCase = getBenchmarkCase('crowded-market-weak-differentiation');

    const blueprint = {
      startupName: 'SharedBenchmarkCo',
      tagline: 'Developer-native CRM sync platform',
      summary: 'Automated bidirectional data sync between Salesforce and GitHub pull requests.',
      scores: {
        technicalFeasibility: 75,
        marketReadiness: 65,
        regulatoryRisk: 30,
        competitiveAdvantage: 70,
        executionComplexity: 45,
        scoreRationale: 'Strong technical grounding with established API webhooks; high competition acknowledged in go-to-market plan.',
      },
      pricingArchitect: {
        starter: { price: '$49/mo', features: ['5 repos', 'Standard webhooks'] },
        pro: { price: '$199/mo', features: ['Unlimited repos', 'GraphQL subscription mesh'] },
        enterprise: { price: '$999/mo', features: ['Custom field mapping', 'Dedicated VPC', 'SSO'] },
      },
      theReaper: [
        { point: 'Salesforce native tooling or Microsoft Copilot bundle CRM integration directly into workspace tiers at nominal marginal cost.' },
        { point: 'GitHub API breaking changes or rate-limiting on enterprise orgs could interrupt sync pipelines without custom cache architecture.' },
      ],
      thePainMiner: [
        { frustration: 'Engineering leaders spend 8 hours per sprint reconciling manual Jira status updates with CRM sales stages.' },
        { frustration: 'Enterprise developers lack visibility into which pull requests correspond to pipeline deals, stalling enterprise closes.' },
      ],
      thePivotMaster: {
        winningEdge: 'Focus exclusively on developer teams building mission-critical B2B pipelines where compliance audit trails between code and CRM records are mandatory.',
      },
      researchSources: ['https://example.com/crm-developer-market'],
      ragGrounded: true,
      ragDiagnostics: { status: 'grounded', reason: 'OK' },
    };

    const singleQA = evaluateBlueprintQuality(blueprint, bCase, 'single_call');
    const councilQA = evaluateBlueprintQuality(blueprint, bCase, 'council');

    // Verify distinctAnalyticalValue differs due to workflow structure
    assert.ok(singleQA.scores.distinctAnalyticalValue.score <= 2, 'single_call distinctAnalyticalValue must be <= 2');
    assert.ok(councilQA.scores.distinctAnalyticalValue.score >= 3, 'council distinctAnalyticalValue must be >= 3');

    // Legacy averageScore favored council because of distinctAnalyticalValue
    assert.notEqual(
      singleQA.averageScore,
      councilQA.averageScore,
      'Legacy averageScore differs because it includes distinctAnalyticalValue'
    );
    assert.ok(
      councilQA.averageScore > singleQA.averageScore,
      'Legacy averageScore mechanically favored council'
    );

    // CRITICAL: sharedAverageScore must be strictly identical between single_call and council
    assert.equal(
      singleQA.sharedAverageScore,
      councilQA.sharedAverageScore,
      'sharedAverageScore must be identical for single_call and council given identical shared content'
    );
    assert.equal(typeof singleQA.sharedAverageScore, 'number');
    assert.ok(singleQA.sharedAverageScore >= VALID_SCORE_MIN && singleQA.sharedAverageScore <= VALID_SCORE_MAX);
    assert.equal(singleQA.assessedSharedDimensionsCount, 6);
    assert.equal(councilQA.assessedSharedDimensionsCount, 6);
  });

  // Test 17: Changing only distinctAnalyticalValue does not change sharedAverageScore
  test('17. Changing only distinctAnalyticalValue does not alter sharedAverageScore', () => {
    const bCase = getBenchmarkCase('crowded-market-weak-differentiation');

    const blueprint = {
      startupName: 'IsoMetricCo',
      tagline: 'Test platform',
      summary: 'Test summary',
      scores: { technicalFeasibility: 50, marketReadiness: 50, scoreRationale: 'Rationale' },
    };

    // Fix the 6 shared dimensions to explicit constant manual scores
    const fixedSharedScores = {
      completeness: { score: 4, rationale: 'Standard completeness' },
      problemSpecificity: { score: 4, rationale: 'Standard specificity' },
      commercialReasoning: { score: 4, rationale: 'Standard pricing' },
      riskAndFeasibility: { score: 4, rationale: 'Standard risk' },
      evidenceGrounding: { score: 4, rationale: 'Standard grounding' },
      internalConsistency: { score: 4, rationale: 'Standard consistency' },
    };

    const expectedSharedMean = 4.0;

    // Test across distinctAnalyticalValue = 1, 2, 3, 4, 5, and null
    const diversityVariations = [1, 2, 3, 4, 5, null];

    for (const diversityScore of diversityVariations) {
      const manualScores = {
        ...fixedSharedScores,
        distinctAnalyticalValue: {
          score: diversityScore,
          rationale: `Diversity variation score ${diversityScore}`,
        },
      };

      const result = evaluateBlueprintQuality(blueprint, bCase, 'council', { manualScores });

      // sharedAverageScore must stay exactly 4.0 regardless of distinctAnalyticalValue
      assert.equal(
        result.sharedAverageScore,
        expectedSharedMean,
        `sharedAverageScore must remain 4.0 when distinctAnalyticalValue is ${diversityScore}`
      );

      // architecturalDiversityScore must faithfully reflect the diversity dimension
      assert.equal(
        result.architecturalDiversityScore,
        diversityScore,
        `architecturalDiversityScore must match ${diversityScore}`
      );

      // Legacy averageScore reflects the 7th dimension
      if (diversityScore !== null) {
        const expectedLegacy = Number(((24 + diversityScore) / 7).toFixed(2));
        assert.equal(result.averageScore, expectedLegacy);
      } else {
        // If 7th dimension is null, legacy average is 24/6 = 4.0
        assert.equal(result.averageScore, 4.0);
      }
    }
  });

  // Test 18: Missing, null, or invalid scores are handled honestly without default coercion
  test('18. Missing, unassessed, or partially assessed shared dimensions are handled honestly', () => {
    const bCase = getBenchmarkCase('specific-problem-uncertain-wtp');

    // Blueprint evaluated with null payload produces null for both averages
    const nullPayloadResult = evaluateBlueprintQuality(null, bCase, 'single_call');
    assert.equal(nullPayloadResult.sharedAverageScore, null, 'Null blueprint must have null sharedAverageScore');
    assert.equal(nullPayloadResult.averageScore, null, 'Null blueprint must have null legacy averageScore');
    assert.equal(nullPayloadResult.assessedSharedDimensionsCount, 0);
    assert.equal(nullPayloadResult.unassessedSharedDimensionsCount, 6);
    assert.equal(nullPayloadResult.architecturalDiversityScore, null);

    // Partially assessed blueprint: 3 assessed shared dimensions (scores: 3, 4, 5) and 3 null
    const partiallyAssessedScores = {
      completeness: { score: 3, rationale: 'Assessed' },
      problemSpecificity: { score: 4, rationale: 'Assessed' },
      commercialReasoning: { score: 5, rationale: 'Assessed' },
      riskAndFeasibility: { score: null, rationale: 'Unassessed' },
      evidenceGrounding: { score: null, rationale: 'Unassessed' },
      internalConsistency: { score: null, rationale: 'Unassessed' },
      distinctAnalyticalValue: { score: 1, rationale: 'Diversity' },
    };

    const partialResult = evaluateBlueprintQuality(
      { startupName: 'Part', tagline: 'P', summary: 'S' },
      bCase,
      'single_call',
      { manualScores: partiallyAssessedScores }
    );

    // Shared average should be (3 + 4 + 5) / 3 = 4.0
    assert.equal(partialResult.sharedAverageScore, 4.0, 'Partial shared average must average only assessed shared dimensions');
    assert.equal(partialResult.assessedSharedDimensionsCount, 3);
    assert.equal(partialResult.unassessedSharedDimensionsCount, 3);

    // Output with ALL shared dimensions unassessed has null sharedAverageScore
    const allSharedNull = {
      completeness: { score: null, rationale: 'Unassessed' },
      problemSpecificity: { score: null, rationale: 'Unassessed' },
      commercialReasoning: { score: null, rationale: 'Unassessed' },
      riskAndFeasibility: { score: null, rationale: 'Unassessed' },
      evidenceGrounding: { score: null, rationale: 'Unassessed' },
      internalConsistency: { score: null, rationale: 'Unassessed' },
      distinctAnalyticalValue: { score: 4, rationale: 'Assessed diversity' },
    };

    const allNullResult = evaluateBlueprintQuality(
      { startupName: 'AllNull', tagline: 'A', summary: 'S' },
      bCase,
      'single_call',
      { manualScores: allSharedNull }
    );

    assert.equal(allNullResult.sharedAverageScore, null, 'Must be null when no shared dimensions are assessable');
    assert.equal(allNullResult.assessedSharedDimensionsCount, 0);
    assert.equal(allNullResult.unassessedSharedDimensionsCount, 6);
    assert.equal(allNullResult.architecturalDiversityScore, 4);
    assert.equal(allNullResult.averageScore, 4.0, 'Legacy average reflects the lone assessed dimension');
  });

  // Test 19: Workflow aggregation calculates overallSharedAverageQuality and averageArchitecturalDiversity
  test('19. Workflow aggregation separates shared quality from architectural diversity for fair comparison', () => {
    // Two mock runs for single_call and council where shared dimensions are equal in quality (all 4)
    // but distinctAnalyticalValue reflects architectural differences (2 for single_call, 5 for council)
    const singleCallRuns = [
      {
        workflow: 'single_call',
        completed: true,
        fallbackUsed: false,
        schemaValid: true,
        modelCallCount: 1,
        qualityAssessment: {
          scores: {
            completeness: { score: 4, rationale: 'r' },
            problemSpecificity: { score: 4, rationale: 'r' },
            commercialReasoning: { score: 4, rationale: 'r' },
            riskAndFeasibility: { score: 4, rationale: 'r' },
            distinctAnalyticalValue: { score: 2, rationale: 'No persona separation by design' },
            evidenceGrounding: { score: 4, rationale: 'r' },
            internalConsistency: { score: 4, rationale: 'r' },
          },
        },
      },
    ];

    const councilRuns = [
      {
        workflow: 'council',
        completed: true,
        fallbackUsed: false,
        schemaValid: true,
        modelCallCount: 5,
        qualityAssessment: {
          scores: {
            completeness: { score: 4, rationale: 'r' },
            problemSpecificity: { score: 4, rationale: 'r' },
            commercialReasoning: { score: 4, rationale: 'r' },
            riskAndFeasibility: { score: 4, rationale: 'r' },
            distinctAnalyticalValue: { score: 5, rationale: 'High specialist divergence' },
            evidenceGrounding: { score: 4, rationale: 'r' },
            internalConsistency: { score: 4, rationale: 'r' },
          },
        },
      },
    ];

    const scAgg = aggregateWorkflowMetrics(singleCallRuns);
    const ccAgg = aggregateWorkflowMetrics(councilRuns);

    // Primary fair comparison metric: overallSharedAverageQuality must be equal
    assert.equal(scAgg.overallSharedAverageQuality, 4.0, 'Single-call shared quality must be 4.0');
    assert.equal(ccAgg.overallSharedAverageQuality, 4.0, 'Council shared quality must be 4.0');
    assert.equal(
      scAgg.overallSharedAverageQuality,
      ccAgg.overallSharedAverageQuality,
      'Fair comparison metric must show identical shared quality when analytical content is equal'
    );

    // Architectural diversity is reported separately
    assert.equal(scAgg.averageArchitecturalDiversity, 2.0);
    assert.equal(ccAgg.averageArchitecturalDiversity, 5.0);

    // Legacy metric shows the historical architectural bias
    assert.equal(scAgg.overallAverageQuality, Number((26 / 7).toFixed(2))); // ~3.71
    assert.equal(ccAgg.overallAverageQuality, Number((29 / 7).toFixed(2))); // ~4.14
    assert.ok(
      ccAgg.overallAverageQuality > scAgg.overallAverageQuality,
      'Legacy metric shows mechanical council advantage that fair metric eliminates'
    );
  });

  // Test 20: Formatted report cleanly separates shared quality from architectural diversity
  test('20. Formatted report displays Shared Quality Score and Architectural Diversity Score separately', () => {
    const summary = {
      evaluatedCasesCount: 1,
      workflows: {
        single_call: {
          runsCount: 1,
          schemaValidRate: 1.0,
          completionRate: 1.0,
          fallbackRate: 0.0,
          averageModelCalls: 1.0,
          overallSharedAverageQuality: 4.25,
          averageArchitecturalDiversity: 2.0,
          overallAverageQuality: 3.93,
          averageQualityByDimension: {
            completeness: 4.0,
            problemSpecificity: 4.0,
            commercialReasoning: 4.0,
            riskAndFeasibility: 4.0,
            distinctAnalyticalValue: 2.0,
            evidenceGrounding: 5.0,
            internalConsistency: 4.5,
          },
          perCaseResults: [
            {
              caseId: 'test-case-1',
              caseName: 'Test Case 1',
              modelCallCount: 1,
              schemaValid: true,
              qualityAssessment: {
                sharedAverageScore: 4.25,
                architecturalDiversityScore: 2.0,
                averageScore: 3.93,
              },
            },
          ],
        },
        council: {
          runsCount: 1,
          schemaValidRate: 1.0,
          completionRate: 1.0,
          fallbackRate: 0.0,
          averageModelCalls: 5.0,
          overallSharedAverageQuality: 4.25,
          averageArchitecturalDiversity: 4.0,
          overallAverageQuality: 4.21,
          averageQualityByDimension: {
            completeness: 4.0,
            problemSpecificity: 4.0,
            commercialReasoning: 4.0,
            riskAndFeasibility: 4.0,
            distinctAnalyticalValue: 4.0,
            evidenceGrounding: 5.0,
            internalConsistency: 4.5,
          },
          perCaseResults: [
            {
              caseId: 'test-case-1',
              caseName: 'Test Case 1',
              modelCallCount: 5,
              schemaValid: true,
              fallbackUsed: false,
              qualityAssessment: {
                sharedAverageScore: 4.25,
                architecturalDiversityScore: 4.0,
                averageScore: 4.21,
              },
            },
          ],
        },
      },
      operationalTradeoff: {
        modelCallRatio: '5 calls vs 1 call',
        latencyNote: 'Mocked durations',
        tokenUsageNote: 'Token counts unavailable',
      },
    };

    const report = formatEvaluationReport(summary);

    // Check headings and sections
    assert.ok(report.includes('Operational Comparison'));
    assert.ok(report.includes('Shared Quality Score (Fair Comparison)'));
    assert.ok(report.includes('Architectural Diversity Score'));
    assert.ok(report.includes('Legacy Overall Average (7-dimension)'));
    assert.ok(report.includes('Fair Comparison Notice'));
    assert.ok(report.includes('[Shared]'));
    assert.ok(report.includes('[Architectural Diversity]'));
    assert.ok(report.includes('Shared Quality: 4.25'));
    assert.ok(report.includes('Diversity: 2'));
    assert.ok(report.includes('Diversity: 4'));
  });

  // Test 21: Backward compatibility of output shapes, manual overrides, and exported symbols
  test('21. Backward compatibility: existing contracts, exported symbols, and manual overrides remain intact', () => {
    // 1. Verify exported constants
    assert.equal(BENCHMARK_DATASET_VERSION, '2.0.0');
    assert.deepEqual(HISTORICAL_PILOT_CASE_IDS, [
      'crowded-market-weak-differentiation',
      'specific-problem-uncertain-wtp',
      'attractive-idea-high-regulatory-risk',
    ]);
    assert.ok(Array.isArray(SHARED_DIMENSION_IDS));
    assert.equal(SHARED_DIMENSION_IDS.length, 6);
    assert.ok(Array.isArray(ARCHITECTURAL_DIMENSION_IDS));
    assert.equal(ARCHITECTURAL_DIMENSION_IDS.length, 1);
    assert.equal(ARCHITECTURAL_DIMENSION_IDS[0], 'distinctAnalyticalValue');

    // 2. Verify return structure of evaluateBlueprintQuality
    const bCase = getBenchmarkCase('crowded-market-weak-differentiation');
    const result = evaluateBlueprintQuality(
      {
        startupName: 'CompatTest',
        tagline: 'Tag',
        summary: 'Summary',
        scores: { technicalFeasibility: 50, marketReadiness: 50, scoreRationale: 'Rationale' },
      },
      bCase,
      'single_call'
    );

    assert.ok(result.hasOwnProperty('scores'), 'Must have scores');
    assert.ok(result.hasOwnProperty('averageScore'), 'Must preserve legacy averageScore');
    assert.ok(result.hasOwnProperty('sharedAverageScore'), 'Must have sharedAverageScore');
    assert.ok(result.hasOwnProperty('assessedDimensionsCount'), 'Must preserve assessedDimensionsCount');
    assert.ok(result.hasOwnProperty('unassessedDimensionsCount'), 'Must preserve unassessedDimensionsCount');
    assert.ok(result.hasOwnProperty('assessedSharedDimensionsCount'), 'Must have assessedSharedDimensionsCount');
    assert.ok(result.hasOwnProperty('unassessedSharedDimensionsCount'), 'Must have unassessedSharedDimensionsCount');
    assert.ok(result.hasOwnProperty('architecturalDiversityScore'), 'Must have architecturalDiversityScore');

    // 3. Verify manual score overrides work identically
    const manualResult = evaluateBlueprintQuality(
      { startupName: 'M', tagline: 'm', summary: 's' },
      bCase,
      'single_call',
      {
        manualScores: {
          problemSpecificity: { score: 5, rationale: 'Manual override specificity' },
        },
      }
    );
    assert.equal(manualResult.scores.problemSpecificity.score, 5);
    assert.equal(manualResult.scores.problemSpecificity.rationale, 'Manual override specificity');
  });

  // Test 22: Phase 4C-7 Expanded 12-case benchmark contract and safety verification
  test('22. Phase 4C-7: Expanded 12-case benchmark contract and safety verification', async () => {
    const cases = getAllBenchmarkCases();

    // 1. Exactly 12 benchmark cases are returned by canonical dataset API
    assert.equal(cases.length, 12, 'Exactly 12 benchmark cases must be returned');

    // 2. All case IDs are unique
    const caseIds = cases.map((c) => c.id);
    const uniqueIds = new Set(caseIds);
    assert.equal(uniqueIds.size, 12, 'All 12 case IDs must be unique');

    // 3. The three historical case IDs remain unchanged and present
    const expectedHistoricalIds = [
      'crowded-market-weak-differentiation',
      'specific-problem-uncertain-wtp',
      'attractive-idea-high-regulatory-risk',
    ];
    for (const hId of expectedHistoricalIds) {
      assert.ok(caseIds.includes(hId), `Historical case ID "${hId}" must be present`);
      const hCase = getBenchmarkCase(hId);
      assert.equal(hCase.id, hId);
    }

    // 4, 5, 6, 7, 8. Check schema fields, challenges, behaviors, synthetic labels, diagnostic dimensions, no hard-coded winner
    const challenges = new Set();
    for (const bCase of cases) {
      assert.ok(bCase.id && typeof bCase.id === 'string', 'Case must have string id');
      assert.ok(bCase.name && typeof bCase.name === 'string', 'Case must have string name');
      assert.ok(bCase.category && typeof bCase.category === 'string', 'Case must have string category');

      // Idea contract
      assert.ok(bCase.idea && typeof bCase.idea === 'object');
      assert.ok(bCase.idea.title && typeof bCase.idea.title === 'string');
      assert.ok(bCase.idea.problem && typeof bCase.idea.problem === 'string');
      assert.ok(bCase.idea.solution && typeof bCase.idea.solution === 'string');

      // Profile & Research
      assert.ok(bCase.userProfile && typeof bCase.userProfile === 'object');
      assert.ok(Array.isArray(bCase.researchSources) && bCase.researchSources.length > 0);
      assert.ok(typeof bCase.researchContext === 'string' && bCase.researchContext.includes('Source 1'));

      // 6. Synthetic research context clearly labelled
      assert.ok(
        bCase.researchContext.includes('[SYNTHETIC BENCHMARK FIXTURE]'),
        `Case "${bCase.id}" must clearly label synthetic research context`
      );

      // 5. Distinct, non-empty reasoning challenges and expected behaviours
      assert.ok(
        typeof bCase.analyticalChallenge === 'string' && bCase.analyticalChallenge.trim().length > 10,
        `Case "${bCase.id}" must have non-empty analyticalChallenge`
      );
      assert.ok(!challenges.has(bCase.analyticalChallenge), `Analytical challenge for "${bCase.id}" must be distinct`);
      challenges.add(bCase.analyticalChallenge);

      assert.ok(
        Array.isArray(bCase.expectedStrongBehaviors) && bCase.expectedStrongBehaviors.length >= 2,
        `Case "${bCase.id}" must have at least 2 expectedStrongBehaviors`
      );
      for (const behavior of bCase.expectedStrongBehaviors) {
        assert.ok(typeof behavior === 'string' && behavior.trim(), 'Behaviors must be non-empty strings');
      }

      assert.ok(
        Array.isArray(bCase.importantFailureSignals) && bCase.importantFailureSignals.length >= 2,
        `Case "${bCase.id}" must have at least 2 importantFailureSignals`
      );
      for (const signal of bCase.importantFailureSignals) {
        assert.ok(typeof signal === 'string' && signal.trim(), 'Failure signals must be non-empty strings');
      }

      // 7. Case-specific diagnostic dimensions refer only to valid shared dimensions
      assert.ok(
        Array.isArray(bCase.diagnosticDimensions) && bCase.diagnosticDimensions.length > 0,
        `Case "${bCase.id}" must specify diagnosticDimensions`
      );
      for (const dim of bCase.diagnosticDimensions) {
        assert.ok(
          SHARED_DIMENSION_IDS.includes(dim),
          `Diagnostic dimension "${dim}" in case "${bCase.id}" must be a valid shared dimension (${SHARED_DIMENSION_IDS.join(', ')})`
        );
      }

      // Considerations & Mock responses
      assert.ok(bCase.evaluationConsiderations && typeof bCase.evaluationConsiderations === 'object');
      assert.ok(bCase.mockResponses && typeof bCase.mockResponses === 'object');
      assert.ok(bCase.mockResponses.singleCall && typeof bCase.mockResponses.singleCall === 'object');
      assert.ok(bCase.mockResponses.council && typeof bCase.mockResponses.council === 'object');
      assert.ok(bCase.mockResponses.council.synthesis && typeof bCase.mockResponses.council.synthesis === 'object');

      // 8. No case encodes a hard-coded workflow winner
      assert.equal(bCase.winner, undefined, `Case "${bCase.id}" must not encode a hard-coded winner`);
      assert.equal(bCase.mockResponses.winner, undefined, `Case "${bCase.id}" mockResponses must not encode a hard-coded winner`);
    }

    // 9. Historical artifact case lookups continue to work
    for (const hId of expectedHistoricalIds) {
      const historicalCase = getBenchmarkCase(hId);
      assert.equal(historicalCase.id, hId);
      assert.ok(historicalCase.mockResponses.singleCall.startupName);
      assert.ok(historicalCase.mockResponses.council.synthesis.startupName);
    }

    // 10. The dataset can be loaded and evaluated without provider credentials, network access, or database access
    const mockGemini = createDeterministicMockGemini('technical-infeasibility-complexity');
    assert.equal(typeof mockGemini, 'function');
    const singleResult = await runCaseEvaluation(getBenchmarkCase('technical-infeasibility-complexity'), 'single_call');
    assert.equal(singleResult.completed, true);
    assert.equal(singleResult.schemaValid, true);
    assert.equal(singleResult.modelCallCount, 1);
  });

  // Test 23: Phase 4C-8 Benchmark Integrity, Information Symmetry, and Persona Contract Audit
  test('23. Phase 4C-8: Benchmark integrity, information symmetry, and persona contract audit', async () => {
    const cases = getAllBenchmarkCases();
    assert.equal(cases.length, 12, 'Must audit exactly 12 cases');

    let scWinsOrTies = 0;

    for (const bCase of cases) {
      // 1. Explicit targetBuyer on idea across all 12 cases
      assert.ok(
        typeof bCase.idea.targetBuyer === 'string' && bCase.idea.targetBuyer.trim().length > 0,
        `Case "${bCase.id}" must have explicit targetBuyer on idea object`
      );

      // 2. Scenario integrity: No leading answer or verdict leakage in problem/solution
      const scenarioText = `${bCase.idea.title} ${bCase.idea.problem} ${bCase.idea.solution}`.toLowerCase();
      assert.ok(!scenarioText.includes('recommended pivot'), `Case "${bCase.id}" must not leak pivot recommendations in problem/solution`);
      assert.ok(!scenarioText.includes('winning workflow'), `Case "${bCase.id}" must not leak workflow preferences`);

      // 3. Exact Council Persona Schemas
      const r = bCase.mockResponses.council.personaReaper;
      assert.ok(r && Array.isArray(r.theReaper) && r.theReaper.length >= 2, `personaReaper in "${bCase.id}" must have valid theReaper array`);
      for (const pt of r.theReaper) {
        assert.ok(typeof pt.point === 'string' && pt.point.trim().length > 10, 'Reaper point must be substantive');
      }

      const p = bCase.mockResponses.council.personaPainMiner;
      assert.ok(p && Array.isArray(p.thePainMiner) && p.thePainMiner.length >= 2, `personaPainMiner in "${bCase.id}" must have valid thePainMiner array`);
      for (const fr of p.thePainMiner) {
        assert.ok(typeof fr.frustration === 'string' && fr.frustration.trim().length > 10, 'PainMiner frustration must be substantive');
      }

      const pr = bCase.mockResponses.council.personaPricingArchitect;
      assert.ok(pr && pr.pricingArchitect && typeof pr.pricingArchitect === 'object', `personaPricingArchitect in "${bCase.id}" must have pricingArchitect`);
      for (const tier of ['starter', 'pro', 'enterprise']) {
        assert.ok(pr.pricingArchitect[tier] && typeof pr.pricingArchitect[tier].price === 'string', `Pricing tier ${tier} must have price in "${bCase.id}"`);
        assert.ok(Array.isArray(pr.pricingArchitect[tier].features) && pr.pricingArchitect[tier].features.length > 0, `Pricing tier ${tier} must have features in "${bCase.id}"`);
      }

      const pv = bCase.mockResponses.council.personaPivotMaster;
      assert.ok(pv && pv.thePivotMaster && typeof pv.thePivotMaster.winningEdge === 'string', `personaPivotMaster in "${bCase.id}" must have thePivotMaster.winningEdge`);
      assert.ok(pv.thePivotMaster.winningEdge.trim().length > 20, 'winningEdge must be substantive');

      // 4. Quality evaluation symmetry: single-call is not a weak strawman
      const scQuality = evaluateBlueprintQuality(bCase.mockResponses.singleCall, bCase, 'single_call');
      const ccQuality = evaluateBlueprintQuality(bCase.mockResponses.council.synthesis, bCase, 'council');

      assert.ok(scQuality.sharedAverageScore >= 3.5, `Single-call shared average (${scQuality.sharedAverageScore}) in "${bCase.id}" must meet substantive baseline`);
      assert.ok(ccQuality.sharedAverageScore >= 3.5, `Council shared average (${ccQuality.sharedAverageScore}) in "${bCase.id}" must meet substantive baseline`);

      // Architectural diversity score is structurally 2 for single_call and >= 4 for council
      assert.equal(scQuality.architecturalDiversityScore, 2, 'Single-call diversity must remain 2');
      assert.ok(ccQuality.architecturalDiversityScore >= 4, 'Council diversity must remain >= 4');

      if (scQuality.sharedAverageScore >= ccQuality.sharedAverageScore) {
        scWinsOrTies++;
      }
    }

    // 5. Ensure benchmark has balanced competitive tension (single-call ties or beats council on at least 4 cases)
    assert.ok(
      scWinsOrTies >= 4,
      `Benchmark must have balanced competitive tension: single-call tied or beat council on ${scWinsOrTies}/12 cases (expected >= 4)`
    );
  });

});
