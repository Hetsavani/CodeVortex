import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function Hero(): JSX.Element {
  const [currentQuoteIndex, setCurrentQuoteIndex] = useState(0);
  const quotes = [
    'Your ultimate cloud IDE for seamless coding and collaboration',
    'Transform handwritten code into digital with our photo code feature',
    'Code securely with state-of-the-art security measures',
    'Compile and run code instantly with our built-in compiler',
    'Support for multiple programming languages at your fingertips',
    'Access your code anywhere with secure cloud storage',
  ];

  useEffect(() => {
    const interval = setInterval(() => setCurrentQuoteIndex((prev) => (prev + 1) % quotes.length), 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative h-[calc(100vh-64px)] flex items-center justify-center overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="absolute inset-0 z-0">
        <AnimatedBackground />
      </div>
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} className="text-center z-10 px-4 max-w-3xl">
        <h1 className="text-5xl md:text-7xl font-bold mb-6 text-white">
          Welcome to <span className="text-cyan-500">CodeVortex</span>
        </h1>
        <div className="h-20 mb-8">
          <AnimatePresence mode="wait">
            <motion.p key={currentQuoteIndex} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.5 }} className="text-xl md:text-2xl text-gray-300">
              {quotes[currentQuoteIndex]}
            </motion.p>
          </AnimatePresence>
        </div>
        <Link to="/login">
          <Button size="lg" className="rounded-full px-8 text-base">
            Get Started
          </Button>
        </Link>
      </motion.div>
    </section>
  );
}

const AnimatedBackground = (): JSX.Element => (
  <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#111827" />
        <stop offset="50%" stopColor="#1F2937" />
        <stop offset="100%" stopColor="#111827" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#grad)" />
    <motion.circle
      cx="10%"
      cy="30%"
      r="5"
      fill="#06B6D4"
      animate={{ cx: ['10%', '90%', '10%'], cy: ['30%', '70%', '30%'] }}
      transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
    />
    <motion.circle
      cx="90%"
      cy="70%"
      r="7"
      fill="#3B82F6"
      animate={{ cx: ['90%', '10%', '90%'], cy: ['70%', '30%', '70%'] }}
      transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
    />
  </svg>
);
