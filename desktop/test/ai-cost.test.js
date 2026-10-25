// An AI cost is shown only when the user's engine is their own API key (owner, 25 Oct 2026: "if it's free AI, or if it's own subscription, we should show no
// AI cost, nowhere in the app"). Guards: the rule per engine, every window display fed a cost, and a source scan that fails when a file draws a dollar amount
// without going through renderer/ai-cost.js (or lib/ai/names.js costVisible for the main process).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {costText, costVisible, dollars, setCostEngine, setCostsShown} from '../renderer/ai-cost.js';
import {billingLabel, lastCost, usageAfter} from '../renderer/ai-engine-view.js';
import {costLine} from '../renderer/cv-check-model.js';
import {costVisible as mainCostVisible} from '../lib/ai/names.js';
import {costLine as readyLine} from '../lib/ready-top.js';

const ENGINES = {api: true, openai: true, free: false, cli: false, codex: false, null: false};
const repo = fileURLToPath(new URL('../..', import.meta.url));

test('today nobody sees an AI cost, on any engine', () => {
  for (const engine of Object.keys(ENGINES)) assert.equal(costText(0.03, dollars, engine === 'null' ? null : engine), '', engine);
  assert.equal(mainCostVisible({settings: () => ({aiEngine: 'api'}), secret: () => 'sk-ant-x'}), false);
});

test('if costs come back: only the API-key engines see one, Free AI and both plans none', () => {
  setCostsShown(true);
  for (const [engine, seen] of Object.entries(ENGINES)) {
    const name = engine === 'null' ? null : engine;
    assert.equal(costVisible(name), seen, engine);
    assert.equal(costText(0.03, dollars, name), seen ? '$0.03' : '', engine);
    assert.equal(costText(0, dollars, name), '', `${engine}: nothing spent shows nothing`);
  }
});

test('the main process agrees with the window on the same settings', () => {
  const storage = (settings, key = '') => ({settings: () => settings, secret: () => key});
  const cases = [[{aiFree: true}, '', 'free'], [{aiFree: true, aiEngine: 'cli'}, '', 'cli'], [{aiEngine: 'cli'}, '', 'cli'], [{aiEngine: 'codex'}, '', 'codex'],
    [{aiEngine: 'api'}, 'sk-ant-x', 'api'], [{aiEngine: 'openai'}, '', 'openai'], [{}, 'sk-ant-x', 'api'], [{}, '', null]];
  for (const [settings, key, engine] of cases) assert.equal(mainCostVisible(storage(settings, key), true), costVisible(engine), JSON.stringify(settings));
});

test('every display that draws a measured cost hides it off the API key', () => {
  setCostsShown(true);
  const run = {usd: 0.03, billing: ''}, ai = {usd: 0.05, billing: 'api'};
  const draws = {
    'cv-check cost line': () => costLine('content', {billing: 'api', ai}),
    'cover letter after': () => usageAfter({paidBy: 'api', usd: 0.03}),
    'cover letter last': () => lastCost({paidBy: 'api', usd: 0.03}),
    'run billing label': () => billingLabel({billing: 'Both', usd: 0.03}),
    'fill popup': () => readyLine([{needsKit: true, needsCv: false, usd: 0.04}], 1, {showCost: costVisible()}),
  };
  for (const [engine, seen] of Object.entries(ENGINES)) {
    setCostEngine(() => (engine === 'null' ? null : engine));
    for (const [name, draw] of Object.entries(draws)) assert.equal(/\$\d/.test(draw()), seen, `${name} on ${engine}: ${draw()}`);
    assert.equal(costText(run.usd) !== '', seen, `run card on ${engine}`);
  }
  setCostEngine(() => null);
  setCostsShown(false);
});

// The source scan: a template or string that draws "$" + a number via toFixed (the pattern every cost display used) is allowed only in a file that imports ai-cost.js.
test('a file that draws a dollar amount imports the cost rule', () => {
  const files = execFileSync('git', ['ls-files', '-z', 'desktop/renderer', 'desktop/lib'], {cwd: repo, maxBuffer: 1 << 26}).toString().split('\0')
    .filter(file => /\.js$/.test(file) && !/[\\/](test|ladder)[\\/]/.test(file));
  const DRAWS = /\$\$\{[^}]*(toFixed|dollars)|'\$' *\+|`\$\$\{/;
  const bypass = files.filter(file => {
    const text = readFileSync(join(repo, file), 'utf8');
    return DRAWS.test(text.split('\n').filter(line => !/^\s*(\/\/|\*)/.test(line)).join('\n')) && !/ai-cost\.js|costVisible|showCost/.test(text);
  });
  assert.deepEqual(bypass, [], 'these draw a dollar amount without the cost rule (renderer/ai-cost.js costText, or lib/ai/names.js costVisible)');
});
