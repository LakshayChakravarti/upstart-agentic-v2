'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient, type SavedIdea } from '@/lib/api';

export default function SavedPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [ideas, setIdeas] = useState<SavedIdea[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [deletingId, setDeletingId] = useState<number | null>(null);

    useEffect(() => {
        if (!user) { router.push('/login'); return; }
        apiClient.getSavedIdeas()
            .then(res => setIdeas(res.ideas))
            .catch(err => setError(err.message || 'Failed to load ideas'))
            .finally(() => setLoading(false));
    }, [user]);

    const handleDelete = async (e: React.MouseEvent, ideaId: number) => {
        e.stopPropagation(); // prevent card click nav
        if (!confirm('Delete this idea permanently? This cannot be undone.')) return;
        setDeletingId(ideaId);
        try {
            await apiClient.deleteIdea(ideaId);
            setIdeas(prev => prev.filter(i => i.id !== ideaId));
        } catch (err: any) {
            alert(err.message || 'Failed to delete idea');
        } finally {
            setDeletingId(null);
        }
    };

    if (loading) return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
            <div className="loading-spinner" />
        </div>
    );

    return (
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '60px 24px', overflowX: 'hidden' }}>
            <div className="animate-fade-in-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-0.02em', marginBottom: '8px', color: 'var(--color-text-1)', textTransform: 'uppercase' }}>
                        <span className="highlight-blue">Saved Ideas</span>
                    </h1>
                    <p style={{ color: 'var(--color-text-1)', fontSize: '1.1rem', fontWeight: 800 }}>
                        {ideas.length} idea{ideas.length !== 1 ? 's' : ''} saved to your account
                    </p>
                </div>
                <Link href="/generate" className="btn-primary">+ Generate New Idea</Link>
            </div>

            {error && (
                <div style={{ background: 'var(--color-error)', border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)', padding: '14px 18px', marginBottom: '24px', color: '#000000', fontWeight: 900, boxShadow: '4px 4px 0px 0px var(--shadow-color)' }}>
                    ⚠ {error}
                </div>
            )}

            {!loading && ideas.length === 0 ? (
                <div className="section-card" style={{ padding: '64px 32px', textAlign: 'center', background: 'var(--color-primary)' }}>
                    <div style={{ fontSize: '4rem', marginBottom: '16px', filter: 'drop-shadow(4px 4px 0px #000000)' }}>🚀</div>
                    <h2 style={{ fontWeight: 900, fontSize: '1.5rem', marginBottom: '12px', color: 'var(--color-text-1)', textTransform: 'uppercase' }}>No saved ideas yet</h2>
                    <p style={{ color: 'var(--color-text-1)', marginBottom: '32px', fontSize: '1.1rem', fontWeight: 600 }}>
                        Generate your first startup idea and click "Save" on the analysis dashboard.
                    </p>
                    <Link href="/generate" className="btn-primary" style={{ background: 'var(--color-surface)' }}>Start Generating →</Link>
                </div>
            ) : (
                <div style={{ display: 'grid', gap: '16px' }}>
                    {ideas.map((idea, i) => (
                        <div
                            key={idea.id}
                            className="section-card"
                            style={{ cursor: 'pointer', transition: 'all 0.2s' }}
                            onClick={() => router.push(`/saved/${idea.id}`)}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                                        <div style={{
                                            width: '32px', height: '32px', borderRadius: 'var(--border-radius)',
                                            background: 'var(--color-secondary)', display: 'flex', alignItems: 'center',
                                            justifyContent: 'center', fontSize: '0.9rem', fontWeight: 900, color: '#000000',
                                            flexShrink: 0, border: 'var(--border-width) solid var(--color-border)',
                                            boxShadow: '2px 2px 0px 0px var(--shadow-color)'
                                        }}>{i + 1}</div>
                                        <h2 style={{ fontWeight: 900, fontSize: '1.2rem', color: 'var(--color-text-1)', textTransform: 'uppercase', wordBreak: 'break-word', lineHeight: 1.3 }}>
                                            {idea.selectedIdea?.title || 'Untitled Idea'}
                                        </h2>
                                    </div>
                                    <p style={{ fontSize: '0.95rem', color: 'var(--color-text-1)', marginBottom: '14px', paddingLeft: '44px', fontWeight: 600, fontStyle: 'italic' }}>
                                        "{idea.selectedIdea?.tagline}"
                                    </p>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', paddingLeft: '44px' }}>
                                        <span className="badge badge-emerald" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📂 {idea.domain}</span>
                                        {(idea.feasibility?.scores?.compositeScore || idea.feasibility?.feasibilityScore) && (
                                            <span className="badge badge-blue">⚡ {idea.feasibility.scores?.compositeScore ?? idea.feasibility.feasibilityScore}/100 {idea.feasibility.scores?.grade ? `(${idea.feasibility.scores.grade})` : ''}</span>
                                        )}
                                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-3)', fontWeight: 700, alignSelf: 'center' }}>
                                            {new Date(idea.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </span>
                                    </div>
                                </div>

                                {/* Action buttons */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); router.push(`/saved/${idea.id}`); }}
                                        className="btn-primary"
                                        style={{ fontSize: '0.85rem', padding: '8px 16px', whiteSpace: 'nowrap' }}
                                    >
                                        👁 Revisit →
                                    </button>
                                    <button
                                        onClick={(e) => handleDelete(e, idea.id)}
                                        disabled={deletingId === idea.id}
                                        style={{
                                            fontSize: '0.85rem', padding: '8px 16px',
                                            background: deletingId === idea.id ? 'var(--color-surface)' : 'var(--color-rose)',
                                            border: 'var(--border-width) solid var(--color-border)',
                                            borderRadius: 'var(--border-radius)',
                                            fontWeight: 900, cursor: 'pointer',
                                            boxShadow: '2px 2px 0px 0px var(--shadow-color)',
                                            transition: 'all 0.1s',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {deletingId === idea.id ? '⏳ Deleting...' : '🗑 Delete'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
