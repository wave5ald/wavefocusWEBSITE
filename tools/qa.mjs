/* ==========================================================================
   Wave Focus — scripted mobile QA pass (Chrome DevTools Protocol).
   Exercises the real UI: install onboarding, task CRUD, theme, RTL, timer,
   progress and offline reload. Screenshots land in the OS temp folder.

   Usage (from the pwa folder, with server.mjs already running):
     node tools/qa.mjs [baseUrl]
   ========================================================================== */

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:4173';
const PORT = 9334;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = join(tmpdir(), 'wavefocus-qa');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(SHOTS, { recursive: true });

const profile = await mkdtemp(join(tmpdir(), 'wavefocus-qa-profile-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch { /* gone */ } };
process.on('exit', cleanup);

async function browserWs() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch { /* booting */ }
    await sleep(150);
  }
  throw new Error('Chrome did not start');
}

const ws = new WebSocket(await browserWs());
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const errors = [];
const loadWaiters = [];

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push(`${msg.params.entry.text} ${msg.params.entry.url || ''}`);
  }
  if (msg.method === 'Page.loadEventFired') {
    while (loadWaiters.length) loadWaiters.shift()();
  }
});

function send(method, params = {}, sessionId) {
  const id = nextId;
  nextId += 1;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const call = (m, p) => send(m, p, sessionId);

await call('Page.enable');
await call('Runtime.enable');
await call('Log.enable');
await call('Network.enable');
await call('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  screenOrientation: { type: 'portraitPrimary', angle: 0 },
});
await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function go(url, settle = 900) {
  const loaded = new Promise((resolve) => {
    loadWaiters.push(resolve);
    setTimeout(resolve, 15000);
  });
  await call('Page.navigate', { url });
  await loaded;
  await sleep(settle);
}

async function click(selector) {
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  await sleep(260);
  return ok;
}

async function freezeChrome() {
  await evaluate(`(() => {
    if (!document.getElementById('qa-freeze')) {
      const s = document.createElement('style');
      s.id = 'qa-freeze';
      s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}'
      + 'html{scroll-behavior:auto!important}'
      + '.topbar,.sheet-backdrop{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}';
      document.head.appendChild(s);
    }
    document.getElementById('bootSplash')?.remove();
    document.getElementById('installHost')?.remove();
    document.getElementById('toastHost')?.replaceChildren();
    return true;
  })()`);
}

async function shot(name) {
  await freezeChrome();
  await sleep(200);
  const { data } = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  screenshot ${join(SHOTS, `${name}.png`)}`);
}

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------- 1. boot --------------------------------- */
await go(`${BASE}/index.html`);

const manifestInfo = await call('Page.getAppManifest');
check('manifest parses', !manifestInfo.errors?.length, manifestInfo.errors?.map((e) => e.message).join('; ') || manifestInfo.url);
const installability = await call('Page.getInstallabilityErrors').catch(() => ({ installabilityErrors: [] }));
const installErrors = installability.installabilityErrors || [];
check('installability errors', installErrors.length === 0, installErrors.map((e) => e.errorId).join(', '));

check('app shell renders', await evaluate(`document.querySelectorAll('.task').length > 0`));
check('welcome sheet shown on first run', await evaluate(`Boolean(document.querySelector('[data-welcome-start]'))`));
await shot('01-welcome');
await click('[data-welcome-start]');
await sleep(400);
await freezeChrome();

/* ----------------------------- 2. task CRUD ------------------------------ */
const before = await evaluate(`document.querySelectorAll('.task').length`);
await click('#fab');
check('add-task sheet opens', await evaluate(`Boolean(document.querySelector('#taskForm'))`));
await evaluate(`(() => {
  document.querySelector('#taskTitle').value = 'QA test task';
  document.querySelector('#taskMinutes').value = '15';
  document.querySelector('[form="taskForm"][type="submit"]').click();
  return true;
})()`);
await sleep(500);
const after = await evaluate(`document.querySelectorAll('.task').length`);
check('task added', after === before + 1, `${before} → ${after}`);
await shot('02-task-added');

const taskId = await evaluate(`(() => {
  const card = [...document.querySelectorAll('.task')].find((el) => el.textContent.includes('QA test task'));
  return card ? card.dataset.task : null;
})()`);
check('new task persisted', Boolean(taskId));

await evaluate(`document.querySelector('[data-toggle="${taskId}"]').click(); true;`);
await sleep(400);
check('task toggles complete', await evaluate(`document.querySelector('[data-toggle="${taskId}"]').getAttribute('aria-checked') === 'true'`));

await click(`[data-task="${taskId}"] [data-edit]`);
check('edit sheet opens with values', await evaluate(`document.querySelector('#taskTitle').value === 'QA test task'`));
await evaluate(`(() => {
  document.querySelector('#taskTitle').value = 'QA task edited';
  document.querySelector('[form="taskForm"][type="submit"]').click();
  return true;
})()`);
await sleep(450);
check('task renamed', await evaluate(`[...document.querySelectorAll('.task')].some((el) => el.textContent.includes('QA task edited'))`));

/* --------------------------- 3. theme and RTL ---------------------------- */
await click('#moreBtn');
check('more sheet opens', await evaluate(`Boolean(document.querySelector('[data-go="settings"]'))`));
await shot('03-more-sheet');
await click('[data-go="progress"]');
check('progress reachable from More', await evaluate(`document.querySelector('#screenTitle').textContent === 'Progress'`));
await shot('03-progress');
await evaluate(`window.scrollTo(0, document.body.scrollHeight); true;`);
await sleep(350);
await shot('03b-progress-bottom');
await evaluate(`window.scrollTo(0, 0); true;`);
await sleep(250);

await click('#moreBtn');
await click('[data-go="settings"]');
const syncText = await evaluate(`document.querySelector('#syncBox')?.textContent.replace(/\\s+/g, ' ').trim() || ''`);
check('cloud sync section renders', syncText.length > 0, syncText);
await click('[data-theme-choice="light"]');
await sleep(450);
check('light theme applies', await evaluate(`document.getElementById('app').dataset.theme === 'light'`));
await shot('04-settings-light');

await click('[data-lang-choice="ar"]');
await sleep(600);
check('Arabic switches direction', await evaluate(`document.documentElement.dir === 'rtl'`));
check('Arabic strings applied', await evaluate(`/[\\u0600-\\u06FF]/.test(document.getElementById('screenTitle').textContent + document.body.textContent)`));
await shot('05-settings-arabic');

await click('[data-theme-choice="dark"]');
await sleep(450);
check('dark theme applies', await evaluate(`document.getElementById('app').dataset.theme === 'dark'`));
await shot('06-settings-arabic-dark');
await click('[data-sheet-close]');
await shot('07-routine-arabic-dark');
await click('#langBtn');
await sleep(450);
check('back to English + dark', await evaluate(`document.documentElement.dir === 'ltr' && document.getElementById('app').dataset.theme === 'dark'`));

/* --------------------------- 3b. Hijri calendar -------------------------- */
await click('.tab[data-tab="schedule"]');
await shot('06b-schedule-standard');
const calMarks = await evaluate(`(() => {
  const cells = [...document.querySelectorAll('.cal__cell:not(.is-out)')];
  const todayCell = cells.find((c) => c.classList.contains('is-today'));
  return {
    cells: cells.length,
    taskDays: cells.filter((c) => c.querySelector('.cal__dot--tasks')).length,
    todayDots: todayCell ? todayCell.querySelectorAll('.cal__dot').length : 0,
    todayExtra: Boolean(todayCell && todayCell.querySelector('.cal__dot--extra')),
  };
})()`);
check('calendar dots — task days marked', calMarks.cells > 0 && calMarks.taskDays === calMarks.cells, `${calMarks.taskDays}/${calMarks.cells}`);
check('calendar dots — quest/note day gets a second dot', calMarks.todayDots === 2 && calMarks.todayExtra, `${calMarks.todayDots} dots`);
await click('#editionBtn');
await sleep(520);
const hijriTitle = await evaluate(`document.querySelector('.card__title')?.textContent.trim() || ''`);
check('hijri month title', /\d{4}\s*(AH|هـ)$/.test(hijriTitle), hijriTitle);
const hijriDays = await evaluate(`[...document.querySelectorAll('.cal__cell:not(.is-out)')].map((c) => Number(c.textContent.trim()))`);
check('hijri grid shows a full month', hijriDays.length >= 29 && hijriDays.length <= 30 && hijriDays[0] === 1 && hijriDays.every((n, i) => n === i + 1), `${hijriDays.length} days`);
const chipLabel = await evaluate(`document.getElementById('editionLabel').textContent.trim()`);
check('edition chip shows current edition', chipLabel === 'Hijri', chipLabel);
await click('[data-month="1"]');
await sleep(420);
const nextHijriTitle = await evaluate(`document.querySelector('.card__title')?.textContent.trim() || ''`);
check('hijri month navigation', nextHijriTitle !== hijriTitle && /AH$/.test(nextHijriTitle), `${hijriTitle} → ${nextHijriTitle}`);
await click('#editionBtn');
await sleep(420);
const backTitle = await evaluate(`document.querySelector('.card__title')?.textContent.trim() || ''`);
check('standard calendar restored', !/AH$/.test(backTitle), backTitle);

/* ------------------------------- 4. timer -------------------------------- */
await click('.tab[data-tab="focus"]');
check('focus tab opens', await evaluate(`Boolean(document.querySelector('#timerTime'))`));
await click('[data-toggle-timer]');
await sleep(2400);
const tick = await evaluate(`document.querySelector('#timerTime').textContent`);
check('timer counts down', tick !== '25:00', tick);
await click('[data-toggle-timer]');
const paused = await evaluate(`document.querySelector('#timerTime').textContent`);
await sleep(1200);
check('timer pauses', (await evaluate(`document.querySelector('#timerTime').textContent`)) === paused, paused);
await shot('07-focus-running');
await evaluate(`window.scrollTo(0, document.body.scrollHeight); true;`);
await sleep(350);
await shot('07b-focus-bottom');
await evaluate(`window.scrollTo(0, 0); true;`);
await sleep(250);
await shot('07c-focus-top-again');
await click('[data-reset]');

/* ------------------------------ 5. offline ------------------------------- */
await call('Network.emulateNetworkConditions', {
  offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
});
await evaluate(`window.dispatchEvent(new Event('offline')); true;`);
check('offline banner appears', await evaluate(`!document.getElementById('offlineBanner').hidden`));
await go(`${BASE}/index.html?tab=routine`, 1400);
check('shell still renders offline', await evaluate(`document.querySelectorAll('.tab').length === 4 && document.querySelector('#screen').textContent.trim().length > 50`));
check('offline banner shown after reload', await evaluate(`!document.getElementById('offlineBanner').hidden`));
await shot('08-offline');

await call('Network.emulateNetworkConditions', {
  offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
});
await evaluate(`window.dispatchEvent(new Event('online')); true;`);
await sleep(300);
check('reconnects online', await evaluate(`document.getElementById('offlineBanner').hidden`));

/* ------------------------------ 6. cleanup ------------------------------- */
await click(`[data-task="${taskId}"] [data-edit]`);
await click('[data-delete]');
await click('[data-confirm-ok]');
await sleep(500);
check('task deleted', await evaluate(`![...document.querySelectorAll('.task')].some((el) => el.textContent.includes('QA task edited'))`));

const remaining = await evaluate(`document.querySelectorAll('.task').length`);
check('demo tasks intact after cleanup', remaining === before, `${remaining} tasks`);

await click('.tab[data-tab="notes"]');
await click('[data-note-tab="boards"]');
check('boards tab opens', await evaluate(`Boolean(document.querySelector('.board-tile'))`));
await shot('09-boards');

console.log(errors.length ? `\nConsole errors (${errors.length}):` : '\nNo console errors.');
errors.forEach((e) => console.log(' -', e));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);

ws.close();
chrome.kill();
process.exitCode = failed.length || errors.length ? 1 : 0;
