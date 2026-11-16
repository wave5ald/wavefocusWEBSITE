/* Date helpers shared by the whole app (all dates are local-time ISO days). */

export const pad2 = (n) => String(n).padStart(2, '0');

export const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/* ---------------------------- routine day start --------------------------
   Tasks reset at a user-chosen time (default midnight), so "today" means the
   logical routine day: the current clock time shifted back by the reset time.
   ------------------------------------------------------------------------- */
let dayStartMinutes = 0;

export function setDayStart(minutes) {
  const n = Math.round(Number(minutes) || 0);
  dayStartMinutes = ((n % 1440) + 1440) % 1440;
}

export const dayStart = () => dayStartMinutes;

export const logicalNow = (date = new Date()) => new Date(date.getTime() - dayStartMinutes * 60000);

/** The real calendar day (used for Hijri verification / real dates). */
export const calendarTodayISO = () => isoDate(new Date());

/** The logical routine day - what the whole app treats as "today". */
export const todayISO = () => isoDate(logicalNow());

export function addDays(iso, amount) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + amount);
  return isoDate(d);
}

export function addMonths(date, amount) {
  const d = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  return d;
}

/** 1 = Monday … 7 = Sunday */
export const isoWeekday = (iso) => ((parseISO(iso).getDay() + 6) % 7) + 1;

export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);

export function startOfWeek(iso, weekStart = 1) {
  const shift = (isoWeekday(iso) - weekStart + 7) % 7;
  return addDays(iso, -shift);
}

export function weekDates(iso, weekStart = 1) {
  const start = startOfWeek(iso, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const monthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

export function monthMatrix(year, month, weekStart = 1) {
  const first = new Date(year, month, 1);
  const start = startOfWeek(isoDate(first), weekStart);
  return Array.from({ length: 42 }, (_, i) => {
    const iso = addDays(start, i);
    const d = parseISO(iso);
    return { iso, day: d.getDate(), inMonth: d.getMonth() === month, month: d.getMonth() };
  });
}

export function formatDate(iso, lang = 'en', options = { weekday: 'long', day: 'numeric', month: 'long' }) {
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', options).format(parseISO(iso));
  } catch {
    return iso;
  }
}

export function formatMonth(date, lang = 'en') {
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { month: 'long', year: 'numeric' }).format(date);
  } catch {
    return `${date.getMonth() + 1}/${date.getFullYear()}`;
  }
}

export function weekdayShort(iso, lang = 'en') {
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { weekday: 'short' }).format(parseISO(iso));
  } catch {
    return '';
  }
}

export function relativeDay(iso, lang = 'en') {
  const delta = daysBetween(todayISO(), iso);
  if (delta === 0) return lang === 'ar' ? 'اليوم' : 'Today';
  if (delta === -1) return lang === 'ar' ? 'أمس' : 'Yesterday';
  if (delta === 1) return lang === 'ar' ? 'غداً' : 'Tomorrow';
  return formatDate(iso, lang, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${pad2(m)}:${pad2(sec)}`;
  return `${pad2(m)}:${pad2(sec)}`;
}

export function formatDuration(seconds, lang = 'en') {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return lang === 'ar' ? `${mins} د` : `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return lang === 'ar' ? `${h} س` : `${h} h`;
  return lang === 'ar' ? `${h} س ${m} د` : `${h}h ${m}m`;
}

/* --------------------------------------------------------------------------
   Hijri (tabular Islamic calendar) — used by the "Hijri edition".
   Observed calendars can differ by a day; the app labels it as an estimate.
   -------------------------------------------------------------------------- */

/** Julian day number for a Gregorian calendar day (integer, noon-based). */
function gregorianToJDN(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4)
    - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function jdnToGregorian(jdn) {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1,
  };
}

/** Julian day number for a Hijri day (months outside 1–12 roll into the year). */
/* Live Umm al-Qura / Saudi calendar data, wired by hijri-sync.js. */
let hijriOffsetDays = 0;
let monthLookup = null;
let dateLookup = null;

export function setHijriOffset(days) {
  hijriOffsetDays = Math.trunc(Number(days) || 0);
}

export const getHijriOffset = () => hijriOffsetDays;

export function setHijriMonthLookup(fn) {
  monthLookup = typeof fn === 'function' ? fn : null;
}

export function setHijriDateLookup(fn) {
  dateLookup = typeof fn === 'function' ? fn : null;
}

function monthData(year, month) {
  try {
    return monthLookup ? monthLookup(year, month) : null;
  } catch {
    return null;
  }
}

/** Raw tabular conversion (no offset, no remote data) - used by the sync. */
export function rawToHijri(date = new Date()) {
  return tabularFromJDN(gregorianToJDN(date.getFullYear(), date.getMonth() + 1, date.getDate()));
}

/** Sequential day number of a Hijri date in the tabular scale (sync math). */
export const hijriDayNumber = (year, month, day) => hijriToJDN(year, month, day);

function hijriToJDN(year, month, day) {
  let y = year;
  let m = month;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return day + Math.ceil(29.5 * (m - 1)) + (y - 1) * 354
    + Math.floor((3 + 11 * y) / 30) + 1948440 - 1;
}

export function toHijri(date = new Date()) {
  const iso = isoDate(date);
  if (dateLookup) {
    try {
      const hit = dateLookup(iso);
      if (hit) return hit;
    } catch { /* ignore remote cache errors */ }
  }
  const jdn = gregorianToJDN(date.getFullYear(), date.getMonth() + 1, date.getDate()) + hijriOffsetDays;
  return tabularFromJDN(jdn);
}

function tabularFromJDN(jdn) {
  let l = jdn - 1948440 + 10632;
  const n = Math.floor((l - 1) / 10631);
  l = l - 10631 * n + 354;
  const j =
    Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) +
    Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
  l =
    l -
    Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
    Math.floor(j / 16) * Math.floor((15238 * j) / 43) +
    29;

  const m = Math.floor((24 * l) / 709);
  const d = l - Math.floor((709 * m) / 24);
  const y = 30 * n + j - 30;
  return { year: y, month: m, day: d };
}

const HIJRI_MONTHS_EN = [
  'Muharram', 'Safar', "Rabi' al-Awwal", "Rabi' al-Thani", 'Jumada al-Ula', 'Jumada al-Akhirah',
  'Rajab', "Sha'ban", 'Ramadan', 'Shawwal', "Dhu al-Qi'dah", 'Dhu al-Hijjah',
];
const HIJRI_MONTHS_AR = [
  'محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة',
  'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة',
];
const HIJRI_MONTHS_EN_SHORT = [
  'Muh', 'Saf', 'Rab I', 'Rab II', 'Jum I', 'Jum II', 'Raj', 'Sha', 'Ram', 'Shaw', 'Qid', 'Hij',
];

export function hijriLabel(iso, lang = 'en', short = false) {
  const { year, month, day } = toHijri(parseISO(iso));
  const months = lang === 'ar' ? HIJRI_MONTHS_AR : short ? HIJRI_MONTHS_EN_SHORT : HIJRI_MONTHS_EN;
  return lang === 'ar'
    ? `${day} ${months[month - 1]} ${year} هـ`
    : `${day} ${months[month - 1]} ${year} AH`;
}

export function hijriMonthName(month, lang = 'en') {
  const months = lang === 'ar' ? HIJRI_MONTHS_AR : HIJRI_MONTHS_EN;
  return months[((month - 1) % 12 + 12) % 12];
}

export function formatHijriMonth(year, month, lang = 'en') {
  const name = hijriMonthName(month, lang);
  return lang === 'ar' ? `${name} ${year} هـ` : `${name} ${year} AH`;
}

/** Inverse of `toHijri`: the ISO day for a Hijri (tabular) date. */
export function hijriToISO(year, month, day) {
  const info = monthData(year, month);
  if (info && info.start) return addDays(info.start, day - 1);
  const g = jdnToGregorian(hijriToJDN(year, month, day) - hijriOffsetDays);
  return `${g.year}-${pad2(g.month)}-${pad2(g.day)}`;
}

export function shiftHijriMonth(year, month, delta) {
  const index = year * 12 + (month - 1) + delta;
  const y = Math.floor(index / 12);
  return { year: y, month: index - y * 12 + 1 };
}

export function hijriMonthLength(year, month) {
  const info = monthData(year, month);
  if (info && info.length) return info.length;
  return hijriToJDN(year, month + 1, 1) - hijriToJDN(year, month, 1);
}

/** Grid of ISO days covering a Hijri month, aligned to the chosen week start. */
export function hijriMonthMatrix(year, month, weekStart = 1) {
  const first = hijriToISO(year, month, 1) || todayISO();
  const start = startOfWeek(first, weekStart);
  return Array.from({ length: 42 }, (_, i) => {
    const iso = addDays(start, i);
    const h = toHijri(parseISO(iso));
    return { iso, day: h.day, inMonth: h.year === year && h.month === month, month: h.month };
  });
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
