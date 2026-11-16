/* ==========================================================================
   Wave Focus — store screenshots at real iPhone size (390x844 @3x → 1170x2532)
   Uses the Chrome DevTools Protocol, so no npm dependencies are needed.

   Usage (from the pwa folder, with server.mjs already running):
     node tools/capture-screenshots.mjs [baseUrl]
   ========================================================================== */

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:4173';
const PORT = 9333;
const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = fileURLToPath(new URL('../screenshots/', import.meta.url));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await mkdir(OUT, { recursive: true });

const profile = await mkdtemp(join(tmpdir(), 'wavefocus-shot-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const cleanup = () => { try { chrome.kill(); } catch { /* already gone */ } };
process.on('exit', cleanup);

async function browserWs() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('Chrome DevTools endpoint did not start');
}

const ws = new WebSocket(await browserWs());
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const events = [];

ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  events.push(message);
});

function send(method, params = {}, sessionId) {
  const id = nextId;
  nextId += 1;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const call = (method, params) => send(method, params, sessionId);

await call('Page.enable');
await call('Runtime.enable');
await call('Log.enable');
await call('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true,
  screenOrientation: { type: 'portraitPrimary', angle: 0 },
});
await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const problems = [];
events.push = new Proxy(events.push, {
  apply(target, thisArg, args) {
    const message = args[0];
    if (message.method === 'Runtime.exceptionThrown') {
      problems.push(message.params.exceptionDetails?.exception?.description || 'exception');
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      problems.push(`${message.params.entry.text} ${message.params.entry.url || ''}`);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      problems.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    return Reflect.apply(target, thisArg, args);
  },
});

async function go(url) {
  const loaded = new Promise((resolve) => {
    const check = setInterval(() => {
      const hit = events.find((m) => m.method === 'Page.loadEventFired');
      if (hit) { clearInterval(check); resolve(); }
    }, 100);
    setTimeout(() => { clearInterval(check); resolve(); }, 15000);
  });
  events.length = 0;
  await call('Page.navigate', { url });
  await loaded;
  await sleep(900);
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails;
    throw new Error(detail.exception?.description || detail.text || 'evaluate failed');
  }
  return result.result.value;
}

// 1. Load once and accept the welcome sheet; that first commit persists the
// full demo state (tasks, notes, boards, quests) with stable ids.
await go(`${BASE}/index.html?tab=routine`);

await evaluate(`document.querySelector('[data-welcome-start]')?.click(); true;`);
await sleep(500);

await evaluate(`(() => {
  const key = 'wavefocus.pwa.v2';
  const state = JSON.parse(localStorage.getItem(key));
  const ids = (state.tasks || []).map((t) => t.id);
  const iso = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  state.completions = state.completions || {};
  state.sessions = state.sessions || [];
  state.settings = { ...state.settings, theme: 'dark', lang: 'en', edition: 'standard', onboarded: true };
  const ratios = [1, 0.8, 1, 0.66, 0.83, 1, 0.5, 0.83, 0.66, 1, 0.83, 0.5, 0.66, 1];
  ratios.forEach((ratio, offset) => {
    const date = iso(offset + 1);
    const count = Math.max(1, Math.round(ids.length * ratio));
    state.completions[date] = ids.slice(0, count);
  });
  state.completions[iso(0)] = ids.slice(0, 3);
  [2400, 1500, 3000, 1800, 2700, 1200, 3300].forEach((seconds, offset) => {
    state.sessions.push({
      id: 'seed_s' + offset,
      date: iso(offset),
      seconds,
      mode: offset % 2 ? 'deep' : 'pomodoro',
      startedAt: Date.now() - (offset + 1) * 86400000,
      endedAt: Date.now() - (offset + 1) * 86400000 + seconds * 1000,
    });
  });
  state.quests = (state.quests || []).map((q, i) => ({ ...q, done: i === 0 ? false : q.done }));
  localStorage.setItem(key, JSON.stringify(state));
  // The app flushes its in-memory state on pagehide, which would undo the demo
  // data above; block those writes for the one navigation we are about to do.
  Storage.prototype.setItem = function () {};
  return true;
})()`);

await go(`${BASE}/index.html?tab=routine`);

const debugState = await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('wavefocus.pwa.v2'));
  return { tasks: (s.tasks || []).length, notes: (s.notes || []).length, boards: (s.boards || []).length,
    completions: Object.keys(s.completions || {}).length, sessions: (s.sessions || []).length };
})()`);
console.log('demo data:', debugState);

const FREEZE = `(() => {
  if (!document.getElementById('qa-freeze')) {
    const style = document.createElement('style');
    style.id = 'qa-freeze';
    style.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}'
      + '.topbar,.sheet-backdrop{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}';
    document.head.appendChild(style);
  }
  document.getElementById('bootSplash')?.remove();
  document.getElementById('installHost')?.remove();
  document.getElementById('toastHost')?.replaceChildren();
  return true;
})()`;

async function shot(name) {
  await evaluate(FREEZE);
  await sleep(350);
  const { data } = await call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`captured screenshots/${name}.png`);
}

async function tab(name) {
  await evaluate(`document.querySelector('.tab[data-tab="${name}"]')?.click(); true;`);
  await sleep(650);
}

await shot('routine');
await tab('focus');
await shot('focus');
// Progress lives behind the "More" sheet, so switch screens through the URL.
await go(`${BASE}/index.html?tab=progress`);
await shot('progress');
await tab('schedule');
await shot('schedule');
await tab('notes');
await shot('notes');

if (problems.length) {
  console.warn('\nConsole problems:');
  problems.forEach((p) => console.warn(' -', p));
} else {
  console.log('\nNo console errors during capture.');
}

ws.close();
chrome.kill();
