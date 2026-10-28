// Focus's Suggestions: the person's answer to one entry (Not now, Not true) kept in the active store's 💡 Insights (State, Hidden until),
// as src/suggestions.answered reads it back. A finding (today's insight, the weekly report: key "row:<id>") keeps it on its own row, merged
// into its fields; a computed entry (Tune, Analyze now, a rejection lesson) gets one answer row of its own (category Suggestion, Input
// hash = the entry's key), updated when answered again. Reports leaves answer rows and set-aside insights out (visibleInReports).
// Spec: docs/superpowers/specs/2026-10-28-insights-with-actions-design.md (PR 1a). Guarded by test/suggestion-answers.test.js.
import * as engine from './store/engine.js';

export const ANSWERS = ['Not now', 'Not true'];   // what a person may say here (src/stores/base.INSIGHT_STATES also has Done and Stale)
export const NOT_NOW_DAYS = 14;                   // src/suggestions.NOT_NOW_DAYS
export const ANSWER_CATEGORY = 'Suggestion';      // src/ai/insights_data.ANSWER_CATEGORY

const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const asideOf = row => { try { return JSON.parse(row?.fields?.data || '{}').aside || []; } catch { return []; } };

/** The day a Not now pressed at `now` ends (YYYY-MM-DD), as the engine counts it. */
export const hiddenUntil = now => isoDay(now + NOT_NOW_DAYS * 86400000);

/**
 * Keeps one answer for one Suggestions entry ({key, title, aside}); -> {ok} or {ok: false, error}. A Not true on role ideas keeps their words
 * in the row's Data ({"aside": [...]}, a column in every store), which src/suggestions.set_aside reads back after the role words change the key.
 * Invariant: one row carries a key's answer (its finding row, else its one Suggestion row), so the newest answer is the one read.
 */
export async function answer(storage, entry, state, {call = engine.call, now = Date.now()} = {}) {
  if (!ANSWERS.includes(state)) return {ok: false, error: `An answer is one of: ${ANSWERS.join(', ')}`};
  const key = String(entry?.key || '');
  if (!key) return {ok: false, error: 'That suggestion has no key.'};
  const words = state === 'Not true' && Array.isArray(entry?.aside) ? entry.aside.map(String).slice(0, 60) : [];
  const said = {state, hidden_until: state === 'Not now' ? hiddenUntil(now) : ''};
  if (key.startsWith('row:')) {
    const id = key.slice(4);
    const found = (await call(storage, 'insights', 'list', {}) || []).find(row => String(row.id) === id);
    if (!found) return {ok: false, error: 'That insight is gone.'};
    await call(storage, 'insights', 'update', {insight_id: found.id, fields: {fields: {...(found.fields || {}), ...said}}});
    return {ok: true};
  }
  const kept = (await call(storage, 'insights', 'list', {category: ANSWER_CATEGORY}) || []).find(row => row.fields?.input_hash === key);
  if (words.length) said.data = JSON.stringify({aside: [...new Set([...asideOf(kept), ...words])].slice(-60)});   // Not true again: the words add up
  if (kept) await call(storage, 'insights', 'update', {insight_id: kept.id, fields: {day: isoDay(now), fields: {...(kept.fields || {}), ...said}}});
  else await call(storage, 'insights', 'add', {record: {day: isoDay(now), category: ANSWER_CATEGORY, title: String(entry.title || key).slice(0, 200),
    fields: {...said, input_hash: key}}});
  return {ok: true};
}

/** Whether Reports lists a 💡 Insights row: never an answer row, never an insight set aside (Not true, or Not now until its day). */
export function visibleInReports(row, now = Date.now()) {
  if (row?.category === ANSWER_CATEGORY) return false;
  const {state, hidden_until: until} = row?.fields || {};
  if (state === 'Not true') return false;
  return !(state === 'Not now' && String(until || '').slice(0, 10) > isoDay(now));
}
