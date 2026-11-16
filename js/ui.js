/* Generic UI helpers: toasts, bottom sheets, confirmation dialogs, haptics. */

import { icon } from './icons.js';
import { state } from './store.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) =>
  String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ESCAPES[char]);

export const escapeAttr = escapeHtml;

export function haptic(ms = 8) {
  try {
    if (!state.settings.haptics) return;
    if (!navigator.vibrate) return;
    // Browsers ignore (and warn about) vibration until the page has been
    // interacted with, so skip the call when there is no user activation yet.
    if (navigator.userActivation && navigator.userActivation.hasBeenActive === false) return;
    navigator.vibrate(ms);
  } catch { /* ignore */ }
}

export const pad2 = (n) => String(n).padStart(2, '0');

/* --------------------------------- toasts -------------------------------- */

const toastHost = () => $('#toastHost');

export function toast(message, { duration = 2400 } = {}) {
  const host = toastHost();
  if (!host) return;
  const node = document.createElement('div');
  node.className = 'toast';
  node.setAttribute('role', 'status');
  node.textContent = message;
  host.appendChild(node);
  const remove = () => {
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 220);
  };
  setTimeout(remove, duration);
}

/* --------------------------------- sheets -------------------------------- */

let activeSheet = null;

const sheetHost = () => $('#sheetHost');

export function openSheet({ title = '', body = '', foot = '', onMount, onClose, dismissible = true, wide = false } = {}) {
  closeSheet(true);
  const host = sheetHost();
  if (!host) return null;

  host.hidden = false;
  host.innerHTML = `
    <div class="sheet-backdrop" data-sheet-close></div>
    <section class="sheet${wide ? ' sheet--wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="sheet__handle" data-sheet-drag></div>
      <header class="sheet__head" data-sheet-drag>
        <h2 class="sheet__title">${escapeHtml(title)}</h2>
        <button class="icon-btn icon-btn--sm" type="button" data-sheet-close aria-label="Close">${icon('close')}</button>
      </header>
      <div class="sheet__body">${body}</div>
      ${foot ? `<footer class="sheet__foot">${foot}</footer>` : ''}
    </section>`;

  document.body.classList.add('sheet-open');
  const sheet = host.querySelector('.sheet');
  const bodyEl = host.querySelector('.sheet__body');
  bodyEl.scrollTop = 0;

  const close = () => {
    if (!activeSheet) return;
    activeSheet = null;
    document.body.classList.remove('sheet-open');
    host.hidden = true;
    host.innerHTML = '';
    document.removeEventListener('keydown', onKeydown);
    if (typeof onClose === 'function') onClose();
  };

  const tryClose = () => { if (dismissible) close(); };

  const onKeydown = (event) => {
    if (event.key === 'Escape') tryClose();
  };
  document.addEventListener('keydown', onKeydown);

  host.querySelectorAll('[data-sheet-close]').forEach((el) => {
    el.addEventListener('click', tryClose);
  });

  // Drag the sheet down to dismiss (mobile native feel).
  let startY = 0;
  let dragging = false;
  const dragHandles = host.querySelectorAll('[data-sheet-drag]');
  dragHandles.forEach((handle) => {
    handle.addEventListener('touchstart', (event) => {
      if (!dismissible) return;
      dragging = true;
      startY = event.touches[0].clientY;
      sheet.style.transition = 'none';
    }, { passive: true });

    handle.addEventListener('touchmove', (event) => {
      if (!dragging) return;
      const delta = Math.max(0, event.touches[0].clientY - startY);
      sheet.style.transform = `translateY(${delta}px)`;
      sheet.style.opacity = String(Math.max(0.4, 1 - delta / 420));
    }, { passive: true });

    const end = (event) => {
      if (!dragging) return;
      dragging = false;
      const delta = Math.max(0, (event.changedTouches ? event.changedTouches[0].clientY : startY) - startY);
      sheet.style.transition = '';
      sheet.style.transform = '';
      sheet.style.opacity = '';
      if (delta > 96) tryClose();
    };
    handle.addEventListener('touchend', end);
    handle.addEventListener('touchcancel', end);
  });

  activeSheet = { close };
  if (typeof onMount === 'function') onMount(host.querySelector('.sheet'), close);

  requestAnimationFrame(() => {
    const focusable = host.querySelector('input:not([type="hidden"]), textarea, select');
    if (focusable) focusable.focus({ preventScroll: true });
  });

  return activeSheet;
}

export function closeSheet(immediate = false) {
  if (!activeSheet) return;
  activeSheet.close();
}

export function isSheetOpen() {
  return Boolean(activeSheet);
}

/** Promise-based confirmation dialog. */
export function confirmDialog({ title, body = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openSheet({
      title,
      body: `<p class="small muted" style="line-height:1.5">${escapeHtml(body)}</p>`,
      foot: `
        <button class="btn btn--outline" type="button" data-confirm-cancel>${escapeHtml(cancelLabel)}</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" data-confirm-ok>${escapeHtml(confirmLabel)}</button>`,
      onMount: (sheet, close) => {
        sheet.querySelector('[data-confirm-ok]').addEventListener('click', () => { finish(true); close(); });
        sheet.querySelector('[data-confirm-cancel]').addEventListener('click', () => { finish(false); close(); });
      },
      onClose: () => finish(false),
    });
  });
}

/* ------------------------------ misc helpers ----------------------------- */

export function setPressed(el, pressed) {
  el.setAttribute('aria-pressed', pressed ? 'true' : 'false');
}

export function formatNumber(value, lang = 'en') {
  try {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar' : 'en').format(value);
  } catch {
    return String(value);
  }
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true
  );
}

export function isIOS() {
  const ua = navigator.userAgent || '';
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOS;
}
