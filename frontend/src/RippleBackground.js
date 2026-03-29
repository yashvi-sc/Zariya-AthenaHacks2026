import React from 'react';

/**
 * Full-viewport dark atmosphere: soft orbs, bottom ripples, subtle grid.
 * Keeps content in a relatively positioned stacking context.
 */
export default function RippleBackground({ children, className = '' }) {
  return (
    <div className={`relative min-h-screen overflow-hidden bg-[#030306] text-zinc-100 ${className}`}>
      {/* Ambient gradient wash */}
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            'radial-gradient(ellipse 80% 55% at 50% -15%, rgba(190, 24, 93, 0.14), transparent 55%), radial-gradient(ellipse 70% 50% at 100% 28%, rgba(225, 29, 72, 0.08), transparent 50%), radial-gradient(ellipse 60% 45% at 0% 55%, rgba(251, 113, 133, 0.06), transparent 45%), #030306',
        }}
      />

      {/* Soft horizontal streaks */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-40">
        <div className="absolute -left-1/4 top-[18%] h-px w-[150%] rotate-[-8deg] bg-gradient-to-r from-transparent via-white/25 to-transparent blur-sm animate-streak" />
        <div className="absolute -left-1/4 top-[42%] h-px w-[150%] rotate-[-5deg] bg-gradient-to-r from-transparent via-rose-400/15 to-transparent blur-sm animate-streak-slow" />
      </div>

      {/* Perspective floor grid */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] opacity-[0.14]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)
          `,
          backgroundSize: '56px 56px',
          transform: 'perspective(500px) rotateX(58deg) scale(1.15)',
          transformOrigin: '50% 100%',
          maskImage: 'linear-gradient(to top, black 0%, transparent 85%)',
        }}
      />

      {/* Concentric ripples — resonance at bottom center */}
      <div className="pointer-events-none absolute bottom-[-18%] left-1/2 flex h-[55vmin] w-[120vmin] -translate-x-1/2 items-end justify-center">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className="absolute rounded-full border border-white/[0.07] shadow-[0_0_40px_rgba(249,115,22,0.04)]"
            style={{
              width: `${28 + i * 14}%`,
              aspectRatio: '1',
              bottom: `${i * 3}%`,
              animation: `ripple-expand ${7 + i * 0.9}s ease-in-out ${i * 0.45}s infinite`,
              opacity: 0.35 - i * 0.04,
            }}
          />
        ))}
      </div>

      {/* Bokeh specks */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {[...Array(18)].map((_, i) => (
          <span
            key={i}
            className="absolute animate-float-drift rounded-full bg-white/30 blur-[1px]"
            style={{
              width: `${1 + (i % 3)}px`,
              height: `${1 + (i % 3)}px`,
              left: `${(i * 47) % 100}%`,
              top: `${(i * 61) % 100}%`,
              opacity: 0.15 + (i % 5) * 0.04,
              animationDelay: `${i * 0.35}s`,
              animationDuration: `${14 + (i % 7)}s`,
            }}
          />
        ))}
      </div>

      <div className="relative z-10">{children}</div>
    </div>
  );
}
