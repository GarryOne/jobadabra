// LinkedIn jobs on every Find jobs, PR 2/3: the real seams the registered step uses (owned browser, runAll, the engine's list of searches, the light scoring), injected here.
// Nothing real is touched: no browser, no engine, no Keychain.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {linkedinSeams} from '../lib/linkedin-beside.js';
import {setLinkedinStep} from '../lib/search-beside.js';
import {visitsArgs} from '../lib/pipeline-args.js';

const storage = {settings: () => ({linkedinJobs: {on: false}}), saveSettings: () => {}, secret: () => ''};

test('the searches come from the engine\'s strategy command, parsed from its last line; a failing engine means none', async () => {
  const asked = [];
  const seams = linkedinSeams(storage, {browser: {}, runEngine: async (_, args) => { asked.push(args); return {code: 0, stdout: `noise\n${JSON.stringify({ok: true, searches: [{name: 'a', url: 'https://www.linkedin.com/jobs/search/?keywords=a'}]})}\n`}; }});
  assert.deepEqual(await seams.searches(), [{name: 'a', url: 'https://www.linkedin.com/jobs/search/?keywords=a'}]);
  assert.deepEqual(asked[0], ['src.desktop', 'linkedin-searches']);
  const broken = linkedinSeams(storage, {browser: {}, runEngine: async () => ({code: 1, stdout: 'Traceback'})});
  assert.deepEqual(await broken.searches(), []);
});

test('the light scoring is the existing --only-visits run for the jobs that fit, its lines going to the search\'s log', async () => {
  const runs = [], lines = [];
  const seams = linkedinSeams(storage, {browser: {}, runEngine: async (_, args, tee) => { runs.push(args); tee?.('scored'); return {code: 0, stdout: ''}; }});
  await seams.score(7, line => lines.push(line));
  assert.ok(runs[0].includes('--only-visits'));
  assert.deepEqual(runs[0], visitsArgs(storage, 7), 'exactly what "Find jobs using your browser" runs to score its pages');
  assert.deepEqual(lines.filter(line => line === 'scored'), ['scored']);
});

test('the step is the LinkedIn step with this app\'s seams: off when the switch is off, nothing started', async () => {
  const touched = [];
  const browser = new Proxy({}, {get: (_, name) => (...args) => { touched.push(name); return false; }});
  const seams = linkedinSeams(storage, {browser, runEngine: async () => ({code: 0, stdout: ''})});
  assert.deepEqual(await seams.step(new AbortController().signal, () => {}), {state: 'off', jobs: 0});
  assert.deepEqual(touched, []);
  setLinkedinStep(null);
});
