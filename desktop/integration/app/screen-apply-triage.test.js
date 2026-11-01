/* global document, window */
// Every read verdict gives its own chip on Jobs after Check, layer 2: the app's demo window on fictional jobs whose "form read" is named per job (settings.demoTriageReads, lib/demo.js; the real
// read is the hidden browser's). Moved from the apply e2e step "each read verdict gives its own chip on Jobs after Check, with no fill, session or hidden page left" (R3, 1 Nov 2026).
// The five reads are what lib/triage-read.js readFromJudge makes of the judge's answers (plain form with every answer saved, with an unsaved one, bot check, login wall, account to create);
// each must show ITS chip (label and reason from renderer/apply-triage-pick.js) after one Check, the progress must end at "5 of 5", and the demo logs no blocked action (no applyOne, prepareKit or sessionReopen) during the Check.
// The coverage of ALL verdicts (every combination of the reader's flags reaches a chip mode) is the first test, the pure half of the old step. The real read in the hidden browser
// (nothing filled or sent, the tab closed) is NOT here: it stays in e2e (apply-read-steps.mjs), a safety step.
// Job: serve stored answers
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {readFromJudge} from '../../lib/triage-read.js';
import {modeOfRead} from '../../renderer/apply-triage-mode.js';
import {CHIPS} from '../../renderer/apply-triage-pick.js';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const plain = {botCheck: false, loginWall: false, accountCreation: false};
const CASES = [
  // chip/reason: the words the person reads for that read, written out here (not derived from the renderer's table, which would pass with the table wrong).
  {name: 'plain, every answer saved', judged: plain, allFactsSaved: true, chip: 'Can apply automatically', reason: 'every answer is a saved fact'},
  {name: 'plain, an answer not saved', judged: plain, allFactsSaved: false, chip: 'You review and submit', reason: 'answers you have not saved'},
  {name: 'bot check', judged: {...plain, botCheck: true}, chip: 'Needs you', reason: 'captcha'},
  {name: 'login wall', judged: {...plain, loginWall: true}, chip: 'Needs you', reason: 'login wall'},
  {name: 'account to create', judged: {...plain, accountCreation: true}, chip: 'Needs you', reason: 'asks you to create an account'},
].map((item, index) => ({...item, url: `https://jobs.triage-chip.example/roles/${index + 1}`, read: readFromJudge(item.judged, {allFactsSaved: item.allFactsSaved})}));
const JOBS = CASES.map((item, index) => ({id: index + 1, code: `c${index + 1}`, title: `Chip Engineer ${index + 1}`, company: 'Triage chip fixtures', stage: null, location: 'Zurich', work_mode: 'Hybrid',
  url: item.url, posted_at: '2099-01-01', first_seen_at: '2099-01-01', status: 'unreviewed', fit: 90 - index, reason: 'A fictional match.', rank: 100 - index, skills: []}));
let screen;

before(() => {
  if (needsElectron.skip) return;
  screen = probeWindow({settings: {demoTriageReads: Object.fromEntries(CASES.map(item => [item.url, item.read]))}, files: {'jobs.json': {jobs: JOBS, total: JOBS.length, filtered: JOBS.length}}, timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.go('jobs');
    await kit.until(() => document.querySelectorAll('article.job-row').length >= 5, 'the five job rows');
    const chips = () => [...document.querySelectorAll('article.job-row')].map(row => {
      const value = row.querySelector('.role > .chip-tag .chip-value');
      return {url: row.dataset.url, label: value?.textContent.trim() || '', reason: value?.closest('.chip-tag')?.getAttribute('title') || ''};
    });
    const unread = chips();
    document.getElementById('triage-open').click();
    await kit.until(() => document.getElementById('triage-dialog').open, 'the popup');
    const field = document.getElementById('triage-n');
    field.value = '5'; field.dispatchEvent(new window.Event('input', {bubbles: true}));
    await kit.until(() => document.getElementById('triage-start').textContent.trim() === 'Check 5 jobs', 'the popup to offer Check 5 jobs');
    document.getElementById('triage-start').click();
    const finished = await kit.until(() => {
      const now = chips();
      return document.getElementById('triage-progress')?.hidden === true && document.getElementById('triage-progress-text')?.textContent.trim() === '5 of 5' && now.every(item => item.label && item.label !== 'Not checked') ? now : '';
    }, 'every row to show its chip and the progress to end at 5 of 5');
    return {unread, finished};
  }});
});

test('every combination of the reader\'s flags reaches a chip, and every chip is reachable by a verdict (the pure half of the old step)', () => {
  const flags = Object.keys(readFromJudge(plain));
  const reads = flags.reduce((rows, flag) => rows.flatMap(row => [true, false, null, undefined].map(value => ({...row, [flag]: value}))), [{}]);
  assert.deepEqual(new Set(reads.map(read => modeOfRead(read).mode)), new Set(Object.keys(CHIPS)), 'every chip mode needs a verdict and every verdict a chip mode');
  const distinct = new Set(CASES.map(item => JSON.stringify(modeOfRead(item.read))));
  assert.equal(distinct.size, CASES.length, 'each fixture must cover a different mode and reason');
  // The one verdict no page read reaches: triage-reader.report fixes eligible: true (apply-triage-mode.test.js covers an ineligible job).
  const saved = readFromJudge(plain, {allFactsSaved: true});
  const reachable = new Set(reads.map(read => JSON.stringify(modeOfRead(read))));
  assert.deepEqual([...reachable].filter(key => !distinct.has(key)), [JSON.stringify(modeOfRead({...saved, eligible: false}))], 'a verdict has no fixture');
});

test('before any Check every job says Not checked; after one Check each row shows the chip and the reason of its own read', live, () => {
  assert.deepEqual(screen.result.unread.map(item => item.label), CASES.map(() => 'Not checked'));
  for (const item of CASES) {
    const row = screen.result.finished.find(one => one.url === item.url);
    assert.equal(row.label, item.chip, `${item.name}: wrong chip`);
    assert.equal(row.reason, item.reason, `${item.name}: wrong verdict reason`);
  }
  assert.equal(new Set(screen.result.finished.map(item => item.label)).size, 3, 'the five reads reach three chips (auto, fill, needs you)');
});

test('a Check reads only: the app is asked for no apply, no kit and no reopen (the demo logs every blocked action)', live, () => {
  const called = screen.log.filter(line => line.includes('a blocked action was called'));
  assert.deepEqual(called, [], `a Check called ${called.join(' | ')}`);
});
