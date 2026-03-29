import React, { useState } from 'react';
import { LogIn, UserPlus, Mail, Lock, User, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { registerUser, loginUser, saveAuth } from './api';
import RippleBackground from './RippleBackground';
import ZariyaLogo from './ZariyaLogo';

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
    <RippleBackground>
      <div className="flex min-h-screen flex-col">
        <header className="relative z-20 flex items-center justify-between px-6 py-5 sm:px-10">
          <div className="flex items-center gap-3">
            <ZariyaLogo size={36} />
            <span className="font-display text-lg font-semibold tracking-tight text-white">Zariya</span>
          </div>
          <a
            href="#auth-form"
            className="group hidden items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-white sm:inline-flex"
          >
            Get started
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </a>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16 pt-4 sm:px-8">
          <div id="auth-form" className="w-full max-w-[420px]">
            <div className="mb-6 flex flex-col items-center gap-2 text-center sm:mb-8">
              <div className="flex items-center justify-center gap-3">
                <ZariyaLogo size={52} />
                <span className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">Zariya</span>
              </div>
            </div>
            <div className="mb-8 text-center sm:mb-10">
              <h1 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Every word, 
                <br />
                <span className="bg-gradient-to-r from-zinc-100 via-white to-zinc-400 bg-clip-text text-transparent">
                more confident than before.
                </span>
              </h1>
              <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-zinc-400">
              Turn everyday practice into confident communication.
              </p>
            </div>

            <div className="rounded-2xl border border-white/[0.12] bg-white/[0.06] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-8">
              <div className="mb-6 flex rounded-xl bg-black/30 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError('');
                  }}
                  className={`relative flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors ${
                    mode === 'login' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {mode === 'login' && (
                    <span className="absolute inset-0 rounded-lg bg-white/10 shadow-inner" />
                  )}
                  <span className="relative">Log in</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError('');
                  }}
                  className={`relative flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors ${
                    mode === 'register' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {mode === 'register' && (
                    <span className="absolute inset-0 rounded-lg bg-white/10 shadow-inner" />
                  )}
                  <span className="relative">Register</span>
                </button>
              </div>

              {error && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/35 bg-red-950/40 px-3 py-2.5 text-sm text-red-200">
                  <AlertCircle className="mt-0.5 flex-shrink-0" size={18} />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'register' && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Name
                    </label>
                    <div className="relative">
                      <User
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
                        size={18}
                      />
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                        placeholder="Your name"
                        className="w-full rounded-xl border border-white/10 bg-black/25 py-3 pl-10 pr-4 text-white placeholder-zinc-600 outline-none ring-rose-500/0 transition-shadow focus:ring-2 focus:ring-rose-500/50"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Email
                  </label>
                  <div className="relative">
                    <Mail
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
                      size={18}
                    />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      placeholder="you@example.com"
                      className="w-full rounded-xl border border-white/10 bg-black/25 py-3 pl-10 pr-4 text-white placeholder-zinc-600 outline-none transition-shadow focus:ring-2 focus:ring-rose-500/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Password
                  </label>
                  <div className="relative">
                    <Lock
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
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
                      className="w-full rounded-xl border border-white/10 bg-black/25 py-3 pl-10 pr-4 text-white placeholder-zinc-600 outline-none transition-shadow focus:ring-2 focus:ring-rose-500/50"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="group relative mt-2 w-full overflow-hidden rounded-xl bg-gradient-to-r from-rose-600 to-red-600 py-3.5 font-semibold text-white shadow-lg shadow-rose-900/30 transition hover:from-rose-500 hover:to-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 opacity-0 transition group-hover:opacity-100" />
                  <span className="relative flex items-center justify-center gap-2">
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
                  </span>
                </button>
              </form>
            </div>

            <p className="mt-6 text-center text-xs text-zinc-600">
              Demo accounts live on the Zariya server — use a strong password.
            </p>
          </div>
        </div>
      </div>
    </RippleBackground>
  );
}
