/* global document */
// Settings → Plan, layer 2: in the app's real window, every amount of AI credit the Plan section names says what it buys ("about 70 applications"), in a Free plan that offers Pro + AI and in a Pro + AI plan with its top-ups.
// Job: serve stored answers
// Why (1 Nov 2026, owner: "We can build 10-20 more journeys. for the integrations"; Trello journey 29 "Manage trial, Pro and AI credit" had unit tests of the plan's numbers and a source-text loop, never the window):
// the plan answer is seeded the way the demo reads it (settings.plan, lib/plan.js `stored`), nothing asks the site. The number each amount must carry is computed here from the one shared function
// (renderer/credit-buys.js), never typed (owner, 27 Oct 2026: "whenever we mention 10e AI credit received, we should mention an approximate/average of real numbers what the user can do with that").
// The window is the demo's, on a temp folder; no network, no AI, never the owner's app.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {applicationsFor} from '../../renderer/credit-buys.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const OFFERS = [{id: 'pro', name: 'Pro', price: '9', list: null, currency: 'EUR', credit: false, creditEur: 0}, {id: 'pro-ai', name: 'Pro + AI', price: '19', list: '29', currency: 'EUR', credit: true, creditEur: 10},
  ...[5, 10, 20].map(n => ({id: `topup${n}`, name: 'AI credit', price: String(n), list: null, currency: 'EUR', credit: true, creditEur: n}))];
const PLANS = {
  free: {mode: 'test', plan: 'free', offers: OFFERS},
  proAi: {mode: 'test', plan: 'pro', package: 'pro-ai', hasCredit: true, creditPercent: 25, warn: 30, offers: OFFERS},
};

/** The Plan section of the demo window with this plan answer: its text and the title of every button (where the top-ups say what they add). */
function planSection(status) {
  return probeWindow({timeout: 150000, settings: {plan: {at: Date.now(), status}}, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.go('settings');
    const goPlan = [...document.querySelectorAll('.settings-nav button')].find(button => button.textContent.trim() === 'Plan');
    goPlan.click();
    const page = await kit.until(() => [...document.querySelectorAll('[data-settings-page]')].find(section => !section.hidden && section.querySelector('h2, h3, p')), 'the Plan section to show');
    await kit.until(() => page.innerText.includes('Free for 20 applications'), 'the Plan section to fill in');
    // The plan answer reaches the card in a second step (the site is never asked in the demo): wait for the card this answer draws.
    await kit.until(() => /Upgrade your plan|AI credit: \d+% left/.test(page.innerText), 'the card of this plan answer');
    return {text: page.innerText, titles: [...page.querySelectorAll('button[title]')].map(button => ({name: button.textContent.trim(), title: button.title})), severe: kit.severe('settings')};
  }}).result;
}

let free, proAi;
before(() => {
  if (needsElectron.skip) return;
  free = planSection(PLANS.free);
  proAi = planSection(PLANS.proAi);
});

/** Every "€N of AI credit" in the text, with what follows it. */
const mentions = text => [...text.matchAll(/€(\d+(?:\.\d+)?) of AI credit(\s*\(about (\d+) applications\))?/g)].map(match => ({amount: Number(match[1]), says: match[3] === undefined ? null : Number(match[3]), at: match[0]}));

test('a Free plan that offers Pro + AI says what its credit buys, and shows no dollars', live, () => {
  const found = mentions(free.text);
  assert.ok(found.length >= 1, `the Pro + AI card names no amount of credit; the card says: ${free.text.slice(0, 300)}`);
  for (const {amount, says, at} of found) assert.equal(says, applicationsFor(amount), `"${at}" must say about ${applicationsFor(amount)} applications`);
  assert.doesNotMatch(free.text, /\$\d/, 'a price in dollars');
  assert.deepEqual(free.severe, [], 'layout problems on the Plan section');
});

test('a Pro + AI plan shows its credit left, warns under 30%, and each top-up says what it adds', live, () => {
  assert.match(proAi.text, /AI credit: 25% left/);
  assert.match(proAi.text, /under 30%/, 'the warning names the level crossed');
  const topups = proAi.titles.filter(button => /^Add €/.test(button.name));
  assert.deepEqual(topups.map(button => button.name), ['Add €5', 'Add €10', 'Add €20']);
  for (const button of topups) {
    const amount = Number(/€(\d+)/.exec(button.name)[1]);
    assert.ok(applicationsFor(amount) > 0, `the control: €${amount} buys something`);
    assert.match(button.title, new RegExp(`adds €${amount} of AI credit \\(about ${applicationsFor(amount)} applications\\)`), `the ${button.name} button does not say what it adds`);
  }
  for (const {amount, says, at} of mentions(`${proAi.text}\n${proAi.titles.map(button => button.title).join('\n')}`)) assert.equal(says, applicationsFor(amount), `"${at}" must say about ${applicationsFor(amount)} applications`);
  assert.deepEqual(proAi.severe, [], 'layout problems on the Plan section');
});
