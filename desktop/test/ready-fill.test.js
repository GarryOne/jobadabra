// Ready to send, the container's pure parts (hosted/ready-fill/): the extension copy holds the account button and points at the stand-in, the stand-in answers from the batch only, a submit is refused,
// the live view lets only mouse and keys through, and the outcome words are the server's. The browser run itself is desktop/e2e/ready-fill-proof.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ACCOUNT_PRESS, copyForNight, holdAccountPress} from '../../hosted/ready-fill/extension-copy.mjs';
import {CLOSED_NEED, classify, fillJob} from '../../hosted/ready-fill/fill-job.mjs';
import {formUrl} from '../lib/form-address.js';
import {inputToCdp} from '../../hosted/ready-fill/live.mjs';
import {costMicro, sendVideo} from '../../hosted/ready-fill/night.mjs';
import {looksLikeSubmit} from '../../hosted/ready-fill/no-submit.mjs';
import {createStandIn} from '../../hosted/ready-fill/stand-in.mjs';

const EXTENSION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension');

test('the night copy holds the account press, points at the stand-in and leaves extension/ alone', () => {
  const before = fs.readFileSync(path.join(EXTENSION, 'account-step.js'), 'utf8');
  assert.ok(before.includes(ACCOUNT_PRESS), 'extension/account-step.js still has the press line this copy holds: if it moved, update hosted/ready-fill/extension-copy.mjs');
  const copy = copyForNight(41234, EXTENSION);
  try {
    const held = fs.readFileSync(path.join(copy, 'account-step.js'), 'utf8');
    assert.ok(held.includes('if (false && move === \'fill-press\''), 'the account button is never pressed');
    assert.ok(held.includes('HELD for the night'));
    assert.ok(fs.readFileSync(path.join(copy, 'flow.js'), 'utf8').includes('http://127.0.0.1:41234'));
    for (const file of fs.readdirSync(copy).filter(name => name.endsWith('.js'))) assert.ok(!fs.readFileSync(path.join(copy, file), 'utf8').includes('127.0.0.1:47111'), file);
    assert.ok(JSON.parse(fs.readFileSync(path.join(copy, 'manifest.json'), 'utf8')).host_permissions.includes('https://*/*'));
  } finally { fs.rmSync(path.dirname(copy), {recursive: true, force: true}); }
  assert.equal(fs.readFileSync(path.join(EXTENSION, 'account-step.js'), 'utf8'), before);   // the source is untouched
  assert.throws(() => holdAccountPress('no press line here'), /no longer contains the press guard/);
});

test('an app on the default port 47111 gets its copy too, owned or not (owner, 28 Oct 2026: "the night\'s extension still mentions 127.0.0.1:47111 in flow.js")', () => {
  for (const owned of [false, true]) {
    const copy = copyForNight(47111, EXTENSION, '', {owned});
    try {
      assert.ok(fs.readFileSync(path.join(copy, 'flow.js'), 'utf8').includes('http://127.0.0.1:47111'), 'the copy still talks to the app\'s own port');
      assert.equal(fs.existsSync(path.join(copy, 'owned-bootstrap.js')), owned);
    } finally { fs.rmSync(path.dirname(copy), {recursive: true, force: true}); }
  }
});

test('a submit is refused and an upload is not', () => {
  assert.equal(looksLikeSubmit({method: 'POST', url: 'https://jobs.example.com/anything', navigation: true}), true);   // a form submission that navigates
  assert.equal(looksLikeSubmit({method: 'POST', url: 'https://boards-api.example.com/v1/boards/acme/jobs/1/applications', navigation: false}), true);
  assert.equal(looksLikeSubmit({method: 'PUT', url: 'https://x.example.com/api/submit', navigation: false}), true);
  assert.equal(looksLikeSubmit({method: 'POST', url: 'https://uploads.example.com/cv', navigation: false}), false);   // a CV upload on choice: the fill needs it
  assert.equal(looksLikeSubmit({method: 'GET', url: 'https://x.example.com/apply', navigation: true}), false);
});

test('the stand-in answers from the batch by the job address and keeps only counts', async () => {
  const batch = {contact: {first_name: 'Ada'}, jobs: [{id: 'j1', url: 'https://boards.example.com/a/1', title: 'SRE', company: 'Acme', kit: {answers: [{field: 'q1', answer: '8'}]}, cv: 'Q1ZCQVNF', letterPdf: 'TEVUVEVS'},
    {id: 'j2', url: 'https://jobs.example.org/p/2', title: 'Dev', company: 'Nord', kit: null, cv: '', letterPdf: ''}]};
  const app = await createStandIn(batch);
  const call = async (route, init = {}) => (await fetch(`http://127.0.0.1:${app.port}${route}`, init)).json();
  try {
    const me = await call(`/extension/me?url=${encodeURIComponent('https://boards.example.com/a/1#jobpilotto-fill')}`);
    assert.equal(me.contact.first_name, 'Ada'); assert.equal(me.resume.data, 'Q1ZCQVNF'); assert.equal(me.coverLetterFile.data, 'TEVUVEVS');
    assert.equal((await call(`/extension/me?url=${encodeURIComponent('https://jobs.example.org/p/2')}`)).resume, undefined);   // no CV for this job: none invented
    assert.equal((await call(`/extension/kit?url=${encodeURIComponent('https://boards.example.com/a/1')}`)).kit.answers[0].answer, '8');
    assert.equal((await call(`/extension/kit?url=${encodeURIComponent('https://elsewhere.example.com/x')}`)).error, 'not tracked');
    assert.deepEqual(await call('/extension/aliases', {method: 'POST', body: '{}'}), {});   // no Notion, no learned notes, no password: every other call is empty
    assert.deepEqual(await call('/extension/site-password', {method: 'POST', body: '{}'}), {});
    assert.equal(app.outcome('https://boards.example.com/a/1'), null);
    await call('/extension/review', {method: 'POST', body: JSON.stringify({url: 'https://boards.example.com/a/1', role: 'form'})});
    await call('/extension/run', {method: 'POST', body: JSON.stringify({url: 'https://boards.example.com/a/1#x', fields: 9, unfilled: 2, usd: 0.01, trace: [{label: 'secret value row'}]})});
    assert.deepEqual(app.outcome('https://boards.example.com/a/1'), {filled: 9, left: 2, role: 'form', usd: 0.01});   // counts and the role, not the trace
    // a second pass fills only what the first left: its count adds, its "left" is the final state; an update restates the last pass
    await call('/extension/event', {method: 'POST', body: JSON.stringify({type: 'fill-started', url: 'https://boards.example.com/a/1'})});
    assert.equal(app.started('https://boards.example.com/a/1'), 1);
    await call('/extension/run', {method: 'POST', body: JSON.stringify({url: 'https://boards.example.com/a/1', fields: 1, unfilled: 1})});
    assert.deepEqual(app.outcome('https://boards.example.com/a/1'), {filled: 10, left: 1, role: 'form', usd: 0.01});
    await call('/extension/run', {method: 'POST', body: JSON.stringify({url: 'https://boards.example.com/a/1', fields: 2, unfilled: 0, update: 'night-run'})});
    assert.deepEqual(app.outcome('https://boards.example.com/a/1'), {filled: 11, left: 0, role: 'form', usd: 0.01});
    assert.deepEqual(await call('/extension/answer', {method: 'POST', body: '{}'}), {answers: [], usd: 0});   // the fill reads answers.filter: an empty list, never undefined
  } finally { await app.close(); }
});

// 18 Oct 2026, first real night: an Ashby posting was opened as its posting page, the form sat behind it, and nothing was filled ("no form").
// The night opens a job the way the app's Apply does (lib/form-address.js formUrl), and every report from the job's form or a page below its
// posting (Apply pressed, the next step) counts for that job: CV, kit, fill record, start and role.
const POSTING = 'https://jobs.ashbyhq.com/acme/00000000-0000-4000-8000-000000000001';
test('the night opens the form the app would open, and the form\'s reports count for its job', async () => {
  const batch = {contact: {first_name: 'Ada'}, jobs: [{id: 'j1', url: POSTING, title: 'SRE', company: 'Acme', kit: {answers: []}, cv: 'Q1ZCQVNF', letterPdf: ''}]};
  const app = await createStandIn(batch);
  const call = async (route, init = {}) => (await fetch(`http://127.0.0.1:${app.port}${route}`, init)).json();
  try {
    for (const page of [formUrl(POSTING), `${POSTING}/application/step-2`]) {
      assert.equal((await call(`/extension/me?url=${encodeURIComponent(`${page}#jobpilotto-fill`)}`)).resume.data, 'Q1ZCQVNF', page);
      assert.ok((await call(`/extension/kit?url=${encodeURIComponent(page)}`)).kit, page);
    }
    await call('/extension/event', {method: 'POST', body: JSON.stringify({type: 'fill-started', url: formUrl(POSTING)})});
    await call('/extension/review', {method: 'POST', body: JSON.stringify({url: formUrl(POSTING), role: 'form'})});
    await call('/extension/run', {method: 'POST', body: JSON.stringify({url: `${formUrl(POSTING)}#x`, fields: 7, unfilled: 1})});
    assert.equal(app.started(POSTING), 1);
    assert.deepEqual(app.outcome(POSTING), {filled: 7, left: 1, role: 'form', usd: 0});
    assert.equal((await call(`/extension/kit?url=${encodeURIComponent('https://jobs.ashbyhq.com/acme/00000000-0000-4000-8000-000000000002')}`)).error, 'not tracked', 'another job at the same company is not this one');
  } finally { await app.close(); }
  const opened = [];
  const page = {goto: async url => { opened.push(url); }, evaluate: async () => false, waitForFunction: async () => {}};
  const standIn = {started: () => 1, outcome: () => ({filled: 7, left: 0}), role: () => 'form'};
  const recorded = [], video = {path: '/tmp/x.webm', bytes: 10, secs: 4};
  const record = tab => { recorded.push(opened.length); return {stop: async () => (recorded.push('stopped'), video)}; };   // Watch the fill: from before the page loads to the outcome
  const result = await fillJob({context: {newPage: async () => page}, standIn, job: {id: 'j1', url: POSTING}, fillSeconds: 1, record});
  assert.deepEqual(opened, [formUrl(POSTING)]);
  assert.deepEqual(recorded, [0, 'stopped'], 'the video starts before the page is opened and stops once the outcome is read');
  assert.equal(result.video, video);
  assert.notEqual(formUrl(POSTING), POSTING, 'the case is one where the form lives elsewhere');
  assert.equal(result.state, 'prepared');
});

test('the outcome words: prepared needs a fill with nothing required left; an account page is a wall; no panel is no form', () => {
  assert.deepEqual(classify({outcome: {filled: 9, left: 0, role: 'form'}, panel: true}), {state: 'prepared', wall: ''});
  assert.deepEqual(classify({outcome: {filled: 9, left: 2, role: 'form'}, panel: true}), {state: 'partial', wall: ''});
  assert.deepEqual(classify({outcome: {filled: 4, left: 0, role: 'account'}, panel: true}), {state: 'wall', wall: 'account'});
  assert.deepEqual(classify({outcome: {filled: 0, left: 0, role: 'form'}, panel: true}), {state: 'no-form', wall: ''});
  assert.deepEqual(classify({outcome: null, panel: false, role: ''}), {state: 'no-form', wall: ''});
  assert.deepEqual(classify({outcome: null, panel: false, role: 'account'}), {state: 'wall', wall: 'account'});
  assert.deepEqual(classify({outcome: null, panel: true, role: 'form'}), {state: 'failed', wall: 'no-record'});
});

test('a closed posting is "closed" in the night, not "no form": the extension\'s fixed sentence, only when nothing was filled', async () => {
  const {brokenNeed} = await import('../../extension/ladder/site-broken.js');
  for (const need of [brokenNeed('closed', 200), brokenNeed('gone', 404)]) {
    assert.match(need, CLOSED_NEED);
    assert.deepEqual(classify({outcome: null, panel: false, role: '', stuck: {why: 'site_broken', needs: need}}), {state: 'closed', wall: ''});
  }
  assert.doesNotMatch(brokenNeed('error', 503), CLOSED_NEED);
  assert.deepEqual(classify({outcome: null, panel: false, role: '', stuck: {why: 'site_broken', needs: brokenNeed('error', 503)}}), {state: 'no-form', wall: ''});
  assert.deepEqual(classify({outcome: {filled: 5, left: 0, role: 'form'}, panel: true, stuck: {why: 'site_broken', needs: brokenNeed('closed', 200)}}), {state: 'prepared', wall: ''});
});

test('the live view lets only mouse and keys through to the browser', () => {
  assert.deepEqual(inputToCdp({t: 'mouse', type: 'mousePressed', x: 10, y: 20, button: 'left', clickCount: 1, buttons: 1})[0], 'Input.dispatchMouseEvent');
  assert.equal(inputToCdp({t: 'key', key: 'a', text: 'a'})[0], 'Input.dispatchKeyEvent');
  for (const bad of [{t: 'eval', code: 'location="x"'}, {t: 'mouse', type: 'drag'}, {t: 'key', key: 'x'.repeat(40)}, {t: 'navigate', url: 'https://x.test'}, null]) assert.equal(inputToCdp(bad), null, JSON.stringify(bad));
});

test('a job costs its seconds of container plus the AI the extension reported', () => {
  assert.equal(costMicro(80000), 960);   // 80 s at ≈ $0.000012 a second
  assert.equal(costMicro(0, 0.031), 31000);
  assert.equal(costMicro(undefined, undefined), 0);
});

test('a fresh extension worker is written only once chrome.storage exists, and every caller goes through that one wait', async () => {
  const {setExtensionStorage} = await import('../../hosted/ready-fill/extension-storage.mjs');
  const saved = {}, worker = {evaluate: async (fn, arg) => fn(arg)};   // runs "in the worker": here, this process's globalThis
  const before = globalThis.chrome;
  try {
    delete globalThis.chrome;
    setTimeout(() => { globalThis.chrome = {storage: {local: {set: async values => Object.assign(saved, values)}}}; }, 150);   // the API appears late, as in the container
    await setExtensionStorage(worker, {workerUrl: 'http://127.0.0.1:5', token: 'night'});
    assert.deepEqual(saved, {workerUrl: 'http://127.0.0.1:5', token: 'night'});
    delete globalThis.chrome;
    await assert.rejects(setExtensionStorage(worker, {a: 1}, 100), /did not appear/);
  } finally { globalThis.chrome = before; if (before === undefined) delete globalThis.chrome; }
  const root = fileURLToPath(new URL('../../', import.meta.url));   // the class: no direct chrome.storage write through a worker's evaluate
  for (const dir of ['hosted/ready-fill', 'desktop/e2e/lib', 'desktop/e2e']) for (const file of fs.readdirSync(root + dir).filter(f => f.endsWith('.mjs') && f !== 'extension-storage.mjs')) {
    assert.ok(!/evaluate\([^\n]*chrome\.storage\.local\.set/.test(fs.readFileSync(`${root}${dir}/${file}`, 'utf8')), `${dir}/${file}: use setExtensionStorage (the API is missing right after start)`);
  }
});

test('a night that cannot start tells the site each job failed and why, at once, instead of leaving them "waiting", and leaves nothing open', {timeout: 20000}, async () => {
  const {runNight, NIGHT_FAILED} = await import('../../hosted/ready-fill/night.mjs');
  const posts = [];
  const fetchImpl = async (url, options) => {
    const route = url.split('/api/ready/')[1], body = options.body ? JSON.parse(options.body) : null;
    posts.push({route, body});
    return {json: async () => route === 'batch' ? {ok: true, jobs: [{id: 'a', url: 'https://boards.example.com/1', kit: {}}, {id: 'b', url: 'https://boards.example.com/2', kit: {}}], facts: {}} : {ok: true}};
  };
  const chromium = {launchPersistentContext: async () => { throw new Error('browser could not start at https://secret.example.com/x'); }};
  await assert.rejects(runNight({chromium, site: 'https://site.example', token: 't', fetchImpl}), /browser could not start/);
  const results = posts.filter(p => p.route === 'result').map(p => p.body);
  assert.deepEqual(results.map(r => [r.job, r.state, r.wall]), [['a', 'failed', NIGHT_FAILED], ['b', 'failed', NIGHT_FAILED]]);
});

test('a fill\'s video goes to the site with the night token, and its file is gone after (Watch the fill)', async () => {
  const os_ = await import('node:os'), file = path.join(fs.mkdtempSync(path.join(os_.tmpdir(), 'jp-video-')), 'fill.webm'), calls = [];
  fs.writeFileSync(file, Buffer.from('webm'));
  const fetchImpl = async (url, init) => { calls.push({url, method: init.method, auth: init.headers.authorization, type: init.headers['content-type'], body: String(init.body)}); return {status: 200}; };
  assert.equal(await sendVideo(fetchImpl, 'https://site.example', 'RR1.b.t', 'j 1', {path: file, bytes: 4, secs: 7}), 200);
  assert.deepEqual(calls, [{url: 'https://site.example/api/ready/video?job=j%201&secs=7', method: 'PUT', auth: 'Bearer RR1.b.t', type: 'video/webm', body: 'webm'}]);
  assert.equal(fs.existsSync(file), false, 'nothing kept in the container');
  assert.equal(await sendVideo(fetchImpl, 'https://site.example', 't', 'j1', null), 0, 'no video, no call');
  fs.writeFileSync(file, 'x');
  assert.equal(await sendVideo(async () => { throw new Error('down'); }, 'https://site.example', 't', 'j1', {path: file, secs: 1}), 0, 'a failed upload loses only the video');
  assert.equal(fs.existsSync(file), false);
});

// Open in my browser after the container is gone (owner, 18 Oct 2026: "Yes, sealed, 24 h max"): each held form's hand-off goes to the site, sealed there; the job's log line keeps only the upload's status.
test('a held form\'s hand-off goes to the site with the night token; the job log never carries it', async () => {
  const {sendHandoff, jobLine} = await import('../../hosted/ready-fill/night.mjs');
  const given = {url: 'https://boards.example.com/apply', storage: {cookies: [{name: 'sid', value: 'cookiesecret'}], origins: []}, sessionStorage: {}, snapshot: {fields: [{id: 'n', value: 'fieldsecret'}], files: []}};
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({url, method: init.method, auth: init.headers.authorization, type: init.headers['content-type'], body: JSON.parse(init.body)}); return {status: 200}; };
  assert.equal(await sendHandoff(fetchImpl, 'https://site.example', 'RR1.b.t', 'j 1', {}, async () => given), 200);
  assert.deepEqual(calls, [{url: 'https://site.example/api/ready/handoff?job=j%201', method: 'PUT', auth: 'Bearer RR1.b.t', type: 'application/json', body: {...given, night: {}}}]);
  const night = {role: 'form', answers: [{field: 'q1', label: 'Why us?', answer: {field: 'q1', value: 'Because', use: 'fill'}}]};
  await sendHandoff(fetchImpl, 'https://site.example', 't', 'j1', {}, async () => given, night);
  assert.deepEqual(calls.at(-1).body.night, night, 'the night\'s role and answers go with it, for the morning\'s Open in Chrome');
  assert.equal(await sendHandoff(fetchImpl, 'https://site.example', 't', 'j1', null, async () => given), 0, 'no held page, no call');
  assert.equal(await sendHandoff(fetchImpl, 'https://site.example', 't', 'j1', {}, async () => { throw new Error('page closed'); }), 0, 'a failed read loses only the stored copy');
  const line = JSON.stringify(jobLine({id: 'j1', done: {state: 'prepared', filled: 3, left: 0, ms: 9, video: null, page: {}}, blocked: 0, video: 0, handoff: 200}));
  assert.deepEqual(JSON.parse(line), {id: 'j1', state: 'prepared', filled: 3, left: 0, ms: 9, blocked: 0, video: null, handoff: 200});
  for (const word of ['cookiesecret', 'fieldsecret', 'boards.example.com']) assert.ok(!line.includes(word), word);
});

// A container with no night in it (a fresh one the site woke after a deploy, or one already closed) says "gone", so the runner stops it and the app says to press Fill now.
test('a container holding no night answers gone; a running or finished night does not', async () => {
  const {gone} = await import('../../hosted/ready-fill/night.mjs');
  assert.equal(gone(null, {state: 'idle'}), true);
  assert.equal(gone(null, {state: 'running'}), false);
  assert.equal(gone(null, {state: 'failed'}), false, 'a failed night still says why on /state');
  assert.equal(gone({held: new Map()}, {state: 'held'}), false);
});
