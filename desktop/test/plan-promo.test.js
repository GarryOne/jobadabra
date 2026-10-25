// "Have a promo code?" in the app (lib/plan.js redeem, IPC planRedeem, renderer/pages/plan-promo.js, the Plan card link, the ⌘K entry): the typed code goes to the site with this install's key and
// nothing else decides it; a code that worked refreshes the plan, and a promo-Pro status counts as licensed (so Export opens). The public app holds no code, no hash and no compare. Fake site only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {createPlan} from '../lib/plan.js';
import {createAppAllowance} from '../lib/app-allowance.js';
import {redeemWords} from '../renderer/plan-view.js';
import {canExport} from '../lib/jobs-export.js';

const storage = (settings = {}) => { let s = settings; return {settings: () => s, saveSettings: p => { s = {...s, ...p}; }, secret: () => '', setSecret() {}}; };
const site = (calls, reply) => async (url, init = {}) => {
  if (String(url).endsWith('/install-token')) return Response.json({ok: true, token: 'tok'});
  calls.push([String(url).replace(/^.*\/api/, ''), init.method, JSON.parse(init.body || '{}'), init.headers?.['x-api-key']?.startsWith('JPF1.')]);
  return reply(String(url));
};
const FAKE = 'FAKE-CODE-1234';

test('the typed code goes to the site with the install key; a good one refreshes the plan', async () => {
  const calls = [], plan = createPlan(storage(), {fetcher: site(calls, url => (url.endsWith('/pro/status') ? Response.json({ok: true, plan: 'pro', mode: 'test', hasCredit: false}) : Response.json({ok: true})))});
  const done = await plan.redeem(FAKE);
  assert.equal(done.ok, true);
  assert.deepEqual(calls.map(call => call[0]), ['/pro/redeem', '/pro/status']);
  assert.deepEqual(calls[0].slice(1), ['POST', {code: FAKE}, true]);
  assert.equal(plan.state().plan, 'pro');
});

test('wrong, expired, used-up, too many and offline are each said plainly; a refused code leaves the plan alone', async () => {
  for (const [error, words] of [['wrong', "That code doesn't work."], ['expired', 'This code has expired.'], ['used_up', 'This code has been used up.'], ['limit', 'Too many tries. Try again in an hour.']]) {
    const calls = [], plan = createPlan(storage(), {fetcher: site(calls, () => Response.json({ok: false, error}, {status: 400}))});
    const answer = await plan.redeem('x');
    assert.deepEqual([answer.ok, answer.error, redeemWords(answer)], [false, error, words]);
    assert.deepEqual(calls.map(call => call[0]), ['/pro/redeem'], 'no plan refresh after a refusal');
  }
  const down = createPlan(storage(), {fetcher: async url => { if (String(url).endsWith('/install-token')) return Response.json({ok: true, token: 't'}); throw new Error('offline'); }});
  assert.match(redeemWords(await down.redeem('x')), /Could not reach/);
  assert.equal(redeemWords({ok: true}), 'Pro is on. Thank you.');
});

test('a promo-Pro status counts as licensed, so the Export gate opens for a redeemed install', () => {
  const st = storage({plan: {at: Date.now(), status: {plan: 'pro', mode: 'test', hasCredit: false, package: 'pro', source: 'promo'}}});
  const app = createAppAllowance({DEMO: false, getLicense: () => ({state: () => ({licensed: false, license: null, used: 25, limit: 20, daysLeft: 0, ended: true})}), log() {}, getStorage: () => st, getTelemetry: () => null, toWindow() {}});
  const state = app.licenseState();
  assert.equal(state.licensed, true);
  assert.equal(canExport(state), true);
});

test('wired: IPC, preload, the Plan card link (Free only) and the ⌘K entry (plan on, Free only); the route is listed', () => {
  const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert.match(read('../preload.cjs'), /planRedeem: call\('planRedeem'\)/);
  assert.match(read('../lib/app-meta-handlers.js'), /ipcMain\.handle\('planRedeem'/);
  const plan = read('../renderer/pages/plan.js'), upgrade = plan.slice(plan.indexOf("view.kind === 'upgrade'"), plan.indexOf('if (view.hasCredit)'));
  assert.ok(upgrade.includes('promoLink('), 'the link sits on the Free (upgrade) view, never on a Pro one');
  const nav = read('../renderer/pages/nav.js'), entry = nav.indexOf("'Redeem a promo code'");
  assert.ok(nav.lastIndexOf('GATED_FEATURES.promo(proGate(', entry) > -1, 'shown to every free person, with paying on or off (renderer/pro-gate.js)');
  assert.ok(JSON.parse(read('../../docs/site-routes.json')).routes.some(route => route.path === '/api/pro/redeem'));
});

// The public app must hold no promo code, hash or compare (owner, 25 Oct 2026): any line that names a promo in code may only send, show or refresh, never compare or hash.
test('no promo literal, hash or compare anywhere in the shipped app, extension or engine', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url)), offenders = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (['node_modules', 'test', 'tests', 'e2e', '.git', '.claude', 'dist', 'build'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|mjs|cjs|py)$/.test(entry.name)) fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => { if (/\bpromo[-_ ]?code|\bpromoCode|\bPROMO_/i.test(line) && /===|!==|==|createHash|digest|sha\d|timingSafeEqual|\.includes\(|startsWith/.test(line)) offenders.push(`${path.relative(root, full)}:${i + 1}`); }); } };
  for (const dir of ['desktop', 'extension', 'src']) if (fs.existsSync(root + dir)) walk(root + dir);
  assert.deepEqual(offenders, []);
});
