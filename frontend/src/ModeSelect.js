import React, { useEffect, useRef } from 'react';
import { BookOpen, Sparkles, ClipboardCheck, TrendingUp, ArrowRight } from 'lucide-react';

/** Wake phrase → open Mode 2 (Unpanic me). Accepts Zariya / Zayira spelling. */
//const UNPANIC_WAKE_REGEX = /hey\s+(zayira|zariya)[,\s!]*\s*unpanic\s+me/i;
const UNPANIC_WAKE_REGEX = /unpanic\s+me/i;
const MODES = [
  {
    id: 1,
    title: 'Interview mode',
    subtitle: 'Voice AI interviewer: speak, get follow-ups, report & replay feedback.',
    icon: BookOpen,
    color: 'from-sky-500 to-blue-600',
    border: 'border-sky-500/40',
  },
  {
    id: 2,
    title: 'Unpanic me',
    subtitle: 'Voice agent: calm down with your ElevenLabs Zariya agent.',
    icon: Sparkles,
    color: 'from-violet-500 to-purple-600',
    border: 'border-violet-500/40',
  },
  {
    id: 3,
    title: 'Check-in',
    subtitle: 'Short assessments to track progress (coming soon).',
    icon: ClipboardCheck,
    color: 'from-emerald-500 to-teal-600',
    border: 'border-emerald-500/40',
  },
  {
    id: 4,
    title: 'Practise & improve',
    subtitle: 'Live camera session: calibrate templates, practise phrases, emotions & reports.',
    icon: TrendingUp,
    color: 'from-amber-500 to-orange-600',
    border: 'border-amber-500/40',
    featured: true,
  },
];

export default function ModeSelect({ onSelectMode }) {
  const wakeRef = useRef(null);
  const wakeMatchedRef = useRef(false);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-4 sm:p-8 flex flex-col">
      <div className="max-w-5xl mx-auto w-full flex-1 flex flex-col justify-center">
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">Choose a mode</h1>
          <p className="text-gray-400 text-lg">Select how you want to use Zariya today.</p>
          <p className="text-violet-300/80 text-sm mt-3 max-w-md mx-auto">
            Tip: say <span className="text-violet-200 font-medium">“Unpanic me”</span> to open Unpanic
            me hands-free (Chrome / Edge).
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
          {MODES.map((mode) => {
            const Icon = mode.icon;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => onSelectMode(mode.id)}
                className={`text-left rounded-2xl border bg-white/5 backdrop-blur-md p-6 transition-all hover:bg-white/10 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-amber-400/50 ${mode.border} ${
                  mode.featured ? 'ring-2 ring-amber-400/30 shadow-lg shadow-amber-500/10' : ''
                }`}
              >
                <div className={`inline-flex p-3 rounded-xl bg-gradient-to-br ${mode.color} mb-4`}>
                  <Icon className="text-white" size={28} />
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Mode {mode.id}
                    </p>
                    <h2 className="text-xl font-bold text-white mb-2">{mode.title}</h2>
                    <p className="text-gray-400 text-sm leading-relaxed">{mode.subtitle}</p>
                  </div>
                  <ArrowRight className="text-gray-500 flex-shrink-0 mt-1" size={20} />
                </div>
                {mode.featured && (
                  <p className="mt-4 text-xs text-amber-200/90 font-medium">Full live practice — same flow as before</p>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
