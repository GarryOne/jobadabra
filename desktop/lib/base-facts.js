// The facts of Your details that have a value (contact lines and the three sections), as [{label, value}]: what a form question can be answered from
// (owner, 17 Oct 2026: base facts are never asked again). The AI sees the labels only (lib/question-reuse.js); a fact with no value is not listed, so
// a question about it is still asked. A Your details line still asked (a ❓) is listed with value '' (owner, 18 Oct 2026, "Ask once"): the AI maps a form
// question to it, and the question is then asked once, as that Your details item, scored by it (renderer/question-filter.js). The AI sees labels only.
// Guarded by test/question-base-facts.test.js and test/queue-score.test.js.
import * as contact from './contact.js';
import * as sections from './profile-sections.js';
import * as missing from './missing-facts.js';
import {eligibilityOf} from '../renderer/work-eligibility.js';
import {folded} from './eligibility-older.js';

export async function factsOf(storage, fetcher) {
  const [details, extra] = await Promise.all([contact.read(storage, fetcher).catch(() => ({})), sections.read(storage, fetcher).catch(() => ({}))]);
  const own = Object.entries(contact.LABELS).filter(([key]) => details[key]).map(([key, label]) => ({label, value: details[key]}));
  // An older eligibility line folded into Nationality and the zones is not a fact of its own (lib/eligibility-older.js): one source per value.
  const lines = Object.entries(extra).flatMap(([key, items]) => items.filter(item => key !== 'eligibility' || !folded(storage, item))).map(item => (/^❓/.test(String(item.value || '').trim()) ? {label: item.label, value: ''} : item)).filter(item => item.value || item.label);
  // Why (28 Oct 2026, owner, #2322): a zone the nationality opens is a fact ("Yes, freely"), so a form question about it is answered, never asked.
  const concluded = eligibilityOf(extra.eligibility || []).rows.filter(row => row.from === 'nationality').map(row => ({label: row.label, value: row.value, kind: 'per_country'}));
  lines.push(...concluded);
  const gone = missing.listed(storage, [...own, ...lines].map(item => item.label));   // the facts of the catalogue nothing holds: asked once, as their own item (lib/missing-facts.js)
  return [...own, ...lines.filter(item => item.value), ...lines.filter(item => !item.value), ...gone].filter((item, at, all) => all.findIndex(each => each.label === item.label) === at);
}
