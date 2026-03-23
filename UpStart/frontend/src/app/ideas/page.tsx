'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient, type Idea } from '@/lib/api';

export default function IdeasPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [ideas, setIdeas] = useState<Idea[]>([]);
    const [ideaSessionId, setIdeaSessionId] = useState<number | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [error, setError] = useState('');
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!user) { router.push('/login'); return; }
        const stored = sessionStorage.getItem('upstart_ideas');
        if (!stored) { router.push('/generate'); return; }
        try {
            const data = JSON.parse(stored);
            const parsedIdeas = data.ideas;
            // Guard: stale sessionStorage may have an object instead of array
            if (!Array.isArray(parsedIdeas) || parsedIdeas.length === 0) {
                sessionStorage.removeItem('upstart_ideas');
                router.push('/generate');
                return;
            }
            setIdeas(parsedIdeas);
            setIdeaSessionId(data.ideaSessionId);
            setReady(true);
        } catch {
            router.push('/generate');
        }
    }, [user]);

    const handleProceed = () => {
        if (selectedIndex === null || !ideaSessionId) return;
        // Store selection for the /evolve page
        const stored = sessionStorage.getItem('upstart_ideas');
        if (stored) {
            const data = JSON.parse(stored);
            data.selectedIdea = ideas[selectedIndex];
            sessionStorage.setItem('upstart_ideas', JSON.stringify(data));
        }
        router.push('/evolve');
    };


    if (!ready) return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
            <div className="loading-spinner" />
        </div>
    );

    return (
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '60px 24px' }}>
            {/* Header */}
            <div className="animate-fade-in-up" style={{ textAlign: 'center', marginBottom: '48px' }}>
                <h1 style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-0.03em', marginBottom: '12px', color: 'var(--color-text-1)', textTransform: 'uppercase' }}>
                    <span className="highlight-blue">Choose Your Startup Idea</span>
                </h1>
                <p style={{ color: 'var(--color-text-1)', fontSize: '1.1rem', fontWeight: 800 }}>
                    Select one idea to get the full analysis, tech stack, and MVP roadmap.
                </p>
            </div>

            {/* Progress */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '40px' }}>
                {['Your Profile', 'Idea Generation', 'Evolve & Strategy', 'Analysis'].map((step, i) => (
                    <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                        <div className="progress-bar">
                            <div className="progress-fill" style={{ width: i <= 1 ? '100%' : '0%' }} />
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-1)', marginTop: '8px', fontWeight: 800, textTransform: 'uppercase', opacity: i <= 1 ? 1 : 0.5 }}>{step}</p>
                    </div>
                ))}
            </div>

            {/* Idea cards */}
            <div style={{ display: 'grid', gap: '16px', marginBottom: '32px' }}>
                {ideas.map((idea, i) => (
                    <div
                        key={i}
                        className={`idea-card ${selectedIndex === i ? 'selected' : ''}`}
                        onClick={() => setSelectedIndex(i)}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{
                                    width: '36px', height: '36px', borderRadius: 'var(--border-radius)',
                                    background: 'var(--color-secondary)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '1rem', fontWeight: 900, color: '#000000', flexShrink: 0,
                                    border: 'var(--border-width) solid var(--color-border)',
                                    boxShadow: '2px 2px 0px 0px var(--shadow-color)',
                                }}>{i + 1}</div>
                                <h3 style={{ fontWeight: 900, fontSize: '1.2rem', color: 'var(--color-text-1)', textTransform: 'uppercase' }}>{idea.title}</h3>
                            </div>
                            {selectedIndex === i && (
                                <span className="badge badge-purple" style={{ transform: 'rotate(2deg)' }}>✓ Selected</span>
                            )}
                        </div>
                        <p style={{ fontSize: '1rem', color: 'var(--color-text-1)', fontStyle: 'italic', marginBottom: '16px', fontWeight: 600, borderLeft: '4px solid var(--color-border)', paddingLeft: '12px' }}>"{idea.tagline}"</p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                            <div style={{ background: 'var(--color-bg)', padding: '12px', border: '2px solid var(--color-border)', borderRadius: 'var(--border-radius)' }}>
                                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-1)', fontWeight: 900, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Problem</p>
                                <p style={{ fontSize: '0.9rem', color: 'var(--color-text-1)', lineHeight: 1.5, fontWeight: 500 }}>{idea.problem}</p>
                            </div>
                            <div style={{ background: 'var(--color-bg)', padding: '12px', border: '2px solid var(--color-border)', borderRadius: 'var(--border-radius)' }}>
                                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-1)', fontWeight: 900, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Target Users</p>
                                <p style={{ fontSize: '0.9rem', color: 'var(--color-text-1)', lineHeight: 1.5, fontWeight: 500 }}>{idea.targetUsers}</p>
                            </div>
                            <div style={{ background: 'var(--color-bg)', padding: '12px', border: '2px solid var(--color-border)', borderRadius: 'var(--border-radius)' }}>
                                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-1)', fontWeight: 900, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Solution</p>
                                <p style={{ fontSize: '0.9rem', color: 'var(--color-text-1)', lineHeight: 1.5, fontWeight: 500 }}>{idea.solution}</p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {error && (
                <div style={{
                    background: 'var(--color-error)', border: 'var(--border-width) solid var(--color-border)',
                    borderRadius: 'var(--border-radius)', padding: '12px 16px', marginBottom: '20px', color: '#000000', fontSize: '0.95rem', fontWeight: 800,
                    boxShadow: '4px 4px 0px 0px var(--shadow-color)'
                }}>⚠ {error}</div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <button onClick={() => router.push('/generate')} className="btn-secondary">
                    ← Back
                </button>
                <button
                    onClick={handleProceed}
                    className="btn-primary"
                    disabled={selectedIndex === null}
                    style={{ minWidth: '220px', justifyContent: 'center' }}
                >
                    Evolve This Idea →
                </button>
            </div>
        </div>
    );
}
