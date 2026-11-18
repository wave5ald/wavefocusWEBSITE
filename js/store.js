/* ==========================================================================
   Wave Focus — data store
   A tiny observable store persisted in localStorage. All data stays on device.
   ========================================================================== */

import {
  addDays, daysBetween, isoDate, isoWeekday, parseISO, setDayStart, todayISO, weekDates, clamp,
} from './dates.js';

const STORAGE_KEY = 'wavefocus.pwa.v2';
const SCHEMA_VERSION = 2;
const DAY_MS = 86400000;

export const CATEGORY_COLORS = [
  '#10B981', '#6366F1', '#14B8A6', '#F97316', '#F43F5E', '#38BDF8', '#A855F7', '#EAB308',
  '#22C55E', '#84CC16', '#F59E0B', '#EF4444', '#EC4899', '#D946EF', '#8B5CF6', '#3B82F6',
  '#0EA5E9', '#06B6D4', '#64748B', '#78716C',
];
export const SLOTS = ['Morning', 'Afternoon', 'Evening', 'Anytime'];
export const QUEST_TYPES = ['daily', 'milestone', 'epic', 'focus'];
export const NOTE_COLORS = ['#1E293B', '#0F766E', '#7C2D12', '#4C1D95', '#164E63', '#831843'];

const listeners = new Set();
let saveTimer = null;

/* ------------------------------- state ---------------------------------- */

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function seedState() {
  const today = todayISO();
  const created = isoDate(new Date(Date.now() - 21 * DAY_MS));

  const makeTask = (title, category, slot, minutes, order) => ({
    id: uid('t'),
    title,
    category,
    timeOfDay: slot,
    targetMinutes: minutes,
    repeatType: 'weekly',
    days: [1, 2, 3, 4, 5, 6, 7],
    intervalDays: 2,
    anchor: created,
    note: '',
    active: true,
    createdAt: created,
    order,
  });

  return {
    v: SCHEMA_VERSION,
    settings: {
      theme: 'system',
      hue: 0,
      lang: 'en',
      edition: 'standard',
      weekStart: 1,
      notifications: false,
      haptics: true,
      onboarded: false,
      dayReset: '00:00',
      hijriSync: true,
    },
    categories: [
      { name: 'Health', color: '#10B981' },
      { name: 'Focus', color: '#6366F1' },
      { name: 'Mind', color: '#14B8A6' },
      { name: 'Productivity', color: '#F97316' },
      { name: 'Habit', color: '#F43F5E' },
    ],
    tasks: [
      makeTask('Morning walk', 'Health', 'Morning', 20, 0),
      makeTask('Hydrate & vitamins', 'Health', 'Morning', 5, 1),
      makeTask('Deep work block', 'Productivity', 'Anytime', 60, 2),
      makeTask('Read 20 pages', 'Mind', 'Anytime', 20, 3),
      makeTask('Journal & reflect', 'Mind', 'Evening', 10, 4),
      makeTask('Screen-free wind-down', 'Habit', 'Evening', 30, 5),
    ],
    completions: {},
    sessions: [],
    quests: [
      {
        id: uid('q'),
        date: today,
        title: 'Set up my Wave Focus routine',
        emoji: '🌊',
        type: 'daily',
        target: '15 min',
        xp: 50,
        done: false,
        createdAt: Date.now(),
      },
    ],
    notes: [
      {
        id: uid('n'),
        title: 'Welcome to Wave Focus',
        content: 'Your routine resets every day, so there is always a clean slate.\n\nTick tasks to build a streak, run a focus session, and check Progress to see your week. Install the app from Settings to run it full-screen without a browser bar.',
        color: '#1E293B',
        pinned: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    boards: [
      {
        id: uid('b'),
        title: 'Ideas',
        emoji: '💡',
        color: '#0F766E',
        cards: [
          { id: uid('c'), text: 'Plan tomorrow before winding down', done: false },
          { id: uid('c'), text: 'Try a 50-minute deep work block', done: false },
        ],
        createdAt: Date.now(),
      },
    ],
  };
}

function normalize(raw) {
  const base = seedState();
  if (!raw || typeof raw !== 'object') return base;
  const state = {
    ...base,
    ...raw,
    settings: { ...base.settings, ...(raw.settings || {}) },
    categories: Array.isArray(raw.categories) && raw.categories.length ? raw.categories : base.categories,
    tasks: Array.isArray(raw.tasks) ? raw.tasks : base.tasks,
    completions: raw.completions && typeof raw.completions === 'object' ? raw.completions : {},
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    quests: Array.isArray(raw.quests) ? raw.quests : [],
    notes: Array.isArray(raw.notes) ? raw.notes : [],
    boards: Array.isArray(raw.boards) ? raw.boards : [],
  };
  state.v = SCHEMA_VERSION;
  return state;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('wavefocus.pwa.v1');
    if (!raw) return seedState();
    return normalize(JSON.parse(raw));
  } catch (err) {
    console.warn('[wavefocus] could not read local data, starting fresh', err);
    return seedState();
  }
}

export const state = load();

/* Apply the saved "tasks reset at" time before any "today" is computed. */
const resetMinutesOf = (value) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return 0;
  return Math.min(23, Number(match[1])) * 60 + Math.min(59, Number(match[2]));
};

export const resetMinutes = () => resetMinutesOf(state.settings.dayReset);

setDayStart(resetMinutes());

/** Change the daily reset time ("HH:MM", 24h). */
export function setDayResetTime(value) {
  const normalized = /^\d{1,2}:\d{2}$/.test(String(value || '')) ? String(value) : '00:00';
  setSetting({ dayReset: normalized });
  setDayStart(resetMinutesOf(normalized));
  currentDay = todayISO();
  ui.selectedDate = currentDay;
  emit('day-reset');
}

/** Human label for a reset time value. */
export function resetTimeLabel(value = state.settings.dayReset) {
  const mins = resetMinutesOf(value);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/* ----------------------------- persistence ------------------------------ */

export function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  state.updatedAt = Date.now();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[wavefocus] save failed', err);
    emit('storage-error', err);
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 120);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(type = 'change', detail) {
  listeners.forEach((fn) => {
    try { fn(type, detail); } catch (err) { console.error(err); }
  });
}

function commit(type = 'change', detail) {
  scheduleSave();
  emit(type, detail);
}

/* ------------------------------- helpers -------------------------------- */

/** Ephemeral UI state (not persisted). */
export const ui = {
  tab: 'routine',
  selectedDate: todayISO(),
  filter: 'All',
  calendarCursor: new Date(),
  focusMode: 'pomodoro',
  linkedTaskId: null,
  noteFilter: 'notes',
  activeBoardId: null,
  progressRange: 7,
  sheet: null,
};

export const categoryColor = (name) => {
  const found = state.categories.find((c) => c.name === name);
  return found ? found.color : '#38BDF8';
};

export const taskById = (id) => state.tasks.find((task) => task.id === id) || null;

export function isTaskDue(task, date) {
  if (!task || task.active === false) return false;
  const created = task.createdAt ? isoDate(new Date(task.createdAt)) : '1970-01-01';
  if (created > date) return false;
  if (task.repeatType === 'interval') {
    const anchor = task.anchor || created;
    const diff = daysBetween(anchor, date);
    const step = Math.max(1, Number(task.intervalDays) || 1);
    return diff >= 0 && diff % step === 0;
  }
  if (task.repeatType === 'once') {
    return (task.anchor || created) === date;
  }
  if (task.repeatType === 'weekend') {
    const dow = isoWeekday(date);
    return dow === 6 || dow === 7;
  }
  const days = Array.isArray(task.days) && task.days.length ? task.days : [1, 2, 3, 4, 5, 6, 7];
  return days.includes(isoWeekday(date));
}

export function dueTasks(date, { filter = 'All' } = {}) {
  return state.tasks
    .filter((task) => isTaskDue(task, date))
    .filter((task) => filter === 'All' || task.category === filter)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function completedIds(date) {
  const list = state.completions[date];
  return Array.isArray(list) ? list : [];
}

export const isCompleted = (date, taskId) => completedIds(date).includes(taskId);

export function dayStats(date, { filter } = {}) {
  const tasks = dueTasks(date, { filter });
  const done = tasks.filter((task) => isCompleted(date, task.id));
  const plannedMinutes = tasks.reduce((sum, task) => sum + (Number(task.targetMinutes) || 0), 0);
  const doneMinutes = done.reduce((sum, task) => sum + (Number(task.targetMinutes) || 0), 0);
  return {
    date,
    total: tasks.length,
    done: done.length,
    rate: tasks.length ? Math.round((done.length / tasks.length) * 100) : 0,
    plannedMinutes,
    doneMinutes,
  };
}

export function taskStreak(taskId, until = todayISO()) {
  const task = taskById(taskId);
  if (!task) return 0;
  let streak = 0;
  let cursor = until;
  let guard = 0;
  while (guard < 365) {
    guard += 1;
    const due = isTaskDue(task, cursor);
    if (!due) {
      cursor = addDays(cursor, -1);
      continue;
    }
    if (isCompleted(cursor, taskId)) {
      streak += 1;
      cursor = addDays(cursor, -1);
      continue;
    }
    // Today still has a chance; it should not break an existing streak.
    if (cursor === todayISO()) {
      cursor = addDays(cursor, -1);
      continue;
    }
    break;
  }
  return streak;
}

function perfectDay(date) {
  const stats = dayStats(date);
  return stats.total > 0 && stats.done === stats.total;
}

export function currentStreak() {
  let streak = 0;
  let cursor = todayISO();
  if (!perfectDay(cursor)) cursor = addDays(cursor, -1); // today can still be finished
  let guard = 0;
  while (guard < 365 && perfectDay(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
    guard += 1;
  }
  return streak;
}

export function bestStreak() {
  const dates = new Set(Object.keys(state.completions));
  state.tasks.forEach((task) => dates.add(task.createdAt ? isoDate(new Date(task.createdAt)) : todayISO()));
  if (!dates.size) return 0;
  const sorted = [...dates].sort();
  let cursor = sorted[0];
  const today = todayISO();
  let best = 0;
  let run = 0;
  let guard = 0;
  while (cursor <= today && guard < 4000) {
    if (perfectDay(cursor)) {
      run += 1;
      best = Math.max(best, run);
    } else if (dayStats(cursor).total > 0) {
      run = 0;
    }
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return best;
}

export function perfectDayCount(days = 365) {
  let count = 0;
  let cursor = todayISO();
  for (let i = 0; i < days; i += 1) {
    if (perfectDay(cursor)) count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export function totalCompletions() {
  return Object.values(state.completions).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
}

export function coins() {
  const completions = totalCompletions() * 10;
  const quests = state.quests.filter((q) => q.done).length * 25;
  const sessions = state.sessions.length * 5;
  return completions + quests + sessions;
}

export function totalFocusSeconds(date) {
  const sessions = date ? state.sessions.filter((s) => s.date === date) : state.sessions;
  return sessions.reduce((sum, s) => sum + (Number(s.seconds) || 0), 0);
}

export function sessionsFor(date) {
  return state.sessions.filter((s) => s.date === date).sort((a, b) => b.endedAt - a.endedAt);
}

export function lastNDays(n = 7, end = todayISO()) {
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(end, -(n - 1 - i));
    const stats = dayStats(date);
    return { ...stats, perfect: stats.total > 0 && stats.done === stats.total };
  });
}

export function weekdayCompletion(days = 7) {
  const window = lastNDays(days);
  const buckets = Array.from({ length: 7 }, () => ({ done: 0, total: 0 }));
  window.forEach((day) => {
    const dow = isoWeekday(day.date); // 1..7
    buckets[dow - 1].done += day.done;
    buckets[dow - 1].total += day.total;
  });
  return buckets.map((b) => (b.total ? Math.round((b.done / b.total) * 100) : 0));
}

export function categoryStats() {
  const counts = {};
  state.categories.forEach((c) => { counts[c.name] = 0; });
  Object.keys(state.completions).forEach((date) => {
    completedIds(date).forEach((id) => {
      const task = taskById(id);
      if (task) counts[task.category] = (counts[task.category] || 0) + 1;
    });
  });
  return state.categories
    .map((c) => ({ ...c, count: counts[c.name] || 0 }))
    .sort((a, b) => b.count - a.count);
}

export function totalActiveTasks() {
  return state.tasks.filter((task) => task.active !== false).length;
}

export function isPerfect(date) {
  return perfectDay(date);
}

export function marksForDate(date) {
  const tasks = state.tasks.some((task) => isTaskDue(task, date));
  const quests = state.quests.filter((q) => q.date === date).length > 0;
  const notes = state.notes.some((n) => (n.date || (n.createdAt ? isoDate(new Date(n.createdAt)) : '')) === date);
  return { tasks, quests, notes };
}

export function questsFor(date) {
  return state.quests.filter((q) => q.date === date).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export function notesFor(date) {
  return state.notes.filter((n) => (n.date || (n.createdAt ? isoDate(new Date(n.createdAt)) : '')) === date);
}

export function boardCardsDone(board) {
  return board.cards.filter((card) => card.done).length;
}

/* ------------------------------- actions -------------------------------- */

export function setSetting(patch) {
  state.settings = { ...state.settings, ...patch };
  commit('settings', patch);
}

export function toggleTask(date, taskId) {
  const list = completedIds(date).slice();
  const index = list.indexOf(taskId);
  let completed;
  if (index >= 0) {
    list.splice(index, 1);
    completed = false;
  } else {
    list.push(taskId);
    completed = true;
  }
  state.completions = { ...state.completions, [date]: list };
  if (!list.length) delete state.completions[date];
  commit(completed ? 'task-completed' : 'task-uncompleted', { date, taskId });
  return completed;
}

export function clearCompleted(date) {
  const tasks = dueTasks(date);
  const remaining = completedIds(date).filter((id) => !tasks.some((task) => task.id === id));
  if (remaining.length) state.completions[date] = remaining;
  else delete state.completions[date];
  commit('day-cleared', { date });
}

export function saveTask(task) {
  const now = Date.now();
  if (task.id) {
    const index = state.tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) {
      state.tasks[index] = { ...state.tasks[index], ...task };
    } else {
      state.tasks.push({ ...task, id: uid('t') });
    }
  } else {
    state.tasks.push({
      ...task,
      id: uid('t'),
      createdAt: isoDate(new Date(now)),
      order: state.tasks.length,
      active: true,
    });
  }
  commit('task-saved', task);
}

export function deleteTask(taskId) {
  state.tasks = state.tasks.filter((task) => task.id !== taskId);
  Object.keys(state.completions).forEach((date) => {
    const list = completedIds(date).filter((id) => id !== taskId);
    if (list.length) state.completions[date] = list;
    else delete state.completions[date];
  });
  commit('task-deleted', taskId);
}

export function addCategory(name, color) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  if (state.categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) return null;
  const palette = CATEGORY_COLORS;
  const used = new Set(state.categories.map((c) => c.color));
  const pick = color || palette.find((c) => !used.has(c)) || palette[state.categories.length % palette.length];
  const category = { name: trimmed, color: pick };
  state.categories.push(category);
  commit('category-added', category);
  return category;
}

export function saveQuest(quest) {
  if (quest.id) {
    const index = state.quests.findIndex((q) => q.id === quest.id);
    if (index >= 0) state.quests[index] = { ...state.quests[index], ...quest };
  } else {
    state.quests.push({ ...quest, id: uid('q'), createdAt: Date.now() });
  }
  commit('quest-saved', quest);
}

export function toggleQuest(id) {
  const quest = state.quests.find((q) => q.id === id);
  if (!quest) return;
  quest.done = !quest.done;
  quest.completedAt = quest.done ? Date.now() : null;
  commit('quest-toggled', quest);
}

export function deleteQuest(id) {
  state.quests = state.quests.filter((q) => q.id !== id);
  commit('quest-deleted', id);
}

export function saveNote(note) {
  if (note.id) {
    const index = state.notes.findIndex((n) => n.id === note.id);
    if (index >= 0) state.notes[index] = { ...state.notes[index], ...note, updatedAt: Date.now() };
  } else {
    state.notes.push({ ...note, id: uid('n'), createdAt: Date.now(), updatedAt: Date.now() });
  }
  commit('note-saved', note);
}

export function deleteNote(id) {
  state.notes = state.notes.filter((n) => n.id !== id);
  commit('note-deleted', id);
}

export function toggleNotePin(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  note.pinned = !note.pinned;
  commit('note-pinned', note);
}

export function saveBoard(board) {
  if (board.id) {
    const index = state.boards.findIndex((b) => b.id === board.id);
    if (index >= 0) state.boards[index] = { ...state.boards[index], ...board };
  } else {
    state.boards.push({
      ...board,
      id: uid('b'),
      cards: board.cards || [],
      createdAt: Date.now(),
    });
  }
  commit('board-saved', board);
}

export function deleteBoard(id) {
  state.boards = state.boards.filter((b) => b.id !== id);
  if (ui.activeBoardId === id) ui.activeBoardId = null;
  commit('board-deleted', id);
}

export function addBoardCard(boardId, text) {
  const board = state.boards.find((b) => b.id === boardId);
  if (!board || !String(text || '').trim()) return;
  board.cards = board.cards || [];
  board.cards.push({ id: uid('c'), text: String(text).trim(), done: false });
  commit('board-card-added', { boardId });
}

export function toggleBoardCard(boardId, cardId) {
  const board = state.boards.find((b) => b.id === boardId);
  if (!board) return;
  const card = board.cards.find((c) => c.id === cardId);
  if (!card) return;
  card.done = !card.done;
  commit('board-card-toggled', { boardId, cardId });
}

export function deleteBoardCard(boardId, cardId) {
  const board = state.boards.find((b) => b.id === boardId);
  if (!board) return;
  board.cards = board.cards.filter((c) => c.id !== cardId);
  commit('board-card-deleted', { boardId, cardId });
}

export function addSession(session) {
  state.sessions.push({
    id: uid('s'),
    date: session.date || todayISO(),
    seconds: Math.round(session.seconds),
    mode: session.mode || 'Pomodoro',
    taskId: session.taskId || null,
    taskTitle: session.taskTitle || '',
    endedAt: Date.now(),
  });
  commit('session-added', session);
}

export function markOnboarded() {
  state.settings.onboarded = true;
  commit('onboarded');
}

/* ------------------------------- backup --------------------------------- */

export function exportJSON() {
  return JSON.stringify({ app: 'wavefocus', schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: state }, null, 2);
}

export function importJSON(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('invalid-json');
  }
  const payload = parsed && parsed.data ? parsed.data : parsed;
  if (!payload || !Array.isArray(payload.tasks)) throw new Error('invalid-backup');
  const next = normalize(payload);
  Object.keys(state).forEach((key) => { delete state[key]; });
  Object.assign(state, next);
  saveNow();
  emit('imported');
  return true;
}

export function resetAll() {
  const fresh = seedState();
  fresh.settings = { ...fresh.settings, theme: state.settings.theme, lang: state.settings.lang, onboarded: true };
  fresh.tasks = [];
  fresh.notes = [];
  fresh.boards = [];
  fresh.quests = [];
  fresh.completions = {};
  fresh.sessions = [];
  Object.keys(state).forEach((key) => { delete state[key]; });
  Object.assign(state, fresh);
  ui.selectedDate = todayISO();
  ui.filter = 'All';
  saveNow();
  emit('reset');
}

export function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
  return navigator.storage.persisted().then((already) => already || navigator.storage.persist());
}

/* Keep the app day-aware: when the clock rolls past midnight, refresh views. */
let currentDay = todayISO();
export function checkDayRollover() {
  const now = todayISO();
  if (now !== currentDay) {
    currentDay = now;
    if (!state.completions[now]) ui.selectedDate = now;
    emit('day-rollover', now);
  }
}

export const util = { clamp, weekDates, parseISO };
