// The panel spins "Starting…" from the first load of a page the app opened to fill (owner, 9 Oct 2026): once per tab and page, never over a
// step the fill already said, and gone after 30 s when no fill follows. Also the empty-page wait that keeps a loading form from being judged.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {noteStart, STARTING} from '../../extension/panel-start.js';

test('Starting… is set once per tab and page, never over a real step, and clears itself when no fill follows', () => {
  const stepNow = new Map(), timers = [];
  const later = (fn, ms) => timers.push({fn, ms});
  assert.equal(noteStart(stepNow, 1, 'https://a.example/job#jobpilotto-fill', later), true);
  assert.equal(stepNow.get(1), STARTING);
  assert.equal(noteStart(stepNow, 1, 'https://a.example/job#jobpilotto-fill', later), false);   // the same page loading again
  stepNow.set(2, 'Reading the form…');
  assert.equal(noteStart(stepNow, 2, 'https://b.example/form', later), false);   // the fill already said its step
  assert.equal(stepNow.get(2), 'Reading the form…');
  assert.equal(timers[0].ms, 30000);
  timers[0].fn();
  assert.equal(stepNow.has(1), false);
  stepNow.set(3, STARTING);
  const keep = new Map([[3, 'Filling 4 fields…']]);
  noteStart(keep, 3, 'https://c.example/', later);
  timers.at(-1)?.fn();
  assert.equal(keep.get(3), 'Filling 4 fields…');   // a real step is never cleared by the timer
});
