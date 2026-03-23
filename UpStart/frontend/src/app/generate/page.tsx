'use client';
import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/api';

const skillOptions = ['JavaScript', 'Python', 'React', 'Node.js', 'Machine Learning', 'Mobile Dev', 'UI/UX Design', 'Data Analysis', 'No-code tools'];

const BUDGET_OPTIONS = [
    { label: '₹0 – ₹1L', value: '₹0-1L', color: 'var(--color-emerald)' },
    { label: '₹1L – ₹10L', value: '₹1L-10L', color: 'var(--color-primary)' },
    { label: '₹10L – ₹50L', value: '₹10L-50L', color: 'var(--color-secondary)' },
    { label: '₹50L+', value: '₹50L+', color: 'var(--color-accent)' },
];

export default function GeneratePage() {
    const { user } = useAuth();
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [stickLoading, setStickLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
    const [customSkill, setCustomSkill] = useState('');
    const [customBudget, setCustomBudget] = useState('');
    const [form, setForm] = useState({
        domain: '',
        targetUsers: '',
        timeAvailable: '',
        budgetLevel: '₹1L-10L',
        experienceLevel: 'Beginner',
    });


    useEffect(() => {
        if (!user) {
            router.push('/login');
        }
    }, [user, router]);

    if (!user) {
        return null;
    }

    const toggleSkill = (skill: string) => {
        setSelectedSkills(prev =>
            prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
        );
    };

    const addCustomSkill = () => {
        const trimmed = customSkill.trim();
        if (trimmed && !selectedSkills.includes(trimmed)) {
            setSelectedSkills(prev => [...prev, trimmed]);
        }
        setCustomSkill('');
    };

    const removeSkill = (skill: string) => {
        setSelectedSkills(prev => prev.filter(s => s !== skill));
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!form.domain.trim()) { setError('Please enter a domain or interest.'); return; }
        setLoading(true);
        setError('');
        try {
            const budgetValue = form.budgetLevel === 'Custom' ? customBudget : form.budgetLevel;
            const result = await apiClient.generateIdeas({
                domain: form.domain,
                skills: selectedSkills.join(', '),
                timeAvailable: form.timeAvailable,
                budgetLevel: budgetValue,
                experienceLevel: form.experienceLevel,
                targetUsers: form.targetUsers,
            });
            // Store in sessionStorage for the ideas page (include budget for /evolve)
            sessionStorage.setItem('upstart_ideas', JSON.stringify({ ...result, budget: budgetValue }));
            router.push('/ideas');
        } catch (err: any) {
            setError(err.message || 'Failed to generate ideas. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Go directly with the user's own idea — skip AI idea generation
    const handleStickWithPlan = async () => {
        if (!form.domain.trim()) { setError('Please describe your idea first.'); return; }
        setStickLoading(true);
        setError('');
        try {
            const budgetValue = form.budgetLevel === 'Custom' ? customBudget : form.budgetLevel;
            // Create a user-defined idea from their input
            const userIdea = {
                title: form.domain,
                problem: `Solving a key challenge in the ${form.domain} space${form.targetUsers ? ` for ${form.targetUsers}` : ''}.`,
                solution: form.domain,
                targetUsers: form.targetUsers || 'To be refined',
                tagline: `A ${form.domain} venture — founder's original vision`,
            };

            // Still need an ideaSessionId for downstream DB operations
            const result = await apiClient.generateIdeas({
                domain: form.domain,
                skills: selectedSkills.join(', '),
                timeAvailable: form.timeAvailable,
                budgetLevel: budgetValue,
                experienceLevel: form.experienceLevel,
                targetUsers: form.targetUsers,
            });

            // Store the user's own idea as the selected one, skip /ideas
            sessionStorage.setItem('upstart_ideas', JSON.stringify({
                ...result,
                budget: budgetValue,
                selectedIdea: userIdea,
            }));
            router.push('/evolve');
        } catch (err: any) {
            setError(err.message || 'Something went wrong. Please try again.');
        } finally {
            setStickLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: '700px', margin: '0 auto', padding: '60px 24px' }}>
            {/* Header */}
            <div className="animate-fade-in-up" style={{ textAlign: 'center', marginBottom: '48px' }}>
                <h1 style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-0.03em', marginBottom: '12px', color: 'var(--color-text-1)', textTransform: 'uppercase' }}>
                    <span className="highlight">Tell Us About Your Idea</span>
                </h1>
                <p style={{ color: 'var(--color-text-1)', fontSize: '1.1rem', fontWeight: 800 }}>
                    The more context you give, the better the ideas and analysis.
                </p>
            </div>

            {/* Progress bar */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '40px' }}>
                {['Your Profile', 'Idea Generation', 'Evolve & Strategy', 'Analysis'].map((step, i) => (
                    <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                        <div className={`progress-bar`}>
                            <div className="progress-fill" style={{ width: i === 0 ? '100%' : '0%' }} />
                        </div>
                        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-1)', marginTop: '8px', fontWeight: 800, textTransform: 'uppercase', opacity: i === 0 ? 1 : 0.5 }}>{step}</p>
                    </div>
                ))}
            </div>

            <form onSubmit={handleSubmit} className="animate-fade-in-up">
                <div className="section-card">
                    {/* Domain */}
                    <div style={{ marginBottom: '24px' }}>
                        <label className="input-label">
                            Domain / Interest <span style={{ color: 'var(--color-error)' }}>*</span>
                        </label>
                        <input
                            id="domain"
                            className="input-field"
                            type="text"
                            placeholder="e.g. Sustainability, AI, Fintech, Health, Education..."
                            value={form.domain}
                            onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}
                            required
                        />
                        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-3)', marginTop: '6px' }}>
                            Be specific: "AI tools for teachers" works better than just "Education"
                        </p>
                    </div>

                    {/* Target Audience */}
                    <div style={{ marginBottom: '24px' }}>
                        <label className="input-label">Target Audience <span style={{ color: 'var(--color-text-3)', fontWeight: 600 }}>(Optional)</span></label>
                        <input
                            id="targetUsers"
                            className="input-field"
                            type="text"
                            placeholder="e.g. SMB restaurant owners, college students, freelance designers..."
                            value={form.targetUsers}
                            onChange={e => setForm(f => ({ ...f, targetUsers: e.target.value }))}
                        />
                        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-3)', marginTop: '6px' }}>
                            Who would use this product? The more specific, the better the analysis.
                        </p>
                    </div>

                    {/* Skills */}
                    <div style={{ marginBottom: '24px' }}>
                        <label className="input-label">Your Skills (select or add custom)</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                            {skillOptions.map(skill => (
                                <button
                                    key={skill}
                                    type="button"
                                    onClick={() => toggleSkill(skill)}
                                    style={{
                                        padding: '8px 16px',
                                        borderRadius: 'var(--border-radius)',
                                        border: 'var(--border-width) solid var(--color-border)',
                                        background: selectedSkills.includes(skill)
                                            ? 'var(--color-primary)'
                                            : 'var(--color-surface)',
                                        color: '#000000',
                                        fontSize: '0.85rem',
                                        cursor: 'pointer',
                                        transition: 'all 0.1s',
                                        fontWeight: 800,
                                        textTransform: 'uppercase',
                                        boxShadow: selectedSkills.includes(skill)
                                            ? '2px 2px 0px 0px var(--shadow-color)'
                                            : '4px 4px 0px 0px var(--shadow-color)',
                                        transform: selectedSkills.includes(skill) ? 'translate(2px, 2px)' : 'none',
                                    }}
                                >
                                    {selectedSkills.includes(skill) ? '✓ ' : ''}{skill}
                                </button>
                            ))}
                        </div>

                        {/* Manual skill input */}
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <input
                                className="input-field"
                                type="text"
                                placeholder="Type a custom skill and press Enter or Add"
                                value={customSkill}
                                onChange={e => setCustomSkill(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomSkill(); } }}
                                style={{ flex: 1 }}
                            />
                            <button
                                type="button"
                                onClick={addCustomSkill}
                                className="btn-secondary"
                                style={{ flexShrink: 0, padding: '10px 16px' }}
                            >
                                + Add
                            </button>
                        </div>

                        {/* Custom skills tags */}
                        {selectedSkills.filter(s => !skillOptions.includes(s)).length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
                                {selectedSkills.filter(s => !skillOptions.includes(s)).map(skill => (
                                    <span
                                        key={skill}
                                        style={{
                                            padding: '6px 12px',
                                            background: 'var(--color-secondary)',
                                            border: '2px solid var(--color-border)',
                                            borderRadius: 'var(--border-radius)',
                                            fontSize: '0.82rem',
                                            fontWeight: 800,
                                            textTransform: 'uppercase',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            boxShadow: '2px 2px 0px 0px var(--shadow-color)',
                                        }}
                                    >
                                        {skill}
                                        <span
                                            onClick={() => removeSkill(skill)}
                                            style={{ cursor: 'pointer', fontWeight: 900, fontSize: '1rem', lineHeight: 1 }}
                                        >×</span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Budget */}
                    <div style={{ marginBottom: '24px' }}>
                        <label className="input-label">💰 Budget Range</label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '8px' }}>
                            {BUDGET_OPTIONS.map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setForm(f => ({ ...f, budgetLevel: opt.value }))}
                                    style={{
                                        padding: '12px 8px',
                                        background: form.budgetLevel === opt.value ? opt.color : 'var(--color-bg)',
                                        border: 'var(--border-width) solid var(--color-border)',
                                        borderRadius: 'var(--border-radius)',
                                        fontWeight: 900,
                                        fontSize: '0.82rem',
                                        textTransform: 'uppercase',
                                        cursor: 'pointer',
                                        boxShadow: form.budgetLevel === opt.value ? '4px 4px 0px 0px var(--shadow-color)' : '2px 2px 0px 0px var(--shadow-color)',
                                        transition: 'all 0.1s ease',
                                    }}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        {/* Custom budget input */}
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <button
                                type="button"
                                onClick={() => setForm(f => ({ ...f, budgetLevel: 'Custom' }))}
                                style={{
                                    padding: '10px 16px',
                                    background: form.budgetLevel === 'Custom' ? 'var(--color-primary)' : 'var(--color-surface)',
                                    border: 'var(--border-width) solid var(--color-border)',
                                    borderRadius: 'var(--border-radius)',
                                    fontWeight: 800,
                                    fontSize: '0.82rem',
                                    textTransform: 'uppercase',
                                    cursor: 'pointer',
                                    boxShadow: '2px 2px 0px 0px var(--shadow-color)',
                                    flexShrink: 0,
                                }}
                            >
                                ✏️ Custom
                            </button>
                            {form.budgetLevel === 'Custom' && (
                                <input
                                    className="input-field"
                                    type="text"
                                    placeholder="e.g. ₹3,00,000 or ₹25L"
                                    value={customBudget}
                                    onChange={e => setCustomBudget(e.target.value)}
                                    style={{ flex: 1 }}
                                />
                            )}
                        </div>
                    </div>

                    {/* Time + Experience in row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                        <div>
                            <label className="input-label">Available Time</label>
                            <select
                                id="timeAvailable"
                                className="input-field"
                                value={form.timeAvailable}
                                onChange={e => setForm(f => ({ ...f, timeAvailable: e.target.value }))}
                            >
                                <option value="">Select timeframe</option>
                                <option value="2 weeks">2 Weeks</option>
                                <option value="1 month">1 Month</option>
                                <option value="2-3 months">2-3 Months</option>
                                <option value="6+ months">6+ Months</option>
                            </select>
                        </div>

                        <div>
                            <label className="input-label">Experience Level</label>
                            <select
                                id="experienceLevel"
                                className="input-field"
                                value={form.experienceLevel}
                                onChange={e => setForm(f => ({ ...f, experienceLevel: e.target.value }))}
                            >
                                <option value="Beginner">Beginner</option>
                                <option value="Intermediate">Intermediate</option>
                                <option value="Advanced">Advanced</option>
                            </select>
                        </div>
                    </div>

                    {error && (
                        <div style={{
                            background: 'var(--color-error)', border: 'var(--border-width) solid var(--color-border)',
                            borderRadius: 'var(--border-radius)', padding: '12px 16px', marginBottom: '20px',
                            color: '#000000', fontSize: '0.95rem', fontWeight: 800,
                            boxShadow: '4px 4px 0px 0px var(--shadow-color)'
                        }}>
                            ⚠ {error}
                        </div>
                    )}

                    <button type="submit" className="btn-primary" disabled={loading || stickLoading} style={{ width: '100%', justifyContent: 'center', padding: '14px' }}>
                        {loading ? (
                            <>
                                <div className="loading-spinner" style={{ width: '20px', height: '20px', borderWidth: '2px' }} />
                                Generating your ideas... (this takes ~10s)
                            </>
                        ) : (
                            <>🎲 Generate 3 AI Ideas</>
                        )}
                    </button>

                    <div style={{ textAlign: 'center', margin: '12px 0', fontWeight: 900, fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--color-text-3)' }}>— or —</div>

                    <button
                        type="button"
                        onClick={handleStickWithPlan}
                        className="btn-secondary"
                        disabled={loading || stickLoading}
                        style={{ width: '100%', justifyContent: 'center', padding: '14px' }}
                    >
                        {stickLoading ? (
                            <>
                                <div className="loading-spinner" style={{ width: '20px', height: '20px', borderWidth: '2px' }} />
                                Setting up your plan...
                            </>
                        ) : (
                            <>🚀 Go With My Plan — Skip AI Ideas</>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
}
