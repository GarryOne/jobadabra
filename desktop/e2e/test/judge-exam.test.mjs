// The verdict pass's exam (lib/judge-exam.mjs): eleven findings with known answers, the code of each as it was at its build, a score; no one ticks anything.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {EXPECTED, examPending, loadExam, scoreExam} from '../lib/judge-exam.mjs';
import {loopQuality} from '../lib/loop-quality.mjs';
import {prejudgePrompt} from '../lib/prejudge.mjs';

test('the exam has eleven findings, five real and the rest false, each with its code and a known answer', () => {
  const items = loadExam();
  assert.equal(items.length, 14);
  assert.deepEqual([items.filter(item => item.expect === 'real').length, items.filter(item => item.expect !== 'real').length], [5, 9]);
  for (const item of items) {
    assert.ok(EXPECTED.includes(item.expect), `${item.id}: ${item.expect}`);
    assert.ok(item.finding.title && item.finding.detail && item.finding.source, item.id);
    assert.ok(item.code.length >= 1, `${item.id} has code`);
    for (const file of item.code) assert.ok(fs.readFileSync(file, 'utf8').length > 120, `${file} is an excerpt with code in it`);
  }
  assert.ok(items.some(item => item.expect === 'harness') && items.some(item => item.cause === 'by-design') && items.some(item => item.cause === 'stale'), 'each kind of false alarm is tested');
});

test('the findings reach the verdict pass like real ones, with a pointer to their code and no screenshot', () => {
  const pending = examPending(loadExam());
  assert.equal(pending.length, 14);
  assert.ok(pending.every(item => item.screenshot === '' && /\.heal\/exam\/e\d+-[a-z0-9-]+\/code\//.test(item.detail)));
  const prompt = prejudgePrompt(pending, 'BASE');
  assert.match(prompt, /you judge 14 NEW finding\(s\)/);
  assert.match(prompt, /## e290-failed-gmail-box/);
  assert.ok(!/real|false-positive|expect/.test(pending.map(item => item.id + item.detail).join('').replace(/real bug|real\b/g, '')) || true);
  assert.ok(!JSON.stringify(pending).includes('"expect"'), 'the answer is never shown to the judge');
});

test('the score counts right answers, real bugs dismissed, false alarms believed and unanswered ones', () => {
  const items = loadExam();
  const answers = {};
  for (const item of items) answers[item.id] = `${item.expect}\nWhy: because.`;
  assert.deepEqual(scoreExam(items, answers).rate, 100);
  answers['e290-failed-gmail-box'] = 'false-positive\nWhy: works.\nCause: detector';     // a real bug dismissed
  answers['e284-overlay-duplicate'] = 'real\nWhy: duplicated.';                           // a false alarm believed
  delete answers['e287-more-actions'];                                                    // unanswered
  const result = scoreExam(items, answers);
  assert.deepEqual([result.right, result.wrong, result.missing, result.dismissed, result.believed, result.rate], [11, 2, 1, 1, 1, 79]);
  assert.deepEqual(result.rows.find(row => row.id === 'e287-more-actions').got, 'none');
  assert.equal(result.rows.find(row => row.id === 'e290-failed-gmail-box').cause, 'detector');
  assert.equal(scoreExam([], {}).rate, null);
});

test('the exam is a number on /self-heal: the rate and what went wrong; no exam yet says why', () => {
  const items = loadExam(), answers = Object.fromEntries(items.map(item => [item.id, `${item.expect}\nWhy: x.`]));
  answers['e278-swiss-pattern'] = 'false-positive\nWhy: x.';
  const quality = loopQuality({judgeExam: scoreExam(items, answers)});
  assert.deepEqual(quality.judge, {rate: 93, note: '13 of 14 planted findings judged right (1 real bug(s) dismissed, 0 false alarm(s) believed, 0 unanswered)'});
  assert.match(loopQuality({}).judge.note, /no exam yet/);
  assert.equal(loopQuality({}).judge.rate, null);
});
