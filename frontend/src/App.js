import React, { useState, useRef, useEffect } from 'react';
import { Mail, Camera, Square, Mic, Volume2, AlertCircle, Activity, Zap, Heart, FileText, Download, Stethoscope, Clock, Award, LogOut, Loader2, ListChecks, ArrowLeft, Lightbulb } from 'lucide-react';
import ZariyaLandingPage from './home';
import ModeSelect from './ModeSelect';
import InterviewMode from './InterviewMode';
import UnpanicMode from './UnpanicMode';
import Auth from './Auth';
import { API_BASE, loadStoredAuth, clearAuth, fetchMe } from './api';

// How often we POST a video frame to /process_frame. Larger = slower buffer fill → longer before each prediction (pairs with backend ZARIYA_FRAME_BUFFER_SIZE).
const FRAME_SEND_INTERVAL_MS = 100;

/** Tips read aloud via ElevenLabs when the user taps Tips. Replace with your final copy. */
const SESSION_TIPS_TEXT =
  'Welcome to your session. Sit in good light, face the camera, and speak with clear lip movements. Take your time between phrases.';

const EMOTION_EMOTICONS = {
  happy: "😊",
  sad: "😢",
  angry: "😠",
  surprised: "😲",
  neutral: "😐",
  fearful: "😨",
  disgusted: "🤢"
};

function labelForSentenceScore(score) {
  if (score == null || Number.isNaN(score)) return '—';
  if (score > 80) return 'Good';
  if (score >= 60) return 'Okay';
  return 'Needs Work';
}

function formatClockFromSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Aggregates Mode 4 session data for report UI, download, and email. */
function buildStructuredReportData({
  allPredictions,
  emotionHistory,
  sessionDurationSeconds,
  sessionNotes,
  patientName,
  patientId,
  frameCount,
}) {
  const withScores = allPredictions.filter((p) => typeof p.dtwScore === 'number');
  const overall_score =
    withScores.length > 0
      ? Math.round(withScores.reduce((s, p) => s + p.dtwScore, 0) / withScores.length)
      : null;

  const bySentence = new Map();
  for (const p of allPredictions) {
    const key = p.text;
    if (!bySentence.has(key)) {
      bySentence.set(key, { text: key, scores: [], count: 0 });
    }
    const e = bySentence.get(key);
    e.count += 1;
    if (typeof p.dtwScore === 'number') e.scores.push(p.dtwScore);
  }

  const sentence_results = Array.from(bySentence.values()).map((e) => {
    const sc =
      e.scores.length > 0
        ? Math.round(e.scores.reduce((a, b) => a + b, 0) / e.scores.length)
        : null;
    return {
      text: e.text,
      count: e.count,
      score: sc,
      label: sc != null ? labelForSentenceScore(sc) : '—',
    };
  });

  let best_attempt = null;
  for (const row of sentence_results) {
    if (row.score != null) {
      if (!best_attempt || row.score > best_attempt.score) {
        best_attempt = { text: row.text, score: row.score };
      }
    }
  }

  const tips = [];
  if (withScores.length === 0 && allPredictions.length > 0) {
    tips.push('Lip similarity scores were not available for this session (e.g. non-template mode).');
  } else if (withScores.length === 0) {
    tips.push('No matched phrases yet — try speaking a calibrated sentence clearly.');
  } else {
    if (overall_score < 60) tips.push('Unclear lip movement');
    const timingHeavy = withScores.filter(
      (p) =>
        typeof p.linearSimilarity === 'number' &&
        typeof p.dtwSimilarity === 'number' &&
        p.dtwSimilarity - p.linearSimilarity > 0.08
    );
    if (timingHeavy.length > withScores.length * 0.35) tips.push('Timing mismatch');
    if (withScores.some((p) => p.margin != null && p.margin < 0.06)) {
      tips.push('Some attempts were ambiguous — slow down between phrases.');
    }
    if (overall_score >= 80) tips.push('Good articulation');
    else if (tips.length < 2 && overall_score >= 60) tips.push('Keep practicing — you are on the right track.');
  }

  const key_feedback = [...new Set(tips)].slice(0, 3);

  return {
    overall_score,
    sentence_results,
    key_feedback,
    best_attempt,
    patient_name: patientName,
    patient_id: patientId,
    duration: formatClockFromSeconds(sessionDurationSeconds || 0),
    session_notes: sessionNotes,
    emotions: emotionHistory.map((e) => (typeof e === 'object' ? e.emotion : e)),
    frame_count: frameCount,
  };
}

export default function MedicalLipReadingApp() {
  const [authSession, setAuthSession] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [showLanding, setShowLanding] = useState(true);
  /** null = show mode picker; 1–3 = placeholders; 4 = live practise (existing flow). */
  const [selectedAppMode, setSelectedAppMode] = useState(null);
  
  const [isStreaming, setIsStreaming] = useState(false);
  const [prediction, setPrediction] = useState('');
  const [predictionSource, setPredictionSource] = useState('');
  const [allPredictions, setAllPredictions] = useState([]);
  const [faceDetected, setFaceDetected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [mouthRoi, setMouthRoi] = useState(null);
  const [debugInfo, setDebugInfo] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [bufferStatus, setBufferStatus] = useState('0/25');
  const [framesSent, setFramesSent] = useState(0);
  const [predictionsReceived, setPredictionsReceived] = useState(0);
  const [isWaitingForMovement, setIsWaitingForMovement] = useState(false);
  const [serverMode, setServerMode] = useState('DEMO');
  const [frameCount, setFrameCount] = useState(0);
  const [currentEmotion, setCurrentEmotion] = useState('neutral');
  const [emotionConfidence, setEmotionConfidence] = useState(0);
  const [emotionHistory, setEmotionHistory] = useState([]);
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [patientName, setPatientName] = useState('');
  const [patientId, setPatientId] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [emotionDetectionStatus, setEmotionDetectionStatus] = useState('loading');
  const [lastDtwScore, setLastDtwScore] = useState(null);
  const [sessionDtwScores, setSessionDtwScores] = useState([]);

  const [calibrationSentences, setCalibrationSentences] = useState([]);
  const [calibrationMessage, setCalibrationMessage] = useState('');
  const [recordingSentenceId, setRecordingSentenceId] = useState(null);
  const [calibrationBusy, setCalibrationBusy] = useState(false);
  const [tipsLoading, setTipsLoading] = useState(false);

  const videoRef = useRef(null);
  const tipsAudioRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const durationIntervalRef = useRef(null); 

  const fetchCalibrationStatus = async () => {
    try {
      const resp = await fetch(`${API_BASE}/template_calibration_status`);
      if (resp.ok) {
        const data = await resp.json();
        setCalibrationSentences(data.sentences || []);
      }
    } catch {
      /* ignore */
    }
  };

  const playSessionTips = async () => {
    if (!SESSION_TIPS_TEXT.trim()) {
      setErrorMsg('Add your tips text in SESSION_TIPS_TEXT (App.js).');
      return;
    }
    if (tipsAudioRef.current) {
      tipsAudioRef.current.pause();
      tipsAudioRef.current.src = '';
      tipsAudioRef.current = null;
    }
    setTipsLoading(true);
    setErrorMsg('');
    try {
      const resp = await fetch(`${API_BASE}/api/tts/tips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: SESSION_TIPS_TEXT }),
      });
      const contentType = resp.headers.get('content-type') || '';
      if (!resp.ok) {
        let msg = `Tips audio failed (${resp.status})`;
        if (contentType.includes('application/json')) {
          const err = await resp.json().catch(() => ({}));
          if (err.error) msg = err.error;
          if (err.detail) msg = `${msg}: ${err.detail}`;
        }
        setErrorMsg(msg);
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      tipsAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        tipsAudioRef.current = null;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        tipsAudioRef.current = null;
        setErrorMsg('Could not play tips audio.');
      };
      await audio.play();
    } catch (e) {
      setErrorMsg(e.message || 'Could not load tips audio. Is the server running?');
    } finally {
      setTipsLoading(false);
    }
  };

  const testServerConnection = async () => {
    try {
      const resp = await fetch(`${API_BASE}/health`);
      const data = await resp.json();
      if (resp.ok) {
        setConnectionStatus('connected');
        setServerMode(data.mode || 'DEMO');
        const emotionAvailable = data.emotion_detection || false;
        setEmotionDetectionStatus(emotionAvailable ? 'ready' : 'failed');
        const modelStatus = data.model_loaded ? '✓ Loaded' : '✗ Not loaded';
        const emotionStatus = emotionAvailable ? '✓ ' : '✗ Unavailable';
        setDebugInfo(`Server ready `);
      } else {
        setConnectionStatus('error');
        setDebugInfo('Server returned error status');
      }
    } catch (err) {
      setConnectionStatus('disconnected');
      setErrorMsg(`Cannot connect to server at ${API_BASE}. Is it running on port 5056?`);
      setDebugInfo('Server connection failed');
    }
  };

  const startCamera = async () => {
    try {
      setErrorMsg('');
      setDebugInfo('Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      streamRef.current = stream;
      setIsStreaming(true);
      setSessionStartTime(Date.now());
      const emotionStatus = emotionDetectionStatus === 'ready' ? ' with ML emotion detection (FER)' : '';
      setDebugInfo(`✓ Session started${emotionStatus}`);
      setFramesSent(0);
      setPredictionsReceived(0);
      setAllPredictions([]);
      setEmotionHistory([]);
      setSessionDtwScores([]);
      setLastDtwScore(null);
      setSessionDuration(0);
      setPrediction('');
      setPredictionSource('');

      // Send frames for lip reading and emotion detection
      intervalRef.current = setInterval(() => {
        captureAndSendFrame();
      }, FRAME_SEND_INTERVAL_MS);

      // Session duration timer
      durationIntervalRef.current = setInterval(() => {
        setSessionDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error(err);
      setErrorMsg(`Camera access failed: ${err.message}`);
      setDebugInfo('Camera access denied or unavailable');
    }
  };

  async function sendEmailReport(recipientEmail, sessionData) {
    const response = await fetch(`${API_BASE}/send_report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: recipientEmail,
            report_data: sessionData,
            session_id: `session-${Date.now()}`
        })
    });
    
    const result = await response.json();
    
    if (result.status === 'success') {
        alert('✓ Report sent to ' + recipientEmail);
    } else {
        alert('✗ Failed: ' + result.message);
    }
}

  const stopCamera = (opts = {}) => {
    const skipReport = opts.skipReport === true;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      }
    }
    setIsStreaming(false);
    setFaceDetected(false);
    setMouthRoi(null);
    setBufferStatus('0/25');
    setDebugInfo('Session ended');
    
    if (!skipReport && allPredictions.length > 0) {
      setShowReport(true);
    }
  };

  const goToModeSelect = () => {
    stopCamera({ skipReport: true });
    setSelectedAppMode(null);
  };

  const drawBBox = (bbox) => {
    if (!overlayRef.current || !videoRef.current) return;
    
    const [x1, y1, x2, y2] = bbox;
    const overlay = overlayRef.current;
    const video = videoRef.current;
    const ctx = overlay.getContext('2d');

    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;

    ctx.clearRect(0, 0, overlay.width, overlay.height);
    
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#00FF88";
    ctx.shadowColor = "#00FF88";
    ctx.shadowBlur = 15;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.shadowBlur = 0;
    
    const cornerSize = 15;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1 + cornerSize);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 + cornerSize, y1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2 - cornerSize, y1);
    ctx.lineTo(x2, y1);
    ctx.lineTo(x2, y1 + cornerSize);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y2 - cornerSize);
    ctx.lineTo(x1, y2);
    ctx.lineTo(x1 + cornerSize, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2 - cornerSize, y2);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2, y2 - cornerSize);
    ctx.stroke();
    
    //const gradient = ctx.createLinearGradient(x1, y1 - 30, x1, y1);
    //gradient.addColorStop(0, "rgba(0, 255, 136, 0.9)");
    //gradient.addColorStop(1, "rgba(0, 200, 100, 0.9)");
    //ctx.fillStyle = gradient;
    //ctx.fillRect(x1, y1 - 30, 140, 28);
    
    //ctx.fillStyle = "#000000";
    //ctx.font = "bold 16px 'Segoe UI', Arial";
    //ctx.fillText("MOUTH", x1 + 8, y1 - 8);
  };

  const captureAndSendFrame = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (!canvas.width || !canvas.height) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      const frameData = canvas.toDataURL('image/jpeg', 0.85);
      const response = await fetch(`${API_BASE}/process_frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frame: frameData })
      });

      if (response.ok) {
        const data = await response.json();
        handleServerMessage(data);
        setConnectionStatus('connected');
        setFramesSent(prev => prev + 1);
        setFrameCount(prev => prev + 1); 
      } else {
        setConnectionStatus('error');
        setDebugInfo('Server returned error status');
      }
    } catch (err) {
      console.error('send frame error', err);
      setConnectionStatus('disconnected');
      setDebugInfo(`Connection error: ${err.message}`);
    }
  };

const handleEmailReport = async () => {
  const email = prompt('Enter email address to send report:');
  
  if (!email) return;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    alert('Please enter a valid email address');
    return;
  }
  
  try {
    const structured = buildStructuredReportData({
      allPredictions,
      emotionHistory,
      sessionDurationSeconds: sessionDuration,
      sessionNotes,
      patientName,
      patientId,
      frameCount,
    });

    const response = await fetch(`${API_BASE}/send_report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        report_data: structured,
        session_id: `session-${Date.now()}`,
      }),
    });
    
    const result = await response.json();
    
    if (result.status === 'success') {
      alert('✓ Report sent successfully to ' + email);
    } else {
      alert('✗ Failed to send: ' + result.message);
    }
  } catch (error) {
    alert('✗ Error: ' + error.message);
    console.error('Email error:', error);
  }
};

// ✅ Helper function to format time
const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};
  const handleServerMessage = (data) => {
    if (data.type !== 'frame_result') return;

    const faceFound = !!data.face_detected;
    setFaceDetected(faceFound);

    if (data.mode) setServerMode(data.mode);

    // Update emotion from backend ML model (FER)
    if (data.emotion) {
      setCurrentEmotion(data.emotion);
      if (data.emotion_confidence) {
        setEmotionConfidence(data.emotion_confidence);
      }
      // Add to history
      setEmotionHistory(prev => [...prev, { 
        emotion: data.emotion, 
        confidence: data.emotion_confidence || 0,
        timestamp: Date.now() 
      }]);
    }

    if (data.debug) {
      setDebugInfo(data.debug);
      const bufferMatch = data.debug.match(/Buffer: (\d+\/\d+)/);
      if (bufferMatch) setBufferStatus(bufferMatch[1]);
      
      if (data.debug.includes('Waiting for mouth movement') || 
          data.debug.includes('Cooldown') ||
          data.debug.includes('variance')) {
        setIsWaitingForMovement(true);
      } else if (data.debug.includes('PREDICTION') || data.prediction) {
        setIsWaitingForMovement(false);
      }
    }

    if (faceFound && Array.isArray(data.bbox)) {
      drawBBox(data.bbox);
    } else {
      if (overlayRef.current) {
        const ctx = overlayRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      }
    }

    if (data.mouth_roi) {
      setMouthRoi(data.mouth_roi);
    } else if (!faceFound) {
      setMouthRoi(null);
    }

    if (data.error) setErrorMsg(`Error: ${data.error}`);

    if (data.prediction && data.prediction.trim()) {
      const newPred = (data.prediction_display || data.prediction).trim();
      setPrediction(newPred);
      setPredictionSource(data.prediction_source || '');
      setPredictionsReceived(prev => prev + 1);

      const lm = data.lip_match;
      const dtw100 = lm && typeof lm.score_100 === 'number' ? lm.score_100 : null;
      if (dtw100 != null) {
        setLastDtwScore(dtw100);
        setSessionDtwScores((prev) => [...prev, dtw100].slice(-80));
      }

      setAllPredictions(prev => [
        {
          text: newPred,
          timestamp: Date.now(),
          id: data.prediction_number || prev.length + 1,
          emotion: currentEmotion,
          emotionConfidence: emotionConfidence,
          dtwScore: dtw100,
          dtwSimilarity: lm?.dtw_similarity ?? null,
          linearSimilarity: lm?.linear_similarity ?? null,
          margin: lm?.margin ?? null,
        },
        ...prev
      ].slice(0, 50));

      setIsWaitingForMovement(false);
      const src = data.prediction_source || 'lip_camera';
      const scoreHint = dtw100 != null ? ` · DTW match ${dtw100}/100` : '';
      setDebugInfo(
        `✓ Prediction #${data.prediction_number || predictionsReceived + 1}: "${newPred}" (${src}${scoreHint} — camera mouth ROI)`
      );
    }
  };

  const toggleCamera = () => (isStreaming ? stopCamera() : startCamera());

  const beginCalibrationRecord = async (sentenceId) => {
    if (!isStreaming) {
      setCalibrationMessage('Start a camera session first, then record each sentence.');
      return;
    }
    setCalibrationBusy(true);
    setCalibrationMessage('');
    try {
      const r = await fetch(`${API_BASE}/start_recording/${encodeURIComponent(sentenceId)}`, { method: 'POST' });
      const d = await r.json();
      if (r.ok) {
        setRecordingSentenceId(sentenceId);
        setCalibrationMessage(d.message || 'Recording…');
      } else {
        setCalibrationMessage(d.message || 'Could not start recording');
      }
    } catch {
      setCalibrationMessage('Network error starting recording');
    } finally {
      setCalibrationBusy(false);
    }
  };

  const stopCalibrationRecord = async () => {
    setCalibrationBusy(true);
    try {
      const r = await fetch(`${API_BASE}/stop_recording`, { method: 'POST' });
      const d = await r.json();
      setRecordingSentenceId(null);
      await fetchCalibrationStatus();
      if (d.status === 'success') {
        if (d.need_rerecord) {
          setCalibrationMessage(
            `Please record again: ${d.detail || d.message || 'Quality check did not pass.'}`
          );
        } else {
          setCalibrationMessage(d.message || 'Template saved successfully.');
        }
      } else {
        setCalibrationMessage(d.message || 'Could not save recording');
      }
    } catch {
      setCalibrationMessage('Network error saving recording');
      setRecordingSentenceId(null);
    } finally {
      setCalibrationBusy(false);
    }
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const generateReport = () => {
    const structured = buildStructuredReportData({
      allPredictions,
      emotionHistory,
      sessionDurationSeconds: sessionDuration,
      sessionNotes,
      patientName,
      patientId,
      frameCount,
    });

    const emotionCounts = emotionHistory.reduce((acc, e) => {
      acc[e.emotion] = (acc[e.emotion] || 0) + 1;
      return acc;
    }, {});

    const dominantEmotion = Object.entries(emotionCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';

    const avgConfidence = emotionHistory.length > 0
      ? Math.round(emotionHistory.reduce((sum, e) => sum + (e.confidence || 0), 0) / emotionHistory.length)
      : 0;

    return {
      ...structured,
      totalPredictions: allPredictions.length,
      sessionDuration: structured.duration,
      dominantEmotion,
      emotionCounts,
      avgConfidence,
      predictions: allPredictions,
      emotionHistory,
    };
  };

  const downloadReport = () => {
    const r = generateReport();
    const overall =
      r.overall_score != null ? `${r.overall_score}/100` : 'N/A (no DTW scores this session)';
    const sentences = (r.sentence_results || [])
      .map(
        (row) =>
          `- "${row.text}"\n  Times: ${row.count}  Score: ${row.score != null ? row.score : '—'}  ${row.label}`
      )
      .join('\n');
    const feedback = (r.key_feedback || []).map((t) => `• ${t}`).join('\n');
    const best = r.best_attempt
      ? `"${r.best_attempt.text}" (${r.best_attempt.score}/100)`
      : '—';

    const reportText = `
Zariya — Practice session report
================================
Date: ${new Date().toLocaleString()}

Patient: ${patientName || '—'}  |  ID: ${patientId || '—'}
Session duration: ${r.duration}
Frames sent: ${frameCount}

1) Overall score (DTW similarity, 0–100)
${overall}

2) Sentence results
${sentences || '(none)'}

3) Key feedback
${feedback || '—'}

4) Best attempt
${best}

— Emotions (overview) —
Dominant: ${r.dominantEmotion} ${EMOTION_EMOTICONS[r.dominantEmotion] || ''}
Avg. confidence: ${r.avgConfidence}%

Clinical notes:
${sessionNotes || '—'}

---
Zariya · Lip-reading practice
Emotion detection: ${emotionDetectionStatus === 'ready' ? 'available (server)' : 'unavailable'}
    `.trim();

    const blob = new Blob([reportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zariya-session-report-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusColor = connectionStatus === 'connected' ? 'bg-green-500'
                     : connectionStatus === 'error' ? 'bg-yellow-500'
                     : 'bg-red-500';

  const statusText = connectionStatus === 'connected' ? 'Connected'
                    : connectionStatus === 'error' ? 'Server Error'
                    : 'Disconnected';

  const modeColor = serverMode === 'DEMO' ? 'bg-blue-500' : serverMode === 'mock' ? 'bg-purple-500' : 'bg-green-500';

  const emotionStatusColor = emotionDetectionStatus === 'ready' ? 'bg-green-500'
                            : emotionDetectionStatus === 'loading' ? 'bg-yellow-500'
                            : 'bg-red-500';

  const sessionAvgDtwLive =
    sessionDtwScores.length > 0
      ? Math.round(sessionDtwScores.reduce((a, b) => a + b, 0) / sessionDtwScores.length)
      : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = loadStoredAuth();
      if (!stored) {
        setAuthChecking(false);
        return;
      }
      try {
        await fetchMe(stored.token);
        if (!cancelled) setAuthSession(stored);
      } catch {
        clearAuth();
        if (!cancelled) setAuthSession(null);
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    testServerConnection();
    fetchCalibrationStatus();
    return () => {
      stopCamera();
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    };
  }, []);

  if (authChecking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-400" size={48} />
      </div>
    );
  }

  if (!authSession) {
    return <Auth onAuthenticated={setAuthSession} />;
  }

  const authBar = (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-black/40 backdrop-blur-md border border-white/20 px-3 py-2">
      <span className="text-gray-300 text-sm max-w-[180px] truncate hidden sm:inline">
        {authSession.user?.name || authSession.user?.email}
      </span>
      {(selectedAppMode === 4 || selectedAppMode === 1 || selectedAppMode === 2) && (
        <button
          type="button"
          onClick={goToModeSelect}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-white hover:bg-white/10"
        >
          <ArrowLeft size={16} />
          <span className="hidden sm:inline">Modes</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          clearAuth();
          setAuthSession(null);
          setShowLanding(true);
          setSelectedAppMode(null);
        }}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-white hover:bg-white/10"
      >
        <LogOut size={16} />
        <span className="hidden sm:inline">Log out</span>
      </button>
    </div>
  );

  if (showLanding) {
    return (
      <>
        {authBar}
        <ZariyaLandingPage onComplete={() => setShowLanding(false)} />
      </>
    );
  }

  if (selectedAppMode === null) {
    return (
      <>
        {authBar}
        <ModeSelect onSelectMode={setSelectedAppMode} />
      </>
    );
  }

  if (selectedAppMode === 4 && showReport) {
    const report = generateReport();
    const sessionAvgDtw =
      sessionDtwScores.length > 0
        ? Math.round(sessionDtwScores.reduce((a, b) => a + b, 0) / sessionDtwScores.length)
        : null;

    return (
      <>
        {authBar}
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-4 sm:p-8">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white/10 backdrop-blur-md rounded-xl shadow-2xl border border-white/20 p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div className="flex items-center gap-3">
                <div className="bg-gradient-to-r from-indigo-500 to-violet-600 p-3 rounded-2xl">
                  <FileText size={28} className="text-white" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-white">Session report</h1>
                  <p className="text-gray-400 text-sm">{new Date().toLocaleString()}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowReport(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium"
              >
                New session
              </button>
            </div>

            <div className="bg-white/5 rounded-xl p-5 mb-6 border border-white/10">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Patient</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-gray-500 text-xs">Name</label>
                  <input
                    type="text"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    placeholder="Optional"
                    className="w-full mt-1 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm"
                  />
                </div>
                <div>
                  <label className="text-gray-500 text-xs">ID</label>
                  <input
                    type="text"
                    value={patientId}
                    onChange={(e) => setPatientId(e.target.value)}
                    placeholder="Optional"
                    className="w-full mt-1 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/15 to-slate-900/40 p-6 mb-6 text-center">
              <p className="text-gray-400 text-sm mb-1">1) Overall score</p>
              <p className="text-5xl font-bold text-white tabular-nums">
                {report.overall_score != null ? report.overall_score : '—'}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                From DTW lip-template similarity (0–100)
                {sessionAvgDtw != null && (
                  <span className="block text-indigo-300/90 mt-1">
                    Running session average: {sessionAvgDtw}
                  </span>
                )}
              </p>
            </div>

            <div className="mb-6">
              <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
                <ListChecks size={18} className="text-amber-400" />
                2) Sentence results
              </h2>
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white/5 text-left text-gray-400 text-xs uppercase">
                      <th className="px-4 py-2 font-medium">Sentence</th>
                      <th className="px-4 py-2 font-medium w-10">×</th>
                      <th className="px-4 py-2 font-medium w-14">Score</th>
                      <th className="px-4 py-2 font-medium w-28">Label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.sentence_results || []).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                          No sentences matched this session
                        </td>
                      </tr>
                    ) : (
                      (report.sentence_results || []).map((row) => (
                        <tr key={row.text} className="border-t border-white/10">
                          <td className="px-4 py-3 text-white">{row.text}</td>
                          <td className="px-4 py-3 text-gray-300 tabular-nums">{row.count}</td>
                          <td className="px-4 py-3 text-gray-200 tabular-nums">
                            {row.score != null ? row.score : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`text-xs font-medium px-2 py-0.5 rounded ${
                                row.label === 'Good'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : row.label === 'Okay'
                                  ? 'bg-amber-500/20 text-amber-200'
                                  : row.label === '—'
                                  ? 'bg-white/10 text-gray-400'
                                  : 'bg-rose-500/20 text-rose-200'
                              }`}
                            >
                              {row.label}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white/5 rounded-xl p-5 mb-6 border border-white/10">
              <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
                <Zap size={18} className="text-yellow-400" />
                3) Key feedback
              </h2>
              <ul className="space-y-2 text-gray-300 text-sm">
                {(report.key_feedback || []).map((line, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-indigo-400">•</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 mb-6">
              <h2 className="text-emerald-200 font-semibold mb-2 flex items-center gap-2">
                <Award size={18} />
                4) Best attempt
              </h2>
              {report.best_attempt ? (
                <>
                  <p className="text-white text-lg font-medium">{report.best_attempt.text}</p>
                  <p className="text-emerald-300/90 text-sm mt-1">
                    Score {report.best_attempt.score}/100
                  </p>
                </>
              ) : (
                <p className="text-gray-500 text-sm">No scored attempts yet</p>
              )}
            </div>

            <div className="bg-white/5 rounded-xl p-5 mb-6 border border-white/10">
              <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
                <Heart size={18} className="text-pink-400" />
                Emotions (overview)
              </h2>
              <p className="text-gray-300 text-sm mb-2">
                Dominant:{' '}
                <span className="text-white capitalize">{report.dominantEmotion}</span>{' '}
                {EMOTION_EMOTICONS[report.dominantEmotion]}
                <span className="text-gray-500 text-xs ml-2">
                  ({report.avgConfidence}% avg confidence)
                </span>
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {Object.entries(report.emotionCounts).map(([emotion, count]) => (
                  <span
                    key={emotion}
                    className="text-xs px-2 py-1 rounded-full bg-white/10 text-gray-300 capitalize"
                  >
                    {emotion} {EMOTION_EMOTICONS[emotion]} {count}
                  </span>
                ))}
              </div>
            </div>

            <div className="bg-white/5 rounded-xl p-5 mb-6 border border-white/10">
              <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
                <Stethoscope size={18} className="text-sky-400" />
                Clinical notes
              </h2>
              <textarea
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                placeholder="Observations or recommendations…"
                className="w-full h-28 px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 resize-none text-sm"
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={downloadReport}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-lg text-white font-medium"
              >
                <Download size={20} />
                Download report
              </button>
              <button
                type="button"
                onClick={handleEmailReport}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 rounded-lg text-white font-medium"
              >
                <Mail size={20} />
                Email report
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowReport(false);
                  setAllPredictions([]);
                  setEmotionHistory([]);
                  setSessionNotes('');
                  setSessionDtwScores([]);
                  setLastDtwScore(null);
                }}
                className="px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
      </>
    );
  }

  if (selectedAppMode === 1) {
    return (
      <>
        {authBar}
        <InterviewMode onBack={() => setSelectedAppMode(null)} />
      </>
    );
  }

  if (selectedAppMode === 2) {
    return (
      <>
        {authBar}
        <UnpanicMode onBack={() => setSelectedAppMode(null)} />
      </>
    );
  }

  if (selectedAppMode === 3) {
    return (
      <>
        {authBar}
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-4 sm:p-8 flex flex-col items-center justify-center">
          <div className="max-w-lg text-center px-4">
            <h1 className="text-2xl font-bold text-white mb-2">Coming soon</h1>
            <p className="text-gray-400 mb-6">This mode is not available yet. Check back later.</p>
            <button
              type="button"
              onClick={() => setSelectedAppMode(null)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20"
            >
              <ArrowLeft size={18} />
              Back to modes
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {authBar}
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">

        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="bg-gradient-to-r from-blue-500 to-green-600 p-3 rounded-2xl">
              <Stethoscope size={32} className="text-white" />
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold text-white">
              Zariya
            </h1>
          </div>
          <p className="text-gray-300 text-lg">Your Speech Training Assistant </p>
          <p className="text-gray-400 text-sm mt-2">
          </p>
        </div>

        {errorMsg && (
          <div className="bg-red-900/50 backdrop-blur border border-red-500 rounded-lg p-4 mb-6 flex items-start gap-3">
            <AlertCircle className="text-red-400 flex-shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              <p className="text-red-200 font-medium">Error</p>
              <p className="text-red-300 text-sm">{errorMsg}</p>
              <button 
                onClick={testServerConnection} 
                className="mt-2 text-sm text-red-300 underline hover:text-red-100"
              >
                Retry Connection
              </button>
            </div>
            <button 
              onClick={() => setErrorMsg('')}
              className="text-red-400 hover:text-red-200"
            >
              ✕
            </button>
          </div>
        )}

        <div className="bg-white/10 backdrop-blur-md rounded-xl shadow-2xl border border-white/20 p-4 mb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${statusColor} animate-pulse`} />
                <span className="text-sm font-medium text-white">{statusText}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${faceDetected ? 'bg-green-500' : 'bg-gray-500'}`} />
                <span className="text-sm font-medium text-white">{faceDetected ? '👤 Face' : '⌀ No Face'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="text-blue-400" size={16} />
                <span className="text-sm font-medium text-white">Buffer: {bufferStatus}</span>
              </div>
              {isStreaming && (
                <>
                  <div className="flex items-center gap-2">
                    <Clock className="text-yellow-400" size={16} />
                    <span className="text-sm font-medium text-white">{formatDuration(sessionDuration)}</span>
                  </div>
                  <div className="flex items-center gap-2 bg-gradient-to-r from-purple-500/30 to-pink-500/30 px-3 py-1 rounded-full border border-purple-400/30">
                    <span className="text-3xl animate-pulse">{EMOTION_EMOTICONS[currentEmotion]}</span>
                    <div>
                      <span className="text-sm font-bold text-white capitalize">{currentEmotion}</span>
                      {emotionConfidence > 0 && (
                        <span className="text-xs text-gray-300 ml-1">({emotionConfidence}%)</span>
                      )}
                    </div>
                  </div>
                </>
              )}
             
              
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={playSessionTips}
                disabled={tipsLoading}
                className="flex items-center gap-2 px-5 py-2 rounded-lg font-medium transition-all border border-amber-400/50 bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Hear session tips (ElevenLabs)"
              >
                {tipsLoading ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Lightbulb size={20} />
                )}
                Tips
              </button>
              <button
                onClick={toggleCamera}
                className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-all transform hover:scale-105 ${
                  isStreaming 
                    ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/50' 
                    : 'bg-gradient-to-r from-blue-500 to-green-600 hover:from-blue-600 hover:to-green-700 text-white shadow-lg shadow-blue-500/50'
                }`}
              >
                {isStreaming ? (
                  <>
                    <Square size={20} />
                    Stop Session
                  </>
                ) : (
                  <>
                    <Camera size={20} />
                    Start Session
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="bg-black/30 rounded-lg p-3">
            <p className="text-xs text-gray-300 font-mono">
              {debugInfo || 'Waiting for connection...'}
            </p>
            {isStreaming && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-400">
                <span>📤 Frames: {framesSent}</span>
                <span>🎯 Predictions: {predictionsReceived}</span>
                <span>😊 Emotions: {emotionHistory.length} detected</span>
                {lastDtwScore != null && (
                  <span className="text-indigo-300">
                    📊 Last match: {lastDtwScore}/100
                  </span>
                )}
                {sessionAvgDtwLive != null && (
                  <span className="text-indigo-300/90">Session avg (DTW): {sessionAvgDtwLive}</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white/10 backdrop-blur-md rounded-xl shadow-2xl border border-white/20 p-4 mb-6">
          <h2 className="text-xl font-semibold mb-2 flex items-center gap-2 text-white">
            <ListChecks size={24} className="text-amber-400" />
            Template matching — calibration sentences
          </h2>
          <p className="text-sm text-gray-400 mb-4">
            Record each sentence once (lips open, clear articulation). After you stop, Zariya checks motion quality and tells you if you should record again. Use the same flow for all six sentences before live practice.
          </p>
          {calibrationMessage && (
            <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              {calibrationMessage}
            </div>
          )}
          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {calibrationSentences.length === 0 && (
              <p className="text-gray-500 text-sm">Connect to the server to load calibration prompts.</p>
            )}
            {calibrationSentences.map((row) => (
              <div
                key={row.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-white/10 bg-black/20 p-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 font-mono">{row.id}</p>
                  <p className="text-white text-sm">{row.text}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {row.recorded ? `✓ Saved (${row.template_count} take${row.template_count !== 1 ? 's' : ''})` : 'Not recorded yet'}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {recordingSentenceId === row.id ? (
                    <button
                      type="button"
                      onClick={stopCalibrationRecord}
                      disabled={calibrationBusy}
                      className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-50"
                    >
                      Stop &amp; save
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => beginCalibrationRecord(row.id)}
                      disabled={calibrationBusy || !!recordingSentenceId}
                      className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50"
                    >
                      Record
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-white/10 backdrop-blur-md rounded-xl shadow-2xl border border-white/20 p-4">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 text-white">
              <Camera size={24} className="text-blue-400" />
              Live Camera Feed
            </h2>
            <div className="relative bg-black rounded-lg overflow-hidden aspect-video shadow-inner">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="w-full h-full object-cover" 
              />
              <canvas 
                ref={overlayRef} 
                className="absolute inset-0 w-full h-full pointer-events-none" 
              />
              {!isStreaming && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50">
                  <div className="text-center">
                    <Camera size={64} className="text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400 text-lg">Camera Inactive</p>
                    <p className="text-gray-500 text-sm">Click "Start Session" above</p>
                  </div>
                </div>
              )}
              {isStreaming && !faceDetected && (
                <div className="absolute top-4 left-4 bg-yellow-500/90 backdrop-blur text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg">
                  ⚠ Position your face in frame
                </div>
              )}
              {isStreaming && faceDetected && isWaitingForMovement && (
                <div className="absolute top-4 left-4 bg-blue-500/90 backdrop-blur text-white px-4 py-2 rounded-lg text-sm font-medium animate-pulse shadow-lg">
                  👄 Speak with clear lip movements
                </div>
              )}
              {isStreaming && faceDetected && (
                <div className="absolute top-4 right-4 bg-gradient-to-r from-purple-500/90 to-pink-500/90 backdrop-blur text-white px-4 py-3 rounded-xl shadow-2xl border border-white/20">
                  <div className="flex items-center gap-3">
                    <span className="text-5xl animate-bounce">{EMOTION_EMOTICONS[currentEmotion]}</span>
                    <div>
                      <p className="text-xs font-medium opacity-80">Current Emotion</p>
                      <p className="text-lg font-bold capitalize">{currentEmotion}</p>
                      {emotionConfidence > 0 && (
                        <p className="text-xs opacity-70">Confidence: {emotionConfidence}%</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white/10 backdrop-blur-md rounded-xl shadow-2xl border border-white/20 p-4">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 text-white">
              <Mic size={24} className="text-purple-400" />
              Mouth Region (96×96)
            </h2>
            <div className="relative bg-black rounded-lg overflow-hidden aspect-video flex items-center justify-center shadow-inner">
              {mouthRoi ? (
                <div className="relative">
                  <img 
                    src={mouthRoi} 
                    alt="Mouth ROI" 
                    className="max-w-full max-h-full object-contain border-4 border-green-500 rounded shadow-lg shadow-green-500/50" 
                  />
                  <div className="absolute -top-2 -right-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full font-bold">
                    ✓ LOCKED
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <Mic size={64} className="text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400 text-lg">
                    {isStreaming ? 'Detecting mouth...' : 'Camera not active'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white/10 backdrop-blur-md rounded-xl shadow-2xl border border-white/20 p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 text-white">
            <Volume2 size={24} className="text-green-400" />
            Latest Prediction
          </h2>
          <div className="bg-gradient-to-r from-blue-500/20 to-purple-600/20 rounded-xl p-8 min-h-[140px] flex items-center justify-center border border-white/10">
            {prediction ? (
              <div className="text-center">
                <p className="text-4xl font-bold text-white mb-3 animate-pulse">{prediction}</p>
                <div className="flex flex-col items-center gap-2 text-sm text-gray-300">
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    {lastDtwScore != null && (
                      <span className="bg-indigo-500/35 text-indigo-100 px-3 py-1 rounded-full text-xs font-medium">
                        DTW {lastDtwScore}/100
                      </span>
                    )}
                    <span className="bg-green-500/30 px-3 py-1 rounded-full">
                      Prediction #{predictionsReceived}
                    </span>
                    <span className="bg-blue-500/30 px-3 py-1 rounded-full">
                      {{
                        lip_camera_template: 'Lip template match (camera ROI)',
                        lip_camera_mock: 'Mock lip match (camera ROI)',
                        lip_camera_avhubert: 'AV-HuBERT lip (camera ROI)',
                      }[predictionSource] || 'Camera mouth ROI'}
                    </span>
                    <span className="text-2xl">{EMOTION_EMOTICONS[currentEmotion]}</span>
                  </div>
                  <p className="text-xs text-gray-500 max-w-md text-center">
                    TTS off — label comes only from video frames sent to /process_frame (no microphone for text).
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-gray-400 text-lg italic">
                {isStreaming ? '🎤 Listening... speak clearly' : '▶ Start session to begin'}
              </p>
            )}
          </div>
        </div>

        {allPredictions.length > 0 && (
          <div className="bg-white/10 backdrop-blur-md rounded-xl shadow-2xl border border-white/20 p-6 mb-6">
            <h3 className="text-lg font-semibold mb-4 text-white flex items-center justify-between">
              <span>📜 Recent Predictions with Emotions</span>
              <span className="text-sm text-gray-400">{allPredictions.length} total</span>
            </h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {allPredictions.slice(0, 10).map((pred) => (
                <div 
                  key={pred.id} 
                  className="bg-black/30 rounded-lg p-3 flex items-center justify-between hover:bg-black/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{EMOTION_EMOTICONS[pred.emotion]}</span>
                    <div>
                      <span className="text-gray-300 font-medium">{pred.text}</span>
                      <p className="text-xs text-gray-500">
                        {new Date(pred.timestamp).toLocaleTimeString()} • {pred.emotion} ({pred.emotionConfidence}%)
                        {typeof pred.dtwScore === 'number' && (
                          <span className="text-indigo-400 ml-1">· DTW {pred.dtwScore}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500">#{pred.id}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-gradient-to-r from-blue-500/20 to-green-500/20 backdrop-blur border border-blue-400/30 rounded-xl p-6">
          <h3 className="font-semibold text-blue-200 mb-3 text-lg flex items-center gap-2">
            <Stethoscope size={20} />
            Medical Usage Instructions
          </h3>
          <div className="grid sm:grid-cols-2 gap-4 text-sm text-blue-100">
            <div>
              <p className="font-semibold mb-2">✓ For Healthcare Providers:</p>
              <ul className="space-y-1 text-blue-200">
                <li>• Monitor patient speech rehabilitation progress</li>
                <li>• Track emotional states with ML detection (DeepFace Model)</li>
                <li>• Generate detailed practice reports with emotion data</li>
                <li>• Document clinical observations</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold mb-2">✓ For Patients:</p>
              <ul className="space-y-1 text-blue-200">
                <li>• Practice speech with visual feedback</li>
                <li>• Exaggerate lip movements clearly</li>
                <li>• Speak slowly and pause between phrases</li>
                <li>• Review progress in session reports</li>
              </ul>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-blue-400/20">
            <p className="text-xs text-blue-300">
              <strong>ML-Based Emotion Detection:</strong> This system uses Deepface, a tensorflow model
              running on the Python backend server. Your emotions are analyzed every 5 seconds during the session 
              to track engagement, comfort, and emotional state. The ML model processes facial expressions 
              server-side and sends results to your browser.
              {emotionDetectionStatus !== 'ready' && ' (Currently unavailable - check server console)'}
            </p>
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
    </>
  );
}