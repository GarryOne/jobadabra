// By-design lessons for the screenshot review (lib/review-lessons.mjs): an issue closed as by design becomes a line in the next review of the same kind of page.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fetchLessons, lessonFromIssue, lessonsFor, lessonsText} from '../lib/review-lessons.mjs';

const issue = (number, view, title) => ({number, title: `[auto-ui] ${view}: ${title}`, body: `🟠 **MEDIUM** · text\n\n> 📍 Page \`${view}\` · suite \`activity\` · Mac\n`});
const verdict = why => ({body: `<!-- ui-loop-verdict:false-positive -->\n> ### 🚫 Verdict: Not a bug\n\n### 🧠 Why\n${why}\n\n### ➡️ What happens next\nClosed.\n\n<sub>UI loop</sub>`});

test('an issue becomes {view, title, why} from its body, title and the verdict\'s Why', () => {
  assert.deepEqual(lessonFromIssue(issue(1764, 'activity-run-failed', 'Technical log open on a stopped run'), [{body: 'first look'}, verdict('A run watched to its end keeps its log open;\nreopened, it is folded.')]),
    {issue: 1764, view: 'activity-run-failed', title: 'Technical log open on a stopped run', why: 'A run watched to its end keeps its log open; reopened, it is folded.'});
  assert.equal(lessonFromIssue({number: 1, title: 'x', body: 'no page named'}), null);
});

test('a page gets the lessons of its own kind, newest first; a failure screenshot gets all; an eval can leave one out', () => {
  const lessons = [lessonFromIssue(issue(338, 'activity-run-failed', 'Log open')), lessonFromIssue(issue(1730, 'focus', 'No search yet')), lessonFromIssue(issue(1764, 'activity-run-failed', 'Log open again'))];
  assert.deepEqual(lessonsFor(lessons, 'activity-limit-paused').map(l => l.issue), [1764, 338]);
  assert.deepEqual(lessonsFor(lessons, 'focus-narrow').map(l => l.issue), [1730]);
  assert.deepEqual(lessonsFor(lessons, 'failure-screenshot').map(l => l.issue), [1764, 1730, 338]);
  assert.deepEqual(lessonsFor(lessons, 'activity-run-failed', {exclude: 1764}).map(l => l.issue), [338]);
  assert.match(lessonsText(lessonsFor(lessons, 'focus')), /BY DESIGN[\s\S]*#1730 \(focus\) "No search yet"/);
  assert.equal(lessonsText([]), '');
});

test('reads the closed by-design AI-review issues; GitHub down is a warning and no lessons', async () => {
  const asked = [];
  const fetchImpl = async url => { asked.push(url); return {ok: true, json: async () => (url.includes('/comments') ? [verdict('By design.')] : [issue(1791, 'activity-after-tasks', 'Not available'), {number: 5, pull_request: {}}])}; };
  const lessons = await fetchLessons({repo: 'o/r', token: 't', fetchImpl});
  assert.deepEqual(lessons, [{issue: 1791, view: 'activity-after-tasks', title: 'Not available', why: 'By design.'}]);
  assert.match(decodeURIComponent(asked[0]), /state=closed&labels=source:ai-review,resolution:by-design/);
  const said = [];
  assert.deepEqual(await fetchLessons({repo: 'o/r', fetchImpl: async () => ({ok: false, status: 403}), log: line => said.push(line)}), []);
  assert.match(said[0], /lessons not read \(403/);
});
