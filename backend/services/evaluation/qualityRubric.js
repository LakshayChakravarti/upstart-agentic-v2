'use strict';

/**
 * backend/services/evaluation/qualityRubric.js
 *
 * Phase 4A: Evaluation Framework Quality Rubric (revised Phase 4C-2)
 *
 * Defines the 7 evaluation dimensions and rules for assessing both single-call
 * and five-call council business blueprints:
 *  1. completeness
 *  2. problemSpecificity
 *  3. commercialReasoning
 *  4. riskAndFeasibility
 *  5. distinctAnalyticalValue
 *  6. evidenceGrounding
 *  7. internalConsistency
 *
 * Rubric Rules:
 *  - 1 to 5 integer scale with mandatory evidence-based rationale for each assessed dimension.
 *  - Structural validity is strictly separated from qualitative scoring.
 *  - High word count or schema validity does NOT automatically yield high scores.
 *  - The council workflow does NOT receive an automatic bonus for having specialist sections.
 *  - Unassessed dimensions (e.g. when execution fails or no output is generated) must have
 *    `score: null` with an explanatory rationale; they must never be silently coerced to 0 or 5.
 *  - Automated heuristic scoring supports deterministic pipeline testing, while exposing
 *    a clean interface for manual expert evaluation overrides.
 *
 * Phase 4C-2 changes (uniform-4 fix):
 *  - True 5-point scale: each dimension can now reach 1, 2, 3, 4, or 5.
 *  - Specificity signals (numbers, named competitors/tools, regulatory bodies, named workflows)
 *    differentiate generic text from concrete analysis.
 *  - distinctAnalyticalValue is workflow-aware: single_call blueprints score at most 2 on this
 *    dimension because they have no specialist persona separation by design.
 *  - evidenceGrounding uses ragDiagnostics status, marker presence, and source count.
 *  - internalConsistency cross-checks quantitative scores against narrative severity.
 *  - completeness checks minimum total content volume in persona sections.
 */

const RUBRIC_DIMENSIONS = Object.freeze([
  {
    id: 'completeness',
    label: 'Completeness',
    description: 'Required blueprint sections are useful, fully populated, and sufficiently developed.',
  },
  {
    id: 'problemSpecificity',
    label: 'Problem Specificity',
    description: 'Identifies concrete customer pain and granular workflow friction rather than generic platitudes.',
  },
  {
    id: 'commercialReasoning',
    label: 'Commercial Reasoning',
    description: 'Pricing tiers, target buyer, and willingness-to-pay assumptions are coherent and commercially realistic.',
  },
  {
    id: 'riskAndFeasibility',
    label: 'Risk and Feasibility',
    description: 'Identifies material technical, market, regulatory, and execution risks with appropriate severity.',
  },
  {
    id: 'distinctAnalyticalValue',
    label: 'Distinct Analytical Value',
    description: 'Specialist sections contribute useful, non-redundant perspectives to the final blueprint.',
  },
  {
    id: 'evidenceGrounding',
    label: 'Evidence Grounding',
    description: 'Research-backed claims are traceable to supplied evidence; unsupported claims are not presented as verified facts.',
  },
  {
    id: 'internalConsistency',
    label: 'Internal Consistency',
    description: 'Scores, summary, pricing, risks, and strategic twists do not materially contradict one another.',
  },
]);

const VALID_SCORE_MIN = 1;
const VALID_SCORE_MAX = 5;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Validates whether a value is an allowable rubric score (integer 1 to 5 or null).
 *
 * @param {any} val
 * @returns {boolean}
 */
function isValidScore(val) {
  if (val === null) return true;
  return Number.isInteger(val) && val >= VALID_SCORE_MIN && val <= VALID_SCORE_MAX;
}

/**
 * Count specificity signals in a body of text.
 *
 * A "specificity signal" is any of:
 *  - A number (including percentages like "60%", "$15", "3x")
 *  - A named tool / product / company (title-case word ≥6 chars or all-caps acronym ≥2 chars)
 *  - A named regulatory body / law pattern (GDPR, HIPAA, SOC 2, ISO 27001, etc.)
 *
 * Returns a count capped at 10 for scoring purposes.
 *
 * @param {string} text
 * @returns {number}
 */
function countSpecificitySignals(text) {
  if (!text || typeof text !== 'string') return 0;
  let count = 0;

  // Numeric values, prices, percentages, multipliers
  const numerics = text.match(/\b\d[\d,]*(?:\.\d+)?(?:%|x|k|m|\s?billion|\s?million|\s?users)?\b/gi);
  if (numerics) count += numerics.length;

  // Named regulatory standards / compliance terms
  const regulated = text.match(/\b(GDPR|HIPAA|SOC\s?2|ISO\s?27001|PCI[\s-]DSS|CCPA|FERPA|FDA|FTC|SEC|FINRA|AML|KYC)\b/gi);
  if (regulated) count += (regulated.length * 2); // weight regulatory terms more heavily

  // Title-case words (likely product/company names) of length ≥ 6
  const titleCaseWords = text.match(/\b[A-Z][a-z]{5,}(?:\s[A-Z][a-z]{2,})*/g);
  if (titleCaseWords) count += titleCaseWords.length;

  // All-caps acronyms ≥ 3 chars (e.g. CRM, API, SaaS treated as product refs)
  const acronyms = text.match(/\b[A-Z]{3,}\b/g);
  if (acronyms) count += acronyms.length;

  return Math.min(count, 10);
}

/**
 * Check if text contains generic platitude markers.
 * Returns true if the text is predominantly generic.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isGenericText(text) {
  if (!text || typeof text !== 'string') return true;
  const genericPhrases = [
    'generic problem',
    'generic risk',
    'generic feature',
    'do marketing better',
    'people in a generic way',
    'things for people',
    'a company doing',
  ];
  const lowerText = text.toLowerCase();
  return genericPhrases.some(phrase => lowerText.includes(phrase));
}

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluates the qualitative dimensions of a generated business blueprint against
 * the benchmark case and research context.
 *
 * @param {object|null} blueprint - The generated blueprint object (or null on failure)
 * @param {object} benchmarkCase - Benchmark case definition
 * @param {string} workflow - 'single_call' | 'council'
 * @param {object} [options={}] - Optional manual overrides { manualScores?: object }
 * @returns {object} Structured quality evaluation report
 */
function evaluateBlueprintQuality(blueprint, benchmarkCase, workflow, options = {}) {
  if (!benchmarkCase || typeof benchmarkCase !== 'object') {
    throw new TypeError('evaluateBlueprintQuality: benchmarkCase must be an object');
  }

  const manualScores = options.manualScores || {};
  const scores = {};

  // If blueprint is null or invalid object, all dimensions are unassessed (null)
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint)) {
    for (const dim of RUBRIC_DIMENSIONS) {
      scores[dim.id] = {
        score: null,
        rationale: 'Execution failed or produced non-object payload: dimension unassessed.',
      };
    }

    return {
      scores,
      averageScore: null,
      assessedDimensionsCount: 0,
      unassessedDimensionsCount: RUBRIC_DIMENSIONS.length,
    };
  }

  // -------------------------------------------------------------------------
  // 1. Completeness
  // -------------------------------------------------------------------------
  if (manualScores.completeness !== undefined) {
    validateManualScore('completeness', manualScores.completeness);
    scores.completeness = manualScores.completeness;
  } else {
    const hasBase = Boolean(blueprint.startupName && blueprint.tagline && blueprint.summary);
    const hasScores = Boolean(blueprint.scores && typeof blueprint.scores === 'object' &&
      typeof blueprint.scores.scoreRationale === 'string' && blueprint.scores.scoreRationale.trim().length > 10);
    const hasPersonas = Boolean(
      Array.isArray(blueprint.theReaper) && blueprint.theReaper.length > 0 &&
      Array.isArray(blueprint.thePainMiner) && blueprint.thePainMiner.length > 0 &&
      blueprint.pricingArchitect &&
      blueprint.thePivotMaster
    );

    // Total persona content volume (all text across persona sections)
    const personaText = [
      ...(Array.isArray(blueprint.theReaper) ? blueprint.theReaper.map(r => r.point || '') : []),
      ...(Array.isArray(blueprint.thePainMiner) ? blueprint.thePainMiner.map(p => p.frustration || '') : []),
      blueprint.thePivotMaster?.winningEdge || '',
    ].join(' ');
    const personaWordCount = personaText.trim().split(/\s+/).filter(Boolean).length;

    if (!hasBase) {
      scores.completeness = {
        score: 1,
        rationale: 'Missing core required fields (startupName, tagline, or summary).',
      };
    } else if (!hasScores && !hasPersonas) {
      scores.completeness = {
        score: 2,
        rationale: 'Core base fields present but missing both sub-scores and persona sections.',
      };
    } else if (!hasPersonas || !hasScores) {
      scores.completeness = {
        score: 3,
        rationale: 'Core base fields and either scores or personas present, but one category is incomplete or lacks rationale.',
      };
    } else if (personaWordCount < 80) {
      scores.completeness = {
        score: 4,
        rationale: `All required sections present but persona content is thin (${personaWordCount} words across specialist sections).`,
      };
    } else {
      scores.completeness = {
        score: 5,
        rationale: `All required base fields, sub-scores with rationale, and all four persona sections are fully populated and substantive (${personaWordCount} words in specialist sections).`,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 2. Problem Specificity
  // -------------------------------------------------------------------------
  if (manualScores.problemSpecificity !== undefined) {
    validateManualScore('problemSpecificity', manualScores.problemSpecificity);
    scores.problemSpecificity = manualScores.problemSpecificity;
  } else {
    const pains = Array.isArray(blueprint.thePainMiner) ? blueprint.thePainMiner : [];
    const painText = pains.map(p => p.frustration || '').join(' ');

    if (isGenericText(painText) || painText.trim().length < 30) {
      scores.problemSpecificity = {
        score: 2,
        rationale: 'Pain points rely on generic or vague assertions without workflow specificity.',
      };
    } else {
      const signals = countSpecificitySignals(painText);
      const painChars = painText.length;

      if (signals >= 8 && painChars >= 200) {
        scores.problemSpecificity = {
          score: 5,
          rationale: `Highly specific: identifies concrete workflow friction with ${signals} specificity signals (numbers, named tools, regulated terms) across ${painChars} chars of pain analysis.`,
        };
      } else if (signals >= 4 && painChars >= 120) {
        scores.problemSpecificity = {
          score: 4,
          rationale: `Concrete customer frustrations with ${signals} specificity signals; well-aligned with benchmark workflow friction.`,
        };
      } else if (signals >= 2 || painChars >= 80) {
        scores.problemSpecificity = {
          score: 3,
          rationale: 'Identifies recognisable pain but relies on general assertions rather than named tools, steps, or quantified friction.',
        };
      } else {
        scores.problemSpecificity = {
          score: 2,
          rationale: 'Pain points are surface-level and lack specificity signals (numbers, named competitors, workflow steps).',
        };
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Commercial Reasoning
  // -------------------------------------------------------------------------
  if (manualScores.commercialReasoning !== undefined) {
    validateManualScore('commercialReasoning', manualScores.commercialReasoning);
    scores.commercialReasoning = manualScores.commercialReasoning;
  } else {
    const pricing = blueprint.pricingArchitect || {};
    const tiers = ['starter', 'pro', 'enterprise'];
    const hasTiers = tiers.every(t => pricing[t] && typeof pricing[t] === 'object');
    const tierFeatureCounts = hasTiers
      ? tiers.map(t => (Array.isArray(pricing[t].features) ? pricing[t].features.length : 0))
      : [0, 0, 0];
    const allTiersHaveFeatures = tierFeatureCounts.every(c => c > 0);

    // Check price diversity (tiers shouldn't all be $0 or identical)
    const tierPrices = hasTiers ? tiers.map(t => String(pricing[t].price || '').toLowerCase()) : [];
    const hasDistinctPrices = hasTiers && (new Set(tierPrices)).size === 3;
    const hasZeroPrice = tierPrices.some(p => p === '$0' || p === '$0/mo' || p === 'free' || p === '0');
    const allFeaturesDistinct = hasTiers && (() => {
      const allFeatures = tiers.flatMap(t => Array.isArray(pricing[t].features) ? pricing[t].features : []);
      return new Set(allFeatures).size > allFeatures.length * 0.5; // >50% unique features
    })();

    // Check for commercial text generics
    const pricingText = JSON.stringify(pricing).toLowerCase();
    const hasGenericPricingText = isGenericText(pricingText);

    if (!hasTiers || !allTiersHaveFeatures) {
      scores.commercialReasoning = {
        score: 2,
        rationale: 'Pricing structure is missing tiers or lacks realistic commercial differentiation.',
      };
    } else if (hasGenericPricingText) {
      scores.commercialReasoning = {
        score: 2,
        rationale: 'Pricing tiers exist but rely on generic placeholder content.',
      };
    } else if (!hasDistinctPrices) {
      scores.commercialReasoning = {
        score: 3,
        rationale: 'All three pricing tiers are present but price points are not meaningfully differentiated.',
      };
    } else if (hasDistinctPrices && allFeaturesDistinct && !hasZeroPrice) {
      scores.commercialReasoning = {
        score: 5,
        rationale: 'Fully differentiated pricing with distinct prices, non-identical feature progressions across all tiers, and no placeholder free tier.',
      };
    } else if (hasDistinctPrices && allFeaturesDistinct) {
      scores.commercialReasoning = {
        score: 4,
        rationale: 'Pricing structure provides differentiated tiers with concrete feature progression across all tiers.',
      };
    } else {
      scores.commercialReasoning = {
        score: 3,
        rationale: 'Pricing tiers present with varied prices but feature lists show limited differentiation.',
      };
    }
  }

  // -------------------------------------------------------------------------
  // 4. Risk and Feasibility
  // -------------------------------------------------------------------------
  if (manualScores.riskAndFeasibility !== undefined) {
    validateManualScore('riskAndFeasibility', manualScores.riskAndFeasibility);
    scores.riskAndFeasibility = manualScores.riskAndFeasibility;
  } else {
    const risks = Array.isArray(blueprint.theReaper) ? blueprint.theReaper : [];
    const riskText = risks.map(r => r.point || '').join(' ');

    if (isGenericText(riskText) || risks.length === 0) {
      scores.riskAndFeasibility = {
        score: 2,
        rationale: 'Failure risks are generic or absent.',
      };
    } else {
      const riskSignals = countSpecificitySignals(riskText);
      const avgRiskLength = risks.length > 0
        ? Math.round(riskText.length / risks.length)
        : 0;

      if (risks.length >= 3 && riskSignals >= 6 && avgRiskLength >= 80) {
        scores.riskAndFeasibility = {
          score: 5,
          rationale: `Exceptional risk coverage: ${risks.length} substantive risks with ${riskSignals} specificity signals, averaging ${avgRiskLength} chars per risk point. Named competitors, platforms, or regulatory conditions cited.`,
        };
      } else if (risks.length >= 3 && riskSignals >= 3 && avgRiskLength >= 50) {
        scores.riskAndFeasibility = {
          score: 4,
          rationale: `Surfaces ${risks.length} distinct execution, platform, or regulatory failure modes with concrete specificity (${riskSignals} signals, avg ${avgRiskLength} chars/risk).`,
        };
      } else if (risks.length >= 2 && riskText.length > 100) {
        scores.riskAndFeasibility = {
          score: 3,
          rationale: 'Risks are present and moderately developed but lack named competitors, platforms, or quantified thresholds.',
        };
      } else {
        scores.riskAndFeasibility = {
          score: 2,
          rationale: 'Risk section has minimal content or relies on surface-level assertions.',
        };
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. Distinct Analytical Value
  // -------------------------------------------------------------------------
  if (manualScores.distinctAnalyticalValue !== undefined) {
    validateManualScore('distinctAnalyticalValue', manualScores.distinctAnalyticalValue);
    scores.distinctAnalyticalValue = manualScores.distinctAnalyticalValue;
  } else if (workflow === 'single_call') {
    // Single-call blueprints have no specialist persona separation by design.
    // Awarding them a high score here would misrepresent what "distinct analytical value" means.
    scores.distinctAnalyticalValue = {
      score: 2,
      rationale: 'Single-call workflow produces a unified output with no specialist persona separation. Distinct analytical value from multi-persona divergence is structurally absent.',
    };
  } else {
    // Council workflow — probe for actual divergence between specialist sections
    const reaperText = (blueprint.theReaper || []).map(r => r.point || '').join(' ');
    const painText = (blueprint.thePainMiner || []).map(p => p.frustration || '').join(' ');
    const pivotText = blueprint.thePivotMaster?.winningEdge || '';

    const hasWinningEdge = pivotText.trim().length > 30;
    const hasDistinctPain = Array.isArray(blueprint.thePainMiner) && blueprint.thePainMiner.length >= 2;
    const hasDistinctRisks = Array.isArray(blueprint.theReaper) && blueprint.theReaper.length >= 2;

    // Check for cross-section overlap (simplistic: shared long n-grams)
    const reaperWords = new Set(reaperText.toLowerCase().split(/\s+/).filter(w => w.length > 5));
    const painWords = new Set(painText.toLowerCase().split(/\s+/).filter(w => w.length > 5));
    const pivotWords = new Set(pivotText.toLowerCase().split(/\s+/).filter(w => w.length > 5));
    const allWords = [...reaperWords, ...painWords, ...pivotWords].length;
    const reaperPainOverlap = [...reaperWords].filter(w => painWords.has(w)).length;
    const overlapRatio = allWords > 0 ? reaperPainOverlap / Math.min(reaperWords.size, painWords.size || 1) : 1;

    // High overlap ratio means sections are paraphrasing each other
    if (!hasDistinctPain || !hasDistinctRisks) {
      scores.distinctAnalyticalValue = {
        score: 3,
        rationale: 'Specialist sections are populated but insufficiently developed across all personas.',
      };
    } else if (overlapRatio > 0.6) {
      scores.distinctAnalyticalValue = {
        score: 3,
        rationale: `Specialist sections show noticeable thematic overlap (${Math.round(overlapRatio * 100)}% shared vocabulary between Reaper and PainMiner). Contributions are partially redundant.`,
      };
    } else if (hasWinningEdge && hasDistinctPain && hasDistinctRisks && overlapRatio < 0.4) {
      scores.distinctAnalyticalValue = {
        score: 5,
        rationale: `All specialist personas contribute substantively divergent perspectives with low cross-section vocabulary overlap (${Math.round(overlapRatio * 100)}%). PivotMaster synthesises a non-obvious strategic direction.`,
      };
    } else {
      scores.distinctAnalyticalValue = {
        score: 4,
        rationale: `Specialist sections contribute complementary strategic findings with moderate divergence (${Math.round(overlapRatio * 100)}% overlap). Minor thematic repetition is present but acceptable.`,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 6. Evidence Grounding
  // -------------------------------------------------------------------------
  if (manualScores.evidenceGrounding !== undefined) {
    validateManualScore('evidenceGrounding', manualScores.evidenceGrounding);
    scores.evidenceGrounding = manualScores.evidenceGrounding;
  } else {
    const hasResearchSources = Array.isArray(blueprint.researchSources) && blueprint.researchSources.length > 0;
    const sourceCount = hasResearchSources ? blueprint.researchSources.length : 0;
    const ragStatus = blueprint.ragDiagnostics?.status;
    const ragGrounded = blueprint.ragGrounded === true || ragStatus === 'grounded';

    // Check whether source URLs or research markers appear in the blueprint body text
    const bodyText = [
      blueprint.summary || '',
      blueprint.scores?.scoreRationale || '',
      ...(blueprint.theReaper || []).map(r => r.point || ''),
      ...(blueprint.thePainMiner || []).map(p => p.frustration || ''),
      blueprint.thePivotMaster?.winningEdge || '',
    ].join(' ');

    const hasInTextCitation = hasResearchSources &&
      blueprint.researchSources.some(url => bodyText.includes(url));

    // Check for evidence markers (e.g., [MARKER_CASE_...])
    const hasEvidenceMarker = /\[MARKER_[A-Z0-9_]+\]/.test(bodyText);

    if (!hasResearchSources && !ragGrounded) {
      scores.evidenceGrounding = {
        score: 2,
        rationale: 'No research sources cited and no RAG grounding detected. Relies entirely on first-principles assertions.',
      };
    } else if (!hasResearchSources) {
      scores.evidenceGrounding = {
        score: 3,
        rationale: 'RAG retrieval was used but no source URLs are listed in the blueprint. Grounding cannot be independently verified.',
      };
    } else if (!ragGrounded && !hasInTextCitation && !hasEvidenceMarker) {
      scores.evidenceGrounding = {
        score: 3,
        rationale: `${sourceCount} source(s) listed but RAG grounding is not confirmed and no in-text citations or markers detected.`,
      };
    } else if ((ragGrounded || hasInTextCitation) && !hasEvidenceMarker) {
      scores.evidenceGrounding = {
        score: 4,
        rationale: `Grounded in ${sourceCount} retrieved research source(s) with preserved citation provenance. RAG status: ${ragStatus || 'confirmed'}.`,
      };
    } else if (ragGrounded && hasEvidenceMarker && sourceCount >= 1) {
      scores.evidenceGrounding = {
        score: 5,
        rationale: `Fully evidence-grounded: ${sourceCount} source(s), RAG status "${ragStatus}", in-text evidence markers confirmed, and source provenance propagated throughout the blueprint.`,
      };
    } else {
      scores.evidenceGrounding = {
        score: 3,
        rationale: `${sourceCount} source(s) listed. Partial grounding detected but in-text integration is limited.`,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 7. Internal Consistency
  // -------------------------------------------------------------------------
  if (manualScores.internalConsistency !== undefined) {
    validateManualScore('internalConsistency', manualScores.internalConsistency);
    scores.internalConsistency = manualScores.internalConsistency;
  } else {
    const scoresObj = blueprint.scores || {};
    const marketReadiness = typeof scoresObj.marketReadiness === 'number' ? scoresObj.marketReadiness : null;
    const competitiveAdvantage = typeof scoresObj.competitiveAdvantage === 'number' ? scoresObj.competitiveAdvantage : null;
    const hasValidScores = Number.isFinite(scoresObj.technicalFeasibility) &&
      Number.isFinite(scoresObj.marketReadiness);

    if (!hasValidScores) {
      scores.internalConsistency = {
        score: 2,
        rationale: 'Quantitative sub-scores are missing or non-numeric. Consistency cannot be assessed.',
      };
    } else {
      let contradictions = 0;
      const contradictionNotes = [];

      // Cross-check 1: Very low market readiness (<25) but premium pricing (no free/low tier)
      if (marketReadiness !== null && marketReadiness < 25) {
        const pricing = blueprint.pricingArchitect || {};
        const starterPrice = String(pricing.starter?.price || '').toLowerCase();
        const hasAffordableEntry = starterPrice.includes('$0') || starterPrice.includes('free') ||
          (/\$\d+/).test(starterPrice) && parseInt(starterPrice.replace(/[^0-9]/g, ''), 10) <= 20;
        if (!hasAffordableEntry) {
          contradictions++;
          contradictionNotes.push('low marketReadiness (<25) without a free/low-cost entry tier');
        }
      }

      // Cross-check 2: Very low competitive advantage (<20) but pivot strategy claims market dominance
      if (competitiveAdvantage !== null && competitiveAdvantage < 20) {
        const pivot = blueprint.thePivotMaster?.winningEdge || '';
        const claimsStrength = /\b(dominant|dominate|leader|monopoly|best|unrivalled|unmatched|crush)\b/i.test(pivot);
        if (claimsStrength) {
          contradictions++;
          contradictionNotes.push('low competitiveAdvantage (<20) but pivot strategy claims market dominance');
        }
      }

      // Cross-check 3: Score rationale length (too short signals perfunctory analysis)
      const rationaleLength = (scoresObj.scoreRationale || '').trim().length;
      const hasSubstantiveRationale = rationaleLength >= 60;

      if (contradictions >= 2) {
        scores.internalConsistency = {
          score: 2,
          rationale: `Material contradictions detected: ${contradictionNotes.join('; ')}.`,
        };
      } else if (contradictions === 1) {
        scores.internalConsistency = {
          score: 3,
          rationale: `One internal tension detected: ${contradictionNotes[0]}. Quantitative scores are otherwise numerically valid.`,
        };
      } else if (!hasSubstantiveRationale) {
        scores.internalConsistency = {
          score: 3,
          rationale: `Quantitative sub-scores are consistent but the scoreRationale is underdeveloped (${rationaleLength} chars).`,
        };
      } else if (hasSubstantiveRationale) {
        // Check if high-risk/low-advantage scores are acknowledged in the narrative
        const scoreRationale = scoresObj.scoreRationale || '';
        const narrativeAcknowledgesRisk = marketReadiness < 40
          ? /\b(saturat|crowded|dominat|compet|commodit|challeng|risk|difficult)\b/i.test(scoreRationale)
          : true;

        if (narrativeAcknowledgesRisk) {
          scores.internalConsistency = {
            score: 5,
            rationale: 'Quantitative sub-scores align logically with narrative rationale, key risks are acknowledged in the scoreRationale, and no material contradictions between pricing, positioning, and feasibility assessment.',
          };
        } else {
          scores.internalConsistency = {
            score: 4,
            rationale: 'Quantitative sub-scores are valid and rationale is substantive, but the scoreRationale does not explicitly connect low-scoring dimensions to the narrative analysis.',
          };
        }
      } else {
        scores.internalConsistency = {
          score: 4,
          rationale: 'Quantitative sub-scores align logically with narrative rationale and identified risks.',
        };
      }
    }
  }

  // Compute average of assessed dimensions (ignoring nulls)
  const assessedValues = Object.values(scores)
    .map(s => s.score)
    .filter(val => typeof val === 'number' && Number.isFinite(val));

  const assessedCount = assessedValues.length;
  const unassessedCount = RUBRIC_DIMENSIONS.length - assessedCount;

  const averageScore = assessedCount > 0
    ? Number((assessedValues.reduce((acc, v) => acc + v, 0) / assessedCount).toFixed(2))
    : null;

  return {
    scores,
    averageScore,
    assessedDimensionsCount: assessedCount,
    unassessedDimensionsCount: unassessedCount,
  };
}

/**
 * Validates a manual score structure.
 *
 * @param {string} dimId
 * @param {object} manualEntry
 */
function validateManualScore(dimId, manualEntry) {
  if (!manualEntry || typeof manualEntry !== 'object') {
    throw new TypeError(`Manual score for "${dimId}" must be an object with score and rationale`);
  }
  if (!isValidScore(manualEntry.score)) {
    throw new RangeError(`Manual score for "${dimId}" must be an integer between 1 and 5 (or null), got: ${manualEntry.score}`);
  }
  if (typeof manualEntry.rationale !== 'string' || !manualEntry.rationale.trim()) {
    throw new TypeError(`Manual score for "${dimId}" must contain a non-empty rationale string`);
  }
}

module.exports = {
  RUBRIC_DIMENSIONS,
  VALID_SCORE_MIN,
  VALID_SCORE_MAX,
  isValidScore,
  evaluateBlueprintQuality,
};
