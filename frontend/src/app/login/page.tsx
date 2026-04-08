'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { motion } from 'framer-motion';
import { LogIn, Eye, EyeOff, AlertCircle, Shield } from 'lucide-react';
import Link from 'next/link';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, isAuthenticated, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');

  useEffect(() => {
    if (isAuthenticated && user) {
      const roleRoutes: Record<string, string> = {
        client: '/system/portal',
        workshop_manager: '/system/workshop/dashboard',
        workshop_employee: '/system/workshop',
        purchasing: '/system/workshop/purchases',
      };
      const defaultRoute = roleRoutes[user.role] || '/system/dashboard';
      router.push(returnTo || defaultRoute);
    }
  }, [isAuthenticated, user, router, returnTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Retry once on timeout (Render free tier cold start)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const loggedInUser = await login(email, password);
        const roleRoutes: Record<string, string> = {
          client: '/system/portal',
          workshop_manager: '/system/workshop/dashboard',
          workshop_employee: '/system/workshop',
          purchasing: '/system/workshop/purchases',
        };
        const defaultRoute = roleRoutes[loggedInUser.role] || '/system/dashboard';
        router.push(returnTo || defaultRoute);
        return;
      } catch (err: any) {
        const isTimeout = err.message?.includes('timed out') || err.message?.includes('aborted');
        if (isTimeout && attempt === 0) {
          setError('Server is waking up... retrying automatically');
          continue;
        }
        setError(err.message || 'Login failed');
      }
    }
    setLoading(false);
  };

  return (
    <section className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#f37121]/10 border border-[#f37121]/30 mb-4">
              <Shield className="w-8 h-8 text-[#f37121]" />
            </div>
            <h1 className="text-2xl font-bold text-white">Collections Portal</h1>
            <p className="text-gray-400 text-sm mt-2">
              Energize Logistics Financial Control System
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </motion.div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 focus:border-[#f37121]/50 transition-all"
                placeholder="your@email.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 focus:border-[#f37121]/50 transition-all pr-12"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white font-semibold transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  Sign In
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/10 text-center">
            <Link
              href="/"
              className="text-sm text-gray-400 hover:text-[#f37121] transition-colors"
            >
              Back to Website
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-gray-500 mt-4">
          Access is restricted to authorized personnel only.
        </p>
      </motion.div>
    </section>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
