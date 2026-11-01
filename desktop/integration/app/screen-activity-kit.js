/* global document */
// Layer 2, Recent activity: the demo window whose run history is the 36 fictional states (e2e/fixtures/activity-states.json, one per kind of end), as the e2e state viewer
// (e2e/activity-states.mjs openStates) built it, and the helpers that open one and read it as a person does. Used by the screen-cardstates, screen-activity and
// screen-activity-failures tests.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const E2E = fileURLToPath(new URL('../../e2e', import.meta.url));
export const STATES = JSON.parse(fs.readFileSync(path.join(E2E, 'fixtures', 'activity-states.json'), 'utf8')).states;
const MAIL = JSON.parse(fs.readFileSync(path.join(E2E, 'fixtures', 'mail-states.json'), 'utf8'));

/**
 * The files a window needs to show the states: the run history (one run a minute apart, newest first, `now` injected) and Focus holding the open "which job?" questions.
 * @param {number} now  @param {object} demoFocus the demo's focus.json  @returns {Record<string, unknown>} file name -> content
 */
export function stateFiles(now, demoFocus) {
  const runs = STATES.map(({run}, i) => { const at = new Date(now - (i + 1) * 60000).toISOString(); return {trigger: 'you', log: [], ...run, id: now - i, startedAt: at, endedAt: at}; });
  return {'runs.json': runs, 'focus.json': {...demoFocus, items: [...MAIL.focus.open, ...demoFocus.items], answered_questions: MAIL.focus.answered}};
}
export const demoFocus = () => JSON.parse(fs.readFileSync(new URL('../../demo/focus.json', import.meta.url), 'utf8'));
/** The env that shows Gmail disconnected now (the header, the schedule and the box follow the current connection). */
export const googleEnv = google => (google === 'off' ? {JOB_PILOTTO_DEMO_GOOGLE: 'off'} : {});

/**
 * A probe script that also receives `data` (second argument): the script is serialised into the window, so it cannot close over the test file's constants.
 * Why (1 Nov 2026): the state names and their places live in the fixture, which the window cannot import.
 */
export const withData = (data, script) => new Function('kit', `return (${script.toString()})(kit, ${JSON.stringify(data)});`);
export const indexOf = name => { const at = STATES.findIndex(state => state.name === name); if (at < 0) throw new Error(`no state named ${name}`); return at; };

/** In the window: open Actions → Runs with every row loaded, select a state by its place in STATES, read its card. Serialised: no closure over this file. */
export const activityKit = base => {
  const $ = selector => document.querySelector(selector);
  const shown = selector => { const node = $(selector); return !!node && node.offsetParent !== null; };
  const text = selector => $(selector)?.innerText || '';
  const rows = () => [...document.querySelectorAll('#activity-recent li:not(.recent-group) button')];
  const READABLE = ['activity-selected', 'activity-status', 'activity-sub', 'activity-warnings', 'activity-phases', 'activity-card', 'activity-result'];
  return {
    shown, text, rows,
    openRuns: async () => {
      await base.go('actions');
      $('[data-actions-tab="runs"]').click();
      await base.until(() => !$('#actions-runs')?.hidden && $('#actions-runs #activity-recent'), 'the run list');
      for (let i = 0; i < 10 && shown('#activity-all'); i++) $('#activity-all').click();
      await base.until(() => !shown('#activity-all'), 'every run to be listed');
    },
    /** Opens the state at `index` and waits until it is the run drawn (its row current, its status in words). */
    select: async index => {
      if (shown('#activity-back')) $('#activity-back').click();
      rows()[index].click();
      await base.until(() => rows()[index]?.classList.contains('current'), `state ${index} to be the current run`);
      await base.until(() => text('#activity-status').trim(), `state ${index} to show its status`);
    },
    /** Opens the run whose list line carries `words` (the run's own result line), when the runs are not the 36 states. */
    selectWhere: async words => {
      if (shown('#activity-back')) $('#activity-back').click();
      const row = await base.until(() => rows().find(one => one.textContent.includes(words)), `a run whose line says "${words}"`);
      row.click();
      await base.until(() => row.isConnected ? row.classList.contains('current') : rows().find(one => one.textContent.includes(words))?.classList.contains('current'), `"${words}" to be the current run`);
    },
    /** The card's text a person reads (header, box, steps, card), without the technical log, which may hold raw lines. */
    readable: () => READABLE.map(id => document.getElementById(id)).filter(node => node && !node.hidden && node.offsetParent !== null).map(node => node.innerText).join('\n'),
  };
};
