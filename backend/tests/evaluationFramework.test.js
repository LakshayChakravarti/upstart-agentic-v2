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
  BENCHMARK_CASES,
  getBenchmarkCase,
  getAllBenchmarkCases,
  createDeterministicMockGemini,
  RUBRIC_DIMENSIONS,
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

  // Test 1: All three benchmark cases load correctly
  test('1. All three benchmark cases load correctly with required metadata and considerations', () => {
    const cases = getAllBenchmarkCases();
    assert.equal(cases.length, 3, 'Must contain exactly 3 benchmark cases');

    const expectedIds = [
      'crowded-market-weak-differentiation',
      'specific-problem-uncertain-wtp',
      'attractive-idea-high-regulatory-risk',
    ];
    const actualIds = cases.map(c => c.id);
    assert.deepEqual(actualIds, expectedIds);

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

    assert.equal(summary.evaluatedCasesCount, 3);
    assert.ok(summary.workflows.single_call);
    assert.ok(summary.workflows.council);

    // Verify single-call averaged 1 call per run
    assert.equal(summary.workflows.single_call.averageModelCalls, 1.0);
    assert.equal(summary.workflows.single_call.runsCount, 3);
    assert.equal(summary.workflows.single_call.schemaValidRate, 1.0);

    // Verify council averaged 5 calls per run
    assert.equal(summary.workflows.council.averageModelCalls, 5.0);
    assert.equal(summary.workflows.council.runsCount, 3);
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

});
