// "Answer once": questions Jobadabra needs you to answer. With Notion connected they are the ❓ lines of
// your standard answers page (the source of truth), and its table rows whose Answer cell is still ❓ ("If a
// salary field is optional | ❓ to confirm — leave blank, or always fill"). The strategy draft writes lines ("Notice period: ❓"),
// and a form fill adds the required questions nothing could answer ("Visa sponsorship needed: ❓ (asked by
// Acme)"). Answering replaces the ❓ with your answer on that same line, so every later kit and fill has it;
// deleting the line works too. The page is the active store's (lib/store: Notion's page, or answers.md on this Mac).
import {openStore} from './store/index.js';
import {aliasKey, fileKind} from '../shared/alias-schema.js';
import * as sharedMeanings from './aliases.js';
import {asksQuestion} from './label-shape.js';
import {looksLikeFieldId} from '../renderer/question-filter.js';
import {noteFields} from './question-formats.js';
import {formatOfField, splitMark, withMark} from '../renderer/question-kind.js';
import * as knowledge from './knowledge.js';
import {HOME_NAMES, homeOf, writeHome} from './answer-home.js';
import * as verdicts from './question-verdicts.js';

export const NO_ANSWER = 'no answer in the kit, Profile or your details';
export const key = question => String(question || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const ASKED = /\s*\(asked by ([^)]*)\)\s*$/;
const MARK = /❓(\s*\(asked by [^)]*\))?/;

const answersPage = (storage, fetcher) => openStore(storage, {fetcher}).page('answers');
// A form's "required" marker is not part of the question ("* Nationality", "Postal Code *").
const unmarked = text => String(text || '').replace(/^[\s*]+|[\s*]+$/g, '');
// A line's kind mark ("[pick one: Mr | Mrs]", renderer/question-kind.js), when it has one: {kind, options, list}.
const markOf = split => (split.marked ? {kind: split.kind, options: split.options, ...(split.list ? {list: split.list} : {}), ...(split.constraints ? {constraints: true} : {})} : null);
// A ❓ line -> {key: block id, question, company, mark}.
export function parseLine(block) {
  const split = splitMark(block.text), text = split.text;
  const company = text.match(ASKED)?.[1] || '';
  const question = unmarked(text.replace(ASKED, '').replace(/❓/g, '').replace(/[\s:—-]+$/, ''));
  return {key: block.id, question, company, mark: markOf(split)};
}
// The question part of a line: before its ":" or " — " ("Salary expectation: CHF 130,000" -> "Salary expectation").
const label = text => splitMark(text).text.replace(ASKED, '').split(/:\s| — /)[0].replace(/❓/g, '');
// format: the field's {kind, options} (a text question carries no mark).
export const questionLine = (question, company, format = null) => withMark(`${question}: ❓${company ? ` (asked by ${company})` : ''}`, format);
export const answeredLine = (text, answer) => text.replace(MARK, answer);

// A line is a question only when ❓ stands where its answer goes ("Notice period: ❓", "Visa: ❓ (asked by Acme)");
// a sentence that merely mentions ❓ ("Fields marked ❓ to confirm are guesses") is not.
export const isQuestionLine = text => /(^|[:—–-]\s*)❓(\s*\(asked by [^)]*\))?\s*$/.test(splitMark(text.trim()).text.trim());

// Table rows [Question | Answer] whose answer cell starts with ❓ or is empty, at the page's top level and one level down (in a toggle).
function openRows(items, depth = 0) {
  const found = [];
  for (const item of items) {
    if (item.type === 'table') {
      for (const row of item.rows.slice(item.header ? 1 : 0)) {
        const cells = row.cells;
        if (cells.length >= 2 && cells[0].trim() && (cells[1].trim().startsWith('❓') || !cells[1].trim())) found.push({row, cells});   // empty: not answered either
      }
    } else if (item.children && depth < 1) {
      found.push(...openRows(item.children, depth + 1));
    }
  }
  return found;
}
const hintOf = answer => answer.replace(/^❓\s*/, '').replace(/^(to confirm|optional)\s*[—:-]?\s*/i, '').trim();

export async function list(storage, fetcher) {
  const page = answersPage(storage, fetcher);
  const blocks = await page.blocks();
  const lines = blocks.filter(block => block.text.includes('❓') && isQuestionLine(block.text)).map(parseLine).filter(q => q.question && !unanswerable(q.question));
  const rows = openRows(await page.outline()).map(({row, cells}) => {
    const split = splitMark(cells[0]);
    return {key: row.id, question: unmarked(split.text.replace(/❓/g, '')), company: '', hint: hintOf(cells[1]), mark: markOf(split)};
  }).filter(q => !unanswerable(q.question));
  return [...lines, ...rows];
}

// Contact fields (the same labels the fill reads from your Profile's Contact section, extension/page/fill.js
// PROFILE_LABELS): never a question for the answers page. Empty after a fill means your details didn't load (Notion
// busy, an extension error) or aren't in the Profile: 29 Sep 2026 a Canonical fill added "First Name: ❓",
// "Last Name: ❓" and "Email: ❓" to the answers page.
export const CONTACT = /first\s*name|given\s*name|vorname|prénom|last\s*name|family\s*name|surname|nachname|nom de famille|^\s*(full\s*)?name\s*\*?\s*$|full\s*name|e-?mail|phone|mobile|telefon|téléphone|linked\s*in|github|website|portfolio|personal\s*(site|page)|^\s*(current\s*)?(location|city)\b/i;

// The CV is a file, uploaded from your Profile on every form, never an answer to remember: a "CV file" row (the old Notion template
// had one), or a fill that found "Resume/CV" unanswered, must not become a question (2 Oct 2026: a user was asked to type one).
export const isFileQuestion = text => /^\s*(cv|c\.v\.|resume|r[ée]sum[ée]|curriculum vitae|lebenslauf)(\s*[/&,]\s*(cv|resume|r[ée]sum[ée]|cover letter))?(\s+(file|document|upload|attachment|pdf))?\s*[*:]*\s*$/i.test(unmarked(text));

// A password, a captcha or a one-time code is never an answer to keep (owner, 13 Oct 2026: "Captcha", "Your password" and
// "Repeat Password" were listed): a safety floor, for the labels as forms write them in any language.
export const isSecretQuestion = text => /pass\s*-?\s*(word|wort|phrase|code)|kennwort|mot de passe|contrase[ñn]a|senha|palavra-passe|password|passwort|passwd|\bpin\b|captcha|not a robot|kein roboter|security (code|question)|verification code|one[- ]time (code|password)|\botp\b|2fa|two[- ]factor|sms code|bot check/i.test(unmarked(text));   // words-ok: a safety floor that only removes a question from the Answer once list (never decides a page, never fills a field); a missed label is just listed
// Never listed in Answer once, from the page or from a fill.
const unanswerable = text => isFileQuestion(text) || isSecretQuestion(text);

// Required fields a fill couldn't answer -> new ❓ lines (skipping any question the page already has, and contact
// fields, which come from the Profile).
// reusable: async labels -> the Set worth keeping (the AI's judgment, lib/question-reuse.js); left out, every candidate is kept (unit tests).
// seen: (labels) after the fill, for every required question it could not answer, new or not (ranking: how many forms asked, blocked a fill).
// remembered: (labels) the questions kept WITH the answer you typed on a form ("seen twice": the caller says "Remembered for future forms").
export async function collect(storage, run, company = '', fetcher, reusable = null, seen = null, remembered = null) {
  noteFields(storage, run.trace || []);   // every labelled field's kind and options, kept on this Mac (lib/question-formats.js)
  const found = {labels: [], remembered: []};
  const added = await collectNew(storage, run, company, fetcher, reusable, found);
  if (seen && found.labels.length) await seen(found.labels);
  if (remembered && found.remembered.length) remembered(found.remembered);
  return added;
}
// New questions have their own heading (owner, 17 Oct 2026: they were appended at the page's end, inside "# Cover letter style > ## Form-filling time").
export const QUESTIONS_HEADING = '❓ Questions to answer';
const bare = text => String(text || '').replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
async function addLines(page, lines) {
  const heading = (await page.blocks()).find(block => block.type.startsWith('heading') && bare(block.text) === bare(QUESTIONS_HEADING));
  await page.insertAfter(heading?.id || await page.appendHeading(QUESTIONS_HEADING), lines);
}
// A question worded another way is the same one when it has the same topic as a line already on the page (the AI's judgment, kept per question: lib/question-verdicts.js).
const topicsOf = (storage, labels) => new Set(labels.map(each => verdicts.cached(storage)[key(each)]?.topic).filter(Boolean));
async function collectNew(storage, run, company, fetcher, reusable, found) {
  // A contact or file field by the shared label meanings too (any language: "Nome", "Currículo"), not only these words.
  const aliases = await sharedMeanings.lookup(storage).catch(() => []);
  const byMeaning = label => !!aliasKey(unmarked(label), aliases) || !!fileKind(unmarked(label), aliases);
  const wanted = (run.trace || []).filter(field => field.required && field.reason === NO_ANSWER && key(field.label) && (asksQuestion(field.label) || !CONTACT.test(unmarked(field.label)))
    && !unanswerable(field.label) && !looksLikeFieldId(field.label) && !byMeaning(field.label));
  if (!wanted.length) return 0;
  found.labels = wanted.map(field => unmarked(field.label));
  const page = answersPage(storage, fetcher);
  const fresh = [];
  const blocks = await page.blocks();
  const known = new Set(blocks.map(block => key(label(block.text))));
  const formatOf = new Map();
  for (const field of wanted) {
    const k = key(field.label);
    if (known.has(k)) continue;
    known.add(k);
    fresh.push(unmarked(field.label));
    formatOf.set(unmarked(field.label), formatOfField(field));
  }
  const keep = reusable && fresh.length ? await reusable(fresh) : null;
  const open = topicsOf(storage, blocks.filter(block => isQuestionLine(block.text)).map(block => parseLine(block).question));
  const kept = (keep ? fresh.filter(question => keep.has(question)) : fresh).filter(question => !open.has(verdicts.cached(storage)[key(question)]?.topic));
  if (!kept.length) return 0;
  // "Seen twice": what you typed for this question (or its earlier wording) on a form is kept with it (🧠 Form knowledge, lib/learned.js).
  const typed = keep?.from ? await knowledge.notes(storage, fetcher).catch(() => []) : [];
  const typedFor = question => typed.find(note => note.value && [question, ...(keep.from.get(question) || [])].some(each => key(each) === key(note.field)))?.value || '';
  found.remembered = kept.filter(question => typedFor(question));
  await addLines(page, kept.map(question => {
    const line = questionLine(question, company, formatOf.get(question)), value = typedFor(question);
    return value ? answeredLine(line, value) : line;
  }));
  return kept.length;
}

// "Only this job" (the Undo of a question kept on its 2nd employer): its lines leave the answers page. -> how many went.
export async function forget(storage, question, fetcher) {
  const page = answersPage(storage, fetcher);
  const doomed = (await page.blocks()).filter(block => key(label(block.text)) === key(question));
  for (const block of doomed.reverse()) await page.remove(block);   // last first: this Mac's ids are line numbers
  return doomed.length;
}

// answer '' = skip: the line is removed (not a question to keep an answer for); in a table the row stays and its
// answer becomes "— (leave blank)", so the table keeps the question and forms leave that field empty.
export const SKIPPED = '— (leave blank)';
// mark: the kind the answer was given with ({kind, options, list}); a question with no mark yet keeps it, so every later screen draws the same control.
// ai: the inbox (lib/answer-home.js): a fact of Your details goes to its section and the open question leaves this page once that line reads back.
export async function answer(storage, questionKey, value, fetcher, mark = null, {ai = {}} = {}) {
  const page = answersPage(storage, fetcher);
  const open = openRows(await page.outline()).find(({row}) => row.id === questionKey);
  const block = open ? null : (await page.blocks()).find(b => b.id === questionKey);
  if (!open && (!block || !block.text.includes('❓'))) return {ok: false, error: 'Already answered'};
  const question = open ? unmarked(splitMark(open.cells[0]).text.replace(/❓/g, '')) : parseLine(block).question;
  const home = value ? await homeOf(question, value, ai) : '';
  if (home && await writeHome(storage, home, question, value, fetcher)) {
    await page.remove(open ? {id: open.row.id, text: open.cells[0]} : block);
    return {ok: true, home, homeName: HOME_NAMES[home]};
  }
  if (open) {
    await page.setCell(open.row, 1, (value || SKIPPED).slice(0, 1900));
    if (value && mark?.kind && !splitMark(open.cells[0]).marked) await page.setCell(open.row, 0, withMark(open.cells[0], mark));
    return {ok: true};
  }
  const answered = answeredLine(block.text, value);
  if (value) await page.setText(block, mark?.kind && !splitMark(answered).marked ? withMark(answered, mark) : answered);
  else await page.remove(block);
  return {ok: true};
}

// One question asked in several wordings is one item (renderer/question-filter.js .also): the first key's answer decides the result, the others get the same answer
// and an error on one of them never undoes the first. -> the first key's result.
export async function answerAll(storage, keys, value, fetcher, mark = null, options = {}) {
  const [first, ...others] = keys;
  const result = await answer(storage, first, value, fetcher, mark, options);
  if (result.ok) for (const each of others) await answer(storage, each, value, fetcher, mark, options).catch(() => {});
  return result;
}

// The standard answers page as the app's Standard answers tab shows it: one group per heading, each with its
// questions (table rows [Question | Answer]), its guidance lines (a list under a heading, e.g. "Cover letter
// style", shown as one item) and its ❓ lines (open: an answer is still needed). Read-only; edits happen in Notion.
export async function standardAnswers(storage, fetcher) {
  const page = answersPage(storage, fetcher);
  const groups = [];
  let group = null;
  const current = () => group || (group = {category: 'General', items: [], notes: []}, groups.push(group), group);
  for (const block of await page.outline()) {
    const text = (block.text || '').trim();
    if (block.type.startsWith('heading_')) {
      group = {category: text.replace(/\s*\(.*\)\s*$/, ''), items: [], notes: []};
      groups.push(group);
    } else if (block.type === 'table') {
      current().table = true;
      for (const row of block.rows.slice(block.header ? 1 : 0)) {
        const [cell = '', answer = ''] = row.cells, question = splitMark(cell).text;
        const open = answer.trim().startsWith('❓');
        if (question.trim() && !(open && unanswerable(question))) current().items.push({question: question.trim(), answer: answer.trim(), open});
      }
    } else if (text && isQuestionLine(text)) {
      const {question, company} = parseLine({id: block.id, text});
      if (!unanswerable(question)) current().items.push({question, answer: company ? `Asked by ${company}` : '', open: true});
    } else if (text && group && /list_item|paragraph|quote|callout/.test(block.type)) {
      group.notes.push(splitMark(text).text.trim());
    }
  }
  // A section's guidance lines (no table there) become one item, first; a table section's lines are just its intro.
  for (const each of groups) {
    if (!each.table && each.notes.length) each.items.unshift({question: each.category, answer: each.notes.join('\n'), guidance: true});
  }
  return groups.filter(each => each.items.length).map(({category, items}) => ({category, items}));
}

// A fact Claude asked about in a session ("❓ Bachelor's degree result … Suggested: 8.5/10"), confirmed with one tick:
// it answers that open ❓ line or table row when the page has one, rewrites the line that already gives this
// question an answer, or adds "Question: answer" at the end, so the next kit and fill know it.
// A fact of Your details goes to its section instead (lib/answer-home.js), and this page's old line for it goes once that line reads back.
export async function remember(storage, question, value, fetcher, {ai = {}} = {}) {
  const text = unmarked(question), answerText = String(value || '').trim();
  if (!text || !answerText) return {ok: false, error: 'Write an answer first'};
  const page = answersPage(storage, fetcher), wanted = key(text);
  const open = (await list(storage, fetcher)).find(q => key(q.question) === wanted);
  if (open) return answer(storage, open.key, answerText, fetcher, null, {ai});
  const line = (await page.blocks()).find(block => /list_item|paragraph/.test(block.type) && key(label(block.text)) === wanted);
  const home = await homeOf(text, answerText, ai);
  if (home && await writeHome(storage, home, text, answerText, fetcher)) {
    if (line) await page.remove(line);
    return {ok: true, home, homeName: HOME_NAMES[home]};
  }
  const written = `${text.replace(/[\s:]+$/, '')}: ${answerText}`;   // a question that ends in its own colon gets one, not two
  if (line) await page.setText(line, written);
  else await page.append([written]);
  return {ok: true};
}
