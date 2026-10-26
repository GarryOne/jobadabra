// A clicked notification or pop-up opens what it is about (lib/targets.js): the result of a finished task, a page, a section, a job's row.
import {plan} from '../targets.js';
import {shared} from './shared.js';
import {$} from './core.js';
import {lastActivity, openActivity, renderActivity} from './activity.js';
import {openView} from './nav.js';
import {openSession} from './session-log.js';
import {openSetting, settingsPage} from './settings.js';

const FLASH_MS = 2200;

// Scroll to a job's row or Board card (its code, else its address) and flash it; the page may still be drawing, so look a few times.
export function focusJob(key, tries = 12) {
  const rows = [...document.querySelectorAll('.job-row, .board-card')];   // the list, or the Board's card
  const row = rows.find(r => r.dataset.code === key || r.dataset.url === key);
  if (row) {
    row.scrollIntoView({block: 'center', behavior: 'smooth'});
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), FLASH_MS);
    return true;
  }
  if (tries > 0) setTimeout(() => focusJob(key, tries - 1), 250);
  return false;
}

export function openTarget(target) {
  for (const step of plan(target)) {
    const [kind, ...rest] = step.split(':'), value = rest.join(':');
    if (kind === 'run') { shared.selectedRun = Number(value); openActivity(true); if (lastActivity) renderActivity(lastActivity); $('activity-card')?.scrollIntoView({block: 'nearest'}); }
    else if (kind === 'activity') openActivity(true);
    else if (kind === 'view') openView(value);
    else if (kind === 'section') settingsPage(value);
    else if (kind === 'job') focusJob(value);
    else if (kind === 'session') openSession(value);
    else if (kind === 'card') openSetting(value);   // its page, scrolled to, the card glows (.is-arrived)
  }
}
