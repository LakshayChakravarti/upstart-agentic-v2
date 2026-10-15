'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

const features = [
  { icon: '💡', title: 'AI Idea Generation', desc: 'Get 3 tailored startup ideas or go with your own plan — based on domain, skills, and budget.' },
  { icon: '🚀', title: 'Evolve & Refine', desc: 'AI expands your idea into a structured concept. Add comments to iteratively refine until it\'s perfect.' },
  { icon: '🎯', title: 'Strategic Directions', desc: 'Choose from 3 distinct strategies: lean bootstrap, AI-powered platform, or community-first growth.' },
  { icon: '⚡', title: 'Dynamic Feasibility Score', desc: '5 weighted sub-scores — Technical, Market, Regulatory, Competitive, Execution — with AI rationale.' },
  { icon: '🏆', title: 'Competitor Intelligence', desc: 'Real competitor analysis with pricing, moats, and exploitable weaknesses mapped.' },
  { icon: '💰', title: 'VC-Grade Blueprint', desc: '12-week roadmap, BMC canvas, monetization models, and investor dossier — export as PDF.' },
];

const steps = [
  { num: '01', title: 'Describe Your Vision', desc: 'Enter your domain, skills, budget, and experience. Use our custom grid selector or type your exact budget.' },
  { num: '02', title: 'Generate or Go Direct', desc: 'Get 3 AI-generated ideas, or skip and go with your own plan straight to the evolve phase.' },
  { num: '03', title: 'Evolve & Iterate', desc: 'AI expands your idea. Add feedback and corrections — the AI refines until you\'re satisfied.' },
  { num: '04', title: 'Choose Your Strategy', desc: 'Pick a strategic direction, or skip directly to analysis with your refined plan.' },
  { num: '05', title: 'Dynamic Scoring', desc: '5-pillar feasibility score computed from Technical, Market, Regulatory, Competitive & Execution factors.' },
  { num: '06', title: 'Export & Build', desc: 'Save your VC-grade blueprint, export to PDF, and start building with confidence.' },
];

const stats = [
  { value: '3', label: 'Strategic Growth Paths' },
  { value: '12', label: 'Week Execution Roadmap' },
  { value: '5', label: 'Pillar Feasibility Score' },
  { value: '∞', label: 'Iterative AI Refinements' },
];

export default function LandingPage() {
  const { user } = useAuth();
  const router = useRouter();

  return (
    <div style={{ minHeight: 'calc(100vh - 64px)' }}>

      {/* ── HERO ─────────────────────────────────────── */}
      <section style={{ padding: '20px 24px 60px', maxWidth: '1100px', margin: '0 auto' }}>
        <div className="animate-fade-in-up" style={{ display: 'flex', alignItems: 'center', gap: '72px', flexWrap: 'wrap' }}>

          {/* Left: Text */}
          <div style={{ flex: '1 1 420px', textAlign: 'left' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              background: 'var(--color-primary)', border: 'var(--border-width) solid var(--color-border)',
              padding: '8px 14px', marginBottom: '0px',
              fontSize: '0.85rem', color: '#000', fontWeight: 900, textTransform: 'uppercase',
              boxShadow: '4px 4px 0px 0px var(--shadow-color)', borderRadius: 'var(--border-radius)',
              letterSpacing: '0.05em',
            }}>
              <span style={{ width: '8px', height: '8px', background: 'var(--color-emerald)', display: 'inline-block', border: '2px solid #000', borderRadius: '50%', boxShadow: '0 0 6px var(--color-emerald)' }} />
              🚀 AI-Powered Startup Incubator
            </div>

            <h1 style={{
              fontSize: 'clamp(1.8rem, 4vw, 3.2rem)',
              fontWeight: 900, lineHeight: 1.1, letterSpacing: '-0.03em',
              marginTop: '12px', marginBottom: '20px', color: 'var(--color-text-1)', textTransform: 'uppercase',
            }}>
              From Vague Interest to<br />
              <span className="highlight brutalist-text-shadow" style={{ marginTop: '8px', display: 'inline-block' }}>Validated Startup</span>
            </h1>

            <p className="hover-pop-card" style={{ fontSize: '1rem', color: 'var(--color-text-2)', fontWeight: 600, lineHeight: 1.7, marginBottom: '28px', border: 'var(--border-width) solid var(--color-border)', padding: '14px 16px', background: 'var(--color-surface)', boxShadow: '4px 4px 0px 0px var(--shadow-color)', borderRadius: 'var(--border-radius)' }}>
              Stop guessing. Get AI-generated startup ideas with iterative refinement,
              5-pillar feasibility scoring, strategic directions, and a 12-week MVP roadmap — in minutes.
            </p>

            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
              <Link href={user ? '/generate' : '/signup'} className="btn-primary" style={{
                fontSize: '1.1rem', padding: '16px 36px',
                background: 'var(--color-secondary)',
                boxShadow: '6px 6px 0px 0px var(--shadow-color)',
                letterSpacing: '0.02em', fontWeight: 900,
              }}>
                🚀 Start Building Your Idea
              </Link>
              {!user && (
                <Link href="/login" className="btn-secondary" style={{ fontSize: '0.95rem', padding: '14px 24px' }}>Sign In</Link>
              )}
            </div>
            <p style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--color-text-1)', fontWeight: 800, textTransform: 'uppercase' }}>
              Free to try • No credit card required
            </p>
          </div>

          {/* Right: Hero Image */}
          <div className="animate-fade-in" style={{ flex: '1 1 340px', maxWidth: '460px', marginLeft: 'auto', animationDelay: '0.2s' }}>
            <div style={{ border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)', overflow: 'hidden', boxShadow: '8px 8px 0px 0px var(--shadow-color)' }}>
              <Image src="/hero.png" alt="AI Startup Incubator Illustration" width={460} height={259} style={{ width: '100%', height: 'auto', display: 'block' }} priority />
            </div>
          </div>

        </div>
      </section>

      {/* ── SCROLLING MARQUEE ──────────────────────── */}
      <div className="marquee-wrapper" style={{ marginBottom: '80px', borderTop: 'var(--border-width) solid var(--color-border)', borderBottom: 'var(--border-width) solid var(--color-border)', boxShadow: '0 8px 0 rgba(0,0,0,1)' }}>
        <div className="marquee-content" style={{ textShadow: '2px 2px 0px #FFF' }}>
          <span>
            VALIDATE IDEAS FAST • AI-POWERED INCUBATOR • NO CODE MVP ROADMAP • DYNAMIC FEASIBILITY SCORES • REAL COMPETITOR ANALYSIS • VC-GRADE BLUEPRINTS •&nbsp;
            VALIDATE IDEAS FAST • AI-POWERED INCUBATOR • NO CODE MVP ROADMAP • DYNAMIC FEASIBILITY SCORES • REAL COMPETITOR ANALYSIS • VC-GRADE BLUEPRINTS •&nbsp;
          </span>
          <span>
            VALIDATE IDEAS FAST • AI-POWERED INCUBATOR • NO CODE MVP ROADMAP • DYNAMIC FEASIBILITY SCORES • REAL COMPETITOR ANALYSIS • VC-GRADE BLUEPRINTS •&nbsp;
            VALIDATE IDEAS FAST • AI-POWERED INCUBATOR • NO CODE MVP ROADMAP • DYNAMIC FEASIBILITY SCORES • REAL COMPETITOR ANALYSIS • VC-GRADE BLUEPRINTS •&nbsp;
          </span>
        </div>
      </div>

      {/* ── STATS STRIP ─────────────────────────────── */}
      <section style={{ padding: '0 24px 60px', maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          {stats.map((s, i) => {
            const colors = ['var(--color-primary)', 'var(--color-emerald)', 'var(--color-secondary)', 'var(--color-accent)'];
            const rotate = i % 2 === 0 ? '-1deg' : '1deg';
            return (
              <div key={i} className="section-card hover-pop-card" style={{ textAlign: 'center', padding: '24px 16px', background: colors[i], transform: `rotate(${rotate})` }}>
                <div style={{ fontSize: '2.8rem', fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '8px', lineHeight: 1.3 }}>{s.label}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────── */}
      <section style={{ padding: '0 24px 60px', maxWidth: '1100px', margin: '0 auto' }}>

        {/* Centered heading */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-0.02em', marginBottom: '12px', color: 'var(--color-text-1)', textTransform: 'uppercase' }}>
            <span className="highlight-blue">How It Works</span>
          </h2>
          <p style={{ color: 'var(--color-text-1)', fontSize: '1.1rem', fontWeight: 800 }}>Six steps from idea to execution plan</p>
        </div>

        {/* Side-by-side: image left, 2×3 step grid right */}
        <div style={{ display: 'flex', gap: '32px', alignItems: 'stretch', flexWrap: 'wrap' }}>

          {/* Left: 6-step illustration */}
          <div className="hover-pop-card" style={{ flex: '1 1 400px', border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)', overflow: 'hidden', boxShadow: '8px 8px 0px 0px var(--shadow-color)', display: 'flex', background: 'var(--color-surface)' }}>
            <Image src="/how-it-works-v2.png" alt="How Upstart Works — 6 Steps" width={460} height={460} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          </div>

          {/* Right: 2 columns × 3 rows */}
          <div style={{ flex: '1 1 500px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            {steps.map((step, i) => {
              const colors = ['var(--color-primary)', 'var(--color-accent)', 'var(--color-emerald)', 'var(--color-rose)', 'var(--color-secondary)', 'var(--color-accent)'];
              return (
                <div key={i} className="section-card hover-pop-card" style={{ padding: '20px', background: colors[i] }}>
                  <div style={{ fontSize: '2rem', fontWeight: 900, color: '#000000', letterSpacing: '-0.05em', marginBottom: '8px', lineHeight: 1, textShadow: '2px 2px 0px #FFFFFF' }}>{step.num}</div>
                  <h3 style={{ fontWeight: 900, fontSize: '0.95rem', marginBottom: '4px', color: 'var(--color-text-1)', textTransform: 'uppercase' }}>{step.title}</h3>
                  <p style={{ color: 'var(--color-text-1)', fontSize: '0.82rem', lineHeight: 1.5, fontWeight: 600 }}>{step.desc}</p>
                </div>
              );
            })}
          </div>

        </div>
      </section>


      {/* ── FEATURES ─────────────────────────────────── */}
      <section style={{ padding: '0 24px 60px', maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-0.02em', marginBottom: '12px', color: 'var(--color-text-1)', textTransform: 'uppercase' }}>
            <span className="highlight-pink">Evolve & Validate</span>
          </h2>
          <p style={{ color: 'var(--color-text-1)', fontSize: '1.1rem', fontWeight: 800 }}>Powered by Groq LLaMA 3.3 70B</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
          {features.map((f, i) => {
            const iconBgs = ['var(--color-primary)', 'var(--color-emerald)', 'var(--color-secondary)', 'var(--color-accent)', 'var(--color-rose)', 'var(--color-primary)'];
            return (
              <div key={i} className="section-card hover-pop-card" style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                <div style={{
                  width: '54px', height: '54px', flexShrink: 0,
                  background: iconBgs[i], border: 'var(--border-width) solid var(--color-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem',
                  boxShadow: '4px 4px 0px 0px var(--shadow-color)', borderRadius: 'var(--border-radius)',
                  transform: 'rotate(-2deg)'
                }}>{f.icon}</div>
                <div>
                  <h3 style={{ fontWeight: 900, fontSize: '1.05rem', marginBottom: '6px', color: 'var(--color-text-1)', textTransform: 'uppercase' }}>{f.title}</h3>
                  <p style={{ color: 'var(--color-text-1)', fontSize: '0.90rem', lineHeight: 1.6, fontWeight: 600 }}>{f.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── CTA + VC BLUEPRINT ───────────────────────── */}
      <section style={{ padding: '0 24px 100px', maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: '48px', alignItems: 'center', flexWrap: 'wrap' }}>

          {/* Left: CTA text */}
          <div className="section-card hover-pop-card" style={{ flex: '1 1 340px', padding: '48px 40px', background: 'var(--color-secondary)', textAlign: 'left', border: 'var(--border-width) solid var(--color-border)', boxShadow: '8px 8px 0px 0px var(--shadow-color)' }}>
            <h2 style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-0.02em', marginBottom: '16px', color: 'var(--color-surface)', textTransform: 'uppercase', textShadow: '4px 4px 0px #000000', WebkitTextStroke: '2px black' }}>
              Ready to evolve your next big idea?
            </h2>
            <p style={{ color: 'var(--color-surface)', marginBottom: '32px', fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.6, textShadow: '1px 1px 0px #000' }}>
              Join builders who use Upstart's iterative AI feedback loop to plan smarter and execute with confidence.
            </p>
            <Link href={user ? '/generate' : '/signup'} className="btn-primary" style={{ fontSize: '1.1rem', padding: '16px 40px', background: 'var(--color-primary)', display: 'inline-block', color: 'var(--color-text-1)', boxShadow: '4px 4px 0px 0px #000' }}>
              🚀 Start for Free
            </Link>
            <p style={{ marginTop: '16px', fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-text-1)' }}>Free to try • No credit card required</p>
          </div>

          {/* Right: VC Blueprint image */}
          <div style={{ flex: '1 1 400px', border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--border-radius)', overflow: 'hidden', boxShadow: '8px 8px 0px 0px var(--shadow-color)', position: 'relative' }}>
            <Image src="/vc-blueprint.png" alt="VC Blueprint — Investor-Ready Analysis" width={560} height={315} style={{ width: '100%', height: 'auto', display: 'block' }} />
            <div style={{
              position: 'absolute', bottom: '16px', left: '16px',
              background: 'var(--color-primary)', border: '2px solid var(--color-border)',
              padding: '8px 16px', fontWeight: 900, fontSize: '0.85rem',
              textTransform: 'uppercase', boxShadow: '3px 3px 0px 0px var(--shadow-color)',
              borderRadius: 'var(--border-radius)'
            }}>
              🎯 VC-Grade Blueprint — Generated by AI
            </div>
          </div>

        </div>
      </section>
    </div>
  );
}
