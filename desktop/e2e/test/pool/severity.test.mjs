// The judge rates severity (6 Oct 2026): a failed step and a console error were "medium" whatever they did to a person, and #312, a screen contradicting
// itself, was a `text` finding capped to medium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {judgedSeverity, severityOfBody, withSeverity} from '../../lib/severity.mjs';
import {cappedSeverity, parseFindings} from '../../lib/vision.mjs';
import {parse} from '../../lib/verdict-comment.mjs';

test('the verdict\'s Severity line sets the level of a real or parked finding, never of noise', () => {
  assert.equal(parse('real\nWhy: x.\nSeverity: High').severity, 'high');
  const step = {source: 'suite-failure', kind: 'test-failure'};
  assert.equal(judgedSeverity('real\nWhy: x.\nSeverity: high', step), 'high');
  assert.equal(judgedSeverity('needs-human\nWhy: x.\nCheck: y.\nSeverity: low', {source: 'layout-check', kind: 'console-error'}), 'low', '#307: a menu left open on scroll');
  assert.equal(judgedSeverity('harness\nWhy: x.\nSeverity: high', step), '', 'a test mistake has no product severity');
  assert.equal(judgedSeverity('real\nWhy: x.', step), '', 'no line, no change');
  assert.equal(judgedSeverity('real\nWhy: x.\nSeverity: high', {source: 'ai-review', kind: 'text'}), 'medium', 'the AI review\'s cap still holds for how a page reads');
  assert.equal(judgedSeverity('real\nWhy: x.\nSeverity: high', {source: 'ai-review', kind: 'wrong-result'}), 'high');
});

test('#312: a screen that contradicts a fact is kind wrong-result, and stays high', () => {
  assert.equal(cappedSeverity('high', 'wrong-result', ''), 'high');
  assert.equal(cappedSeverity('high', 'text', ''), 'medium');
  const [kept] = parseFindings(JSON.stringify({findings: [{severity: 'high', kind: 'wrong-result', title: 'Row says Gmail checks replies', detail: '"Gmail checks for replies" while the bar says Gmail not connected', impact: 'they wait for a reply that nothing collects'}]}), 'focus');
  assert.equal(kept.severity, 'high');
});

test('an issue body takes the judged level where the ranking reads it', () => {
  const body = '🟠 **MEDIUM** · test-failure · found by a run of the focus suite\n\n> 📍 Page `focus`';
  assert.equal(withSeverity(body, 'high'), '🔴 **HIGH** · test-failure · found by a run of the focus suite\n\n> 📍 Page `focus`');
  assert.equal(severityOfBody(withSeverity(body, 'low')), 'low');
  assert.equal(withSeverity('**MEDIUM** · x', 'high'), '🔴 **HIGH** · x');
});

test('before filing: a judged failed step is filed at the judge\'s level, and one rated low is not filed', async () => {
  const {triage} = await import('../../triage.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'severity-'));
  for (const [suite, step, message] of [['focus', 'Gmail row says what is true', 'the row says Gmail checks for replies while Gmail is not connected'], ['jobs', 'menu closes on scroll', 'the menu stayed open']]) {
    fs.mkdirSync(path.join(dir, `e2e-artifacts-${suite}`));
    fs.writeFileSync(path.join(dir, `e2e-artifacts-${suite}`, 'suite-failures.json'), JSON.stringify([{suite, step, message}]));   // one finding per suite: its first failed step
  }
  const created = [];
  const gh = args => {
    if (args[0] === 'issue' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'create') { created.push({title: args[args.indexOf('--title') + 1], body: args[args.indexOf('--body') + 1], labels: args[args.indexOf('--label') + 1]}); return `https://github.com/o/r/issues/${created.length}`; }
    return args[0] === 'pr' ? '[]' : '';
  };
  const pending = triage({artifacts: dir, runUrl: 'https://x/runs/1', gh, pendingOnly: true}).pending;
  const id = words => pending.find(item => item.title.includes(words)).id;
  const out = triage({artifacts: dir, runUrl: 'https://x/runs/1', gh, verdicts: {
    [id('Gmail row')]: 'real\nWhy: src/focus.py:174 says so whatever the connection.\nSeverity: high',
    [id('menu closes')]: 'real\nWhy: desktop/renderer/components.js:102.\nSeverity: low'}});
  const filed = created.filter(item => item.title.startsWith('[auto-ui]'));
  assert.deepEqual(filed.map(item => item.title), ['[auto-ui] focus: step failed: Gmail row says what is true']);
  assert.match(filed[0].body, /^🔴 \*\*HIGH\*\*/);
  assert.match(filed[0].labels, /severity:high/);
  assert.ok(out.dropped.some(item => item.why === 'judged low before filing (never filed)' && item.title.includes('menu closes')));
});
