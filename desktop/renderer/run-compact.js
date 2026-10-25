// One run, compact (owner, 25 Oct 2026: "for all runs/tasks 2 versions: one compact which will show in app, and another one detailed which will show in
// Actions → Runs, or in the Drawer"): what the Actions banner says about a queued or finished run, for every kind, as the running banner does. Pure: the
// pill is run-status.js runPill, the one line is the Recent runs row's outcome, the next step a failure's own fix or the new jobs. The full report stays in
// the run panel (pages/activity-render.js). Drawn by pages/run-banner.js. Guarded by test/run-compact.test.js.
import {failureHead, runPill} from './run-status.js';

const FINDS = ['search', 'visits', 'scout'];   // the runs that add jobs to your list
const ICON = {good: 'check-circle', warn: 'alert', bad: 'alert', info: 'pulse', neutral: 'pulse'};

// `name`: the task's name; `kind`: its activity kind; `outcome`: the Recent runs row's one line; `at` / `took`: the finish time and the duration, in words;
// `waiting` / `place`: a queued run's words (renderer/run-pick.js queueWords).
export function compactRun(run, {name = 'A task', kind = run?.kind || 'search', outcome = '', at = '', took = '', waiting = '', place = ''} = {}) {
  if (!run) return null;
  if (run.waiting) {
    return {state: 'queued', tone: 'neutral', icon: 'clock', title: name, pill: ['Queued', 'neutral'], line: [waiting || 'Waiting to start', place].filter(Boolean).join(' · '),
      next: null, close: {label: 'Cancel', cancel: true}};
  }
  const [label, tone] = runPill({...run, kind}, {long: true});
  const failed = failureHead({...run, kind}, name);
  const added = Number(run.new) || 0;
  const next = failed?.fix?.view || failed?.fix?.rerun ? {...failed.fix}   // a fix the banner can do: open its page, or run it again
    : FINDS.includes(kind) && run.ok && added > 0 ? {label: `See the ${added} new job${added === 1 ? '' : 's'}`, view: 'jobs'} : null;
  const said = String(outcome || '').trim();
  return {state: 'done', tone, icon: ICON[tone] || 'pulse', title: name, pill: [label, tone],
    line: [at && `Finished ${at}`, took && `took ${took}`, said].filter(Boolean).join(' · '), next, close: {label: 'Dismiss', dismiss: true}};
}
