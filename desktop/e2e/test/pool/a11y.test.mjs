// Accessibility by axe-core: serious and critical violations become one finding per rule, listing the pages; a rule that is gone is cleared.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {a11yFindings, checkA11y, tally} from '../../lib/a11y.mjs';
import {normalize, issueTitle} from '../../lib/triage.mjs';

test('a button with no name is found on a page; a clean page has nothing', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage();
    await page.setContent('<html lang="en"><head><title>t</title></head><body><main><h1>Jobs</h1><button></button><input type="text"></main></body></html>');
    const bad = await checkA11y(page);
    assert.ok(bad.some(item => item.rule === 'button-name'), JSON.stringify(bad));
    await page.setContent('<html lang="en"><head><title>t</title></head><body><main><h1>Jobs</h1><button>Save</button><label>Name <input type="text"></label></main></body></html>');
    assert.deepEqual(await checkA11y(page), []);
  } finally { await browser.close(); }
});

test('violations are tallied per rule over pages and filed once per rule', () => {
  const store = {};
  tally(store, 'focus', [{rule: 'button-name', impact: 'critical', help: 'Buttons must have discernible text', nodes: 2, example: '#x'}]);
  tally(store, 'jobs', [{rule: 'button-name', impact: 'critical', help: 'Buttons must have discernible text', nodes: 1, example: '#y'}]);
  tally(store, 'settings', []);
  assert.equal(store.checked, 3);
  const found = a11yFindings(store);
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /^button-name on focus, jobs \(3 element\(s\), critical, e\.g\. #x\): "Buttons must have discernible text"$/);
  assert.equal(issueTitle(normalize({ui: found})[0]), '[auto-ui] a11y: a11y on a11y: button-name: "Buttons must have discernible text"');
});

test('an accessibility issue is marked not seen when a suite checked pages and the rule was gone', async () => {
  const {triage} = await import('../../triage.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-'));
  fs.writeFileSync(path.join(dir, 'ui-findings.json'), '[]');
  fs.writeFileSync(path.join(dir, 'a11y.json'), JSON.stringify({checked: 5, rules: ['color-contrast']}));
  const issue = rule => ({number: rule.length, state: 'OPEN', title: `[auto-ui] a11y: a11y on a11y: ${rule}: "x"`, body: '**MEDIUM** · a11y · found by the layout check', labels: [{name: 'auto-ui'}, {name: `fp:${rule}`}], comments: []});
  const gh = args => (args[0] === 'issue' && args[1] === 'list' ? JSON.stringify([issue('button-name'), issue('color-contrast')]) : args[0] === 'pr' ? '[]' : '');
  const out = triage({artifacts: dir, runUrl: 'https://x/runs/7', gh});
  assert.deepEqual(out.gone, ['button-name'], 'button-name is gone; color-contrast is still there');
});
