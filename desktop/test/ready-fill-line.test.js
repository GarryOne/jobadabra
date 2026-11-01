// The night's forms in a line, in the container (desktop/ready-fill/night.mjs; owner, 18 Oct 2026: one server, forms in a line, a live line and Stop per row):
// the site is faked at fetch and the browser by a small stand-in (no Chrome), so the line itself is what is tested: a form added while the night runs joins it,
// each form's steps reach the site, a form the owner stopped is dropped without a result, and the night ends when its token is refused (no orphan run).
import assert from 'node:assert/strict';
import {test} from 'node:test';

const job = id => ({id, url: `https://boards.example.com/${id}`, title: 'SRE', company: 'Acme', kit: {}, cv: '', letterPdf: ''});

// A browser whose pages report a filled form to the night's stand-in as soon as they open (the extension's record), so no fill waits.
function fakeChromium() {
  let port = 0;
  const page = () => ({
    goto: async address => {
      const post = (route, body) => fetch(`http://127.0.0.1:${port}${route}`, {method: 'POST', body: JSON.stringify(body)});
      await post('/extension/event', {type: 'fill-started', url: address}); await post('/extension/run', {url: address, fields: 5, unfilled: 0});
    },
    evaluate: async () => false, waitForFunction: async () => { throw new Error('no panel'); }, close: async () => {},
  });
  const worker = {evaluate: async (fn, values) => { if (values?.workerUrl) port = Number(new URL(values.workerUrl).port); return true; }};
  return {launchPersistentContext: async () => ({serviceWorkers: () => [worker], route: async () => {}, newPage: async () => page(), close: async () => {}})};
}

test('a form joins the running night, its steps reach the site, a stopped form sends no result, and a refused token ends the night', {timeout: 30000}, async () => {
  const {runNight} = await import('../../desktop/ready-fill/night.mjs');
  const calls = [];
  let reads = 0;
  const fetchImpl = async (url, init = {}) => {
    const route = new URL(url).pathname.replace('/api/ready/', ''), body = init.body ? JSON.parse(init.body) : null;
    calls.push([route, body?.job ?? null, body?.step ?? body?.state ?? null]);
    const answer = data => ({status: 200, json: async () => data});
    if (route === 'batch') {   // 1st read: j1; after j1: j2 joined; after j2: the night is over
      reads++;
      return reads === 1 ? answer({ok: true, night: '2026-10-18', contact: {}, facts: {}, jobs: [job('j1')]}) : reads === 2 ? answer({ok: true, line: true, jobs: [job('j2')]}) : {status: 401, json: async () => ({ok: false, error: 'unauthorized'})};
    }
    if (route === 'progress') return answer({ok: true, stop: body.job === 'j2' && body.step === 'form'});   // the owner stops j2 once its page is open
    if (route === 'result') return answer({ok: true, stop: false});
    return answer({ok: true});
  };
  const night = await runNight({chromium: fakeChromium(), site: 'https://site.example', token: 't', fetchImpl, fillSeconds: 2, record: () => null});
  const of = id => calls.filter(([, job]) => job === id);
  assert.deepEqual(of('j1').filter(([route]) => route === 'progress').map(([, , step]) => step), ['opening', 'form', 'reading'], 'j1\'s live line');
  assert.deepEqual(of('j1').filter(([route]) => route === 'result').map(([, , state]) => state), ['prepared'], 'j1 filled and told once');
  assert.deepEqual(of('j2').map(([route, , step]) => `${route}:${step}`), ['progress:opening', 'progress:form'], 'j2 joined the line, was stopped at its page, and sent no result');
  assert.equal(reads, 3, 'the night was read again after each form, and ended when its token was refused');
  assert.deepEqual([...night.held.keys()], ['j1'], 'only the filled form is held for the morning');
  await night.close();
});

test('a site from before the line (it returns every form, not only those waiting) ends the night after its first list, never refilling the same form', {timeout: 20000}, async () => {
  const {runNight} = await import('../../desktop/ready-fill/night.mjs');
  const results = [];
  const fetchImpl = async (url, init = {}) => {
    const route = new URL(url).pathname.replace('/api/ready/', ''), body = init.body ? JSON.parse(init.body) : null;
    if (route === 'result') results.push(body.job);
    return {status: 200, json: async () => (route === 'batch' ? {ok: true, night: '2026-10-18', contact: {}, facts: {}, jobs: [job('j1')]} : {ok: true, stop: false})};
  };
  const night = await runNight({chromium: fakeChromium(), site: 'https://site.example', token: 't', fetchImpl, fillSeconds: 2, record: () => null});
  assert.deepEqual(results, ['j1'], 'the form is filled once');
  await night.close();
});

test('the container fills each press of a form once: a stale list fills nothing more, a Fill again (its turn counted up) fills it again', {timeout: 30000}, async () => {
  const {runNight, pressOf} = await import('../../desktop/ready-fill/night.mjs');
  assert.equal(pressOf({id: 'j1'}), 'j1:0');
  const results = [];
  let reads = 0;
  const fetchImpl = async (url, init = {}) => {
    const route = new URL(url).pathname.replace('/api/ready/', ''), body = init.body ? JSON.parse(init.body) : null;
    if (route === 'result') results.push(body.job);
    if (route !== 'batch') return {status: 200, json: async () => ({ok: true, stop: false})};
    reads += 1;   // read 1: the night; 2: j1 stale (same turn) + j2 joins; 3: the owner's Fill again of j1 (turn 1); then stale for ever
    const jobs = reads === 1 ? [job('j1')] : reads === 2 ? [job('j1'), job('j2')] : reads === 3 ? [{...job('j1'), turn: 1}] : [{...job('j1'), turn: 1}, job('j2')];
    return {status: 200, json: async () => ({ok: true, line: true, night: '2026-10-18', contact: {}, facts: {}, jobs})};
  };
  const night = await runNight({chromium: fakeChromium(), site: 'https://site.example', token: 't', fetchImpl, fillSeconds: 2, record: () => null});
  assert.deepEqual(results, ['j1', 'j2', 'j1'], 'one fill per press; the stale answers fill nothing, the night ends');
  await night.close();
});

test('the live line goes to the site when the step changes or every 10 s; a stop or a refused token says stop', async () => {
  const {stepper} = await import('../../desktop/ready-fill/night.mjs');
  let clock = 0, reply = {ok: true, stop: false};
  const sent = [];
  const step = stepper({fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return {json: async () => reply}; }, site: 'https://s', token: 't', job: 'j1', now: () => clock});
  assert.equal(await step('filling'), false);
  assert.equal(await step('filling'), false);
  clock = 11000; await step('filling');
  await step('answering', 2);
  assert.deepEqual(sent, [{job: 'j1', step: 'filling'}, {job: 'j1', step: 'filling'}, {job: 'j1', step: 'answering', n: 2}], 'the same step twice within 10 s is sent once');
  reply = {ok: true, stop: true}; assert.equal(await step('reading'), true, 'stopped by the owner');
  reply = {ok: false, error: 'unauthorized'}; assert.equal(await step('opening'), true, 'the night is over');
});
