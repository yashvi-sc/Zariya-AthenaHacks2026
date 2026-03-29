import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Sparkles, TrendingUp, ArrowRight } from 'lucide-react';
import RippleBackground from './RippleBackground';
import ZariyaLogo from './ZariyaLogo';

const UNPANIC_WAKE_REGEX = /unpanic\s+me/i;

/** Warm accents — same family as login (rose / amber), not blue/purple */
const MODES = [
  {
    id: 1,
    title: 'Interview',
    subtitle: 'AI interviewer & feedback',
    icon: BookOpen,
    core: 'from-rose-400 to-rose-700',
    glow: 'shadow-rose-500/20',
    border: 'border-rose-500/20',
  },
  {
    id: 2,
    title: 'Unpanic',
    subtitle: 'Calm voice agent',
    icon: Sparkles,
    core: 'from-amber-400 to-rose-700',
    glow: 'shadow-amber-500/20',
    border: 'border-amber-500/20',
  },
  {
    id: 3,
    title: 'Practise',
    subtitle: 'Live camera & reports',
    icon: TrendingUp,
    core: 'from-rose-500 to-red-700',
    glow: 'shadow-rose-600/35',
    border: 'border-rose-400/35',
    featured: true,
  },
];

/**
 * Triangle in depth: Interview back, Unpanic / Practise forward (Practise nearest).
 */
const NODE_POS = {
  1: { x: 50, y: 18, z: 28 },
  2: { x: 20, y: 74, z: 68 },
  3: { x: 80, y: 74, z: 108 },
};

export default function ModeSelect({ onSelectMode }) {
  const wakeRef = useRef(null);
  const wakeMatchedRef = useRef(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [compactScene, setCompactScene] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => setCompactScene(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const Rec = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!Rec) return undefined;

    wakeMatchedRef.current = false;
    const r = new Rec();
    wakeRef.current = r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onresult = (ev) => {
      let text = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript;
      }
      if (UNPANIC_WAKE_REGEX.test(text.trim())) {
        wakeMatchedRef.current = true;
        try {
          r.stop();
        } catch {
          /* ignore */
        }
        onSelectMode(2);
      }
    };
    r.onerror = () => {};
    r.onend = () => {
      if (wakeMatchedRef.current || wakeRef.current !== r) return;
      try {
        r.start();
      } catch {
        /* ignore */
      }
    };
    try {
      r.start();
    } catch {
      return undefined;
    }
    return () => {
      wakeRef.current = null;
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    };
  }, [onSelectMode]);

  useEffect(() => {
    const onMove = (e) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      setTilt({
        x: ((e.clientY - cy) / cy) * -9,
        y: ((e.clientX - cx) / cx) * 9,
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  const baseRx = 22;
  const baseRy = -15;

  return (
    <RippleBackground>
      <div className="flex min-h-screen flex-col px-4 pb-16 pt-6 sm:px-8">
        <header className="mx-auto mb-6 flex w-full max-w-5xl items-end justify-between gap-4 sm:mb-8">
          <div className="flex items-start gap-4">
            <ZariyaLogo size={48} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Zariya
              </p>
              <h1 className="font-display mt-1 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Choose a mode
              </h1>
              <p className="mt-2 max-w-md text-sm text-zinc-500">
                Three nodes in depth — back to front. Move the mouse to orbit the space.
              </p>
            </div>
          </div>
          <p className="hidden max-w-xs text-right text-xs leading-relaxed text-zinc-500 sm:block">
            Say <span className="font-medium text-rose-300">“Unpanic me”</span> in Chrome to open Unpanic
            hands-free.
          </p>
        </header>

        <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center">
          <div
            className="relative h-[min(72vh,640px)] w-full max-w-4xl [perspective-origin:50%_42%] sm:h-[min(68vh,560px)]"
            style={{ perspective: compactScene ? '880px' : '1100px' }}
          >
            <div
              className="absolute inset-0 transition-transform duration-200 ease-out [transform-style:preserve-3d]"
              style={{
                transform: `${compactScene ? 'scale(0.78) ' : ''}rotateX(${baseRx + tilt.x}deg) rotateY(${baseRy + tilt.y}deg) translateZ(-12px)`,
              }}
            >
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-white/20"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden
              >
                <defs>
                  <linearGradient id="modeLine" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="rgba(251,113,133,0.45)" />
                    <stop offset="100%" stopColor="rgba(255,255,255,0.06)" />
                  </linearGradient>
                </defs>
                {[
                  [1, 2],
                  [1, 3],
                  [2, 3],
                ].map(([a, b], i) => (
                  <line
                    key={`${a}-${b}-${i}`}
                    x1={NODE_POS[a].x}
                    y1={NODE_POS[a].y}
                    x2={NODE_POS[b].x}
                    y2={NODE_POS[b].y}
                    stroke="url(#modeLine)"
                    strokeWidth="0.38"
                    strokeDasharray="1.4 2"
                    opacity={0.4 + (i % 3) * 0.06}
                  />
                ))}
              </svg>

              {MODES.map((mode, index) => {
                const Icon = mode.icon;
                const pos = NODE_POS[mode.id];
                const z = pos.z;
                const scale = mode.featured ? 1.08 : 0.96 + index * 0.01;

                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => onSelectMode(mode.id)}
                    className={`group absolute z-10 w-[46%] max-w-[210px] rounded-2xl border bg-white/[0.04] text-left shadow-2xl backdrop-blur-xl transition-all duration-300 [transform-style:preserve-3d] hover:z-30 hover:scale-[1.05] hover:border-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60 sm:max-w-[230px] sm:w-[40%] ${mode.border} ${mode.glow}`}
                    style={{
                      left: `${pos.x}%`,
                      top: `${pos.y}%`,
                      transform: `translate(-50%, -50%) translateZ(${z}px) scale(${scale})`,
                    }}
                  >
                    <div
                      className={`pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-br opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-90 ${mode.core}`}
                    />
                    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/25 p-4 sm:p-5">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          {mode.featured ? 'Nearest' : `0${mode.id}`}
                        </span>
                        <Icon className="text-white/90" size={22} strokeWidth={1.75} />
                      </div>
                      <div
                        className={`mx-auto mb-3 h-14 w-14 rounded-xl bg-gradient-to-br ${mode.core} opacity-95 shadow-lg ${mode.glow}`}
                      />
                      <h2 className="font-display text-lg font-bold text-white sm:text-xl">{mode.title}</h2>
                      <p className="mt-1 text-xs leading-snug text-zinc-500">{mode.subtitle}</p>
                      {mode.featured && (
                        <p className="mt-3 text-[10px] font-medium uppercase tracking-wide text-rose-200/90">
                          Full session
                        </p>
                      )}
                      <div className="mt-4 flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors group-hover:text-white">
                        Enter
                        <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-zinc-600 sm:hidden">
            Say <span className="text-rose-400">“Unpanic me”</span> to open Unpanic (Chrome).
          </p>
        </div>
      </div>
    </RippleBackground>
  );
}
