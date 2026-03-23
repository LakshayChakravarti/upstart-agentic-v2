'use client';
import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/lib/api';

export default function SignupPage() {
    const { login } = useAuth();
    const router = useRouter();
    const [form, setForm] = useState({ name: '', email: '', password: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (form.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
        setLoading(true);
        setError('');
        try {
            const { token, user } = await apiClient.register(form);
            login(token, user);
            router.push('/generate');
        } catch (err: any) {
            setError(err.message || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ minHeight: 'calc(100vh - 64px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
            <div style={{ width: '100%', maxWidth: '440px' }}>
                <div className="animate-fade-in-up" style={{ textAlign: 'center', marginBottom: '36px' }}>
                    <h1 style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-0.02em', marginBottom: '8px', color: 'var(--color-text-1)', textTransform: 'uppercase' }}>
                        <span className="highlight-pink">Start Building</span>
                    </h1>
                    <p style={{ color: 'var(--color-text-1)', fontSize: '1.1rem', fontWeight: 800 }}>Create your free account to generate and save startup ideas.</p>
                </div>

                <form onSubmit={handleSubmit} className="section-card animate-fade-in-up" style={{ padding: '32px' }}>
                    <div style={{ marginBottom: '20px' }}>
                        <label className="input-label" htmlFor="name">Full Name</label>
                        <input id="name" className="input-field" type="text" placeholder="Alex Johnson"
                            value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
                    </div>

                    <div style={{ marginBottom: '20px' }}>
                        <label className="input-label" htmlFor="email">Email</label>
                        <input id="email" className="input-field" type="email" placeholder="you@example.com"
                            value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
                    </div>

                    <div style={{ marginBottom: '24px' }}>
                        <label className="input-label" htmlFor="password">Password</label>
                        <input id="password" className="input-field" type="password" placeholder="At least 6 characters"
                            value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
                    </div>

                    {error && (
                        <div style={{ background: 'var(--color-error)', border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)', padding: '12px 16px', marginBottom: '20px', color: '#000000', fontSize: '0.95rem', fontWeight: 800, boxShadow: '4px 4px 0px 0px var(--shadow-color)' }}>
                            ⚠ {error}
                        </div>
                    )}

                    <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', justifyContent: 'center', padding: '13px' }}>
                        {loading ? <><div className="loading-spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }} /> Creating account...</> : '🚀 Create Free Account'}
                    </button>

                    <p style={{ textAlign: 'center', marginTop: '20px', color: 'var(--color-text-1)', fontSize: '0.95rem', fontWeight: 800 }}>
                        Already have an account?{' '}
                        <Link href="/login" style={{ color: 'var(--color-primary)', fontWeight: 900, textDecoration: 'underline' }}>Sign in →</Link>
                    </p>
                </form>
            </div>
        </div>
    );
}
