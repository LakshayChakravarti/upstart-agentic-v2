'use strict';

/**
 * backend/services/evaluation/evaluationRunner.js
 *
 * Phase 4A: Common Evaluation Runner & Comparative Operational Summary
 *
 * Runs deterministic, offline evaluations comparing the single-call and
 * five-call council workflows across benchmark cases using existing service
 * interfaces (analyzeIdeaBusinessBlueprint, validateSynthesizedBlueprint).
 *
 * Core principles:
 *  - Offline & safe: Zero live external network calls (Tavily/Gemini).
 *  - Distinct metrics: Keeps schema validity, operational performance, fallback status,
 *    and qualitative rubric scores completely separate.
 *  - Honest trade-offs: Explicitly surfaces that the council requires 5 model calls
 *    vs 1 for single-call.
 *  - Honest reporting: Does NOT fabricate token usage, costs, or real-world latency.
 */

const { analyzeIdeaBusinessBlueprint } = require('../aiService');
const { validateSynthesizedBlueprint } = require('../councilOrchestrator');
const { evaluateBlueprintQuality, RUBRIC_DIMENSIONS } = require('./qualityRubric');
const { getBenchmarkCase, createDeterministicMockGemini } = require('./benchmarkDataset');

const SUPPORTED_WORKFLOWS = Object.freeze(['single_call', 'council']);

/**
 * Executes an evaluation of a single benchmark case against a specified workflow.
 *
 * @param {object|string} benchmarkCaseOrId - BenchmarkCase object or case ID
 * @param {string} workflow - 'single_call' | 'council'
 * @param {object} [options={}] - Optional configuration
 * @returns {Promise<object>} Structured evaluation record
 */
async function runCaseEvaluation(benchmarkCaseOrId, workflow, options = {}) {
  if (!SUPPORTED_WORKFLOWS.includes(workflow)) {
    throw new Error(`Unsupported workflow "${workflow}". Supported: ${SUPPORTED_WORKFLOWS.join(', ')}`);
  }

  const benchmarkCase = typeof benchmarkCaseOrId === 'string'
    ? getBenchmarkCase(benchmarkCaseOrId)
    : benchmarkCaseOrId;

  if (!benchmarkCase || !benchmarkCase.id || !benchmarkCase.idea) {
    throw new TypeError('runCaseEvaluation: invalid benchmarkCase structure');
  }

  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const startTime = clock();

  // Model call tracking wrapper around Gemini caller
  let modelCallCount = 0;
  const baseGeminiFn = options.geminiFn || createDeterministicMockGemini(benchmarkCase.id);
  const trackingGeminiFn = async (prompt) => {
    modelCallCount++;
    return await baseGeminiFn(prompt);
  };

  // Injected research dependencies (NO live Tavily, NO SQLite writes)
  const mockTavilySearchFn = options.tavilySearchFn || (async () => ({
    context: benchmarkCase.researchContext,
    urls: benchmarkCase.researchSources || [],
    results: (benchmarkCase.researchSources || []).map(url => ({
      url,
      title: 'Benchmark Market Evidence',
      content: benchmarkCase.researchContext,
    })),
  }));

  const mockRetrievalService = options.retrievalService || {
    run: async () => ({
      success: true,
      reason: 'OK',
      retrievedChunks: [{
        content: benchmarkCase.researchContext,
        score: 0.95,
        url: benchmarkCase.researchSources?.[0] || 'https://market-intel.example.com',
      }],
      sources: benchmarkCase.researchSources || [],
      promptContext: benchmarkCase.researchContext,
      diagnostics: { status: 'grounded', reason: 'OK' },
    }),
  };

  const useCouncil = workflow === 'council';

  let rawBlueprint = null;
  let executionError = null;
  let schemaValid = false;
  let failureCategory = null;

  try {
    rawBlueprint = await analyzeIdeaBusinessBlueprint(
      benchmarkCase.idea,
      benchmarkCase.userProfile?.skills || 'software',
      benchmarkCase.userProfile?.timeAvailable || 'full_time',
      benchmarkCase.userProfile?.budgetLevel || 'medium',
      benchmarkCase.userProfile?.experienceLevel || 'intermediate',
      null,
      null,
      `eval-${benchmarkCase.id}-${workflow}`,
      {
        useCouncil,
        geminiFn: trackingGeminiFn,
        tavilySearchFn: mockTavilySearchFn,
        retrievalService: mockRetrievalService,
        clock: options.clock,
      }
    );

    // Validate schema separately from execution
    try {
      validateSynthesizedBlueprint(rawBlueprint);
      schemaValid = true;
    } catch (schemaErr) {
      schemaValid = false;
      failureCategory = 'SCHEMA_VALIDATION_FAILED';
    }
  } catch (err) {
    executionError = err;
    schemaValid = false;
    failureCategory = err.code || 'EXECUTION_FAILED';
  }

  const durationMs = Math.max(0, clock() - startTime);

  // Fallback and completion status
  const fallbackUsed = Boolean(rawBlueprint?.councilDiagnostics?.fallbackUsed);
  const fallbackReason = rawBlueprint?.councilDiagnostics?.fallbackReason || null;
  const completed = Boolean(!executionError && (!useCouncil || !fallbackUsed));

  // Qualitative rubric assessment
  const qualityAssessment = evaluateBlueprintQuality(
    rawBlueprint,
    benchmarkCase,
    workflow,
    { manualScores: options.manualScores?.[benchmarkCase.id] }
  );

  return {
    workflow,
    caseId: benchmarkCase.id,
    caseName: benchmarkCase.name,
    completed,
    fallbackUsed,
    fallbackReason,
    schemaValid,
    modelCallCount,
    durationMs,
    failureCategory,
    tokenUsage: null, // Trustworthy token metadata is not exposed by current wrapper
    qualityAssessment,
    diagnostics: rawBlueprint?.councilDiagnostics || null,
  };
}

/**
 * Runs a comparative evaluation across all provided benchmark cases for both workflows.
 *
 * @param {Array<object>} benchmarkCases - List of benchmark cases
 * @param {object} [options={}] - Optional configuration
 * @returns {Promise<object>} Complete comparative evaluation report
 */
async function runComparativeEvaluation(benchmarkCases, options = {}) {
  if (!Array.isArray(benchmarkCases) || benchmarkCases.length === 0) {
    throw new TypeError('runComparativeEvaluation: benchmarkCases must be a non-empty array');
  }

  const results = {
    single_call: [],
    council: [],
  };

  // Run all cases against single_call
  for (const bCase of benchmarkCases) {
    const singleResult = await runCaseEvaluation(bCase, 'single_call', options);
    results.single_call.push(singleResult);
  }

  // Run all cases against council
  for (const bCase of benchmarkCases) {
    const councilResult = await runCaseEvaluation(bCase, 'council', options);
    results.council.push(councilResult);
  }

  const summary = {
    evaluatedCasesCount: benchmarkCases.length,
    workflows: {
      single_call: aggregateWorkflowMetrics(results.single_call),
      council: aggregateWorkflowMetrics(results.council),
    },
    operationalTradeoff: {
      modelCallRatio: '5 calls (Council: 4 specialists + 1 synthesis) vs 1 call (Single-Call baseline)',
      latencyNote: 'Durations from mocked runs represent test pipeline execution time, not real-world API latency.',
      tokenUsageNote: 'Token counts and cost estimates are not captured because the existing Gemini wrapper returns string text only.',
    },
  };

  return summary;
}

/**
 * Aggregates operational and qualitative metrics across a list of case evaluation runs.
 *
 * @param {Array<object>} runs - Evaluation runs for a single workflow
 * @returns {object} Aggregated metrics
 */
function aggregateWorkflowMetrics(runs) {
  if (!runs || runs.length === 0) {
    return {
      runsCount: 0,
      schemaValidRate: 0,
      completionRate: 0,
      fallbackRate: 0,
      averageModelCalls: 0,
      averageQualityByDimension: {},
      overallAverageQuality: null,
      perCaseResults: [],
    };
  }

  const totalRuns = runs.length;
  const validCount = runs.filter(r => r.schemaValid).length;
  const completedCount = runs.filter(r => r.completed).length;
  const fallbackCount = runs.filter(r => r.fallbackUsed).length;
  const totalCalls = runs.reduce((sum, r) => sum + r.modelCallCount, 0);

  // Quality dimension averages
  const dimensionSums = {};
  const dimensionCounts = {};

  for (const dim of RUBRIC_DIMENSIONS) {
    dimensionSums[dim.id] = 0;
    dimensionCounts[dim.id] = 0;
  }

  let totalQualitySum = 0;
  let totalQualityCount = 0;

  for (const run of runs) {
    const qAssessment = run.qualityAssessment;
    if (!qAssessment || !qAssessment.scores) continue;

    for (const dim of RUBRIC_DIMENSIONS) {
      const entry = qAssessment.scores[dim.id];
      if (entry && typeof entry.score === 'number' && Number.isFinite(entry.score)) {
        dimensionSums[dim.id] += entry.score;
        dimensionCounts[dim.id]++;
        totalQualitySum += entry.score;
        totalQualityCount++;
      }
    }
  }

  const averageQualityByDimension = {};
  for (const dim of RUBRIC_DIMENSIONS) {
    averageQualityByDimension[dim.id] = dimensionCounts[dim.id] > 0
      ? Number((dimensionSums[dim.id] / dimensionCounts[dim.id]).toFixed(2))
      : null;
  }

  const overallAverageQuality = totalQualityCount > 0
    ? Number((totalQualitySum / totalQualityCount).toFixed(2))
    : null;

  return {
    runsCount: totalRuns,
    schemaValidRate: Number((validCount / totalRuns).toFixed(2)),
    completionRate: Number((completedCount / totalRuns).toFixed(2)),
    fallbackRate: Number((fallbackCount / totalRuns).toFixed(2)),
    averageModelCalls: Number((totalCalls / totalRuns).toFixed(1)),
    averageQualityByDimension,
    overallAverageQuality,
    perCaseResults: runs,
  };
}

/**
 * Formats a comparative evaluation summary into a human-readable Markdown report.
 *
 * @param {object} summary - Summary from runComparativeEvaluation
 * @returns {string} Markdown report
 */
function formatEvaluationReport(summary) {
  const { workflows, operationalTradeoff, evaluatedCasesCount } = summary;
  const sc = workflows.single_call;
  const cc = workflows.council;

  const lines = [
    '# Upstart Agentic V2 — Evaluation Framework Summary Report',
    '',
    `**Benchmark Cases Evaluated:** ${evaluatedCasesCount}`,
    '',
    '## 1. Operational Comparison',
    '',
    '| Metric | Single-Call Baseline | Five-Call Council | Trade-off / Note |',
    '| :--- | :--- | :--- | :--- |',
    `| Average Model Calls | ${sc.averageModelCalls} | ${cc.averageModelCalls} | ${operationalTradeoff.modelCallRatio} |`,
    `| Schema Valid Rate | ${(sc.schemaValidRate * 100).toFixed(0)}% | ${(cc.schemaValidRate * 100).toFixed(0)}% | Structural contract compliance |`,
    `| Completion Rate | ${(sc.completionRate * 100).toFixed(0)}% | ${(cc.completionRate * 100).toFixed(0)}% | Without error or fallback |`,
    `| Fallback Rate | ${(sc.fallbackRate * 100).toFixed(0)}% | ${(cc.fallbackRate * 100).toFixed(0)}% | Triggered single-call fallback |`,
    `| Overall Quality Score | ${sc.overallAverageQuality !== null ? sc.overallAverageQuality : 'N/A'}/5.0 | ${cc.overallAverageQuality !== null ? cc.overallAverageQuality : 'N/A'}/5.0 | Average across assessed rubric dimensions |`,
    '',
    `> [!NOTE]`,
    `> ${operationalTradeoff.latencyNote}`,
    `>`,
    `> ${operationalTradeoff.tokenUsageNote}`,
    '',
    '## 2. Quality Dimension Averages (1–5 scale)',
    '',
    '| Dimension | Single-Call | Council | Rubric Focus |',
    '| :--- | :---: | :---: | :--- |',
  ];

  for (const dim of RUBRIC_DIMENSIONS) {
    const scScore = sc.averageQualityByDimension[dim.id] !== null ? sc.averageQualityByDimension[dim.id] : 'Unassessed';
    const ccScore = cc.averageQualityByDimension[dim.id] !== null ? cc.averageQualityByDimension[dim.id] : 'Unassessed';
    lines.push(`| **${dim.label}** | ${scScore} | ${ccScore} | ${dim.description} |`);
  }

  lines.push('');
  lines.push('## 3. Per-Case Evaluation Breakdown');
  lines.push('');

  for (let i = 0; i < evaluatedCasesCount; i++) {
    const scCase = sc.perCaseResults[i];
    const ccCase = cc.perCaseResults[i];
    lines.push(`### Case ${i + 1}: ${scCase?.caseName || scCase?.caseId}`);
    lines.push('');
    lines.push(`- **Single-Call**: Calls: ${scCase?.modelCallCount}, Valid: ${scCase?.schemaValid}, Quality Avg: ${scCase?.qualityAssessment?.averageScore || 'N/A'}`);
    lines.push(`- **Council**: Calls: ${ccCase?.modelCallCount}, Valid: ${ccCase?.schemaValid}, Fallback: ${ccCase?.fallbackUsed}, Quality Avg: ${ccCase?.qualityAssessment?.averageScore || 'N/A'}`);
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  SUPPORTED_WORKFLOWS,
  runCaseEvaluation,
  runComparativeEvaluation,
  aggregateWorkflowMetrics,
  formatEvaluationReport,
};
