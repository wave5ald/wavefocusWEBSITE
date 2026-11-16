/* Shared note editor used by the Schedule and Notes screens. */

import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { deleteNote, saveNote, ui } from '../store.js';
import { confirmDialog, escapeAttr, escapeHtml, haptic, openSheet, toast } from '../ui.js';

export const NOTE_COLORS = ['#1E293B', '#0F766E', '#7C2D12', '#4C1D95', '#164E63', '#831843'];

export function openNoteEditor(note = null, { date = ui.selectedDate, showDate = true } = {}) {
  const isEdit = Boolean(note);
  const defaults = note || {
    title: '',
    content: '',
    color: NOTE_COLORS[0],
    pinned: false,
    date,
  };

  openSheet({
    title: isEdit ? t('editNote') : t('addNote'),
    body: `
      <form id="noteForm" class="stack" novalidate>
        <div class="field">
          <label for="noteTitle">${t('noteTitle')}</label>
          <input class="input" id="noteTitle" maxlength="80" value="${escapeAttr(defaults.title || '')}" placeholder="${escapeAttr(t('noteTitlePlaceholder'))}">
        </div>
        <div class="field">
          <label for="noteContent">${t('noteContent')}</label>
          <textarea class="textarea" id="noteContent" rows="6" maxlength="4000" placeholder="${escapeAttr(t('notePlaceholder'))}">${escapeHtml(defaults.content || '')}</textarea>
        </div>
        <div class="field">
          <span class="field-label">${t('noteColor')}</span>
          <div class="colorpick" id="noteColors">
            ${NOTE_COLORS.map((color) => `<button class="swatch ${color === defaults.color ? 'is-active' : ''}" type="button" data-color="${color}" style="--sw:${color}" aria-label="${color}"></button>`).join('')}
          </div>
        </div>
        <div class="switch-row">
          <span class="small strong">${t('pin')}</span>
          <button class="switch" type="button" role="switch" id="notePin" aria-checked="${defaults.pinned ? 'true' : 'false'}" aria-label="${t('pin')}"></button>
        </div>
        ${showDate ? `
          <div class="field">
            <label for="noteDate">${t('schedule')}</label>
            <input class="input" id="noteDate" type="date" value="${escapeAttr(defaults.date || date)}">
          </div>` : ''}
      </form>`,
    foot: `${isEdit ? `<button class="btn btn--danger" type="button" data-delete>${icon('trash')}</button>` : ''}
           <button class="btn btn--outline" type="button" data-cancel>${t('cancel')}</button>
           <button class="btn btn--primary" type="submit" form="noteForm">${t('save')}</button>`,
    onMount: (sheet, close) => {
      let color = defaults.color;
      let pinned = Boolean(defaults.pinned);
      const pin = sheet.querySelector('#notePin');
      pin.addEventListener('click', () => {
        pinned = !pinned;
        pin.setAttribute('aria-checked', pinned ? 'true' : 'false');
        haptic(5);
      });
      sheet.querySelectorAll('[data-color]').forEach((button) => {
        button.addEventListener('click', () => {
          color = button.dataset.color;
          sheet.querySelectorAll('.swatch').forEach((el) => el.classList.toggle('is-active', el === button));
        });
      });
      sheet.querySelector('[data-cancel]').addEventListener('click', close);
      sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: t('deleteNoteQ'),
          confirmLabel: t('delete'),
          cancelLabel: t('cancel'),
          danger: true,
        });
        if (ok) { deleteNote(defaults.id); close(); toast(t('noteDeleted')); }
      });
      sheet.querySelector('#noteForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const title = sheet.querySelector('#noteTitle').value.trim();
        const content = sheet.querySelector('#noteContent').value.trim();
        if (!title && !content) { sheet.querySelector('#noteContent').focus(); return; }
        const dateField = sheet.querySelector('#noteDate');
        const payload = {
          title: title || t('untitled'),
          content,
          color,
          pinned,
          date: dateField ? dateField.value : (defaults.date || date),
        };
        if (isEdit) {
          payload.id = note.id;
          payload.createdAt = note.createdAt;
        }
        saveNote(payload);
        if (dateField) ui.selectedDate = payload.date;
        close();
        toast(t('noteSaved'));
      });
    },
  });
}

export function notePreview(note) {
  const text = String(note.content || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
