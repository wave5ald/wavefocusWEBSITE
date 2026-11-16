/* Focus screen — Pomodoro, Deep Work, breaks, custom countdown and stopwatch. */

import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { formatClock, formatDuration, todayISO } from '../dates.js';
import { dueTasks, sessionsFor, totalFocusSeconds, ui } from '../store.js';
import { escapeAttr, escapeHtml, haptic, openSheet, toast } from '../ui.js';
import {
  adjust, finishStopwatch, getSnapshot, linkTask, MODES, pause, reset, setCustomMinutes, setMode,
  start, subscribe as subscribeTimer, timer,
} from '../timer.js';

const MODE_ORDER = [
  ['pomodoro', 'pomodoro'],
  ['deepWork', 'deepWork'],
  ['shortBreak', 'shortBreak'],
  ['custom', 'custom'],
  ['stopwatch', 'stopwatch'],
];

let unsubscribe = null;

export const fab = null;

export function render() {
  const snapshot = getSnapshot();
  const today = todayISO();
  const sessions = sessionsFor(today);
  const totalSeconds = totalFocusSeconds(today);
  const tasks = dueTasks(today);
  const linked = snapshot.linkedTask;
  const isStopwatch = snapshot.mode === 'stopwatch';
  const circumference = 2 * Math.PI * 45;
  const offset = circumference * (1 - (isStopwatch ? 1 : snapshot.progress));
  const needsNotifications = 'Notification' in window && Notification.permission === 'default';

  return `
    <div class="stack">
      <section class="card card--hero timer-card">
        <div class="timer-wrap">
          <div class="timer ${snapshot.running ? '' : 'is-paused'}" id="timerRoot">
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <defs>
                <linearGradient id="timerGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#38BDF8"/>
                  <stop offset="100%" stop-color="#818CF8"/>
                </linearGradient>
              </defs>
              <circle class="timer__track" cx="50" cy="50" r="45"/>
              <circle class="timer__bar" id="timerBar" cx="50" cy="50" r="45"
                      stroke-dasharray="${circumference.toFixed(2)}"
                      stroke-dashoffset="${offset.toFixed(2)}"/>
            </svg>
            <div class="timer__center">
              <span class="timer__mode" id="timerModeLabel">${escapeHtml(t(MODES[snapshot.mode].label))}</span>
              <span class="timer__time tabular" id="timerTime">${formatClock(isStopwatch ? snapshot.elapsed : snapshot.remaining)}</span>
              <span class="timer__state" id="timerState">${escapeHtml(stateLabel(snapshot))}</span>
              <span class="tiny muted" id="timerLinked" style="max-width:78%;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${linked ? escapeHtml(linked.title) : ''}
              </span>
            </div>
          </div>

          <div class="mode-grid">
            ${MODE_ORDER.map(([mode, key]) => `
              <button class="filter ${snapshot.mode === mode ? 'is-active' : ''}" type="button" data-mode="${mode}">
                ${escapeHtml(t(key))}
              </button>`).join('')}
          </div>

          ${isStopwatch ? '' : `
            <div class="row" style="justify-content:center;gap:14px">
              <button class="round-btn" type="button" data-adjust="-5" aria-label="${t('subtractFive')}">${icon('minus')}</button>
              <button class="chip chip--ghost" type="button" data-duration style="min-height:38px;font-size:.8rem">
                ${icon('clock')}<span id="durationLabel">${Math.round(snapshot.duration / 60)} ${t('min')}</span>
              </button>
              <button class="round-btn" type="button" data-adjust="5" aria-label="${t('addFive')}">${icon('plus')}</button>
            </div>`}

          <div class="timer-actions">
            <button class="round-btn" type="button" data-reset aria-label="${t('resetTimer')}">${icon('refresh')}</button>
            <button class="btn btn--primary" type="button" id="timerToggle" data-toggle-timer>
              ${snapshot.running ? icon('pause') : icon('play')}
              <span id="timerToggleLabel">${snapshot.running ? t('pauseFocus') : (isStopwatch ? t('start') : t('startFocus'))}</span>
            </button>
            ${isStopwatch
              ? `<button class="round-btn" type="button" data-finish aria-label="${t('save')}">${icon('check')}</button>`
              : `<button class="round-btn" type="button" data-link aria-label="${t('link')}">${icon('link')}</button>`}
          </div>

          <p class="tiny muted center" style="max-width:300px">${t('timerHint')}</p>
          ${needsNotifications ? `
            <button class="btn btn--tiny btn--tonal" type="button" data-enable-notifications>
              ${icon('bell')}${t('enable')} ${t('notificationsTitle')}
            </button>` : ''}
        </div>
      </section>

      ${tasks.length ? `
        <section class="card card--flat">
          <div class="card__head">
            <h2 class="card__title">${t('linkedTask')}</h2>
            ${linked ? `<button class="btn btn--tiny btn--ghost" type="button" data-unlink>${t('none')}</button>` : ''}
          </div>
          <div class="filters">
            ${tasks.map((task) => `
              <button class="filter ${linked && linked.id === task.id ? 'is-active' : ''}" type="button" data-link-task="${escapeAttr(task.id)}">
                ${escapeHtml(task.title)}
              </button>`).join('')}
          </div>
        </section>` : ''}

      <section class="card">
        <div class="card__head">
          <h2 class="card__title">${t('todaySessions')}</h2>
          <span class="badge badge--focus">${icon('timer')}${escapeHtml(formatDuration(totalSeconds))}</span>
        </div>
        ${sessions.length ? `
          <div>
            ${sessions.map((session) => `
              <div class="session">
                <span class="session__icon">${icon('timer')}</span>
                <div style="flex:1;min-width:0">
                  <div class="session__title">${escapeHtml(session.taskTitle || session.mode || t('focus'))}</div>
                  <div class="session__meta">${escapeHtml(session.mode || '')} · ${escapeHtml(timeOf(session.endedAt))}</div>
                </div>
                <span class="small strong tabular">${escapedMinutes(session.seconds)}</span>
              </div>`).join('')}
          </div>` : `<p class="small muted">${t('noSessions')}</p>`}
      </section>
    </div>`;
}

function timeOf(timestamp) {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

const escapedMinutes = (seconds) => escapeHtml(formatDuration(seconds));

function stateLabel(snapshot) {
  if (snapshot.running) return t('focusRunning');
  if (snapshot.remaining !== snapshot.duration && snapshot.mode !== 'stopwatch') return t('focusPaused');
  return t('focusIdle');
}

export function mount(root) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  unsubscribe = subscribeTimer(() => paint(root));

  root.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      setMode(button.dataset.mode);
      haptic(6);
      renderInto(root);
    });
  });

  root.querySelector('[data-toggle-timer]')?.addEventListener('click', async () => {
    if (timer.running) pause();
    else await start();
    haptic(10);
    paint(root);
  });

  root.querySelector('[data-reset]')?.addEventListener('click', () => {
    reset();
    toast(t('timerResetToast'), { duration: 1400 });
    paint(root);
  });

  root.querySelectorAll('[data-adjust]').forEach((button) => {
    button.addEventListener('click', () => {
      adjust(Number(button.dataset.adjust));
      haptic(4);
      paint(root);
    });
  });

  root.querySelector('[data-duration]')?.addEventListener('click', openDurationSheet);

  root.querySelector('[data-link]')?.addEventListener('click', () => {
    root.querySelector('[data-link-task]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  root.querySelectorAll('[data-link-task]').forEach((button) => {
    button.addEventListener('click', () => {
      const isLinked = timer.linkedTaskId === button.dataset.linkTask;
      linkTask(isLinked ? null : button.dataset.linkTask);
      haptic(6);
      toast(t('linkedTask'));
      renderInto(root);
    });
  });

  root.querySelector('[data-unlink]')?.addEventListener('click', () => {
    linkTask(null);
    renderInto(root);
  });

  root.querySelector('[data-finish]')?.addEventListener('click', () => {
    finishStopwatch();
    renderInto(root);
  });

  root.querySelector('[data-enable-notifications]')?.addEventListener('click', async () => {
    await requestNotifications();
  });

  paint(root);
}

export function unmount() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

function paint(root) {
  const snapshot = getSnapshot();
  const timeEl = root.querySelector('#timerTime');
  if (!timeEl) return;
  const isStopwatch = snapshot.mode === 'stopwatch';
  timeEl.textContent = formatClock(isStopwatch ? snapshot.elapsed : snapshot.remaining);

  const circumference = 2 * Math.PI * 45;
  const bar = root.querySelector('#timerBar');
  if (bar) {
    const ratio = isStopwatch ? 1 : snapshot.progress;
    bar.setAttribute('stroke-dashoffset', (circumference * (1 - ratio)).toFixed(2));
  }

  const modeLabel = root.querySelector('#timerModeLabel');
  if (modeLabel) modeLabel.textContent = t(MODES[snapshot.mode].label);

  const stateEl = root.querySelector('#timerState');
  if (stateEl) stateEl.textContent = stateLabel(snapshot);

  const timerRoot = root.querySelector('#timerRoot');
  if (timerRoot) timerRoot.classList.toggle('is-paused', !snapshot.running);

  const toggle = root.querySelector('#timerToggle');
  if (toggle) {
    toggle.innerHTML = `${snapshot.running ? icon('pause') : icon('play')}
      <span id="timerToggleLabel">${snapshot.running ? t('pauseFocus') : (isStopwatch ? t('start') : t('startFocus'))}</span>`;
  }

  const durationLabel = root.querySelector('#durationLabel');
  if (durationLabel) durationLabel.textContent = `${Math.round(snapshot.duration / 60)} ${t('min')}`;

  const linkedEl = root.querySelector('#timerLinked');
  if (linkedEl) linkedEl.textContent = snapshot.linkedTask ? snapshot.linkedTask.title : '';

  root.querySelectorAll('[data-mode]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === snapshot.mode);
  });
}

function openDurationSheet() {
  const current = timer.mode === 'custom' ? timer.customMinutes : Math.round(timer.duration / 60);
  const presets = [15, 25, 30, 45, 50, 60, 90];
  openSheet({
    title: t('setDuration'),
    body: `
      <form id="durationForm" class="stack">
        <div class="option-grid">
          ${presets.map((minutes) => `<button class="option ${minutes === current ? 'is-active' : ''}" type="button" data-preset="${minutes}">${minutes} ${t('min')}</button>`).join('')}
        </div>
        <div class="field">
          <label for="customMinutes">${t('durationMinutes')}</label>
          <input class="input" id="customMinutes" type="number" inputmode="numeric" min="1" max="180" value="${current}">
        </div>
      </form>`,
    foot: `<button class="btn btn--outline" type="button" data-cancel>${t('cancel')}</button>
           <button class="btn btn--primary" type="submit" form="durationForm">${t('save')}</button>`,
    onMount: (sheet, close) => {
      let value = current;
      sheet.querySelectorAll('[data-preset]').forEach((button) => {
        button.addEventListener('click', () => {
          value = Number(button.dataset.preset);
          sheet.querySelector('#customMinutes').value = value;
          sheet.querySelectorAll('[data-preset]').forEach((el) => el.classList.toggle('is-active', el === button));
        });
      });
      sheet.querySelector('[data-cancel]').addEventListener('click', close);
      sheet.querySelector('#durationForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const input = Number(sheet.querySelector('#customMinutes').value) || current;
        setCustomMinutes(input);
        setMode('custom');
        close();
        renderInto(document.getElementById('screen'));
      });
    },
  });
}

async function requestNotifications() {
  if (!('Notification' in window)) return;
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') toast(t('notificationsEnabled'));
    else toast(t('notificationsDenied'));
  } catch {
    toast(t('notificationsDenied'));
  }
}

function renderInto(root) {
  root.innerHTML = render();
  mount(root);
}
