/* Schedule screen — month calendar, quests and daily notes. */

import { icon } from '../icons.js';
import { t, tn } from '../i18n.js';
import {
  addDays, formatDate, formatHijriMonth, formatMonth, hijriLabel, hijriMonthMatrix, hijriToISO,
  monthMatrix, parseISO, shiftHijriMonth, todayISO, toHijri, weekdayShort,
} from '../dates.js';
import {
  deleteQuest, marksForDate, notesFor, questsFor, saveQuest, state, toggleQuest, ui,
} from '../store.js';
import { confirmDialog, escapeAttr, escapeHtml, haptic, openSheet, toast } from '../ui.js';
import { openNoteEditor } from '../editors/note.js';

const EMOJIS = ['🌊', '🎯', '📚', '🏋️', '🧘', '💡', '✍️', '🚀', '🌙', '🧠', '💧', '🔥'];
export const fab = {
  label: () => t('addQuest'),
  action: () => openQuestEditor(),
};

export function render() {
  const lang = state.settings.lang;
  const date = ui.selectedDate;
  const cursor = ui.calendarCursor instanceof Date ? ui.calendarCursor : parseISO(date);
  const weekStart = state.settings.weekStart;
  const hijri = state.settings.edition === 'hijri';
  const hijriCursor = hijri ? toHijri(cursor) : null;
  const matrix = hijri
    ? hijriMonthMatrix(hijriCursor.year, hijriCursor.month, weekStart)
    : monthMatrix(cursor.getFullYear(), cursor.getMonth(), weekStart);
  const marks = new Map(matrix.map((cell) => [cell.iso, marksForDate(cell.iso)]));
  const quests = questsFor(date);
  const notes = notesFor(date);
  const total = quests.length + notes.length;

  const headers = Array.from({ length: 7 }, (_, index) => {
    const dow = ((weekStart - 1 + index) % 7) + 1;
    return weekdayShort(addDays('2024-01-01', dow - 1), lang); // 2024-01-01 is a Monday
  });

  const monthTitle = hijri
    ? formatHijriMonth(hijriCursor.year, hijriCursor.month, lang)
    : formatMonth(cursor, lang);
  const headingMain = hijri ? hijriLabel(date, lang) : formatDate(date, lang);
  const headingSub = hijri
    ? `${formatDate(date, lang)} · ${tn('itemsCount', total)}`
    : tn('itemsCount', total);

  return `
    <div class="stack">
      <section class="card card--flat">
        <div class="card__head" style="margin-bottom:6px">
          <div>
            <div class="card__title">${escapeHtml(monthTitle)}</div>
            ${hijri ? `<div class="tiny muted">${escapeHtml(formatMonth(cursor, lang))}</div>` : ''}
          </div>
          <div class="row" style="gap:4px">
            <button class="icon-btn icon-btn--sm" type="button" data-month="-1" aria-label="${t('previous')}">${icon('chevronLeft')}</button>
            <button class="btn btn--tiny btn--tonal" type="button" data-month-today>${t('today')}</button>
            <button class="icon-btn icon-btn--sm" type="button" data-month="1" aria-label="${t('next')}">${icon('chevronRight')}</button>
          </div>
        </div>

        <div class="cal" role="grid">
          ${headers.map((label) => `<div class="cal__dow" role="columnheader">${escapeHtml(label)}</div>`).join('')}
          ${matrix.map((cell) => {
            const classes = ['cal__cell'];
            if (!cell.inMonth) classes.push('is-out');
            if (cell.iso === todayISO()) classes.push('is-today');
            if (cell.iso === date) classes.push('is-selected');
            const mark = marks.get(cell.iso) || {};
            const extra = mark.quests || mark.notes;
            const dots = `${mark.tasks ? '<i class="cal__dot cal__dot--tasks"></i>' : ''}${extra ? '<i class="cal__dot cal__dot--extra"></i>' : ''}`;
            if (dots) classes.push('has-dots');
            const label = hijri ? hijriLabel(cell.iso, lang) : formatDate(cell.iso, lang);
            return `<button class="${classes.join(' ')}" type="button" role="gridcell" data-cal-day="${cell.iso}" aria-label="${escapeAttr(label)}" aria-selected="${cell.iso === date}"><span class="cal__num">${cell.day}</span>${dots ? `<span class="cal__dots" aria-hidden="true">${dots}</span>` : ''}</button>`;
          }).join('')}
        </div>
      </section>

      <section class="date-head">
        <div>
          <div class="date-head__main">${escapeHtml(headingMain)}</div>
          <div class="date-head__sub">${escapeHtml(headingSub)}</div>
        </div>
        <button class="btn btn--tiny btn--tonal" type="button" data-add-quest>${icon('plus')}${t('addQuest')}</button>
      </section>

      <section class="stack stack--tight">
        <div class="group-label">${t('quests')}</div>
        ${quests.length
          ? quests.map(questCard).join('')
          : `<div class="empty" style="padding:20px">
               <span class="empty__emoji">🎯</span>
               <div class="small">${escapeHtml(t('noQuestsHint'))}</div>
             </div>`}
      </section>

      <section class="stack stack--tight">
        <div class="group-label">${t('dayNotes')}</div>
        ${notes.length
          ? notes.map(noteCard).join('')
          : `<div class="empty" style="padding:20px">
               <span class="empty__emoji">📝</span>
               <div class="small">${escapeHtml(t('noNotes'))}</div>
             </div>`}
        <button class="btn btn--outline btn--block" type="button" data-add-note>${icon('plus')}${t('addNote')}</button>
      </section>
    </div>`;
}

function questCard(quest) {
  const typeLabel = {
    daily: 'dailyQuest', milestone: 'milestoneGoal', epic: 'epicChallenge', focus: 'focusTarget',
  }[quest.type] || 'dailyQuest';

  return `
    <article class="quest ${quest.done ? 'is-done' : ''}" data-quest="${escapeAttr(quest.id)}">
      <span class="quest__emoji">${escapeHtml(quest.emoji || '🎯')}</span>
      <div style="min-width:0">
        <div class="quest__title">${escapeHtml(quest.title)}</div>
        <div class="quest__meta">
          <span>${escapeHtml(t(typeLabel))}</span>
          ${quest.target ? `<span>· ${escapeHtml(quest.target)}</span>` : ''}
          <span class="xp">+${Number(quest.xp) || 50} XP</span>
        </div>
      </div>
      <div class="row" style="gap:2px">
        <button class="icon-btn icon-btn--sm" type="button" data-edit-quest="${escapeAttr(quest.id)}" aria-label="${t('edit')}">${icon('edit')}</button>
        <button class="check-round" type="button" data-toggle-quest="${escapeAttr(quest.id)}" aria-checked="${quest.done}" role="checkbox" aria-label="${t('completeQuest')}">${icon('check')}</button>
      </div>
    </article>`;
}

function noteCard(note) {
  const color = note.color || '#1E293B';
  return `
    <article class="note" style="--note-bg:${escapeAttr(color)};--note-fg:#F8FAFC" data-note="${escapeAttr(note.id)}">
      ${note.pinned ? '<span class="note__pin">📌</span>' : ''}
      <div class="note__title">${escapeHtml(note.title || t('untitled'))}</div>
      <div class="note__body">${escapeHtml(note.content || '')}</div>
      <div class="note__time">${escapeHtml(timeOf(note.updatedAt || note.createdAt))}</div>
    </article>`;
}

function timeOf(timestamp) {
  if (!timestamp) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

export function mount(root) {
  const hijri = state.settings.edition === 'hijri';

  root.querySelectorAll('[data-cal-day]').forEach((button) => {
    button.addEventListener('click', () => {
      ui.selectedDate = button.dataset.calDay;
      const day = parseISO(ui.selectedDate);
      if (hijri) {
        const picked = toHijri(day);
        const shown = toHijri(ui.calendarCursor);
        if (picked.year !== shown.year || picked.month !== shown.month) {
          ui.calendarCursor = parseISO(hijriToISO(picked.year, picked.month, 1) || ui.selectedDate);
        }
      } else if (day.getMonth() !== ui.calendarCursor.getMonth() || day.getFullYear() !== ui.calendarCursor.getFullYear()) {
        ui.calendarCursor = new Date(day.getFullYear(), day.getMonth(), 1);
      }
      haptic(5);
      rerender(root);
    });
  });

  root.querySelectorAll('[data-month]').forEach((button) => {
    button.addEventListener('click', () => {
      const delta = Number(button.dataset.month);
      if (hijri) {
        const shown = toHijri(ui.calendarCursor);
        const next = shiftHijriMonth(shown.year, shown.month, delta);
        ui.calendarCursor = parseISO(hijriToISO(next.year, next.month, 1) || todayISO());
      } else {
        ui.calendarCursor = new Date(ui.calendarCursor.getFullYear(), ui.calendarCursor.getMonth() + delta, 1);
      }
      rerender(root);
    });
  });

  root.querySelector('[data-month-today]')?.addEventListener('click', () => {
    const today = todayISO();
    ui.selectedDate = today;
    ui.calendarCursor = new Date();
    rerender(root);
  });

  root.querySelector('[data-add-quest]')?.addEventListener('click', () => openQuestEditor());
  root.querySelector('[data-add-note]')?.addEventListener('click', () => openNoteEditor());

  root.querySelectorAll('[data-toggle-quest]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleQuest(button.dataset.toggleQuest);
      haptic(10);
      rerender(root);
    });
  });

  root.querySelectorAll('[data-edit-quest]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const quest = state.quests.find((q) => q.id === button.dataset.editQuest);
      if (quest) openQuestEditor(quest);
    });
  });

  root.querySelectorAll('[data-quest]').forEach((card) => {
    card.addEventListener('click', () => {
      const quest = state.quests.find((q) => q.id === card.dataset.quest);
      if (quest) openQuestEditor(quest);
    });
  });

  root.querySelectorAll('[data-note]').forEach((card) => {
    card.addEventListener('click', () => {
      const note = state.notes.find((n) => n.id === card.dataset.note);
      if (note) openNoteEditor(note);
    });
  });
}

function openQuestEditor(quest = null) {
  const isEdit = Boolean(quest);
  const defaults = {
    title: '',
    emoji: '🎯',
    type: 'daily',
    target: '',
    xp: 50,
    date: ui.selectedDate,
    ...quest,
  };
  const types = [['daily', 'dailyQuest'], ['milestone', 'milestoneGoal'], ['epic', 'epicChallenge'], ['focus', 'focusTarget']];

  openSheet({
    title: isEdit ? t('editQuest') : t('addQuest'),
    body: `
      <form id="questForm" class="stack" novalidate>
        <div class="field">
          <label for="questTitle">${t('questTitle')}</label>
          <input class="input" id="questTitle" maxlength="90" value="${escapeAttr(defaults.title)}" placeholder="${escapeAttr(t('questPlaceholder'))}" required>
        </div>

        <div class="field">
          <span class="field-label">${t('questEmoji')}</span>
          <div class="option-grid" id="emojiGrid" style="grid-template-columns:repeat(6,1fr)">
            ${EMOJIS.map((emoji) => `<button class="option ${emoji === defaults.emoji ? 'is-active' : ''}" type="button" data-emoji="${emoji}" style="font-size:1.05rem">${emoji}</button>`).join('')}
          </div>
        </div>

        <div class="field">
          <label for="questType">${t('questType')}</label>
          <select class="select" id="questType">
            ${types.map(([value, key]) => `<option value="${value}" ${value === defaults.type ? 'selected' : ''}>${escapeHtml(t(key))}</option>`).join('')}
          </select>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="questTarget">${t('target')}</label>
            <input class="input" id="questTarget" maxlength="40" value="${escapeAttr(defaults.target || '')}" placeholder="${escapeAttr(t('targetPlaceholder'))}">
          </div>
          <div class="field">
            <label for="questXp">${t('xp')}</label>
            <input class="input" id="questXp" type="number" inputmode="numeric" min="5" max="500" step="5" value="${Number(defaults.xp) || 50}">
          </div>
        </div>

        <div class="field">
          <label for="questDate">${t('schedule')}</label>
          <input class="input" id="questDate" type="date" value="${escapeAttr(defaults.date)}">
        </div>
      </form>`,
    foot: `${isEdit ? `<button class="btn btn--danger" type="button" data-delete>${icon('trash')}</button>` : ''}
           <button class="btn btn--outline" type="button" data-cancel>${t('cancel')}</button>
           <button class="btn btn--primary" type="submit" form="questForm">${t('saveQuest')}</button>`,
    onMount: (sheet, close) => {
      let emoji = defaults.emoji;
      sheet.querySelectorAll('[data-emoji]').forEach((button) => {
        button.addEventListener('click', () => {
          emoji = button.dataset.emoji;
          sheet.querySelectorAll('[data-emoji]').forEach((el) => el.classList.toggle('is-active', el === button));
        });
      });
      sheet.querySelector('[data-cancel]').addEventListener('click', close);
      sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: `${t('delete')} “${defaults.title}”?`,
          confirmLabel: t('delete'),
          cancelLabel: t('cancel'),
          danger: true,
        });
        if (ok) { deleteQuest(defaults.id); close(); toast(t('questDeleted')); }
      });
      sheet.querySelector('#questForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const input = sheet.querySelector('#questTitle');
        const title = input.value.trim();
        if (!title) { input.focus(); return; }
        const payload = {
          title,
          emoji,
          type: sheet.querySelector('#questType').value,
          target: sheet.querySelector('#questTarget').value.trim(),
          xp: Math.max(5, Number(sheet.querySelector('#questXp').value) || 50),
          date: sheet.querySelector('#questDate').value || ui.selectedDate,
        };
        if (isEdit) {
          payload.id = quest.id;
          payload.done = quest.done;
          payload.createdAt = quest.createdAt;
        }
        saveQuest(payload);
        ui.selectedDate = payload.date;
        close();
        toast(t('questSaved'));
      });
    },
  });
}

function rerender(root) {
  root.innerHTML = render();
  mount(root);
}
