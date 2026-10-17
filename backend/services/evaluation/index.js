'use strict';

/**
 * backend/services/evaluation/index.js
 *
 * Phase 4A: Evaluation Framework Public API
 */

const {
  BENCHMARK_CASES,
  getBenchmarkCase,
  getAllBenchmarkCases,
  createDeterministicMockGemini,
} = require('./benchmarkDataset');

const {
  RUBRIC_DIMENSIONS,
  VALID_SCORE_MIN,
  VALID_SCORE_MAX,
  isValidScore,
  evaluateBlueprintQuality,
} = require('./qualityRubric');

const {
  SUPPORTED_WORKFLOWS,
  runCaseEvaluation,
  runComparativeEvaluation,
  aggregateWorkflowMetrics,
  formatEvaluationReport,
} = require('./evaluationRunner');

module.exports = {
  // Benchmark Cases
  BENCHMARK_CASES,
  getBenchmarkCase,
  getAllBenchmarkCases,
  createDeterministicMockGemini,

  // Rubric
  RUBRIC_DIMENSIONS,
  VALID_SCORE_MIN,
  VALID_SCORE_MAX,
  isValidScore,
  evaluateBlueprintQuality,

  // Runner & Reports
  SUPPORTED_WORKFLOWS,
  runCaseEvaluation,
  runComparativeEvaluation,
  aggregateWorkflowMetrics,
  formatEvaluationReport,
};
