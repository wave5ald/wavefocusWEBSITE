/* Progress screen — weekly trends, 30-day heatmap and category insights. */

import { icon } from '../icons.js';
import { t, tn } from '../i18n.js';
import { addDays, formatDuration, todayISO, weekdayShort } from '../dates.js';
import {
  bestStreak, categoryStats, currentStreak, lastNDays, perfectDayCount, state,
  totalCompletions, totalFocusSeconds, weekdayCompletion,
} from '../store.js';
import { escapeHtml } from '../ui.js';

export const fab = null;

export function render() {
  const lang = state.settings.lang;
  const week = lastNDays(7);
  const days30 = lastNDays(30);
  const activeDays = week.filter((day) => day.total > 0);
  const avg = activeDays.length
    ? Math.round(activeDays.reduce((sum, day) => sum + day.rate, 0) / activeDays.length)
    : 0;
  const perfect30 = perfectDayCount(30);
  const focusSeconds = days30.reduce((sum, day) => sum + totalFocusSeconds(day.date), 0);
  const categories = categoryStats();
  const totalCategory = categories.reduce((sum, category) => sum + category.count, 0);
  const dowRates = weekdayCompletion(30);
  const bestDowIndex = dowRates.indexOf(Math.max(...dowRates));
  const hasData = totalCompletions() > 0;

  const bestDayLabel = bestDowIndex >= 0 && Math.max(...dowRates) > 0
    ? weekdayShort(addDays('2024-01-01', bestDowIndex), lang)
    : '—';
  const topCategory = categories.find((category) => category.count > 0);

  return `
    <div class="stack">
      ${!hasData ? `
        <section class="card card--hero">
          <div class="row" style="gap:12px">
            <span style="font-size:1.7rem">📈</span>
            <div>
              <div class="strong">${t('noData')}</div>
              <div class="small muted" style="margin-top:2px">${escapeHtml(t('noDataHint'))}</div>
            </div>
          </div>
        </section>` : ''}

      <section class="stat-grid">
        <div class="stat stat--accent">
          <div class="stat__value">${currentStreak()}</div>
          <div class="stat__label">${t('currentStreak')}</div>
        </div>
        <div class="stat">
          <div class="stat__value">${bestStreak()}</div>
          <div class="stat__label">${t('bestStreak')}</div>
        </div>
        <div class="stat">
          <div class="stat__value">${avg}%</div>
          <div class="stat__label">${t('avgCompletion')} · 7d</div>
        </div>
        <div class="stat">
          <div class="stat__value">${escapeHtml(shortDuration(focusSeconds))}</div>
          <div class="stat__label">${t('totalFocusTime')} · 30d</div>
        </div>
      </section>

      <section class="card">
        <div class="card__head">
          <div>
            <h2 class="card__title">${t('weeklyTrends')}</h2>
            <div class="tiny muted">${t('last7Days')} · ${escapeHtml(t('completionRate'))}</div>
          </div>
          <span class="badge">${perfectDayCount(7)} ${t('perfectDays')}</span>
        </div>
        <div class="bars">
          ${week.map((day) => {
            const isToday = day.date === todayISO();
            return `
              <div class="bar ${isToday ? 'is-today' : ''}">
                <span class="bar__val">${day.rate}%</span>
                <span class="bar__fill" style="height:${Math.max(4, day.rate)}%;opacity:${day.rate ? 1 : .35}"></span>
                <span class="bar__dow">${escapeHtml(weekdayShort(day.date, lang))}</span>
              </div>`;
          }).join('')}
        </div>
      </section>

      <section class="card">
        <div class="card__head">
          <h2 class="card__title">${t('heatmapTitle')}</h2>
          <span class="badge">${perfect30} ${t('perfectDays')}</span>
        </div>
        <div class="heat" role="img" aria-label="${t('heatmapTitle')}">
          ${days30.map((day) => `
            <div class="heat__cell" data-level="${level(day.rate, day.total)}" title="${day.date} · ${day.rate}%"></div>`).join('')}
        </div>
        <div class="heat-legend">
          <span>${t('less')}</span>
          <i data-level="0"></i><i style="background:color-mix(in srgb, var(--primary) 26%, var(--surface-2))"></i>
          <i style="background:color-mix(in srgb, var(--primary) 48%, var(--surface-2))"></i>
          <i style="background:color-mix(in srgb, var(--primary) 72%, var(--surface-2))"></i>
          <i style="background:var(--primary)"></i>
          <span>${t('more')}</span>
        </div>
      </section>

      <section class="card">
        <div class="card__head">
          <h2 class="card__title">${t('categoryBreakdown')}</h2>
          <span class="badge">${totalCompletions()} ${tn('totalCompleted', totalCompletions())}</span>
        </div>
        <div class="stack stack--tight">
          ${categories.map((category) => {
            const pct = totalCategory ? Math.round((category.count / totalCategory) * 100) : 0;
            return `
              <div class="cat-row" style="--cat:${escapeHtml(category.color)}">
                <span>${escapeHtml(t(category.name))}</span>
                <span class="cat-row__track"><span class="cat-row__fill" style="width:${pct}%"></span></span>
                <span class="cat-row__val">${category.count}</span>
              </div>`;
          }).join('')}
        </div>
      </section>

      <section class="card">
        <div class="card__head">
          <h2 class="card__title">${t('insights')}</h2>
          ${icon('sparkle')}
        </div>
        <div class="stack stack--tight small">
          <div class="row row--between">
            <span class="muted">${t('bestDay')}</span>
            <span class="strong">${escapeHtml(bestDayLabel)}</span>
          </div>
          <div class="row row--between">
            <span class="muted">${t('activeTasks')}</span>
            <span class="strong">${state.tasks.filter((task) => task.active !== false).length}</span>
          </div>
          ${topCategory ? `
            <div class="row row--between">
              <span class="muted">${t('category')}</span>
              <span class="strong" style="color:${escapeHtml(topCategory.color)}">${escapeHtml(t(topCategory.name))}</span>
            </div>` : ''}
          <div class="row row--between">
            <span class="muted">${t('totalFocusTime')}</span>
            <span class="strong">${escapeHtml(formatDuration(focusSeconds))}</span>
          </div>
        </div>
      </section>
    </div>`;
}

function level(rate, total) {
  if (!total) return 0;
  if (rate >= 100) return 4;
  if (rate >= 70) return 3;
  if (rate >= 40) return 2;
  if (rate > 0) return 1;
  return 0;
}

function shortDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)}h`;
}

export function mount() {
  /* static screen — nothing to bind */
}
