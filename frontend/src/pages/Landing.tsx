import Header from '@/components/landing/Header';
import Hero from '@/components/landing/Hero';
import Features from '@/components/landing/Features';

export default function Landing(): JSX.Element {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-white transition-colors">
      <Header />
        <main>
          <Hero />
          <Features />
        </main>
        <footer className="py-8 text-center text-sm text-muted-foreground border-t">© 2025 CodeVortex — Cloud IDE</footer>
      </div>
  );
}
