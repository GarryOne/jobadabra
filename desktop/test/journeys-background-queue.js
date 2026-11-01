// Journey (#2646): Background queues two jobs; the first is a multi-step form, and the second waits until the first leaves its middle step. Real store and controller.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyStore} from '../lib/background-apply-store.js';
import {createBackgroundApplyController} from '../lib/background-apply-controller.js';

// One in-memory store behind the real store interface: two Applications rows with ready kits.
function rig() {
  const apps = new Map(), sections = new Map(), events = [], records = new Map();
  for (const name of ['multi', 'single']) {
    const app = {id: `app-${name}`, url: `https://jobs.example.test/${name}`, stage: 'Kit ready', fit: 90, company: 'Fictional Cloud'};
    apps.set(app.url, app);
    sections.set(`${app.id}:📝 Application kit`, '```json\n{"eligible":true,"answers":[]}\n```');
  }
  const call = async (_storage, entity, method, args) => {
    if (entity === 'applications' && method === 'get') return apps.get(args.url) || null;
    if (entity === 'applications' && method === 'section') return sections.get(`${args.app_id}:${args.name}`) || '';
    if (entity === 'applications' && method === 'set_section') { sections.set(`${args.app_id}:${args.name}`, args.markdown); return null; }
    if (entity === 'events' && method === 'list') return events;
    if (entity === 'events' && method === 'add') { events.push(args); return args; }
    throw new Error(`unexpected ${entity}.${method}`);
  };
  let time = 1000, ids = 0;
  const store = createBackgroundApplyStore({}, {call, now: () => time, realNow: () => time, uuid: () => 'attempt'});
  const terminals = {list: () => [...records.values()], byUrl: () => null, record: id => records.get(id), report: () => {}, startForm: item => {
    const record = {...item, startedAt: new Date(time).toISOString()}; records.set(item.id, record); return record;
  }};
  const controller = createBackgroundApplyController({}, {store, now: () => time, started: 0, config: () => ({mode: 'fill', chosenAt: 'chosen'}), uuid: () => `session${++ids}`, terminals,
    browser: {ready: () => true, start: async () => ({owner: 'owner'})}, stop: () => false, reader: {busy: () => false, take: () => null, takeEnded: () => []},
    port: 1, token: () => 'fictional', notify: () => {}, log: () => {}});
  const poll = async () => (await controller.handle({action: 'poll', owner: 'owner'})).jobs.map(job => job.session);
  const report = async (session, step, page) => {
    time += 1000;
    const proof = await controller.judgment({background: {owner: 'owner', session}, sketch: {page}}, {answer: 'ready', step, submitControl: step === 'final' ? 'Send' : '', confidence: 1, botCheck: false});
    return controller.handle({action: 'ready', owner: 'owner', session, ...proof, requiredComplete: true, safe: true, factsOnly: true});
  };
  return {apps: [...apps.values()], controller, poll, report};
}

test('journey: Background fills a multi-step form to the end before it starts the next queued job (#2646)', async () => {
  const {apps, controller, poll, report} = rig();
  const queued = await controller.enqueue(apps, 'fill');
  assert.deepEqual(queued.sessions, ['session1', 'session2']);
  assert.deepEqual(await poll(), ['session1'], 'the first job starts alone');
  const middle = await report('session1', 'middle', 'step 1 of 2');
  assert.equal(middle.continue, true, 'the form passed its middle step and goes on filling');
  assert.deepEqual(await poll(), [], 'while the first form is still filling, the second job waits');
  const done = await report('session1', 'final', 'step 2 of 2');
  assert.equal(done.review, true, 'the first form is filled and waits for the person');
  assert.deepEqual(await poll(), ['session2'], 'then the second job starts');
});
