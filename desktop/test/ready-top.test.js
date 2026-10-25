// Fill now's pick: best fit first, skips what is filled, opened or applied, says what each job lacks and the cost (lib/ready-top.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {CHIPS, DEFAULT_CHIP, costLine, pickTop} from '../lib/ready-top.js';

const job = (code, fit, extra = {}) => ({code, url: `https://x.test/${code}`, title: `T${code}`, company: 'Co', fit, status: 'unreviewed', ...extra});
const done = {kit: true, tailored: true, letter: true};

test('the chips are 1, 3, 5, 10 and 3 is the default', () => { assert.deepEqual(CHIPS, [1, 3, 5, 10]); assert.equal(DEFAULT_CHIP, 3); });

test('best fit first (saved before unreviewed), only open jobs above the minimum, never one a night holds', () => {
  const jobs = [job('a', 70), job('b', 90), job('c', 65, {status: 'saved'}), job('d', 95, {status: 'applying'}), job('e', 99, {status: 'applied'}), job('f', 40), job('g', 80, {ineligible: 'visa'}), job('h', 85)];
  assert.deepEqual(pickTop(jobs, 10, {skip: new Set(['h'])}).map(each => each.code), ['c', 'b', 'a']);
  assert.deepEqual(pickTop(jobs, 2).map(each => each.code), ['c', 'b']);
});

test('each job says what it lacks and what that costs; a finished job costs nothing', () => {
  const [ready, nothing, cv] = pickTop([job('r', 90, done), job('n', 80), job('c', 70, {kit: true})]);
  assert.deepEqual([ready.needsKit, ready.needsCv, ready.usd], [false, false, 0]);
  assert.deepEqual([nothing.needsKit, nothing.needsCv, nothing.usd], [true, true, 0.1]);
  assert.deepEqual([cv.needsKit, cv.needsCv, cv.usd], [false, true, 0.06]);
});

test('the cost line counts the first N, in words, never undefined or NaN', () => {
  const picked = pickTop([job('r', 90, done), job('n', 80), job('c', 70, {kit: true})]);
  assert.equal(costLine(picked, 1), '1 job ready: nothing to prepare, no AI cost.');
  assert.equal(costLine(picked, 3), '3 jobs: prepare 1 kit + 2 CVs with letters.');
  assert.equal(costLine(picked, 3, {showCost: true}), '3 jobs: prepare 1 kit + 2 CVs with letters, about $0.16 of AI.');   // only on the user's own API key
  assert.match(costLine([], 3), /No job is left/);
  for (const count of [0, 1, 3, 5, 10, undefined]) assert.doesNotMatch(costLine(picked, count), /undefined|NaN/);
});
