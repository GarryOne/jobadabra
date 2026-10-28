// Your portrait (spec docs/superpowers/specs/2026-10-28-your-portrait-design.md, owner 28 Oct 2026): a read-only text the app writes about the person from
// everything it knows. The writer is the one owner of its state (not_yet | current | outdated); it READS the "about you" interface (reader 'portrait') and nothing
// reads it back. Stored as a text page behind the store interface: "Updated:", "Evidence:" (a hash of what was read), sections of "- statement [evidence ids]",
// then "## Evidence" listing each id as "id | label | tab". Guarded by test/portrait.test.js.
import crypto from 'node:crypto';
import {aboutYou} from './about-you.js';
import {openStore} from './store/index.js';
import {nameOfClient} from './ai/names.js';
import {anthropicApi} from './ai/anthropic-api.js';
import {MODEL} from './cv.js';
import {usdOf} from './cover-letter.js';
import {WRITING_RULES} from '../shared/worker/writing-rules.js';

const PAGE = 'portrait';
const TAB = {details: 'details', cv: 'cv', learned: 'answers', strategy: 'details', history: 'details', voice: 'letter'};   // the Profile tab where a source can be corrected

// Each section appears once the evidence reaches its minimum (spec table). Counts come from the bundle. TODO(AI): interview reviews and outcomes come with
// the 'history' part (PR D1c); until then both count 0 and only the CV and learning minimums can open a section (28 Oct 2026).
export const SECTIONS = [
  {key: 'short', title: 'In short', need: c => c.cv},
  {key: 'strengths', title: 'Strengths', need: c => c.cv && (c.learnings >= 5 || c.reviews >= 1)},
  {key: 'come_across', title: 'How you may come across', need: c => c.reviews >= 2 || c.outcomes >= 10},
  {key: 'looking', title: "What you're looking for", need: c => c.learnings >= 3},
  {key: 'work', title: 'How you work', need: c => c.learnings >= 5 || c.reviews >= 2},
  {key: 'personality', title: 'Personality and soft skills', need: c => c.reviews >= 2 || (c.written >= 5 && c.voice)},
];

const kindOf = item => String(item?.kind || '');
/** What the bundle holds, as the minimums count it: {cv, learnings, reviews, outcomes, written, voice}. */
export function countsOf(parts = {}) {
  const history = Array.isArray(parts.history) ? parts.history : [];
  const learned = Array.isArray(parts.learned) ? parts.learned : [];
  return {cv: !!parts.cv, learnings: learned.length, reviews: history.filter(each => kindOf(each) === 'interview_review').length,
    outcomes: history.filter(each => kindOf(each) === 'outcome').length, written: learned.filter(each => kindOf(each) === 'text').length, voice: !!parts.voice};
}
export const qualifying = counts => SECTIONS.filter(section => section.need(counts));

/** What the person still needs for a first portrait, with progress: [{label, have, need}]. */
export const progressOf = counts => [{label: 'Your CV', have: Number(counts.cv), need: 1}, {label: 'Form fills', have: Math.min(counts.learnings, 5), need: 5},
  {label: 'Interview reviews', have: Math.min(counts.reviews, 2), need: 2}];

/** Every citable item of a bundle: id → {label, tab}. Ids: cv, voice, and <part>:<index> for the lists. */
export function evidenceOf(parts = {}) {
  const found = new Map();
  if (parts.cv) found.set('cv', {label: 'Your CV', tab: TAB.cv});
  if (parts.voice) found.set('voice', {label: 'Your base letter', tab: TAB.voice});
  const label = {details: item => item.label, learned: item => item.question, strategy: item => item.label, history: item => item.title || item.company || item.kind || 'History'};
  for (const [part, name] of Object.entries(label)) {
    (Array.isArray(parts[part]) ? parts[part] : []).forEach((item, at) => found.set(`${part}:${at}`, {label: String(name(item) || part).slice(0, 80), tab: TAB[part]}));
  }
  return found;
}

/** A fingerprint of what the portrait reads: a change means new evidence. */
export const fingerprint = parts => crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);

const stamp = parts => {
  const tagged = {};
  for (const [part, value] of Object.entries(parts)) tagged[part] = Array.isArray(value) ? value.map((item, at) => ({id: `${part}:${at}`, ...item})) : value;
  if (parts.cv) tagged.cv = {id: 'cv', ...parts.cv};
  return tagged;
};

const INSTRUCTIONS = `You write "Your portrait": a short, honest description of one job seeker, addressed to them in the second person ("You ..."), from the evidence given.
It is read-only for them and shows what an objective reader would see: strengths and weaker sides alike.
- Every statement rests on evidence: end it with the ids of the items it rests on, in the evidence field; use only ids that appear in the evidence. A statement with no evidence is not written.
- Write only the sections you are allowed (allowed_sections); skip one the evidence cannot support. 1-4 statements per section, one plain sentence each.
- Personality and soft skills: describe behaviour seen in the evidence ("you answer with a concrete example first"), never a personality type, test label, diagnosis or trait name.
- "How you may come across": weaker sides phrased as what an employer might see, kindly and concretely.
- Never mention gender, age, ethnicity, nationality, religion, health, disability, criminal record, family status or other demographic or protected facts, even when the evidence holds them. Salary and money appear only in "What you're looking for".
- When two sources contradict each other (CV against form answers), state neither as fact.
- Give no advice and no actions; this only describes. No flattery, no clichés. Same language as the CV.
- A statement never ends with a square bracket.`;

const SCHEMA = {type: 'object', additionalProperties: false, required: ['sections'], properties: {sections: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['key', 'statements'], properties: {key: {type: 'string'}, statements: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['text', 'evidence'],
    properties: {text: {type: 'string'}, evidence: {type: 'array', items: {type: 'string'}}}}}}}}}};

/**
 * Asks the AI for the allowed sections and keeps only what the invariants allow: a section outside `allowed`, a statement without a known evidence id and an empty
 * section are dropped. -> {sections: [{key, title, statements: [{text, evidence: [id]}]}], evidence: Map, usd}.
 */
export async function write(parts, allowed, {client, apiKey} = {}) {
  const anthropic = client || anthropicApi(apiKey), known = evidenceOf(parts);
  const response = await anthropic.messages.create({model: MODEL, max_tokens: 4000, system: `${INSTRUCTIONS}\n\n${WRITING_RULES}`,
    messages: [{role: 'user', content: `<allowed_sections>${JSON.stringify(allowed.map(({key, title}) => ({key, title})))}</allowed_sections>\n\n<evidence>\n${JSON.stringify(stamp(parts))}\n</evidence>`}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}}}, {headers: {'x-jp-action': 'portrait'}});
  if (response.stop_reason === 'refusal') throw new Error(`${nameOfClient(anthropic)} declined to write this portrait`);
  if (response.stop_reason === 'max_tokens') throw new Error('The portrait was cut off; it stays as it was');
  const answer = JSON.parse(response.content.find(block => block.type === 'text').text);
  const sections = [];
  for (const section of allowed) {
    const mine = (answer.sections || []).find(each => each.key === section.key);
    const statements = (mine?.statements || []).map(each => ({text: String(each.text || '').trim(), evidence: [...new Set(each.evidence || [])].filter(id => known.has(id))}))
      .filter(each => each.text && each.evidence.length);
    if (statements.length) sections.push({key: section.key, title: section.title, statements});
  }
  const used = new Map();
  for (const id of sections.flatMap(section => section.statements.flatMap(each => each.evidence))) used.set(id, known.get(id));
  return {sections, evidence: used, usd: usdOf(response.usage)};
}

/** The stored text for a written portrait. */
export function render({sections, evidence}, {date, hash}) {
  const lines = [`Updated: ${date}`, `Evidence: ${hash}`, ''];
  for (const section of sections) lines.push(`## ${section.title}`, ...section.statements.map(each => `- ${each.text} [${each.evidence.join(', ')}]`), '');
  lines.push('## Evidence', ...[...evidence].map(([id, info]) => `- ${id} | ${info.label} | ${info.tab}`));
  return lines.join('\n') + '\n';
}

/** The stored portrait from its page blocks (the same on every adapter), or null: {date, hash, sections: [{key, title, statements}], evidence: {id: {label, tab}}}. */
export function parse(blocks) {
  const record = {date: '', hash: '', sections: [], evidence: {}};
  let section = null, found = false;
  for (const block of blocks) {
    const text = String(block.text || '').trim();
    if (/^heading_/.test(block.type)) {
      found = true;
      section = text === 'Evidence' ? 'evidence' : {key: SECTIONS.find(each => each.title === text)?.key || text, title: text, statements: []};
      if (section !== 'evidence') record.sections.push(section);
    } else if (!section) {
      record.date = text.match(/^Updated:\s*(.+)$/)?.[1] || record.date;
      record.hash = text.match(/^Evidence:\s*(\S+)$/)?.[1] || record.hash;
    } else if (section === 'evidence') {
      const [id, label, tab] = text.split(' | ');
      if (id && label) record.evidence[id] = {label, tab: tab || ''};
    } else {
      const cited = text.match(/^(.*\S)\s*\[([^\]]+)\]$/);
      if (cited) section.statements.push({text: cited[1], evidence: cited[2].split(',').map(id => id.trim()).filter(Boolean)});
    }
  }
  return found ? record : null;
}

/**
 * What the Your portrait tab draws: {state: 'not_yet' | 'current' | 'outdated', sections, evidence, updated, progress}. not_yet: no section qualifies and nothing was
 * written; outdated: the evidence changed since the last run (the text stays, "Updating soon").
 */
export async function status(storage, {fetcher, bundle} = {}) {
  const opened = openStore(storage, {fetcher});
  const [{parts}, stored] = await Promise.all([bundle ? Promise.resolve(bundle) : aboutYou(storage, 'portrait', {fetcher}), opened.page(PAGE).blocks().catch(() => [])]);
  const record = parse(stored), counts = countsOf(parts), ready = qualifying(counts).length > 0;
  const base = {progress: progressOf(counts), sections: record?.sections || [], evidence: record?.evidence || {}, updated: record?.date || ''};
  if (!record && !ready) return {...base, state: 'not_yet'};
  if (!record) return {...base, state: 'outdated'};
  return {...base, state: record.hash === fingerprint(parts) ? 'current' : 'outdated'};
}

/**
 * One run if it is due: at most one a day, only when the evidence changed, never below every minimum. A failed or capped run writes nothing, so the text stays
 * as it was (outdated). -> {ran, reason: 'unchanged' | 'today' | 'not_yet' | 'written', usd}.
 */
export async function refresh(storage, {client, apiKey, fetcher, bundle, now = new Date()} = {}) {
  const opened = openStore(storage, {fetcher}), page = opened.page(PAGE);
  const {parts} = bundle || await aboutYou(storage, 'portrait', {fetcher});
  const allowed = qualifying(countsOf(parts));
  if (!allowed.length) return {ran: false, reason: 'not_yet', usd: 0};
  const hash = fingerprint(parts), record = parse(await page.blocks().catch(() => []));
  const date = now.toISOString().slice(0, 10);
  if (record?.hash === hash) return {ran: false, reason: 'unchanged', usd: 0};
  if (record?.date === date) return {ran: false, reason: 'today', usd: 0};
  const result = await write(parts, allowed, {client, apiKey});
  if (!result.sections.length) throw new Error('The portrait came back empty; it stays as it was');
  await page.write(render(result, {date, hash}));
  return {ran: true, reason: 'written', usd: result.usd};
}
