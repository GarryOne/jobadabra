/* global document */
// Jobs, layer 2: setup ends on Jobs, so Jobs says when the Profile is still the blank template (fit scores are paused), with Rebuild from CV (#2759).
// The verdict rides on the jobs read (`profile_empty`, src/desktop.py _profile_blank: tests/test_desktop.py); the demo's jobs.json carries it here. The app's window on it, no Notion, no AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const demoJobs = JSON.parse(fs.readFileSync(new URL('../../demo/jobs.json', import.meta.url), 'utf8'));
let blank, filled;

// In the window (window-probe.js `use`, serialised: no closure over this file): open Jobs and read the notice as a person sees it.
const profileKit = base => {
  const notice = () => document.getElementById('jobs-profile-empty');
  const read = () => ({shown: !!notice() && !notice().hidden, text: notice()?.innerText || '', buttons: [...(notice()?.querySelectorAll('button') || [])].map(button => button.textContent.trim())});
  return {
    openJobs: async () => { await base.until(() => document.querySelector('.nav[data-view=jobs]:not([hidden])'), 'the menu'); await base.go('jobs'); },
    shownOnJobs: async () => { await base.until(() => read().shown, 'the Profile-is-empty notice on Jobs'); return read(); },
    // The jobs list is drawn (its read carried the verdict): the notice is still hidden.
    hiddenOnJobs: async () => { await base.until(() => !/Loading/.test(document.getElementById('jobs-stats').textContent), 'the jobs list'); return read(); },
    alsoOnStrategyAndRebuild: async () => {
      await base.go('strategy');
      await base.until(() => !document.getElementById('strategy-profile-empty').hidden, 'the same notice on Strategy');
      await base.go('jobs');
      notice().querySelector('button').click();
      await base.until(() => !document.getElementById('wizard').hidden, 'Rebuild from CV to open the wizard');
      return true;
    },
  };
};

before(() => {
  if (needsElectron.skip) return;
  blank = probeWindow({files: {'jobs.json': {...demoJobs, profile_empty: true}}, use: [profileKit], timeout: 180000, script: async kit => {
    await kit.openJobs();
    const jobs = await kit.shownOnJobs();
    return {...jobs, severe: kit.severe('jobs'), strategyAndRebuild: await kit.alsoOnStrategyAndRebuild()};
  }}).result;
  filled = probeWindow({files: {'jobs.json': {...demoJobs, profile_empty: false}}, use: [profileKit], timeout: 180000, script: async kit => { await kit.openJobs(); return kit.hiddenOnJobs(); }}).result;
});

test('a Profile still blank: Jobs says fit scores are paused and offers Rebuild from CV; Strategy says the same', live, () => {
  assert.match(blank.text, /Your Profile is empty, so fit scores are paused/);
  assert.match(blank.text, /still the blank template/);
  assert.deepEqual(blank.buttons, ['Rebuild from CV']);
  assert.equal(blank.strategyAndRebuild, true, 'Strategy shows the same notice, and the button on Jobs is its Rebuild from CV (opens the wizard)');
  assert.deepEqual(blank.severe, [], 'the notice breaks Jobs layout');
});

test('a filled Profile: Jobs shows no such notice', live, () => {
  assert.equal(filled.shown, false);
});
