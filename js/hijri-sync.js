/* ==========================================================================
   Wave Focus - Hijri calendar verification against the Saudi (Umm al-Qura)
   calendar via the Aladhan API (method HJCoSA).

   Strategy:
   - Fetch today's official Hijri date, compare it with the on-device
     tabular calendar and store the day offset (usually 0 or -1).
   - Cache real month lengths/starts so 29/30-day months stay correct.
   - Re-verify on launch, when the browser comes back online, when the app
     regains focus and every 6 hours. Data is cached for offline use.
   ========================================================================== */

import {
  addDays, calendarTodayISO, hijriDayNumber, parseISO, rawToHijri,
  setHijriDateLookup, setHijriMonthLookup, setHijriOffset,
} from './dates.js';
import { emit, state } from './store.js';

const CACHE_KEY = 'wavefocus.hijri.v1';
const API = 'https://api.aladhan.com/v1';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MONTH_TTL_MS = 60 * 24 * 60 * 60 * 1000;

const cache = {
  offset: 0,
  method: 'HJCoSA',
  checkedAt: 0,
  months: {},
  status: 'idle',
  error: '',
};

let inflight = null;
let started = false;
const pendingMonths = new Set();

const monthKey = (year, month) => `${year}-${month}`;
const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

function load() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    cache.offset = Math.max(-3, Math.min(3, Math.trunc(Number(parsed.offset) || 0)));
    cache.method = typeof parsed.method === 'string' ? parsed.method : 'HJCoSA';
    cache.checkedAt = Number(parsed.checkedAt) || 0;
    cache.months = parsed.months && typeof parsed.months === 'object' ? parsed.months : {};
  } catch (err) {
    console.warn('[wavefocus] hijri cache unreadable', err);
  }
}

function persist() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      offset: cache.offset,
      method: cache.method,
      checkedAt: cache.checkedAt,
      months: cache.months,
    }));
  } catch (err) {
    console.warn('[wavefocus] hijri cache save failed', err);
  }
}

function applyToDates() {
  setHijriOffset(cache.offset);
  setHijriMonthLookup(hijriMonthInfo);
  setHijriDateLookup(dateToHijri);
}

/** Saudi month data for a Hijri month, or null when it is not cached yet. */
export function hijriMonthInfo(year, month) {
  const entry = cache.months[monthKey(year, month)];
  if (entry && entry.start) {
    if (!entry.fetchedAt || Date.now() - entry.fetchedAt < MONTH_TTL_MS) return entry;
  }
  fetchMonth(year, month);
  return entry && entry.start ? entry : null;
}

function dateToHijri(iso) {
  for (const key of Object.keys(cache.months)) {
    const entry = cache.months[key];
    if (!entry || !entry.start || !entry.length) continue;
    if (iso >= entry.start && iso <= addDays(entry.start, entry.length - 1)) {
      return { year: entry.year, month: entry.month, day: addDaysDiff(entry.start, iso) + 1 };
    }
  }
  return null;
}

function addDaysDiff(fromIso, toIso) {
  return Math.round((parseISO(toIso) - parseISO(fromIso)) / 86400000);
}

async function fetchMonth(year, month) {
  if (!online()) return;
  const key = monthKey(year, month);
  if (pendingMonths.has(key)) return;
  pendingMonths.add(key);
  try {
    const res = await fetch(`${API}/hToGCalendar/${month}/${year}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const days = json && json.data;
    if (!Array.isArray(days) || !days.length) throw new Error('empty month');
    const first = days[0];
    const g = first && first.gregorian && first.gregorian.date;
    const parts = String(g || '').split('-').map(Number);
    if (parts.length !== 3 || !parts[2]) throw new Error('bad month payload');
    const start = `${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`;
    cache.months[key] = { year, month, start, length: days.length, fetchedAt: Date.now() };
    persist();
    emit('hijri-sync');
  } catch (err) {
    console.warn('[wavefocus] hijri month fetch failed', year, month, err);
  } finally {
    pendingMonths.delete(key);
  }
}

/** Current verification state for the settings UI. */
export function hijriStatus() {
  return {
    available: online(),
    offset: cache.offset,
    method: cache.method,
    checkedAt: cache.checkedAt,
    status: cache.status,
    error: cache.error,
  };
}

/** Verify today's Hijri date against the Saudi calendar. */
export async function syncHijri({ force = false } = {}) {
  if (state.settings.hijriSync === false && !force) return hijriStatus();
  if (!online()) {
    cache.status = 'offline';
    emit('hijri-sync');
    return hijriStatus();
  }
  if (inflight) return inflight;
  if (!force && cache.checkedAt && Date.now() - cache.checkedAt < CHECK_INTERVAL_MS) {
    return hijriStatus();
  }

  inflight = (async () => {
    cache.status = 'syncing';
    emit('hijri-sync');
    try {
      const iso = calendarTodayISO();
      const [y, m, d] = iso.split('-');
      const res = await fetch(`${API}/gToH?date=${d}-${m}-${y}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const hijri = json && json.data && json.data.hijri;
      if (!hijri || !hijri.month) throw new Error('bad hijri payload');

      const method = String(hijri.method || '');
      const truth = {
        year: Number(hijri.year),
        month: Number(hijri.month.number),
        day: Number(hijri.day),
      };
      const local = rawToHijri(parseISO(iso));
      const delta = hijriDayNumber(truth.year, truth.month, truth.day)
        - hijriDayNumber(local.year, local.month, local.day);

      cache.offset = Math.max(-3, Math.min(3, Math.round(delta)));
      cache.method = method || 'HJCoSA';
      cache.checkedAt = Date.now();
      cache.status = 'ok';
      cache.error = '';

      // Real month length/start from the Saudi calendar (keeps 29/30 days right).
      const length = Number(hijri.month.days) || 29;
      cache.months[monthKey(truth.year, truth.month)] = {
        year: truth.year,
        month: truth.month,
        start: addDays(iso, -(truth.day - 1)),
        length,
        fetchedAt: Date.now(),
      };
      persist();
      applyToDates();
      emit('hijri-sync');
      return hijriStatus();
    } catch (err) {
      cache.status = 'error';
      cache.error = String((err && err.message) || err);
      emit('hijri-sync');
      return hijriStatus();
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Load the cache, wire date conversion and start periodic verification. */
export function initHijriSync() {
  load();
  applyToDates();

  if (!started) {
    started = true;
    window.addEventListener('online', () => { syncHijri({ force: true }).catch(() => {}); });
    window.addEventListener('offline', () => { cache.status = 'offline'; emit('hijri-sync'); });
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncHijri().catch(() => {});
    });
    setInterval(() => { syncHijri().catch(() => {}); }, CHECK_INTERVAL_MS);
  }

  if (online()) syncHijri().catch(() => {});
  return hijriStatus();
}
