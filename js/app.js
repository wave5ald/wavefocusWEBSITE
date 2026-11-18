/* ==========================================================================
   Wave Focus — application shell
   Routing, theme, language, service worker updates and install flow.
   ========================================================================== */

import { setLanguage, t } from './i18n.js';
import { checkDayRollover, markOnboarded, requestPersistentStorage, saveNow, setSetting, state, subscribe, ui } from './store.js';
import { initTimer } from './timer.js';
import { initSync } from './sync.js';
import { initHijriSync } from './hijri-sync.js';
import { initInstall, canPromptInstall, isInstalled, promptInstall, showInstallCard } from './install.js';
import { $, isIOS, openSheet, toast } from './ui.js';
import { openMoreSheet, openSettings } from './views/settings.js';
import { applyHue } from './theme-hue.js';

import * as routineView from './views/routine.js';
import * as focusView from './views/focus.js';
import * as scheduleView from './views/schedule.js';
import * as notesView from './views/notes.js';
import * as progressView from './views/progress.js';

const VIEWS = {
  routine: routineView,
  focus: focusView,
  schedule: scheduleView,
  notes: notesView,
  progress: progressView,
};

const TITLES = {
  routine: 'routine',
  focus: 'focus',
  schedule: 'schedule',
  notes: 'notes',
  progress: 'progress',
};

const appEl = document.getElementById('app');
const screenEl = document.getElementById('screen');
const fabEl = document.getElementById('fab');
const fabLabel = document.getElementById('fabLabel');
const titleEl = document.getElementById('screenTitle');
const offlineBanner = document.getElementById('offlineBanner');
const updateBanner = document.getElementById('updateBanner');
const reloadBtn = document.getElementById('reloadBtn');

let currentView = null;
let updateWorker = null;
let firstPaint = true;

/* ------------------------------- theming --------------------------------- */

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function isDark() {
  const theme = state.settings.theme;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return darkQuery.matches;
}

function applyTheme() {
  const dark = isDark();
  const mode = dark ? 'dark' : 'light';
  appEl.dataset.theme = mode;
  document.body.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
  const bg = dark ? '#0B0F19' : '#F8FAFC';
  document.documentElement.style.background = bg;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', bg);
    meta.removeAttribute('media');
  });
  const statusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (statusBar) statusBar.setAttribute('content', dark ? 'black-translucent' : 'default');
  // Repaint the accent palette from the settings colour slider.
  applyHue(appEl, Number(state.settings.hue) || 0, dark);
}

darkQuery.addEventListener?.('change', () => {
  if (state.settings.theme === 'system') applyTheme();
});

/* ------------------------------ language --------------------------------- */

function applyLanguage() {
  setLanguage(state.settings.lang);
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });

  const langBtn = $('#langBtn');
  if (langBtn) {
    $('#langLabel').textContent = state.settings.lang === 'en' ? 'العربية' : 'English';
    langBtn.setAttribute('aria-label', state.settings.lang === 'en' ? 'التبديل إلى العربية' : 'Switch to English');
  }
  updateEditionChip();
  updateChrome();
}

function updateEditionChip() {
  const hijri = state.settings.edition === 'hijri';
  const button = $('#editionBtn');
  if (!button) return;
  $('#editionEmoji').textContent = hijri ? '🌙' : '📅';
  $('#editionLabel').textContent = hijri ? t('hijriEdition') : t('standardEdition');
  button.classList.toggle('chip--edition', hijri);
  button.setAttribute('aria-pressed', hijri ? 'true' : 'false');
  button.setAttribute('aria-label', t('switchEdition'));
}

/* ------------------------------- routing --------------------------------- */

function tabFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('tab');
  return requested && VIEWS[requested] ? requested : null;
}

function syncUrl() {
  const url = new URL(window.location.href);
  if (ui.tab === 'routine') url.searchParams.delete('tab');
  else url.searchParams.set('tab', ui.tab);
  history.replaceState({}, '', url);
}

function updateChrome() {
  const view = VIEWS[ui.tab];
  titleEl.textContent = t(TITLES[ui.tab]);
  document.title = ui.tab === 'routine'
    ? `${t('appName')} — ${t('tagline')}`
    : `${t(TITLES[ui.tab])} · ${t('appName')}`;

  if (view && view.fab) {
    fabEl.hidden = false;
    fabLabel.textContent = view.fab.label();
    fabEl.onclick = () => view.fab.action();
  } else {
    fabEl.hidden = true;
    fabEl.onclick = null;
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.tab === ui.tab;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

function renderView({ preserveScroll = true, animate = false } = {}) {
  const scrollY = preserveScroll ? window.scrollY : 0;
  const view = VIEWS[ui.tab];
  if (!view) return;

  if (currentView && typeof currentView.unmount === 'function') currentView.unmount();
  const html = view.render();
  screenEl.innerHTML = html;
  currentView = view;
  if (typeof view.mount === 'function') view.mount(screenEl);

  updateChrome();
  if (!preserveScroll) window.scrollTo(0, 0);
  else window.scrollTo(0, scrollY);
  if (animate) {
    screenEl.firstElementChild?.animate?.(
      [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
      { duration: 280, easing: 'cubic-bezier(.2,.8,.25,1)' }
    );
  }
}

function switchTab(tab, { fromUrl = false } = {}) {
  if (!VIEWS[tab]) return;
  const changed = ui.tab !== tab;
  ui.tab = tab;
  if (!fromUrl) syncUrl();
  renderView({ preserveScroll: !changed, animate: changed });
  if (changed) window.scrollTo(0, 0);
}

/* ------------------------------ bootstrapping ----------------------------- */

function boot() {
  applyTheme();
  setLanguage(state.settings.lang);
  applyLanguage();

  // Apply cached Saudi Hijri data immediately; refresh in the background.
  initHijriSync();

  const initialTab = tabFromUrl() || 'routine';
  ui.tab = initialTab;
  renderView({ preserveScroll: false });

  initTimer();
  initInstall();
  setTimeout(() => { initSync(); }, 1400);
  window.addEventListener('online', () => { initSync(); });
  window.addEventListener('wavefocus:sync-restored', () => toast(t('syncRestored')));
  requestPersistentStorage().catch(() => {});

  subscribe((type) => {
    if (type === 'settings') {
      applyTheme();
      applyLanguage();
    }
    renderView({ preserveScroll: true });
    if (firstPaint) firstPaint = false;
  });

  // Keep the FAB label in sync when a screen changes its internal state.
  screenEl.addEventListener('click', () => requestAnimationFrame(updateChrome));
  screenEl.addEventListener('keydown', () => requestAnimationFrame(updateChrome));

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
      screenEl.focus({ preventScroll: true });
    });
  });

  $('#moreBtn').addEventListener('click', () => {
    openMoreSheet({
      onNavigate: (target) => switchTab(target),
      onSettings: () => openSettings(),
    });
  });

  $('#editionBtn').addEventListener('click', () => {
    const next = state.settings.edition === 'hijri' ? 'standard' : 'hijri';
    setSetting({ edition: next });
    updateEditionChip();
    toast(next === 'hijri' ? t('hijriEdition') : t('standardEdition'));
    renderView({ preserveScroll: true });
  });

  $('#langBtn').addEventListener('click', () => {
    const next = state.settings.lang === 'en' ? 'ar' : 'en';
    setSetting({ lang: next });
    toast(next === 'ar' ? 'تم اختيار العربية' : 'English');
  });

  fabEl.addEventListener('click', () => {}); // handler assigned in updateChrome

  window.addEventListener('scroll', () => {
    appEl.classList.toggle('is-scrolled', window.scrollY > 6);
  }, { passive: true });

  window.addEventListener('offline', () => { offlineBanner.hidden = false; });
  window.addEventListener('online', () => { offlineBanner.hidden = true; });
  offlineBanner.hidden = navigator.onLine;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDayRollover();
  });
  setInterval(checkDayRollover, 60000);

  window.addEventListener('beforeunload', () => { saveNow(); });
  window.addEventListener('pagehide', () => { saveNow(); });

  // Boot splash out
  setTimeout(() => {
    $('#bootSplash')?.classList.add('is-hidden');
  }, 180);

  if (!state.settings.onboarded) {
    setTimeout(showWelcome, 700);
  }

  registerServiceWorker();
}

/* -------------------------------- welcome -------------------------------- */

function showWelcome() {
  const installed = isInstalled();
  openSheet({
    title: t('appName'),
    body: `
      <div class="stack">
        <p class="small muted" style="line-height:1.5">${t('tagline')}</p>
        <div class="stack stack--tight">
          <div class="list-item" style="background:var(--surface-2)">
            <span class="list-item__icon">✅</span>
            <span class="list-item__text">
              <span class="list-item__title">${t('dailyProgress')}</span>
              <span class="list-item__sub">${t('rewardHint')}</span>
            </span>
          </div>
          <div class="list-item" style="background:var(--surface-2)">
            <span class="list-item__icon">⏱️</span>
            <span class="list-item__text">
              <span class="list-item__title">${t('focusTimer')}</span>
              <span class="list-item__sub">${t('timerHint')}</span>
            </span>
          </div>
          <div class="list-item" style="background:var(--surface-2)">
            <span class="list-item__icon">📈</span>
            <span class="list-item__text">
              <span class="list-item__title">${t('weeklyTrends')}</span>
              <span class="list-item__sub">${t('noDataHint')}</span>
            </span>
          </div>
          <div class="list-item" style="background:var(--surface-2)">
            <span class="list-item__icon">📶</span>
            <span class="list-item__text">
              <span class="list-item__title">${t('offlineReady')}</span>
              <span class="list-item__sub">${t('offlineHint')}</span>
            </span>
          </div>
        </div>
        <p class="tiny muted" style="margin:0;line-height:1.5">
          ${isIOS() ? t('iosStep3') : t('installHint')}
        </p>
      </div>`,
    foot: `
      ${installed ? '' : `<button class="btn btn--outline" type="button" data-welcome-install>${t('installNow')}</button>`}
      <button class="btn btn--primary" type="button" data-welcome-start>${t('start')}</button>`,
    onMount: (sheet, close) => {
      sheet.querySelector('[data-welcome-start]').addEventListener('click', () => {
        markOnboarded();
        close();
      });
      sheet.querySelector('[data-welcome-install]')?.addEventListener('click', () => {
        markOnboarded();
        close();
        setTimeout(() => {
          if (canPromptInstall()) promptInstall().then((accepted) => { if (!accepted) showInstallCard(); });
          else showInstallCard();
        }, 220);
      });
    },
    onClose: () => markOnboarded(),
  });
}

/* ----------------------------- service worker ---------------------------- */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') {
    console.info('[wavefocus] service workers need http(s); run a local server to test the PWA.');
    return;
  }

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('sw.js', { scope: './' });

      if (registration.waiting && navigator.serviceWorker.controller) {
        showUpdateReady(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateReady(worker);
          }
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (updateWorker) window.location.reload();
      });

      // Check for a new version hourly, and whenever the app regains focus.
      setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      });
    } catch (err) {
      console.warn('[wavefocus] service worker registration failed', err);
    }
  });
}

function showUpdateReady(worker) {
  updateWorker = worker;
  updateBanner.hidden = false;
  reloadBtn.addEventListener('click', () => {
    updateWorker.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(() => window.location.reload(), 400);
  }, { once: true });
}

/* -------------------------------- start ---------------------------------- */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
