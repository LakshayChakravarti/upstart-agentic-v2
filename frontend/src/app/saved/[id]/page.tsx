'use client';
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/api';
import { Printer, Trash2, ExternalLink } from 'lucide-react';

export default function SavedIdeaPage() {
    const { user } = useAuth();
    const router = useRouter();
    const params = useParams();
    const id = Number(params.id);

    const [data, setData] = useState<{ idea: any; analysis: any } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [deleting, setDeleting] = useState(false);

    const handleDelete = async () => {
        if (!confirm('Are you sure you want to delete this idea?')) return;
        setDeleting(true);
        try {
            await apiClient.deleteIdea(id);
            router.push('/saved');
        } catch (err: any) {
            setError(err.message || 'Failed to delete idea');
            setDeleting(false);
        }
    };

    useEffect(() => {
        if (!user) { router.push('/login'); return; }
        apiClient.getIdea(id)
            .then(res => setData(res))
            .catch(err => setError(err.message || 'Failed to load idea'))
            .finally(() => setLoading(false));
    }, [user, id]);

    if (loading) return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
            <div className="loading-spinner" />
        </div>
    );

    if (error || !data) return (
        <div style={{ maxWidth: '700px', margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
            <p style={{ fontWeight: 900, fontSize: '1.2rem', color: 'var(--color-error)' }}>⚠ {error || 'Idea not found'}</p>
            <button onClick={() => router.push('/saved')} className="btn-secondary" style={{ marginTop: '24px' }}>← Back to Saved</button>
        </div>
    );

    const { idea, analysis } = data;
    const selectedIdea = idea.selected_idea;
    const bp = analysis ? {
        ...analysis,
        adversarial: analysis.adversarial,
    } : null;

    const feasScore = bp?.scores?.compositeScore ?? bp?.feasibilityScore ?? (bp?.scores?.technicalFeasibility ? Math.round((bp.scores.technicalFeasibility + bp.scores.marketReadiness + bp.scores.regulatoryRisk + bp.scores.competitiveAdvantage + bp.scores.executionComplexity) / 5) : 0);
    const feasColor = feasScore >= 70 ? 'var(--color-emerald)' : feasScore >= 50 ? 'var(--color-primary)' : 'var(--color-rose)';

    const adv = bp?.adversarial || {};

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 24px 80px' }}>
            {/* Header */}
            <div className="animate-jitter-in" style={{ marginBottom: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
                    <div>
                        <p style={{ fontSize: '0.85rem', fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '12px', borderBottom: 'var(--border-width) solid var(--color-border)', display: 'inline-block' }}>
                            Agentic V2 Blueprint · {new Date(idea.created_at).toLocaleDateString()}
                        </p>
                        <h1 className="hover-glitch" style={{ fontSize: '3rem', fontWeight: 900, letterSpacing: '-0.02em', marginBottom: '12px', color: 'var(--color-text-1)', textTransform: 'uppercase', textShadow: '4px 4px 0px 0px #000000', WebkitTextStroke: '2px black', WebkitTextFillColor: 'white' }}>
                            {bp?.startupName || selectedIdea?.title || 'Untitled'}
                        </h1>
                        <p style={{ fontWeight: 800, fontSize: '1.15rem', background: 'var(--color-primary)', display: 'inline-block', padding: '6px 14px', border: 'var(--border-width) solid var(--color-border)', transform: 'rotate(-1deg)', boxShadow: '4px 4px 0px 0px var(--shadow-color)' }}>
                            "{bp?.tagline || selectedIdea?.tagline}"
                        </p>
                    </div>

                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <button onClick={() => window.print()} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 20px', fontSize: '0.9rem' }}>
                            <Printer size={16} strokeWidth={2.5} /> Print PDF
                        </button>
                        <button onClick={handleDelete} disabled={deleting} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--color-error)', color: 'black', padding: '12px 20px', fontSize: '0.9rem' }}>
                            <Trash2 size={16} strokeWidth={2.5} /> {deleting ? 'Deleting...' : 'Delete'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Badges */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '32px' }}>
                <span className="badge badge-emerald" style={{ boxShadow: '3px 3px 0px 0px var(--shadow-color)', padding: '8px 14px', fontSize: '0.9rem' }}>📂 {idea.domain}</span>
                {feasScore > 0 && <span className="badge badge-blue" style={{ boxShadow: '3px 3px 0px 0px var(--shadow-color)', padding: '8px 14px', fontSize: '0.9rem' }}>Score: {feasScore}/100</span>}
            </div>

            {!bp ? (
                <div className="section-card" style={{ textAlign: 'center', padding: '48px' }}>
                    <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>No analysis found for this idea.</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px', alignItems: 'start' }}>
                    
                    {/* Left Column: Adversarial Personas */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        
                        {/* Summary */}
                        {bp.summary && (
                            <div className="section-card hover-pop-card animate-brutal-bounce delay-100" style={{ borderLeft: '8px solid var(--color-primary)', padding: 0, overflow: 'hidden', boxShadow: '8px 8px 0px 0px var(--shadow-color)', background: 'var(--color-bg)' }}>
                                <div className="section-card-header" style={{ padding: '20px 24px', background: 'var(--color-bg)', borderBottom: 'var(--border-width) solid var(--color-border)', marginBottom: '0' }}>
                                    <div className="section-icon" style={{ boxShadow: '4px 4px 0px 0px var(--shadow-color)', width: '48px', height: '48px', fontSize: '1.4rem' }}>🎯</div>
                                    <div>
                                        <h2 style={{ fontWeight: 900, fontSize: '1.2rem', color: 'var(--color-text-1)', textTransform: 'uppercase', letterSpacing: '-0.02em' }}>Elevator Pitch</h2>
                                    </div>
                                </div>
                                <div style={{ padding: '24px' }}>
                                    <p style={{ fontSize: '1.1rem', fontWeight: 700, lineHeight: '1.8', fontStyle: 'italic', borderLeft: '4px solid var(--color-border)', paddingLeft: '20px' }}>"{bp.summary}"</p>
                                </div>
                            </div>
                        )}

                        {/* THE REAPER (Red) */}
                        {adv.theReaper && Array.isArray(adv.theReaper) && (
                            <div className="section-card hover-pop-card animate-brutal-bounce delay-200" style={{ border: '4px solid #ef4444', padding: 0, overflow: 'hidden', boxShadow: '8px 8px 0px 0px #ef4444' }}>
                                <div className="section-card-header" style={{ padding: '20px 24px', background: '#ef4444', borderBottom: 'var(--border-width) solid var(--color-border)', marginBottom: '0' }}>
                                    <div className="section-icon" style={{ boxShadow: '4px 4px 0px 0px #000', width: '48px', height: '48px', fontSize: '1.4rem', background: '#000', color: '#fff' }}>💀</div>
                                    <div>
                                        <h2 style={{ fontWeight: 900, fontSize: '1.2rem', color: '#000', textTransform: 'uppercase', letterSpacing: '-0.02em' }}>The Reaper</h2>
                                        <p style={{ fontSize: '0.9rem', color: '#000', fontWeight: 800 }}>Why this will fail</p>
                                    </div>
                                </div>
                                <div style={{ padding: '24px', background: 'var(--color-surface)' }}>
                                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        {adv.theReaper.map((r: any, i: number) => (
                                            <li key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                                                <span style={{ color: '#ef4444', fontSize: '1.2rem', fontWeight: 900, marginTop: '-2px' }}>✖</span>
                                                <p style={{ fontSize: '1rem', fontWeight: 700, lineHeight: 1.6 }}>{r.point || r.reason || r}</p>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        )}

                        {/* THE PAIN MINER (Orange) */}
                        {adv.thePainMiner && Array.isArray(adv.thePainMiner) && (
                            <div className="section-card hover-pop-card animate-brutal-bounce delay-300" style={{ border: '4px solid #f97316', padding: 0, overflow: 'hidden', boxShadow: '8px 8px 0px 0px #f97316' }}>
                                <div className="section-card-header" style={{ padding: '20px 24px', background: '#fdba74', borderBottom: 'var(--border-width) solid var(--color-border)', marginBottom: '0' }}>
                                    <div className="section-icon" style={{ boxShadow: '4px 4px 0px 0px #000', width: '48px', height: '48px', fontSize: '1.4rem', background: '#fff', color: '#000' }}>⛏️</div>
                                    <div>
                                        <h2 style={{ fontWeight: 900, fontSize: '1.2rem', color: '#000', textTransform: 'uppercase', letterSpacing: '-0.02em' }}>The Pain Miner</h2>
                                        <p style={{ fontSize: '0.9rem', color: '#000', fontWeight: 800 }}>Real customer frustrations</p>
                                    </div>
                                </div>
                                <div style={{ padding: '24px', background: 'var(--color-surface)' }}>
                                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        {adv.thePainMiner.map((p: any, i: number) => (
                                            <li key={i} style={{ padding: '12px 16px', background: 'var(--color-bg)', border: '2px solid var(--color-border)', borderRadius: 'var(--border-radius)', boxShadow: '2px 2px 0px 0px var(--shadow-color)' }}>
                                                <p style={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.5 }}>"{p.frustration || p.pain || p}"</p>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        )}

                        {/* THE PRICING ARCHITECT (3-Column) */}
                        {adv.pricingArchitect && (
                            <div className="section-card hover-pop-card animate-brutal-bounce delay-400" style={{ padding: 0, overflow: 'hidden', boxShadow: '8px 8px 0px 0px var(--color-emerald)', border: '4px solid var(--color-emerald)' }}>
                                <div className="section-card-header" style={{ padding: '20px 24px', background: 'var(--color-emerald)', borderBottom: 'var(--border-width) solid var(--color-border)', marginBottom: '0' }}>
                                    <div className="section-icon" style={{ boxShadow: '4px 4px 0px 0px #000', width: '48px', height: '48px', fontSize: '1.4rem' }}>💰</div>
                                    <div>
                                        <h2 style={{ fontWeight: 900, fontSize: '1.2rem', color: '#000', textTransform: 'uppercase', letterSpacing: '-0.02em' }}>The Pricing Architect</h2>
                                    </div>
                                </div>
                                <div style={{ padding: '24px', background: 'var(--color-surface)' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                                        {['starter', 'pro', 'enterprise'].map((tier, idx) => {
                                            const tierData = adv.pricingArchitect[tier];
                                            if (!tierData) return null;
                                            return (
                                                <div key={tier} style={{ padding: '16px', background: idx === 1 ? 'var(--color-primary)' : 'var(--color-bg)', border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)', boxShadow: '4px 4px 0px 0px var(--shadow-color)' }}>
                                                    <h3 style={{ textTransform: 'uppercase', fontWeight: 900, fontSize: '1.1rem', marginBottom: '8px', paddingBottom: '8px', borderBottom: '2px solid var(--color-border)' }}>{tier}</h3>
                                                    <p style={{ fontSize: '1.4rem', fontWeight: 900, marginBottom: '16px' }}>{tierData.price}</p>
                                                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                        {(tierData.features || []).map((f: string, i: number) => (
                                                            <li key={i} style={{ fontSize: '0.85rem', fontWeight: 700, borderBottom: '1px solid rgba(0,0,0,0.1)', paddingBottom: '4px' }}>✓ {f}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* THE PIVOT MASTER (High Contrast Blue) */}
                        {adv.thePivotMaster && (
                            <div className="section-card hover-pop-card animate-brutal-bounce delay-500" style={{ border: '4px solid #1e3a8a', background: '#2563eb', padding: '32px', boxShadow: '8px 8px 0px 0px #000', color: '#fff' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
                                    <div style={{ fontSize: '2rem' }}>🚀</div>
                                    <h2 style={{ fontWeight: 900, fontSize: '1.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>The Pivot Master</h2>
                                </div>
                                <div style={{ background: '#1e3a8a', padding: '20px', borderRadius: 'var(--border-radius)', border: '2px solid #000' }}>
                                    <p style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', color: '#93c5fd', marginBottom: '8px' }}>The Winning Edge</p>
                                    <p style={{ fontSize: '1.1rem', fontWeight: 700, lineHeight: 1.6, color: '#fff' }}>{adv.thePivotMaster.winningEdge}</p>
                                </div>
                            </div>
                        )}

                    </div>

                    {/* Right Column: Sidebar (Research Sources) */}
                    <div style={{ position: 'sticky', top: '24px' }}>
                        <div className="section-card" style={{ padding: 0, overflow: 'hidden', boxShadow: '6px 6px 0px 0px var(--shadow-color)', border: '4px solid var(--color-border)' }}>
                            <div style={{ padding: '16px 20px', background: 'var(--color-bg)', borderBottom: 'var(--border-width) solid var(--color-border)' }}>
                                <h3 style={{ fontWeight: 900, fontSize: '1rem', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontSize: '1.2rem' }}>🌐</span> Research Sources
                                </h3>
                            </div>
                            <div style={{ padding: '20px', background: 'var(--color-surface)' }}>
                                {(adv.researchSources && adv.researchSources.length > 0) ? (
                                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        {adv.researchSources.map((source: any, i: number) => (
                                            <li key={i}>
                                                <a href={source.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: '12px', background: 'var(--color-bg)', border: '2px solid var(--color-border)', borderRadius: 'var(--border-radius)', textDecoration: 'none', color: 'var(--color-text-1)', boxShadow: '2px 2px 0px 0px var(--shadow-color)', transition: 'transform 0.1s' }} onMouseOver={e => e.currentTarget.style.transform = 'translate(-2px, -2px)'} onMouseOut={e => e.currentTarget.style.transform = 'translate(0,0)'}>
                                                    <p style={{ fontSize: '0.82rem', fontWeight: 800, marginBottom: '4px', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source.title || new URL(source.url).hostname}</p>
                                                    <p style={{ fontSize: '0.7rem', color: 'var(--color-text-3)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', wordBreak: 'break-all' }}>
                                                        <ExternalLink size={12} /> {source.url}
                                                    </p>
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-3)', textAlign: 'center', fontStyle: 'italic' }}>No external sources were analyzed.</p>
                                )}
                            </div>
                        </div>

                        {/* Feasibility score as a mini badge under sources just to preserve the score logic */}
                        {bp?.scores?.scoreRationale && (
                             <div className="section-card" style={{ padding: '16px', marginTop: '24px', boxShadow: '4px 4px 0px 0px var(--shadow-color)' }}>
                                 <h4 style={{ fontWeight: 900, fontSize: '0.85rem', textTransform: 'uppercase', marginBottom: '8px' }}>🤖 AI Rationale</h4>
                                 <p style={{ fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.5 }}>{bp.scores.scoreRationale}</p>
                             </div>
                        )}
                    </div>

                </div>
            )}
        </div>
    );
}
