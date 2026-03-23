'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient, type Idea, type StrategicDirection, type ExpandedIdea, type ViabilityResult } from '@/lib/api';

const BUDGET_OPTIONS = [
    { label: '₹0 – ₹1L', value: '₹0-1L', color: 'var(--color-emerald)' },
    { label: '₹1L – ₹10L', value: '₹1L-10L', color: 'var(--color-primary)' },
    { label: '₹10L – ₹50L', value: '₹10L-50L', color: 'var(--color-secondary)' },
    { label: '₹50L+', value: '₹50L+', color: 'var(--color-accent)' },
];

const DIRECTION_COLORS = ['var(--color-primary)', 'var(--color-secondary)', 'var(--color-accent)'];
const DIRECTION_ICONS = ['🎯', '⚡', '🌐'];

const LOADING_PHASES = [
    { icon: '🔍', text: 'Scanning live market data with Tavily OSINT...' },
    { icon: '💀', text: 'Consulting The Reaper for fatal failure points...' },
    { icon: '⛏️', text: 'Mining Reddit for real customer frustrations...' },
    { icon: '💰', text: 'Architecting 3-tier SaaS pricing strategy...' },
    { icon: '🚀', text: 'Discovering the Master Pivot & Winning Edge...' },
];

// Phase enum
const PHASE = { ELABORATE: 1, VIABILITY: 1.5, EXPANSION: 2, DIRECTIONS: 3, ANALYZING: 4 } as const;

export default function EvolvePage() {
    const { user } = useAuth();
    const router = useRouter();

    // Data from previous step
    const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
    const [ideaSessionId, setIdeaSessionId] = useState<number | null>(null);

    // Phase 1: Elaboration
    const [userElaboration, setUserElaboration] = useState('');
    const [budget, setBudget] = useState('₹1L-10L');

    // Phase 1.5: Viability & Risk Check
    const [viability, setViability] = useState<ViabilityResult | null>(null);
    const [viabilityLoading, setViabilityLoading] = useState(false);

    // Phase 2: AI Expansion + Review
    const [expandedIdea, setExpandedIdea] = useState<ExpandedIdea | null>(null);
    const [comment, setComment] = useState('');
    const [commentHistory, setCommentHistory] = useState<string[]>([]);
    const [refinementCount, setRefinementCount] = useState(0);

    // Phase 3: Directions
    const [directions, setDirections] = useState<StrategicDirection[]>([]);
    const [selectedDirection, setSelectedDirection] = useState<number | null>(null);

    // Phase tracking
    const [phase, setPhase] = useState<number>(PHASE.ELABORATE);

    // Loading and error states
    const [expandLoading, setExpandLoading] = useState(false);
    const [directionsLoading, setDirectionsLoading] = useState(false);
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [loadingPhase, setLoadingPhase] = useState(0);
    const [error, setError] = useState('');
    const [ready, setReady] = useState(false);

    const phaseTimer = useRef<NodeJS.Timeout | null>(null);
    const timeoutTimer = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!user) { router.push('/login'); return; }
        const stored = sessionStorage.getItem('upstart_ideas');
        if (!stored) { router.push('/generate'); return; }
        try {
            const data = JSON.parse(stored);
            if (!data.selectedIdea) { router.push('/ideas'); return; }
            setSelectedIdea(data.selectedIdea);
            setIdeaSessionId(data.ideaSessionId);
            if (data.budget) setBudget(data.budget);
            setReady(true);
        } catch {
            router.push('/ideas');
        }
    }, [user]);

    // Phase 1 → Phase 1.5: Check Viability first
    const handleCheckViability = async () => {
        if (!selectedIdea || !ideaSessionId) return;
        setViabilityLoading(true);
        setError('');
        try {
            const result = await apiClient.checkIdeaViability({ ideaSessionId, selectedIdea });
            setViability(result.viabilityResult);
            setPhase(PHASE.VIABILITY);
        } catch (err: any) {
            setError(err.message || 'Failed to analyze idea viability.');
        } finally {
            setViabilityLoading(false);
        }
    };

    // Phase 1.5 → Phase 2: Acknowledge risks and expand the idea
    const handleExpandIdea = async () => {
        if (!selectedIdea || !ideaSessionId) return;
        setExpandLoading(true);
        setError('');
        try {
            const result = await apiClient.expandIdea({
                ideaSessionId,
                selectedIdea,
                userElaboration,
                budget,
                comments: commentHistory.length > 0 ? commentHistory : undefined,
            });
            setExpandedIdea(result.expandedIdea);
            setPhase(PHASE.EXPANSION);
            setRefinementCount(prev => prev + 1);
        } catch (err: any) {
            setError(err.message || 'Failed to expand idea. Please try again.');
        } finally {
            setExpandLoading(false);
        }
    };

    // Phase 2: Refine with comment
    const handleRefine = () => {
        if (!comment.trim()) return;
        setCommentHistory(prev => [...prev, comment.trim()]);
        setComment('');
        // Go back to expand with the new comment
        handleExpandWithComment(comment.trim());
    };

    const handleExpandWithComment = async (newComment: string) => {
        if (!selectedIdea || !ideaSessionId) return;
        setExpandLoading(true);
        setError('');
        const allComments = [...commentHistory, newComment];
        try {
            const result = await apiClient.expandIdea({
                ideaSessionId,
                selectedIdea,
                userElaboration,
                budget,
                comments: allComments,
            });
            setExpandedIdea(result.expandedIdea);
            setRefinementCount(prev => prev + 1);
        } catch (err: any) {
            setError(err.message || 'Failed to refine idea. Please try again.');
        } finally {
            setExpandLoading(false);
        }
    };

    // Phase 2 → Phase 3: Approve expansion → get directions
    const handleApproveExpansion = async () => {
        if (!selectedIdea || !ideaSessionId) return;
        setDirectionsLoading(true);
        setError('');
        try {
            const result = await apiClient.getStrategicDirections({
                ideaSessionId,
                selectedIdea,
                userElaboration: `${userElaboration}\n\nBudget: ${budget}\n\nApproved Expanded Concept: ${JSON.stringify(expandedIdea)}`,
                comments: commentHistory.length > 0 ? commentHistory : undefined,
            });
            setDirections(result.directions);
            setPhase(PHASE.DIRECTIONS);
        } catch (err: any) {
            setError(err.message || 'Failed to generate strategic directions. Please try again.');
        } finally {
            setDirectionsLoading(false);
        }
    };

    // Phase 2 → Skip directions, go directly to analysis with the corrected plan
    const handleDirectAnalysis = async () => {
        if (!selectedIdea || !ideaSessionId) return;
        setAnalysisLoading(true);
        setLoadingPhase(0);
        setPhase(PHASE.ANALYZING);
        setError('');

        phaseTimer.current = setInterval(() => {
            setLoadingPhase(p => (p + 1) % LOADING_PHASES.length);
        }, 8000);

        timeoutTimer.current = setTimeout(() => {
            clearInterval(phaseTimer.current!);
            setAnalysisLoading(false);
            setPhase(PHASE.EXPANSION);
            setError('The analysis is taking too long — please try again.');
        }, 90000);

        try {
            const result = await apiClient.analyzeIdea({
                ideaSessionId,
                selectedIdea,
                userElaboration: `${userElaboration}\n\nBudget: ${budget}\n\nApproved Expanded Concept: ${JSON.stringify(expandedIdea)}`,
            });
            clearInterval(phaseTimer.current!);
            clearTimeout(timeoutTimer.current!);
            sessionStorage.setItem('upstart_analysis', JSON.stringify(result));
            router.push('/dashboard');
        } catch (err: any) {
            clearInterval(phaseTimer.current!);
            clearTimeout(timeoutTimer.current!);
            setPhase(PHASE.EXPANSION);
            setError(err.message || 'Failed to analyze idea. Please try again.');
        } finally {
            setAnalysisLoading(false);
        }
    };

    // Phase 3 → Full analysis
    const handleAnalyze = async () => {
        if (selectedDirection === null || !selectedIdea || !ideaSessionId) return;
        setAnalysisLoading(true);
        setLoadingPhase(0);
        setPhase(PHASE.ANALYZING);
        setError('');

        phaseTimer.current = setInterval(() => {
            setLoadingPhase(p => (p + 1) % LOADING_PHASES.length);
        }, 8000);

        timeoutTimer.current = setTimeout(() => {
            clearInterval(phaseTimer.current!);
            setAnalysisLoading(false);
            setPhase(PHASE.DIRECTIONS);
            setError('The analysis is taking too long — please try again.');
        }, 90000);

        try {
            const result = await apiClient.analyzeIdea({
                ideaSessionId,
                selectedIdea,
                strategicDirection: directions[selectedDirection],
                userElaboration: `${userElaboration}\n\nBudget: ${budget}\n\nApproved Expanded Concept: ${JSON.stringify(expandedIdea)}`,
            });
            clearInterval(phaseTimer.current!);
            clearTimeout(timeoutTimer.current!);
            sessionStorage.setItem('upstart_analysis', JSON.stringify(result));
            router.push('/dashboard');
        } catch (err: any) {
            clearInterval(phaseTimer.current!);
            clearTimeout(timeoutTimer.current!);
            setPhase(PHASE.DIRECTIONS);
            setError(err.message || 'Failed to analyze idea. Please try again.');
        } finally {
            setAnalysisLoading(false);
        }
    };

    if (!ready) return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
            <div className="loading-spinner" />
        </div>
    );

    const phaseLabels = ['Your Profile', 'Ideas', 'Evolve & Strategy', 'Analysis'];
    const activeProgress = phase >= PHASE.DIRECTIONS ? 3 : 2;

    return (
        <div style={{ maxWidth: '960px', margin: '0 auto', padding: '60px 24px' }}>

            {/* Header */}
            <div className="animate-fade-in-up" style={{ textAlign: 'center', marginBottom: '40px' }}>
                <h1 style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-0.03em', marginBottom: '12px', textTransform: 'uppercase' }}>
                    <span className={phase === PHASE.ELABORATE ? 'highlight' : phase === PHASE.VIABILITY ? 'highlight-amber' : phase === PHASE.EXPANSION ? 'highlight-blue' : 'highlight-pink'}>
                        {phase === PHASE.ELABORATE ? 'Evolve Your Idea' :
                            phase === PHASE.VIABILITY ? 'Viability & Risk Check' :
                                phase === PHASE.EXPANSION ? 'Review AI Expansion' :
                                    phase === PHASE.DIRECTIONS ? 'Choose Your Strategy' : 'Generating Blueprint'}
                    </span>
                </h1>
                <p style={{ fontSize: '1.05rem', fontWeight: 800 }}>
                    {phase === PHASE.ELABORATE ? 'Tell us more so we can build the best version of your startup.' :
                        phase === PHASE.VIABILITY ? 'We checked your idea against the market. Here are the risks and similar companies.' :
                            phase === PHASE.EXPANSION ? 'Here\'s what we think your startup looks like. Is this correct?' :
                                phase === PHASE.DIRECTIONS ? 'Select the strategic approach that resonates with your vision.' :
                                    'Sit tight — generating your full VC-grade analysis...'}
                </p>
            </div>

            {/* Progress */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '36px' }}>
                {phaseLabels.map((step, i) => (
                    <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                        <div className="progress-bar">
                            <div className="progress-fill" style={{ width: i <= activeProgress ? '100%' : '0%' }} />
                        </div>
                        <p style={{ fontSize: '0.82rem', marginTop: '8px', fontWeight: 800, textTransform: 'uppercase', opacity: i <= activeProgress ? 1 : 0.5 }}>{step}</p>
                    </div>
                ))}
            </div>

            {/* Selected Idea (always visible) */}
            {selectedIdea && (
                <div style={{
                    padding: '18px 20px', marginBottom: '24px',
                    background: 'var(--color-surface)', border: 'var(--border-width) solid var(--color-border)',
                    borderRadius: 'var(--border-radius)', boxShadow: '8px 8px 0px 0px var(--shadow-color)',
                    borderLeft: '8px solid var(--color-secondary)'
                }}>
                    <p style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', color: 'var(--color-text-3)' }}>📌 Selected Idea</p>
                    <h3 style={{ fontWeight: 900, fontSize: '1.1rem', textTransform: 'uppercase', marginBottom: '4px' }}>{selectedIdea.title}</h3>
                    <p style={{ fontStyle: 'italic', fontWeight: 600, color: 'var(--color-text-2)', fontSize: '0.9rem' }}>"{selectedIdea.tagline}"</p>
                </div>
            )}

            {/* ======================== PHASE 1: ELABORATE ======================== */}
            {phase === PHASE.ELABORATE && (
                <div className="animate-fade-in-up">
                    <div style={{
                        padding: '32px', background: 'var(--color-surface)',
                        border: 'var(--border-width) solid var(--color-border)',
                        borderRadius: 'var(--border-radius)', boxShadow: '10px 10px 0px 0px var(--shadow-color)',
                        marginBottom: '24px'
                    }}>
                        <label className="input-label" style={{ fontSize: '1rem', marginBottom: '14px', display: 'block' }}>
                            💭 Explain your vision
                        </label>
                        <textarea
                            className="input-field"
                            value={userElaboration}
                            onChange={(e) => setUserElaboration(e.target.value)}
                            placeholder="What makes your approach unique? Who is your ideal first customer? Any specific constraints or preferences? The more you share, the better the AI can refine your idea..."
                            rows={5}
                            style={{ resize: 'vertical', minHeight: '120px', lineHeight: 1.6 }}
                        />

                        {/* Budget selector */}
                        <div style={{ marginTop: '20px' }}>
                            <label className="input-label">💰 Budget Range</label>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                                {BUDGET_OPTIONS.map((opt) => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => setBudget(opt.value)}
                                        style={{
                                            padding: '14px 10px',
                                            background: budget === opt.value ? opt.color : 'var(--color-surface)',
                                            border: `var(--border-width) solid var(--color-border)`,
                                            borderRadius: 'var(--border-radius)',
                                            fontWeight: 900,
                                            fontSize: '0.9rem',
                                            textTransform: 'uppercase',
                                            cursor: 'pointer',
                                            boxShadow: budget === opt.value ? '6px 6px 0px 0px var(--shadow-color)' : '4px 4px 0px 0px var(--shadow-color)',
                                            transform: budget === opt.value ? 'translate(-2px, -2px)' : 'none',
                                            transition: 'all 0.1s ease',
                                        }}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {expandLoading && (
                        <div style={{ padding: '24px', background: 'var(--color-surface)', border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)', boxShadow: '6px 6px 0px 0px var(--shadow-color)', textAlign: 'center', marginBottom: '20px' }}>
                            <div style={{ fontSize: '3rem', marginBottom: '8px' }}>🧠</div>
                            <p style={{ fontWeight: 900, fontSize: '1rem', textTransform: 'uppercase' }}>Expanding Your Idea</p>
                            <p style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--color-text-2)' }}>Crafting a detailed, investor-ready expansion...</p>
                        </div>
                    )}
                </div>
            )}

            {/* ======================== PHASE 1.5: VIABILITY CHECK ======================== */}
            {phase === PHASE.VIABILITY && viability && (
                <div className="animate-fade-in-up">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '20px' }}>
                        {/* Similarity / Competitors */}
                        <div style={{
                            background: 'var(--color-surface)', border: 'var(--border-width) solid var(--color-border)',
                            borderRadius: 'var(--border-radius)', boxShadow: '8px 8px 0px 0px var(--shadow-color)',
                            overflow: 'hidden'
                        }}>
                            <div style={{ padding: '20px 24px', background: 'var(--color-primary)', borderBottom: 'var(--border-width) solid var(--color-border)' }}>
                                <p style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}>🔍 Vector DB Simulation</p>
                                <h2 style={{ fontWeight: 900, fontSize: '1.4rem', marginTop: '4px' }}>Idea Similarity: {viability.similarity.score}%</h2>
                                <p style={{ fontWeight: 800, fontSize: '0.9rem', marginTop: '4px' }}>To {viability.similarity.companies.length} existing or failed companies.</p>
                            </div>
                            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                {viability.similarity.companies.map((comp, i) => (
                                    <div key={i} style={{ padding: '12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--border-radius)' }}>
                                        <p style={{ fontWeight: 900, fontSize: '0.95rem', textTransform: 'uppercase' }}>{comp.name}</p>
                                        <p style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-2)', marginBottom: '8px' }}>{comp.description}</p>
                                        <div style={{ padding: '8px', background: 'var(--color-rose)', border: '1px solid var(--color-border)', borderRadius: '4px' }}>
                                            <p style={{ fontSize: '0.65rem', fontWeight: 900, textTransform: 'uppercase' }}>Why They Struggled</p>
                                            <p style={{ fontSize: '0.8rem', fontWeight: 700 }}>{comp.failureReason}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Risk Detection */}
                        <div style={{
                            background: 'var(--color-surface)', border: 'var(--border-width) solid var(--color-border)',
                            borderRadius: 'var(--border-radius)', boxShadow: '8px 8px 0px 0px var(--shadow-color)',
                            overflow: 'hidden'
                        }}>
                            <div style={{ padding: '20px 24px', background: 'var(--color-secondary)', borderBottom: 'var(--border-width) solid var(--color-border)' }}>
                                <p style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}>⚠️ LLM Risk Engine</p>
                                <h2 style={{ fontWeight: 900, fontSize: '1.4rem', marginTop: '4px' }}>Identified Friction Points</h2>
                            </div>
                            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                {viability.risks.map((risk, i) => {
                                    const levelColors: Record<string, string> = { High: 'var(--color-rose)', Medium: 'var(--color-amber, #FCD34D)', Low: 'var(--color-emerald)' };
                                    const levelColor = levelColors[risk.level] || 'var(--color-border)';
                                    const badgeClass = risk.level === 'High' ? 'rose' : risk.level === 'Medium' ? 'amber' : 'emerald';
                                    return (
                                        <div key={i} style={{ padding: '12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--border-radius)', borderLeft: `4px solid ${levelColor}` }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                                <p style={{ fontWeight: 900, fontSize: '0.85rem', textTransform: 'uppercase' }}>{risk.category}</p>
                                                <span className={`badge badge-${badgeClass}`}>{risk.level}</span>
                                            </div>
                                            <p style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '8px' }}>{risk.reason}</p>
                                            <p style={{ fontSize: '0.8rem', fontWeight: 800, padding: '6px 8px', background: 'var(--color-accent)', border: '1px solid var(--color-border)', borderRadius: '4px' }}>💡 Pivot: {risk.suggestion}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ======================== PHASE 2: AI EXPANSION REVIEW ======================== */}
            {
                phase === PHASE.EXPANSION && expandedIdea && (
                    <div className="animate-fade-in-up">
                        {/* Refinement badge */}
                        {refinementCount > 1 && (
                            <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <span className="badge badge-blue">🔄 Refinement #{refinementCount}</span>
                                <span className="badge badge-amber">💬 {commentHistory.length} comment{commentHistory.length !== 1 ? 's' : ''} incorporated</span>
                            </div>
                        )}

                        {/* Expanded idea card */}
                        <div style={{
                            background: 'var(--color-surface)', border: 'var(--border-width) solid var(--color-border)',
                            borderRadius: 'var(--border-radius)', boxShadow: '10px 10px 0px 0px var(--shadow-color)',
                            overflow: 'hidden', marginBottom: '24px'
                        }}>
                            {/* Title header */}
                            <div style={{ padding: '20px 24px', background: 'var(--color-secondary)', borderBottom: 'var(--border-width) solid var(--color-border)' }}>
                                <p style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>🚀 AI-Expanded Startup Concept</p>
                                <h2 style={{ fontWeight: 900, fontSize: '1.4rem', textTransform: 'uppercase' }}>{expandedIdea.expandedTitle}</h2>
                            </div>

                            <div style={{ padding: '24px', display: 'grid', gap: '14px' }}>
                                {[
                                    { label: '🩸 The Problem', text: expandedIdea.expandedProblem, bg: 'var(--color-rose)' },
                                    { label: '💊 The Solution', text: expandedIdea.expandedSolution, bg: 'var(--color-emerald)' },
                                    { label: '👥 Target Users', text: expandedIdea.expandedTargetUsers, bg: 'var(--color-bg)' },
                                    { label: '⚡ Unique Angle', text: expandedIdea.uniqueAngle, bg: 'var(--color-primary)' },
                                ].map((block, i) => (
                                    <div key={i} style={{ padding: '16px', background: block.bg, border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)', boxShadow: '4px 4px 0px 0px var(--shadow-color)' }}>
                                        <p style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>{block.label}</p>
                                        <p style={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.6 }}>{block.text}</p>
                                    </div>
                                ))}

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                                    {[
                                        { label: '💵 Revenue Model', text: expandedIdea.revenueModel },
                                        { label: '💰 Budget Allocation', text: expandedIdea.estimatedBudget },
                                        { label: '🛠️ Core Tech', text: expandedIdea.coreTechApproach },
                                        { label: '📈 Market Size', text: expandedIdea.marketSize },
                                    ].map((block, i) => (
                                        <div key={i} style={{ padding: '16px', background: 'var(--color-surface)', border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)', boxShadow: '3px 3px 0px 0px var(--shadow-color)' }}>
                                            <p style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>{block.label}</p>
                                            <p style={{ fontSize: '0.9rem', fontWeight: 700, lineHeight: 1.5 }}>{block.text}</p>
                                        </div>
                                    ))}
                                </div>

                                <div style={{ padding: '16px', background: 'var(--color-accent)', border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)', boxShadow: '4px 4px 0px 0px var(--shadow-color)' }}>
                                    <p style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>🔒 Competitive Edge</p>
                                    <p style={{ fontSize: '0.95rem', fontWeight: 800, lineHeight: 1.5 }}>{expandedIdea.competitiveEdge}</p>
                                </div>
                            </div>
                        </div>

                        {/* Comment / Feedback section */}
                        <div style={{
                            padding: '32px', background: 'var(--color-surface)',
                            border: 'var(--border-width) solid var(--color-border)',
                            borderRadius: 'var(--border-radius)', boxShadow: '8px 8px 0px 0px var(--shadow-color)',
                            marginBottom: '24px'
                        }}>
                            <label className="input-label" style={{ marginBottom: '10px', display: 'block' }}>
                                💬 Is this correct? Add your feedback below:
                            </label>
                            <textarea
                                className="input-field"
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                                placeholder="What would you change? Any corrections, additions, or different emphasis? Leave empty and click 'Looks Good' to proceed..."
                                rows={3}
                                style={{ resize: 'vertical', minHeight: '80px', lineHeight: 1.6 }}
                            />

                            {/* Previous comments */}
                            {commentHistory.length > 0 && (
                                <div style={{ marginTop: '12px' }}>
                                    <p style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', marginBottom: '6px', color: 'var(--color-text-3)' }}>Previous feedback:</p>
                                    {commentHistory.map((c, i) => (
                                        <div key={i} style={{ padding: '8px 12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--border-radius)', marginBottom: '4px', fontSize: '0.82rem', fontWeight: 600, fontStyle: 'italic' }}>
                                            #{i + 1}: "{c}"
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Expand loading overlay */}
                        {expandLoading && (
                            <div style={{ padding: '24px', background: 'var(--color-surface)', border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)', boxShadow: '6px 6px 0px 0px var(--shadow-color)', textAlign: 'center', marginBottom: '20px' }}>
                                <div style={{ fontSize: '3rem', marginBottom: '8px' }}>🔄</div>
                                <p style={{ fontWeight: 900, fontSize: '1rem', textTransform: 'uppercase' }}>Refining with your feedback</p>
                                <p style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--color-text-2)' }}>Incorporating your corrections...</p>
                            </div>
                        )}

                        {directionsLoading && (
                            <div style={{ padding: '24px', background: 'var(--color-surface)', border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)', boxShadow: '6px 6px 0px 0px var(--shadow-color)', textAlign: 'center', marginBottom: '20px' }}>
                                <div style={{ fontSize: '3rem', marginBottom: '8px' }}>🧠</div>
                                <p style={{ fontWeight: 900, fontSize: '1rem', textTransform: 'uppercase' }}>Generating Strategic Directions</p>
                                <p style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--color-text-2)' }}>Crafting 3 unique strategic paths...</p>
                            </div>
                        )}
                    </div>
                )}

            {/* ======================== PHASE 3: STRATEGIC DIRECTIONS ======================== */}
            {
                phase === PHASE.DIRECTIONS && (
                    <div className="animate-fade-in-up">
                        <div style={{ display: 'grid', gap: '16px', marginBottom: '24px' }}>
                            {directions.map((dir, i) => (
                                <div
                                    key={i}
                                    className={`strategy-card ${selectedDirection === i ? 'selected' : ''}`}
                                    onClick={() => !analysisLoading && setSelectedDirection(i)}
                                    style={{ borderLeft: `6px solid ${DIRECTION_COLORS[i]}` }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{
                                                width: '42px', height: '42px', borderRadius: 'var(--border-radius)',
                                                background: DIRECTION_COLORS[i],
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '1.3rem', flexShrink: 0,
                                                border: 'var(--border-width) solid var(--color-border)',
                                                boxShadow: '2px 2px 0px 0px var(--shadow-color)',
                                            }}>{DIRECTION_ICONS[i]}</div>
                                            <h3 style={{ fontWeight: 900, fontSize: '1.15rem', textTransform: 'uppercase' }}>{dir.directionName}</h3>
                                        </div>
                                        {selectedDirection === i && (
                                            <span className="badge badge-emerald" style={{ transform: 'rotate(2deg)' }}>✓ Selected</span>
                                        )}
                                    </div>
                                    <p style={{ fontSize: '0.92rem', fontWeight: 600, lineHeight: 1.6, marginBottom: '12px' }}>{dir.description}</p>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                                        <div style={{ padding: '12px', background: 'var(--color-bg)', border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)' }}>
                                            <p style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>🔄 Core Pivot</p>
                                            <p style={{ fontSize: '0.9rem', fontWeight: 700, lineHeight: 1.5 }}>{dir.corePivot}</p>
                                        </div>
                                        <div style={{ padding: '12px', background: 'var(--color-bg)', border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)' }}>
                                            <p style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>🛠️ Key Stack</p>
                                            <p style={{ fontSize: '0.9rem', fontWeight: 700, lineHeight: 1.5 }}>{dir.keyStack}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )
            }

            {/* ======================== PHASE 4: ANALYSIS LOADING ======================== */}
            {
                phase === PHASE.ANALYZING && (
                    <div className="animate-fade-in-up" style={{ textAlign: 'center' }}>
                        <div style={{ padding: '40px 24px', background: 'var(--color-surface)', border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)', boxShadow: '10px 10px 0px 0px var(--shadow-color)', marginBottom: '24px' }}>
                            <div style={{ fontSize: '4rem', marginBottom: '16px' }}>{LOADING_PHASES[loadingPhase].icon}</div>
                            <p style={{ fontWeight: 900, fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                                Generating 5-Phase Blueprint
                            </p>
                            <p style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--color-text-2)', marginBottom: '16px' }}>
                                {LOADING_PHASES[loadingPhase].text}
                            </p>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginBottom: '16px' }}>
                                {LOADING_PHASES.map((_, i) => (
                                    <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: i === loadingPhase ? 'var(--color-primary)' : 'var(--color-border)', border: '2px solid var(--color-border)', transition: 'background 0.3s' }} />
                                ))}
                            </div>
                            <p style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-3)', textTransform: 'uppercase' }}>
                                This may take ~30–60 seconds for a comprehensive VC-grade report
                            </p>
                        </div>
                    </div>
                )
            }

            {/* Error */}
            {
                error && (
                    <div style={{
                        background: 'var(--color-error)', border: 'var(--border-width) solid var(--color-border)',
                        borderRadius: 'var(--border-radius)', padding: '12px 16px', marginBottom: '20px',
                        color: '#000000', fontSize: '0.95rem', fontWeight: 800,
                        boxShadow: '4px 4px 0px 0px var(--shadow-color)'
                    }}>⚠ {error}</div>
                )
            }

            {/* Action Buttons */}
            {
                phase !== PHASE.ANALYZING && (
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        {/* Back button */}
                        <button
                            onClick={() => {
                                if (phase === PHASE.DIRECTIONS) {
                                    setPhase(PHASE.EXPANSION);
                                    setDirections([]);
                                    setSelectedDirection(null);
                                } else if (phase === PHASE.EXPANSION) {
                                    setPhase(PHASE.VIABILITY);
                                    setExpandedIdea(null);
                                } else if (phase === PHASE.VIABILITY) {
                                    setPhase(PHASE.ELABORATE);
                                } else {
                                    router.push('/ideas');
                                }
                            }}
                            className="btn-secondary"
                            disabled={expandLoading || directionsLoading || viabilityLoading}
                        >
                            ← Back
                        </button>

                        {/* Phase-specific action */}
                        {phase === PHASE.ELABORATE && (
                            <button
                                onClick={handleCheckViability}
                                className="btn-primary"
                                disabled={viabilityLoading || !userElaboration.trim()}
                                style={{ minWidth: '240px', justifyContent: 'center' }}
                            >
                                {viabilityLoading ? '🔍 Checking Market...' : 'Check Viability & Expand →'}
                            </button>
                        )}

                        {phase === PHASE.VIABILITY && (
                            <button
                                onClick={handleExpandIdea}
                                className="btn-primary"
                                disabled={expandLoading}
                                style={{ minWidth: '240px', justifyContent: 'center' }}
                            >
                                {expandLoading ? '🧠 Expanding...' : 'Acknowledge Risks & Expand →'}
                            </button>
                        )}

                        {phase === PHASE.EXPANSION && (
                            <>
                                <button
                                    onClick={handleRefine}
                                    className="btn-secondary"
                                    disabled={!comment.trim() || expandLoading || directionsLoading || analysisLoading}
                                    style={{ minWidth: '180px', justifyContent: 'center' }}
                                >
                                    {expandLoading ? '🔄 Refining...' : '🔄 Refine With Feedback'}
                                </button>
                                <button
                                    onClick={handleDirectAnalysis}
                                    className="btn-primary"
                                    disabled={expandLoading || directionsLoading || analysisLoading}
                                    style={{ minWidth: '200px', justifyContent: 'center' }}
                                >
                                    {analysisLoading ? '⏳ Analyzing...' : '🚀 Go With This Plan →'}
                                </button>
                                <button
                                    onClick={handleApproveExpansion}
                                    className="btn-secondary"
                                    disabled={expandLoading || directionsLoading || analysisLoading}
                                    style={{ minWidth: '200px', justifyContent: 'center' }}
                                >
                                    {directionsLoading ? '🧠 Generating...' : '🎯 Explore Strategies'}
                                </button>
                            </>
                        )}

                        {phase === PHASE.DIRECTIONS && (
                            <button
                                onClick={handleAnalyze}
                                className="btn-primary"
                                disabled={selectedDirection === null || analysisLoading}
                                style={{ minWidth: '260px', justifyContent: 'center' }}
                            >
                                Generate VC Blueprint →
                            </button>
                        )}
                    </div>
                )
            }
        </div >
    );
}
