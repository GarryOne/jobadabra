/* global document, performance */
// A silent Chrome in Standard automation, layer 2: the app's demo window on a fictional form session of the person's own Chrome. Moved from the apply e2e step "a silent Chrome in Standard
// automation" (R3, 1 Nov 2026). (1) The app's own socket is off: the card says at once that Jobadabra can't hear Chrome, the list pill says "Connection off", and no button is offered (none
// could help). (2) The socket is up and Chrome reports nothing (demoLinkSilent, lib/demo.js): after the wait the card says Chrome isn't reporting, and its FIRST button is "Open it again",
// which asks the app to reopen THIS job's form (sessionReopen), never the extension's settings page (extensionOptions). The app side of that press, opening the job's form with its fill mark
// for the same session, is session-tabs.test.js; the clock rules (CHECK_MS, WAIT_MS) are test/session-state.test.js. The window's clock is moved the way the e2e step moved it.
// Job: serve stored answers
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const NOW = new Date().toISOString();
// The person's own Chrome (Standard automation): a form session, no hidden-browser job behind it.
const FORM = {id: 'silent-check', kind: 'form', url: 'https://jobs.e2e.test/apply/one-page', title: 'Retail Assistant', company: 'E2E One-page Retail', location: '', workMode: '', stage: '', stuck: '',
  inChrome: true, claudeId: '', asked: false, transcript: '', events: [], outcome: '', status: 'done', note: 'Form open in Chrome', question: '', answered: false, startedAt: NOW, endedAt: null,
  exitCode: null, needsYouSince: NOW, background: null};
const STANDARD = {mode: 'check', chosenAt: NOW};
let off, silent;

// Window helpers (serialised into the window with the script, so no closure over this file): open the session's card; the card's text by element id, and its buttons in order.
const cardKit = base => {
  const card = id => (document.getElementById(id)?.innerText || '').replace(/\s+/g, ' ').trim();
  const buttons = () => [...document.querySelectorAll('#ss-actions button')].map(button => button.innerText.trim());
  const open = async () => {
    await base.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await base.go('sessions');
    const row = await base.until(() => [...document.querySelectorAll('#ss-list .ss-row')].find(one => one.textContent.includes('E2E One-page Retail')), 'the form session');
    row.click();
    return row;
  };
  return {card, buttons, open};
};

before(() => {
  if (needsElectron.skip) return;
  off = probeWindow({use: [cardKit], settings: {demoLinkOff: true, apply: STANDARD}, files: {'sessions.json': [FORM]}, timeout: 180000, script: async kit => {
    const row = await kit.open();
    await kit.until(() => /can't hear Chrome/i.test(kit.card('ss-next-title')), 'the card to say the app can\'t hear Chrome');
    return {pill: row.innerText.replace(/\s+/g, ' '), title: kit.card('ss-next-title'), buttons: kit.buttons()};
  }});
  silent = probeWindow({use: [cardKit], settings: {demoLinkSilent: true, apply: STANDARD}, files: {'sessions.json': [FORM]}, timeout: 180000, script: async kit => {
    await kit.open();
    // Why (1 Nov 2026): moved only once the card is drawn for the first look, as the e2e step did (a clock moved before the first draw is read by that draw); then the 2 s tick turns it.
    await kit.until(() => kit.card('ss-next-title'), 'the card to be drawn');
    const real = performance.now.bind(performance);
    performance.now = () => real() + 70000;
    await kit.until(() => /Chrome isn't reporting/i.test(kit.card('ss-next-title')), 'the card to say Chrome isn\'t reporting');
    const shown = kit.buttons();
    [...document.querySelectorAll('#ss-actions button')].find(button => button.innerText.trim() === 'Open it again')?.click();
    return {title: kit.card('ss-next-title'), question: kit.card('ss-question'), buttons: shown};
  }});
});

test('the app\'s own socket is off: the card says it can\'t hear Chrome at once, the pill says Connection off, and no button is offered', live, () => {
  assert.match(off.result.pill, /Connection off/);
  assert.match(off.result.title, /can't hear Chrome/i);
  assert.deepEqual(off.result.buttons, [], `a card whose cause is the app's own socket offers ${off.result.buttons.join(', ')}: none of them can help`);
});

test('Chrome is silent with the link up: the card says Chrome isn\'t reporting, "Open it again" comes first and reopens the job, not the extension\'s settings', live, () => {
  assert.match(silent.result.title, /Chrome isn't reporting/i);
  assert.equal(silent.result.buttons[0], 'Open it again', `the first button is "${silent.result.buttons[0]}" (buttons: ${silent.result.buttons.join(', ')})`);
  assert.ok(silent.result.buttons.includes('Open Chrome'), 'the link that connects the extension is still there');
  const called = silent.log.filter(line => line.includes('a blocked action was called')).map(line => /"name":"(\w+)"/.exec(line)?.[1]);
  assert.deepEqual(called, ['sessionReopen'], 'Open it again must ask the app to reopen the job (sessionReopen) and nothing else, not open the extension\'s page (extensionOptions)');
});
