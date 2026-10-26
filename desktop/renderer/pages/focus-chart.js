// Focus, Today's progress: applications per day over the last 14 days (moved from pages/focus.js, 26 Oct 2026). In the page's first paint as last
// drawn (renderer/late-blocks.js). Guarded by: test/late-blocks.test.js.
import {el} from '../components.js';
import {keepBlock, keptBlock} from '../late-blocks.js';
import {$, show} from './core.js';

// Applications per day, the last 14 days (from Notion: Applied on dates and Applied events), with the daily target as
// a dashed line: a day that reached it is green, today is the accent colour.
export function progressChart(days, target) {
  show($('focus-chart-block'), days.length > 0);
  if (!days.length) return;
  const top = Math.max(target, ...days.map(day => day.applied), 1);
  const chart = $('focus-chart');
  const bars = days.map((day, i) => {
    const date = new Date(`${day.day}T12:00:00`);
    const column = el('div', `focus-chart-col${i === days.length - 1 ? ' is-today' : ''}${day.applied >= target ? ' is-met' : ''}`);
    column.title = `${date.toLocaleDateString([], {weekday: 'short', day: 'numeric', month: 'short'})}: ${day.applied} application${day.applied === 1 ? '' : 's'}`;
    const bar = el('span', 'focus-chart-bar');
    bar.style.height = `${Math.round(100 * day.applied / top)}%`;
    const slot = el('div', 'focus-chart-slot');
    slot.append(bar);
    column.append(slot, el('span', 'focus-chart-day', date.toLocaleDateString([], {weekday: 'narrow'})));
    return column;
  });
  const goal = el('div', 'focus-chart-goal');
  goal.style.bottom = `calc(14px + (100% - 14px) * ${target / top})`;  // above the day letters (14 px)
  goal.title = `Target: ${target} a day`;
  const plot = el('div', 'focus-chart-plot');
  plot.append(goal, ...bars);
  chart.replaceChildren(plot);
  const total = days.reduce((sum, day) => sum + day.applied, 0);
  $('focus-chart-sum').textContent = `${total} applied · ${days.filter(day => day.applied >= target).length} day${days.filter(day => day.applied >= target).length === 1 ? '' : 's'} on target`;
  keepBlock('focus-chart-block', {days, target});
}

// The first paint (pages/focus.js init): the chart as last drawn, so Reminders and the cards below it never move when Focus is read (renderer/late-blocks.js).
export function paintChartFirst() {
  const kept = keptBlock('focus-chart-block');
  if (Array.isArray(kept?.days) && kept.days.length) progressChart(kept.days, Number(kept.target) || 1);
}
