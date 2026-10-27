// Endpoints for the Jobadabra Chrome extension (extension/ in the repo).
//
//   GET  /extension/kit?url=<job page>  the job's Applications row and its drafted kit, read from Notion
//   POST /extension/answer {url, fields, page_text}
//                                       one Claude call answers every field of the live form from the
//                                       Profile, Application Answers and the kit; checks eligibility
//   POST /extension/applied {url}       mark the job Applied (the daily workflow's apply mode, by URL)
//
// Every call needs `Authorization: Bearer <EXTENSION_TOKEN>` (a Worker secret). Responses allow any
// origin, so the extension needs no host permission for the Worker; the token is the access control.

import { anthropicClient, priceOf } from './ai.js';
import { cleanFields } from './extension-log.js';
import { askAgainForGaps, unanswered } from './answer-missing.js';
import { withholdOwner } from './owner-guard.js';
import { BILLED, billedTo, learnings, runBlocks, runData, runRecord } from './extension-run-record.js';
export { BILLED, billedTo, learnings, runData, runRecord };
import { cvFactsBlock, CV_FACTS_RULE } from './cv-facts.js';
import { FACT_KEYS, FACT_RULE, floorBoxGuess, floorInventedFigure, floorLinkKind, floorUngrounded, typeGuess } from './answer-facts.js';
import { applyPay } from './pay-convert.js';
import { WRITTEN_RULE, reviewAnswer, draftWritten, writtenKinds } from './written-answer.js';
import { ANSWER_EXAMPLES } from './answer-examples.js';
import { DECLARATION_RULE, LEGAL_CHOICE_RULE, legalChoice } from './answer-declarations.js';
import { JOB_ANSWERS_SECTION, asKitAnswers, jobAnswersOf } from './job-answers.js';

const KIT_HEADING = '📝 Application kit';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
// USD per million tokens, for the cost shown to the user and logged (claude-sonnet-5-5).
const PRICE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

function sameSecret(given, expected) {
  if (!expected || typeof given !== 'string' || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function notion(env, path, method = 'GET', body) {
  if (env.notionCall) return env.notionCall(path, method, body);  // the desktop app: its paced, retrying Notion client
  return fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Notion ${path} failed: ${response.status}`);
    return response.json();
  });
}

const plain = (rich) => (rich || []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');

// The part of a job URL that survives tracking parameters and the board's alternate link forms:
// Greenhouse's numeric job id, or Lever's and Ashby's posting UUID. Null for anything else.
export function jobKey(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const greenhouse = /greenhouse\.io$/.test(parsed.hostname) &&
    (/\/jobs\/(\d+)/.exec(parsed.pathname)?.[1] || parsed.searchParams.get('gh_jid') || parsed.searchParams.get('token'));
  if (greenhouse) return greenhouse;
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(parsed.pathname)?.[0] || null;
}

// The desktop app with the data on its Mac (desktop/lib/server-env.js) hands a store instead of Notion: env.store {findJob(url) -> job
// summary with its id, kit(id) -> kit JSON, logRun(run) -> {ok}}. The Cloudflare worker is Notion only (Always on needs Notion, spec D5).
// One answer per route either way: test/extension-store.test.js feeds each route from both.
async function findRow(env, url) {
  if (!env.NOTION_TOKEN || !env.NOTION_APPLICATIONS_DB) return null; // desktop app without Notion
  const query = (filter) => notion(env, `databases/${env.NOTION_APPLICATIONS_DB}/query`, 'POST', { filter, page_size: 5 });
  const exact = await query({ property: 'Job URL', url: { equals: url } });
  if (exact.results.length) return exact.results[0];
  const key = jobKey(url);
  if (!key) return null;
  const loose = await query({ property: 'Job URL', url: { contains: key } });
  return loose.results[0] || null;
}

async function children(env, id) {
  const blocks = [];
  let cursor;
  do {
    const page = await notion(env, `blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    blocks.push(...page.results);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return blocks;
}

// The kit JSON sits in a code block inside the "📝 Application kit" toggle heading (src/ai/kit.py).
async function readKit(env, pageId) {
  const heading = (await children(env, pageId)).find((b) => plain(b[b.type]?.rich_text).startsWith(KIT_HEADING));
  if (!heading) return null;
  const code = (await children(env, heading.id)).find((b) => b.type === 'code');
  if (!code) return null;
  try { return JSON.parse(plain(code.code.rich_text)); } catch { return null; }
}

// The answers given for this job only (the section named JOB_ANSWERS_SECTION on its page): [{question, answer}], [] when it has none.
async function readJobAnswers(env, pageId) {
  const heading = (await children(env, pageId)).find((b) => plain(b[b.type]?.rich_text).startsWith(JOB_ANSWERS_SECTION));
  return heading ? jobAnswersOf(await pageText(env, heading.id)) : [];
}

// Readable text of a Notion page (paragraphs, headings, lists, toggles, tables), two levels deep.
export async function pageText(env, pageId, depth = 0) {
  const lines = [];
  for (const block of await children(env, pageId)) {
    const body = block[block.type] || {};
    if (block.type === 'table_row') lines.push(body.cells.map(plain).join(' | '));
    else if (body.rich_text) lines.push(plain(body.rich_text));
    if (block.has_children && depth < 2 && !['child_page', 'child_database'].includes(block.type)) {
      lines.push(await pageText(env, block.id, depth + 1));
    }
  }
  return lines.filter(Boolean).join('\n');
}

// Which Anthropic key pays for this call. Today the owner's; later a customer's own key
// ("bring your own key"), stored encrypted in Cloudflare KV, looked up here.
export function anthropicKey(env) {
  return env.ANTHROPIC_API_KEY;
}

const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['eligible', 'eligibility_note', 'answers', 'pay_asks'],
  properties: {
    eligible: { type: 'boolean' },
    eligibility_note: { type: 'string' },
    // A salary question asked in another currency or period than the saved target: what the target states and what the form asks; the code converts (pay-convert.js). Empty when none.
    pay_asks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'amount', 'currency', 'per', 'asked_currency', 'asked_per', 'basis_clear'],
        properties: {
          field: { type: 'string' }, amount: { type: 'number' }, currency: { type: 'string' }, per: { type: 'string', enum: ['year', 'month', ''] },
          asked_currency: { type: 'string' }, asked_per: { type: 'string', enum: ['year', 'month', ''] }, basis_clear: { type: 'boolean' },
        },
      },
    },
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'value', 'confidence', 'note', 'category', 'use', 'fact'],
        properties: {
          field: { type: 'string' },
          value: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          note: { type: 'string' },
          category: { type: 'string', enum: ['knockout', 'legal', 'demographic', 'contact', 'preference', 'normal', 'written'] },
          use: { type: 'string', enum: ['fill', 'propose'] },
          fact: { type: 'string', enum: FACT_KEYS },
        },
      },
    },
  },
};

export const ANSWER_SCHEMA_FOR_TESTS = ANSWER_SCHEMA;   // worker/test/answer-facts.test.js

const INSTRUCTIONS = `You fill in a job application form for the applicant described in <profile> and <standard_answers>.
Use only the applicant details given here; never a name, e-mail address, phone number, country, city, street address or other location from any other context (such as an account you are signed in with): when a detail is not given, leave it empty.
The applicant reviews every answer and clicks Submit themselves.

For each form field you are given its id, label, type, whether it is required, and its options if it has any. Return one answer per field you can answer:
- text / textarea: the text to type. Write open questions in the applicant's own voice, following the cover-letter style in <standard_answers>. Use the drafted kit answers when one fits the question.
- select, radio: exactly one of the listed options, copied character for character.
- a field with multiple: true (a menu that takes several choices, e.g. the languages spoken): every choice that applies, each as the menu would write it, joined by " && " (never one choice only when several apply).
- combobox: its options are often not listed (the menu is closed); give the option wording the form most likely uses ("Yes", "No", a country or city name). When options are listed, copy one exactly.
- checkbox: "checked" or "unchecked".
${FACT_RULE}
${DECLARATION_RULE}
${LEGAL_CHOICE_RULE}
Base a proposal on what is stated (their country, their CV, that they chose to apply to this job) and on what the posting expects (its hours, place, duties). Leave a field out (no answer) when nothing given points to an answer: never invent employers, dates, numbers, links, tools, projects, skills, experience or personal details: an experience or skill claim that <profile>, <standard_answers> and the CV facts do not state is not typed (use: "propose"), it is a suggestion the applicant checks. A legal question (a consent, terms, a certification or attestation, an acknowledgement) is never answered: return it with value "" and category "legal", so the applicant sees it is theirs to decide; never propose an answer to a demographic question or to a fact only the applicant can know (a criminal record, a registration with an office, their health). Voluntary demographic questions (gender, ethnicity, veteran, disability) are answered only from <standard_answers>; otherwise choose the "decline to answer" option if there is one. A demographic question with no answer in <standard_answers> and no decline option (a salutation Mr/Ms, Herr/Frau, a gender) is returned with value "" and category "demographic": never guess it from the applicant's name.
category, in whatever language the form is: knockout = a question the employer can reject on by itself (work authorisation, visa or sponsorship, location, relocation, on-site days, a required licence or language); legal = a consent, terms, privacy notice, certification or acknowledgement; demographic = gender, ethnicity, disability, veteran or similar voluntary questions; contact = name, email, phone, address; preference = whether and how the applicant is kept informed (notifications by SMS or email, job alerts, a newsletter, a talent pool): a choice, not a legal consent, so give it your most plausible answer with use: "propose"; ${WRITTEN_RULE}; normal = anything else.
${ANSWER_EXAMPLES}
confidence: high when the answer is stated in the profile or standard answers, medium when you inferred it, low when the applicant should check it. note: a few words on why, for medium and low.

Eligibility: set eligible to false only when the posting clearly rules the applicant out (a work location, residence or authorization the profile says they can't meet, or a required language they don't speak), and say why in eligibility_note. Otherwise eligible is true and eligibility_note is empty.`;

// test: the user is testing the filling (Settings → Test mode): invent plausible values for anything unknown.
export const TEST_MODE = 'TEST MODE: this is a test of the form filling, not a real application. Answer EVERY field; where the profile or standard answers do not say, invent a plausible dummy value (for select fields pick the most plausible listed option). Never leave a field empty, set confidence to low and use to "fill" for invented values, and set eligible to true.';

// What every answer to the person's form questions rests on (the job and its kit, Profile, standard answers, form knowledge, search settings, CV facts): the fill's ask and the review of one answer read the same.
export async function answerContext(env, url) {
  const row = await findRow(env, url).catch(() => null);
  // With the data on this Mac (env.store, the default) the job and its drafted kit come from the store: before 12 Oct 2026 the ask got neither.
  const stored = !row && env.store ? await env.store.findJob(url).catch(() => null) : null;
  const drafted = row ? await readKit(env, row.id).catch(() => null) : stored ? await env.store.kit(stored.id).catch(() => null) : null;
  // What the person answered for THIS job only (never another's, never a standard answer): the job's own drafted answers, ahead of the kit's.
  const mine = row ? await readJobAnswers(env, row.id).catch(() => []) : stored && env.store.jobAnswers ? await env.store.jobAnswers(stored.id).catch(() => []) : [];
  const kit = asKitAnswers(drafted, mine);
  const found = row ? summary(row) : stored ? (({ id, ...rest }) => rest)(stored) : null;
  // The desktop app passes the local Profile and standard answers; the Worker reads them from Notion.
  const [profile, standard] = await Promise.all([
    env.PROFILE_TEXT ?? pageText(env, env.NOTION_PROFILE_PAGE_ID),
    env.ANSWERS_TEXT ?? (env.NOTION_ANSWERS_PAGE_ID ? pageText(env, env.NOTION_ANSWERS_PAGE_ID) : ''),
  ]).then(async ([p, a]) => {
    // What earlier fills learned about forms (🧠 Form knowledge), as extra standard answers.
    // The desktop env's getters are promises: awaited here (an unawaited one printed "[object Promise]" into every prompt, 8-11 Oct 2026).
    const known = (await env.KNOWLEDGE_TEXT) ?? (env.NOTION_KNOWLEDGE_PAGE ? await pageText(env, env.NOTION_KNOWLEDGE_PAGE).catch(() => '') : '');
    return [p, known ? `${a}\n\n# Learned from earlier forms\n${known}` : a];
  });
  // The strategy's search settings (roles, places, what the user aims for): a proposal should serve that, not just the CV.
  const search = String((await Promise.resolve(env.SEARCH_TEXT).catch(() => '')) || '').slice(0, 4000);
  const cvFacts = cvFactsBlock(await Promise.resolve(env.CV_FACTS_TEXT).catch(() => ''));   // from the imported CV, never imported by a fill
  return { found, kit, profile, standard, search, cvFacts };
}

export async function answerForm(env, { url, fields, page_text, test = false }, client = null) {
  const startedAt = Date.now();
  const { found, kit, profile, standard, search, cvFacts } = await answerContext(env, url);
  const job = found || { title: '', company: '', url };
  const anthropic = client || anthropicClient(anthropicKey(env));
  const ask = (list, note = '') => anthropic.messages.create({
    model: env.JOB_PILOTTO_KIT_MODEL || DEFAULT_MODEL,
    max_tokens: 16000,
    // The profile and standard answers are the same for every form: cached, so a multi-page form
    // or the next application within five minutes pays a tenth for them.
    system: [
      { type: 'text', text: (test ? `${INSTRUCTIONS}\n\n${TEST_MODE}` : INSTRUCTIONS) + (cvFacts ? `\n${CV_FACTS_RULE}` : '') },
      { type: 'text', text: `<profile>\n${profile}\n</profile>\n<standard_answers>\n${standard}\n</standard_answers>${search ? `\n<search_preferences>\n${search}\n</search_preferences>` : ''}${cvFacts}`,
        cache_control: { type: 'ephemeral' } },
    ],
    messages: [{
      role: 'user',
      content: [
        `<job>\n${job.title} at ${job.company}\n${url}\n${String(page_text || '').slice(0, 12000)}\n</job>`,
        kit ? `<drafted_kit>\n${JSON.stringify({ answers: kit.answers, cover_letter: kit.cover_letter })}\n</drafted_kit>` : '',
        `<form_fields>\n${JSON.stringify(list)}\n</form_fields>`,
        note,
      ].filter(Boolean).join('\n\n'),
    }],
    output_config: { format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
  }, {headers: {'x-jp-action': 'answer'}});
  const response = await ask(fields);
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to answer this form');
  const text = response.content.find((block) => block.type === 'text')?.text;
  const result = JSON.parse(text);
  // A field the AI left out of its answer is asked once more (11 Oct 2026: a required salutation radio came back unmentioned on 4 Umantis rows); still missing: marked, never silent.
  const { retried, stillMissing } = await askAgainForGaps(fields, result, ask);
  const usage = response.usage || {};
  // Answered on the user's Claude plan (Claude Code): no per-token cost.
  const price = priceOf(usage, PRICE);   // an OpenAI call (the app's client) at its own model's price
  const usd = usage.billing === 'subscription' ? 0 : ((usage.input_tokens || 0) * price.input + (usage.output_tokens || 0) * price.output
    + (usage.cache_read_input_tokens || 0) * (price.cacheRead ?? price.cachedInput ?? 0) + (usage.cache_creation_input_tokens || 0) * (price.cacheWrite ?? 0)) / 1e6;
  const known = new Set(fields.map((f) => f.field));
  // A proposal is never for a legal or demographic question, whatever the AI said (a hard floor beside its own rule). A knockout question
  // (residence, hours, availability) gets its most plausible answer, shown as "check it" and never typed: the owner confirms each (9 Oct 2026). Proposals are shown in the app, never typed (extension/flow.js).
  // Any other guess is typed and marked guess: true (owner, 14 Oct 2026); a guessed contact detail, link or preference stays a proposal (answer-facts.js typeGuess).
  // A typed name, e-mail, phone, address or home place must be in what this ask was given, never the signed-in account's (answer-facts.js floorUngrounded).
  const given = [profile, standard, search, cvFacts, kit ? JSON.stringify(kit) : ''].join('\n');
  const labelOf = Object.fromEntries(fields.map((f) => [f.field, f.label || '']));
  const paid = await applyPay(Array.isArray(result.answers) ? result.answers : [], result.pay_asks, fields, { fetchFn: env.fetchFn || globalThis.fetch });   // a salary in another currency or period, converted by the code
  const typeOf = Object.fromEntries(fields.map((f) => [f.field, f.type]));
  const optionsOf = Object.fromEntries(fields.map((f) => [f.field, Array.isArray(f.options) ? f.options : []]));
  const choiceChecked = paid.map((a) => legalChoice(a, typeOf[a.field]));   // a legal-looking choice is asked once, not held (answer-declarations.js)
  const floorsApplied = choiceChecked.map((a) => floorInventedFigure(floorBoxGuess(floorLinkKind(floorUngrounded(test ? a : typeGuess(a), given, { test, options: optionsOf[a.field] }), labelOf[a.field] || '', given, { test }), test ? '' : typeOf[a.field]), labelOf[a.field] || '', given, typeOf[a.field], { test }));
  // Test harness only (owner-guard.js): an answer that is the owner's own value is never typed, whatever its kind or category; the field stays empty.
  const { answers: all, withheld } = withholdOwner(floorsApplied, labelOf, env.ownerValues);
  await env.onAnswerCall?.({ url, fields, answers: all, withheld });   // the desktop app keeps the asked fields and answer kinds for the e2e evidence (no values); a no-op elsewhere
  // A legal question is never answered, whatever use the AI gave (16 Oct 2026: a legal answer with use "fill" passed this floor and only the page's category mark held it); a proposal on a demographic one never is either.
  const floored = (a) => a.category === 'legal' || (a.use === 'propose' && a.category === 'demographic');
  // A written question (the person's own words) is DRAFTED from their facts and typed marked draft (owner, 16 Oct 2026, reversing 11 Oct); with no text it comes back as an empty kind.
  // low confidence = an outline to complete, never a finished answer. Never a proposal: the box gets it. Its "• Add: ..." reminders are never typed (written-answer.js draftWritten).
  const raw = all.filter((a) => !floored(a)).map((a) => (a.category === 'written' && a.value !== '' ? draftWritten(a) : a)).filter((a) => a.category !== 'written' || a.value !== '' || a.remind);
  // What this call did, in counts and field ids (never an answer or the profile's text): with 0 answers it tells "nothing to go on"
  // (an empty profile) from "answered, but under other ids" from "answered nothing" (8 Oct 2026: Coop, 11 fields sent, 0 back, no trace).
  await env.onAnswer?.({ fields: fields.length, returned: raw.length, kept: raw.filter((a) => known.has(a.field) && a.value !== '').length,
    unknownIds: raw.filter((a) => !known.has(a.field)).map((a) => String(a.field).slice(0, 60)).slice(0, 10),
    empty: raw.filter((a) => known.has(a.field) && a.value === '').length,
    // Which kind each empty answer got, by field id (a legal one is kept as a kind; any other empty one is dropped): 11 Oct 2026, an attestation came back
    // empty and the log could not say whether as legal or normal. Ids and category words only, never a value.
    emptyKinds: all.filter((a) => known.has(a.field) && a.value === '').map((a) => `${String(a.field).slice(0, 60)}:${String(a.category || '').slice(0, 12)}`).slice(0, 10),
    profileChars: String(profile || '').length,
    answersChars: String(standard || '').length, kit: !!kit, stop: response.stop_reason || '', ms: Date.now() - startedAt,
    proposed: raw.filter((a) => known.has(a.field) && a.value !== '' && a.use === 'propose').length,
    guessed: raw.filter((a) => known.has(a.field) && a.guess).length,   // guesses typed (owner, 14 Oct 2026): the log tells them from facts
    // Who answered (9 Oct 2026: "The AI answered" could not say whether Codex or Claude did): the adapter's engine, the provider and billing
    // of its usage, the model that replied. The raw Anthropic SDK (the Cloudflare deploy) has no .engine: 'api'.
    engine: anthropic.engine || 'api', provider: response.usage?.provider || 'anthropic', billing: response.usage?.billing || 'api',
    model: String(response.model || '').slice(0, 40),
    // A proposal the floor took out, by category (9 Oct 2026: a Coop SMS opt-in got no proposal, and the log could not say whether the AI left it or the floor did).
    floored: all.filter(floored).map((a) => a.category),
    ...(withheld.length ? { withheld } : {}),   // the owner's own values the guard kept out (field + kind, never the value; test harness only)
    retried, stillMissing: stillMissing.slice(0, 10).map((f) => String(f).slice(0, 60)),
    categories: Object.fromEntries(['knockout', 'legal', 'demographic', 'contact', 'preference', 'normal', 'written'].map((c) => [c, all.filter((a) => a.category === c).length]).filter(([, n]) => n)) });
  return {
    job: found,
    eligible: result.eligible, eligibility_note: result.eligibility_note,
    // A legal question comes back as a kind only (use "kind", no value): the extension marks it the person's choice in any wording, never "no answer"
    // (11 Oct 2026, Datadog: "I certify ..." was left out by the AI and missed by the English floor). A floored legal proposal says the same.
    answers: [...raw.filter((a) => known.has(a.field) && a.value !== ''),
      ...[...new Set(all.filter((a) => a.category === 'legal' && known.has(a.field) && !(a.value !== '' && !floored(a))).map((a) => a.field))]
        .map((field) => ({ field, value: '', category: 'legal', use: 'kind' })),
      // An open question in the applicant's own words that nothing given answers (12 Oct 2026, Ashby "why join us?"): the same, as "written" (with its reminders, if any).
      ...writtenKinds(all, raw, known),
      // A salutation, gender or other personal-choice question with nothing in the profile: the person's own choice, never guessed (owner, 11 Oct 2026): the same.
      ...[...new Set(all.filter((a) => a.category === 'demographic' && a.value === '' && known.has(a.field)).map((a) => a.field))]
        .map((field) => ({ field, value: '', category: 'demographic', use: 'kind' })),
      // A preference question the AI could not propose anything for (a preferred messenger and its handle, nothing saved; Greenhouse board form, 15 Oct 2026): the person's own choice,
      // said as a kind, never "no answer in the kit" (a miss on every form that asks one).
      ...[...new Set(all.filter((a) => a.category === 'preference' && a.value === '' && known.has(a.field)).map((a) => a.field))]
        .map((field) => ({ field, value: '', category: 'preference', use: 'kind' })),
      ...stillMissing.map(unanswered)],
    cover_letter: kit?.cover_letter || '',
    usd: Math.round(usd * 10000) / 10000,
    billed_to: billedTo(usage),   // who paid for the answer: the fill row's "Billed to" (the extension passes it back with the run)
  };
}

export async function logRun(env, run) {
  const row = await findRow(env, run.url).catch(() => null);
  const job = row ? summary(row) : { title: '', company: '' };
  const record = runRecord(run, job), f = record.fields;
  const host = (() => { try { return new URL(run.url).hostname; } catch { return ''; } })();
  const text = (value) => ({ rich_text: [{ text: { content: String(value).slice(0, 1900) } }] });
  const properties = {
    Run: { title: [{ text: { content: `${job.company || host} · ${job.title || 'form'} · Extension` } }] },
    Agent: { select: { name: f.agent } },
    ATS: { select: { name: record.ats } },
    Status: { select: { name: f.status } },
    Started: { date: { start: f.started } }, Ended: { date: { start: f.ended } },
    Minutes: { number: f.minutes }, Fields: { number: f.field_count },
    'Unfilled required': { number: f.unfilled_required },
    'Tokens (total)': { number: f.tokens_total },
    'Job URL': { url: record.url },
    'Billed to': { select: { name: f.billed_to } },
    Reason: text(f.reason),
    Learnings: text(record.learnings),
    ...(row ? { Job: { relation: [{ id: row.id }] } } : {}),
  };
  const page = await notion(env, 'pages', 'POST', { parent: { database_id: env.NOTION_AGENT_RUNS_DB }, properties,
    children: runBlocks(run, f.minutes) });
  return { ok: true, url: page.url };
}

export function summary(row) {
  const props = row.properties;
  return {
    title: plain(props.Job?.title), company: plain(props.Company?.rich_text),
    stage: props.Stage?.select?.name || '', url: props['Job URL']?.url || '', notion_url: row.url,
  };
}

// Only what filling a form needs: never the job analysis or the JSON's other internals.
function kitForForm(kit) {
  return {
    answers: (kit.answers || []).filter((a) => a.field).map(({ field, question, answer, needs_review, category }) =>
      ({ field, question, answer, needs_review: !!needs_review, category: category || '' })),
    cover_letter: kit.cover_letter || '',
    check_before_sending: kit.check_before_sending || [],
  };
}

export async function handleExtension(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!sameSecret(token, env.EXTENSION_TOKEN)) return json({ error: 'unauthorized' }, 401);
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.pathname === '/extension/kit') {
      const job = url.searchParams.get('url');
      if (!job) return json({ error: 'url is required' }, 400);
      if (env.store) {
        const found = await env.store.findJob(job);
        if (!found && env.localJob) {
          const local = await env.localJob(job);
          if (local) return json({ job: local, kit: null });
        }
        if (!found) return json({ error: 'not tracked', hint: 'Prepare a kit for this job first (📝 Prepare in Telegram).' }, 404);
        const { id, ...summaryOnly } = found;
        const kit = await env.store.kit(id);
        return json({ job: summaryOnly, kit: kit ? kitForForm(kit) : null });
      }
      const row = await findRow(env, job);
      if (!row && env.localJob) {
        const local = await env.localJob(job);
        if (local) return json({ job: local, kit: null });
      }
      if (!row) return json({ error: 'not tracked', hint: 'Prepare a kit for this job first (📝 Prepare in Telegram).' }, 404);
      const kit = await readKit(env, row.id);
      return json({ job: summary(row), kit: kit ? kitForForm(kit) : null });
    }
    // "Review my answer" (extension/panel-written.js): one AI read of the person's text, or the draft, for one open question. Never writes into the form.
    if (request.method === 'POST' && url.pathname === '/extension/review-answer') {
      const body = await request.json().catch(() => ({}));
      if (!body.url || !String(body.question || '').trim() || !String(body.text || '').trim()) return json({ error: 'url, question and text are required' }, 400);
      const aiClient = env.aiClient || null;
      if (!aiClient && !anthropicKey(env)) return json({ error: 'AI is not set up on this Worker (ANTHROPIC_API_KEY)' }, 503);
      try {
        const ctx = await answerContext(env, body.url);
        const out = await reviewAnswer(ctx, { question: body.question, text: body.text, url: body.url }, aiClient || anthropicClient(anthropicKey(env)),
          { model: env.JOB_PILOTTO_KIT_MODEL || DEFAULT_MODEL, price: PRICE, billedTo, cvFactsRule: ctx.cvFacts ? `\n${CV_FACTS_RULE}` : '' });
        await env.onReviewAnswer?.({ chars: String(body.text).length, usd: out.usd, billed_to: out.billed_to, missing: out.missing.length });   // counts only, never the text
        return json(out);
      } catch (error) {
        return json({ error: `Review failed: ${error.message}` }, error.aiLimit ? 402 : 502);
      }
    }
    if (request.method === 'POST' && url.pathname === '/extension/answer') {
      const body = await request.json().catch(() => ({}));
      if (!body.url || !Array.isArray(body.fields) || !body.fields.length) return json({ error: 'url and fields are required' }, 400);
      const all = body.fields.slice(0, 80).map((f) => ({
        field: String(f.field || '').slice(0, 200), label: String(f.label || '').slice(0, 300),
        type: String(f.type || '').slice(0, 30), required: !!f.required, ...(f.multiple ? { multiple: true } : {}),
        ...(Array.isArray(f.options) && f.options.length ? { options: f.options.slice(0, 60).map((o) => String(o).slice(0, 150)) } : {}),
      }));
      // A form the night filled (the desktop app's Ready to send, Open in Chrome): its answers come back as the night gave them, no AI; only a question it did not see is asked.
      const night = env.nightAnswers?.(body.url, all) || null;
      const fields = night ? night.rest : all;
      if (night) await env.onNightAnswers?.({ fields: all.length, fromNight: night.answers.length, asked: fields.length });
      if (night && !fields.length) return json({ answers: night.answers, eligible: true, usd: 0, night: true });
      // The desktop app can answer with the user's own Claude Code (env.aiClient); the Worker needs its key.
      const aiClient = env.aiClient || null;
      if (!aiClient && !anthropicKey(env)) return json({ error: 'AI is not set up on this Worker (ANTHROPIC_API_KEY)' }, 503);
      try {
        const done = await answerForm(env, { url: body.url, fields, page_text: body.page_text, test: !!body.test }, aiClient);
        return json(night ? { ...done, answers: [...night.answers, ...(done.answers || [])], night: true } : done);
      } catch (error) {
        // The app's injected client throws the contract's AiLimit (any engine: a plan's or a key's limit); the Worker's own SDK says it in words.
        const limit = !!error.aiLimit || /credit|spend|limit|billing/i.test(error.message);
        const said = error.aiLimit ? `${error.message} Fill without AI for now.` : 'The Anthropic spend limit is reached; fill without AI for now.';
        return json({ error: limit ? said : `AI answer failed: ${error.message}` }, limit ? 402 : 502);
      }
    }
    if (request.method === 'POST' && url.pathname === '/extension/run') {
      const run = await request.json().catch(() => ({}));
      // An update of a run already logged (extension/ladder/record-update.js: a box emptied after the record was sent and typed again): that run's row is corrected through the store;
      // never a second row, so with no store to place it (the Cloudflare worker's Notion pages) it is skipped. Not collected again: its questions were counted with the first record.
      if (run.update !== undefined) return json(env.store?.updateRun && /^[\w-]{1,64}$/.test(String(run.update)) && typeof run.update === 'string'
        ? await env.store.updateRun(run).catch((error) => ({ ok: false, error: error.message })) : { ok: false, skipped: true });
      await env.onRun?.(run);  // desktop app: collects the questions nothing could answer
      if (run.url && env.store) return json(await env.store.logRun(run).catch((error) => ({ ok: false, error: error.message })));
      if (!run.url || !env.NOTION_TOKEN || !env.NOTION_AGENT_RUNS_DB) return json({ ok: false, skipped: true });
      return json(await logRun(env, run).catch((error) => ({ ok: false, error: error.message })));
    }
    if (request.method === 'POST' && url.pathname === '/extension/log') {
      // The extension's own decisions, pushed as they happen (and re-pushed after a crashed worker). Cleaned here, at
      // the boundary: counts and ids, never a form answer or a message body (lib/log.js's rule, enforced on the way
      // in). The desktop app writes them to logs/app.log; a Cloudflare Worker prints them.
      const { entries } = await request.json().catch(() => ({}));
      const clean = (Array.isArray(entries) ? entries : []).slice(-50).map((entry) => ({
        at: typeof entry?.at === 'string' ? entry.at.slice(0, 30) : '',
        kind: String(entry?.kind || 'note').slice(0, 24),
        text: String(entry?.text || '').slice(0, 300),
        fields: cleanFields(entry?.fields),
      }));
      if (env.onLog) await env.onLog(clean);
      else console.log(`extension log: ${clean.map((entry) => `${entry.kind}: ${entry.text}`).join(' | ')}`);
      return json({ ok: true, kept: clean.length });
    }
    if (request.method === 'POST' && url.pathname === '/extension/applied') {
      const { url: job, why, evidence } = await request.json().catch(() => ({}));
      if (!job || !/^https?:\/\//.test(job)) return json({ error: 'url is required' }, 400);
      // What decided this, and on what evidence. The extension sends it (background.js checkSubmitted); it goes to
      // the app's log with markApplied, or to this Worker's log when it dispatches the run instead (1 Oct 2026: a
      // job was marked Applied while its form sat open, unsubmitted, and nothing recorded why).
      const decision = `applied ${why || 'no reason given'} (${evidence?.path || 'unknown'}${evidence?.host ? ` on ${evidence.host}` : ''}, extension ${evidence?.version || '?'})`;
      if (env.markApplied) return json(await env.markApplied(job, decision)); // desktop app: recorded locally
      console.log(`extension ${decision} -> ${job}`);
      const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.WORKFLOW_FILE}/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
          'User-Agent': 'sre-job-pilotto-bot', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { mode: 'apply', job, action: 'applied' } }),
      });
      if (response.status !== 204) return json({ error: `GitHub dispatch failed: ${response.status}` }, 502);
      return json({ ok: true, message: 'Marking it Applied; Telegram confirms in about a minute.' });
    }
    return json({ error: 'not found' }, 404);
  } catch (error) {
    return json({ error: error.message }, 502);
  }
}
