#!/usr/bin/env node
/* ==========================================================================
   Convert an Android "Wave Focus" full backup into a PWA backup file.

   Usage:
     node tools/import-android-backup.mjs WAVE_FOCUS_BACKUP.json [out.json]

   The Android app writes a JSON file from Settings → Backup (type
   WAVE_FOCUS_FULL_BACKUP). This script maps it onto the PWA's state schema
   and writes a file you can load in the web app via
   More → Settings → Data & Backup → Import backup.
   ========================================================================== */

import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const PALETTE = ['#10B981', '#6366F1', '#14B8A6', '#F97316', '#F43F5E', '#38BDF8', '#A855F7', '#EAB308'];
const DAY = 86400000;

const isoFromEpochDay = (n) => {
  const days = Number(n);
  if (!Number.isFinite(days)) return null;
  return new Date(days * DAY).toISOString().slice(0, 10);
};

const isoFromMillis = (n) => {
  const ms = Number(n);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const str = (value) => (value == null ? '' : String(value));

const parseDays = (raw) => {
  const days = str(raw)
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  return days.length ? [...new Set(days)].sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6, 7];
};

const QUEST_TYPES = {
  'daily quest': 'daily',
  daily: 'daily',
  'milestone goal': 'milestone',
  milestone: 'milestone',
  'epic challenge': 'epic',
  epic: 'epic',
  'focus target': 'focus',
  focus: 'focus',
};

const MODES = {
  pomodoro: 'Pomodoro',
  deep: 'Deep Work',
  'deep work': 'Deep Work',
  break: 'Break',
  short: 'Break',
};

const uniqueId = (() => {
  const seen = new Map();
  return (prefix, raw) => {
    const key = `${prefix}:${raw}`;
    if (seen.has(key)) return seen.get(key);
    let id = `${prefix}${raw}`;
    let n = 2;
    while ([...seen.values()].includes(id)) id = `${prefix}${raw}_${n++}`;
    seen.set(key, id);
    return id;
  };
})();

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node tools/import-android-backup.mjs <android-backup.json> [out.json]');
    process.exit(1);
  }

  const raw = JSON.parse(await readFile(input, 'utf8'));
  if (raw.encryptedBackup) {
    throw new Error('This backup is encrypted. In the Android app choose "Export unencrypted" and try again.');
  }
  if (raw.type !== 'WAVE_FOCUS_FULL_BACKUP' && !Array.isArray(raw.tasks)) {
    throw new Error('Not a Wave Focus full backup (expected type WAVE_FOCUS_FULL_BACKUP).');
  }

  const warnings = [];

  /* ------------------------------- tasks -------------------------------- */
  const tasks = (raw.tasks || []).map((t) => {
    const anchor = isoFromEpochDay(t.startEpochDay) || '1970-01-01';
    const repeatType = str(t.repeatType).toUpperCase() === 'INTERVAL' ? 'interval' : 'weekly';
    return {
      id: uniqueId('a', t.id),
      title: str(t.title),
      category: str(t.category) || 'Health',
      timeOfDay: str(t.timeOfDay) || 'Morning',
      targetMinutes: Number(t.targetMinutes) || 0,
      repeatType,
      days: parseDays(t.daysOfWeek),
      intervalDays: Math.max(1, Number(t.repeatIntervalDays) || 1),
      anchor,
      note: '',
      active: t.isActive !== false,
      createdAt: anchor,
      order: Number(t.displayOrder) || 0,
    };
  });

  const idByNative = new Map((raw.tasks || []).map((t) => [String(t.id), uniqueId('a', t.id)]));
  const taskTitle = new Map((raw.tasks || []).map((t) => [String(t.id), str(t.title)]));

  /* ----------------------------- completions ---------------------------- */
  const completions = {};
  let completedLogs = 0;
  (raw.logs || []).forEach((log) => {
    if (log.isCompleted === false) return;
    const iso = isoFromEpochDay(log.dateEpochDay);
    const taskId = idByNative.get(String(log.taskId));
    if (!iso || !taskId) return;
    if (!completions[iso]) completions[iso] = [];
    if (!completions[iso].includes(taskId)) completions[iso].push(taskId);
    completedLogs += 1;
  });

  /* ------------------------------ sessions ------------------------------ */
  const sessions = (raw.focusSessions || []).map((s) => {
    const seconds = Number(s.durationSeconds) || 0;
    const endedAt = Number(s.completedAt) || Date.now();
    return {
      id: uniqueId('as', s.id),
      date: isoFromEpochDay(s.dateEpochDay) || isoFromMillis(endedAt) || '1970-01-01',
      seconds,
      mode: MODES[str(s.mode).toLowerCase()] || 'Pomodoro',
      taskId: s.taskId == null ? null : idByNative.get(String(s.taskId)) || null,
      taskTitle: str(s.taskTitle) || (s.taskId == null ? '' : taskTitle.get(String(s.taskId)) || ''),
      endedAt,
    };
  });

  /* ------------------------------- quests ------------------------------- */
  const quests = (raw.scripts || []).map((s) => {
    if (s.isEncrypted) warnings.push(`quest "${s.title}" was encrypted — only its title and type were kept`);
    const date = isoFromEpochDay(s.startDateEpochDay) || isoFromMillis(s.updatedAt) || '1970-01-01';
    return {
      id: uniqueId('aq', s.id),
      date,
      title: str(s.title) || 'Quest',
      emoji: str(s.emoji) || '🎯',
      type: QUEST_TYPES[str(s.questType).toLowerCase()] || 'daily',
      target: str(s.targetValue),
      xp: Number(s.xpReward) || 0,
      done: s.isCompleted === true,
      createdAt: Number(s.updatedAt) || Date.now(),
    };
  });

  /* ------------------------------- notes -------------------------------- */
  const notes = (raw.notes || []).filter((n) => n.boardId == null).map((n) => ({
    id: uniqueId('an', n.id),
    title: str(n.title),
    content: str(n.content),
    color: /^#[0-9a-f]{6}$/i.test(str(n.colorHex)) ? n.colorHex : '#1E293B',
    pinned: n.pinned === true,
    date: isoFromMillis(n.createdAt) || undefined,
    createdAt: Number(n.createdAt) || Date.now(),
    updatedAt: Number(n.updatedAt) || Number(n.createdAt) || Date.now(),
  }));

  /* ------------------------------- boards ------------------------------- */
  const elementsByBoard = new Map();
  (raw.boardElements || []).forEach((el) => {
    const key = String(el.boardId);
    if (!elementsByBoard.has(key)) elementsByBoard.set(key, []);
    elementsByBoard.get(key).push(el);
  });

  const notesByBoard = new Map();
  (raw.notes || []).filter((n) => n.boardId != null).forEach((n) => {
    const key = String(n.boardId);
    if (!notesByBoard.has(key)) notesByBoard.set(key, []);
    notesByBoard.get(key).push(n);
  });

  const boards = (raw.boards || []).map((b) => {
    const key = String(b.id);
    const cards = [];

    (elementsByBoard.get(key) || []).forEach((el) => {
      const text = str(el.text).trim();
      if (text) cards.push({ id: uniqueId('ac', el.id), text, done: false });
      else if (el.elementType === 'IMAGE') warnings.push(`board "${b.title}" had an image element — images are not imported`);
    });

    (notesByBoard.get(key) || []).forEach((n) => {
      const text = str(n.title).trim() || str(n.content).trim().split('\n')[0];
      if (text) cards.push({ id: uniqueId('ac', `note${n.id}`), text, done: false });
    });

    return {
      id: uniqueId('ab', b.id),
      title: str(b.title) || 'Board',
      emoji: '🧩',
      color: /^#[0-9a-f]{6}$/i.test(str(b.backgroundColorHex)) ? b.backgroundColorHex : '#0F766E',
      cards,
      createdAt: Number(b.createdAt) || Date.now(),
    };
  });

  /* ----------------------------- categories ----------------------------- */
  const names = [...new Set(tasks.map((t) => t.category).filter(Boolean))];
  const categories = names.map((name, index) => ({ name, color: PALETTE[index % PALETTE.length] }));

  const state = {
    v: 2,
    settings: {
      theme: 'system',
      lang: 'en',
      edition: 'standard',
      weekStart: 1,
      notifications: false,
      haptics: true,
      onboarded: true,
    },
    categories,
    tasks,
    completions,
    sessions,
    quests,
    notes,
    boards,
    updatedAt: Date.now(),
  };

  const backup = {
    app: 'wavefocus',
    schema: 2,
    exportedAt: new Date().toISOString(),
    source: 'android-backup',
    data: state,
  };

  const out = process.argv[3] || resolve(`${basename(input, '.json')}-pwa.json`);
  await writeFile(out, JSON.stringify(backup, null, 2), 'utf8');

  console.log('Wave Focus — Android backup converted');
  console.log(`  tasks        ${tasks.length}`);
  console.log(`  completions  ${completedLogs} logs on ${Object.keys(completions).length} days`);
  console.log(`  sessions     ${sessions.length}`);
  console.log(`  quests       ${quests.length}`);
  console.log(`  notes        ${notes.length}`);
  console.log(`  boards       ${boards.length} (${boards.reduce((n, b) => n + b.cards.length, 0)} cards)`);
  if (warnings.length) {
    console.log('\nSkipped / partial:');
    warnings.forEach((w) => console.log(`  - ${w}`));
  }
  console.log(`\nWrote ${out}`);
  console.log('Import it in the web app: More → Settings → Data & Backup → Import backup.');
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
