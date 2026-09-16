import { motion } from 'framer-motion';
import { FiMenu, FiMoon, FiSun } from 'react-icons/fi';
import Logo from './Logo';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { useTheme } from '@/components/ThemeProvider';

const NavLink = ({ href, children }: { href: string; children: React.ReactNode }): JSX.Element => (
  <motion.a href={href} className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
    {children}
  </motion.a>
);

export default function Header(): JSX.Element {
  const { theme, toggle } = useTheme();
  const isDarkMode = theme === 'dark';
  return (
    <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="bg-white dark:bg-gray-800 py-4 px-6 flex justify-between items-center border-b border-gray-100 dark:border-gray-700 sticky top-0 z-50">
      <Logo />
      <nav className="hidden md:flex space-x-6">
        <NavLink href="#features">Features</NavLink>
        <NavLink href="#code-from-photo">Code from Photo</NavLink>
        <NavLink href="#testimonials">Testimonials</NavLink>
      </nav>
      <div className="flex items-center space-x-3">
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="toggle theme">
          {isDarkMode ? <FiSun /> : <FiMoon />}
        </Button>
        <Link to="/login">
          <Button size="sm">Open IDE</Button>
        </Link>
        <button className="md:hidden text-xl">
          <FiMenu />
        </button>
      </div>
    </motion.header>
  );
}
