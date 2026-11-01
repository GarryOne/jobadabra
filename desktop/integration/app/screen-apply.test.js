/* global document, window */
// Applying screens, layer 2: the Jobs popup of "See which jobs can apply automatically", the session page's "Before you submit" strip, and a queued hidden-browser job whose link to the app
// is off. Moved from the e2e `apply` suite (1 Nov 2026) to the app's demo window on fictional jobs and sessions: nothing opens, fills or sends. What STAYS in e2e: every step that needs the
// extension on a form, the real read of a form, a tailored CV, a stage change or the hidden browser, and every safety step (Stop, bot checks, queues, Full automation, the quit). The
// demo cannot play a silent Chrome with the link up (it has only "link off"), so the Standard-automation card also stays.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const NOW = new Date().toISOString();
// Twelve jobs with distinct fits, more than the 10 the popup takes (the e2e step's own twelve).
const FITS = [96, 93, 90, 88, 86, 84, 82, 80, 78, 76, 74, 72];
const JOBS = FITS.map((fit, index) => ({id: index + 1, code: `t${index + 1}`, title: `Triage Engineer ${index + 1}`, company: 'Triage Fixture Co', stage: 'Saved', location: 'Zurich', work_mode: 'Hybrid',
  url: `https://jobs.triage-fixture.example/roles/${index + 1}`, posted_at: '2099-01-01', first_seen_at: '2099-01-01', status: 'saved', fit, reason: 'A fictional match.', rank: 100 - index, skills: []}));
// A queued Background-automation form session; the app's link is switched off (demoLinkOff: lib/demo.js demoFormsOpen).
const QUEUED = {id: 'silent-fill', kind: 'form', url: 'https://jobs.e2e.test/apply/multistep', title: 'Multi Step Engineer', company: 'E2E Multistep Co', location: '', workMode: '', stage: '', stuck: '',
  inChrome: true, claudeId: '', asked: false, transcript: '', events: [], outcome: '', status: 'done', note: 'Form open in Chrome', question: '', answered: false, startedAt: NOW, endedAt: null,
  exitCode: null, needsYouSince: NOW, background: {mode: 'fill', state: 'queued', reason: '', readyAt: 0, dueAt: 0, manualOverride: false}};
// The Acme Robotics form's job is in the list, as the e2e step's job was: its CV row then says which CV goes in (a job not listed gets "Add this job" instead).
const demoJobs = JSON.parse(fs.readFileSync(new URL('../../demo/jobs.json', import.meta.url), 'utf8'));
const ACME = {...JOBS[0], id: 99, code: 'acme', title: 'Cloud Engineering Manager', company: 'Acme Robotics', url: 'https://jobs.example/acme/sre'};
let popup, strip, silent, rows;

before(() => {
  if (needsElectron.skip) return;
  popup = probeWindow({files: {'jobs.json': {jobs: JOBS, total: JOBS.length, filtered: JOBS.length}}, timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.go('jobs');
    await kit.until(() => (window.__jp.shared.allJobs || []).length >= 12, 'the twelve jobs to be listed');
    document.getElementById('triage-open').click();
    await kit.until(() => document.getElementById('triage-dialog').open, 'the popup');
    const read = () => ({count: document.getElementById('triage-count').textContent.trim().split(' · ')[0], start: document.getElementById('triage-start').textContent.trim(), disabled: document.getElementById('triage-start').disabled});
    const ask = async n => {
      const field = document.getElementById('triage-n');
      field.value = String(n); field.dispatchEvent(new window.Event('input', {bubbles: true}));
      await kit.until(() => document.getElementById('triage-start').textContent.trim() !== '' && read().count !== '', 'the popup to say how many');
      return read();
    };
    return {listed: (window.__jp.shared.allJobs || []).length, fields: document.querySelectorAll('#triage-dialog input').length, ten: await ask(10), three: await ask(3), fifty: await ask(50)};
  }});
  rows = probeWindow({files: {'jobs.json': {jobs: JOBS.map(job => ({...job, stage: null, status: 'unreviewed'})), total: JOBS.length, filtered: JOBS.length}}, timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.go('jobs');
    await kit.until(() => document.querySelectorAll('article.job-row').length >= 12, 'the twelve job rows');
    const all = [...document.querySelectorAll('article.job-row')];
    const kitless = all.filter(row => !/📝 Kit/.test(row.textContent));
    const first = kitless[0];
    first.querySelector('[aria-label="More actions"]').click();
    const items = await kit.until(() => [...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent.trim()).filter(Boolean), 'the ⋯ menu');
    return {rows: all.length, kitless: kitless.length, buttons: kitless.map(row => ({label: row.querySelector('.row-main')?.textContent.trim(), cls: row.querySelector('.row-main')?.className || '', prepare: /Prepare/.test(row.textContent)})), items};
  }});
  strip = probeWindow({files: {'jobs.json': {...demoJobs, jobs: [...demoJobs.jobs, ACME]}}, timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.go('jobs');
    await kit.until(() => (window.__jp.shared.allJobs || []).some(job => job.code === 'acme'), 'the Acme Robotics job to be listed');
    await kit.go('sessions');
    const row = await kit.until(() => [...document.querySelectorAll('#ss-list .ss-row')].find(one => one.textContent.includes('Acme Robotics')), 'the Acme Robotics session');
    row.click();
    await kit.until(() => document.querySelector('#ss-before-knock:not([hidden])') && document.querySelector('#ss-before-cv:not([hidden])'), 'the "Before you submit" strip');
    return {knock: document.getElementById('ss-before-knock').innerText.replace(/\s+/g, ' '), cv: document.getElementById('ss-before-cv').innerText.replace(/\s+/g, ' ')};
  }});
  silent = probeWindow({settings: {demoLinkOff: true, apply: {mode: 'fill', chosenAt: NOW}}, files: {'sessions.json': [QUEUED]}, timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.go('sessions');
    const row = await kit.until(() => [...document.querySelectorAll('#ss-list .ss-row')].find(one => one.textContent.includes('E2E Multistep Co')), 'the queued session');
    const pill = row.innerText.replace(/\s+/g, ' ');
    row.click();
    await kit.until(() => /can't hear/i.test(document.getElementById('ss-next-title')?.innerText || ''), 'the card to say why it waits');
    const text = id => (document.getElementById(id)?.innerText || '').replace(/\s+/g, ' ').trim();
    return {pill, title: text('ss-next-title'), question: text('ss-question'), buttons: [...document.querySelectorAll('#ss-actions button')].map(button => button.innerText.trim())};
  }});
});

test('the Jobs popup has one field, the first N best matching jobs not checked before, and says how many', live, () => {
  const {listed, fields, ten, three, fifty} = popup.result;
  assert.equal(listed, 12);
  assert.equal(fields, 1, 'the popup has more than one field');
  assert.deepEqual([ten.count, ten.start], ['10 jobs', 'Check 10 jobs']);
  assert.deepEqual([three.count, three.start], ['3 jobs', 'Check 3 jobs']);
  assert.deepEqual([fifty.count, fifty.start], ['12 jobs not checked yet', 'Check 12 jobs'], 'asking for more than there are says so');
});

test('the session page says it too: "Before you submit" counts the knockout question that is still the person\'s, and says which CV goes in', live, () => {
  assert.match(strip.result.knock, /1 question can reject you automatically/i);
  assert.match(strip.result.knock, /sponsorship/i);
  assert.match(strip.result.cv, /This form gets your general CV|tailored to this job is ready/i, `the CV row says which CV goes in: ${strip.result.cv}`);
});

test("a silent Chrome in Background automation: a queued hidden-browser job says why it waits when the app's link is off, and never talks of the person's Chrome", live, () => {
  const {pill, title, question, buttons} = silent.result;
  assert.match(pill, /Connection off/);
  assert.match(title, /can't hear/i);
  assert.doesNotMatch(`${title} ${question} ${pill}`, /Chrome isn't reporting|Tab not found|Checking Chrome|Waiting for Chrome/i);
  assert.doesNotMatch(question, /Chrome/, 'a hidden-browser card names the person\'s Chrome');
  assert.deepEqual(buttons, ['Stop'], 'the only way on is Stop; nothing can submit while the link is off');
});

test('a scored job without a kit shows the Apply button, never Prepare, and "Prepare only" in its ⋯ menu', live, () => {
  const {rows: shown, kitless, buttons, items} = rows.result;
  assert.equal(shown, 12);
  assert.ok(kitless > 0, 'no kitless job in the list to check');
  assert.deepEqual(buttons.filter(button => button.label !== 'Apply' || !/state-apply/.test(button.cls) || button.prepare), [], 'a job without a kit does not show a plain Apply button');
  assert.ok(items.some(text => /Prepare only/.test(text)), `the ⋯ menu of a job without a kit has no "Prepare only" (it lists: ${items.join(' | ')})`);
});
