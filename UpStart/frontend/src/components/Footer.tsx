'use client';
import Link from 'next/link';

const navLinks = [
    { href: '/generate', label: 'Generate Idea' },
    { href: '/ideas', label: 'My Ideas' },
    { href: '/saved', label: 'Saved Ideas' },
];

const resources = [
    { href: '/generate', label: 'Start for Free' },
    { href: '/login', label: 'Sign In' },
    { href: '/signup', label: 'Create Account' },
];

export default function Footer() {
    return (
        <footer style={{
            borderTop: 'var(--border-width) solid var(--color-border)',
            background: 'var(--color-surface)',
            marginTop: 'auto',
            boxShadow: '0 -4px 0px 0px rgba(0,0,0,0.05)'
        }}>
            {/* Top bar */}
            <div style={{
                background: 'var(--color-primary)',
                borderBottom: 'var(--border-width) solid var(--color-border)',
                padding: '12px 24px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
            }}>
                <span style={{ width: '10px', height: '10px', background: 'var(--color-emerald)', borderRadius: '50%', border: '2px solid #000', boxShadow: '0 0 6px var(--color-emerald)', display: 'inline-block' }} />
                <span style={{ fontWeight: 900, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                    🚀 Upstart — AI-Powered Startup Incubator
                </span>
            </div>

            {/* Main footer content */}
            <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '40px 24px 32px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '40px' }}>

                {/* Brand column */}
                <div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.03em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ background: 'var(--color-primary)', padding: '2px 8px', border: '2px solid var(--color-border)', boxShadow: '3px 3px 0px 0px var(--shadow-color)' }}>UP</span>
                        <span>START</span>
                    </div>
                    <p style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--color-text-2)', lineHeight: 1.6, maxWidth: '220px' }}>
                        Turn vague interests into VC-grade startup blueprints. Powered by Groq LLaMA 3.3 70B.
                    </p>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
                        <span className="badge badge-emerald" style={{ fontSize: '0.72rem' }}>AI-Powered</span>
                        <span className="badge badge-blue" style={{ fontSize: '0.72rem' }}>VC-Grade</span>
                        <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>Free to Try</span>
                    </div>
                </div>

                {/* Navigation */}
                <div>
                    <h3 style={{ fontWeight: 900, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '16px', borderBottom: '2px solid var(--color-border)', paddingBottom: '8px' }}>Product</h3>
                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {navLinks.map((l) => (
                            <li key={l.href}>
                                <Link href={l.href} style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--color-text-1)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', transition: 'all 0.1s', padding: '4px 8px', marginLeft: '-8px', borderRadius: 'var(--border-radius)' }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-accent)'; e.currentTarget.style.transform = 'translate(4px, 0)'; e.currentTarget.style.boxShadow = '2px 2px 0px 0px var(--shadow-color)'; e.currentTarget.style.border = '2px solid var(--color-border)' }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.border = '2px solid transparent' }}>
                                    <span>→</span> {l.label}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Resources */}
                <div>
                    <h3 style={{ fontWeight: 900, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '16px', borderBottom: '2px solid var(--color-border)', paddingBottom: '8px' }}>Get Started</h3>
                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {resources.map((l) => (
                            <li key={l.href}>
                                <Link href={l.href} style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--color-text-1)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', transition: 'all 0.1s', padding: '4px 8px', marginLeft: '-8px', borderRadius: 'var(--border-radius)' }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-emerald)'; e.currentTarget.style.transform = 'translate(4px, 0)'; e.currentTarget.style.boxShadow = '2px 2px 0px 0px var(--shadow-color)'; e.currentTarget.style.border = '2px solid var(--color-border)' }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.border = '2px solid transparent' }}>
                                    <span>→</span> {l.label}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Built with */}
                <div>
                    <h3 style={{ fontWeight: 900, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '16px', borderBottom: '2px solid var(--color-border)', paddingBottom: '8px' }}>Built With</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {['⚡ Groq LLaMA 3.3 70B', '⚛️ Next.js 14', '🔐 JWT Auth', '🗄️ SQLite'].map((tech, i) => (
                            <div key={i} style={{ fontSize: '0.85rem', fontWeight: 700, padding: '6px 10px', background: 'var(--color-bg)', border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)', boxShadow: '2px 2px 0px 0px var(--shadow-color)' }}>
                                {tech}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Bottom bar */}
            <div style={{
                borderTop: 'var(--border-width) solid var(--color-border)',
                padding: '24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                maxWidth: '1100px',
                margin: '0 auto',
            }}>
                <p style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-2)' }}>
                    © {new Date().getFullYear()} Upstart. All rights reserved.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--color-text-2)', textTransform: 'uppercase' }}>Made with</span>
                    <span style={{ background: 'var(--color-rose)', border: '2px solid var(--color-border)', padding: '2px 8px', fontSize: '0.8rem', fontWeight: 900, boxShadow: '2px 2px 0px 0px var(--shadow-color)' }}>❤️ &amp; AI</span>
                </div>
            </div>
        </footer>
    );
}
