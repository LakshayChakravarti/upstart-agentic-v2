import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Upstart — AI Startup Idea Generator',
  description: 'Turn your vague interests into validated startup ideas in minutes. AI-powered market analysis, feasibility scoring, and MVP roadmaps.',
  keywords: 'startup ideas, AI, market analysis, feasibility, MVP roadmap, indie hacker',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body>
        <AuthProvider>
          <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh' }}>
            <Navbar />
            <main>{children}</main>
            <Footer />
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
