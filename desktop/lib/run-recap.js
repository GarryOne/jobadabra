// What a Full-automation run tells the person afterwards: which answers it gave, which became learnings (What we learned) and which stay with this job only.
// Why (PR C, owner 28 Oct 2026, with hidden-apply-modes-d3): Full automation has no Remember switch to press, so the person reads a recap with Change instead.
// Reads only what the writers already decided (the verdict cache: `learned` + `fills` from lib/learnings.js, `jobOnly` from lib/learned.js); it judges nothing.
import {cached} from './question-verdicts.js';
import {keyOf} from '../renderer/question-filter.js';

/**
 * answers [{label, value}] (what the run answered; lib/learnings.js fromFill) -> {answered, learned [{label, topic}], jobOnly [{label}]}.
 * Invariant: learned and jobOnly are subsets of answered, never both for one label; a label with no verdict yet is only answered (not judged = not claimed).
 */
export function recapOf(storage, {url = '', answers = []} = {}) {
  const known = cached(storage), seen = new Set(), answered = [], learned = [], jobOnly = [];
  for (const {label, value} of answers) {
    const entry = known[keyOf(label)];
    if (!label || seen.has(label)) continue;
    seen.add(label);
    answered.push({label, value: String(value ?? '')});
    if (entry?.learned && (entry.fills || []).some(fill => fill.url === url)) learned.push({label, topic: entry.learned});
    else if ((entry?.jobOnly || []).some(each => each.url === url) || entry?.reuse === 'one_job') jobOnly.push({label});
  }
  return {answered, learned, jobOnly};
}
