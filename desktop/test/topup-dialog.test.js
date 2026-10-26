// The top-up dialog (renderer/pages/topup-dialog.js; owner, 26 Oct 2026: "Blocking, but showing a topup popup/dialog ... a smaller button/option to topup using promo code";
// 27 Oct 2026: "If they're free tier, they should upgrade to pro. Otherwise, they just need to topup"): its words per case, a credit code's answer, and the class: every
// refusal for AI credit or a Free AI line opens it (the pop-up path, the Find jobs card, a line found in the background), never a toast or Settings alone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {TOP_UP, UPGRADE, redeemWords, topupWords} from '../renderer/plan-view.js';
import {createPlan} from '../lib/plan.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-27T20:48:00.000Z');

test('Pro with no credit tops up; the free tier at a line upgrades to Pro, hears when it opens again and may wait', () => {
  const pro = topupWords({}, 'Find jobs', NOW);
  assert.deepEqual([pro.primary, pro.pro, pro.title, pro.wait], [TOP_UP, true, 'Top up to continue', '']);
  assert.match(pro.body, /^Find jobs uses our AI, and your plan has no AI credit left\.$/);
  const day = topupWords({cap: 'day', resetsAt: '2026-10-28T00:00:00.000Z'}, 'Find jobs', NOW);
  assert.deepEqual([day.primary, day.pro, day.wait], [UPGRADE, false, 'Wait until tomorrow']);
  assert.match(day.body, /00:00 UTC \(in 3 h 12 min\)\. Upgrade to Pro/);
  for (const cap of ['month', 'trial', 'busy', 'busy-month', 'off']) assert.equal(topupWords({cap}, '', NOW).primary, UPGRADE, cap);
  assert.match(topupWords({cap: 'trial'}, '', NOW).body, /^Our AI steps are paused\./, 'a line found with no press says so');
  assert.match(topupWords({cap: 'busy', text: 'Free AI is busy right now.'}, '', NOW).body, /^Free AI is busy right now\./);
});

test('a credit code says the euros it added; the same code twice adds nothing; a Pro code is unchanged', async () => {
  assert.equal(redeemWords({ok: true, credit: 10}), '€10 of AI credit added.');
  assert.equal(redeemWords({ok: true, credit: 10, already: true}), 'This code was already added on this computer.');
  assert.equal(redeemWords({ok: true}), 'Pro is on. Thank you.');
  assert.equal(redeemWords({ok: false, error: 'pro_only'}), 'This code adds AI credit to Pro. Upgrade to Pro first.');
  const fetcher = async url => (String(url).endsWith('/install-token') ? Response.json({ok: true, token: 'tk'}) : Response.json({ok: true, credit: 10, plan: 'free', mode: 'promo'}));
  assert.deepEqual(await createPlan({settings: () => ({}), saveSettings() {}, secret: () => '', setSecret() {}}, {fetcher}).redeem('TOPUP-FAKE'), {ok: true, credit: 10});
});

test('every refusal for AI credit or a Free AI line opens the dialog: the pop-up path, the Find jobs card, a line found in the background', () => {
  const startup = read('renderer/pages/startup.js');
  assert.match(startup, /if \(why\.credit\) \{ openTopupDialog\(why, \{action: title\.replace\(\/ did not start\$\/, ''\), retry\}\); return why; \}/, 'sayRefused: credit/line refusals open the dialog');
  assert.match(startup, /window\.pilot\.onAiCap\?\.\(cap => openTopupDialog\(/, 'a line found after a run or a refused AI call');
  assert.match(read('renderer/pages/jobs-find.js'), /refused\?\.credit \? openTopupDialog\(refused, \{action: 'Find jobs', retry/, 'the card\'s button');
  assert.match(read('renderer/pages/jobs.js'), /\(!showFindRefused\(refused\) \|\| refused\.credit\)/, 'on the card AND the dialog for credit');
  assert.match(read('preload.cjs'), /onAiCap: callback => ipcRenderer\.on\('aiCap'/);
  assert.match(read('lib/app-allowance.js'), /toWindow\('aiCap', cap\)/);
  // No other page opens Settings → Plan for a credit refusal on its own (it would skip the dialog).
  // (startup.js is checked above: its Settings → Plan toast is the trial's end, after the credit case returned with the dialog.)
  for (const file of fs.readdirSync(new URL('../renderer/pages/', import.meta.url)).filter(name => name.endsWith('.js') && name !== 'startup.js')) {
    for (const line of read(`renderer/pages/${file}`).split('\n').filter(text => /\brefused\b|\bwhy\b/.test(text) && /openSetting\('plan'\)/.test(text)))
      assert.match(line, /openTopupDialog|refusalAction\(why\)/, `${file}: a credit refusal goes to openTopupDialog, not Settings alone: ${line.trim()}`);
  }
});

test('the dialog is built from the shared parts, offers a promo code to Pro and greys the packs while paying is off', () => {
  const dialog = read('renderer/pages/topup-dialog.js');
  for (const part of ["'save-dialog panel-dialog topup-dialog'", "'dialog-head'", "'dialog-foot'", "'ui-pill tone-warn'", "'Have a promo code?'", "'Use my own key'", 'planRedeem', 'planCheckout'])
    assert.ok(dialog.includes(part), part);
  assert.match(dialog, /disabled: true/, 'greyed packs while paying is off');
  assert.match(dialog, /words\.pro \? packs\.parts : \[\]/, 'the packs are Pro\'s top-ups');
  assert.match(dialog, /if \(!packs\.paying\) \{ if \(!promo\.querySelector\('input'\)\) openField\(\)/, 'paying off: Top up / Upgrade opens the code field, never an empty Plan page');
  assert.match(dialog, /if \(words\.pro\) promo\.append\(link\);/, 'credit codes are Pro\'s: no promo link for the free tier (owner, 27 Oct 2026)');
  assert.match(dialog, /if \(again\) retry\(\)/, 'a code that worked runs the refused press again');
});

test('a Pro by a promo code while paying is off still gets its Plan card: both plans (Free greyed, Pro selected), the credit and a promo code link', async () => {
  const {CODE_CREDIT_NOTE, PLAN_CHOICES, planView} = await import('../renderer/plan-view.js');
  const none = planView({mode: 'promo', plan: 'pro', source: 'promo', hasCredit: false, creditPercent: 0});
  assert.deepEqual([none.kind, none.promo, none.hasCredit, none.label, none.note, none.topups], ['pro', true, false, 'AI credit: none yet', CODE_CREDIT_NOTE, []]);
  assert.equal(planView({mode: 'promo', plan: 'pro', hasCredit: true, creditPercent: 40, warn: null}).label, 'AI credit: 40% left');
  assert.equal(planView({mode: 'promo', plan: 'free'}), null, 'the free tier in promo mode: unchanged (the license card shows it)');
  assert.deepEqual(PLAN_CHOICES.map(choice => [choice.id, !!choice.disabled]), [['free', true], ['pro', false]]);
  const page = read('renderer/pages/plan.js');
  assert.match(page, /choiceCards\(PLAN_CHOICES, \{selected: 'pro'/);
  assert.match(page, /'Top up with a promo code'[\s\S]{0,120}openPromoDialog\(/);
});

test('the sidebar bar is the AI credit left on our AI, also at none; on an own key a full bar (owner, 27 Oct 2026)', async () => {
  const {chip} = await import('../renderer/license-chip.js');
  const pro = pro => chip({licensed: true, license: {kind: 'pro'}, used: 0, pro});
  assert.deepEqual([pro({ourAi: true, hasCredit: false, creditPercent: null}).text, pro({ourAi: true, hasCredit: false}).tone], ['AI credit 0%', 'bad']);
  assert.deepEqual([pro({ourAi: true, hasCredit: true, creditPercent: 40}).text, pro({ourAi: true, hasCredit: true, creditPercent: 40}).percent], ['AI credit 40%', 40]);
  assert.deepEqual([pro({ourAi: false, hasCredit: false, creditPercent: null}).text, pro({ourAi: false, hasCredit: false}).percent], ['Pro plan', 100], 'own key: unlimited');
});

test('a Pro\'s allowance card shows its AI credit on our AI, or a full bar and why on its own AI (owner, 27 Oct 2026)', () => {
  const page = read('renderer/pages/license.js');
  assert.match(page, /pro \? 'AI credit' :/);
  assert.match(page, /'Unlimited · your own AI'/);
  assert.match(page, /'Unlimited: you use your own AI key, so nothing is counted\.'/);
  assert.match(page, /\$\('license-days-bar'\)\.hidden = licensed && !pro;/);
});
