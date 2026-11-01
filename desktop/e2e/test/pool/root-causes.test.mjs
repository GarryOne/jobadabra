// The roots of stale and false-positive findings (5 Oct 2026): a finding about code that changed since the tested build is held, and an end-to-end step that expects words the window
// no longer shows is caught when the words are removed, not when the gate fails hours later.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {holdFinding, holdReason, implicatedFiles, pageOf} from '../../lib/freshness.mjs';
import {removedWords, staleExpectations, staleMessage} from '../../lib/stale-expectations.mjs';
import {dropReason} from '../../lib/run-summary.mjs';

test('a view names its page: activity-notion-html, probe-strategy-1 and the suite name all find theirs; nothing else is guessed', () => {
  assert.equal(pageOf('activity-notion-html'), 'activity');
  assert.equal(pageOf('probe-strategy-1'), 'strategy');
  assert.equal(pageOf('app-chrome'), '');
  assert.ok(implicatedFiles({view: 'activity-google-revoked', source: 'ai-review'}).includes('desktop/renderer/pages/activity.js'));
  assert.ok(implicatedFiles({view: 'calendar', source: 'suite-failure'}, {suite: 'calendar'}).includes('desktop/e2e/suites/calendar.mjs'), 'a failed step is also about its suite file');
  assert.deepEqual(implicatedFiles({view: 'app-chrome', source: 'layout-check'}), [], 'the chrome is everywhere: nothing specific');
});

test('a finding is held only when main is ahead of the tested build and a file it is about changed; never a code-review finding', () => {
  const finding = {view: 'activity-google-revoked', source: 'ai-review'};
  const changed = ['desktop/renderer/pages/activity.js', 'desktop/renderer/style.css'];
  assert.deepEqual(holdFinding(finding, {behind: 12, changed}), {hold: true, files: ['desktop/renderer/pages/activity.js']});
  assert.equal(holdFinding(finding, {behind: 0, changed}).hold, false, 'the tested build is main');
  assert.equal(holdFinding(finding, {behind: null, changed}).hold, false, 'unknown distance');
  assert.equal(holdFinding(finding, {behind: 12, changed: ['desktop/renderer/style.css']}).hold, false, 'only a shared style changed');
  assert.equal(holdFinding(finding, {behind: 12, changed: []}).hold, false);
  assert.equal(holdFinding({view: 'activity', source: 'code-review'}, {behind: 12, changed}).hold, false, 'a code review reads the code at main already');
  assert.match(holdReason(['desktop/renderer/pages/activity.js'], '3806ebe'), /^held for recheck: desktop\/renderer\/pages\/activity.js changed since the tested build 3806ebe/);
  assert.equal(dropReason(holdReason(['a.js'], 'abc1234')), 'held-for-recheck');
});

test('the producer holds a finding about a page that changed since the tested build, and files it when only unrelated files changed', async () => {
  const {triage} = await import('../../triage.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'held-'));
  fs.writeFileSync(path.join(dir, 'ui-findings.json'), JSON.stringify([{view: 'activity-panel', severity: 'severe', kind: 'tall-row', detail: 'a row is 700px tall'}]));
  const run = changed => {
    const calls = [];
    const gh = args => {
      calls.push(args.join(' '));
      if (args[0] === 'issue' && args[1] === 'list') return '[]';
      if (args[0] === 'api' && /compare\/3806ebe\.\.\.main/.test(args[1])) return args.includes('.ahead_by') ? '7\n' : JSON.stringify(changed);
      return args[0] === 'pr' ? '[]' : '';
    };
    return {result: triage({artifacts: dir, runUrl: 'https://x/runs/3', gh, repo: 'o/r', build: 'main @ 3806ebe'}), calls};
  };
  const held = run(['desktop/renderer/pages/activity.js']);
  assert.deepEqual([held.result.filed.length, held.result.held.length], [0, 1]);
  assert.ok(!held.calls.some(call => call.startsWith('issue create --title [auto-ui]')), 'no finding issue (the pinned ledgers are not findings)');
  assert.ok(held.result.dropped.some(item => /^held for recheck/.test(item.why)));
  const filed = run(['desktop/renderer/style.css', 'README.md']);
  assert.equal(filed.result.filed.length, 1, 'unrelated changes: filed as before');
});

test('words a push removes from the window that a suite still expects are listed with the line; words that moved or never were words are not', () => {
  const diff = [
    "--- a/desktop/renderer/pages/calendar.js", "+++ b/desktop/renderer/pages/calendar.js",
    "-  box.append(icon('calendar'), el('b', '', 'Nothing scheduled'), el('span', 'muted small', 'Email bookings appear after the next Gmail check.'));",
    "+  box.append(icon('calendar'), el('b', '', 'No upcoming interviews'), el('span', 'muted small', 'Email bookings appear after the next Gmail check.'));",
    "-  const url = 'https://example.test/path';", "-  if (a === 'x') return `${name} is open`;", "-      <h2>Coming up soon</h2>", "-  const tiny = 'Skip';",
  ].join('\n');
  const removed = removedWords(diff);
  assert.ok(removed.includes('Nothing scheduled') && removed.includes('Email bookings appear after the next Gmail check.') && removed.includes('Coming up soon'));
  assert.ok(!removed.some(word => /example\.test|\$\{|Skip/.test(word)), 'a URL, a template and a one-word label are not words a person reads');
  const suites = [{file: 'desktop/e2e/suites/calendar.mjs', text: "line one\nif (!/Nothing scheduled/.test(text)) throw new Error('x');\nawait page.click('#skip');"}, {file: 'desktop/e2e/suites/focus.mjs', text: "expect('Coming up soon')"}];
  const found = staleExpectations({removed, present: "el('b', '', 'No upcoming interviews'); Email bookings appear after the next Gmail check.", suites});
  assert.deepEqual(found, [{word: 'Nothing scheduled', file: 'desktop/e2e/suites/calendar.mjs', line: 2}, {word: 'Coming up soon', file: 'desktop/e2e/suites/focus.mjs', line: 1}]);
  assert.match(staleMessage(found), /calendar.mjs:2  "Nothing scheduled"[^]*Update the step to the new words in the same change/);
  assert.deepEqual(staleExpectations({removed, present: "'Nothing scheduled' 'Coming up soon' Email bookings appear after the next Gmail check.", suites}), [], 'the words are still in the product: nothing to update');
  assert.deepEqual(removedWords(''), []);
});
