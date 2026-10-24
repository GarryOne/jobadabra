import assert from 'node:assert/strict';
import {test} from 'node:test';
import {groupWarnings, humanError, newDetails, sentences, stepNote} from '../renderer/run-warnings.js';
import {setWhere} from '../renderer/store-name.js';
import {activitySource} from './activity-source.js';

test('a rate-limit detail that only repeats the banner is not listed again', () => {
  const grouped = groupWarnings(['RateLimitError: Error code: 429']);
  assert.deepEqual(newDetails(grouped), []);
});

test('details that name jobs or other problems stay', () => {
  const grouped = groupWarnings(['Skipped job 5: Error code: 429', 'Something else failed']);
  assert.equal(newDetails(grouped).length, 2);
});

test('the Recent activity card lists only new details', () => {
  assert.match(activitySource(), /newDetails\(/);
});

test('a Notion 502 with its HTML error page is one plain sentence, with the words before it kept (#275)', () => {
  const raw = 'cronjob run not opened in Notion: HTTPError: HTTP Error 502: <!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>…</body></html>';
  assert.deepEqual(groupWarnings([raw]), ["The run's row could not be opened in Notion: the service was unavailable (HTTP 502). It is usually back within minutes: try again"]);
  assert.doesNotMatch(groupWarnings([raw])[0], /<|DOCTYPE|HTTPError/);
  assert.equal(humanError('HTTP Error 429: Too Many Requests'), 'the service is busy right now (HTTP 429). Try again in a few minutes');
  assert.equal(humanError('failed: <html><body>oops</body></html>'), 'failed: the service answered with an error page');
  assert.equal(humanError('plain text without any error code'), 'plain text without any error code');
});

test('a detail that only says again what the summary says is not shown as a detail (#285)', () => {
  const line = "The run's row could not be opened in Notion: the service was unavailable (HTTP 502). It is usually back within minutes: try again";
  assert.deepEqual(newDetails([line], line), []);
  assert.deepEqual(newDetails([line, 'Skipped 2 jobs (3, 4): the service was unavailable'], line), ['Skipped 2 jobs (3, 4): the service was unavailable'], 'a different line stays');
  assert.deepEqual(newDetails([line]), [line], 'without a summary nothing is dropped');
});

// #342: "the service was unavailable" said nothing about WHICH service or what was lost. Every run-history warning of the engine (the
// store-neutral wording and Notion's own, opening the row and saving the result) names the store the person chose and what was not saved.
test('a failed run-history write names the store and what was not saved (#342)', () => {
  const reason = 'HTTPError: HTTP Error 502: <!DOCTYPE html><html>…</html>';
  const sentence = 'the service was unavailable (HTTP 502). It is usually back within minutes: try again';
  const opened = ['run not opened in the run history', 'cronjob run not opened in Notion'];
  const saved = ['run not logged to the run history', 'cronjob run not logged to Notion'];
  try {
    for (const [name, notion] of [['Notion', true], ['Jobadabra', false]]) {
      setWhere(name);
      for (const words of opened) assert.deepEqual(groupWarnings([`Warning: ${words}: ${reason}`]), [`The run's row could not be opened in ${name}: ${sentence}`], `${words} on ${name}`);
      for (const words of saved) assert.deepEqual(groupWarnings([`Warning: ${words}: ${reason}`]), [`The run's result could not be saved to ${name}: ${sentence}`], `${words} on ${name}`);
      assert.ok(notion || !/Notion/.test(groupWarnings([`run not opened in the run history: ${reason}`])[0]), 'a Mac store never says Notion');
    }
  } finally { setWhere('Notion'); }
});

// #342: "…: try again And 2 more." ran the sentence into the count. Every sentence ends before the next one starts.
test('sentences: each ends with a full stop before the next, and "And N more." follows a finished sentence', () => {
  assert.equal(sentences(['The run could not be saved: try again']), 'The run could not be saved: try again.');
  assert.equal(sentences(['First one', 'Second one.']), 'First one. Second one.');
  assert.equal(sentences(['First one', 'Second one', 'Third one'], true), 'First one. And 2 more.');
  assert.equal(sentences(['Ends already?'], true), 'Ends already?');
  assert.equal(sentences([]), '');
});

// #342: the step that stopped at "!" says why in one line under its name, from the same warnings the box above lists.
test('a warned step carries the first warning as its one-line reason', () => {
  assert.equal(stepNote(['Warning: run not opened in the run history: HTTPError: HTTP Error 502: <html>']), "The run's row could not be opened in Notion: the service was unavailable (HTTP 502). It is usually back within minutes: try again.");
  assert.equal(stepNote([]), '');
  assert.match(stepNote(['Skipped job 5: Error code: 429', 'x failed']), /^Skipped 1 job \(5\)/);
});
test('Recent activity draws the warned step\'s reason with the step-note class', () => {
  assert.match(activitySource(), /stepNote\(/);
});
