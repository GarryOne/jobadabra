// The top of a run's one result card in its run panel (owner, 25 Oct 2026: "Instead of having 3 cards representing the status/result, there should be one
// single card… consistent across runs"): how it ended, the one number and the next step. Pure: the number's words are the app's own (find-card-model.js
// addedWords, the Jobs card's), the next step the Actions banner's (run-compact.js NEXT), so the two never disagree. Drawn by pages/activity-result-top.js.
// Guarded by test/run-result-card.test.js.
import {addedWords} from './find-card-model.js';
import {NEXT} from './run-compact.js';
import {runPill, stepCount} from './run-status.js';

// Every kind's run has this top once it ended (owner, 25 Oct 2026: "Every action run result, should have its status in a consistent way").
// Kept as the list of kinds the top was built for: test/run-result-card.test.js fails on a new kind until it is drawn and checked.
export const CLEAN_TOP = new Set(['search', 'visits', 'mail', 'scout', 'today', 'insight', 'weekly', 'interview', 'interviewInsight', 'kits', 'tailor', 'prepare',
  'add', 'import', 'action', 'rejection', 'prep']);
const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
// The one number a kind's result is about, as words: the jobs a search added (the Jobs card's words). Other kinds say theirs from their own card (WORDS).
export const NUMBER = {search: added => addedWords(added), visits: added => addedWords(added)};
// A kind's result line from the card its run drew (pages/activity-result-bottom.js), so the top and the card never say it twice.
export const WORDS = {
  scout: card => (card.fresh ? `${plural(card.fresh, 'employer')} added` : 'No new employers added'),
  today: card => (card.fresh ? `${plural(card.fresh, 'new job')} in today's list` : 'No new jobs since your last list'),
};
// Any other run: its own one line (the Recent runs row's), without the task's name or a leading emoji ("🤝 Tracked…" → "Tracked…").
export function resultWords(line, name = '') {
  const text = String(line || '').replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`, 'i'), '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return !text || /^done$/i.test(text) ? '' : text[0].toUpperCase() + text.slice(1);
}
export const TOP_TONES = ['good', 'warn', 'bad', 'neutral', 'info'];
export const topTone = (run, kind) => (run ? runPill({...run, kind}, {long: true})[1] : 'neutral');
const ICONS = {good: 'check-circle', warn: 'alert', bad: 'alert', neutral: 'pulse', info: 'pulse'};

// A run that ended without a problem: {tone, icon, title, next} for a kind in CLEAN_TOP, else null (its own card says it, or the No result box does).
// `title`: the kind's own result line (WORDS, a card's headline, resultWords); `asks`: the questions it left for you (a Gmail check's "which job?").
export function cleanTop(run, {kind, added = 0, asks = 0, title = ''} = {}) {
  if (!run || run.live || run.waiting || !CLEAN_TOP.has(kind)) return null;
  const [label, tone] = runPill({...run, kind}, {long: true});
  if (label === 'No result') return null;
  const step = NEXT[kind], counts = {added, asks};
  const next = run.ok !== false && step && (!step.when || step.when(counts)) ? {label: step.label(counts), view: step.view} : null;
  return {tone, icon: ICONS[tone] || 'pulse', title: NUMBER[kind]?.(added) || title || label, next};
}
// A running run's top, the same for every kind (owner, 25 Oct 2026: "Every action run loading should be in the same way"): the step it is on, in words,
// and its count when the step has one ({done, total, percent}; the bar slides without one). `words`: the step as the panel names it (a search's phase label),
// else the step itself; its count is cut from the words, the bar says it ("Reading employer job sites: 120 of 400" → "Reading employer job sites").
export function liveTop(run, {words = '', count = null, started = false} = {}) {
  if (!run?.live || run.waiting) return null;
  const step = String(words || run.step || '');
  const title = step.replace(/\s*[:·-]?\s*\d[\d,]* of \d[\d,]*.*$/, '').trim();
  // No step named: "Starting" until its log has a line, then "Working on it" (never "Starting" beside a log that is already working).
  return {title: title ? title[0].toUpperCase() + title.slice(1) : started ? 'Working on it' : 'Starting', count: count || stepCount(run.step)};
}
export const titleWithNumber = (title, kind, added = 0) => (NUMBER[kind] ? `${title} · ${NUMBER[kind](added)}` : title);
