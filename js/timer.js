/* ==========================================================================
   Focus timer engine
   Timestamp-based so it stays accurate while the app is backgrounded, and it
   survives reloads (state is persisted in localStorage).
   ========================================================================== */

import { addSession, saveNow, state, taskById } from './store.js';
import { toast } from './ui.js';
import { t } from './i18n.js';
import { todayISO } from './dates.js';

const KEY = 'wavefocus.timer.v1';

export const MODES = {
  pomodoro: { minutes: 25, label: 'pomodoro', track: true },
  deepWork: { minutes: 50, label: 'deepWork', track: true },
  shortBreak: { minutes: 5, label: 'shortBreak', track: false },
  custom: { minutes: 30, label: 'custom', track: true },
  stopwatch: { minutes: 0, label: 'stopwatch', track: true },
};

const defaults = () => ({
  mode: 'pomodoro',
  running: false,
  duration: MODES.pomodoro.minutes * 60,
  remaining: MODES.pomodoro.minutes * 60,
  endsAt: null,
  startedAt: null,
  elapsed: 0,
  linkedTaskId: null,
  customMinutes: 30,
  lastCompletion: null,
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const parsed = { ...defaults(), ...JSON.parse(raw) };
    return parsed;
  } catch {
    return defaults();
  }
}

export const timer = load();

const listeners = new Set();
let interval = null;
let audioCtx = null;
let wakeLock = null;
let completionHandler = null;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  const snapshot = getSnapshot();
  listeners.forEach((fn) => {
    try { fn(snapshot); } catch (err) { console.error(err); }
  });
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(timer));
  } catch { /* storage may be unavailable */ }
}

export function getSnapshot() {
  const now = Date.now();
  let remaining = timer.remaining;
  let elapsed = timer.elapsed;
  if (timer.mode === 'stopwatch') {
    elapsed = timer.elapsed + (timer.running && timer.startedAt ? Math.floor((now - timer.startedAt) / 1000) : 0);
    remaining = elapsed;
  } else if (timer.running && timer.endsAt) {
    remaining = Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
  }
  return {
    mode: timer.mode,
    running: timer.running,
    duration: timer.duration,
    remaining,
    elapsed,
    total: timer.mode === 'stopwatch' ? elapsed : timer.duration,
    linkedTaskId: timer.linkedTaskId,
    linkedTask: timer.linkedTaskId ? taskById(timer.linkedTaskId) : null,
    customMinutes: timer.customMinutes,
    progress: timer.mode === 'stopwatch'
      ? 0
      : timer.duration > 0 ? Math.min(1, Math.max(0, remaining / timer.duration)) : 0,
    lastCompletion: timer.lastCompletion,
  };
}

export function isRunning() {
  return timer.running;
}

export function setMode(mode) {
  if (!MODES[mode]) return;
  if (timer.mode === 'stopwatch' && timer.running) {
    // stop the stopwatch before switching modes
    finishStopwatch({ silent: true });
  }
  timer.mode = mode;
  timer.running = false;
  timer.endsAt = null;
  timer.startedAt = null;
  timer.elapsed = 0;
  timer.remaining = durationFor(mode);
  timer.duration = timer.remaining;
  persist();
  emit();
}

export function durationFor(mode) {
  if (mode === 'custom') return Math.max(60, (Number(timer.customMinutes) || 30) * 60);
  return (MODES[mode]?.minutes || 25) * 60;
}

export function setCustomMinutes(minutes) {
  const value = Math.max(1, Math.min(180, Math.round(Number(minutes) || 30)));
  timer.customMinutes = value;
  if (timer.mode === 'custom') {
    timer.running = false;
    timer.endsAt = null;
    timer.duration = value * 60;
    timer.remaining = value * 60;
  }
  persist();
  emit();
}

export function adjust(minutes) {
  if (timer.mode === 'stopwatch') return;
  const delta = Math.round(minutes) * 60;
  if (timer.running && timer.endsAt) {
    timer.endsAt = Math.max(Date.now() + 1000, timer.endsAt + delta * 1000);
    timer.duration = Math.max(60, timer.duration + delta);
    timer.remaining = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
  } else {
    timer.duration = Math.max(60, timer.duration + delta);
    timer.remaining = Math.max(0, timer.remaining + delta);
    if (timer.remaining > timer.duration) timer.remaining = timer.duration;
  }
  if (timer.mode !== 'custom' && timer.mode !== 'stopwatch') {
    // keep preset modes as-is; adjustments are session-specific
  }
  persist();
  emit();
}

export function linkTask(taskId) {
  timer.linkedTaskId = taskId || null;
  persist();
  emit();
}

export async function start() {
  if (timer.running) return;
  if (timer.mode === 'stopwatch') {
    timer.startedAt = Date.now();
    timer.running = true;
  } else {
    if (timer.remaining <= 0) timer.remaining = durationFor(timer.mode);
    timer.endsAt = Date.now() + timer.remaining * 1000;
    timer.duration = Math.max(timer.duration, timer.remaining);
    timer.running = true;
  }
  timer.lastCompletion = null;
  persist();
  unlockAudio();
  await requestWakeLock();
  emit();
  startLoop();
}

export function pause() {
  if (!timer.running) return;
  if (timer.mode === 'stopwatch') {
    timer.elapsed += timer.startedAt ? Math.floor((Date.now() - timer.startedAt) / 1000) : 0;
    timer.startedAt = null;
  } else if (timer.endsAt) {
    timer.remaining = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
    timer.endsAt = null;
  }
  timer.running = false;
  persist();
  releaseWakeLock();
  emit();
}

export function reset() {
  if (timer.mode === 'stopwatch') {
    timer.elapsed = 0;
    timer.startedAt = timer.running ? Date.now() : null;
    timer.remaining = 0;
  } else {
    timer.duration = durationFor(timer.mode);
    timer.remaining = timer.duration;
    timer.endsAt = null;
    timer.running = false;
  }
  persist();
  releaseWakeLock();
  emit();
}

export function finishStopwatch({ silent = false } = {}) {
  const snapshot = getSnapshot();
  const seconds = snapshot.elapsed;
  if (seconds >= 60) {
    recordSession(seconds, 'Stopwatch');
  } else if (!silent) {
    toast(t('sessionSaved'));
  }
  timer.elapsed = 0;
  timer.startedAt = null;
  timer.running = false;
  timer.remaining = 0;
  persist();
  releaseWakeLock();
  emit();
}

function recordSession(seconds, modeLabel) {
  const linked = timer.linkedTaskId ? taskById(timer.linkedTaskId) : null;
  addSession({
    seconds,
    mode: modeLabel,
    taskId: linked ? linked.id : null,
    taskTitle: linked ? linked.title : '',
    date: todayISO(),
  });
}

function completeCountdown() {
  const duration = timer.duration;
  const isBreak = timer.mode === 'shortBreak';
  const modeLabel = isBreak ? 'Short break' : MODES[timer.mode]?.label || timer.mode;

  timer.running = false;
  timer.endsAt = null;
  timer.remaining = duration;
  timer.lastCompletion = { at: Date.now(), mode: timer.mode };
  persist();
  releaseWakeLock();

  if (!isBreak) recordSession(duration, modeLabel);

  playChime(isBreak);
  vibrate([90, 60, 90]);
  const message = isBreak ? t('breakComplete') : t('focusComplete');
  toast(message, { duration: 4200 });
  notify(message);
  emit();
  if (typeof completionHandler === 'function') completionHandler({ mode: timer.mode, duration });
}

export function onComplete(fn) {
  completionHandler = fn;
}

/* --------------------------------- loop --------------------------------- */

function startLoop() {
  if (interval) return;
  interval = setInterval(() => {
    if (!timer.running) return;
    const snapshot = getSnapshot();
    if (timer.mode !== 'stopwatch' && snapshot.remaining <= 0) {
      completeCountdown();
      return;
    }
    emit();
  }, 500);
}

export function initTimer() {
  startLoop();
  // Reconcile after a reload / background freeze.
  if (timer.running) {
    if (timer.mode !== 'stopwatch' && (!timer.endsAt || timer.endsAt - Date.now() <= 0)) {
      completeCountdown();
    } else {
      requestWakeLock();
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const snapshot = getSnapshot();
      if (timer.running && timer.mode !== 'stopwatch' && snapshot.remaining <= 0) completeCountdown();
      if (timer.running) requestWakeLock();
    }
  });
  emit();
}

/* ------------------------------ wake lock -------------------------------- */

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || !timer.running) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    try { wakeLock.release(); } catch { /* ignore */ }
    wakeLock = null;
  }
}

/* -------------------------------- audio ---------------------------------- */

function unlockAudio() {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* audio is a nice-to-have */ }
}

function playChime(isBreak) {
  try {
    unlockAudio();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const notes = isBreak ? [523.25, 659.25] : [523.25, 783.99, 1046.5];
    notes.forEach((freq, index) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const startAt = now + index * 0.18;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.16, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.5);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(startAt);
      osc.stop(startAt + 0.55);
    });
  } catch { /* ignore */ }
}

function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* ignore */ }
}

function notify(body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const linked = timer.linkedTaskId ? taskById(timer.linkedTaskId) : null;
    new Notification(linked ? `${t('focusComplete')} · ${linked.title}` : t('focusComplete'), {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'wavefocus-timer',
      renotify: true,
    });
  } catch { /* notifications not available (e.g. iOS browser tab) */ }
}

/** Force a save of the whole app state (used before unload). */
export function flush() {
  saveNow();
  persist();
}

export const settings = state.settings;
