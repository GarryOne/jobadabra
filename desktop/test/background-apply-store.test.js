// Persisted background Apply transitions: reservations survive restart and all unsafe states fail closed before a click.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyStore} from '../lib/background-apply-store.js';

const config = {mode: 'auto', chosenAt: '2026-10-27T10:00:00Z', answers: 'facts', auto: {minFit: 80, factsOnly: true, noEmpty: true, perDay: 20, perEmployer: 1, waitMin: 10}};
const ready = {answer: 'ready', step: 'final', submitControl: 'Send my application', requiredComplete: true, factsOnly: true, safe: true, botCheck: false, signature: 'page-1'};
function rig() {
  let time = Date.parse('2026-10-27T12:00:00Z'), id = 0, failed = false;
  const apps = new Map(), sections = new Map(), events = [];
  const call = async (_storage, entity, method, args) => {
    if (failed) throw new Error('store unavailable');
    if (entity === 'applications') {
      if (method === 'get') return apps.get(args.url) || null;
      if (method === 'list') return [...apps.values()];
      if (method === 'section') return sections.get(`${args.app_id}:${args.name}`) || '';
      if (method === 'set_section') { sections.set(`${args.app_id}:${args.name}`, args.markdown); return null; }
    }
    if (entity === 'matches' && method === 'get') return null;
    if (entity === 'events' && method === 'list') return events.filter(e => !args.kind || e.kind === args.kind);
    if (entity === 'events' && method === 'add') { const old = events.find(e => e.source_id === args.source_id); if (old) return old; const row = {...args, id: `e${++id}`}; events.push(row); return row; }
    throw new Error(`unexpected ${entity}.${method}`);
  };
  const make = () => createBackgroundApplyStore({}, {call, now: () => time, uuid: () => `attempt-${++id}`});
  const add = (suffix = '1', company = 'Fictional Cloud') => {
    const job = {id: `job-${suffix}`, url: `https://jobs.example.test/${suffix}`, fit: 90, company, stage: 'Kit ready'};
    apps.set(job.url, job);
    sections.set(`${job.id}:📝 Application kit`, '```json\n{"eligible":true,"answers":[]}\n```');
    return job;
  };
  return {make, add, apps, events, advance: ms => { time += ms; }, fail: () => { failed = true; }};
}
async function prepared(r, job = r.add(), mode = 'auto', opts = config) {
  const store = r.make(), row = await store.queue(job.url, `session-${job.id}`, mode, {...opts, mode});
  assert.equal((await store.claim(job.url, row.session, 'owned-browser')).ok, true);
  await store.ready(job.url, row.session, 'owned-browser', ready);
  return {store, job, session: row.session};
}

test('two launch claims and simultaneous reservations create exactly one owned session and submit attempt', async () => {
  const r = rig(), {store, job, session} = await prepared(r, r.add(), 'auto', {...config, auto: {...config.auto, waitMin: 0}});
  assert.equal((await store.claim(job.url, session, 'other-browser')).ok, false);
  const args = [job.url, session, 'owned-browser', ready, {...config, auto: {...config.auto, waitMin: 0}}];
  const results = await Promise.all([store.reserve(...args), store.reserve(...args)]);
  assert.equal(results.filter(x => x.submit).length, 1);
  assert.equal(r.events.length, 1);
  assert.equal((await r.make().reserve(...args)).submit, false, 'restart never repeats an uncertain attempt');
});

test('the automatic press needs the judge to have said no bot check: a bot check, or no answer about it, never reserves', async () => {
  for (const botCheck of [true, undefined]) {
    const r = rig(), {store, job, session} = await prepared(r, r.add());
    r.advance(600000);
    const proof = {...ready, botCheck}, got = await store.reserve(job.url, session, 'owned-browser', proof, config);
    assert.equal(got.submit, false, `botCheck ${botCheck}`);
    assert.equal(got.reason, 'bot_check_unknown');
    assert.equal((await store.read(job.url)).state, 'needs_user_handoff', 'the person finishes it');
  }
});

test('mode 2 ends ready for review, while mode 3 waits and rechecks every guard before reserving', async () => {
  const r = rig(), {store, job, session} = await prepared(r, r.add(), 'fill');
  assert.equal((await store.read(job.url)).state, 'ready_for_review');
  assert.equal((await store.reserve(job.url, session, 'owned-browser', ready, config)).submit, false);
  const second = await prepared(r, r.add('2', 'Other employer'));
  assert.equal((await second.store.reserve(second.job.url, second.session, 'owned-browser', ready, config)).reason, 'waiting');
  r.advance(600000);
  assert.equal((await second.store.reserve(second.job.url, second.session, 'owned-browser', ready, config)).submit, true);
});

test('CAPTCHA preflight and runtime handoffs survive store recreation, solved challenges and a changed mode', async () => {
  for (const reason of ['captcha_preflight', 'captcha_runtime']) {
    const r = rig(), job = r.add(), store = r.make();
    const row = await store.queue(job.url, 'captcha-session', 'auto', config);
    await store.claim(job.url, row.session, 'owned-browser');
    await store.handoff(job.url, row.session, 'owned-browser', reason);
    const restarted = r.make();
    assert.equal((await restarted.queue(job.url, 'new-session', 'auto', config)).session, row.session);
    assert.equal((await restarted.ready(job.url, row.session, 'owned-browser', ready)).state, 'manual_submit_required');
    assert.equal((await restarted.reserve(job.url, row.session, 'owned-browser', ready, config)).submit, false);
    assert.equal((await restarted.read(job.url)).manualOverride, true);
  }
});

test('unknown facts, required fields, opt-in, eligibility, fit, Stop, and limits cannot be bypassed', async () => {
  for (const kind of ['facts', 'required', 'unsafe', 'optin', 'eligible', 'fit', 'stop', 'daily', 'employer']) {
    const r = rig(), {store, job, session} = await prepared(r);
    r.advance(600000);
    let proof = {...ready}, current = structuredClone(config);
    if (kind === 'facts') proof.factsOnly = false;
    if (kind === 'required') { proof.requiredComplete = false; current.auto.noEmpty = false; }
    if (kind === 'unsafe') proof.safe = false;
    if (kind === 'optin') current.chosenAt = '';
    if (kind === 'eligible') r.apps.get(job.url).stage = 'Applied';
    if (kind === 'fit') r.apps.get(job.url).fit = 79;
    if (kind === 'stop') await store.handoff(job.url, session, 'owned-browser', 'stopped');
    if (kind === 'daily') { current.auto.perDay = 1; r.apps.set('other', {id: 'done', company: 'Other', stage: 'Applied', applied_on: '2026-10-27'}); }
    if (kind === 'employer') r.apps.set('other', {id: 'done', company: job.company, stage: 'Applied', applied_on: '2026-10-27'});
    assert.equal((await store.reserve(job.url, session, 'owned-browser', proof, current)).submit, false, kind);
  }
});

test('the saved employer cap is per day, including reservations, rather than a permanent employer blacklist', async () => {
  const r = rig(), {store, job, session} = await prepared(r);
  r.apps.set('yesterday', {id: 'old', company: job.company, stage: 'Applied', applied_on: '2026-10-26'});
  r.events.push({app_id: 'old', kind: 'Background submit reserved', changes: {employer: job.company.toLowerCase(), day: '2026-10-26'}});
  r.advance(600000);
  assert.equal((await store.reserve(job.url, session, 'owned-browser', ready, config)).submit, true);
});

test('receipt requires a matching recorded attempt; filled or unknown response never becomes Applied', async () => {
  const r = rig(), {store, job, session} = await prepared(r);
  assert.equal((await store.receipt(job.url, session, 'made-up', true)).ok, false);
  r.advance(600000);
  const attempt = await store.reserve(job.url, session, 'owned-browser', ready, config);
  assert.equal((await store.receipt(job.url, session, attempt.attempt, false)).state, 'needs_user_handoff');
  assert.equal((await r.make().reserve(job.url, session, 'owned-browser', ready, config)).submit, false);
  assert.equal((await store.receipt(job.url, session, attempt.attempt, true)).state, 'receipt_confirmed', 'a late genuine receipt can settle the recorded attempt');
});

test('a store outage authorizes neither browser launch nor submission', async () => {
  const r = rig(), job = r.add(); r.fail();
  await assert.rejects(r.make().queue(job.url, 's', 'auto', config), /store unavailable/);
});

test('a final clean step cannot erase unknown facts observed on an earlier step', async () => {
  const r = rig(), job = r.add(), store = r.make();
  const state = await store.queue(job.url, 'steps', 'auto', config);
  await store.claim(job.url, state.session, 'owned-browser');
  await store.checkpoint(job.url, state.session, 'owned-browser', {...ready, step: 'middle', factsOnly: false});
  const final = await store.ready(job.url, state.session, 'owned-browser', ready);
  assert.equal(final.factsOnly, false);
  r.advance(600000);
  const result = await store.reserve(job.url, state.session, 'owned-browser', ready, config);
  assert.equal(result.submit, false);
  assert.equal(result.reason, 'facts_unknown');
});

test('Stop or a mode change on a queued job hands it to the person before any browser claims it', async () => {
  const r = rig(), job = r.add(), store = r.make();
  const row = await store.queue(job.url, 'session-queued', 'fill', {...config, mode: 'fill'});   // bot review on #2324: queued has no owner yet
  const stopped = await store.handoff(job.url, row.session, 'owned-browser', 'stopped');
  assert.equal(stopped.state, 'needs_user_handoff');
  assert.equal(stopped.manualOverride, true);
  assert.equal((await store.claim(job.url, row.session, 'owned-browser')).ok, false, 'a stopped job is never claimed and filled later');
});

test('a ready final form keeps the page\'s own sending button, which the person\'s Submit in the live view presses', async () => {
  const r = rig(), {store, job} = await prepared(r, r.add('fill'), 'fill', {...config, mode: 'fill'});
  const state = await store.read(job.url);
  assert.deepEqual([state.state, state.submitControl], ['ready_for_review', 'Send my application']);
});

test('queue refuses a Recruiter lead with a typed not-eligible error, and accepts a job with no stage yet (the picker\'s rule)', async () => {
  const r = rig(), store = r.make();
  const lead = r.add('lead'); lead.stage = 'Recruiter lead';
  await assert.rejects(() => store.queue(lead.url, 's-lead', 'fill', {...config, mode: 'fill'}), error => error.code === 'NOT_ELIGIBLE' && /not eligible to start another application/.test(error.message));
  const unstaged = r.add('none'); unstaged.stage = '';
  assert.equal((await store.queue(unstaged.url, 's-none', 'fill', {...config, mode: 'fill'})).state, 'queued');
  const strict = r.add('strict'); strict.stage = '';
  await assert.rejects(() => store.queue(strict.url, 's-strict', 'auto', {...config, mode: 'auto'}), error => error.code === 'NOT_ELIGIBLE', 'Full automation never queues a job with no stage: its submit gate would refuse it');
});

// Why (2026-10-28, owner: "Why 10 minutes? Why not 1 minute?" → 2 minutes): one default for the wait; a config that does not name it gets AUTO_DEFAULTS.waitMin, in the store and in the controller alike.
test('with no wait saved the press waits the shared default (2 minutes), not 10', async () => {
  const {AUTO_DEFAULTS} = await import('../renderer/apply-settings-model.js');
  assert.equal(AUTO_DEFAULTS.waitMin, 2);
  const unset = {...config, auto: {...config.auto, waitMin: undefined}};
  const r = rig(), {store, job, session} = await prepared(r, r.add(), 'auto', unset);
  r.advance(119000);
  const early = await store.reserve(job.url, session, 'owned-browser', ready, unset);
  assert.equal(early.submit, false, 'still inside the wait');
  r.advance(2000);
  const later = await store.reserve(job.url, session, 'owned-browser', ready, unset);
  assert.equal(later.submit, true, 'after 2 minutes the checks decide, not a 10-minute fallback');
});
