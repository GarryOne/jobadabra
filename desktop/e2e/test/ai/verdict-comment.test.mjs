// The verdict pass's issue comment (lib/verdict-comment.mjs): a banner, why, evidence, next step; and the loop's own readers still recognise it.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MARK, parse, refsIn, verdictComment, whyOf} from '../../lib/verdict-comment.mjs';
import {build} from '../../lib/selfheal-stats.mjs';
import {peopleSaid} from '../../triage.mjs';

const raw = 'needs-human\nWhy: desktop/renderer/pages/activity.js:420 turns a digest message into a card and only falls back to raw text when it cannot parse it.\nCheck: the message stored on that run.';

test('the model\'s lines become a banner, a Why, what to check, the code evidence and what happens next', () => {
  const body = verdictComment(raw, {number: 265});
  assert.match(body, /^<!-- ui-loop-verdict:needs-human -->\n> \[!WARNING\]\n> ### 🙋 Verdict: Needs a person/);
  assert.match(body, /### 🧠 Why\n`desktop\/renderer\/pages\/activity\.js:420` turns a digest message into a card/);
  assert.match(body, /### 🔎 What a person should check\nthe message stored on that run\./);
  assert.match(body, /### 📍 Evidence\n\| Where in the code \|\n\|---\|\n\| `desktop\/renderer\/pages\/activity\.js:420` \|/);
  assert.match(body, /### ➡️ What happens next\n.*confirmed/);
  assert.match(body, /· #265<\/sub>$/);
});

test('each verdict has its own banner and next step; an unknown word is "needs a person"', () => {
  assert.match(verdictComment('real\nWhy: x.'), /\[!IMPORTANT\]\n> ### ✅ Verdict: Real — confirmed/);
  assert.match(verdictComment('false-positive\nWhy: works as designed.'), /\[!NOTE\]\n> ### 🚫 Verdict: Not a bug — closed[\s\S]*wontfix-auto/);
  assert.match(verdictComment('harness\nWhy: seeded title.'), /### 🧪 Verdict: Test problem — closed[\s\S]*harness/);
  assert.match(verdictComment('banana\nWhy: ?'), /^<!-- ui-loop-verdict:needs-human -->/);
  assert.match(verdictComment(''), /_The verdict pass wrote no reason\._/);
  assert.deepEqual(refsIn('see src/a.py:3 and desktop/lib/b.js, not foo.js'), ['src/a.py:3', 'desktop/lib/b.js']);
  assert.deepEqual(parse('real\nplain sentence one.\nsecond line.'), {word: 'real', why: 'plain sentence one. second line.', check: '', cause: '', severity: ''});
});

test('the loop still reads its own decorated comments: the verdict count, the review reason, and the fixer ignoring them', () => {
  const body = verdictComment('real\nWhy: the handler loses the filter.');
  assert.match(body, MARK);
  assert.equal(whyOf(body), 'the handler loses the filter.');
  assert.equal(whyOf('Closed as noise: old plain comment.'), 'Closed as noise: old plain comment.');
  const issue = {number: 1, state: 'OPEN', title: 't', createdAt: '2026-10-10T10:00:00Z', labels: [{name: 'source:ai-review'}, {name: 'confirmed'}], comments: [{body, createdAt: '2026-10-10T11:00:00Z', authorAssociation: 'OWNER'}]};
  assert.equal(build({issues: [issue]}).verdicts.real, 1, 'counted as a verdict');
  assert.deepEqual(peopleSaid(issue), [], 'a loop comment never steers the fixer');
});

import {checkEvidence} from '../../lib/verdict-comment.mjs';
test('a real verdict that cites code which does not exist is not trusted', () => {
  const lines = file => ({'desktop/renderer/pages/activity.js': 1000})[file] || 0;
  assert.equal(checkEvidence('real\nWhy: desktop/renderer/pages/activity.js:420 prints it.', lines).word, 'real');
  assert.equal(checkEvidence('real\nWhy: desktop/renderer/pages/nope.js:3 prints it.', lines).word, 'needs-human');
  assert.equal(checkEvidence('real\nWhy: desktop/renderer/pages/activity.js:5000 prints it.', lines).word, 'needs-human');
  assert.equal(checkEvidence('real\nWhy: it is wrong.', lines).word, 'needs-human');
  assert.equal(checkEvidence('false-positive\nWhy: fine.', lines).word, 'false-positive');
});

import {afterEpoch} from '../../lib/stats-epoch.mjs';
test('findings filed before the last recalibration are left out of the statistics', () => {
  assert.equal(afterEpoch({createdAt: '2026-10-08T23:00:00Z'}), false);
  assert.equal(afterEpoch({createdAt: '2026-10-09T10:00:00Z'}), true);
  assert.equal(build({issues: [{number: 1, state: 'CLOSED', title: 't', createdAt: '2026-10-08T10:00:00Z', labels: [{name: 'source:ai-review'}], comments: []}]}).totals.filed, 0);
});
