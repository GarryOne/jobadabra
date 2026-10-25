import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {STEPS, track} from '../lib/setup-funnel.js';
import {assertSiteAccepts, siteTest} from './site-private.js';

// The website's funnel (/telemetry) counts the same steps, then "done" (its legacy 'notion' row was dropped 25 Oct 2026).
const SITE_STEPS = [...STEPS, 'done'];

siteTest('the website counts every setup step', () => {
  const site = fs.readFileSync(new URL('../../shared/telemetry.js', import.meta.url), 'utf8');
  const counted = [...site.match(/SETUP_STEPS = \[([^\]]*)\]/)[1].matchAll(/'([a-z]+)'/g)].map(m => m[1]);
  assertSiteAccepts(SITE_STEPS, counted, 'setup steps');   // the site may count more (it lands first)
});

test('the steps match the wizard', () => {
  const core = fs.readFileSync(new URL('../renderer/pages/core.js', import.meta.url), 'utf8');
  assert.match(core, new RegExp(`STEPS = \\[${STEPS.map(s => `'${s}'`).join(', ')}\\]`));
    // Every step has its page in the wizard, and the sidebar lists exactly these.
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  // 'hosted' is built in script (renderer/pages/hosted.js: index.html may only shrink), placed before 'extras'; the others are in the page.
  const BUILT = ['hosted'], inPage = STEPS.filter(step => !BUILT.includes(step));
  assert.deepEqual([...html.matchAll(/<li data-step="([a-z]+)"/g)].map(m => m[1]), inPage);
  for (const step of inPage) assert.match(html, new RegExp(`class="step" data-step="${step}"`));
  const hosted = fs.readFileSync(new URL('../renderer/pages/hosted.js', import.meta.url), 'utf8');
  assert.match(hosted, /step\.dataset\.step = 'hosted'/);
  assert.match(hosted, /#step-list li\[data-step="extras"\]'\)\.before\(item\)/);
});

test('one report per step reached, only moving forward; one when setup finishes', () => {
  const t0 = Date.parse('2026-09-30T10:00:00Z');
  const before = {firstRunAt: '2026-09-30T10:00:00Z'};
  assert.deepEqual(track({wizardStep: 'ai'}, before, t0 + 3 * 60000), {step: 'ai', index: 1, minutes: 3, ai: 'own'});
  assert.equal(track({wizardStep: 'ai'}, {...before, setupFurthest: 'ai'}), null);        // same step again
  assert.equal(track({wizardStep: 'welcome'}, {...before, setupFurthest: 'cv'}), null);  // going back
  assert.equal(track({wizardStep: 'cv'}, {...before, setupFurthest: 'ai', aiFree: true}).ai, 'free');
  assert.equal(track({setupDone: true}, {...before, setupFurthest: 'extras'}).step, 'done');
  assert.equal(track({setupDone: true}, {...before, setupDone: true}), null);
  assert.equal(track({theme: 'dark'}, before), null);
});

test('why they stopped: a known reason, the step they were on, optional words; asked once, only mid-setup', async () => {
  const {stopped, shouldAskOnQuit} = await import('../lib/setup-funnel.js');
  assert.deepEqual(stopped({reason: 'notion', text: ' no account '}, {wizardStep: 'notion'}),
    {step: 'stopped', where: 'notion', reason: 'notion', mode: 'quit', said: 'no account'});
  assert.equal(stopped({reason: 'nonsense'}, {}), null);
  assert.equal(stopped({reason: 'time', mode: 'stuck'}, {setupFurthest: 'cv'}).where, 'cv');
  assert.equal(shouldAskOnQuit({}, true), true);
  assert.equal(shouldAskOnQuit({setupDone: true}, true), false);
  assert.equal(shouldAskOnQuit({leaveAsked: true}, true), false);
  assert.equal(shouldAskOnQuit({}, false), false);
});
