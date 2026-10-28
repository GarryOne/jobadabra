// Which Form fills taught each learning of What we learned (owner, 28 Oct 2026, PR B2 sketch: evidence "by meaning"): the learnings writer keeps each form
// label's learning in the verdict cache (lib/learnings.js, lib/question-verdicts.js noteLearned), and a fill's record keeps its labels (never the answers:
// src/ai/apply_record.py). Matched here when the tab draws, so no fill id is written in the person's answers page. Pure: guarded by test/learning-evidence.test.js.
import {keyOf} from './question-filter.js';

export const SHOWN = 3;   // chips per learning, then "+N"

const dayOf = run => String(run.fields?.started || run.created_at || '').slice(0, 10);
const labelsOf = run => (run.fields?.data?.fields || []).map(field => field.label).filter(Boolean);

/**
 * runs: Reports → Form fills (lib/form-fills-handlers.js), learned: {label key -> the learning's question} (the verdict cache's `learned`).
 * -> Map(learning question key -> [{id, company, day}]): newest fill first, one entry per fill however many of its labels fed that learning.
 */
export function evidenceFor(runs, learned) {
  const out = new Map();
  for (const run of [...(runs || [])].sort((a, b) => dayOf(b).localeCompare(dayOf(a)))) {
    const topics = new Set(labelsOf(run).map(label => learned?.[keyOf(label)]).filter(Boolean).map(keyOf));
    for (const topic of topics) {
      if (!out.has(topic)) out.set(topic, []);
      out.get(topic).push({id: run.id, company: run.fields?.company || run.ats || 'A form', day: dayOf(run)});
    }
  }
  return out;
}

/** "2026-10-26" -> "26 Oct" (the chip's date, in English like the rest of the app). */
export function shortDay(day) {
  const at = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(at.getTime()) ? '' : `${at.getUTCDate()} ${at.toLocaleString('en-GB', {month: 'short', timeZone: 'UTC'})}`;
}
