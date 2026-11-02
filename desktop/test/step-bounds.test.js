// Every awaited debugger / page / AI step of the dropdown clicks has a deadline (extension/step-bound.js), and one menu has a ceiling (extension/combo-click.js): one control that never
// answers must not hold back the rest of the fill (14 Oct 2026, 5afa5a8: a suggest-only address box held the late answers' pass 30-40 s, then "dead end: silent").
// The siblings: attachDebugger, chrome.debugger.sendCommand, chrome.scripting.executeScript, apiFor (the AI pick) inside clickCombosNow; the menu's own wait loop in combo-click.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {clickCombo} from '../../extension/combo-click.js';
import {StepTimeout, within} from '../../extension/step-bound.js';

const read = name => fs.readFileSync(fileURLToPath(new URL(`../../extension/${name}`, import.meta.url)), 'utf8');

test('within: a step that never answers rejects with its name; one that answers passes through', async () => {
  await assert.rejects(within(20, 'mouse', () => new Promise(() => {})), error => error instanceof StepTimeout && error.step === 'mouse');
  assert.equal(await within(1000, 'page', async () => 7), 7);
});

test('clickCombosNow: no debugger, page or AI call outside a deadline (bound / within)', () => {
  const source = read('flow.js'), start = source.indexOf('async function clickCombosNow'), body = source.slice(start, source.indexOf('\n}\n', start));
  const calls = ['attachDebugger(', 'chrome.debugger.sendCommand(', 'chrome.scripting.executeScript(', 'apiFor('];
  const bounded = [...body.matchAll(/(?:bound\('(\w+)'|within\(STEP_MS\.(\w+))/g)].length;
  assert.ok(bounded >= 6, `the steps are wrapped (found ${bounded} deadlines)`);
  // A bare call is one that sits in a statement of its own, outside a bound(...) / within(...) wrapper's body: the wrappers are the only statements that hold these calls.
  const lines = body.split('\n');
  let inside = 0;
  for (const [n, line] of lines.entries()) {
    const opens = /\b(bound\('\w+'|within\(STEP_MS\.\w+)/.test(line);
    if (opens) inside += 1;
    const has = calls.find(call => line.includes(call));
    if (has && !opens && !inside) assert.fail(`flow.js clickCombosNow line ${n + 1} awaits ${has} with no deadline: wrap it in bound() / within()`);
    if (inside && /^\s*\}\)(\.|;|,)?|^\s*\}\);?\s*$|\)\);\s*$/.test(line) && !opens) inside = Math.max(0, inside - 1);
  }
});

test('clickCombo: a page that keeps asking for typing is given up at the ceiling, not waited on for ever', async () => {
  let clock = 0;
  const page = async func => { const text = String(func); if (text.includes('__jobadabraNeed;')) return {kind: 'type', text: 'x'}; if (text.includes('ArmedCount')) return 1; return null; };
  const slow = async (...args) => { clock += 900; return page(...args); };   // a busy machine: every page call takes 0.9 s of real time
  const result = await clickCombo({page: slow, click: async () => {}, spot: {x: 1, y: 1}, type: async () => {}, sleep: async ms => { clock += ms; }, now: () => clock});
  assert.equal(result.picked, false);
  assert.equal(result.capped, true);
  assert.ok(clock <= 34000, `waited ${clock} ms in all`);
});
