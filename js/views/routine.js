/* Routine screen — daily auto-resetting tasks with streaks, coins and progress. */

import { icon } from '../icons.js';
import { t, tn } from '../i18n.js';
import {
  addDays, formatDate, hijriLabel, isoDate, isoWeekday, parseISO, todayISO, weekDates, weekdayShort,
} from '../dates.js';
import {
  addCategory, CATEGORY_COLORS, categoryColor, clearCompleted, completedIds, currentStreak, dayStats, deleteTask,
  dueTasks, isCompleted, isTaskDue, saveTask, sessionsFor, state, taskById, taskStreak, toggleTask, ui,
} from '../store.js';
import { confirmDialog, escapeAttr, escapeHtml, haptic, openSheet, toast } from '../ui.js';

const WEEKDAY_LABELS = {
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  ar: ['إث', 'ثل', 'أر', 'خم', 'جم', 'سب', 'أح'],
};

export const fab = {
  label: () => t('addTask'),
  action: () => openTaskEditor(),
};

export function render() {
  const date = ui.selectedDate;
  const stats = dayStats(date);
  const tasks = dueTasks(date, { filter: ui.filter });
  const today = todayISO();
  const streak = currentStreak();
  const focusMinutes = Math.round(
    sessionsFor(today).reduce((sum, session) => sum + session.seconds, 0) / 60
  );
  const lang = state.settings.lang;
  const hijri = state.settings.edition === 'hijri';
  const week = weekDates(date, state.settings.weekStart);

  const groups = ['Morning', 'Afternoon', 'Evening', 'Anytime'].map((slot) => ({
    slot,
    tasks: tasks.filter((task) => (task.timeOfDay || 'Anytime') === slot),
  })).filter((group) => group.tasks.length);

  return `
    <div class="stack">
      <section class="datestrip">
        <button class="daynav" type="button" data-shift="-7" aria-label="${t('previous')}">${icon('chevronLeft')}</button>
        <div class="datestrip__scroll" id="dayStrip">
          ${week.map((iso) => dayChip(iso, date, lang)).join('')}
        </div>
        <button class="daynav" type="button" data-shift="7" aria-label="${t('next')}">${icon('chevronRight')}</button>
      </section>

      <section class="date-head">
        <div>
          <div class="date-head__main">${escapeHtml(formatDate(date, lang, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
          <div class="date-head__sub">${hijri ? `${escapeHtml(hijriLabel(date, lang))} · ` : ''}${escapeHtml(relativeLabel(date, lang))}</div>
        </div>
        ${date !== today
          ? `<button class="chip chip--ghost" type="button" data-today>${t('today')}</button>`
          : `<span class="chip">${icon('wave')}<span>${t('today')}</span></span>`}
      </section>

      <section class="card card--hero" aria-labelledby="progressTitle">
        <div class="hero">
          <div class="ring" style="--value:${stats.rate}">
            <div class="ring__inner">
              <span class="ring__pct tabular">${stats.rate}%</span>
              <span class="ring__label">${t('dailyProgress')}</span>
            </div>
          </div>
          <div class="hero__meta">
            <div>
              <div class="hero__count">${escapeHtml(t('tasksDone', { done: stats.done, total: stats.total }))}</div>
              <div class="small muted" style="margin-top:3px">
                ${stats.total === 0
                  ? escapeHtml(t('noTasksHint'))
                  : stats.done === stats.total
                    ? escapeHtml(t('allDone'))
                    : escapeHtml(t('remainingTasks', { n: stats.total - stats.done }))}
              </div>
            </div>
            <div class="badges">
              <span class="badge badge--flame">${icon('flame')}${streak} ${t('streak')}</span>
              ${focusMinutes > 0 ? `<span class="badge badge--focus">${icon('timer')}${escapeHtml(t('minutesFocused', { n: focusMinutes }))}</span>` : ''}
            </div>
          </div>
        </div>
      </section>

      <section class="filters" aria-label="${t('category')}">
        <button class="filter ${ui.filter === 'All' ? 'is-active' : ''}" type="button" data-filter="All">${t('filterAll')}</button>
        ${state.categories.map((category) => `
          <button class="filter ${ui.filter === category.name ? 'is-active' : ''}" type="button" data-filter="${escapeAttr(category.name)}">
            <span class="filter__dot" style="background:${escapeAttr(category.color)}"></span>${escapeHtml(t(category.name))}
          </button>`).join('')}
        <button class="filter" type="button" data-add-category aria-label="${t('category')}">${icon('plus')}</button>
      </section>

      ${stats.done > 0 ? `
        <section class="row row--between">
          <span class="tiny muted">${escapeHtml(tn('tasksCount', stats.total))}</span>
          <button class="btn btn--tiny btn--ghost" type="button" data-clear>${icon('refresh')}${t('clearDay')}</button>
        </section>` : ''}

      ${tasks.length === 0
        ? `<section class="empty">
             <span class="empty__emoji">🌊</span>
             <div class="strong">${t('noTasksToday')}</div>
             <div class="small">${escapeHtml(t('noTasksHint'))}</div>
             <button class="btn btn--tonal" type="button" data-add>${icon('plus')}${t('addTask')}</button>
           </section>`
        : `<div class="stack stack--tight">
             ${groups.map((group) => `
               <div class="group-label">${escapeHtml(t(group.slot))}</div>
               ${group.tasks.map((task) => taskRow(task, date, lang)).join('')}
             `).join('')}
           </div>`}
    </div>`;
}

function relativeLabel(iso, lang) {
  const delta = Math.round((parseISO(iso) - parseISO(todayISO())) / 86400000);
  if (delta === 0) return t('today');
  if (delta === -1) return t('yesterday');
  if (delta === 1) return t('tomorrow');
  return '';
}

function dayChip(iso, selected, lang) {
  const done = completedIds(iso).length;
  const due = dayStats(iso).total;
  const classes = ['day'];
  if (iso === selected) classes.push('is-selected');
  if (iso === todayISO()) classes.push('is-today');
  if (done > 0) classes.push('has-progress');
  const labels = WEEKDAY_LABELS[lang] || WEEKDAY_LABELS.en;
  return `
    <button class="${classes.join(' ')}" type="button" data-day="${iso}" aria-label="${escapeAttr(formatDate(iso, lang))}" aria-pressed="${iso === selected}">
      <span class="day__dow">${labels[isoWeekday(iso) - 1] || escapeHtml(weekdayShort(iso, lang))}</span>
      <span class="day__num">${parseISO(iso).getDate()}</span>
      <span class="day__dot" aria-hidden="true"></span>
    </button>`;
}

function taskRow(task, date, lang) {
  const done = isCompleted(date, task.id);
  const streak = taskStreak(task.id, date);
  const color = categoryColor(task.category);
  const meta = [
    `<span>${escapeHtml(t(task.category))}</span>`,
    task.targetMinutes ? `<span class="dot"></span><span>${task.targetMinutes} ${t('min')}</span>` : '',
    streak > 1 ? `<span class="dot"></span><span class="task__streak">🔥 ${streak}</span>` : '',
    task.repeatType === 'interval' ? `<span class="dot"></span><span>${escapeHtml(t('everyNDays', { n: task.intervalDays }))}</span>` : '',
  ].join('');

  return `
    <article class="task ${done ? 'is-done' : ''}" style="--cat:${escapeAttr(color)}" data-task="${escapeAttr(task.id)}">
      <button class="task__check" type="button" role="checkbox" aria-checked="${done}" aria-label="${escapeAttr(task.title)}" data-toggle="${escapeAttr(task.id)}">
        ${icon('check')}
      </button>
      <div class="task__body" data-toggle="${escapeAttr(task.id)}" role="button" tabindex="0" aria-label="${escapeAttr(task.title)}">
        <span class="task__title">${escapeHtml(task.title)}</span>
        <span class="task__meta">${meta}</span>
      </div>
      <button class="task__more" type="button" data-edit="${escapeAttr(task.id)}" aria-label="${t('edit')} ${escapeAttr(task.title)}">${icon('dots')}</button>
    </article>`;
}

export function mount(root) {
  root.querySelectorAll('[data-day]').forEach((button) => {
    button.addEventListener('click', () => {
      ui.selectedDate = button.dataset.day;
      haptic(5);
      renderInto(root);
    });
  });

  root.querySelectorAll('[data-shift]').forEach((button) => {
    button.addEventListener('click', () => {
      ui.selectedDate = addDays(ui.selectedDate, Number(button.dataset.shift));
      renderInto(root);
    });
  });

  const todayBtn = root.querySelector('[data-today]');
  if (todayBtn) todayBtn.addEventListener('click', () => {
    ui.selectedDate = todayISO();
    renderInto(root);
  });

  root.querySelectorAll('[data-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      ui.filter = button.dataset.filter;
      renderInto(root);
    });
  });

  root.querySelectorAll('[data-toggle]').forEach((element) => {
    const activate = (event) => {
      if (event.target.closest('[data-edit]')) return;
      const wasDone = isCompleted(ui.selectedDate, element.dataset.toggle);
      toggleTask(ui.selectedDate, element.dataset.toggle);
      haptic(wasDone ? 5 : 12);
      const stats = dayStats(ui.selectedDate);
      if (!wasDone && stats.total > 0 && stats.done === stats.total) toast(t('allDoneToast'), { duration: 3200 });
      renderInto(root);
    };
    element.addEventListener('click', activate);
    if (element.tagName !== 'BUTTON') {
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(event); }
      });
    }
  });

  root.querySelectorAll('[data-edit]').forEach((button) => {
    button.addEventListener('click', () => openTaskEditor(taskById(button.dataset.edit)));
  });

  root.querySelectorAll('[data-add]').forEach((button) => {
    button.addEventListener('click', () => openTaskEditor());
  });

  const clearBtn = root.querySelector('[data-clear]');
  if (clearBtn) clearBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: t('clearDayQ'),
      body: t('clearDayHint'),
      confirmLabel: t('clearDay'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (ok) {
      clearCompleted(ui.selectedDate);
      toast(t('dayCleared'));
      renderInto(root);
    }
  });

  const addCat = root.querySelector('[data-add-category]');
  if (addCat) addCat.addEventListener('click', openCategoryEditor);

  // keep the selected day in view without scrolling the page
  const strip = root.querySelector('#dayStrip');
  const selected = strip ? strip.querySelector('.day.is-selected') : null;
  if (strip && selected) {
    const left = selected.offsetLeft;
    const right = left + selected.offsetWidth;
    if (left < strip.scrollLeft || right > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: Math.max(0, left - strip.clientWidth / 2 + selected.offsetWidth / 2) });
    }
  }
}

/* ------------------------------- editors -------------------------------- */

function openCategoryEditor() {
  openSheet({
    title: t('category'),
    body: `
      <form id="catForm" class="stack" novalidate>
        <div class="field">
          <label for="catName">${t('category')}</label>
          <input class="input" id="catName" name="name" maxlength="24" placeholder="${escapeAttr(t('taskPlaceholder'))}" autocomplete="off" required>
        </div>
        <div class="field">
          <span class="field-label">${t('theme')}</span>
          <div class="colorpick" id="catColors">
            ${CATEGORY_COLORS
              .map((color, index) => `<button class="swatch ${index === 0 ? 'is-active' : ''}" type="button" data-color="${color}" style="--sw:${color}" aria-label="${color}"></button>`)
              .join('')}
          </div>
        </div>
      </form>`,
    foot: `<button class="btn btn--outline" type="button" data-cancel>${t('cancel')}</button>
           <button class="btn btn--primary" type="submit" form="catForm">${t('save')}</button>`,
    onMount: (sheet, close) => {
      let color = CATEGORY_COLORS[0];
      const colors = sheet.querySelector('#catColors');
      colors.querySelectorAll('[data-color]').forEach((button) => {
        button.addEventListener('click', () => {
          color = button.dataset.color;
          colors.querySelectorAll('.swatch').forEach((el) => el.classList.toggle('is-active', el === button));
        });
      });
      sheet.querySelector('[data-cancel]').addEventListener('click', close);
      sheet.querySelector('#catForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const name = sheet.querySelector('#catName').value.trim();
        if (!name) { sheet.querySelector('#catName').focus(); return; }
        const created = addCategory(name, color);
        if (!created) { toast(t('saved')); close(); return; }
        ui.filter = created.name;
        close();
        toast(t('saved'));
      });
    },
  });
}

function openTaskEditor(task = null) {
  const isEdit = Boolean(task);
  const date = ui.selectedDate;
  const defaults = {
    title: '',
    note: '',
    category: ui.filter !== 'All' ? ui.filter : (state.categories[0]?.name || 'Health'),
    timeOfDay: 'Anytime',
    targetMinutes: 15,
    repeatType: 'weekly',
    days: [1, 2, 3, 4, 5, 6, 7],
    intervalDays: 2,
    anchor: date,
    ...task,
  };
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const options = (values, selected) => values.map((value) => `
    <button class="option ${selected === value ? 'is-active' : ''}" type="button" data-option="${value}" data-group="slot">${escapeHtml(t(value))}</button>`).join('');

  openSheet({
    title: isEdit ? t('editTask') : t('newTask'),
    body: `
      <form id="taskForm" class="stack" novalidate>
        <div class="field">
          <label for="taskTitle">${t('taskName')}</label>
          <input class="input" id="taskTitle" name="title" maxlength="80" value="${escapeAttr(defaults.title)}"
                 placeholder="${escapeAttr(t('taskPlaceholder'))}" autocomplete="off" required>
        </div>

        <div class="field">
          <label for="taskNote">${t('taskNote')}</label>
          <textarea class="textarea" id="taskNote" name="note" maxlength="300" rows="2"
                    placeholder="${escapeAttr(t('taskNotePlaceholder'))}">${escapeHtml(defaults.note || '')}</textarea>
        </div>

        <div class="field">
          <label for="taskCategory">${t('category')}</label>
          <select class="select" id="taskCategory" name="category">
            ${state.categories.map((c) => `<option value="${escapeAttr(c.name)}" ${c.name === defaults.category ? 'selected' : ''}>${escapeHtml(t(c.name))}</option>`).join('')}
          </select>
        </div>

        <div class="field">
          <span class="field-label">${t('timeOfDay')}</span>
          <div class="option-grid" id="slotOptions">
            ${options(['Morning', 'Afternoon', 'Evening', 'Anytime'], defaults.timeOfDay)}
          </div>
        </div>

        <div class="field">
          <label for="taskMinutes">${t('targetMinutes')}</label>
          <input class="input" id="taskMinutes" name="minutes" type="number" inputmode="numeric" min="0" max="480" step="5" value="${Number(defaults.targetMinutes) || 0}">
        </div>

        <div class="field">
          <span class="field-label">${t('recurrence')}</span>
          <div class="option-grid" id="repeatOptions">
            ${[['weekly', t('weeklyDays')], ['interval', t('intervalDays')], ['once', t('specificDay')], ['weekend', t('weekendOnce')]]
              .map(([value, label]) => `<button class="option ${defaults.repeatType === value ? 'is-active' : ''}" type="button" data-repeat="${value}">${escapeHtml(label)}</button>`).join('')}
          </div>
        </div>

        <div class="field" id="daysField">
          <span class="field-label">${t('selectDays')}</span>
          <div class="daypick">
            ${dayLabels.map((label, index) => `
              <button class="daypick__btn ${(defaults.days || []).includes(index + 1) ? 'is-active' : ''}" type="button" data-dow="${index + 1}">${label}</button>`).join('')}
          </div>
        </div>

        <div class="field" id="intervalField" hidden>
          <label for="taskInterval">${t('intervalDays')}</label>
          <input class="input" id="taskInterval" type="number" inputmode="numeric" min="1" max="60" value="${Number(defaults.intervalDays) || 2}">
        </div>

        <div class="field" id="anchorField" hidden>
          <label for="taskAnchor">${t('startingFrom')}</label>
          <input class="input" id="taskAnchor" type="date" value="${escapeAttr(defaults.anchor || todayISO())}">
        </div>
      </form>`,
    foot: `${isEdit ? `<button class="btn btn--danger" type="button" data-delete>${icon('trash')}</button>` : ''}
           <button class="btn btn--outline" type="button" data-cancel>${t('cancel')}</button>
           <button class="btn btn--primary" type="submit" form="taskForm">${isEdit ? t('save') : t('addTask')}</button>`,
    onMount: (sheet, close) => {
      let slot = defaults.timeOfDay;
      let repeatType = defaults.repeatType;
      let days = new Set(defaults.days || []);
      const daysField = sheet.querySelector('#daysField');
      const intervalField = sheet.querySelector('#intervalField');
      const anchorField = sheet.querySelector('#anchorField');

      const syncRepeat = () => {
        sheet.querySelectorAll('[data-repeat]').forEach((el) => el.classList.toggle('is-active', el.dataset.repeat === repeatType));
        daysField.hidden = repeatType !== 'weekly';
        intervalField.hidden = repeatType !== 'interval';
        anchorField.hidden = !(repeatType === 'once' || repeatType === 'interval');
      };
      syncRepeat();

      sheet.querySelectorAll('[data-group="slot"]').forEach((button) => {
        button.addEventListener('click', () => {
          slot = button.dataset.option;
          sheet.querySelectorAll('[data-group="slot"]').forEach((el) => el.classList.toggle('is-active', el === button));
        });
      });

      sheet.querySelectorAll('[data-repeat]').forEach((button) => {
        button.addEventListener('click', () => {
          repeatType = button.dataset.repeat;
          syncRepeat();
        });
      });

      sheet.querySelectorAll('[data-dow]').forEach((button) => {
        button.addEventListener('click', () => {
          const dow = Number(button.dataset.dow);
          if (days.has(dow) && days.size > 1) days.delete(dow);
          else days.add(dow);
          button.classList.toggle('is-active', days.has(dow));
        });
      });

      sheet.querySelector('[data-cancel]').addEventListener('click', close);

      const deleteBtn = sheet.querySelector('[data-delete]');
      if (deleteBtn) deleteBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: `${t('delete')} “${task.title}”?`,
          body: t('clearDayHint'),
          confirmLabel: t('delete'),
          cancelLabel: t('cancel'),
          danger: true,
        });
        if (ok) {
          deleteTask(task.id);
          close();
          toast(t('taskDeleted'));
        }
      });

      sheet.querySelector('#taskForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const titleInput = sheet.querySelector('#taskTitle');
        const title = titleInput.value.trim();
        if (!title) {
          titleInput.focus();
          titleInput.style.borderColor = 'var(--danger)';
          return;
        }
        const payload = {
          title,
          note: sheet.querySelector('#taskNote').value.trim(),
          category: sheet.querySelector('#taskCategory').value,
          timeOfDay: slot,
          targetMinutes: Math.max(0, Math.min(480, Number(sheet.querySelector('#taskMinutes').value) || 0)),
          repeatType,
          days: [...days].sort((a, b) => a - b),
          intervalDays: Math.max(1, Math.min(60, Number(sheet.querySelector('#taskInterval').value) || 2)),
          anchor: sheet.querySelector('#taskAnchor').value || todayISO(),
        };
        if (isEdit) payload.id = task.id;
        saveTask(payload);
        close();
        toast(t('taskSaved'));
      });
    },
  });
}

function renderInto(root) {
  root.innerHTML = render();
  mount(root);
}
