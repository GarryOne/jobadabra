// Fill now with a count (owner, 19 Oct 2026): the popup's list comes from readyTop (best fit, nothing the night holds); on the yes, readyRun({top}) makes only what the chosen jobs
// lack (kit, then CV with letter), asks before any AI spend when the send would replace waiting forms, and sends the complete ones. Fakes only: no paid model, no site.
import test from 'node:test';
import assert from 'node:assert/strict';

test('readyTop lists the best jobs and their cost; readyRun({top}) prepares what is missing, then sends and starts', async () => {
  const {registerReadyHandlers} = await import('../lib/ready-handlers.js');
  const {useKeychainReader} = await import('../lib/ready-site.js');
  const {nightOf} = await import('../lib/ready-batch.js');
  useKeychainReader(() => null);
  const done = {kit: true, tailored: true, letter: true};
  const row = (code, fit, extra = {}) => ({code, url: `https://boards.example.com/${code}`, title: `Job ${code}`, company: 'Acme', status: 'unreviewed', fit, ...extra});
  let list = [row('a', 90, done), row('b', 80), row('c', 70, {kit: true}), row('d', 65), row('held', 95, done)];
  let night = {ok: true, batch: null, jobs: [{job: 'held', state: 'prepared'}]};
  const sent = [], made = [], kept = {};
  const answer = (body, status = 200) => new Response(JSON.stringify(body), {status});
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const route = new URL(url).pathname;
    if (route.endsWith('/ready/state')) return answer(night);
    if (route.endsWith('/ready/batch')) { const jobs = JSON.parse(init.body).jobs.map(job => job.id); sent.push(['batch', jobs]); return answer({ok: true, queued: jobs.length}); }
    if (route.endsWith('/ready/run')) { sent.push(['run']); return answer({ok: true, batch: 'b1'}, 202); }
    return answer({ok: true});
  };
  const prepare = {
    kit: async code => { made.push(['kit', code]); list = list.map(job => job.code === code ? {...job, kit: true} : job); return {ok: code !== 'd'}; },
    cv: async code => { made.push(['cv', code]); list = list.map(job => job.code === code ? {...job, tailored: true, letter: true} : job); return {ok: true}; }};
  const handlers = {}, ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  const storage = {secret: name => (/TRIAL/.test(name) ? 'JPF1.install.token' : ''), settings: () => kept, saveSettings: patch => Object.assign(kept, patch), path: name => `/nowhere/${name}`};
  try {
    registerReadyHandlers({ipcMain, storage, prepare, deps: {jobs: async () => list, store: {findJob: async () => ({id: 1}), kit: async () => ({answers: [], cover_letter: 'Dear Acme'})},
      me: async () => ({contact: {name: 'Alex Example'}, resume: {data: 'JVBERi0='}}), facts: async () => ({})}});
    const top = await handlers.readyTop({}, {});
    assert.deepEqual(top.picked.map(job => job.code), ['a', 'b', 'c', 'd'], 'best fit first; the form the night holds is left out');
    assert.deepEqual(top.chips, [1, 3, 5, 10]);
    assert.match(top.lines[1], /nothing to prepare/);
    assert.match(top.lines[3], /^3 jobs: prepare 1 kit \+ 2 CVs with letters\.$/);
    for (const line of Object.values(top.lines)) assert.doesNotMatch(line, /undefined|NaN/);

    night = {ok: true, batch: {night: nightOf().night, state: 'finished'}, jobs: [{job: 'held', state: 'prepared'}]};
    const replace = await handlers.readyRun({}, {top: ['a', 'b']});
    assert.equal(replace.ask.replaces, 1, 'asks before any AI spend');
    assert.deepEqual(made, [], 'nothing was made before the yes');

    made.length = 0; sent.length = 0; night = {ok: true, batch: null, jobs: []};
    list = [row('a', 90, done), row('b', 80), row('c', 70, {kit: true}), row('d', 65)];
    const run = await handlers.readyRun({}, {top: ['a', 'b', 'c', 'd']});
    assert.equal(run.ok, true, JSON.stringify(run));
    assert.deepEqual(made, [['kit', 'b'], ['cv', 'b'], ['cv', 'c'], ['kit', 'd']], 'the kit first, then the CV with its letter; a finished job is left alone; a failed kit stops that job');
    assert.deepEqual(sent, [['batch', ['a', 'b', 'c']], ['run']], 'the complete jobs only, best first');
    assert.equal(run.failed.length, 1);

    list = [row('d', 65)]; made.length = 0; sent.length = 0;
    const none = await handlers.readyRun({}, {top: ['d']});
    assert.equal(none.ok, false); assert.match(none.error, /Nothing could be prepared/); assert.deepEqual(sent, []);
  } finally { globalThis.fetch = realFetch; }
});
