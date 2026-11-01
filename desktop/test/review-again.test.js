// Interviews → ⋯ "Review again" (renderer/review-again.js): only on reviewed rows, with its cost in the label, busy
// while it runs, a message for every outcome; and it goes through the first review's IPC (demo mode writes nothing).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {BUSY, LABEL, START, againItem, doneMessage} from '../renderer/review-again.js';
import {mainSource} from './main-source.js';

test('a reviewed row gets "Review again" with its cost; a row not reviewed yet does not', () => {
  const run = () => 'ran';
  assert.equal(againItem({id: 'p', overall: ''}, false, run), null);
  const item = againItem({id: 'p', overall: 'neutral'}, false, run);
  assert.equal(item.label, 'Review again · updates the job');
  assert.equal(item.label, LABEL);
  assert.equal(item.run(), 'ran');
  assert.match(item.title, /empty fields/);
});

test('while it runs the entry says so and a second press does nothing', () => {
  let ran = 0;
  const item = againItem({id: 'p', overall: 'positive'}, true, () => ran++);
  assert.equal(item.label, BUSY);
  item.run();
  assert.equal(ran, 0);
  assert.match(START, /again/);
});

test('every outcome has a message: done here, on GitHub, failed', () => {
  assert.deepEqual(doneMessage({ok: true, summary: 'Interview analysed again (Huxley, Recruiter screen, 6 questions, $0.052). Filled Salary (EUR 100-150k/year)'}),
    ['Interview analysed again (Huxley, Recruiter screen, 6 questions, $0.052). Filled Salary (EUR 100-150k/year). The review on the Notion page was replaced.', 'ok']);
  assert.equal(doneMessage({ok: true, cloud: true})[1], 'ok');
  assert.match(doneMessage({ok: true, cloud: true})[0], /GitHub/);
  const [text, tone] = doneMessage({ok: false, error: 'overloaded'});
  assert.equal(tone, 'error');
  assert.match(text, /overloaded.*not changed/);
  assert.equal(doneMessage(undefined)[1], 'error');
});

test('a provider error is a sentence, not the API dump; a refused duplicate does not claim a review was replaced', () => {
  const dump = "anthropic.BadRequestError: Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'This model does not support the effort parameter.'}}";
  const [text, tone] = doneMessage({ok: false, error: dump});
  assert.equal(tone, 'error');
  assert.doesNotMatch(text, /BadRequestError|Error code|\{'type'/);
  assert.match(text, /does not support the effort parameter.*not changed/);
  // main.js answers a second press inside the 2-minute window with {ok, already, summary} and runs nothing
  const [again, againTone] = doneMessage({ok: true, already: true, summary: 'Already reviewing this interview — it shows in Recent activity'});
  assert.equal(againTone, 'ok');
  assert.doesNotMatch(again, /was replaced/);
  assert.match(again, /Already reviewing/);
});

test('the first review and the insights refresh say a provider error as a sentence too', () => {
  const page = fs.readFileSync(new URL('../renderer/pages/interviews.js', import.meta.url), 'utf8');
  assert.match(page, /import \{[^}]*\bhumanError\b[^}]*\} from '\.\.\/run-warnings\.js'/);
  assert.ok(page.includes(": humanError(result.error), result.ok ? 'ok' : 'error')"));
  assert.ok(page.includes("humanError(result.error || 'Could not refresh the insights')"));
  assert.ok(page.includes('result.already ? result.summary'));   // a refused duplicate review is not "on the Notion page"
});

test('the page wires it into the row menu through the same review IPC; demo mode writes nothing', () => {
  const page = fs.readFileSync(new URL('../renderer/pages/interviews.js', import.meta.url), 'utf8');
  assert.match(page, /row\.overall \? \[\{again: true, run: \(\) => reviewAgainRow\(row\.id\)\}\]/);
  assert.match(page, /await iv\.review\(pageId, 'Review again'\)\.catch/);
  // Which button asked is carried into the app's log, so a second dispatch is attributable.
  assert.match(page, /iv\.review\(pageId, why\)/);
  assert.match(page, /reviewRow\(result\.id, 'Save & review'\)/);
  const main = mainSource();
  // Which button asked is carried into the app's log, so a second dispatch is attributable.
  assert.match(main, /caller = `Interview review \(\$\{why \|\| 'interviews page'\}\)`/);
  assert.match(main, /appLog\('dispatch', `refused \$\{caller\}/);
  assert.match(main, /ipcMain\.handle\('ivReview'/);                       // one handler, whatever asks for the review
  assert.match(main, /if \(DEMO\) return \{ok: true, summary: 'Reviewed \(demo\): nothing was written'\}/);  // demo writes nothing
  const demo = JSON.parse(fs.readFileSync(new URL('../demo/interviews.json', import.meta.url), 'utf8'));
  assert.ok(demo.saved.some(row => row.overall), 'demo data has a reviewed row, so the entry shows');
});
