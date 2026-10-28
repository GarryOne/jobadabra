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
import {openStore} from './store/index.js';

export const PARTS = ['details', 'cv', 'learned', 'strategy', 'history', 'voice', 'this_job'];
export const PRIORITY = ['details', 'learned', 'cv', 'strategy', 'history', 'voice', 'this_job'];   // a budget cuts from the end: a long history never pushes out facts
const BUDGET = 12000;   // characters of the rendered bundle per reader unless it names its own

// Who takes what (spec table; ★ owner decisions): keepSensitive only where a form field is the place for it; noSalary: CV tailoring and letters (★).
// learned 'summary': CV tailoring may use a learning in the summary only, never in a role (★); the reader's prompt says so.
export const READERS = {
  form: {parts: ['details', 'cv', 'learned', 'strategy'], keepSensitive: true},
  kit: {parts: ['details', 'cv', 'learned', 'strategy'], keepSensitive: true},
  // Why (Gitar on #2337): the CV is CV tailoring's material, so it fits whole. TODO(AI): set each reader's budget from D1b/D1c's measured cost (28 Oct 2026)
  cv_tailor: {parts: ['details', 'cv', 'learned', 'strategy'], noSalary: true, learnedUse: 'summary', budget: 40000},
  letter: {parts: ['details', 'cv', 'learned', 'strategy', 'voice'], noSalary: true},
  score: {parts: ['details', 'cv', 'learned', 'strategy']},
  insights: {parts: ['details', 'cv', 'learned', 'strategy', 'history']},
  prep: {parts: ['details', 'cv', 'learned', 'history', 'this_job']},
  review: {parts: ['details', 'cv', 'learned', 'history']},
  portrait: {parts: ['details', 'cv', 'learned', 'strategy', 'history', 'voice']},
};

const sizeOf = parts => JSON.stringify(parts).length;   // the bundle as a prompt carries it

// A copy of value one step smaller, keeping its shape: its longest list (a CV's work, a role's highlights) loses its last item; with no list left, its longest
// text loses a tenth. null when nothing is left to shrink.
function shorter(value) {
  let list = null, words = null;
  const walk = (node, trail) => {
    if (Array.isArray(node)) { if (node.length && (!list || node.length > list.node.length)) list = {node, trail}; node.forEach((each, at) => walk(each, [...trail, at])); }
    else if (typeof node === 'string') { if (node.length && (!words || node.length > words.node.length)) words = {node, trail}; }
    else if (node && typeof node === 'object') for (const [key, each] of Object.entries(node)) walk(each, [...trail, key]);
  };
  walk(value, []);
  const pick = list || words;
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
 * Invariants: a conflict (two answers) reaches no reader; a sensitive learning, or one not judged yet, reaches only form filling and kit answers; a reader
 * with noSalary gets no line the AI judged a salary, no learning whose kind was never judged, and no Strategy pay field.
 */
export function bundleOf(sources, reader) {
  const rule = READERS[reader];
  if (!rule) throw new Error(`about-you: no reader ${reader}`);
  const salary = item => rule.noSalary && (item.kind === 'salary' || item.group === 'pay');
  const keep = {
    details: list => list.filter(item => !salary(item)),
    learned: list => list.filter(item => item.state !== 'conflict' && (rule.keepSensitive || item.sensitive === false) && !(rule.noSalary && (!item.kind || item.kind === 'salary'))),
    strategy: list => list.filter(item => !salary(item)),
  };
  const parts = {}, lacked = [];
  for (const name of rule.parts) {
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

/**
 * Reads each part from its one source on this Mac: Your details (contact + sections), What we learned (the answers page, with the AI's sensitive verdict and
 * kind per question), Strategy (the Profile's search fields), the main CV. history, voice and this_job come with their readers (PR D1c, D2).
 * -> bundleOf(sources, reader). A part whose source fails to read is absent, so the bundle names it in lacked.
 */
export async function aboutYou(storage, reader, {fetcher} = {}) {
  const opened = openStore(storage, {fetcher});
  const read = promise => promise.catch(() => undefined);
  const [person, facts, answers, profile] = await Promise.all([read(contact.read(storage, fetcher)), read(sections.read(storage, fetcher)),
    read(opened.page('answers').outline()), read(opened.page('profile').outline())]);
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
  if (profile) {
    const {fields} = readProfile(profile);
    sources.strategy = FIELDS.filter(field => fields[field.key] && !fields[field.key].open && fields[field.key].value).map(field => ({label: field.label, value: fields[field.key].value, group: field.group}));
  }
  const cv = baseCv(storage);
  if (cv) sources.cv = cv;
  return bundleOf(sources, reader);
}
