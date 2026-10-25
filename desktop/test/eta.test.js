// renderer/eta.js: the time left never goes up while a run slows down, says so when it is slower than promised, and matches src/progress.py on
// the shared sequence (tests/fixtures/eta-sequence.json). Also covers the one place in the app that shows a time left (the LibreOffice download).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {Eta, SLOW} from '../renderer/eta.js';
import {officeView} from '../renderer/pages/office-progress.js';

test('same answers as the engine on the shared sequence', () => {
  const data = JSON.parse(readFileSync(new URL('../../tests/fixtures/eta-sequence.json', import.meta.url), 'utf8'));
  const eta = new Eta(data.started);
  assert.deepEqual(data.calls.map(([t, done]) => eta.text(t, done, data.total)), data.calls.map(call => call[2]));
});

test('the LibreOffice download: later slower stretches never raise the time left', () => {
  const MB = 1048576, started = 5_000_000, total = 300 * MB, said = [];
  let bytes = 0, now = started;
  for (let i = 0; i < 300; i++) {
    bytes += MB; now += i < 100 ? 200 : 900;       // the first third is fast, the rest slow
    const text = officeView({step: 'download', bytes, total, started}, {now}).steps[1].text;
    if (/min left|under a minute/.test(text)) said.push(/under a minute/.test(text) ? 0.5 : Number(text.match(/about (\d+) min/)[1]));
  }
  assert.ok(said.length > 50);
  assert.deepEqual(said, [...said].sort((a, b) => b - a));
});

test('a long stall says so rather than a bigger number', () => {
  const eta = new Eta(0);
  for (let done = 1; done <= 20; done++) eta.text(done * 0.5, done, 100);
  assert.equal(eta.text(310, 21, 100), SLOW);
});
