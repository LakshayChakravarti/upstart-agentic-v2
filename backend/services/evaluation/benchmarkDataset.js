'use strict';

/**
 * backend/services/evaluation/benchmarkDataset.js
 *
 * Phase 4A: Evaluation Framework Benchmark Dataset
 *
 * Provides three representative synthetic startup idea fixtures:
 *  1. Crowded market with weak differentiation (MeetBrief AI)
 *  2. Specific, credible problem with uncertain willingness to pay (GitNudge)
 *  3. Technically attractive idea with high regulatory/execution risk (TrialMatch Health)
 *
 * Each fixture includes:
 *  - Idea metadata (title, problem, solution)
 *  - Founder user profile (skills, time, budget, experience)
 *  - Curated research context and source URLs
 *  - Explicit evaluation considerations
 *  - Deterministic mock model responses for both single_call and council workflows
 *
 * Pure data module with zero network or external dependencies.
 */

const BENCHMARK_CASES = Object.freeze([
  // -------------------------------------------------------------------------
  // Case 1: Crowded Market with Weak Differentiation
  // -------------------------------------------------------------------------
  {
    id: 'crowded-market-weak-differentiation',
    name: 'MeetBrief AI — Generic Meeting Summarizer',
    category: 'Crowded Market / Weak Differentiation',
    idea: {
      title: 'MeetBrief AI',
      problem: 'Remote team members waste hours each week manually summarizing video conference calls and drafting action items.',
      solution: 'A bot that joins Zoom/Google Meet calls, transcribes audio, and emails structured bullet points with action items.',
    },
    userProfile: {
      skills: 'Full-stack web development, Python, OpenAI API integration',
      timeAvailable: 'part_time',
      budgetLevel: 'low',
      experienceLevel: 'intermediate',
    },
    researchSources: ['https://market-intel.example.com/meeting-ai-saturation'],
    researchContext: '\n\n=== RETRIEVED MARKET RESEARCH CONTEXT (VIA VECTOR SEARCH) ===\n[Source 1] (https://market-intel.example.com/meeting-ai-saturation)\nOver 60 meeting recorder and summary tools exist in 2025. Otter.ai, Fireflies.ai, and Fathom dominate standalones, while Zoom AI Companion and Microsoft Teams Copilot provide native summaries at zero additional license cost. Customer switching costs between summary bots are near zero.\n',
    evaluationConsiderations: {
      marketDifferentiation: 'Does the analysis confront extreme market saturation from Otter.ai, Fireflies.ai, and native Zoom/Teams companion bots?',
      commercialViability: 'Does it challenge customer willingness to pay for a standalone tool when platform incumbents offer it bundled for free?',
      defensibility: 'Does it assess the low defensibility of commodity transcription and summarization API wrappers?',
    },
    mockResponses: {
      singleCall: {
        startupName: 'MeetBrief AI',
        tagline: 'Automated video meeting transcription and bullet summaries',
        summary: 'MeetBrief connects to Zoom and Google Meet to transcribe audio and deliver concise action item emails. It targets remote knowledge workers seeking to reduce meeting recap overhead. The product relies on off-the-shelf speech-to-text models.',
        scores: {
          technicalFeasibility: 85,
          marketReadiness: 40,
          regulatoryRisk: 50,
          competitiveAdvantage: 20,
          executionComplexity: 65,
          scoreRationale: 'Technically straightforward to build with modern APIs, but faces severe competitive headwinds from entrenched platforms with zero switching costs.',
        },
        theReaper: [
          { point: 'Zoom AI Companion and Microsoft Copilot are bundled natively at zero incremental cost to enterprise buyers.' },
          { point: 'Stand-alone transcription wrappers lack proprietary data moats and face immediate churn.' },
          { point: 'Consumer and SMB switching costs between meeting bots are practically non-existent.' },
        ],
        thePainMiner: [
          { frustration: 'Participants miss decisions when distracted during multi-hour remote sprint reviews.' },
          { frustration: 'Existing summary tools produce hallucinated action items without timestamped context.' },
          { frustration: 'Uninvited summary bots disrupt meeting culture and raise unvetted enterprise security objections.' },
        ],
        pricingArchitect: {
          starter: { price: '$0/mo', features: ['3 meetings/mo', 'Basic summary email'] },
          pro: { price: '$12/mo', features: ['Unlimited meetings', 'Action item sync', 'Searchable archive'] },
          enterprise: { price: '$29/seat/mo', features: ['SSO enforcement', 'SOC2 audit logs', 'Custom webhook egress'] },
        },
        thePivotMaster: {
          winningEdge: 'Specialize exclusively in legal deposition summaries with verbatim timestamped exhibits and tamper-evident audit trails.',
        },
      },
      council: {
        personaReaper: {
          theReaper: [
            { point: 'Incumbent video platforms (Zoom, Teams, Google) offer free native summaries, destroying stand-alone pricing power.' },
            { point: 'Customer acquisition cost will exceed lifetime value due to high monthly churn among SMB knowledge workers.' },
            { point: 'Enterprise IT departments aggressively block third-party recording bots over unvetted data retention fears.' },
          ],
        },
        personaPainMiner: {
          thePainMiner: [
            { frustration: 'Meeting bots frequently misattribute speaker statements across overlapping technical discussions.' },
            { frustration: 'Managers spend 15 minutes editing generic AI summaries before they can safely forward them to leadership.' },
            { frustration: 'Audio-only summaries miss critical whiteboard diagrams and shared screen demonstrations.' },
          ],
        },
        personaPricingArchitect: {
          pricingArchitect: {
            starter: { price: '$0/mo', features: ['5 meetings/mo', 'Plain text summary'] },
            pro: { price: '$15/mo', features: ['Unlimited meetings', 'Jira/Linear action item export', 'Speaker separation'] },
            enterprise: { price: 'Custom', features: ['Dedicated tenant encryption', 'BAA / SOC2 compliance', 'Admin bot blacklist controls'] },
          },
        },
        personaPivotMaster: {
          thePivotMaster: {
            winningEdge: 'Abandon general meetings and build automated compliance recording for regulated financial advisory calls.',
          },
        },
        synthesis: {
          startupName: 'MeetBrief AI',
          tagline: 'Specialized compliance meeting intelligence for regulated advisors',
          summary: 'MeetBrief transforms unstructured meeting conversations into audit-ready structured records. Rather than competing as a generic transcription tool, it synthesizes adversarial insights to focus on compliance-verified documentation where buyers have mandatory budget.',
          scores: {
            technicalFeasibility: 80,
            marketReadiness: 45,
            regulatoryRisk: 45,
            competitiveAdvantage: 35,
            executionComplexity: 60,
            scoreRationale: 'High technical viability with off-the-shelf components, but survival depends entirely on pivoting away from commodity video summaries into regulated niche workflows.',
          },
          theReaper: [
            { point: 'Incumbent video platforms offer free native summaries, destroying stand-alone pricing power.' },
            { point: 'Customer acquisition cost will exceed lifetime value due to high monthly churn among SMB knowledge workers.' },
            { point: 'Enterprise IT departments aggressively block third-party recording bots over unvetted data retention fears.' },
          ],
          thePainMiner: [
            { frustration: 'Meeting bots frequently misattribute speaker statements across overlapping technical discussions.' },
            { frustration: 'Managers spend 15 minutes editing generic AI summaries before they can safely forward them to leadership.' },
            { frustration: 'Audio-only summaries miss critical whiteboard diagrams and shared screen demonstrations.' },
          ],
          pricingArchitect: {
            starter: { price: '$0/mo', features: ['5 meetings/mo', 'Plain text summary'] },
            pro: { price: '$15/mo', features: ['Unlimited meetings', 'Jira/Linear action item export', 'Speaker separation'] },
            enterprise: { price: 'Custom', features: ['Dedicated tenant encryption', 'BAA / SOC2 compliance', 'Admin bot blacklist controls'] },
          },
          thePivotMaster: {
            winningEdge: 'Abandon general meetings and build automated compliance recording for regulated financial advisory calls.',
          },
        },
      },
    },
  },

  // -------------------------------------------------------------------------
  // Case 2: Specific Problem with Uncertain Willingness to Pay
  // -------------------------------------------------------------------------
  {
    id: 'specific-problem-uncertain-wtp',
    name: 'GitNudge — OSS Maintenance Automation',
    category: 'Specific Pain / Uncertain Willingness to Pay',
    idea: {
      title: 'GitNudge',
      problem: 'Open-source library maintainers are overwhelmed by abandoned pull requests, stale issues, and unverified contributor forks.',
      solution: 'A GitHub marketplace app that automates PR lifecycle checks, sends courteous nudge notifications to contributors, and archives dead forks.',
    },
    userProfile: {
      skills: 'Node.js, GitHub Apps API, DevOps',
      timeAvailable: 'part_time',
      budgetLevel: 'low',
      experienceLevel: 'intermediate',
    },
    researchSources: ['https://market-intel.example.com/oss-maintainer-economics'],
    researchContext: '\n\n=== RETRIEVED MARKET RESEARCH CONTEXT (VIA VECTOR SEARCH) ===\n[Source 1] (https://market-intel.example.com/oss-maintainer-economics)\n82% of open-source maintainers report chronic burnout from unpaid triage work. However, over 94% of independent OSS maintainers operate with $0 software budgets and rely strictly on free tiers or GitHub Actions credits.\n',
    evaluationConsiderations: {
      customerBudget: 'Does the analysis identify that volunteer maintainers suffer high burnout but possess near-zero discretionary software budget?',
      monetizationViability: 'Does the commercial strategy shift target buyers toward enterprise open-source sponsors or B2B dependency compliance teams?',
      frictionPoints: 'Does it capture maintainer workflow friction (e.g. contributor notification fatigue and repo bot spam)?',
    },
    mockResponses: {
      singleCall: {
        startupName: 'GitNudge',
        tagline: 'Automated workflow hygiene and contributor nudges for GitHub repos',
        summary: 'GitNudge automates stale pull request reminders and dependency follow-ups for open-source repositories. It aims to reduce maintainer burnout through courteous automated notifications.',
        scores: {
          technicalFeasibility: 90,
          marketReadiness: 50,
          regulatoryRisk: 85,
          competitiveAdvantage: 40,
          executionComplexity: 75,
          scoreRationale: 'Extremely easy to ship via GitHub App webhooks, but monetizing open-source hobbyists is notoriously difficult without enterprise backing.',
        },
        theReaper: [
          { point: 'Independent open-source maintainers have virtually zero budget and expect free tooling.' },
          { point: 'Free GitHub Actions workflows can replicate basic triage bot functionality with zero SaaS fees.' },
          { point: 'Aggressive automated comment bots alienate volunteer open-source contributors.' },
        ],
        thePainMiner: [
          { frustration: 'Unfinished PRs sit idle for months, blocking core refactoring efforts.' },
          { frustration: 'Contributors abandon PRs after receiving code review comments, leaving maintainers to finish the work.' },
          { frustration: 'Automated bot notifications create inbox noise without actually resolving merge conflicts.' },
        ],
        pricingArchitect: {
          starter: { price: '$0/mo', features: ['Public repos only', 'Weekly triage run'] },
          pro: { price: '$19/mo', features: ['Private repos', 'Custom nudge templates', 'Slack alerts'] },
          enterprise: { price: '$99/mo', features: ['Organization-wide policies', 'SLA triage reports', 'Priority support'] },
        },
        thePivotMaster: {
          winningEdge: 'Sell directly to corporate engineering teams funding OSS to audit dependency security freshness rather than individual maintainers.',
        },
      },
      council: {
        personaReaper: {
          theReaper: [
            { point: 'The target user (volunteer OSS maintainer) has a $0 willingness to pay and will fork an open-source Action instead.' },
            { point: 'Platform dependency on GitHub marketplace leaves pricing and distribution at the mercy of platform changes.' },
            { point: 'High support burden from edge-case git workflows will overwhelm a part-time solo founder.' },
          ],
        },
        personaPainMiner: {
          thePainMiner: [
            { frustration: 'Maintainers feel guilty closing abandoned PRs but lack the time to guide delinquent contributors.' },
            { frustration: 'First-time contributors get intimidated by automated bot warnings and abandon their submissions.' },
            { frustration: 'Reviewers cannot tell which pending PRs are genuinely ready for review versus broken drafts.' },
          ],
        },
        personaPricingArchitect: {
          pricingArchitect: {
            starter: { price: 'Free', features: ['Public OSS repos', 'Standard reminder cycle'] },
            pro: { price: '$29/mo', features: ['Private team repos', 'Custom triage rules', 'Discord/Slack webhooks'] },
            enterprise: { price: '$199/org/mo', features: ['Open-source sponsor compliance', 'Security patch tracking', 'Multi-org rollups'] },
          },
        },
        personaPivotMaster: {
          thePivotMaster: {
            winningEdge: 'Pivot from a gentle maintainer bot into an Enterprise Inbound PR Security scanner that checks contributor provenance.',
          },
        },
        synthesis: {
          startupName: 'GitNudge',
          tagline: 'Enterprise contributor triage and PR governance for engineering organizations',
          summary: 'GitNudge pairs automated maintainer workflow hygiene with enterprise contributor provenance checks. It addresses maintainer burnout by shifting the monetization buyer from unpaid open-source developers to corporate engineering teams managing internal and upstream dependencies.',
          scores: {
            technicalFeasibility: 85,
            marketReadiness: 55,
            regulatoryRisk: 80,
            competitiveAdvantage: 50,
            executionComplexity: 70,
            scoreRationale: 'Clean technical architecture with rapid delivery potential; long-term sustainability requires pivoting the commercial buyer away from volunteer maintainers to corporate engineering teams.',
          },
          theReaper: [
            { point: 'The target user (volunteer OSS maintainer) has a $0 willingness to pay and will fork an open-source Action instead.' },
            { point: 'Platform dependency on GitHub marketplace leaves pricing and distribution at the mercy of platform changes.' },
            { point: 'High support burden from edge-case git workflows will overwhelm a part-time solo founder.' },
          ],
          thePainMiner: [
            { frustration: 'Maintainers feel guilty closing abandoned PRs but lack the time to guide delinquent contributors.' },
            { frustration: 'First-time contributors get intimidated by automated bot warnings and abandon their submissions.' },
            { frustration: 'Reviewers cannot tell which pending PRs are genuinely ready for review versus broken drafts.' },
          ],
          pricingArchitect: {
            starter: { price: 'Free', features: ['Public OSS repos', 'Standard reminder cycle'] },
            pro: { price: '$29/mo', features: ['Private team repos', 'Custom triage rules', 'Discord/Slack webhooks'] },
            enterprise: { price: '$199/org/mo', features: ['Open-source sponsor compliance', 'Security patch tracking', 'Multi-org rollups'] },
          },
          thePivotMaster: {
            winningEdge: 'Pivot from a gentle maintainer bot into an Enterprise Inbound PR Security scanner that checks contributor provenance.',
          },
        },
      },
    },
  },

  // -------------------------------------------------------------------------
  // Case 3: Technically Attractive Idea with High Regulatory / Execution Risk
  // -------------------------------------------------------------------------
  {
    id: 'attractive-idea-high-regulatory-risk',
    name: 'TrialMatch Health — Oncology Clinical Trial Matching',
    category: 'High Market Value / High Regulatory & Execution Risk',
    idea: {
      title: 'TrialMatch Health',
      problem: 'Community oncology clinics take up to 3 weeks of manual health record parsing to match eligible cancer patients to experimental clinical trials.',
      solution: 'An AI system that extracts patient genomic and pathology markers from EHRs and matches them against active ClinicalTrials.gov eligibility criteria.',
    },
    userProfile: {
      skills: 'Machine learning, Python, Healthcare IT',
      timeAvailable: 'full_time',
      budgetLevel: 'high',
      experienceLevel: 'advanced',
    },
    researchSources: ['https://market-intel.example.com/clinical-trial-matching-regulations'],
    researchContext: '\n\n=== RETRIEVED MARKET RESEARCH CONTEXT (VIA VECTOR SEARCH) ===\n[Source 1] (https://market-intel.example.com/clinical-trial-matching-regulations)\nPatient matching for oncology trials saves pharma sponsors $12,000 per enrolled patient. However, clinical decision support software faces FDA SaMD Class II regulatory controls, strict HIPAA BAA requirements, and hospital procurement review cycles averaging 14 to 18 months.\n',
    evaluationConsiderations: {
      regulatoryCompliance: 'Does the analysis explicitly evaluate FDA SaMD oversight, HIPAA data privacy liabilities, and medical malpractice exposure?',
      salesCycleFriction: 'Does it account for hospital health system procurement cycles spanning 12 to 18 months?',
      payerAlignment: 'Does it correctly identify life sciences / pharmaceutical clinical trial sponsors as the high-value economic buyer rather than cash-strapped community clinics?',
    },
    mockResponses: {
      singleCall: {
        startupName: 'TrialMatch Health',
        tagline: 'Autonomous precision oncology clinical trial recruitment platform',
        summary: 'TrialMatch Health extracts genomic and biomarker data from electronic health records to match cancer patients with recruiting clinical trials in real time. It reduces trial screening latency from weeks to minutes.',
        scores: {
          technicalFeasibility: 60,
          marketReadiness: 65,
          regulatoryRisk: 25,
          competitiveAdvantage: 75,
          executionComplexity: 30,
          scoreRationale: 'High commercial value and strong pharmaceutical willingness to pay, heavily constrained by FDA medical software classification, HIPAA compliance barriers, and hospital procurement cycles.',
        },
        theReaper: [
          { point: 'FDA Class II SaMD classification introduces multi-year 510(k) clearance requirements and severe liability risk.' },
          { point: 'Hospital enterprise IT procurement cycles average 14-18 months, exhausting early-stage startup runway.' },
          { point: 'Unstructured EHR records contain conflicting pathology reports that lead to medical matching errors.' },
        ],
        thePainMiner: [
          { frustration: 'Oncology coordinators spend 15 hours per patient reading 200-page trial inclusion/exclusion protocols.' },
          { frustration: 'Eligible cancer patients progress past eligibility windows before manual chart reviews are completed.' },
          { frustration: 'Pharma trial sponsors fail to meet enrollment diversity quotas due to manual community outreach bottlenecks.' },
        ],
        pricingArchitect: {
          starter: { price: '$1,500/mo', features: ['Single clinic site', 'Up to 50 active patient profiles', 'Weekly matching digest'] },
          pro: { price: '$5,000/mo', features: ['Multi-site clinic network', 'Real-time EHR FHIR sync', 'Biomarker variant alerts'] },
          enterprise: { price: '$12,000/successful match', features: ['Direct pharma trial sponsor portal', 'Dedicated regulatory underwriting', 'Custom protocol ingester'] },
        },
        thePivotMaster: {
          winningEdge: 'Sell directly to contract research organizations (CROs) and pharma sponsors on a per-enrolled-patient success fee model rather than software licenses to clinics.',
        },
      },
      council: {
        personaReaper: {
          theReaper: [
            { point: 'FDA guidance treats automated patient-trial matching as Clinical Decision Support (CDS), exposing the firm to medical malpractice claims upon false exclusions.' },
            { point: 'Integration with legacy hospital on-prem EHR systems requires months of bespoke HL7/FHIR engineering per site.' },
            { point: 'Pharma sponsors demand institutional review board (IRB) indemnification before paying recruitment referral bonuses.' },
          ],
        },
        personaPainMiner: {
          thePainMiner: [
            { frustration: 'Clinical trial protocols update eligibility criteria mid-study without notifying participating community oncologists.' },
            { frustration: 'Genomic sequencing reports arrive in non-standard PDF formats that break traditional keyword search tools.' },
            { frustration: 'Patients frequently refuse clinical trial enrollment due to travel constraints that software fails to factor into matching.' },
          ],
        },
        personaPricingArchitect: {
          pricingArchitect: {
            starter: { price: 'Free to clinics', features: ['Patient trial discovery search', 'Protocol PDF extractor'] },
            pro: { price: '$3,500/mo', features: ['EHR connector', 'Automated pre-screening audit log', 'Coordinator workflow queue'] },
            enterprise: { price: '$15,000/enrolled patient', features: ['Pharma sponsor sponsor dashboard', 'IRB compliance packet', 'Genomic pipeline integration'] },
          },
        },
        personaPivotMaster: {
          thePivotMaster: {
            winningEdge: 'Provide the clinic workflow software 100% free to community oncologists to build the supply network, then monetize pharmaceutical sponsors exclusively on validated patient enrollment.',
          },
        },
        synthesis: {
          startupName: 'TrialMatch Health',
          tagline: 'Pharma-sponsored precision oncology patient matching network',
          summary: 'TrialMatch Health bridges community oncology clinics and life sciences trial sponsors. By offering automated chart extraction free to providers while charging pharmaceutical sponsors a success fee upon verified trial enrollment, it bypasses hospital procurement bottlenecks while complying with medical data regulations.',
          scores: {
            technicalFeasibility: 55,
            marketReadiness: 70,
            regulatoryRisk: 30,
            competitiveAdvantage: 80,
            executionComplexity: 35,
            scoreRationale: 'Substantial market upside with verified $12k+ patient acquisition budgets from pharma sponsors, offset by heavy FDA SaMD scrutiny, HIPAA BAA liabilities, and complex EHR data ingestion.',
          },
          theReaper: [
            { point: 'FDA guidance treats automated patient-trial matching as Clinical Decision Support (CDS), exposing the firm to medical malpractice claims upon false exclusions.' },
            { point: 'Integration with legacy hospital on-prem EHR systems requires months of bespoke HL7/FHIR engineering per site.' },
            { point: 'Pharma sponsors demand institutional review board (IRB) indemnification before paying recruitment referral bonuses.' },
          ],
          thePainMiner: [
            { frustration: 'Clinical trial protocols update eligibility criteria mid-study without notifying participating community oncologists.' },
            { frustration: 'Genomic sequencing reports arrive in non-standard PDF formats that break traditional keyword search tools.' },
            { frustration: 'Patients frequently refuse clinical trial enrollment due to travel constraints that software fails to factor into matching.' },
          ],
          pricingArchitect: {
            starter: { price: 'Free to clinics', features: ['Patient trial discovery search', 'Protocol PDF extractor'] },
            pro: { price: '$3,500/mo', features: ['EHR connector', 'Automated pre-screening audit log', 'Coordinator workflow queue'] },
            enterprise: { price: '$15,000/enrolled patient', features: ['Pharma sponsor sponsor dashboard', 'IRB compliance packet', 'Genomic pipeline integration'] },
          },
          thePivotMaster: {
            winningEdge: 'Provide the clinic workflow software 100% free to community oncologists to build the supply network, then monetize pharmaceutical sponsors exclusively on validated patient enrollment.',
          },
        },
      },
    },
  },
]);

/**
 * Retrieves a benchmark case by ID.
 *
 * @param {string} id - Benchmark case identifier
 * @returns {object} Deep clone of benchmark case
 */
function getBenchmarkCase(id) {
  const found = BENCHMARK_CASES.find((c) => c.id === id);
  if (!found) {
    throw new Error(`Benchmark case not found: "${id}"`);
  }
  return JSON.parse(JSON.stringify(found));
}

/**
 * Returns all benchmark cases.
 *
 * @returns {Array<object>} Deep clone of all cases
 */
function getAllBenchmarkCases() {
  return JSON.parse(JSON.stringify(BENCHMARK_CASES));
}

/**
 * Creates a deterministic mock Gemini function tailored for a specific benchmark case.
 *
 * @param {string} caseId - Benchmark case ID
 * @param {object} [overrides={}] - Optional response overrides
 * @returns {Function} (prompt) => Promise<string>
 */
function createDeterministicMockGemini(caseId, overrides = {}) {
  const benchmarkCase = getBenchmarkCase(caseId);
  const { mockResponses } = benchmarkCase;

  return async (prompt) => {
    // Overrides take precedence
    if (overrides.throwOnPromptMatch && overrides.throwOnPromptMatch.test(prompt)) {
      throw new Error(`Injected model rejection for pattern: ${overrides.throwOnPromptMatch}`);
    }
    if (overrides.malformedJsonOnMatch && overrides.malformedJsonOnMatch.test(prompt)) {
      return '```json\n{"invalid_json": incomplete...\n```';
    }

    // Single-call prompt check
    if (prompt.includes('You are a "Council of Experts"')) {
      if (overrides.singleCallResponse !== undefined) return overrides.singleCallResponse;
      return JSON.stringify(mockResponses.singleCall);
    }

    // Council Specialist 1: The Reaper
    if (prompt.includes('You are THE REAPER')) {
      if (overrides.reaperResponse !== undefined) return overrides.reaperResponse;
      return JSON.stringify(mockResponses.council.personaReaper);
    }

    // Council Specialist 2: The Pain Miner
    if (prompt.includes('You are THE PAIN MINER')) {
      if (overrides.painMinerResponse !== undefined) return overrides.painMinerResponse;
      return JSON.stringify(mockResponses.council.personaPainMiner);
    }

    // Council Specialist 3: The Pricing Architect
    if (prompt.includes('You are THE PRICING ARCHITECT')) {
      if (overrides.pricingArchitectResponse !== undefined) return overrides.pricingArchitectResponse;
      return JSON.stringify(mockResponses.council.personaPricingArchitect);
    }

    // Council Specialist 4: The Pivot Master
    if (prompt.includes('You are THE PIVOT MASTER')) {
      if (overrides.pivotMasterResponse !== undefined) return overrides.pivotMasterResponse;
      return JSON.stringify(mockResponses.council.personaPivotMaster);
    }

    // Council Chairman Synthesis
    if (prompt.includes('You are the CHAIRMAN of the Council of Experts')) {
      if (overrides.synthesisResponse !== undefined) return overrides.synthesisResponse;
      return JSON.stringify(mockResponses.council.synthesis);
    }

    throw new Error(`Unrecognized prompt pattern in deterministic mock Gemini caller:\n${prompt.slice(0, 150)}...`);
  };
}

module.exports = {
  BENCHMARK_CASES,
  getBenchmarkCase,
  getAllBenchmarkCases,
  createDeterministicMockGemini,
};
