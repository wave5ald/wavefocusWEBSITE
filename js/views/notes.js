/* Notes screen — standalone notes plus simple boards of cards. */

import { icon } from '../icons.js';
import { t, tn } from '../i18n.js';
import { formatDate, isoDate } from '../dates.js';
import {
  addBoardCard, boardCardsDone, deleteBoard, deleteBoardCard, saveBoard, state, toggleBoardCard, ui,
} from '../store.js';
import { confirmDialog, escapeAttr, escapeHtml, haptic, openSheet, toast } from '../ui.js';
import { notePreview, openNoteEditor } from '../editors/note.js';

const BOARD_COLORS = ['#0F766E', '#4C1D95', '#7C2D12', '#164E63', '#831843', '#1E293B'];
const BOARD_EMOJIS = ['💡', '📚', '🚀', '🎯', '🧩', '🌊', '🏗️', '🧠'];

export const fab = {
  label: () => {
    if (ui.noteFilter === 'boards' && ui.activeBoardId) return t('addCard');
    return ui.noteFilter === 'boards' ? t('newBoard') : t('newNote');
  },
  action: () => {
    if (ui.noteFilter === 'boards' && ui.activeBoardId) {
      const input = document.querySelector('#cardInput');
      if (input) input.focus();
      return;
    }
    if (ui.noteFilter === 'boards') openBoardEditor();
    else openNoteEditor(null, { showDate: false });
  },
};

export function render() {
  const lang = state.settings.lang;
  const isBoards = ui.noteFilter === 'boards';
  const activeBoard = isBoards && ui.activeBoardId
    ? state.boards.find((board) => board.id === ui.activeBoardId)
    : null;

  return `
    <div class="stack">
      <div class="segmented" role="tablist">
        <button class="segmented__btn ${!isBoards ? 'is-active' : ''}" type="button" data-note-tab="notes" role="tab" aria-selected="${!isBoards}">
          ${t('standaloneNotes')} · ${state.notes.length}
        </button>
        <button class="segmented__btn ${isBoards ? 'is-active' : ''}" type="button" data-note-tab="boards" role="tab" aria-selected="${isBoards}">
          ${t('boards')} · ${state.boards.length}
        </button>
      </div>

      ${activeBoard ? boardDetail(activeBoard) : isBoards ? boardsList() : notesList(lang)}
    </div>`;
}

function notesList(lang) {
  const notes = state.notes
    .slice()
    .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || ((b.updatedAt || 0) - (a.updatedAt || 0)));

  if (!notes.length) {
    return `<div class="empty">
      <span class="empty__emoji">📝</span>
      <div class="strong">${t('noNotesYet')}</div>
      <div class="small">${escapeHtml(t('noNotesHint'))}</div>
      <button class="btn btn--tonal" type="button" data-new-note>${icon('plus')}${t('newNote')}</button>
    </div>`;
  }

  return `
    <div class="notes-grid">
      ${notes.map((note) => `
        <button class="note" type="button" data-note="${escapeAttr(note.id)}"
                style="--note-bg:${escapeAttr(note.color || '#1E293B')};--note-fg:#F8FAFC">
          ${note.pinned ? '<span class="note__pin">📌</span>' : ''}
          <span class="note__title">${escapeHtml(note.title || t('untitled'))}</span>
          <span class="note__body">${escapeHtml(notePreview(note))}</span>
          <span class="note__time">${escapeHtml(noteTime(note, lang))}</span>
        </button>`).join('')}
    </div>
    <button class="btn btn--outline btn--block" type="button" data-new-note>${icon('plus')}${t('newNote')}</button>`;
}

function noteTime(note, lang) {
  const stamp = note.updatedAt || note.createdAt;
  if (!stamp) return '';
  try {
    return formatDate(isoDate(new Date(stamp)), lang, { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

function boardsList() {
  if (!state.boards.length) {
    return `<div class="empty">
      <span class="empty__emoji">🗂️</span>
      <div class="strong">${t('noBoardsYet')}</div>
      <div class="small">${escapeHtml(t('noBoardsHint'))}</div>
      <button class="btn btn--tonal" type="button" data-new-board>${icon('plus')}${t('newBoard')}</button>
    </div>`;
  }

  return `
    <div class="stack stack--tight">
      ${state.boards.map((board) => {
        const total = board.cards ? board.cards.length : 0;
        const done = boardCardsDone(board);
        return `
          <button class="board-tile" type="button" data-board="${escapeAttr(board.id)}">
            <span class="board-tile__swatch" style="background:${escapeAttr(board.color || '#0F766E')}">${escapeHtml(board.emoji || '🗂️')}</span>
            <span style="flex:1;min-width:0">
              <span class="board-tile__name">${escapeHtml(board.title)}</span>
              <span class="board-tile__meta" style="display:block">${escapeHtml(tn('cardsCount', total))}${total ? ` · ${done}/${total}` : ''}</span>
            </span>
            <span style="color:var(--muted)">${icon('chevronRight')}</span>
          </button>`;
      }).join('')}
    </div>
    <button class="btn btn--outline btn--block" type="button" data-new-board>${icon('plus')}${t('newBoard')}</button>`;
}

function boardDetail(board) {
  const cards = board.cards || [];
  const done = boardCardsDone(board);
  return `
    <section class="row">
      <button class="icon-btn icon-btn--sm" type="button" data-board-back aria-label="${t('back')}">${icon('chevronLeft')}</button>
      <div style="flex:1;min-width:0">
        <div class="strong" style="font-size:1.02rem">${escapeHtml(board.emoji || '🗂️')} ${escapeHtml(board.title)}</div>
        <div class="tiny muted">${escapeHtml(tn('cardsCount', cards.length))}${cards.length ? ` · ${done}/${cards.length}` : ''}</div>
      </div>
      <button class="icon-btn icon-btn--sm" type="button" data-edit-board="${escapeAttr(board.id)}" aria-label="${t('edit')}">${icon('edit')}</button>
      <button class="icon-btn icon-btn--sm" type="button" data-delete-board="${escapeAttr(board.id)}" aria-label="${t('delete')}">${icon('trash')}</button>
    </section>

    <section class="stack stack--tight">
      ${cards.length ? cards.map((card) => `
        <div class="board-card ${card.done ? 'is-done' : ''}" data-card="${escapeAttr(card.id)}">
          <button class="board-card__check" type="button" data-toggle-card="${escapeAttr(card.id)}" aria-checked="${card.done}" role="checkbox" aria-label="${escapeAttr(card.text)}">${icon('check')}</button>
          <span style="flex:1;min-width:0">${escapeHtml(card.text)}</span>
          <button class="icon-btn icon-btn--sm" type="button" data-delete-card="${escapeAttr(card.id)}" aria-label="${t('delete')}">${icon('close')}</button>
        </div>`).join('') : `<p class="small muted" style="padding:8px 2px">${t('addCard')}…</p>`}
    </section>

    <form class="row" id="addCardForm">
      <input class="input" id="cardInput" maxlength="140" placeholder="${escapeAttr(t('cardPlaceholder'))}" autocomplete="off" enterkeyhint="done">
      <button class="btn btn--primary btn--icon" type="submit" aria-label="${t('addCard')}">${icon('plus')}</button>
    </form>`;
}

export function mount(root) {
  root.querySelectorAll('[data-note-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      ui.noteFilter = button.dataset.noteTab;
      ui.activeBoardId = null;
      rerender(root);
    });
  });

  root.querySelectorAll('[data-new-note]').forEach((button) => {
    button.addEventListener('click', () => openNoteEditor(null, { showDate: false }));
  });

  root.querySelectorAll('[data-new-board]').forEach((button) => {
    button.addEventListener('click', () => openBoardEditor());
  });

  root.querySelectorAll('[data-note]').forEach((button) => {
    button.addEventListener('click', () => {
      const note = state.notes.find((n) => n.id === button.dataset.note);
      if (note) openNoteEditor(note, { showDate: false });
    });
  });

  root.querySelectorAll('[data-board]').forEach((button) => {
    button.addEventListener('click', () => {
      ui.activeBoardId = button.dataset.board;
      haptic(5);
      rerender(root);
    });
  });

  root.querySelector('[data-board-back]')?.addEventListener('click', () => {
    ui.activeBoardId = null;
    rerender(root);
  });

  root.querySelector('[data-edit-board]')?.addEventListener('click', () => {
    const board = state.boards.find((b) => b.id === ui.activeBoardId);
    if (board) openBoardEditor(board);
  });

  root.querySelector('[data-delete-board]')?.addEventListener('click', async () => {
    const board = state.boards.find((b) => b.id === ui.activeBoardId);
    if (!board) return;
    const ok = await confirmDialog({
      title: t('deleteBoardQ'),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (ok) {
      deleteBoard(board.id);
      toast(t('boardDeleted'));
    }
  });

  root.querySelectorAll('[data-toggle-card]').forEach((button) => {
    button.addEventListener('click', () => {
      toggleBoardCard(ui.activeBoardId, button.dataset.toggleCard);
      haptic(8);
      rerender(root);
    });
  });

  root.querySelectorAll('[data-delete-card]').forEach((button) => {
    button.addEventListener('click', () => {
      deleteBoardCard(ui.activeBoardId, button.dataset.deleteCard);
      rerender(root);
    });
  });

  root.querySelector('#addCardForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = root.querySelector('#cardInput');
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    addBoardCard(ui.activeBoardId, text);
    input.value = '';
    rerender(root);
    const nextInput = document.querySelector('#cardInput');
    if (nextInput) nextInput.focus();
  });
}

function openBoardEditor(board = null) {
  const isEdit = Boolean(board);
  const defaults = {
    title: '',
    emoji: '💡',
    color: BOARD_COLORS[0],
    cards: [],
    ...board,
  };

  openSheet({
    title: isEdit ? t('boards') : t('newBoard'),
    body: `
      <form id="boardForm" class="stack" novalidate>
        <div class="field">
          <label for="boardTitle">${t('boardName')}</label>
          <input class="input" id="boardTitle" maxlength="40" value="${escapeAttr(defaults.title)}" placeholder="${escapeAttr(t('boardPlaceholder'))}" required>
        </div>
        <div class="field">
          <span class="field-label">${t('questEmoji')}</span>
          <div class="option-grid" id="emojiGrid" style="grid-template-columns:repeat(8,1fr)">
            ${BOARD_EMOJIS.map((emoji) => `<button class="option ${emoji === defaults.emoji ? 'is-active' : ''}" type="button" data-emoji="${emoji}" style="font-size:1rem">${emoji}</button>`).join('')}
          </div>
        </div>
        <div class="field">
          <span class="field-label">${t('noteColor')}</span>
          <div class="colorpick" id="boardColors">
            ${BOARD_COLORS.map((color) => `<button class="swatch ${color === defaults.color ? 'is-active' : ''}" type="button" data-color="${color}" style="--sw:${color}" aria-label="${color}"></button>`).join('')}
          </div>
        </div>
      </form>`,
    foot: `<button class="btn btn--outline" type="button" data-cancel>${t('cancel')}</button>
           <button class="btn btn--primary" type="submit" form="boardForm">${t('save')}</button>`,
    onMount: (sheet, close) => {
      let emoji = defaults.emoji;
      let color = defaults.color;
      sheet.querySelectorAll('[data-emoji]').forEach((button) => {
        button.addEventListener('click', () => {
          emoji = button.dataset.emoji;
          sheet.querySelectorAll('[data-emoji]').forEach((el) => el.classList.toggle('is-active', el === button));
        });
      });
      sheet.querySelectorAll('[data-color]').forEach((button) => {
        button.addEventListener('click', () => {
          color = button.dataset.color;
          sheet.querySelectorAll('.swatch').forEach((el) => el.classList.toggle('is-active', el === button));
        });
      });
      sheet.querySelector('[data-cancel]').addEventListener('click', close);
      sheet.querySelector('#boardForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const input = sheet.querySelector('#boardTitle');
        const title = input.value.trim();
        if (!title) { input.focus(); return; }
        const payload = { title, emoji, color, cards: defaults.cards || [] };
        if (isEdit) payload.id = board.id;
        saveBoard(payload);
        close();
        toast(t('boardSaved'));
      });
    },
  });
}

function rerender(root) {
  root.innerHTML = render();
  mount(root);
}
