// Full automation is refused until the person confirmed it in Settings → Apply: no store write, no browser, no session before that.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyController} from '../lib/background-apply-controller.js';

const touched = [];
const spy = name => (...args) => { touched.push(name); return args; };
const make = (options = {}) => createBackgroundApplyController({}, {
  store: {queue: spy('store.queue')}, browser: {start: spy('browser.start')}, terminals: {list: () => [], byUrl: () => null, startForm: spy('terminals.startForm')},
  config: () => ({mode: 'auto', chosenAt: '2026-10-28T10:00:00Z'}), ...options});

test('Full automation without the person\'s confirmation: no store write, no browser, no session', async () => {
  const result = await make({config: () => ({mode: 'auto', autoConfirmedAt: ''})}).enqueue([{url: 'https://jobs.example.test/a'}], 'auto');
  assert.equal(result.ok, false);
  assert.match(result.error, /off until you confirm it in Settings/);
  assert.deepEqual(touched, []);
});

test('Background automation without the downloaded browser refuses before any store write, session or launch', async () => {
  touched.length = 0;
  const result = await make({config: () => ({mode: 'fill', chosenAt: '2026-10-28T10:00:00Z'}), browser: {ready: () => false, start: spy('browser.start')}})
    .enqueue([{url: 'https://jobs.example.test/b'}], 'fill');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BACKGROUND_BROWSER_MISSING');
  assert.deepEqual(touched, []);
});

test('registering the apply handlers creates the controller without touching storage paths', () => {
  assert.doesNotThrow(() => createBackgroundApplyController({}, {store: {}}));   // CI #2324: a storage with no path() crashed handler registration
});

test('the live view reaches only a hidden-browser session\'s held tab, never a visible session or an unknown id', async () => {
  const records = {bg: {id: 'bg', background: {}}, visible: {id: 'visible'}}, asked = [];
  const controller = createBackgroundApplyController({}, {store: {}, terminals: {record: id => records[id] || null},
    browser: {pageSocket: async id => { asked.push(id); return `ws://127.0.0.1:9/devtools/page/${id}`; }}});
  assert.equal(await controller.page('bg'), 'ws://127.0.0.1:9/devtools/page/bg');
  assert.equal(await controller.page('visible'), null);
  assert.equal(await controller.page('nobody'), null);
  assert.deepEqual(asked, ['bg'], 'the browser is asked only for the hidden session');
});

test('the controller reads the notifier when it notifies, not when it is created', async () => {
  const hooks = await import('../lib/server-hooks.js');
  const record = {id: 's1', url: 'https://jobs.example.test/n', background: {}}, sent = [];
  const controller = createBackgroundApplyController({}, {   // the controller exists before main.js wires the notifier (bot review on #2324)
    store: {handoff: async () => ({mode: 'fill', state: 'needs_user_handoff', reason: 'stopped', session: 's1'})},
    browser: {start: async () => ({owner: 'o1'})}, terminals: {record: () => record, report: () => {}}, config: () => ({}), log: () => {}, token: () => 'fictional', port: 1});
  hooks.setNotifier((...args) => sent.push(args));
  try { await controller.handle({owner: 'o1', session: 's1', action: 'manual', reason: 'stopped'}); }
  finally { hooks.setNotifier(() => {}); }
  assert.equal(sent.length, 1);
});

const held = (state, extra = {}) => {
  const records = {bg: {id: 'bg', url: 'https://jobs.example.test/h', background: {}}, visible: {id: 'visible', url: 'https://jobs.example.test/v'}}, seen = [];
  const controller = createBackgroundApplyController({}, {terminals: {record: id => records[id] || null, report: () => {}}, config: () => ({}), log: () => {}, token: () => 'fictional', port: 1,
    notify: () => {}, store: {read: async () => state, handoff: async (...args) => { seen.push(['handoff', args[3]]); return {...state, state: 'needs_user_handoff', manualOverride: true}; }},
    browser: {start: async () => ({owner: 'o1'}), pageSocket: async id => `ws://127.0.0.1:9/devtools/page/${id}`, closeSession: async id => { seen.push(['close', id]); return true; }}, ...extra});
  return {controller, seen};
};
test('the app\'s Submit gets the page\'s sending button only for a hidden session the form judge found ready, never after a hand-off', async () => {
  const ready = {session: 'bg', owner: 'o1', state: 'ready_for_review', submitControl: 'Envoyer'};
  assert.equal(await held(ready).controller.submitControl('bg'), 'Envoyer');
  assert.equal(await held(ready).controller.submitControl('visible'), '');
  assert.equal(await held({...ready, state: 'needs_user_handoff', manualOverride: true}).controller.submitControl('bg'), '');
  assert.equal(await held({...ready, session: 'other'}).controller.submitControl('bg'), '');
  assert.equal(await held({...ready, submitControl: undefined}).controller.submitControl('bg'), '');
});

test('Open in my browser reads the hand-off from the held tab before it closes, and hands the job to the person', async () => {
  const {controller, seen} = held({session: 'bg', owner: 'o1', state: 'ready_for_review'});
  const result = await controller.handOver('bg', async address => { seen.push(['read', address]); return {url: 'https://jobs.example.test/h/apply'}; });
  assert.deepEqual(result, {ok: true, handoff: {url: 'https://jobs.example.test/h/apply'}});
  assert.deepEqual(seen.map(([what]) => what), ['read', 'handoff', 'close'], 'read first, then the hand-over is saved, then the hidden tab closes');
  assert.equal(seen[1][1], 'opened_in_browser');
  const none = held({});
  assert.equal((await none.controller.handOver('visible', async () => { throw new Error('never read'); })).ok, false);
  const unreadable = held({session: 'bg', owner: 'o1', state: 'filling'});
  assert.deepEqual(await unreadable.controller.handOver('bg', async () => { throw new Error('page gone'); }), {ok: true, handoff: null}, 'a page that cannot be read still hands the job over; the fill starts again in Chrome');
});

const refuse = () => { throw Object.assign(new Error('This job is not eligible to start another application.'), {code: 'NOT_ELIGIBLE'}); };
const fillConfig = () => ({mode: 'fill', chosenAt: '2026-10-28T10:00:00Z'});

test('a job the store refuses as not eligible comes back as a plain answer with what to do, never a thrown error, and starts no browser', async () => {
  touched.length = 0;
  const result = await make({config: fillConfig, store: {queue: async () => refuse()}, browser: {ready: () => true, start: spy('browser.start')}})
    .enqueue([{url: 'https://jobs.example.test/lead'}], 'fill');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'This job is not eligible to start another application. Pick another job in Jobs and try again.');
  assert.deepEqual(touched, [], 'no session started, no browser launched');
});

test('in a batch, an ineligible job is skipped and said while the others still start; any other failure stops the batch with its own words', async () => {
  touched.length = 0;
  const queue = async url => (url.endsWith('/lead') ? refuse() : {session: `s-${url.slice(-1)}`});
  const terminals = {list: () => [], byUrl: () => null, record: () => null, startForm: ({id}) => { touched.push(`startForm ${id}`); return {id}; }};
  const result = await make({config: fillConfig, store: {queue}, terminals, token: () => 'test-token', log: () => {}, browser: {ready: () => true, start: async () => { touched.push('browser.start'); return {owner: 'o'}; }}})
    .enqueue([{url: 'https://jobs.example.test/lead'}, {url: 'https://jobs.example.test/b'}], 'fill');
  assert.equal(result.ok, true);
  assert.deepEqual(result.sessions, ['s-b']);
  assert.match(result.message, /1 application queued.*1 job was skipped: not eligible/);
  assert.deepEqual(touched, ['startForm s-b', 'browser.start']);
  const broken = await make({config: fillConfig, store: {queue: async () => { throw new Error('Could not write the application record.'); }}, browser: {ready: () => true, start: spy('browser.start')}})
    .enqueue([{url: 'https://jobs.example.test/a'}, {url: 'https://jobs.example.test/b'}], 'fill');
  assert.deepEqual(broken, {ok: false, error: 'Could not write the application record.'}, 'a real failure is not called "not eligible" and is not hidden');
});

// Why (2026-10-28, owner: "Finish the 'Full automation' flow"; project safety rule "10-minute wait with Stop"): the one test of the wait: once the person has pressed Stop, an elapsed timer must never issue the press.
test('Stop during the 10-minute wait hands the job to the person, and the elapsed timer issues no press; without Stop the same state does issue it', async () => {
  const now = Date.parse('2026-10-28T21:30:00Z'), handoffs = [];
  const waiting = {session: 's1', mode: 'auto', chosenAt: 'c1', state: 'waiting_to_submit', readyAt: now - 11 * 60000, manualOverride: false};
  const controller = stuck => createBackgroundApplyController({}, {
    store: {read: async () => waiting, handoff: async (_url, _id, _owner, reason) => { handoffs.push(reason); return {...waiting, state: 'needs_user_handoff', manualOverride: true, reason}; }},
    browser: {start: async () => ({owner: 'o1'})}, terminals: {list: () => [{id: 's1', url: 'https://jobs.example.test/w', background: {}, ...(stuck ? {stuck} : {})}], record: () => null, report: () => {}},
    config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 10}}), now: () => now, token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  const stopped = await controller('stopped').handle({action: 'poll', owner: 'o1'});
  assert.deepEqual(stopped.checks, [], 'no press after Stop');
  assert.deepEqual(handoffs, ['stopped'], 'the job went to the person');
  const untouched = await controller('').handle({action: 'poll', owner: 'o1'});
  assert.deepEqual(untouched.checks, [{session: 's1'}], 'positive control: with no Stop the elapsed wait does ask for the press');
});

test('at start every background job left mid-press is handed to the person with its words, and nothing launches or presses', async () => {
  const records = {s1: {id: 's1'}, s2: {id: 's2'}, s3: {id: 's3'}}, reports = [], notices = [], launched = [];
  const interrupted = {s1: {state: 'needs_user_handoff', reason: 'submission_outcome_unknown', mode: 'auto', manualOverride: true}};
  interrupted.s5 = interrupted.s1;   // a press this run started: in flight, not cut off
  const controller = createBackgroundApplyController({}, {
    store: {interrupted: async (url, session) => interrupted[session] || null, ready: spy('store.ready'), reserve: spy('store.reserve')},
    browser: {start: (...args) => launched.push(args)},
    terminals: {list: () => [{id: 's1', url: 'https://jobs.example.test/1', background: {}, outcome: '', startedAt: '2020-01-01T00:00:00Z'}, {id: 's2', url: 'https://jobs.example.test/2', background: {}, outcome: '', startedAt: '2020-01-01T00:00:00Z'},
      {id: 's5', url: 'https://jobs.example.test/5', background: {}, outcome: '', startedAt: new Date().toISOString()},
      {id: 's3', url: 'https://jobs.example.test/3', background: {}, outcome: 'Applied'}, {id: 'v', url: 'https://jobs.example.test/4', outcome: ''}], record: id => records[id] || null, report: (id, event) => reports.push([id, event])},
    notify: (...args) => notices.push(args)});
  touched.length = 0;
  assert.deepEqual(await controller.sweepInterrupted(), ['s1'], 'only the job whose press was cut off; a finished job and a visible session are not asked');
  assert.match(notices[0][1], /Check whether it went through/);
  assert.match(reports[0][1].message, /Check whether it went through/);
  assert.deepEqual(launched, [], 'no browser starts');
  assert.deepEqual(touched, [], 'nothing is reserved or readied');
});

test('a press with no reply after 3 minutes is handed to the person by the app itself, with the same words, and nothing launches or presses', async () => {
  const reports = [], notices = [], launched = [], asked = [];
  const controller = createBackgroundApplyController({}, {
    store: {interrupted: async (url, session, options) => { asked.push([session, options]); return session === 's1' ? {state: 'needs_user_handoff', reason: 'submission_outcome_unknown', mode: 'auto', manualOverride: true} : null; }, ready: spy('store.ready'), reserve: spy('store.reserve')},
    browser: {start: (...args) => launched.push(args)},
    terminals: {list: () => [{id: 's1', url: 'https://jobs.example.test/1', background: {state: 'submitting'}, outcome: '', startedAt: new Date().toISOString()}, {id: 's2', url: 'https://jobs.example.test/2', background: {state: 'submitting'}, outcome: ''},
      {id: 's4', url: 'https://jobs.example.test/6', background: {state: 'ready_for_review'}, outcome: ''}, {id: 's6', url: 'https://jobs.example.test/7', background: {state: 'needs_user_handoff'}, outcome: ''},
      {id: 'v', url: 'https://jobs.example.test/4', outcome: ''}], record: () => ({}), report: (id, event) => reports.push([id, event])},
    notify: (...args) => notices.push(args)});
  touched.length = 0;
  assert.deepEqual(await controller.sweepStalled(), ['s1'], 'a press of this very run counts too; a visible session is not asked');
  assert.deepEqual(asked.map(([, options]) => options.afterMs), [180000, 180000], 'only a press older than 3 minutes');
  assert.deepEqual(asked.map(([session]) => session), ['s1', 's2'], 'only sessions whose cached state is mid-press are asked: no store call for one ready for review or already handed over');
  assert.match(notices[0][1], /Check whether it went through/);
  assert.doesNotMatch(notices[0][1], /closed/, 'the words fit a lost reply as well as a quit');
  assert.match(reports[0][1].message, /Check whether it went through/);
  assert.deepEqual([launched, touched], [[], []]);
});

// A quit is a Stop (owner, 30 Oct 2026, after #2598's restart step saw Full automation press 80 s after a restart on the wait the quit cut off).
test('after a restart a job an earlier run held goes to the person, at start and on the first poll, and its run-out wait asks no press', async () => {
  const now = Date.parse('2026-10-30T16:30:00Z'), started = now - 5000, asked = [], notices = [];
  const waiting = {session: 's1', mode: 'auto', chosenAt: 'c1', state: 'waiting_to_submit', readyAt: now - 2 * 60000, manualOverride: false};
  const handed = {...waiting, state: 'needs_user_handoff', reason: 'app_closed', manualOverride: true};
  const controller = startedAt => {
    let state = waiting;
    return createBackgroundApplyController({}, {
      store: {read: async () => state, interrupted: async (_url, session, options) => { asked.push([session, options]); return options?.quit && !state.manualOverride ? (state = handed) : null; }},
      browser: {start: async () => ({owner: 'o1'})}, terminals: {list: () => [{id: 's1', url: 'https://jobs.example.test/w', background: {}, outcome: '', startedAt}], record: () => null, report: () => {}},
      config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 1}}), now: () => now, started, token: () => 't', notify: (...args) => notices.push(args), stop: () => false, log: () => {}});
  };
  const before = new Date(started - 60000).toISOString();
  const polled = await controller(before).handle({action: 'poll', owner: 'o1'});
  assert.deepEqual(polled.checks, [], 'the wait the quit cut off asks no press, even before the start-up sweep');
  assert.deepEqual(asked, [['s1', {quit: true}]], 'the job went to the person through the crash rule\'s writer');
  assert.match(notices[0][1], /app was closed/);
  asked.length = 0;
  assert.deepEqual(await controller(before).sweepInterrupted(), ['s1'], 'the start-up sweep hands it over too');
  assert.deepEqual(asked, [['s1', {quit: true}]]);
  const fresh = await controller(new Date(started + 1000).toISOString()).handle({action: 'poll', owner: 'o1'});
  assert.deepEqual(fresh.checks, [{session: 's1'}], 'positive control: a job this run started still presses when its wait runs out');
});

// Gitar on #2598: a hand-over that does not save must not let the job go on; a quit is a Stop even when the store write fails.
test('a job an earlier run held whose hand-over fails is still never claimed or pressed', async () => {
  const now = Date.parse('2026-10-30T16:30:00Z'), started = now - 5000, claimed = [];
  const waiting = {session: 's1', mode: 'auto', chosenAt: 'c1', state: 'waiting_to_submit', readyAt: now - 2 * 60000, manualOverride: false};
  const controller = startedAt => createBackgroundApplyController({}, {
    store: {read: async () => waiting, interrupted: async () => { throw new Error('store unavailable'); }, claim: async (...args) => { claimed.push(args); return {ok: false}; }},
    browser: {start: async () => ({owner: 'o1'})}, terminals: {list: () => [{id: 's1', url: 'https://jobs.example.test/w', background: {}, outcome: '', startedAt}], record: () => null, report: () => {}},
    config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 1}}), now: () => now, started, token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  const polled = await controller(new Date(started - 60000).toISOString()).handle({action: 'poll', owner: 'o1'});
  assert.deepEqual([polled.checks, polled.jobs, claimed], [[], [], []], 'no press, no claim while the hand-over did not save');
  const fresh = await controller(new Date(started + 1000).toISOString()).handle({action: 'poll', owner: 'o1'});
  assert.deepEqual(fresh.checks, [{session: 's1'}], 'positive control: the same store outage does not stop a job this run started');
});

// Gitar on #2598: the cache is saved 1.5 s after a move, so a quit can leave the store handed over and the cache not; such a job still goes the hand-off way.
test('a job an earlier run held that the store already handed over goes the normal hand-off way, even when its cache missed it', async () => {
  const now = Date.parse('2026-10-30T16:30:00Z'), started = now - 5000;
  const handed = {session: 's1', mode: 'auto', chosenAt: 'c1', state: 'needs_user_handoff', reason: 'stopped', manualOverride: true};
  const controller = createBackgroundApplyController({}, {
    store: {read: async () => handed, interrupted: async () => null},
    browser: {start: async () => ({owner: 'o1'})}, terminals: {list: () => [{id: 's1', url: 'https://jobs.example.test/w', background: {state: 'waiting_to_submit', manualOverride: false}, outcome: '', startedAt: new Date(started - 60000).toISOString()}], record: () => null, report: () => {}},
    config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 1}}), now: () => now, started, token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  const polled = await controller.handle({action: 'poll', owner: 'o1'});
  assert.deepEqual([polled.handoffs, polled.checks], [[{session: 's1', reason: 'stopped', reveal: true}], []], 'the stale cache does not hide the store\'s hand-over');
});

// Found by #2598's restart steps (30 Oct 2026): a handed-over session whose job was then removed made store.read throw on every poll, so no later job was ever claimed.
test('an open session whose job record is gone does not stop the poll: the queued job is still claimed', async () => {
  const queued = {session: 'new', mode: 'auto', chosenAt: 'c1', state: 'queued', owner: ''};
  const controller = createBackgroundApplyController({}, {
    store: {read: async url => { if (url.endsWith('/gone')) throw new Error('This job has no Application record. Prepare its kit first.'); return queued; },
      claim: async () => ({ok: true, state: {...queued, state: 'preflight', owner: 'o1'}})},
    browser: {start: async () => ({owner: 'o1'})},
    terminals: {list: () => [{id: 'old', url: 'https://jobs.example.test/gone', background: {state: 'needs_user_handoff', manualOverride: true}, outcome: ''}, {id: 'new', url: 'https://jobs.example.test/new', background: {}, outcome: ''}], record: () => null, report: () => {}},
    config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 1}}), token: () => 't', notify: () => {}, stop: () => false, log: () => {}});
  const polled = await controller.handle({action: 'poll', owner: 'o1'});
  assert.deepEqual(polled.jobs.map(job => job.session), ['new'], 'the removed job is skipped, the queued one starts');
});

test('one moved clock drives the store reservation and poll; Stop and quit still refuse after due', async () => {
  const {createBackgroundApplyStore} = await import('../lib/background-apply-store.js');
  const {createBackgroundWaitClock} = await import('../lib/background-apply-clock.js');
  for (const handoff of ['', 'stopped', 'app_closed']) {
    const clock = createBackgroundWaitClock({env: {JOB_PILOTTO_E2E: '1'}, wallNow: () => 1000});
    const app = {id: 'app', url: 'https://jobs.example.test/clock', stage: 'Kit ready'}, sections = new Map(), events = [], records = new Map();
    const call = async (_storage, entity, method, args) => {
      if (entity === 'applications' && method === 'get') return app;
      if (entity === 'applications' && method === 'section') return sections.get(args.name) || '';
      if (entity === 'applications' && method === 'set_section') { sections.set(args.name, args.markdown); return; }
      if (entity === 'events' && method === 'list') return events;
      if (entity === 'events' && method === 'add') { events.push(args); return; }
      throw new Error(`unexpected ${entity}.${method}`);
    };
    sections.set('📝 Application kit', '```json\n{"eligible":true,"answers":[]}\n```');
    const config = {mode: 'auto', chosenAt: 'chosen', autoConfirmedAt: 'confirmed', auto: {waitMin: 1}};
    const store = createBackgroundApplyStore({}, {call, now: clock.now, uuid: () => 'attempt'});
    const terminals = {list: () => [...records.values()], byUrl: () => null, record: id => records.get(id), report: () => {}, startForm: item => {
      const record = {...item, startedAt: new Date(1000).toISOString()}; records.set(item.id, record); return record;
    }};
    const controller = createBackgroundApplyController({}, {store, now: clock.now, started: 0, config: () => config, uuid: () => 'session1', terminals,
      browser: {ready: () => true, start: async () => ({owner: 'owner'})}, stop: () => false, reader: {busy: () => false, take: () => null, takeEnded: () => []},
      port: 1, token: () => 'fictional', notify: () => {}, log: () => {}});
    await controller.enqueue([app], 'auto');
    await controller.handle({action: 'poll', owner: 'owner'});
    const body = {background: {owner: 'owner', session: 'session1'}, sketch: {page: 'same'}};
    const answer = {answer: 'ready', step: 'final', submitControl: 'Send', confidence: 1, botCheck: false};
    const readyPayload = async () => ({action: 'ready', owner: 'owner', session: 'session1', ...(await controller.judgment(body, answer)), requiredComplete: true, safe: true, factsOnly: true});
    assert.equal((await controller.handle(await readyPayload())).reason, 'waiting');
    const held = records.get('session1').background;
    assert.equal(held.dueAt, 61000);
    assert.deepEqual(held.waitDecision, {at: 1000, dueAt: 61000, state: 'waiting_to_submit', reason: 'waiting'});
    assert.deepEqual((await controller.handle({action: 'poll', owner: 'owner'})).checks, []);
    if (handoff === 'stopped') await controller.handle({action: 'manual', owner: 'owner', session: 'session1', reason: 'stopped'});
    if (handoff === 'app_closed') await controller.sweepInterrupted(2000);
    const at = clock.moveTo(held.dueAt + 1);
    const poll = await controller.handle({action: 'poll', owner: 'owner'});
    const decision = records.get('session1').background.waitDecision;
    assert.equal(decision.at, at, 'the verdict is from the poll after the move');
    assert.equal(decision.reason, handoff || 'due');
    assert.equal(decision.state, handoff ? 'needs_user_handoff' : 'waiting_to_submit');
    assert.deepEqual(poll.checks, handoff ? [] : [{session: 'session1'}]);
    if (!handoff) {
      const payload = await readyPayload();
      assert.equal((await controller.handle(payload)).submit, true, 'the store reads the same advanced clock');
      assert.equal((await controller.handle(payload)).submit, undefined, 'a consumed proof never presses twice');
      assert.equal(records.get('session1').background.waitDecision.reason, 'authorized');
      assert.equal(events.length, 1);
    } else {
      assert.equal((await controller.handle(await readyPayload())).submit, undefined);
      assert.equal(events.length, 0, 'no attempt is reserved after Stop or quit');
    }
  }
});

test('moving the e2e clock after a quit starts the owned scheduler and records its refusal', async () => {
  const previous = process.env.JOB_PILOTTO_E2E;
  process.env.JOB_PILOTTO_E2E = '1';
  try {
    const {backgroundWaitNow, moveBackgroundWaitClock} = await import('../lib/background-apply-clock.js');
    const readyAt = backgroundWaitNow(), record = {id: 'clock-quit', url: 'https://jobs.example.test/clock-quit', startedAt: new Date(readyAt - 1000).toISOString(), background: {}};
    let state = {session: record.id, mode: 'auto', state: 'waiting_to_submit', readyAt}, starts = 0;
    createBackgroundApplyController({}, {started: readyAt, store: {read: async () => state, interrupted: async () => (state = {...state, state: 'needs_user_handoff', reason: 'app_closed', manualOverride: true})},
      terminals: {list: () => [record], record: () => record, report: () => {}}, browser: {start: async () => { starts++; return {owner: 'owner'}; }},
      config: () => ({mode: 'auto', auto: {waitMin: 1}}), token: () => 'fictional', port: 1, notify: () => {}, log: () => {},
      reader: {takeEnded: () => []}});
    const moved = await moveBackgroundWaitClock(readyAt + 60001);
    assert.equal(starts, 1, 'the browser the quit closed is restarted without waiting for an alarm');
    assert.ok(record.background.waitDecision.at >= moved);
    assert.deepEqual([record.background.waitDecision.state, record.background.waitDecision.reason], ['needs_user_handoff', 'app_closed']);
  } finally {
    if (previous === undefined) delete process.env.JOB_PILOTTO_E2E; else process.env.JOB_PILOTTO_E2E = previous;
  }
});
