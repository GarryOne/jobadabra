// The CV check card (renderer/cv-check-view.js): every state the old card drew is still drawn (not checked, parser only, parser + content), fixes first,
// the rest folded, the cost line under each action, and the header names the CV the result belongs to.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {setCostEngine, setCostsShown} from '../renderer/ai-cost.js';

setCostsShown(true);
setCostEngine(() => 'api');   // these cases are the API-key user's; test/ai-cost.test.js covers every other engine

install();
const ids = ['setting-cvcheck', 'cvc-state', 'cvc-scores', 'cvc-fixes', 'cvc-folds', 'cvc-run', 'cvc-ai-run', 'cvc-run-cost', 'cvc-ai-cost', 'cvc-message'];
for (const id of ids) { const node = globalThis.document.createElement(id.endsWith('run') ? 'button' : 'div'); node.id = id; globalThis.document.body.append(node); }
const {showCvCheck} = await import('../renderer/cv-check-view.js');
const {cvCheck} = await import('../lib/demo.js');
const $ = id => globalThis.document.getElementById(id);
const all = node => [node, ...(node.children || []).flatMap(each => all(each))];
const texts = id => all($(id)).map(node => node.textContent).join(' ');

test('not checked yet: no scores, no fixes, the review waits for the readability check', () => {
  showCvCheck(null);
  assert.equal($('cvc-state').textContent, 'Not checked yet');
  assert.ok($('cvc-scores').hidden && $('cvc-fixes').hidden && $('cvc-folds').hidden);
  assert.ok($('cvc-ai-run').disabled);
  assert.equal($('cvc-run-cost').textContent, 'No AI usage');
  assert.equal($('setting-cvcheck').dataset.summary, 'Not checked yet');
});

test('parser only: readability ring, content not reviewed, parser fixes, passed checks folded', () => {
  showCvCheck({...cvCheck, ai: undefined, billing: 'subscription'}, {cvName: 'CV_Alex_Morgan.pdf', when: () => '2 Oct'});
  assert.equal($('cvc-state').textContent, 'Checked 2 Oct · CV_Alex_Morgan.pdf');
  assert.match(texts('cvc-scores'), /Readability/);
  assert.match(texts('cvc-scores'), /Not reviewed yet/);
  assert.equal(all($('cvc-fixes')).filter(node => node.className === 'cvc-fixline').length, 3);
  assert.match(texts('cvc-folds'), /Passed checks/);
  assert.equal($('cvc-ai-run').disabled, false);
  assert.equal($('cvc-ai-cost').textContent, 'Uses your plan allowance');
});

test('parser + content: both rings, every fix in one ranked list, score parts, strengths, missing terms and text folded', () => {
  showCvCheck({...cvCheck, billing: 'api'}, {cvName: 'CV_Alex_Morgan.pdf'});
  const rows = all($('cvc-fixes')).filter(node => node.className === 'cvc-fixline');
  assert.equal(rows.length, 5);
  assert.match(rows[0].textContent, /High/);
  for (const words of ['Keywords for your target roles · 70', 'Working well', 'Prometheus', 'Extracted text', 'Alex Morgan']) assert.match(texts('cvc-folds'), new RegExp(words));
  assert.equal($('cvc-ai-cost').textContent, 'Last review: $0.05 · This run may differ.');
  assert.equal($('setting-cvcheck').dataset.summary, 'Mostly readable · 3 issues · 2 content suggestions');
});
