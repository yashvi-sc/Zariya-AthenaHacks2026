import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Mic,
  Square,
  Loader2,
  FileText,
  Download,
  RotateCcw,
  Volume2,
  MessageCircle,
  Timer,
  CheckCircle2,
  Camera,
  CameraOff,
  Video,
} from 'lucide-react';
import { API_BASE } from './api';

/** Place `interviewer.mp4` in `frontend/public/` for the virtual interviewer tile. */
const INTERVIEWER_VIDEO_SRC = `${process.env.PUBLIC_URL || ''}/interviewer.mp4`;

const OPENING_LINE = 'Tell me a little bit about yourself.';
const WAKE_REGEX = /(hey|hi|hello)[,\s]+let'?s\s+start(\s+my)?\s+interview/i;
const THINK_SECONDS = 15;
const ANSWER_SECONDS = 60;
/** Match backend filler list for counts */
const FILLER_RE = /\b(um|uh|uhm|erm|like|you know|basically|actually|sort of|kind of|i mean|well)\b/gi;

function countFillers(text) {
  const m = (text || '').match(FILLER_RE);
  return m ? m.length : 0;
}

function getSpeechRecognition() {
  return typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;
}

async function fetchTtsBlob(path, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || err.detail || `TTS failed (${resp.status})`);
  }
  return resp.blob();
}

function playBlob(blob, audioRef) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audioRef.current = audio;
  return new Promise((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (audioRef.current === audio) audioRef.current = null;
      resolve();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      if (audioRef.current === audio) audioRef.current = null;
      reject(new Error('Audio playback failed'));
    };
    audio.play().catch(reject);
  });
}

/** Play audio and reveal interviewer words over playback duration (live transcript effect). */
function playBlobWithLiveWords(blob, fullText, audioRef, setLiveReveal) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audioRef.current = audio;
  const words = fullText.split(/\s+/).filter(Boolean);
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (!audio.duration || !words.length) {
        setLiveReveal(fullText);
        return;
      }
      const frac = Math.min(1, audio.currentTime / audio.duration);
      const n = Math.max(0, Math.ceil(frac * words.length));
      setLiveReveal(words.slice(0, n).join(' '));
    };
    audio.addEventListener('timeupdate', tick);
    audio.addEventListener('loadedmetadata', tick);
    audio.onended = () => {
      audio.removeEventListener('timeupdate', tick);
      URL.revokeObjectURL(url);
      setLiveReveal(fullText);
      if (audioRef.current === audio) audioRef.current = null;
      resolve();
    };
    audio.onerror = () => {
      audio.removeEventListener('timeupdate', tick);
      URL.revokeObjectURL(url);
      if (audioRef.current === audio) audioRef.current = null;
      reject(new Error('Audio playback failed'));
    };
    audio.play().catch(reject);
  });
}

export default function InterviewMode({ onBack }) {
  const [phase, setPhase] = useState('idle');
  const [orbActive, setOrbActive] = useState(false);
  const [statusLine, setStatusLine] = useState('Click Start or say the wake phrase.');
  const [errorMsg, setErrorMsg] = useState('');
  const [transcript, setTranscript] = useState([]);
  const [reportMd, setReportMd] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wakeSupported, setWakeSupported] = useState(true);
  const [replayBusy, setReplayBusy] = useState(null);

  const [timerPhase, setTimerPhase] = useState(null);
  const [thinkLeft, setThinkLeft] = useState(null);
  const [answerLeft, setAnswerLeft] = useState(null);
  const [userLiveLine, setUserLiveLine] = useState('');
  const [interviewerReveal, setInterviewerReveal] = useState('');
  const [interviewerLog, setInterviewerLog] = useState([]);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [interviewerVideoError, setInterviewerVideoError] = useState(false);

  const userVideoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const interviewerVideoRef = useRef(null);

  const wakeRef = useRef(null);
  const answerRecRef = useRef(null);
  const playAudioRef = useRef(null);
  const stopLoopRef = useRef(false);
  const phaseRef = useRef('idle');
  const reportRequestedRef = useRef(false);
  const thinkIntervalRef = useRef(null);
  const answerIntervalRef = useRef(null);
  const answerAbortRef = useRef(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const stopCamera = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    if (userVideoRef.current) userVideoRef.current.srcObject = null;
    setCameraEnabled(false);
  }, []);

  const toggleCamera = useCallback(async () => {
    setErrorMsg('');
    if (cameraStreamRef.current) {
      stopCamera();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (userVideoRef.current) {
        userVideoRef.current.srcObject = stream;
        await userVideoRef.current.play().catch(() => {});
      }
      setCameraEnabled(true);
    } catch (e) {
      setErrorMsg(e.message || 'Could not access the camera.');
    }
  }, [stopCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const clearTimers = useCallback(() => {
    if (thinkIntervalRef.current) {
      clearInterval(thinkIntervalRef.current);
      thinkIntervalRef.current = null;
    }
    if (answerIntervalRef.current) {
      clearInterval(answerIntervalRef.current);
      answerIntervalRef.current = null;
    }
    setTimerPhase(null);
    setThinkLeft(null);
    setAnswerLeft(null);
  }, []);

  const stopWake = useCallback(() => {
    try {
      if (wakeRef.current) {
        wakeRef.current.onresult = null;
        wakeRef.current.onerror = null;
        wakeRef.current.onend = null;
        wakeRef.current.stop();
      }
    } catch {
      /* ignore */
    }
    wakeRef.current = null;
  }, []);

  const startWakeListener = useCallback(() => {
    const Rec = getSpeechRecognition();
    if (!Rec) {
      setWakeSupported(false);
      return;
    }
    stopWake();
    const r = new Rec();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onresult = (ev) => {
      let text = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript;
      }
      if (WAKE_REGEX.test(text.trim())) {
        stopWake();
        if (startInterviewRef.current) startInterviewRef.current();
      }
    };
    r.onerror = () => {};
    r.onend = () => {
      if (phaseRef.current === 'idle' && wakeRef.current === r) {
        try {
          r.start();
        } catch {
          /* ignore */
        }
      }
    };
    wakeRef.current = r;
    try {
      r.start();
    } catch {
      setWakeSupported(false);
    }
  }, [stopWake]);

  /**
   * 15s thinking (no mic) → 60s answer with continuous recognition.
   * Pauses: count a gap when speech resumes after ~0.88s of no updates (after speech started).
   */
  const runThinkThenAnswer = useCallback(() => {
    return new Promise((resolve) => {
      if (stopLoopRef.current) {
        resolve({ text: '', meta: null });
        return;
      }

      setTimerPhase('think');
      setThinkLeft(THINK_SECONDS);
      setAnswerLeft(null);
      setUserLiveLine('');
      setStatusLine('Take a moment to think…');

      let think = THINK_SECONDS;
      thinkIntervalRef.current = setInterval(() => {
        if (stopLoopRef.current) {
          if (thinkIntervalRef.current) clearInterval(thinkIntervalRef.current);
          thinkIntervalRef.current = null;
          clearTimers();
          resolve({ text: '', meta: null });
          return;
        }
        think -= 1;
        setThinkLeft(think);
        if (think <= 0) {
          if (thinkIntervalRef.current) clearInterval(thinkIntervalRef.current);
          thinkIntervalRef.current = null;
          startAnswerWindow(resolve);
        }
      }, 1000);

      function startAnswerWindow(doneResolve) {
        if (stopLoopRef.current) {
          clearTimers();
          doneResolve({ text: '', meta: null });
          return;
        }

        setTimerPhase('answer');
        setThinkLeft(0);
        setAnswerLeft(ANSWER_SECONDS);
        setStatusLine('Your turn — speak your answer (live transcript below).');

        const Rec = getSpeechRecognition();
        if (!Rec) {
          setErrorMsg('Speech recognition is not available in this browser. Try Chrome.');
          clearTimers();
          doneResolve({ text: '', meta: null });
          return;
        }

        const r = new Rec();
        answerRecRef.current = r;
        answerAbortRef.current = false;
        r.continuous = true;
        r.interimResults = true;
        r.lang = 'en-US';

        let finalLine = '';
        let lastSpeechAt = Date.now();
        let hadSpeech = false;
        let pauseCount = 0;
        const answerStart = Date.now();
        const finish = (timedOut) => {
          if (answerAbortRef.current) return;
          answerAbortRef.current = true;
          answerRecRef.current = null;
          if (answerIntervalRef.current) clearInterval(answerIntervalRef.current);
          answerIntervalRef.current = null;
          try {
            r.stop();
          } catch {
            /* ignore */
          }
          clearTimers();
          const text = finalLine.trim();
          const answerSeconds = Math.min(ANSWER_SECONDS, (Date.now() - answerStart) / 1000);
          const fc = countFillers(text);
          setUserLiveLine('');
          doneResolve({
            text,
            meta: {
              filler_count: fc,
              pause_count: pauseCount,
              thinking_seconds_used: THINK_SECONDS,
              answer_seconds: Math.round(answerSeconds * 10) / 10,
              timed_out: timedOut,
            },
          });
        };

        r.onresult = (ev) => {
          const now = Date.now();
          let interim = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const res = ev.results[i];
            if (res.isFinal) {
              finalLine += res[0].transcript;
            } else {
              interim += res[0].transcript;
            }
          }
          const display = (finalLine + interim).trim();
          setUserLiveLine(display);

          if (display.length > 0) {
            if (hadSpeech && now - lastSpeechAt > 880) {
              pauseCount += 1;
            }
            hadSpeech = true;
            lastSpeechAt = now;
          }
        };

        r.onerror = () => {
          answerRecRef.current = null;
          if (answerIntervalRef.current) clearInterval(answerIntervalRef.current);
          answerIntervalRef.current = null;
          clearTimers();
          setUserLiveLine('');
          doneResolve({ text: finalLine.trim(), meta: null });
        };

        let ans = ANSWER_SECONDS;
        answerIntervalRef.current = setInterval(() => {
          ans -= 1;
          setAnswerLeft(ans);
          if (ans <= 0) {
            if (answerIntervalRef.current) clearInterval(answerIntervalRef.current);
            answerIntervalRef.current = null;
            finish(true);
          }
        }, 1000);

        try {
          r.start();
        } catch {
          finish(false);
        }
      }
    });
  }, [clearTimers]);

  const runThinkThenAnswerRef = useRef(null);
  useEffect(() => {
    runThinkThenAnswerRef.current = runThinkThenAnswer;
  }, [runThinkThenAnswer]);

  const runInterviewTurn = useCallback(
    async (userText, historySnapshot, turnIndex, answerMeta) => {
      setBusy(true);
      setStatusLine('Generating the next question…');
      try {
        const turnResp = await fetch(`${API_BASE}/api/interview/turn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_text: userText,
            history: historySnapshot,
            user_turn_index: turnIndex,
            max_questions: 4,
            answer_metrics: answerMeta || {},
          }),
        });
        const turnData = await turnResp.json().catch(() => ({}));
        if (!turnResp.ok) {
          throw new Error(turnData.error || 'Interview step failed');
        }
        const question = (turnData.question || '').trim();
        const tone = turnData.tone === 'aggressive' ? 'aggressive' : 'soft';
        const complete = !!turnData.interview_complete;

        const userEntry = {
          role: 'user',
          content: userText,
          meta: answerMeta || undefined,
        };
        const nextHistory = [...historySnapshot, userEntry, { role: 'assistant', content: question }];
        setTranscript(nextHistory);

        setInterviewerReveal('');
        const blob = await fetchTtsBlob('/api/tts/interview', { text: question, tone });
        setStatusLine('Interviewer is speaking…');
        await playBlobWithLiveWords(blob, question, playAudioRef, setInterviewerReveal);
        setInterviewerLog((prev) => [...prev, { id: Date.now(), text: question }]);

        if (complete || stopLoopRef.current) {
          setPhase('done');
          setOrbActive(false);
          setStatusLine('Interview complete. Review your report below.');
          setBusy(false);
          return;
        }

        const out = await runThinkThenAnswerRef.current();
        if (stopLoopRef.current) {
          setBusy(false);
          return;
        }
        if (!out.text && !out.meta?.timed_out) {
          setStatusLine('No speech captured — try again from Start.');
          setBusy(false);
          return;
        }
        await runInterviewTurn(out.text || '(No response)', nextHistory, turnIndex + 1, out.meta);
      } catch (e) {
        setErrorMsg(e.message || String(e));
        setBusy(false);
        setOrbActive(false);
      }
    },
    []
  );

  const startInterviewRef = useRef(null);

  const startInterview = useCallback(async () => {
    setErrorMsg('');
    stopLoopRef.current = false;
    reportRequestedRef.current = false;
    stopWake();
    setPhase('active');
    setOrbActive(true);
    setBusy(true);
    setStatusLine('Starting…');
    setTranscript([]);
    setReportMd('');
    setInterviewerLog([]);
    setInterviewerReveal('');

    try {
      const blob = await fetchTtsBlob('/api/tts/interview', { text: OPENING_LINE, tone: 'soft' });
      const openingHistory = [{ role: 'assistant', content: OPENING_LINE }];
      setTranscript(openingHistory);
      setInterviewerLog([{ id: Date.now(), text: OPENING_LINE }]);
      setStatusLine('Interviewer is speaking…');
      await playBlobWithLiveWords(blob, OPENING_LINE, playAudioRef, setInterviewerReveal);

      const out = await runThinkThenAnswerRef.current();
      if (stopLoopRef.current) {
        setBusy(false);
        return;
      }
      if (!out.text && !out.meta?.timed_out) {
        setErrorMsg('No answer captured.');
        setPhase('idle');
        setOrbActive(false);
        setBusy(false);
        startWakeListener();
        return;
      }
      await runInterviewTurn(out.text || '(No response)', openingHistory, 0, out.meta);
    } catch (e) {
      setErrorMsg(e.message || String(e));
      setPhase('idle');
      setOrbActive(false);
      setBusy(false);
      startWakeListener();
    }
  }, [startWakeListener, stopWake, runInterviewTurn]);

  startInterviewRef.current = startInterview;

  useEffect(() => {
    if (phase === 'idle') {
      startWakeListener();
    }
    return () => {
      stopWake();
      try {
        if (answerRecRef.current) answerRecRef.current.stop();
      } catch {
        /* ignore */
      }
    };
  }, [phase, startWakeListener, stopWake]);

  const endInterview = useCallback(() => {
    stopLoopRef.current = true;
    answerAbortRef.current = true;
    if (thinkIntervalRef.current) clearInterval(thinkIntervalRef.current);
    if (answerIntervalRef.current) clearInterval(answerIntervalRef.current);
    try {
      if (answerRecRef.current) answerRecRef.current.stop();
    } catch {
      /* ignore */
    }
    if (playAudioRef.current) {
      playAudioRef.current.pause();
      playAudioRef.current = null;
    }
    setBusy(false);
    setOrbActive(false);
    clearTimers();
    setUserLiveLine('');
    setPhase('done');
    setStatusLine('Interview ended.');
  }, [clearTimers]);

  const buildReport = useCallback(async () => {
    setReportLoading(true);
    setErrorMsg('');
    try {
      const resp = await fetch(`${API_BASE}/api/interview/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Report failed');
      setReportMd(data.report_markdown || '');
    } catch (e) {
      setErrorMsg(e.message || String(e));
    } finally {
      setReportLoading(false);
    }
  }, [transcript]);

  useEffect(() => {
    if (
      phase === 'done' &&
      transcript.length > 0 &&
      !reportMd &&
      !reportLoading &&
      !reportRequestedRef.current
    ) {
      reportRequestedRef.current = true;
      buildReport();
    }
  }, [phase, transcript.length, reportMd, reportLoading, buildReport]);

  const downloadTranscript = useCallback(() => {
    const lines = transcript.map((t) => {
      const label = t.role === 'assistant' ? 'Interviewer' : 'Candidate';
      let line = `${label}: ${t.content}`;
      if (t.role === 'user' && t.meta) {
        const m = t.meta;
        line += ` [fillers ${m.filler_count ?? '—'}, pauses ${m.pause_count ?? '—'}, think ${m.thinking_seconds_used ?? '—'}s, answer ${m.answer_seconds ?? '—'}s, timed out: ${m.timed_out ? 'yes' : 'no'}]`;
      }
      return line;
    });
    const text = lines.join('\n\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview-transcript-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [transcript]);

  const downloadReport = useCallback(() => {
    const blob = new Blob([reportMd || ''], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview-report-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [reportMd]);

  const replayFeedback = useCallback(async (answerText, id) => {
    setReplayBusy(id);
    setErrorMsg('');
    try {
      const resp = await fetch(`${API_BASE}/api/interview/replay_feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer_text: answerText }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Replay failed');
      const script = (data.script || '').trim();
      if (!script) throw new Error('Empty replay script');
      const blob = await fetchTtsBlob('/api/tts/interview', { text: script, tone: 'soft' });
      setStatusLine("Here's how you sounded…");
      await playBlob(blob, playAudioRef);
      setStatusLine('Replay finished.');
    } catch (e) {
      setErrorMsg(e.message || String(e));
    } finally {
      setReplayBusy(null);
    }
  }, []);

  const userTurns = transcript.filter((t) => t.role === 'user');
  const lastUserMeta = userTurns.length ? userTurns[userTurns.length - 1].meta : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto w-full flex flex-col gap-4">
        <div className="w-full flex justify-between items-center">
          <button
            type="button"
            onClick={() => {
              stopCamera();
              endInterview();
              onBack();
            }}
            className="inline-flex items-center gap-2 text-indigo-200/90 hover:text-white text-sm"
          >
            <ArrowLeft size={18} />
            Modes
          </button>
          {phase === 'active' && (
            <button
              type="button"
              onClick={endInterview}
              className="inline-flex items-center gap-2 rounded-full border border-rose-500/50 bg-rose-500/15 px-4 py-2 text-sm text-rose-100 hover:bg-rose-500/25"
            >
              <Square size={16} />
              End interview
            </button>
          )}
        </div>

        {phase === 'active' && (
          <div className="w-full rounded-xl border border-indigo-500/30 bg-indigo-950/40 px-4 py-3 text-sm text-indigo-100">
            <div className="flex items-center gap-2 font-medium text-indigo-200 mb-2">
              <Timer size={16} />
              Timed rounds
            </div>
            <p className="text-indigo-100/90">
              After each question: <strong>{THINK_SECONDS}s</strong> to think (no recording), then{' '}
              <strong>{ANSWER_SECONDS}s</strong> to answer. Timing and filler/pause counts are sent to your report.
            </p>
            <div className="mt-3 flex flex-wrap gap-4 tabular-nums">
              {timerPhase === 'think' && thinkLeft != null && (
                <span className="rounded-lg bg-amber-500/20 px-3 py-1 text-amber-100">
                  Thinking: <strong>{thinkLeft}</strong>s left
                </span>
              )}
              {timerPhase === 'answer' && answerLeft != null && (
                <span className="rounded-lg bg-emerald-500/20 px-3 py-1 text-emerald-100">
                  Answer window: <strong>{answerLeft}</strong>s left
                </span>
              )}
              {timerPhase === 'answer' && lastUserMeta != null && (
                <span className="text-slate-400 text-xs">
                  Last answer — fillers: {lastUserMeta.filler_count ?? '—'} · pauses:{' '}
                  {lastUserMeta.pause_count ?? '—'}
                </span>
              )}
            </div>
          </div>
        )}

        {phase !== 'done' && (
          <div className="flex flex-col xl:flex-row gap-6 xl:gap-8 items-start w-full">
            {/* Left: Meet-style videos + transcript below */}
            <div className="w-full xl:flex-1 min-w-0 flex flex-col gap-3 order-2 xl:order-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-400">Turn your camera on before starting for a Meet-style view.</p>
                <button
                  type="button"
                  onClick={toggleCamera}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border ${
                    cameraEnabled
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25'
                      : 'border-white/20 bg-white/5 text-white hover:bg-white/10'
                  }`}
                >
                  {cameraEnabled ? <CameraOff size={18} /> : <Camera size={18} />}
                  {cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                {/* Interviewee */}
                <div className="relative aspect-video rounded-xl overflow-hidden bg-black/80 border border-white/10 shadow-lg">
                  <video
                    ref={userVideoRef}
                    className="absolute inset-0 w-full h-full object-cover"
                    playsInline
                    muted
                    autoPlay
                  />
                  {!cameraEnabled && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/95 text-slate-500 gap-2">
                      <Camera size={36} className="opacity-50" />
                      <span className="text-xs">Camera off</span>
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                    <span className="text-xs font-medium text-white">You</span>
                  </div>
                </div>

                {/* Virtual interviewer (local MP4) */}
                <div className="relative aspect-video rounded-xl overflow-hidden bg-black/80 border border-white/10 shadow-lg">
                  {!interviewerVideoError ? (
                    <video
                      ref={interviewerVideoRef}
                      className="absolute inset-0 w-full h-full object-cover"
                      playsInline
                      muted
                      loop
                      preload="metadata"
                      src={INTERVIEWER_VIDEO_SRC}
                      onLoadedData={() => {
                        setInterviewerVideoError(false);
                        const el = interviewerVideoRef.current;
                        if (el) el.play().catch(() => {});
                      }}
                      onError={() => setInterviewerVideoError(true)}
                    />
                  ) : null}
                  {interviewerVideoError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/95 text-slate-400 px-4 text-center gap-1">
                      <Video size={32} className="opacity-50" />
                      <span className="text-xs leading-snug">
                        Add <code className="text-indigo-300">interviewer.mp4</code> to{' '}
                        <code className="text-indigo-300">frontend/public/</code>
                      </span>
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                    <span className="text-xs font-medium text-white">Interviewer</span>
                  </div>
                </div>
              </div>

              {/* Transcript below videos */}
              <div className="rounded-xl border border-white/10 bg-black/35 p-4 flex flex-col gap-4 min-h-[200px]">
                <div>
                  <div className="flex items-center gap-2 text-violet-200 text-sm font-medium mb-1">
                    <MessageCircle size={16} />
                    Interviewer (live text)
                  </div>
                  <p className="text-xs text-violet-300/70 mb-2">Synced with AI voice.</p>
                  <div className="max-h-32 overflow-y-auto text-sm text-slate-100 leading-relaxed">
                    {interviewerReveal ? (
                      <p className="text-white">{interviewerReveal}</p>
                    ) : (
                      <p className="text-slate-500 italic">Waiting for the next question…</p>
                    )}
                  </div>
                  {interviewerLog.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/10 text-xs text-slate-500 max-h-20 overflow-y-auto">
                      <p className="text-slate-600 mb-1">Earlier</p>
                      {interviewerLog.slice(0, -1).map((item) => (
                        <p key={item.id} className="mb-1 line-clamp-2">
                          {item.text}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                <div className="border-t border-white/10 pt-3">
                  <div className="flex items-center gap-2 text-teal-200 text-sm font-medium mb-2">
                    <Mic size={16} />
                    Your answer (live)
                  </div>
                  <p className="text-sm text-teal-100/90 min-h-[3rem] whitespace-pre-wrap">
                    {timerPhase === 'answer' ? userLiveLine || '…' : '—'}
                  </p>
                  {timerPhase === 'answer' && userLiveLine && (
                    <p className="text-xs text-teal-400/90 mt-2">
                      Fillers: {countFillers(userLiveLine)} · Pause gaps (~0.9s between speech bursts)
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Right: orb + controls */}
            <div className="w-full xl:w-[min(100%,380px)] xl:flex-shrink-0 flex flex-col items-center order-1 xl:order-2 xl:sticky xl:top-6">
              <div
                className={`relative flex items-center justify-center w-52 h-52 sm:w-56 sm:h-56 rounded-full transition-all duration-700 ${
                  orbActive
                    ? 'shadow-[0_0_80px_rgba(129,140,248,0.55),0_0_120px_rgba(99,102,241,0.35)] scale-105 animate-pulse'
                    : 'shadow-[0_0_40px_rgba(99,102,241,0.2)]'
                }`}
                style={{
                  background: orbActive
                    ? 'radial-gradient(circle at 30% 30%, rgba(199,210,254,0.35), rgba(79,70,229,0.5), rgba(30,27,75,0.95))'
                    : 'radial-gradient(circle at 30% 30%, rgba(148,163,184,0.2), rgba(51,65,85,0.6), rgba(15,23,42,0.95))',
                }}
              >
                <div
                  className={`absolute inset-4 rounded-full border-2 ${
                    orbActive ? 'border-indigo-300/50' : 'border-white/10'
                  }`}
                />
                <div className="relative z-10 flex flex-col items-center gap-4 px-6 text-center">
                  {busy && <Loader2 className="animate-spin text-indigo-200" size={28} />}
                  {!busy && phase === 'idle' && <Mic className="text-indigo-200/80" size={32} />}
                  {phase !== 'idle' && !busy && <Volume2 className="text-indigo-200/90" size={28} />}
                  {phase === 'idle' && (
                    <button
                      type="button"
                      onClick={startInterview}
                      disabled={busy}
                      className="rounded-full bg-indigo-500 hover:bg-indigo-400 text-white font-semibold px-6 py-3 text-sm shadow-lg shadow-indigo-500/30 disabled:opacity-50"
                    >
                      Start Interview
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-5 text-center text-indigo-100/90 text-sm min-h-[2.5rem] px-2 max-w-xs">
                {statusLine}
              </p>
            </div>
          </div>
        )}

      {!wakeSupported && phase === 'idle' && (
        <p className="text-amber-200/80 text-xs mt-2">Wake phrase needs Chrome / Edge with mic access.</p>
      )}

      {errorMsg && (
        <div className="mt-4 w-full rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-100">
          {errorMsg}
        </div>
      )}

      {phase === 'done' && (
        <div className="w-full mt-8 space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-md">
            <h2 className="text-white font-semibold flex items-center gap-2 mb-3">
              <FileText size={20} className="text-indigo-300" />
              Your answers
            </h2>
            <ul className="space-y-3 text-sm text-slate-200 max-h-56 overflow-y-auto">
              {userTurns.map((u, i) => (
                <li key={i} className="border-b border-white/5 pb-3">
                  <p className="text-slate-300">{u.content}</p>
                  {u.meta && (
                    <p className="text-xs text-slate-500 mt-1">
                      Fillers: {u.meta.filler_count} · Pauses: {u.meta.pause_count} · Think {u.meta.thinking_seconds_used}s ·
                      Answer {u.meta.answer_seconds}s
                      {u.meta.timed_out ? ' · Hit time limit' : ''}
                    </p>
                  )}
                  
                  <button
                    type="button"
                    disabled={replayBusy === i}
                    onClick={() => replayFeedback(u.content, i)}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-100 disabled:opacity-50"
                  >
                    {replayBusy === i ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <RotateCcw size={14} />
                    )}
                    Voice feedback replay
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={downloadTranscript}
              className="mt-4 inline-flex items-center gap-2 text-sm text-indigo-200 hover:text-white"
            >
              <Download size={16} />
              Download transcript
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-md">
            <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
              <CheckCircle2 size={20} className="text-emerald-400" />
              Interview report
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              The coach uses your words plus timing/filler/pause signals from each answer to judge clarity and pacing.
            </p>
            {reportLoading ? (
              <div className="flex items-center gap-2 text-indigo-200/80 text-sm">
                <Loader2 className="animate-spin" size={18} />
                Generating report…
              </div>
            ) : (
              <div className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
                {reportMd || '—'}
              </div>
            )}
            <button
              type="button"
              onClick={downloadReport}
              disabled={!reportMd}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              <Download size={16} />
              Download report
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setPhase('idle');
              setTranscript([]);
              setReportMd('');
              setInterviewerLog([]);
              setInterviewerReveal('');
              reportRequestedRef.current = false;
              setStatusLine('Click Start or say the wake phrase.');
              stopLoopRef.current = false;
            }}
            className="w-full rounded-xl border border-white/15 bg-white/5 py-3 text-sm text-white hover:bg-white/10"
          >
            New interview
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
