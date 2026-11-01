// A seeded random walk through the app (5 Oct 2026): the other suites do the same steps in another order; this one takes steps nobody scripted, from a start state nobody
// scripted, with outside services failing at a moment nobody scripted. The plan is PURE (the same seed gives the same plan, tested in test/wander.test.mjs); the suite
// (suites/wander.mjs) carries it out. No seed = a short fixed plan, so the release gate stays comparable.
import {generator} from './variation.mjs';
import {VIEWS} from './uicheck.mjs';

// Where the person starts. `settings` go through the app's own saveSettings; `removeCv` deletes the CV from the data folder.
export const START_STATES = [
  {id: 'set-up', note: 'a finished install'},
  {id: 'half-setup-cv', note: 'setup left at the CV step', settings: {setupDone: false, wizardStep: 'cv', setupFurthest: 'cv'}},
  {id: 'half-setup-ai', note: 'setup left at the AI step', settings: {setupDone: false, wizardStep: 'ai', setupFurthest: 'ai'}},
  {id: 'no-cv', note: 'set up, but the CV is gone from the data folder', settings: {cvName: ''}, removeCv: true},
];

// What can go wrong outside the app, for a stretch of the walk. target: which stand-in answers wrongly (lib/notion-proxy.mjs, lib/ai-proxy.mjs).
export const FAULTS = [
  {id: 'notion-busy', target: 'notion', mode: 'rate-limit', times: 3},
  {id: 'notion-html', target: 'notion', mode: 'html', times: 3},
  {id: 'notion-down', target: 'notion', mode: 'server-error'},
  {id: 'notion-offline', target: 'notion', mode: 'offline', times: 6},
  {id: 'notion-refuses-saves', target: 'notion', mode: 'server-error', writes: true},
  {id: 'notion-flaky', target: 'notion', mode: 'unavailable', every: 2},   // a network that drops every second call
  {id: 'notion-silent', target: 'notion', mode: 'hang', times: 2},
  {id: 'ai-rate-limit', target: 'ai', mode: 'rate-limit'},
  {id: 'ai-no-credit', target: 'ai', mode: 'no-credit'},
  {id: 'ai-invalid-key', target: 'ai', mode: 'invalid-key'},
];

// The steps of a walk. Every one is something a real person does that a script does not think of.
export const MOVES = ['visit', 'hop', 'double-press', 'half-open', 'resize', 'reload', 'crash', 'idle', 'probe'];
export const FIXED_PLAN = {state: START_STATES[0], steps: [{move: 'visit', view: 'focus'}, {move: 'hop', views: ['jobs', 'focus', 'actions']}, {move: 'reload'}, {move: 'probe', view: 'settings'}], fault: null};

export const WALK_LENGTH = 14;

// -> {state, steps, fault: {...FAULTS item, from, until} | null}. `fault.from`/`until` are step numbers: it starts before step `from` and ends before step `until`.
export function planWalk(seed, {length = WALK_LENGTH} = {}) {
  if (!seed) return FIXED_PLAN;
  const next = generator((seed * 40503 + 17) % 4294967296 || 11);
  const pick = list => list[Math.floor(next() * list.length)];
  const state = pick(START_STATES);
  const views = VIEWS;
  const steps = [];
  for (let i = 0; i < length; i++) {
    const move = pick(MOVES);
    if (move === 'hop') steps.push({move, views: [pick(views), pick(views), pick(views)]});   // three pages in a row, no waiting for any to settle
    else if (['visit', 'probe', 'double-press', 'half-open'].includes(move)) steps.push({move, view: pick(views)});
    else if (move === 'resize') steps.push({move, size: pick([[1024, 640], [1100, 720], [1280, 820], [1680, 1000]])});
    else if (move === 'idle') steps.push({move, ms: pick([500, 2000, 5000])});
    else steps.push({move});
  }
  // A crash twice in a walk only repeats itself.
  let crashed = false;
  for (const step of steps) if (step.move === 'crash') { if (crashed) step.move = 'reload'; crashed = true; }
  // Outside services fail for a stretch in two of three walks.
  let fault = null;
  if (next() < 0.67) { const from = Math.floor(next() * (length - 3)), span = 2 + Math.floor(next() * 4); fault = {...pick(FAULTS), from, until: Math.min(length, from + span)}; }
  return {state, steps, fault};
}

export const describe = plan => `start: ${plan.state.note}; fault: ${plan.fault ? `${plan.fault.id} for steps ${plan.fault.from + 1}-${plan.fault.until}` : 'none'}; walk: ${plan.steps.map(step => step.move + (step.view ? `:${step.view}` : step.views ? `:${step.views.join('>')}` : '')).join(', ')}`;
