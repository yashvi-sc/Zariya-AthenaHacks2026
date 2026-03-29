import React, { useState } from 'react';
import { LogIn, UserPlus, Mail, Lock, User, AlertCircle, Loader2 } from 'lucide-react';
import { registerUser, loginUser, saveAuth } from './api';

export default function Auth({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'register') {
        const data = await registerUser({ email, password, name });
        saveAuth({ token: data.token, user: data.user });
        onAuthenticated({ token: data.token, user: data.user });
      } else {
        const data = await loginUser({ email, password });
        saveAuth({ token: data.token, user: data.user });
        onAuthenticated({ token: data.token, user: data.user });
      }
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex bg-gradient-to-r from-blue-500 to-green-600 p-4 rounded-2xl mb-4">
            {mode === 'login' ? (
              <LogIn size={40} className="text-white" />
            ) : (
              <UserPlus size={40} className="text-white" />
            )}
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">Zariya</h1>
          <p className="text-gray-400 text-sm">
            {mode === 'login' ? 'Sign in to continue' : 'Create an account'}
          </p>
        </div>

        <div className="bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20 p-6 sm:p-8 shadow-2xl">
          <div className="flex rounded-lg bg-black/30 p-1 mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`flex-1 py-2.5 rounded-md text-sm font-medium transition-all ${
                mode === 'login'
                  ? 'bg-gradient-to-r from-blue-500 to-green-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
              }}
              className={`flex-1 py-2.5 rounded-md text-sm font-medium transition-all ${
                mode === 'register'
                  ? 'bg-gradient-to-r from-blue-500 to-green-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Register
            </button>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/50 bg-red-900/30 px-3 py-2 text-sm text-red-200">
              <AlertCircle className="mt-0.5 flex-shrink-0" size={18} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-1.5">Name</label>
                <div className="relative">
                  <User
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                    size={18}
                  />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    placeholder="Your name"
                    className="w-full pl-10 pr-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-gray-300 text-sm font-medium mb-1.5">Email</label>
              <div className="relative">
                <Mail
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                  size={18}
                />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full pl-10 pr-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-gray-300 text-sm font-medium mb-1.5">Password</label>
              <div className="relative">
                <Lock
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                  size={18}
                />
                <input
                  type="password"
                  required
                  minLength={mode === 'register' ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
                  className="w-full pl-10 pr-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg font-medium text-white bg-gradient-to-r from-blue-500 to-green-600 hover:from-blue-600 hover:to-green-700 disabled:opacity-60 disabled:cursor-not-allowed shadow-lg transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  Please wait
                </>
              ) : mode === 'login' ? (
                <>
                  <LogIn size={20} />
                  Sign in
                </>
              ) : (
                <>
                  <UserPlus size={20} />
                  Create account
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-500 text-xs mt-6">
          Accounts are stored on the Zariya server for this demo. Use a strong password.
        </p>
      </div>
    </div>
  );
}
