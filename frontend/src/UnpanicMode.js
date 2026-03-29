import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowLeft, Mic } from 'lucide-react';
import RippleBackground from './RippleBackground';
import ZariyaLogo from './ZariyaLogo';

const CONVAI_SCRIPT = 'https://unpkg.com/@elevenlabs/convai-widget-embed';
const DEFAULT_AGENT_ID =
  process.env.REACT_APP_ELEVENLABS_CONVAI_AGENT_ID || 'agent_1201kmw79a2xeazvr708cmqcd40j';

function loadConvaiScript() {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="convai-widget-embed"]');
    const done = () => resolve();
    if (existing) {
      if (window.customElements?.get?.('elevenlabs-convai')) {
        done();
        return;
      }
      existing.addEventListener('load', done, { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load ElevenLabs ConvAI script')), {
        once: true,
      });
      return;
    }
    const s = document.createElement('script');
    s.src = CONVAI_SCRIPT;
    s.async = true;
    s.type = 'text/javascript';
    s.onload = done;
    s.onerror = () => reject(new Error('Failed to load ElevenLabs ConvAI script'));
    document.body.appendChild(s);
  });
}

async function waitForConvaiElement() {
  if (typeof window === 'undefined' || !window.customElements?.whenDefined) return;
  try {
    await Promise.race([
      window.customElements.whenDefined('elevenlabs-convai'),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
  } catch {
    /* ignore */
  }
}

/**
 * Mode 2 — Unpanic me: ElevenLabs Conversational AI agent inside a phone-style frame.
 * Auto-starts the call as soon as the widget is ready.
 */
export default function UnpanicMode({ onBack }) {
  const [scriptReady, setScriptReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [callStarted, setCallStarted] = useState(false);
  const widgetMountRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadConvaiScript();
        await waitForConvaiElement();
        if (!cancelled) setScriptReady(true);
      } catch (e) {
        if (!cancelled) setLoadError(e.message || 'Could not load agent');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Attempts to find and click the start/call button inside the widget's shadow DOM.
  // Retries every 100ms for up to 2 seconds because the shadow DOM takes a moment to render.
  const autoStartCall = useCallback((host) => {
    const attempt = (tries = 0) => {
      if (tries > 40) return; // increase retries to 4s
  
      const widget = host.querySelector('elevenlabs-convai');
      const shadow = widget?.shadowRoot;
      if (!shadow) {
        setTimeout(() => attempt(tries + 1), 100);
        return;
      }
  
      // 1️⃣ Check for Terms & Conditions "Agree" button first
      const agreeBtn =
        shadow.querySelector('button[data-testid*="agree" i]') ||
        shadow.querySelector('button[data-testid*="accept" i]') ||
        [...(shadow.querySelectorAll('button') || [])]
          .find(b => /agree|accept|consent/i.test(b.textContent?.trim()));
  
      if (agreeBtn) {
        agreeBtn.click();
        // After agreeing, wait a moment then start the call
        setTimeout(() => startCall(shadow), 800);
        return;
      }
  
      // 2️⃣ No terms modal — try to start call directly
      startCall(shadow, tries);
    };
  
    const startCall = (shadow, tries = 0) => {
      const btn =
        shadow.querySelector('button[aria-label*="start" i]') ||
        shadow.querySelector('button[aria-label*="call" i]') ||
        shadow.querySelector('button[class*="start" i]') ||
        shadow.querySelector('button[class*="call" i]') ||
        shadow.querySelector('button');
  
      if (btn) {
        btn.click();
        setCallStarted(true);
      } else if (tries < 20) {
        setTimeout(() => startCall(shadow, tries + 1), 100);
      }
    };
  
    attempt();
  }, []);
  const mountWidget = useCallback(() => {
    const host = widgetMountRef.current;
    if (!host || !scriptReady) return;
    host.innerHTML = '';
    const el = document.createElement('elevenlabs-convai');
    el.setAttribute('agent-id', DEFAULT_AGENT_ID);
    host.appendChild(el);
    autoStartCall(host); // 👈 auto-click start after mount
  }, [scriptReady, autoStartCall]);

  useEffect(() => {
    mountWidget();
    const host = widgetMountRef.current;
    return () => {
      if (host) host.innerHTML = '';
    };
  }, [mountWidget]);

  return (
    <RippleBackground>
    <div className="flex min-h-screen flex-col items-center px-4 pb-12 pt-16">
      <div className="mb-8 flex w-full max-w-lg items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex shrink-0 items-center gap-2 text-sm text-zinc-400 hover:text-white"
        >
          <ArrowLeft size={18} />
          Modes
        </button>
        <div className="flex items-center gap-2">
          <ZariyaLogo size={30} />
          <span className="text-xs uppercase tracking-wider text-zinc-500">Unpanic me</span>
        </div>
      </div>

      <div className="flex w-full max-w-sm flex-1 flex-col items-center justify-center">
        <p className="mb-6 max-w-xs text-center text-sm text-zinc-500">
          {callStarted
            ? 'Zariya is listening. Speak whenever you\'re ready.'
            : 'Talk with your Zariya agent. Starting your session…'}
        </p>

        {/* Phone frame */}
        <div
          className="relative w-full max-w-[360px] overflow-hidden rounded-[2.5rem] border-4 border-white/10 bg-zinc-950 shadow-2xl shadow-black/50"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
        >
          {/* Notch */}
          <div className="flex h-7 items-end justify-center bg-black/60 pb-1">
            <div className="h-5 w-24 rounded-full bg-black/80" />
          </div>

          <div className="flex min-h-[520px] flex-col bg-gradient-to-b from-zinc-950 to-black px-4 pb-6 pt-4">
            <div className="mb-4 flex items-center justify-center gap-2 text-sm font-medium text-rose-200/90">
              <ZariyaLogo size={26} aria-hidden />
              <span>Zariya · Unpanic</span>
            </div>

            {/* Orb — always visible, pulses faster once call has started */}
            <div className="mb-6 flex justify-center">
              <div
                className={`relative flex h-28 w-28 items-center justify-center rounded-full shadow-[0_0_50px_rgba(244,63,94,0.35)] ${
                  callStarted ? 'animate-ping-slow' : 'animate-pulse'
                }`}
                style={{
                  background:
                    'radial-gradient(circle at 30% 30%, rgba(254,205,211,0.35), rgba(190,18,60,0.5), rgba(30,10,18,0.95))',
                  animationDuration: callStarted ? '1.2s' : '2s',
                }}
              >
                <div className="absolute inset-3 rounded-full border border-rose-300/35" />
                <Mic
                  className={`relative z-10 transition-colors duration-500 ${
                    callStarted ? 'text-white' : 'text-rose-100'
                  }`}
                  size={36}
                />
              </div>
            </div>

            {loadError && (
              <div className="rounded-lg border border-red-500/40 bg-red-950/50 px-3 py-2 text-xs text-red-200 mb-4">
                {loadError}
              </div>
            )}

            {!scriptReady && !loadError && (
              <p className="text-center text-slate-500 text-sm">Loading agent…</p>
            )}

            {/* ElevenLabs ConvAI widget mounts here */}
            <div
              ref={widgetMountRef}
              className="flex-1 flex flex-col items-center justify-end min-h-[220px] w-full convai-widget-host"
            />
          </div>
        </div>

        
      </div>
    </div>
    </RippleBackground>
  );
}