// The fixer's pull request text (lib/pr-body.mjs): headings, facts, proof table, before/after, the right merge rule.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prBody, sections} from '../../lib/pr-body.mjs';

const labels = ['auto-ui', 'severity:medium', 'kind:a11y', 'view:activity-panel', 'platform:mac', 'suite:activity', 'confirmed'];

test('Claude\'s three lines become the sections; other text is kept as what happened', () => {
  const s = sections('Root cause: style.css:157 uses --signal.\nChanged both to --signal-ink.\nTest: desktop/test/x.test.js.\nContinued line.');
  assert.equal(s.rootCause, 'style.css:157 uses --signal.');
  assert.match(s.change, /^Changed both to --signal-ink\./);
  assert.match(s.test, /x\.test\.js\. Continued line\./);
});

test('a window-only fix: facts line, code-formatted files, proof table, before/after, the 80-line tip, Fixes', () => {
  const body = prBody({number: 111, labels, text: 'Root cause: desktop/renderer/style.css:157 colours the link with --signal.\nChange: use --signal-ink.\nTest: x', shot: 'https://x/y.png',
    files: ['desktop/renderer/style.css', 'desktop/test/a.test.js'], added: 19, removed: 2, tests: ['desktop/test/a.test.js']});
  assert.match(body, /^> \[!NOTE\]\n> 🤖 \*\*Automatic fix for #111\*\* — 🟠 Medium · ♿ Accessibility · 📍 `activity-panel` · 🖥️ mac · 🧪 `activity` · ✅ confirmed/);
  assert.match(body, /## 🔎 Root cause\n`desktop\/renderer\/style\.css:157` colours the link/);
  assert.match(body, /\| Test added \| `desktop\/test\/a\.test\.js` \|/);
  assert.match(body, /2 files · \*\*\+19 −2\*\* \(21 lines\) · window only/);
  assert.match(body, /!\[before\]\(https:\/\/x\/y\.png\)/);
  assert.match(body, /\[!TIP\]\n> \*\*Window-only change\.\*\*/);
  assert.match(body, /\nFixes #111\n/);
});

test('an engine fix says the stricter rule; no screenshot and no stated cause still read well', () => {
  const body = prBody({number: 5, labels: ['severity:high', 'kind:functionality'], files: ['src/focus.py', 'tests/test_focus.py'], added: 10, removed: 1, tests: ['tests/test_focus.py']});
  assert.match(body, /\[!IMPORTANT\]\n> \*\*Engine \/ app-logic change\.\*\*/);
  assert.match(body, /_not stated: read the diff_/);
  assert.match(body, /_no screenshot_/);
});
