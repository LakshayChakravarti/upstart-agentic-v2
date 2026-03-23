/**
 * scoringEngine.js — Modular, reusable scoring utility
 *
 * Calculates a composite feasibility score from 5 weighted sub-scores.
 * Each sub-score is provided by the AI (0–100 range) and weighted here.
 *
 * WEIGHTS (must sum to 1.0):
 *   technicalFeasibility  — 25%  Can this be built with stated skills/budget/time?
 *   marketReadiness       — 25%  Is the market ready? Demand signal strength
 *   regulatoryRisk        — 15%  Regulatory/compliance barriers (inverted: 100 = no risk)
 *   competitiveAdvantage  — 20%  Strength of moat/USP vs existing competitors
 *   executionComplexity   — 15%  MVP shipping complexity (inverted: 100 = simple to ship)
 */

const WEIGHTS = {
    technicalFeasibility: 0.25,
    marketReadiness: 0.25,
    regulatoryRisk: 0.15,
    competitiveAdvantage: 0.20,
    executionComplexity: 0.15,
};

const SCORE_KEYS = Object.keys(WEIGHTS);

/**
 * Clamp a value between min and max.
 */
function clamp(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Assign a letter grade from a composite score.
 *   A+ = 90–100 | A = 80–89 | B = 70–79 | C = 60–69 | D = 50–59 | F = 0–49
 */
function getGrade(score) {
    if (score >= 90) return 'A+';
    if (score >= 80) return 'A';
    if (score >= 70) return 'B';
    if (score >= 60) return 'C';
    if (score >= 50) return 'D';
    return 'F';
}

/**
 * Calculate a composite feasibility score from AI-generated sub-scores.
 *
 * @param {Object} subScores — Object with keys matching SCORE_KEYS, each 0–100
 * @returns {{ compositeScore: number, breakdown: Object, grade: string, weights: Object }}
 *
 * Example:
 *   calculateFeasibilityScore({
 *     technicalFeasibility: 80,
 *     marketReadiness: 60,
 *     regulatoryRisk: 90,
 *     competitiveAdvantage: 70,
 *     executionComplexity: 85
 *   })
 *   → { compositeScore: 75, breakdown: { technicalFeasibility: 20, ... }, grade: 'B', weights: WEIGHTS }
 */
function calculateFeasibilityScore(subScores) {
    // Validate and clamp each sub-score
    const clamped = {};
    for (const key of SCORE_KEYS) {
        const raw = Number(subScores?.[key]) || 0;
        clamped[key] = clamp(raw);
    }

    // Weighted sum: each sub-score × its weight = its contribution to the composite
    const breakdown = {};
    let compositeRaw = 0;
    for (const key of SCORE_KEYS) {
        const contribution = clamped[key] * WEIGHTS[key];
        breakdown[key] = {
            raw: clamped[key],           // The AI-provided sub-score (0–100)
            weight: WEIGHTS[key],        // The weight used (e.g. 0.25)
            weighted: Math.round(contribution * 100) / 100, // Weighted contribution to composite
        };
        compositeRaw += contribution;
    }

    // Round composite to nearest integer
    const compositeScore = Math.round(compositeRaw);

    return {
        compositeScore,    // Final score 0–100
        breakdown,         // Per-sub-score details
        grade: getGrade(compositeScore), // Letter grade
        weights: { ...WEIGHTS },         // Exposed for transparency
    };
}

/**
 * Fallback computation if AI fails to return sub-scores.
 * Calculates dynamic baseline scores derived from user profile context.
 * 
 * @param {Object} context - User context: budget_level, time_available, experience_level, skills
 * @returns {Object} subScores - Dynamic 0-100 scores to feed to calculateFeasibilityScore
 */
function calculateFallbackSubScores(context = {}) {
    const { budget_level = '', time_available = '', experience_level = '', skills = '' } = context;

    // Technical Feasibility: Base 40 + scaling by skills count and experience
    const skillsCount = skills ? skills.split(',').length : 0;
    let techScore = 40 + (skillsCount * 5);
    if (experience_level.toLowerCase().includes('senior') || experience_level.toLowerCase().includes('pro')) techScore += 20;
    else if (experience_level.toLowerCase().includes('intermediate')) techScore += 10;

    // Execution Complexity (Inverted: 100 = easy, 0 = impossible)
    // Scales by time availability and budget level
    let execScore = 50;
    if (time_available.toLowerCase().includes('full')) execScore += 25;
    else if (time_available.toLowerCase().includes('part')) execScore += 10;

    if (budget_level === '₹10L-50L' || budget_level === '₹50L+') execScore += 15;
    else if (budget_level === '₹1L-10L') execScore += 5;

    // Market Readiness: Base 50, slightly bumped by experience implying better market sense
    let marketScore = 50;
    if (experience_level.toLowerCase().includes('senior')) marketScore += 15;

    // Competitive Advantage: Base 40, boosted if user has many skills to stand out
    let compScore = 40 + (skillsCount * 4);

    // Regulatory Risk (Inverted: 100 = no risk): 
    // Default to a medium-safe 60 since we don't know the exact domain safely.
    let regScore = 60;

    return {
        technicalFeasibility: clamp(techScore),
        executionComplexity: clamp(execScore),
        marketReadiness: clamp(marketScore),
        competitiveAdvantage: clamp(compScore),
        regulatoryRisk: clamp(regScore)
    };
}

module.exports = { calculateFeasibilityScore, calculateFallbackSubScores, WEIGHTS, SCORE_KEYS, getGrade };
