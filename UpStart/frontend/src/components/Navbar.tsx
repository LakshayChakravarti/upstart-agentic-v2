'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Rocket, Sparkles, LogOut, BookOpen } from 'lucide-react';

export default function Navbar() {
    const { user, logout } = useAuth();
    const router = useRouter();

    const handleLogout = () => {
        logout();
        router.push('/');
    };

    // Define common style for nav links
    const navLinkStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        color: 'var(--color-text-1)',
        textDecoration: 'none',
        padding: '8px 12px',
        borderRadius: 'var(--border-radius)',
        fontSize: '0.9rem',
        fontWeight: 800,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.05em',
        transition: 'all 0.1s',
        border: 'var(--border-width) solid transparent',
    };

    return (
        <nav className="no-print" style={{
            position: 'sticky', top: 0, zIndex: 100,
            padding: '16px 0',
            backgroundColor: 'var(--color-surface)',
            borderBottom: 'var(--border-width) solid var(--color-border)',
            boxShadow: '0 4px 0px 0px var(--shadow-color)',
            marginBottom: '4px'
        }}>
            <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', maxWidth: '1100px', margin: '0 auto' }}>
                {/* Logo Block */}
                <Link href="/" className="hover-pop-card" style={{
                    display: 'inline-flex', alignItems: 'center', gap: '12px', textDecoration: 'none',
                    background: 'var(--color-surface)',
                    padding: '8px 16px',
                    border: 'var(--border-width) solid var(--color-border)',
                    boxShadow: '6px 6px 0px 0px var(--shadow-color)',
                }}>
                    <Rocket size={20} color="black" strokeWidth={2.5} style={{ fill: 'var(--color-primary)' }} />
                    <span style={{ fontWeight: 900, fontSize: '1.4rem', color: '#000000', letterSpacing: '-0.02em', textTransform: 'uppercase' }}>
                        Upstart
                    </span>
                </Link>

                {/* Nav links Blocks */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    {user ? (
                        <>
                            <Link href="/generate" className="hover-pop-card" style={{
                                display: 'inline-flex', alignItems: 'center', gap: '8px',
                                background: 'var(--color-emerald)', padding: '10px 16px', fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', color: '#000',
                                border: 'var(--border-width) solid var(--color-border)', boxShadow: '6px 6px 0px 0px var(--shadow-color)',
                                textDecoration: 'none'
                            }}>
                                <Sparkles size={16} strokeWidth={2.5} />
                                Generate
                            </Link>
                            <Link href="/saved" className="hover-pop-card" style={{
                                display: 'inline-flex', alignItems: 'center', gap: '8px',
                                background: 'var(--color-secondary)', padding: '10px 16px', fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', color: '#000',
                                border: 'var(--border-width) solid var(--color-border)', boxShadow: '6px 6px 0px 0px var(--shadow-color)',
                                textDecoration: 'none'
                            }}>
                                <BookOpen size={16} strokeWidth={2.5} />
                                Saved Ideas
                            </Link>

                            {/* User Profile / Logout Combo Block */}
                            <div className="hover-pop-card" style={{
                                display: 'flex', alignItems: 'center', gap: '0px', marginLeft: '12px',
                                background: 'var(--color-surface)',
                                border: 'var(--border-width) solid var(--color-border)', boxShadow: '6px 6px 0px 0px var(--shadow-color)'
                            }}>
                                <div style={{
                                    width: '40px', height: '40px',
                                    background: 'var(--color-accent)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '1.1rem', fontWeight: 900, color: '#000000',
                                }}>
                                    {user.name.charAt(0).toUpperCase()}
                                </div>
                                <span style={{ padding: '0 16px', fontSize: '0.9rem', color: '#000', fontWeight: 900, textTransform: 'uppercase', borderLeft: 'var(--border-width) solid var(--color-border)' }}>
                                    {user.name.split(' ')[0]}
                                </span>
                                <button onClick={handleLogout} style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: '40px', height: '40px',
                                    background: 'var(--color-error)', borderLeft: 'var(--border-width) solid var(--color-border)', cursor: 'pointer',
                                    border: 'none', borderLeftWidth: 'var(--border-width)', borderLeftStyle: 'solid', borderLeftColor: 'var(--color-border)' // Fix border override issue
                                }}>
                                    <LogOut size={16} strokeWidth={2.5} color="black" />
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <Link href="/login" className="hover-pop-card" style={{
                                background: 'var(--color-surface)', padding: '10px 24px', fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', color: '#000',
                                border: 'var(--border-width) solid var(--color-border)', boxShadow: '6px 6px 0px 0px var(--shadow-color)',
                                textDecoration: 'none'
                            }}>
                                Login
                            </Link>
                            <Link href="/signup" className="hover-pop-card" style={{
                                display: 'inline-flex', alignItems: 'center', gap: '8px',
                                background: 'var(--color-primary)', padding: '10px 24px', fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', color: '#000',
                                border: 'var(--border-width) solid var(--color-border)', boxShadow: '6px 6px 0px 0px var(--shadow-color)',
                                textDecoration: 'none'
                            }}>
                                <Rocket size={16} strokeWidth={2.5} color="black" />
                                Start Free
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </nav>
    );
}
