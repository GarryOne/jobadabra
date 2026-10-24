// "I have Pro" in the app (lib/plan.js signin, renderer/pages/plan-signin.js, IPC planSignin, the ⌘K entry): the code steps reach the site with this install's key, a verified code refreshes
// the plan, a full account lists its computers, and nothing is available while the plan is off. Fake site only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {createPlan} from '../lib/plan.js';
import {SHOW_I_HAVE_PRO, signinWords} from '../renderer/plan-view.js';

const storage = () => { let s = {}; return {settings: () => s, saveSettings: p => { s = {...s, ...p}; }, secret: () => '', setSecret() {}}; };
const site = (calls, reply) => async (url, init = {}) => {
  if (String(url).endsWith('/install-token')) return Response.json({ok: true, token: 'tok'});
  calls.push([String(url).replace(/^.*\/api/, ''), init.method, JSON.parse(init.body || '{}'), init.headers?.['x-api-key']?.startsWith('JPF1.')]);
  return reply(String(url));
};

test('start and verify go to the site with the install key; a verified code refreshes the plan', async () => {
  const calls = [];
  const plan = createPlan(storage(), {fetcher: site(calls, url => Response.json(url.endsWith('/pro/status') ? {ok: true, plan: 'pro', mode: 'test', creditPercent: 100} : {ok: true, minutes: 10}))});
  assert.equal((await plan.signin('start', {email: 'a@b.co'})).ok, true);
  const done = await plan.signin('verify', {email: 'a@b.co', code: '123456'});
  assert.equal(done.ok, true);
  assert.deepEqual(calls.map(call => call[0]), ['/pro/signin/start', '/pro/signin/verify', '/pro/status']);
  assert.ok(calls.every(call => call[3]), 'every call carries the install key');
  assert.equal(plan.state().plan, 'pro');
});

test('a wrong code, a full account and a site that cannot be reached are told, not hidden', async () => {
  const wrong = createPlan(storage(), {fetcher: site([], () => Response.json({ok: false, error: 'wrong', left: 2}, {status: 400}))});
  const answer = await wrong.signin('verify', {email: 'a@b.co', code: '000000'});
  assert.equal(answer.ok, false);
  assert.equal(signinWords(answer), 'That code is not right. 2 tries left.');
  const full = createPlan(storage(), {fetcher: site([], () => Response.json({ok: false, error: 'devices', devices: [{id: 'x'}]}, {status: 409}))});
  assert.deepEqual((await full.signin('verify', {email: 'a@b.co', code: '1'})).devices, [{id: 'x'}]);
  const down = createPlan(storage(), {fetcher: async (url) => { if (String(url).endsWith('/install-token')) return Response.json({ok: true, token: 't'}); throw new Error('offline'); }});
  assert.match((await down.signin('start', {email: 'a@b.co'})).error, /Could not reach/);
});

test('wired: the IPC pair, the preload entry and the ⌘K entry (only with the plan on, only for Free)', () => {
  const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert.match(read('../preload.cjs'), /planSignin: call\('planSignin'\)/);
  assert.match(read('../lib/app-meta-handlers.js'), /ipcMain\.handle\('planSignin'/);
  assert.ok(read('../renderer/pages/nav.js').includes("'I have Pro'"));
  assert.match(read('../renderer/pages/plan.js'), /signinPart\(/);
});

test('hidden for now: with the flag off, no "I have Pro" in the Plan card nor in ⌘K', () => {
  const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert.equal(SHOW_I_HAVE_PRO, false);
  assert.match(read('../renderer/pages/plan.js'), /if \(SHOW_I_HAVE_PRO\) body\.append\(signinPart/);
  assert.match(read('../renderer/pages/nav.js'), /if \(SHOW_I_HAVE_PRO\) add\('Settings', 'I have Pro'/);
  assert.equal((read('../renderer/pages/plan.js').match(/signinPart\(/g) || []).length, 1, 'the only use of the button sits behind the flag');
});
