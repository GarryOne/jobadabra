// The toolbar popup's controls appear only on a tab the desktop app opened and manages (owner, 16 Oct 2026: "as long I'm not on a tab opened and managed by the
// desktop app. There should be no button present/active"; a GitHub tab showed "Filter for my search, then read", "Read the jobs as they are" and a red Stop).
// The class is every <button> in extension/popup.html: each starts hidden and only popupControls() (extension/popup-controls.js) shows one; a new button left
// out of POPUP_CONTROLS fails here.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {judgedUrl, popupControls, POPUP_CONTROLS} from '../../extension/popup-controls.js';
import {popupMode} from '../../extension/tab-pages.js';

const ext = file => fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'extension', file), 'utf8');
const BUTTONS = [...ext('popup.html').matchAll(/<button\b[^>]*>/g)].map(([tag]) => ({id: /id="([^"]+)"/.exec(tag)?.[1], hidden: /\shidden(\s|>|=)/.test(tag)}));

const TABS = [
  [{url: 'https://github.com/GarryOne/jobadabra/pulls'}, false],                          // the owner's tab: no app, no mark
  [{url: 'https://www.jobs.ch/en/vacancies/'}, false],
  [{url: 'chrome://extensions'}, false],
  [{}, false],
  [{url: 'https://www.notion.so/kit-123', armed: true}, false],                             // an apply tab sent to Notion is let go
  [{url: 'https://apply.example.com/job/1#jobpilotto-fill'}, true],
  [{url: 'https://calendly.com/acme/30min', armed: true}, true],                            // a later page of an apply tab
  [{url: 'https://www.jobs.ch/en/vacancies/#jp-read-filter-ab12'}, true],
  [{url: 'https://www.jobs.ch/en/vacancies/detail/e644/#jp-posting-ab12cd'}, true],
  [{url: 'https://board.example/jobs/search/?keywords=sre#jp-board-ab12'}, true],           // "Read this board": the person's read, on a tab the app opened
];

test('every popup button starts hidden and is one the gate knows', () => {
  assert.ok(BUTTONS.length >= 3, 'the popup buttons were found');
  for (const button of BUTTONS) {
    assert.ok(button.id, 'every popup button has an id');
    assert.ok(button.hidden, `#${button.id} starts hidden: only popupControls() shows it`);
  }
  assert.deepEqual(BUTTONS.map(button => button.id).sort(), [...POPUP_CONTROLS].sort());
});

test('a tab the app does not manage gets no control at all; a managed one gets Stop and what fits it', () => {
  for (const [tab, managed] of TABS) {
    for (const allowed of [true, false]) {
      const shown = popupControls(popupMode(tab), {allowed});
      const label = `${JSON.stringify(tab)} allowed=${allowed}`;
      if (!managed) { assert.deepEqual(shown, [], label); continue; }
      assert.ok(shown.includes('stop'), label);
      for (const id of shown) assert.ok(POPUP_CONTROLS.includes(id), `${label}: ${id}`);
    }
  }
  assert.deepEqual(popupControls('fill', {allowed: true}).sort(), ['apply-here', 'stop']);
  assert.deepEqual(popupControls('fill', {allowed: false}).sort(), ['stop', 'visit-allow']);
  assert.deepEqual(popupControls('read', {allowed: true}), ['stop']);
  assert.deepEqual(popupControls('board', {allowed: true}).sort(), ['read-as-is', 'read-filter', 'stop']);
  assert.deepEqual(popupControls('board', {allowed: false}).sort(), ['stop', 'visit-allow']);
});

// The two reads exist on an app-opened board tab only: no other kind of tab is ever offered them (the class #966 closed).
test('the two reads are offered on a board tab and on no other kind of tab', () => {
  for (const [tab] of TABS) {
    const mode = popupMode(tab);
    const shown = popupControls(mode);
    const board = /#jp-board-/.test(tab.url || '');
    assert.equal(shown.includes('read-filter') || shown.includes('read-as-is'), board, JSON.stringify(tab));
  }
  assert.equal(popupMode({url: judgedUrl('https://board.example/feed', '#jp-board-ab12')}), 'board');   // a sign-in moved the tab on and dropped the mark
});

test('a read tab whose site dropped its mark is still the app\'s tab; a marked or unmarked one is judged as it is', () => {
  assert.equal(popupMode({url: judgedUrl('https://www.iwc.com/ch-en/careers', '#jp-read-ab12')}), 'read');   // iwc.com redirected to /ch-en, 7 Oct 2026
  assert.deepEqual(popupControls(popupMode({url: judgedUrl('https://www.iwc.com/ch-en/careers', '#jp-read-ab12')})), ['stop']);
  assert.equal(judgedUrl('https://x.example/#jp-read-cd34', '#jp-read-ab12'), 'https://x.example/#jp-read-cd34');
  assert.equal(popupMode({url: judgedUrl('https://github.com/x', undefined)}), 'browse');
});

test('popup.js shows a button only through the gate', () => {
  const js = ext('popup.js');
  assert.match(js, /popupControls\(/);
  for (const id of POPUP_CONTROLS) assert.doesNotMatch(js, new RegExp(`\\$\\('${id}'\\)\\.hidden\\s*=`), `#${id} is shown or hidden only by the gate`);
});
