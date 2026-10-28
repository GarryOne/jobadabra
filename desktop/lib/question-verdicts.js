// The AI's verdict per question, kept on this Mac so a question is never asked twice (settings.questionVerdicts, keyed by the question's normalized words),
// what every list shows reads through renderer/question-filter.js: the two drawers and the saved answers that are no learning (lib/question-lists.js openShown),
// and the session's "what Claude needs". Guarded by test/question-lists.test.js and test/question-queues.test.js.
import {classify} from './question-reuse.js';
import {keyOf, looksLikeFieldId} from '../renderer/question-filter.js';

const MAX = 600;
const VERSION = 6;   // 2: covered_by also by deduction (a saved permit settles "need sponsorship?"), with the saved answer it came from; 3: a topic (seen twice); 4: a fact of Your details
// 5: Why (28 Oct 2026, owner: "Yes, re-judge once"): how they heard and worked here before are one job's (lib/question-reuse.js), judged again once per install
// 6: right to work and sponsorship from Nationality and the zones (#2322)
export const cached = storage => storage.settings().questionVerdicts || {};

// Classifies the labels with no verdict yet (one small call), keeps the verdicts, returns the whole map. ai: {client, apiKey} (none: nothing new).
// facts: [{label, value}] of Your details (lib/base-facts.js); a label that means one is answered from there (verdict "details"), never asked.
const sigOf = facts => facts.map(fact => fact.label).sort().join('|');
export async function ensure(storage, labels, {answered = [], facts = [], company = '', host = '', ai = {}} = {}) {
  const known = cached(storage), now = new Map(answered.map(a => [a.question, a.answer])), sig = sigOf(facts), have = new Set(facts.map(fact => fact.label));
  const values = new Map(facts.map(fact => [fact.label, String(fact.value ?? '')]));
  // Why (28 Oct 2026, #2322 review): an eligibility answer is read from its row's status, so a changed row judges it again.
  const moved = entry => { const on = entry.row || entry.fact; return Boolean(entry.asks) && values.get(on) !== (entry.from || values.get(on)); };
  // judged again: never judged, judged before answers could be deduced (no v: once), the saved answer its proposal came from changed (or is gone),
  // its Your details fact was emptied, or a fact was added since it was judged (a question kept as asked may now be answered from there)
  const stale = entry => entry && (entry.v !== VERSION || (entry.covered_by && now.get(entry.covered_by) !== entry.from)
    || moved(entry) || (entry.reuse === 'details' ? !have.has(entry.fact) : (entry.sig || '') !== sig));
  const fresh = [...new Set(labels.filter(label => label && !looksLikeFieldId(label) && (!known[keyOf(label)] || stale(known[keyOf(label)]))))];
  if (!fresh.length || !(ai.client || ai.apiKey)) return {verdicts: known, usage: null};
  const found = await classify({labels: fresh, answered, facts, company, host, apiKey: ai.apiKey, client: ai.client});
  const next = {...known};
  for (const [label, verdict] of found) next[keyOf(label)] = {...known[keyOf(label)], ...verdict, v: VERSION, sig, question: label, asked: known[keyOf(label)]?.asked || 0, at: new Date().toISOString().slice(0, 10)};
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX))) delete next[key];
  storage.saveSettings({questionVerdicts: next});
  return {verdicts: next, usage: found.usage || null};
}

// The questions the standard answers already answer ([{question, answer}]): what "covered" is judged against.
export async function answeredOf(storage, groups) {
  return (groups || []).flatMap(group => group.items).filter(item => !item.open && !item.guidance && item.answer).map(item => ({question: item.question, answer: item.answer}));
}

// The other employers that asked the same question before (its topic, else its words): [{label, company, url}], this employer's own jobs left out.
const sameEmployer = (job, {url = '', company = ''}) => (company && job.company ? job.company.toLowerCase() === company.toLowerCase() : job.url === url);
export function askedBefore(verdicts, label, {url = '', company = ''} = {}) {
  const key = keyOf(label), topic = verdicts[key]?.topic;
  return Object.entries(verdicts).filter(([each, entry]) => each === key || (topic && entry.topic === topic))
    .flatMap(([, entry]) => (entry.jobs || []).filter(job => !sameEmployer(job, {url, company})).map(job => ({label: entry.question || '', ...job})));
}

// A fill's candidates (owner, 17 Oct 2026, "Seen twice, auto"): reusable, not covered by an answer, and asked by ANOTHER employer before. The first
// sighting stays with its job (its drawer); the second is kept: the Set of labels, .from: label -> the earlier wordings (their typed answer is reused).
export async function judge(storage, labels, options = {}) {
  const {verdicts} = await ensure(storage, labels, options);
  const keep = new Set(), from = new Map(), next = {...verdicts};
  for (const label of labels) {
    const v = verdicts[keyOf(label)];
    if (v?.reuse !== 'reusable' || v.covered_by || v.onlyJob) continue;
    const before = askedBefore(verdicts, label, options);
    if (!before.length) continue;
    keep.add(label);
    from.set(label, [...new Set(before.map(job => job.label).filter(Boolean))]);
    next[keyOf(label)] = {...v, promoted: {url: options.url || '', company: options.company || '', at: new Date().toISOString().slice(0, 10)}};
  }
  if (keep.size) storage.saveSettings({questionVerdicts: next});
  keep.from = from;
  return keep;
}

// "Only this job" (the Undo of a remembered question): never kept as a standard answer again.
export function onlyThisJob(storage, question) {
  const known = cached(storage), entry = known[keyOf(question)];
  if (!entry) return false;
  const {promoted, ...rest} = entry;
  storage.saveSettings({questionVerdicts: {...known, [keyOf(question)]: {...rest, onlyJob: true}}});
  return Boolean(promoted);
}

// A fill met these questions again: how many forms asked each, that a required one blocked the fill, and which job asked (a one-job question shows in that job's drawer).
export function record(storage, labels, {url = '', company = ''} = {}) {
  const known = cached(storage), next = {...known};
  let changed = false;
  for (const label of labels) {
    const entry = next[keyOf(label)];
    if (!entry) continue;
    const jobs = (entry.jobs || []).filter(job => job.url !== url);
    next[keyOf(label)] = {...entry, question: entry.question || label, asked: (entry.asked || 0) + 1, blocked: true, jobs: url ? [...jobs, {url, company}].slice(-5) : jobs};
    changed = true;
  }
  if (changed) storage.saveSettings({questionVerdicts: next});
}

// This job's questions for its drawer ([{question, state}]): 'one_job' (only this job asks it), 'once' (reusable, asked by one employer so far: kept
// with the job until a second asks), 'remembered' (this job was the second: it became a standard answer; Undo = only this job).
export function forJob(storage, url) {
  const stateOf = entry => (entry.reuse === 'one_job' ? 'one_job' : entry.reuse !== 'reusable' || entry.covered_by ? ''
    : entry.promoted?.url === url ? 'remembered' : entry.promoted ? '' : 'once');
  return Object.values(cached(storage)).filter(entry => entry.question && (entry.jobs || []).some(job => job.url === url) || entry.promoted?.url === url)
    .map(entry => ({question: entry.question || '', state: stateOf(entry)})).filter(entry => entry.question && entry.state);
}
