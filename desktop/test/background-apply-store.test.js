// Persisted background Apply transitions: reservations survive restart and all unsafe states fail closed before a click.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyStore} from '../lib/background-apply-store.js';

const config = {mode: 'auto', chosenAt: '2026-10-27T10:00:00Z', answers: 'facts', auto: {waitMin: 10}};
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

test('the page proof, opt-in, eligibility and Stop cannot be bypassed', async () => {
  for (const kind of ['required', 'unsafe', 'optin', 'eligible', 'stop']) {
    const r = rig(), {store, job, session} = await prepared(r);
    r.advance(600000);
    let proof = {...ready}, current = structuredClone(config);
    if (kind === 'required') proof.requiredComplete = false;
    if (kind === 'unsafe') proof.safe = false;
    if (kind === 'optin') current.chosenAt = '';
    if (kind === 'eligible') r.apps.get(job.url).stage = 'Applied';
    if (kind === 'stop') await store.handoff(job.url, session, 'owned-browser', 'stopped');
    assert.equal((await store.reserve(job.url, session, 'owned-browser', proof, current)).submit, false, kind);
  }
});

test('no user check holds a submit: unknown facts, a fit of 10, a full day and the same employer still reserve (the checks are gone)', async () => {
  const r = rig(), {store, job, session} = await prepared(r);
  r.apps.set('other', {id: 'done', company: job.company, stage: 'Applied', applied_on: '2026-10-27'});
  r.apps.get(job.url).fit = 10;
  r.advance(600000);
  assert.equal((await store.reserve(job.url, session, 'owned-browser', {...ready, factsOnly: false}, config)).submit, true);
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

test('a final clean step keeps the record of unknown facts seen on an earlier step (the record stays; no submit gate reads it)', async () => {
  const r = rig(), job = r.add(), store = r.make();
  const state = await store.queue(job.url, 'steps', 'auto', config);
  await store.claim(job.url, state.session, 'owned-browser');
  await store.checkpoint(job.url, state.session, 'owned-browser', {...ready, step: 'middle', factsOnly: false});
  const final = await store.ready(job.url, state.session, 'owned-browser', ready);
  assert.equal(final.factsOnly, false);
  r.advance(600000);
  const result = await store.reserve(job.url, state.session, 'owned-browser', ready, config);
  assert.equal(result.submit, true, 'the facts record does not hold the submit any more');
  assert.equal((await store.read(job.url)).factsOnly, false, 'the record itself is kept');
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

// Why (2026-10-29, owner: "by default, we should go with no" wait): one default for the wait, none (0); a config that does not name it gets AUTO_DEFAULTS.waitMin, in the store and in the controller alike.
test('with no wait saved the press is due at once: the shared default is no wait (optional in Settings → Apply)', async () => {
  const {AUTO_DEFAULTS} = await import('../renderer/apply-settings-model.js');
  assert.equal(AUTO_DEFAULTS.waitMin, 0);
  const unset = {...config, auto: {...config.auto, waitMin: undefined}};
  const r = rig(), {store, job, session} = await prepared(r, r.add(), 'auto', unset);
  const now = await store.reserve(job.url, session, 'owned-browser', ready, unset);
  assert.equal(now.submit, true, 'no wait: the checks decide at once, not after a fallback wait');
});

// Crash rule (owner, 29 Oct 2026: a job left in "submitting" after a quit is handed over, never retried): the hidden browser dies with the app, so a press in flight has no receipt to wait for.
test('a press interrupted by a quit becomes "check whether it went through", whatever browser owned it, and is never reserved again', async () => {
  const waitNow = {...config, auto: {...config.auto, waitMin: 0}}, r = rig(), {store, job, session} = await prepared(r, r.add(), 'auto', waitNow);
  assert.equal((await store.reserve(job.url, session, 'owned-browser', ready, waitNow)).submit, true, 'the press was reserved');
  const restarted = r.make();   // a new run of the app: no browser owns anything
  const state = await restarted.interrupted(job.url, session);
  assert.equal(state.state, 'needs_user_handoff');
  assert.equal(state.reason, 'submission_outcome_unknown');
  assert.equal(state.manualOverride, true);
  assert.equal((await restarted.reserve(job.url, session, 'new-browser', ready, waitNow)).submit, false, 'a second attempt never goes out');
  assert.equal(await restarted.interrupted(job.url, session), null, 'once handed over, nothing is interrupted again');
});

test('a job that was not mid-press, or already has its receipt, is left alone by the interrupted check', async () => {
  const r = rig(), {store, job, session} = await prepared(r, r.add(), 'auto');
  assert.equal(await store.interrupted(job.url, session), null, 'waiting to submit is not an interrupted press');
  assert.equal(await store.interrupted(job.url, 'someone-else'), null, 'another session\'s record is not touched');
});

// A press whose reply never arrives (the extension closed, the app still open): the app hands it over itself once the wait is up.
test('a press with no receipt after the wait is handed to the person; a younger one is left alone', async () => {
  const waitNow = {...config, auto: {...config.auto, waitMin: 0}}, r = rig(), {store, job, session} = await prepared(r, r.add(), 'auto', waitNow);
  assert.equal((await store.reserve(job.url, session, 'owned-browser', ready, waitNow)).submit, true, 'the press was reserved');
  r.advance(2 * 60000);
  assert.equal(await store.interrupted(job.url, session, {afterMs: 3 * 60000}), null, '2 minutes after the press is still within the wait for a reply');
  assert.equal((await store.read(job.url)).state, 'submitting');
  r.advance(60000);
  const state = await store.interrupted(job.url, session, {afterMs: 3 * 60000});
  assert.equal(state.state, 'needs_user_handoff');
  assert.equal(state.reason, 'submission_outcome_unknown');
  assert.equal((await store.reserve(job.url, session, 'owned-browser', ready, waitNow)).submit, false, 'never pressed again');
});

// A quit is a Stop (owner, 30 Oct 2026, after #2598's restart step saw Full automation press 80 s after a restart on the wait the quit cut off).
test('a job a quit caught before its press (waiting, ready for review, filling) goes to the person as app_closed, whatever browser owned it, and is never pressed', async () => {
  const r = rig(), waiting = await prepared(r, r.add('w'), 'auto'), held = await prepared(r, r.add('f', 'Other employer'), 'fill');
  const filling = r.make(), job = r.add('q', 'Third employer'), row = await filling.queue(job.url, 'session-q', 'fill', {...config, mode: 'fill'});
  assert.equal((await filling.claim(job.url, row.session, 'owned-browser')).ok, true);
  r.advance(600000);   // the wait ran out while the app was closed
  const restarted = r.make();
  for (const [url, session, was] of [[waiting.job.url, waiting.session, 'waiting_to_submit'], [held.job.url, held.session, 'ready_for_review'], [job.url, row.session, 'preflight']]) {
    assert.equal((await restarted.read(url)).state, was, `positive control: the quit caught it in ${was}`);
    assert.equal(await restarted.interrupted(url, session), null, `without quit, ${was} is not an interrupted press`);
    const state = await restarted.interrupted(url, session, {quit: true});
    assert.equal(state.state, 'needs_user_handoff', was);
    assert.equal(state.reason, 'app_closed', was);
    assert.equal(state.manualOverride, true, was);
    assert.equal(await restarted.interrupted(url, session, {quit: true}), null, `${was}: once handed over, nothing is handed over again`);
  }
  assert.equal((await restarted.reserve(waiting.job.url, waiting.session, 'owned-browser', ready, config)).submit, false, 'the wait the quit cut off never presses');
});
