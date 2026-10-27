// Hosted Always on in the app (lib/hosted-search.js, lib/hosted-handlers.js, renderer/pages/hosted.js): the calls to the site with the install key, the config it pushes, the inbox merge,
// delete on turn off, and the wizard step's place and words.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {config, exportTo, pullInbox, pushConfig, state, turnOff, turnOn} from '../lib/hosted-search.js';

const FREE = 'JPF1.install-0001.tok';
function store(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-hosted-')), mine = {...settings};
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'search.json'), JSON.stringify({role_keywords: ['sre']}));
  fs.writeFileSync(path.join(dir, 'profile.md'), 'My profile');
  return {dir, settings: () => mine, saveSettings: patch => Object.assign(mine, patch), secret: name => (name === 'ANTHROPIC_API_KEY' ? FREE : ''), setSecret() {}, path: name => path.join(dir, name)};
}
function site(routes) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const route = new URL(url).pathname, key = `${init.method || 'GET'} ${route}`;
    calls.push({key, key_header: init.headers?.['x-api-key'], body: init.body && JSON.parse(init.body)});
    const answer = routes[key];
    return answer ? Response.json(answer.body ?? answer, {status: answer.status || 200}) : Response.json({ok: false, error: 'no route'}, {status: 404});
  };
  return {calls, fetcher};
}

test('turning on sends the e-mail, the news box and the profile with the install key, and remembers it', async () => {
  const st = store(), s = site({'PUT /api/hosted/schedule': {ok: true}, 'PUT /api/hosted/config': {ok: true}});
  assert.deepEqual(await turnOn(st, {email: 'bad'}, {fetcher: s.fetcher}), {ok: false, error: 'Enter an email address like you@example.com.'});
  assert.deepEqual(await turnOn(st, {email: ' A@Example.com ', marketing: true}, {fetcher: s.fetcher}), {ok: true});
  assert.deepEqual(s.calls.map(c => c.key), ['PUT /api/hosted/schedule', 'PUT /api/hosted/config']);
  assert.deepEqual(s.calls[0].body, {on: true, email: 'A@Example.com', marketing: true});
  assert.deepEqual(s.calls[1].body, {search: {role_keywords: ['sre']}, profile: 'My profile', cv: ''});
  assert.ok(s.calls.every(c => c.key_header === FREE));
  assert.deepEqual([state(st).on, state(st).email, state(st).marketing], [true, 'A@Example.com', true]);
});

test('the site refusing leaves it off with the site\'s own words', async () => {
  const st = store(), s = site({'PUT /api/hosted/schedule': {status: 409, body: {ok: false, error: 'This device belongs to another account.'}}});
  assert.deepEqual(await turnOn(st, {email: 'a@example.com'}, {fetcher: s.fetcher}), {ok: false, status: 409, error: 'This device belongs to another account.'});
  assert.equal(state(st).on, false);
});

test('turning off deletes what the server holds, then stops the schedule', async () => {
  const st = store({hostedSearch: {on: true, email: 'a@example.com', after: 9}}), s = site({'DELETE /api/hosted/data': {ok: true, receipt: {objects: 2}}, 'PUT /api/hosted/schedule': {ok: true}});
  const done = await turnOff(st, {fetcher: s.fetcher});
  assert.deepEqual(s.calls.map(c => c.key), ['DELETE /api/hosted/data', 'PUT /api/hosted/schedule']);
  assert.deepEqual([done.ok, state(st).on, state(st).after], [true, false, 0]);
});

test('turning off what was never on makes no call (Skip in the wizard, and e2e, never reach the site)', async () => {
  const s = site({});
  assert.deepEqual(await turnOff(store(), {fetcher: s.fetcher}), {ok: true, receipt: null});
  assert.deepEqual(s.calls, []);
});

test('the inbox goes to the engine\'s merge and the app remembers how far it read', async () => {
  const st = store({hostedSearch: {on: true, email: 'a@example.com', after: 4}});
  const s = site({'GET /api/hosted/inbox': {ok: true, matches: [{id: 5, job: 'j', title: 'T', url: 'https://a/1'}, {id: 7, job: 'k', title: 'U', url: 'https://a/2'}]}});
  const ran = [];
  const done = await pullInbox(st, async args => { ran.push([...args]); assert.deepEqual(JSON.parse(fs.readFileSync(args[3], 'utf8')).map(m => m.id), [5, 7]); return {code: 0, stdout: 'hosted merge: 2 new matches added'}; }, {fetcher: s.fetcher});
  assert.deepEqual([done.ok, done.added, state(st).after], [true, 2, 7]);
  assert.deepEqual(ran[0].slice(0, 3), ['src', 'hosted', '--merge']);
  assert.equal(s.calls[0].key, 'GET /api/hosted/inbox');
  assert.deepEqual(await pullInbox(store(), async () => { throw new Error('never'); }, {fetcher: s.fetcher}), {ok: true, added: 0});   // off: no call at all
});

test('without a regular install key nothing is sent, and export writes the data to the chosen file', async () => {
  const none = {...store(), secret: () => ''};
  assert.equal((await pushConfig(none, {fetcher: async () => { throw new Error('never'); }})).ok, false);
  const st = store({hostedSearch: {on: true}}), s = site({'GET /api/hosted/export': {ok: true, inbox: [{title: 'T'}], config: null, stateTgzBase64: null}});
  const file = path.join(st.dir, 'out.json');
  assert.deepEqual(await exportTo(st, file, {fetcher: s.fetcher}), {ok: true, file});
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).inbox, [{title: 'T'}]);
  assert.deepEqual(config(st).profile, 'My profile');
});

test('the wizard step sits after the strategy and before the extras; its words follow the owner\'s wording and never name GitHub or dollars', () => {
  const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.match(read('renderer/pages/core.js'), /'draft', 'letter', 'hosted', 'extras'/);
  assert.match(read('renderer/pages/strategy-review.js'), /else goStep\('letter'\)/);
  const view = read('renderer/pages/hosted.js');
  assert.match(view, /New matching jobs every morning, even when your Mac is off/);
  assert.match(view, /Search for me every day/);   // the wizard's own switch label (owner's wording)
  assert.match(view + fs.readFileSync(new URL('../renderer/hosted-words.js', import.meta.url), 'utf8'), /Also send me product news and the Pro launch offer \(unsubscribe in one click\)/);
  assert.match(fs.readFileSync(new URL('../renderer/hosted-words.js', import.meta.url), 'utf8'), /Your profile is stored encrypted on our servers\. Turn it off anytime = deleted\./);
  assert.match(view, /switchRow\('hosted-news', NEWS, true/);   // pre-checked (owner, 16 Oct 2026; a lawyer checks before launch)
  assert.doesNotMatch(view.replace(/\/\/.*$/gm, ''), /GitHub|container|\$\d/);
  assert.equal([...read('renderer/index.html').matchAll(/Step \d of 5/g)].length, 4);
});
