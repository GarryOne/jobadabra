// The Focus suite's data: a dummy job search written through the store the app uses (ctx.data, lib/store-call.mjs: this Mac's store or Notion,
// fictional employers only), and an independent "numbers match the source" oracle that works out, from the store's records alone, what Focus must
// show. The oracle is deliberately a second implementation of the rules written from the product's spec (src/focus.py, src/notion/funnel.py), not a
// port: if the two disagree, one is wrong. Records are the store's (src/stores/base.py field names), the same on every store (P7 step 4).
import fs from 'node:fs';
import path from 'node:path';
import {call} from './notion.mjs';

const ZONE = 'Europe/Zurich';

// ---------- dates (Focus counts days in Zurich time) ----------
export const zurichDay = date => new Intl.DateTimeFormat('en-CA', {timeZone: ZONE}).format(new Date(date));   // 2026-10-02
const shiftDay = (day, days) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export function zurichAt(day, time) {   // "2026-10-03", "10:00" -> an ISO moment with Zurich's offset on that day (DST-safe)
  const offset = new Intl.DateTimeFormat('en-GB', {timeZone: ZONE, timeZoneName: 'longOffset'}).formatToParts(new Date(`${day}T12:00:00Z`)).find(part => part.type === 'timeZoneName').value.replace('GMT', '') || '+00:00';
  return `${day}T${time}:00${offset}`;
}

export const REJECTION_SECTION = '🔎 Why it was rejected';   // desktop/renderer/job-page-view.js SECTIONS.review

// ---------- the dummy search ----------
// One application per situation a person has to act on. The comment says which Up next row (or number) each one is there to produce.
export function scenario(now = new Date()) {
  const today = zurichDay(now), ago = days => shiftDay(today, -days), tomorrow = shiftDay(today, 1);
  const midday = days => `${ago(days)}T12:00:00Z`;
  const row = (key, fields) => ({key, fields});
  const rows = [
    row('alder', {title: 'Senior Site Reliability Engineer', company: 'Alder Labs', stage: 'Kit ready', fit: 86, url: 'https://jobs.e2e.test/alder/sre', origin: 'Outbound'}),   // a kit ready to apply
    row('birch', {title: 'Platform Engineer', company: 'Birch Systems', stage: 'Kit ready', fit: 71, url: 'https://jobs.e2e.test/birch/platform', origin: 'Outbound'}),
    row('cedar', {title: 'DevOps Engineer', company: 'Cedar Cloud', stage: 'Applied', applied_on: ago(10), fit: 78, url: 'https://jobs.e2e.test/cedar/devops', origin: 'Outbound'}),  // waiting 10 days
    row('delta', {title: 'Site Reliability Engineer', company: 'Delta Grid', stage: 'Applied', applied_on: today, fit: 80, url: 'https://jobs.e2e.test/delta/sre', origin: 'Outbound'}),  // applied today
    row('ibis', {title: 'Infrastructure Engineer', company: 'Ibis Analytics', stage: 'Applied', applied_on: today, fit: 74, url: 'https://jobs.e2e.test/ibis/infra', origin: 'Outbound'}),   // applied today
    row('ember', {title: 'Senior Platform Engineer', company: 'Ember Data', stage: 'Interview scheduled', applied_on: ago(8), next_interview: zurichAt(tomorrow, '10:00'),
      fit: 83, url: 'https://jobs.e2e.test/ember/platform', origin: 'Outbound'}),                                  // a screening tomorrow: Prepare
    row('fjord', {title: 'Cloud Engineer', company: 'Fjord Networks', stage: 'Rejected', applied_on: ago(14), feedback_status: 'Asked for feedback',
      fit: 69, url: 'https://jobs.e2e.test/fjord/cloud', origin: 'Outbound'}),                                      // an interview held, feedback asked: Add feedback
    row('gale', {title: 'Site Reliability Engineer', company: 'Gale Robotics', stage: 'Rejected', applied_on: ago(12), feedback_status: 'Skipped',
      rejection: 'Hard skills', rejection_lesson: 'Seniority mismatch. The role wanted a team lead and you had not led one.',
      fit: 65, url: 'https://jobs.e2e.test/gale/sre', origin: 'Outbound',
      // the reviewed rejection's page section (src/ai/rejection.py writes it; the job panel's Review tab shows it)
      sections: {[REJECTION_SECTION]: '## What happened\n\nSeniority mismatch. The role wanted a team lead and you had not led one.\n'}}),   // a rejection: Suggestions' first entry
    row('huxley', {title: 'Staff SRE', via: 'Huxley Partners', stage: 'Recruiter lead', salary: 'CHF 160k', location: 'Zurich', reached_via: 'Email',
      url: 'https://jobs.e2e.test/huxley/staff-sre', origin: 'Inbound'}),                                                   // a recruiter waiting for an answer: Reply
    row('kestrel', {title: 'Principal Platform Engineer', via: 'Kestrel Agency', stage: 'Interviewing', url: 'https://jobs.e2e.test/kestrel/principal', origin: 'Inbound'}),   // employer unknown: Add details (Skip)
  ];
  const event = (rowKey, kind, at, note = '', extra = {}) => ({rowKey, kind, at, note, source: 'Job Pilotto app', ...extra});
  const events = [
    event('cedar', 'Applied', midday(10)), event('delta', 'Applied', now.toISOString()), event('ibis', 'Applied', now.toISOString()),
    event('ember', 'Applied', midday(8)), event('ember', 'Screening', midday(5)), event('ember', 'Interview scheduled', midday(2)),
    event('fjord', 'Applied', midday(14)), event('fjord', 'Screening', midday(9)), event('fjord', 'Rejected', midday(3)), event('fjord', 'Feedback requested', midday(2)),
    event('gale', 'Applied', midday(12)), event('gale', 'Rejected', midday(1)),
    event('huxley', 'Recruiter lead', new Date(now.getTime() - 5 * 3600e3).toISOString(), 'Are you open to a Staff SRE role in Zurich? CHF 160k, hybrid.', {source: 'Gmail', source_id: 'e2e-lead-1'}),
    event('kestrel', 'Interviewing', midday(2), 'An agency with a client under NDA. A first call took place.', {source: 'Gmail', source_id: 'e2e-lead-2'}),
  ];
  return {rows, events};
}

// Up next cards that each offer a way to finish them, one per way (5 Oct 2026: a dismissed card came back after a reload). Added to a running suite
// after its own checks, so the six-card scenario above keeps its exact order and counts. `how` is what the person clicks.
// tag: words added to every name of this scenario, unique to the run (6 Oct 2026: on a real Notion page a query still listed the previous run's archived rows for
// minutes, so an earlier "Osprey Agency" card, never skipped in this run, looked like this run's card coming back). Each action's `who` is its full name.
export function actionScenario(now = new Date(), tag = '') {
  const today = zurichDay(now), ago = days => shiftDay(today, -days), tomorrow = shiftDay(today, 1);
  const midday = days => `${ago(days)}T12:00:00Z`;
  const row = (key, fields) => ({key, fields});
  const event = (rowKey, kind, at, note = '', extra = {}) => ({rowKey, kind, at, note, source: 'Job Pilotto app', ...extra});
  const rows = [
    row('osprey', {title: 'Principal Platform Engineer', via: `Osprey Agency${tag}`, stage: 'Interviewing', url: 'https://jobs.e2e.test/osprey/principal', origin: 'Inbound'}),
    row('plover', {title: 'Staff SRE', via: `Plover Partners${tag}`, stage: 'Recruiter lead', salary: 'CHF 150k', location: 'Zurich', reached_via: 'Email', url: 'https://jobs.e2e.test/plover/staff-sre', origin: 'Inbound'}),
    row('wren', {title: 'Cloud Engineer', company: `Wren Labs${tag}`, stage: 'Rejected', applied_on: ago(14), fit: 66, url: 'https://jobs.e2e.test/wren/cloud', origin: 'Outbound'}),
    row('heron', {title: 'Data Platform Engineer', company: `Heron Data${tag}`, stage: 'Interview scheduled', applied_on: ago(8), next_interview: zurichAt(tomorrow, '10:00'), fit: 80,
      url: 'https://jobs.e2e.test/heron/data', origin: 'Outbound'}),
    row('lark', {title: 'Platform Engineer', company: `Lark Systems${tag}`, stage: 'Screening', applied_on: ago(9), fit: 77, url: 'https://jobs.e2e.test/lark/platform', origin: 'Outbound'}),
  ];
  const events = [
    event('osprey', 'Interviewing', midday(2), 'An agency with a client under NDA. A first call took place.', {source: 'Gmail', source_id: 'e2e-action-1'}),
    event('plover', 'Recruiter lead', new Date(now.getTime() - 5 * 3600e3).toISOString(), 'Are you open to a Staff SRE role in Zurich? CHF 150k, hybrid.', {source: 'Gmail', source_id: 'e2e-action-2'}),
    event('wren', 'Applied', midday(14)), event('wren', 'Screening', midday(9)), event('wren', 'Rejected', midday(3)),
    event('heron', 'Applied', midday(8)), event('heron', 'Screening', midday(5)), event('heron', 'Interview scheduled', midday(2)),
    event('lark', 'Applied', midday(9)), event('lark', 'Screening', midday(5)),
  ];
  const actions = [
    {who: `Osprey Agency${tag}`, kind: 'details', how: {button: 'Skip'}},
    {who: `Plover Partners${tag}`, kind: 'reply', how: {button: 'Done'}},
    {who: `Wren Labs${tag}`, kind: 'feedback', how: {menu: 'Skip this request'}},
    {who: `Heron Data${tag}`, kind: 'prepare', card: `Prepare.*Heron Data${tag}`, how: {menu: 'Dismiss interview', confirm: true}},   // the job then shows a Move it forward card: another card, not this one coming back
    {who: `Lark Systems${tag}`, kind: 'nudge', how: {menu: "I'm out: withdraw"}},
  ];
  return {rows, events, actions};
}

// One application with every field Focus reads, written as the app writes one (applications.create keeps every known field), and its page sections. -> the store's record.
export async function addApplication(ctx, {stage, sections = {}, ...job}) {
  const made = await ctx.data('applications', 'create', {job, stage});
  if (!made?.id) throw new Error(`the store did not create the job ${job.url}: ${JSON.stringify(made)}`);
  for (const [name, markdown] of Object.entries(sections)) await ctx.data('applications', 'set_section', {app_id: made.id, name, markdown});
  return made;
}

// Writes rows and their events into the store the app uses (no reset). -> {rowKey: the store's record}.
export async function addFocusData(ctx, data) {
  const made = {};
  for (const {key, fields} of data.rows) made[key] = await addApplication(ctx, fields);
  for (const {rowKey, kind, at, ...fields} of data.events) await ctx.data('events', 'add', {app_id: made[rowKey].id, kind, at, ...fields});
  return made;
}

// What Focus must list for that scenario, in order: [kind label on the badge, the primary button]. Written from the product spec
// (who needs an answer first, then what is soonest), not read back from the app. Up next holds only what can't wait; the rest is in Suggestions,
// after the engine's entries (Gale's rejection lesson; Analyze now, since the scenario's applications and outcomes outnumber src/suggestions.py
// ANALYZE_AFTER with no analysis yet); "1 application waiting" has no button and leaves Focus (owner, 28 Oct 2026).
export const EXPECTED_UP_NEXT = [
  {who: 'Huxley Partners', badge: 'Reply today', buttons: ['Open email', 'Done']},
  {who: 'Ember Data', badge: /^Interview /, buttons: ['Build prep kit']},
];
export const EXPECTED_SUGGESTIONS = [
  {who: 'Seniority mismatch', badge: 'Rejection', buttons: ['Review rejection']},
  {who: 'A lot happened since your last analysis', badge: 'Analyze', buttons: ['Analyze now']},
  {who: 'Kestrel Agency', badge: 'Add details', buttons: ['Add details', 'Skip']},
  {who: 'Apply to', badge: 'Next step', buttons: ['Browse jobs']},
  {who: 'Fjord Networks', badge: 'Asked for feedback', buttons: ['Add feedback']},
];


// What people really type into the Job Tracker by hand (5 Oct 2026): a stage the app has no word for, an empty title, a note of 2,000 characters, other
// scripts and emoji. The Focus suite adds them after its own checks: nothing may break, and the numbers must still be the store's.
export const HAND_EDITS = [
  {title: '', company: 'Ünïcødé Systèmes 株式会社 🚀', stage: 'On hold (my own stage)', origin: 'Outbound', url: 'https://jobs.e2e.test/hand/unknown-stage'},
  {title: `Staff Site Reliability Engineer ${'and Platform Lead '.repeat(12).trim()}`, company: 'شركة الاختبار', stage: 'Applied', applied_on: '2026-01-15', origin: 'Outbound',
    url: 'https://jobs.e2e.test/hand/long-title', notes: `${'Called the recruiter, sent the portfolio, waiting. '.repeat(40)}`.slice(0, 2000)},
];

const targetBullet = async (token, pageId) => {   // the bullet under "Daily applications target"
  const blocks = (await call(token, 'GET', `blocks/${pageId}/children?page_size=100`)).results;
  const at = blocks.findIndex(block => block.type === 'heading_2' && /daily applications target/i.test(block.heading_2.rich_text.map(part => part.plain_text).join('')));
  const bullet = blocks[at + 1];
  if (at < 0 || bullet?.type !== 'bulleted_list_item') throw new Error(`"Daily applications target" has no bullet under it in Search settings (page ${pageId}, ${blocks.length} blocks: ${blocks.slice(0, 6).map(block => block.type).join(', ')})`);
  return bullet;
};
export async function readTargetLine(token, pageId) {   // the page the app says it wrote (settings.notionIds.NOTION_SEARCH_SETTINGS_PAGE)
  return Number((await targetBullet(token, pageId)).bulleted_list_item.rich_text.map(part => part.plain_text).join(''));
}
// Remove this suite's data and, with `data`, write the scenario: every application with its sections and files, its events and the interviews go
// (a new user's data), through the store, so it works the same on this Mac's store and on Notion (where they go to the trash). Both start a run
// empty (a fresh profile; the stand-in is fresh per run), so insights (no delete in the store) and the daily target (the suite sets it through the
// app) need no reset here.
export async function resetFocusData(ctx, {data = null} = {}) {
  const pairs = new Map((await ctx.data('events', 'list', {})).map(event => [`${event.app_id}|${event.kind}`, event]));
  for (const event of pairs.values()) await ctx.data('events', 'archive', {app_id: event.app_id, kind: event.kind});
  for (const app of await ctx.data('applications', 'list', {})) await ctx.data('applications', 'delete', {app_id: app.id});
  for (const interview of await ctx.data('interviews', 'list', {})) await ctx.data('interviews', 'archive', {interview_id: interview.id});
  const left = {applications: (await ctx.data('applications', 'list', {})).length, events: (await ctx.data('events', 'list', {})).length};
  if (left.applications || left.events) throw new Error(`the store still holds ${left.applications} application(s) and ${left.events} event(s) after the reset`);
  return data ? addFocusData(ctx, data) : {};
}

// What the store holds now: the oracle's input.
export const readData = async ctx => ({rows: await ctx.data('applications', 'list', {}), events: await ctx.data('events', 'list', {})});

// The daily target the app saved: Notion's ⚙️ Search settings line (the page the app says it wrote), or this Mac's config/preferences.json.
export async function savedTarget(ctx, pageId) {
  if (ctx.store !== 'sqlite') return readTargetLine(ctx.token, pageId);
  return Number(JSON.parse(fs.readFileSync(path.join(ctx.profile, 'config', 'preferences.json'), 'utf8')).daily_applications_target);
}

// ---------- the oracle: what the numbers on Focus must be, from the store's records alone ----------
const read = (record, name) => record?.[name] ?? '';
const idOf = id => String(id || '').replace(/-/g, '');
const OUTCOME = new Set(['Applied', 'Confirmation received', 'Screening', 'Interview scheduled', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn', 'No response']);
const PREPARED = new Set(['Kit ready', 'Applying']);
const STEP_MARKS = [   // the funnel as the product defines it: the stages/events that mean "this application reached the step"
  {name: 'Prepared', marks: null}, {name: 'Applied', marks: OUTCOME},
  {name: 'Human reply', marks: new Set(['Reply received', 'Screening', 'Interview scheduled', 'Interviewing', 'Offer'])},
  {name: 'Screening', marks: new Set(['Screening', 'Interview scheduled', 'Interviewing', 'Offer'])},
  {name: 'Interviews', marks: new Set(['Interviewing', 'Offer'])}, {name: 'Offers', marks: new Set(['Offer'])},
];

export function expectedNumbers(rows, events, {now = new Date(), target = 5} = {}) {
  const today = zurichDay(now);
  const kindsByApp = new Map();
  for (const item of events) kindsByApp.set(idOf(item.app_id), [...(kindsByApp.get(idOf(item.app_id)) || []), read(item, 'kind')]);
  // applications per day: an application counts once on each day it has an Applied on date or an Applied event
  const daysByApp = new Map();
  const mark = (id, day) => daysByApp.set(id, new Set([...(daysByApp.get(id) || []), day]));
  for (const row of rows) if (read(row, 'applied_on')) mark(idOf(row.id), read(row, 'applied_on').slice(0, 10));
  for (const item of events) if (read(item, 'kind') === 'Applied' && item.app_id) mark(idOf(item.app_id), zurichDay(read(item, 'at')));
  const perDay = {};
  for (const days of daysByApp.values()) for (const day of days) perDay[day] = (perDay[day] || 0) + 1;
  const last14 = Array.from({length: 14}, (_, i) => shiftDay(today, i - 13));
  const total = last14.reduce((sum, day) => sum + (perDay[day] || 0), 0);
  const onTarget = last14.filter(day => (perDay[day] || 0) >= target).length;
  const applied = perDay[today] || 0;

  const outbound = [], inbound = [];
  for (const row of rows) {
    const origin = read(row, 'origin');
    if (!origin) throw new Error(`the oracle needs an explicit Origin on every row (${read(row, 'title')} has none)`);
    const stage = read(row, 'stage');
    const app = {seen: new Set([...(kindsByApp.get(idOf(row.id)) || []), stage])};
    if (origin === 'Inbound') inbound.push(app);
    else if (OUTCOME.has(stage) || PREPARED.has(stage)) outbound.push(app);
  }
  const steps = (apps, list) => list.map(({name, marks}) => ({name, reached: apps.filter(app => !marks || [...app.seen].some(kind => marks.has(kind))).length}));
  const share = (list, first) => list.map(step => ({...step, share: Math.round(100 * step.reached / Math.max(first, 1))}));
  const out = steps(outbound, STEP_MARKS).slice(0, 5), inb = steps(inbound, [{name: 'Contacted you', marks: null}, ...STEP_MARKS.slice(3)]);
  const kits = rows.filter(row => read(row, 'stage') === 'Kit ready').length;
  const pct = Math.min(100, Math.round(100 * applied / Math.max(target, 1)));
  return {
    applied, target, pct, kits,
    ofText: `/ ${target} applications today`, pctText: `${pct}%`,
    chartSum: `${total} applied · ${onTarget} day${onTarget === 1 ? '' : 's'} on target`,
    funnel: share(out, out[0].reached), inbound: inbound.length ? share(inb, inb[0].reached) : [],
  };
}

// What the page shows vs what the oracle says: a list of plain-English differences ([] when every number matches).
export function compareNumbers(shown, expected) {
  const diffs = [];
  const same = (label, got, want) => { if (String(got) !== String(want)) diffs.push(`${label}: Focus shows "${got}", the store says "${want}"`); };
  same('applications today', shown.count, expected.applied);
  same('the target line', shown.of, expected.ofText);
  same('the progress percentage', shown.pct, expected.pctText);
  same('the progress bar width', shown.bar, `${expected.pct}%`);
  same('the 14-day chart summary', shown.chartSum, expected.chartSum);
  same('the number of funnel steps', shown.funnel.length, expected.funnel.length);
  expected.funnel.forEach((step, i) => {
    const got = shown.funnel[i] || {};
    same(`funnel step ${i + 1} name`, got.name, step.name);
    same(`funnel "${step.name}" count`, got.count, step.reached);
    same(`funnel "${step.name}" share`, got.share, `${step.share}% reached`);
  });
  same('the number of inbound steps', shown.inbound.length, expected.inbound.length);
  expected.inbound.forEach((step, i) => {
    const got = shown.inbound[i] || {};
    same(`inbound "${step.name}" count`, got.count, step.reached);
    same(`inbound "${step.name}" share`, got.share, `${step.share}% reached`);
  });
  return diffs;
}

