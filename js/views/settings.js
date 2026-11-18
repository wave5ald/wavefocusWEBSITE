/* "More Pages" sheet + Settings & Tools sheet (appearance, install, backup). */

import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { todayISO } from '../dates.js';
import {
  exportJSON, importJSON, requestPersistentStorage, resetAll, resetTimeLabel, setDayResetTime, setSetting,
  state, subscribe, ui,
} from '../store.js';
import { hijriStatus, syncHijri } from '../hijri-sync.js';
import {
  confirmDialog, download, escapeAttr, escapeHtml, isStandalone, openSheet, toast,
} from '../ui.js';
import { isInstalled, showInstallCard } from '../install.js';
import { getSync, onSync, signIn, signOut, syncNow } from '../sync.js';

export function openMoreSheet({ onNavigate, onSettings }) {
  const installed = isInstalled();

  openSheet({
    title: t('moreSheetTitle'),
    body: `
      <div class="stack stack--tight">
        <button class="list-item" type="button" data-go="progress">
          <span class="list-item__icon">${icon('trend')}</span>
          <span class="list-item__text">
            <span class="list-item__title">${t('progressAndInsights')}</span>
            <span class="list-item__sub">${t('weeklyTrends')} · ${t('categoryBreakdown')}</span>
          </span>
          ${icon('chevronRight')}
        </button>

        <button class="list-item" type="button" data-go="settings">
          <span class="list-item__icon">${icon('settings')}</span>
          <span class="list-item__text">
            <span class="list-item__title">${t('settingsAndTools')}</span>
            <span class="list-item__sub">${t('appearance')} · ${t('dataBackup')} · ${t('installApp')}</span>
          </span>
          ${icon('chevronRight')}
        </button>

        <button class="list-item" type="button" data-go="install">
          <span class="list-item__icon">${icon(installed ? 'check' : 'install')}</span>
          <span class="list-item__text">
            <span class="list-item__title">${installed ? t('installedApp') : t('installApp')}</span>
            <span class="list-item__sub">${installed ? t('standaloneMode') : t('installHint')}</span>
          </span>
          ${installed ? '' : icon('chevronRight')}
        </button>

        <div class="divider"></div>

        ${rowToggle(t('hijriEdition'), state.settings.edition === 'hijri', 'toggle-edition')}

        <div class="row row--between" style="padding:8px 12px 2px">
          <span class="tiny muted">${t('version')} ${t('appVersion')}</span>
          <span class="tiny muted">${t('offlineReady')} · ${isStandalone() ? t('standaloneMode') : t('browserMode')}</span>
        </div>
      </div>`,
    onMount: (sheet, close) => {
      sheet.querySelectorAll('[data-go]').forEach((button) => {
        button.addEventListener('click', () => {
          const target = button.dataset.go;
          close();
          if (target === 'settings') onSettings();
          else if (target === 'install') showInstallCard();
          else onNavigate(target);
        });
      });
      sheet.querySelector('[data-toggle-edition]')?.addEventListener('click', (event) => {
        const next = state.settings.edition === 'hijri' ? 'standard' : 'hijri';
        setSetting({ edition: next });
        event.currentTarget.setAttribute('aria-checked', next === 'hijri' ? 'true' : 'false');
        toast(next === 'hijri' ? t('hijriEdition') : t('standardEdition'));
      });
    },
  });
}

function rowToggle(label, checked, action) {
  return `
    <div class="switch-row" style="padding:4px 12px">
      <span class="small strong">${escapeHtml(label)}</span>
      <button class="switch" type="button" role="switch" data-${action} aria-checked="${checked ? 'true' : 'false'}" aria-label="${escapeAttr(label)}"></button>
    </div>`;
}

/* -------------------------- theme colour slider -------------------------- */

const PRESET_HUES = [350, 25, 45, 160, 199, 239, 271, 330];
const BASE_PRIMARY_HUE = 199;

const hueShiftFor = (target) => ((target - BASE_PRIMARY_HUE) % 360 + 360) % 360;

function themeColorBlock() {
  const shift = Math.round(Number(state.settings.hue) || 0);
  const presets = PRESET_HUES.map((hue) => {
    const value = hueShiftFor(hue);
    const active = Math.abs(value - shift) < 4 ? ' is-active' : '';
    return `<button class="hue-preset${active}" type="button" data-hue-preset="${value}" aria-label="${hue}°" style="background:hsl(${hue} 92% 58%)"></button>`;
  }).join('');

  return `
    <div class="theme-color">
      <div class="theme-color__head">
        <span class="theme-color__dot"></span>
        <span class="small strong">${t('themeColor')}</span>
        <span class="theme-color__value" data-hue-value>${shift}°</span>
      </div>
      <p class="theme-color__hint">${t('themeColorHint')}</p>
      <input class="hue-slider" type="range" min="0" max="360" step="1" value="${shift}"
             aria-label="${escapeAttr(t('themeColor'))}" data-hue-slider>
      <div class="hue-presets">
        ${presets}
        <button class="hue-reset" type="button" data-hue-reset ${shift ? '' : 'disabled'}>${t('resetColor')}</button>
      </div>
    </div>`;
}

function wireThemeColor(sheet) {
  const slider = sheet.querySelector('[data-hue-slider]');
  const valueLabel = sheet.querySelector('[data-hue-value]');
  const reset = sheet.querySelector('[data-hue-reset]');

  const paint = (value) => {
    setSetting({ hue: value });
    if (valueLabel) valueLabel.textContent = `${value}°`;
    if (reset) reset.disabled = value === 0;
    sheet.querySelectorAll('[data-hue-preset]').forEach((dot) => {
      dot.classList.toggle('is-active', Math.abs(Number(dot.dataset.huePreset) - value) < 4);
    });
  };

  slider?.addEventListener('input', () => paint(Number(slider.value) || 0));
  slider?.addEventListener('change', () => toast(t('themeColorSaved')));
  reset?.addEventListener('click', () => {
    if (slider) slider.value = '0';
    paint(0);
  });
  sheet.querySelectorAll('[data-hue-preset]').forEach((dot) => {
    dot.addEventListener('click', () => {
      const value = Number(dot.dataset.huePreset) || 0;
      if (slider) slider.value = String(value);
      paint(value);
    });
  });
}

function syncTime(ts) {
  try {
    return new Date(ts).toLocaleString(state.settings.lang === 'ar' ? 'ar' : 'en', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return new Date(ts).toLocaleString();
  }
}

function syncStatusLabel(sync) {
  if (sync.status === 'offline') return t('syncOffline');
  if (sync.status === 'syncing' || sync.status === 'signing-in') return t('syncWorking');
  if (sync.status === 'error') return t('syncError');
  return sync.lastSync ? t('syncLast', { time: syncTime(sync.lastSync) }) : t('syncNever');
}

function syncBox() {
  const sync = getSync();
  if (!sync.configured) {
    return `<p class="tiny muted" style="margin:0">${t('syncUnconfigured')}</p>`;
  }
  if (!sync.user) {
    return `
      <p class="tiny muted" style="margin:0">${t('syncSignedOut')}</p>
      <button class="btn btn--primary btn--block" type="button" data-sync-signin ${sync.status === 'signing-in' || sync.status === 'offline' ? 'disabled' : ''}>
        ${icon('cloud')}${t('syncSignIn')}
      </button>
      ${sync.status === 'offline' ? `<p class="tiny muted" style="margin:0">${t('syncOffline')}</p>` : ''}`;
  }
  return `
    <div class="row row--between" style="gap:12px">
      <div style="min-width:0">
        <div class="small strong" style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(sync.user.email || sync.user.name || '')}</div>
        <div class="tiny muted">${escapeHtml(syncStatusLabel(sync))}</div>
      </div>
      <span class="badge">${icon(sync.status === 'error' ? 'cloudOff' : 'cloud')}${t('syncOn')}</span>
    </div>
    <div class="field-row">
      <button class="btn btn--tonal" type="button" data-sync-now ${sync.status === 'syncing' ? 'disabled' : ''}>${icon('refresh')}${t('syncNow')}</button>
      <button class="btn btn--outline" type="button" data-sync-signout>${t('syncSignOut')}</button>
    </div>`;
}

function hijriTime(ts) {
  try {
    return new Date(ts).toLocaleString(state.settings.lang === 'ar' ? 'ar' : 'en', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return new Date(ts).toLocaleString();
  }
}

function hijriStatusText(info) {
  if (info.status === 'syncing') return t('hijriChecking');
  if (info.status === 'error') return t('hijriCheckFailed');
  if (info.status === 'offline') return t('hijriOffline');
  if (!info.checkedAt) return t('hijriNeverChecked');
  return t('hijriCheckedAt', { time: hijriTime(info.checkedAt) });
}

function hijriBox() {
  const info = hijriStatus();
  const offset = Number(info.offset) || 0;
  const offsetLabel = offset > 0 ? `+${offset}` : String(offset);
  return `
    <div class="row row--between" style="gap:12px">
      <div style="min-width:0">
        <div class="small strong">${escapeHtml(hijriStatusText(info))}</div>
        <div class="tiny muted">${escapeHtml(t('hijriSourceNote'))}</div>
      </div>
      <span class="badge">${escapeHtml(t('hijriOffsetLabel', { offset: offsetLabel }))}</span>
    </div>
    <button class="btn btn--tonal" type="button" data-hijri-check ${info.status === 'syncing' ? 'disabled' : ''}>
      ${icon('refresh')}${t('hijriVerifyNow')}
    </button>`;
}

export function openSettings() {
  const installed = isStandalone();
  const notifySupported = 'Notification' in window;
  const notifyBlocked = notifySupported && Notification.permission === 'denied';
  const notifyOn = notifySupported && Notification.permission === 'granted' && state.settings.notifications;

  openSheet({
    title: t('settingsAndTools'),
    body: `
      <div class="stack">
        <section class="stack stack--tight">
          <span class="eyebrow">${t('appearance')}</span>
          <div class="segmented" role="group" aria-label="${t('theme')}">
            ${[['system', t('systemDefault'), 'sun'], ['light', t('lightMode'), 'sun'], ['dark', t('darkMode'), 'moon']]
              .map(([value, label, ico]) => `<button class="segmented__btn ${state.settings.theme === value ? 'is-active' : ''}" type="button" data-theme-choice="${value}">${escapeHtml(label)}</button>`).join('')}
          </div>

          ${themeColorBlock()}

          <div class="segmented" role="group" aria-label="${t('language')}">
            <button class="segmented__btn ${state.settings.lang === 'en' ? 'is-active' : ''}" type="button" data-lang-choice="en">English</button>
            <button class="segmented__btn ${state.settings.lang === 'ar' ? 'is-active' : ''}" type="button" data-lang-choice="ar">العربية</button>
          </div>

          <div class="segmented" role="group" aria-label="${t('edition')}">
            <button class="segmented__btn ${state.settings.edition !== 'hijri' ? 'is-active' : ''}" type="button" data-edition-choice="standard">${t('standardEdition')}</button>
            <button class="segmented__btn ${state.settings.edition === 'hijri' ? 'is-active' : ''}" type="button" data-edition-choice="hijri">${t('hijriEdition')}</button>
          </div>
          <p class="tiny muted" style="margin:0">${t('hijriHint')}</p>
        </section>

        <div class="divider"></div>

        <section class="stack stack--tight">
          <span class="eyebrow">${t('installApp')}</span>
          <button class="list-item" type="button" data-install-settings>
            <span class="list-item__icon">${icon(installed ? 'check' : 'install')}</span>
            <span class="list-item__text">
              <span class="list-item__title">${installed ? t('installedApp') : t('installApp')}</span>
              <span class="list-item__sub">${installed ? t('standaloneMode') : t('installHint')}</span>
            </span>
            ${installed ? '' : icon('chevronRight')}
          </button>
        </section>

        <div class="divider"></div>

        <section class="stack stack--tight">
          <span class="eyebrow">${t('notificationsTitle')}</span>
          <div class="switch-row">
            <div>
              <div class="small strong">${t('notificationsTitle')}</div>
              <div class="tiny muted">${notifyBlocked ? t('notificationsBlocked') : t('notificationsHint')}</div>
            </div>
            <button class="switch" type="button" role="switch" data-toggle-notifications
                    aria-checked="${notifyOn ? 'true' : 'false'}" aria-label="${escapeAttr(t('notificationsTitle'))}"></button>
          </div>
        </section>

        <div class="divider"></div>

        <section class="stack stack--tight">
          <span class="eyebrow">${t('dayAndCalendar')}</span>
          <div class="switch-row">
            <div>
              <div class="small strong">${t('tasksResetAt')}</div>
              <div class="tiny muted">${t('tasksResetHint')}</div>
            </div>
            <input class="input" id="resetTime" type="time" value="${escapeAttr(state.settings.dayReset || '00:00')}"
                   aria-label="${escapeAttr(t('tasksResetAt'))}" style="width:128px;padding:8px 10px">
          </div>
          <p class="tiny muted" style="margin:0">${escapeHtml(t('resetWindowHint', { time: resetTimeLabel() }))}</p>
          <div class="switch-row">
            <div>
              <div class="small strong">${t('hijriAutoVerify')}</div>
              <div class="tiny muted">${t('hijriAutoVerifyHint')}</div>
            </div>
            <button class="switch" type="button" role="switch" data-toggle-hijri-sync
                    aria-checked="${state.settings.hijriSync !== false ? 'true' : 'false'}"
                    aria-label="${escapeAttr(t('hijriAutoVerify'))}"></button>
          </div>
          <div id="hijriBox" class="stack stack--tight">${hijriBox()}</div>
        </section>

        <div class="divider"></div>

        <section class="stack stack--tight">
          <span class="eyebrow">${t('cloudSync')}</span>
          <div id="syncBox" class="stack stack--tight">${syncBox()}</div>
          <p class="tiny muted" style="margin:0">${t('syncHint')}</p>
        </section>

        <div class="divider"></div>

        <section class="stack stack--tight">
          <span class="eyebrow">${t('dataBackup')}</span>
          <p class="tiny muted" style="margin:0">${t('exportHint')}</p>
          <div class="field-row">
            <button class="btn btn--tonal" type="button" data-export>${icon('download')}${t('exportData')}</button>
            <button class="btn btn--tonal" type="button" data-import>${icon('upload')}${t('importData')}</button>
          </div>
          <input type="file" id="importFile" accept="application/json,.json" hidden>
          <button class="list-item" type="button" data-persist>
            <span class="list-item__icon">${icon('shield')}</span>
            <span class="list-item__text">
              <span class="list-item__title">${t('storagePersist')}</span>
              <span class="list-item__sub">${t('storagePersistHint')}</span>
            </span>
            ${icon('chevronRight')}
          </button>
          <button class="list-item" type="button" data-reset style="color:var(--danger)">
            <span class="list-item__icon" style="background:rgba(244,63,94,.12)">${icon('trash')}</span>
            <span class="list-item__text">
              <span class="list-item__title" style="color:var(--danger)">${t('resetData')}</span>
              <span class="list-item__sub">${t('resetConfirmBody')}</span>
            </span>
          </button>
        </section>

        <div class="divider"></div>

        <section class="stack stack--tight">
          <span class="eyebrow">${t('about')}</span>
          <div class="row row--between">
            <span class="small muted">${t('version')}</span>
            <span class="small strong">${t('appVersion')}</span>
          </div>
          <p class="tiny muted" style="margin:0">${t('privacyBody')} ${t('madeWith')}</p>
          <div class="row row--wrap" style="gap:6px;margin-top:2px">
            <span class="badge">${icon('shield')}${t('noAccount')}</span>
            <span class="badge">${icon('check')}${t('offlineReady')}</span>
            <span class="badge">${icon('lock')}${t('dataLocal')}</span>
          </div>
        </section>
      </div>`,
    onMount: (sheet, close) => {
      const apply = () => {
        close();
        openSettings();
      };

      wireThemeColor(sheet);

      sheet.querySelectorAll('[data-theme-choice]').forEach((button) => {
        button.addEventListener('click', () => {
          setSetting({ theme: button.dataset.themeChoice });
          apply();
        });
      });

      sheet.querySelectorAll('[data-lang-choice]').forEach((button) => {
        button.addEventListener('click', () => {
          setSetting({ lang: button.dataset.langChoice });
          apply();
        });
      });

      sheet.querySelectorAll('[data-edition-choice]').forEach((button) => {
        button.addEventListener('click', () => {
          setSetting({ edition: button.dataset.editionChoice });
          apply();
        });
      });

      const resetInput = sheet.querySelector('#resetTime');
      resetInput?.addEventListener('change', () => {
        setDayResetTime(resetInput.value || '00:00');
        toast(t('resetTimeSaved', { time: resetTimeLabel() }));
        apply();
      });

      sheet.querySelector('[data-toggle-hijri-sync]')?.addEventListener('click', (event) => {
        const next = state.settings.hijriSync === false;
        setSetting({ hijriSync: next });
        event.currentTarget.setAttribute('aria-checked', next ? 'true' : 'false');
        if (next) syncHijri({ force: true }).catch(() => {});
      });

      const hijriBoxEl = sheet.querySelector('#hijriBox');
      if (hijriBoxEl) {
        const wire = () => {
          hijriBoxEl.querySelector('[data-hijri-check]')?.addEventListener('click', async () => {
            hijriBoxEl.innerHTML = hijriBox();
            wire();
            await syncHijri({ force: true }).catch(() => {});
            if (!hijriBoxEl.isConnected) return;
            hijriBoxEl.innerHTML = hijriBox();
            wire();
            toast(t('hijriVerified'));
          });
        };
        wire();
        const off = subscribe((type) => {
          if (!hijriBoxEl.isConnected) { off(); return; }
          if (type !== 'hijri-sync') return;
          hijriBoxEl.innerHTML = hijriBox();
          wire();
        });
      }

      sheet.querySelector('[data-install-settings]')?.addEventListener('click', () => {
        if (!isInstalled()) showInstallCard();
        else toast(t('installedApp'));
      });

      sheet.querySelector('[data-toggle-notifications]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const isOn = button.getAttribute('aria-checked') === 'true';
        if (isOn) {
          setSetting({ notifications: false });
          button.setAttribute('aria-checked', 'false');
          return;
        }
        if (!notifySupported) { toast(t('notificationsDenied')); return; }
        try {
          const permission = await Notification.requestPermission();
          if (permission === 'granted') {
            setSetting({ notifications: true });
            button.setAttribute('aria-checked', 'true');
            toast(t('notificationsEnabled'));
          } else {
            toast(t('notificationsDenied'));
          }
        } catch {
          toast(t('notificationsDenied'));
        }
      });

      const syncBoxEl = sheet.querySelector('#syncBox');
      if (syncBoxEl) {
        const wire = () => {
          syncBoxEl.querySelector('[data-sync-signin]')?.addEventListener('click', () => { signIn(); });
          syncBoxEl.querySelector('[data-sync-now]')?.addEventListener('click', async () => { await syncNow(); redraw(); });
          syncBoxEl.querySelector('[data-sync-signout]')?.addEventListener('click', async () => { await signOut(); redraw(); });
        };
        const redraw = () => {
          if (!syncBoxEl.isConnected) return;
          syncBoxEl.innerHTML = syncBox();
          wire();
        };
        wire();
        const off = onSync(() => {
          if (!syncBoxEl.isConnected) { off(); return; }
          redraw();
        });
      }

      sheet.querySelector('[data-export]')?.addEventListener('click', () => {
        const payload = exportJSON();
        download(`wavefocus-backup-${todayISO()}.json`, payload);
        toast(t('exportDone'));
      });

      const fileInput = sheet.querySelector('#importFile');
      sheet.querySelector('[data-import]')?.addEventListener('click', () => fileInput.click());
      fileInput?.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          importJSON(text);
          toast(t('importDone'));
          close();
        } catch (err) {
          console.warn(err);
          toast(t('importFailed'));
        } finally {
          fileInput.value = '';
        }
      });

      sheet.querySelector('[data-persist]')?.addEventListener('click', async () => {
        const granted = await requestPersistentStorage();
        toast(granted ? t('storagePersisted') : t('storagePersistHint'));
      });

      sheet.querySelector('[data-reset]')?.addEventListener('click', () => {
        close();
        confirmDialog({
          title: t('resetConfirm'),
          body: t('resetConfirmBody'),
          confirmLabel: t('resetData'),
          cancelLabel: t('cancel'),
          danger: true,
        }).then((ok) => {
          if (!ok) return;
          resetAll();
          ui.tab = 'routine';
          toast(t('resetDone'));
        });
      });
    },
  });
}
