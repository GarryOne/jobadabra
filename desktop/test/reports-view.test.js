// Reports (renderer/reports-view.js) on 💡 Insights records made by the engine's own writers (test/fixtures/report_insights.py): the weekly
// report in full, the insight history with its feedback and a process issue's evidence, and the funnel's Pipeline table.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {funnelRows, improveLines, insightItems, weeklyCardOf, weeklyReports} from '../renderer/reports-view.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const python = process.env.JOBADABRA_CHECK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const run = spawnSync(python, [path.join(here, 'fixtures/report_insights.py')], {cwd: path.join(here, '../..'), encoding: 'utf8',
  env: {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', JOBADABRA_FOLLOW_APP: '0'}});
assert.equal(run.status, 0, run.stderr);
const insights = JSON.parse(run.stdout);
const words = group => group.lines.map(line => line.text ?? line.fold);

test('the demo\'s reports are the writers\' output (regenerate: python3 desktop/test/fixtures/report_insights.py > desktop/demo/reports.json)', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(here, '../demo/reports.json'), 'utf8')), insights);
});

test('the weekly report in full: finding, priorities, what worked, change, focus, numbers, the week\'s daily insights', () => {
  const [week] = weeklyReports(insights);
  assert.equal(week.title, 'Quiet week: 2 applications, 1 interview');
  assert.deepEqual(week.groups.map(group => group.title), ['', 'Priorities from recurring evidence', 'What worked', 'Change next week', 'Focus', 'Numbers', 'Daily insights this week']);
  assert.match(words(week.groups[0])[0], /^Replies came only from jobs posted under 3 days ago$/);
  assert.ok(words(week.groups.at(-1)).some(line => /Timing: Replies come within 2 days of applying — Useful/.test(line)));
});

test('one report a day (re-runs keep the newest), newest week first', () => {
  const again = {...insights[0], id: 'later', created_at: 'z', title: 'Re-run'};
  assert.deepEqual(weeklyReports([insights[0], again]).map(week => week.title), ['Re-run']);
});

test('the insight history: newest first, its feedback, a daily one\'s evidence and step, a process issue\'s supported hypothesis', () => {
  const items = insightItems(insights);
  assert.deepEqual(items.map(item => item.category), ['Process', 'Skills', 'Timing']);
  assert.equal(items.find(item => item.category === 'Timing').feedback, 'Useful');
  assert.deepEqual(items.find(item => item.category === 'Timing').evidence, ['6 of 7 replies within 2 days', '7 of 10 got a reply']);
  const process = items[0].groups.flatMap(words);
  assert.ok(process.some(line => /^Supported hypothesis: 3 applications, 2 employers/.test(line)));
  assert.ok(process.includes('We need deeper Kubernetes operations'));
});

test('the funnel: from previous with its counts, of applied, still open; the engine\'s lines to improve, else its one step', () => {
  const funnel = {steps: [{step: 'Prepared', reached: 40, now: 30}, {step: 'Applied', reached: 10, now: 4, of_applied: 1}, {step: 'Replied', reached: 4, now: 1, of_applied: 0.4}],
    improve: {step: 'Replied', advice: 'Check the level.'}};
  assert.deepEqual(funnelRows(funnel).map(row => [row.fromPrevious, row.ofApplied, row.open]), [['—', '—', 30], ['25%  (10/40)', '100%', 4], ['40%  (4/10)', '40%', 1]]);
  assert.deepEqual(improveLines(funnel), ['Improve Replied: Check the level.']);
  assert.deepEqual(improveLines({...funnel, summary: ['a', 'b']}), ['a', 'b']);
});

test('a weekly report becomes the card Recent activity draws, and its other sections keep their evidence links', () => {
  const week = {title: 'Quiet week', groups: [
    {title: '', lines: [{text: 'Replies came only from fresh jobs', quote: true}, {text: 'You sent 2 applications.'}]},
    {title: 'Priorities from recurring evidence', lines: [{text: 'Rejections cite Kubernetes'}, {text: 'Example Cloud · employer feedback: deeper Kubernetes · https://jobs.example.com/1'}]},
    {title: 'What worked', lines: [{text: 'Recruiter channel: 2 of 2'}]},
    {title: 'Change next week', lines: [{text: 'Send the kits'}, {text: 'Apply within 3 days'}]},
    {title: 'Focus', lines: [{text: 'Five applications in Zurich'}]}]};
  const {weekly, extra} = weeklyCardOf(week);
  assert.deepEqual(weekly, {headline: 'Quiet week', finding: 'Replies came only from fresh jobs', summary: 'You sent 2 applications.',
    worked: ['Recruiter channel: 2 of 2'], change: ['Send the kits', 'Apply within 3 days'], focus: 'Five applications in Zurich'});
  assert.deepEqual(extra, [{title: 'Priorities from recurring evidence', lines: [{text: 'Rejections cite Kubernetes'},
    {text: 'Example Cloud · employer feedback: deeper Kubernetes', url: 'https://jobs.example.com/1'}]}]);
});
