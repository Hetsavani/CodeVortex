import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { useNavigate, Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { setCredentials } from '@/store/authSlice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const MovingBackground = (): JSX.Element => (
  <div className="absolute inset-0 overflow-hidden">
    <div className="absolute inset-0 bg-gray-900" />
    {[...Array(30)].map((_, i) => (
      <motion.div
        key={i}
        className="absolute text-white/10 text-sm font-mono"
        initial={{ top: `${Math.random() * 100}%`, left: `${Math.random() * 100}%` }}
        animate={{ top: [`${Math.random() * 100}%`, `${Math.random() * 100}%`], left: [`${Math.random() * 100}%`, `${Math.random() * 100}%`] }}
        transition={{ duration: 20 + Math.random() * 10, repeat: Infinity, ease: 'linear' }}
      >
        {Math.random() > 0.5 ? '{' : '}'}
      </motion.div>
    ))}
  </div>
);

export default function Login(): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const nav = useNavigate();
  const dispatch = useDispatch();

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      const path = isSignUp ? '/api/auth/register' : '/api/auth/login';
      const body = isSignUp ? { email, password, username: username || email.split('@')[0] } : { email, password };
      const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.accessToken) {
        dispatch(setCredentials({ accessToken: data.accessToken, user: data.user }));
        nav('/ide');
      } else setError(data.error || data.message || 'Auth failed');
    } catch {
      setError('Network error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4 relative overflow-hidden">
      <MovingBackground />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md relative z-10">
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-center text-2xl text-white">Sign in to <span className="text-cyan-500">CodeVortex</span></CardTitle>
            <p className="text-center text-sm text-gray-400">
              <Link to="/" className="hover:text-white">
                ← Back to home
              </Link>
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <Input placeholder="Email address" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400" />
              {isSignUp && <Input placeholder="Username" required value={username} onChange={(e) => setUsername(e.target.value)} className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400" />}
              <div className="relative">
                <Input placeholder="Password" type={showPassword ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)} className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400 pr-10" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-2.5 text-gray-400">
                  {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                </button>
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Please wait...' : isSignUp ? 'Create account' : 'Login'}
              </Button>
              <Button type="button" variant="outline" className="w-full bg-transparent border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white" onClick={() => setIsSignUp(!isSignUp)}>
                {isSignUp ? 'Already have an account? Login' : "Don't have an account? Sign up"}
              </Button>
            </form>
            <AnimatePresence>
              {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 text-center text-sm text-red-400">{error}</motion.p>}
            </AnimatePresence>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
