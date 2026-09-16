import { motion } from 'framer-motion';
import { FiShield, FiTerminal, FiCloud, FiCode, FiZap, FiGlobe } from 'react-icons/fi';

const features = [
  { icon: <FiShield />, title: 'Enhanced Security', description: 'Docker-isolated execution, JWT auth, rate limits — your code never touches the host.' },
  { icon: <FiTerminal />, title: 'Virtual Terminal', description: 'Interactive xterm.js + PTY — run repls, npm dev, any shell.' },
  { icon: <FiCloud />, title: 'Remote Code Storage', description: 'Projects/files in MongoDB, autosaved, persisted across reloads.' },
  { icon: <FiCode />, title: 'Multi-Language Support', description: 'Python, JavaScript, Java, C/C++ via sandboxed runners.' },
  { icon: <FiZap />, title: 'Streaming Execution', description: 'Socket.IO live output — see results as they happen, kill anytime.' },
  { icon: <FiGlobe />, title: 'AI Assistant', description: 'Gemini streaming chat + image-to-code, context-aware on active file.' },
];

export default function Features(): JSX.Element {
  return (
    <section id="features" className="py-20 bg-gray-50 dark:bg-gray-800">
      <div className="container mx-auto px-4">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">Powerful Features</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((f, i) => (
            <FeatureCard key={i} feature={f} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

const FeatureCard = ({ feature, index }: { feature: (typeof features)[number]; index: number }): JSX.Element => (
  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: index * 0.08 }} className="bg-white dark:bg-gray-900 p-6 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
    <div className="text-3xl text-cyan-500 mb-4">{feature.icon}</div>
    <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
    <p className="text-sm text-muted-foreground">{feature.description}</p>
  </motion.div>
);
