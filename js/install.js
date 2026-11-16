/* PWA install experience: Chrome/Android prompt + iOS Safari instructions. */

import { icon } from './icons.js';
import { t } from './i18n.js';
import { escapeHtml, isIOS, isStandalone, toast } from './ui.js';

let deferredPrompt = null;
let dismissed = false;
let initialized = false;

const host = () => document.getElementById('installHost');

export function initInstall() {
  if (initialized) return;
  initialized = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    document.documentElement.dataset.canInstall = 'true';
    if (!isStandalone() && !dismissed && !sessionStorage.getItem('wavefocus.install.dismissed')) {
      setTimeout(() => showInstallCard({ auto: true }), 2200);
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    document.documentElement.dataset.canInstall = 'false';
    hideInstallCard();
    toast(t('installedToast'));
  });

  if (isStandalone()) {
    document.documentElement.dataset.standalone = 'true';
  }

  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', (event) => {
    document.documentElement.dataset.standalone = event.matches ? 'true' : 'false';
  });
}

export function canPromptInstall() {
  return Boolean(deferredPrompt);
}

export function isInstalled() {
  return isStandalone();
}

export async function promptInstall() {
  if (!deferredPrompt) {
    showInstallCard();
    return false;
  }
  try {
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.documentElement.dataset.canInstall = 'false';
    if (choice && choice.outcome === 'accepted') {
      hideInstallCard();
      toast(t('installedToast'));
      return true;
    }
    return false;
  } catch {
    showInstallCard();
    return false;
  }
}

function stepsForPlatform() {
  if (isIOS()) {
    return `
      <div class="install-steps">
        <div class="install-step"><span class="install-step__n">1</span><span>${escapeHtml(t('iosStep1'))}</span></div>
        <div class="install-step"><span class="install-step__n">2</span><span>${t('iosStep2').replace('{glyph}', '<span class="share-glyph">⌃</span>')}</span></div>
        <div class="install-step"><span class="install-step__n">3</span><span>${escapeHtml(t('iosStep3'))}</span></div>
      </div>
      <p class="tiny muted" style="margin:0 0 14px">${escapeHtml(t('iosDone'))}</p>`;
  }
  return `
    <div class="install-steps">
      <div class="install-step"><span class="install-step__n">1</span><span>${escapeHtml(t('androidInstall'))}</span></div>
      <div class="install-step"><span class="install-step__n">2</span><span>${escapeHtml(t('desktopInstall'))}</span></div>
    </div>`;
}

export function showInstallCard({ auto = false } = {}) {
  if (isStandalone()) return;
  const el = host();
  if (!el) return;
  el.hidden = false;
  el.classList.toggle('is-auto', auto);
  el.innerHTML = `
    ${auto ? '' : '<div class="sheet-backdrop" data-install-close></div>'}
    <section class="install-card${auto ? ' install-card--auto' : ''}" role="dialog" aria-modal="true" aria-labelledby="installTitle">
      <div class="install-card__head">
        <img class="install-card__icon" src="icons/icon-192.png" alt="" width="46" height="46">
        <div style="flex:1;min-width:0">
          <div class="install-card__title" id="installTitle">${escapeHtml(isIOS() ? t('iosInstallTitle') : t('installApp'))}</div>
          <div class="install-card__sub">${escapeHtml(t('installHint'))}</div>
        </div>
        <button class="icon-btn icon-btn--sm" type="button" data-install-close aria-label="${escapeHtml(t('close'))}">${icon('close')}</button>
      </div>
      ${stepsForPlatform()}
      <div class="row" style="gap:8px">
        ${deferredPrompt ? `<button class="btn btn--primary" type="button" data-install-now style="flex:1">${escapeHtml(t('installNow'))}</button>` : ''}
        <button class="btn btn--outline" type="button" data-install-close style="flex:1">${escapeHtml(auto ? t('notNow') : t('close'))}</button>
      </div>
    </section>`;

  el.querySelectorAll('[data-install-close]').forEach((button) => {
    button.addEventListener('click', () => {
      dismissed = true;
      sessionStorage.setItem('wavefocus.install.dismissed', '1');
      hideInstallCard();
    });
  });

  el.querySelector('[data-install-now]')?.addEventListener('click', () => promptInstall());
}

export function hideInstallCard() {
  const el = host();
  if (!el) return;
  el.hidden = true;
  el.innerHTML = '';
}
