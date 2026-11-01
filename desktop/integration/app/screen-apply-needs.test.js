/* global document, Event */
// The session page's "Needs your attention" row for a menu the fill left empty, layer 2: the app's demo window on a fictional session whose review report carries the proposal and the form's own
// choices (what the extension's fill sends; its page half is the recorded case notice-period-proposed-not-typed-1). Moved from the applyflows e2e step "Needs your attention from the extension's fill"
// (R3, 1 Nov 2026): the row names the field, says what the kit proposed, offers the form's choices, and Use puts the picked choice in the form and the row says so. The command Use queues is
// proved in session-fill.test.js, the form taking it in the recorded case notice-period-set-by-app-command-1.
// Job: serve stored answers
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const CHOICES = ['Immediately', '1 month', '2 months'];
const demo = name => JSON.parse(fs.readFileSync(new URL(`../../demo/${name}`, import.meta.url), 'utf8'));
// The demo's Acme session, whose report says one menu is left: its kit said "3 months", none of the form's choices.
const REVIEW = demo('review.json').map(state => ({...state, left: 1, total: 6, missing: ['Notice period'], pending: ['Notice period'], optional: [],
  proposals: [{label: 'Notice period', value: '3 months', key: '', options: CHOICES}]}));
let row;

before(() => {
  if (needsElectron.skip) return;
  row = probeWindow({files: {'review.json': REVIEW}, timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.go('sessions');
    const session = await kit.until(() => [...document.querySelectorAll('#ss-list .ss-row')].find(one => one.textContent.includes('Acme Robotics')), 'the Acme Robotics session');
    session.click();
    const need = () => [...document.querySelectorAll('li.ss-need')].find(item => item.textContent.includes('Notice period'));
    const listed = await kit.until(need, 'a "Needs your attention" row for Notice period');
    // The row is drawn first and says the proposal once the app has asked which of the form's choices means the same (none does: the demo answers so).
    const menu = await kit.until(() => /3 months/.test(need()?.innerText || '') && need()?.querySelector('select.ss-ask-input'), 'the row to say what the kit proposed, with its menu of the form\'s choices');
    const before = {text: need().innerText.replace(/\s+/g, ' '), offered: [...menu.querySelectorAll('option')].map(option => option.textContent.trim()).filter(Boolean)};
    menu.value = '2 months'; menu.dispatchEvent(new Event('change', {bubbles: true}));
    const use = [...need().querySelectorAll('button')].find(button => button.textContent.trim() === 'Use');
    if (!use) throw new Error(`the row has no Use button (buttons: ${[...listed.querySelectorAll('button')].map(button => button.textContent.trim()).join(' | ')})`);
    use.click();
    // Then the row says it is filled, or leaves the list once the form reports the field filled.
    const after = await kit.until(() => { const now = need(); return !now ? 'gone' : /Filled in the form/.test(now.innerText) ? now.innerText.replace(/\s+/g, ' ') : ''; }, 'the row to say it is filled, or leave');
    return {before, after, picked: after === 'gone' ? '2 months' : need()?.querySelector('select.ss-ask-input')?.value};
  }});
});

test('"Needs your attention" lists the left menu with what the kit proposed and the form\'s own choices', live, () => {
  assert.match(row.result.before.text, /Notice period/);
  assert.match(row.result.before.text, /3 months/, `the row does not say what the kit proposed: ${row.result.before.text}`);
  assert.deepEqual(CHOICES.filter(choice => !row.result.before.offered.includes(choice)), [], `the row offers ${row.result.before.offered.join(', ')}; the form's choices are ${CHOICES.join(', ')}`);
});

test('Use fills the picked choice and the row says so (or leaves the list)', live, () => {
  assert.ok(row.result.after === 'gone' || /Filled in the form/.test(row.result.after), `after Use the row neither says it is filled nor leaves the list: ${row.result.after}`);
  assert.equal(row.result.picked, '2 months', 'the row does not keep the choice that was picked');
});
