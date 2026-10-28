// About you, everywhere (spec docs/superpowers/specs/2026-10-28-about-you-everywhere-design.md, owner 28 Oct 2026): what every AI step knows about the person
// comes through here, by named parts, each read from its one source; a reader takes only its parts, minus its fixed exclusions. Built on this Mac (the
// sketch's option a); an engine step it starts gets the bundle, a cloud run without one names the parts it lacked. Guarded by test/about-you.test.js.
import {keyOf} from '../renderer/question-filter.js';
import {FIELDS, readProfile} from '../renderer/preferences-model.js';
import {learningsOf} from './learnings.js';
import * as sections from './profile-sections.js';
import * as contact from './contact.js';
import * as verdicts from './question-verdicts.js';
import * as formats from './question-formats.js';
import {baseCv} from './cv.js';
import * as letterStyle from './letter-style.js';
import * as letters from './cover-letter.js';
import * as experience from './experience.js';
import {openStore} from './store/index.js';
import {writePrivate} from './private-file.js';

export const PARTS = ['details', 'cv', 'learned', 'strategy', 'history', 'voice', 'this_job'];
export const PRIORITY = ['details', 'learned', 'cv', 'strategy', 'history', 'voice', 'this_job'];   // a budget cuts from the end: a long history never pushes out facts
const BUDGET = 12000;   // characters of the rendered bundle per reader unless it names its own

// Who takes what (spec table; ★ owner decisions): noSalary: CV tailoring and letters (★). A sensitive learning reaches no reader here.
// learned 'summary': CV tailoring may use a learning in the summary only, never in a role (★); the reader's prompt says so.
// Why (owner, 28 Oct 2026, D1b option A): form filling and kit answers take every part, so they keep reading the full Profile and answers pages
// (worker/src/extension.js, src/ai/kit.py); kits take only the CV + Experience bank from here, which they lacked. Form filling is no reader here.
export const READERS = {
  // Why (D1b, measured 28 Oct 2026): CV JSON is ~1.9 characters a token; 16000 keeps a two-page CV with its bank bullets whole, ~8k tokens a kit at most.
  kit: {parts: ['cv'], budget: 16000},
  // Why (Gitar on #2337): the CV is CV tailoring's material, so it fits whole. TODO(AI): set each reader's budget from D1b/D1c's measured cost (28 Oct 2026)
  cv_tailor: {parts: ['details', 'cv', 'learned', 'strategy'], noSalary: true, learnedUse: 'summary', budget: 40000},
  letter: {parts: ['details', 'cv', 'learned', 'strategy', 'voice'], noSalary: true},
  score: {parts: ['details', 'cv', 'learned', 'strategy']},
  insights: {parts: ['details', 'cv', 'learned', 'strategy', 'history']},
  prep: {parts: ['details', 'cv', 'learned', 'history', 'this_job']},
  review: {parts: ['details', 'cv', 'learned', 'history']},
  portrait: {parts: ['details', 'cv', 'learned', 'strategy', 'history', 'voice']},
};

// What the readers page on the website shows (owner via the coordinator, 28 Oct 2026: "publish on the website … this table", live only, nothing claimed before it works).
// LIVE: the readers whose bundle a step really receives today (a reader in READERS but not here is built, not wired). GATHERED: the parts aboutYou() reads today (history
// and this job come with D2): a cell is claimed only for a live reader's part that is gathered. PAGES: parts a step still reads straight from a page or file.
// Add a reader to LIVE in the PR that wires it, and a part to GATHERED in the PR that reads it; test/about-you-readers.test.js fails when the exported JSON
// (docs/about-you-readers.json) is out of date, or when GATHERED disagrees with a real aboutYou() call.
export const LIVE = ['kit', 'portrait', 'cv_tailor', 'letter'];   // cv_tailor: lib/cv.js tailor takes its bundle (D1c-1); letter: job-letter.js and cover-letter.js (D1c-2, 28 Oct 2026)
export const GATHERED = ['details', 'cv', 'learned', 'strategy', 'voice'];
export const PAGES = {form: ['details', 'cv', 'learned', 'strategy'], kit: ['details', 'learned', 'strategy']};
export const NAMES = {
  parts: {details: 'Your details', cv: 'CV + Experience bank', learned: 'What we learned', strategy: 'Strategy', history: 'History', voice: 'Voice', this_job: 'This job'},
  readers: {form: 'Form filling', kit: 'Kit answers', cv_tailor: 'CV tailoring', letter: 'Letters', score: 'Job fit score', insights: 'Insights and Analyze my search',
    prep: 'Interview prep', review: 'Interview insights and rejection review', portrait: 'Your portrait'},
};

/** The readers table as data, for the website: every reader (form filling too), its parts through About you (only when live), the parts it still reads from a page, what it never gets. */
export function readersTable() {
  const names = [...new Set(['form', ...Object.keys(READERS)])];
  return {
    parts: PARTS.map(key => ({key, label: NAMES.parts[key]})),
    readers: names.map(key => {
      const rule = READERS[key], live = LIVE.includes(key);
      return {key, label: NAMES.readers[key], live, through: live ? rule.parts.filter(part => GATHERED.includes(part)) : [], pages: PAGES[key] || [],
        never: rule ? [...(rule.noSalary ? ['salary'] : []), 'sensitive answers'] : []};   // form filling reads its pages itself, sensitive fields included
    }),
  };
}

const sizeOf = parts => JSON.stringify(parts).length;   // the bundle as a prompt carries it

// A copy of value one step smaller, keeping its shape: a text longer than LONG_TEXT loses a tenth first (Gitar on #2337: one long summary is cut before any
// role goes), then its longest list (a CV's work, a role's highlights) loses its last item, then its longest text. null when nothing is left to shrink.
const LONG_TEXT = 1000;
function shorter(value) {
  let list = null, words = null;
  const walk = (node, trail) => {
    if (Array.isArray(node)) { if (node.length && (!list || node.length > list.size)) list = {node, trail, size: node.length}; node.forEach((each, at) => walk(each, [...trail, at])); }
    else if (typeof node === 'string') { if (node.length && (!words || node.length > words.size)) words = {node, trail, size: node.length}; }
    else if (node && typeof node === 'object') for (const [key, each] of Object.entries(node)) walk(each, [...trail, key]);
  };
  walk(value, []);
  const pick = (words?.size || 0) > LONG_TEXT ? words : list || words;
  if (!pick) return null;
  const cut = node => (Array.isArray(node) ? node.slice(0, -1) : node.slice(0, Math.floor(node.length * 0.9)));
  if (!pick.trail.length) return cut(value);
  const copy = structuredClone(value), at = pick.trail.at(-1);
  const holder = pick.trail.slice(0, -1).reduce((node, step) => node[step], copy);
  holder[at] = cut(holder[at]);
  return copy;
}

/**
 * The bundle one reader gets, pure. sources: {details: [{label, value, kind}], learned: [{question, answer, state, sensitive, kind}], strategy: [{label, value, group}],
 * cv, history, voice, this_job} (a part the gatherer could not read is absent). -> {reader, parts, lacked: the reader's parts that were absent, learnedUse}.
 * Invariants: a conflict (two answers) reaches no reader; a sensitive learning, or one not judged yet, reaches no reader; a reader with noSalary gets no
 * line the AI judged a salary, no learning whose kind was never judged, and no Strategy pay line (a pay field, or a rule under Compensation).
 */
export function bundleOf(sources, reader, {skip = []} = {}) {
  const rule = READERS[reader];
  if (!rule) throw new Error(`about-you: no reader ${reader}`);
  const salary = item => rule.noSalary && (item.kind === 'salary' || item.group === 'pay');
  const keep = {
    details: list => list.filter(item => !salary(item)),
    learned: list => list.filter(item => item.state !== 'conflict' && item.sensitive === false && !(rule.noSalary && (!item.kind || item.kind === 'salary'))),
    strategy: list => list.filter(item => !salary(item)),
  };
  const parts = {}, lacked = [];
  for (const name of rule.parts.filter(each => !skip.includes(each))) {   // skip: a part the caller carries itself, so it is neither read, counted in the budget nor named lacked (Gitar on #2373)
    if (sources[name] === undefined || sources[name] === null) { lacked.push(name); continue; }
    parts[name] = keep[name] ? keep[name](sources[name]) : sources[name];
  }
  const budget = rule.budget || BUDGET;
  for (const name of [...PRIORITY].reverse()) {
    // Why (Gitar on #2337): a part keeps its shape (the CV stays an object a reader can read) and shrinks before any higher part does.
    for (let next = parts[name]; sizeOf(parts) > budget && parts[name] !== undefined && (next = shorter(parts[name])) !== null;) parts[name] = next;
  }
  return {reader, parts, lacked, ...(rule.learnedUse ? {learnedUse: rule.learnedUse} : {})};
}

// The main CV with the Experience bank's extra bullets and skills (lib/experience.js withExtras); a bank that cannot be read leaves the main CV.
function cvOf(storage) {
  const base = baseCv(storage);
  if (!base) return undefined;
  try { return experience.withExtras(storage, base); } catch { return base; }
}

// Voice: the person's Writing preferences (Profile → Cover letter) and, when `example`, the text of their approved base letter, as a sample of their own phrasing.
// A draft or a letter with a gap is no sample (the person has not accepted it). Why (owner, 28 Oct 2026, D1c-2): the base letter is the voice example, approved only.
async function voiceOf(storage, {example}) {
  const record = example ? letters.load(storage) : null;
  return {preferences: await letterStyle.read(storage), ...(record?.status === 'approved' && record.text ? {example: record.text} : {})};
}

// Strategy: the Profile's search fields, then its deal-breakers and other preferences (a rule under Compensation is a pay line).
function strategyOf(profile) {
  const {fields, other} = readProfile(profile);
  const set = item => item && !item.open && String(item.value || '').trim();
  return [...FIELDS.filter(field => set(fields[field.key])).map(field => ({label: field.label, value: fields[field.key].value, group: field.group})),
    ...other.filter(set).map(item => ({label: item.label || (item.side === 'must' ? 'Deal-breaker' : 'Preference'), value: item.value,
      group: item.pay ? 'pay' : item.side === 'must' ? 'deal-breaker' : 'preference'}))];
}

/**
 * Reads each part the reader takes from its one source on this Mac: Your details (contact + sections), What we learned (the answers page, with the AI's
 * sensitive verdict and kind per question), Strategy (the Profile's search fields and rules), the main CV with the Experience bank, Voice (Writing preferences + the approved base letter). history and
 * this_job come with their readers (PR D2). -> bundleOf(sources, reader). A part whose source fails to read is absent, so the bundle names it in lacked.
 */
export async function aboutYou(storage, reader, {fetcher, skip = [], example = true} = {}) {
  const takes = new Set((READERS[reader]?.parts || []).filter(part => !skip.includes(part)));
  const opened = openStore(storage, {fetcher});
  const read = (part, load) => (takes.has(part) ? load().catch(() => undefined) : undefined);
  // Voice first: reading the Writing preferences moves an old "Cover letter style" section off the answers page, which What we learned reads next (lib/letter-style.js).
  const voice = await read('voice', () => voiceOf(storage, {example}));
  const [person, facts, answers, profile] = await Promise.all([read('details', () => contact.read(storage, fetcher)), read('details', () => sections.read(storage, fetcher)),
    read('learned', () => opened.page('answers').outline()), read('strategy', () => opened.page('profile').outline())]);
  const known = verdicts.cached(storage), kinds = formats.kept(storage);
  const sources = {};
  if (person || facts) {
    sources.details = [...Object.entries(contact.LABELS).filter(([key]) => person?.[key]).map(([key, label]) => ({label, value: person[key]})),
      ...Object.values(facts || {}).flat().filter(line => line.value).map(({label, value, kind = ''}) => ({label, value, kind}))];
  }
  if (answers) {
    sources.learned = learningsOf(answers).filter(each => each.answer).map(({item, question, answer}) => ({question, answer, state: item.state || '',
      sensitive: known[keyOf(question)]?.sensitive, kind: item.mark?.kind || kinds[keyOf(question)]?.kind || ''}));
  }
  if (profile) sources.strategy = strategyOf(profile);
  if (voice) sources.voice = voice;
  if (takes.has('cv')) sources.cv = cvOf(storage);
  return bundleOf(sources, reader, {skip});
}

// Parts read from this Mac's files without a store call: an engine run starts synchronously (lib/pipeline-run.js), so its bundle comes from these.
const LOCAL = {cv: cvOf};

/**
 * The bundle of a reader whose parts are all local files (kit answers: the CV), built at once. Throws for a reader that needs a store read (use aboutYou).
 * A part with nothing on this Mac (no CV imported) is named in lacked.
 */
export function localBundle(storage, reader) {
  const rule = READERS[reader];
  if (!rule) throw new Error(`about-you: no reader ${reader}`);
  const far = rule.parts.filter(part => !LOCAL[part]);
  if (far.length) throw new Error(`about-you: ${reader} needs a store read (${far.join(', ')})`);
  return bundleOf(Object.fromEntries(rule.parts.map(part => [part, LOCAL[part](storage)])), reader);
}

/** Writes a local reader's bundle (localBundle) to file, readable by this user only, for an engine step (src/ai/kit.py about_you). -> file, or '' when it could not. */
export function writeBundle(storage, reader, file) {
  try { writePrivate(file, JSON.stringify(localBundle(storage, reader))); return file; } catch { return ''; }
}
