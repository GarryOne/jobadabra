// The screenshot asks of a CI pool run, on their own line of the summary (lib/picture-asks.mjs): counted from the extension's closer-look lines, priced from their own usd, with the blind spots the picture did or did not confirm.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {pictureAsks, pictureAsksLine, pictureAsksOf} from '../../lib/picture-asks.mjs';

const look = (action, fields) => `2026-10-13T01:00:00.000Z [extension] fill: closer look: ${action} ${JSON.stringify(fields)}`;
const log = [look('click', {reason: 'x', by: 'ai', picture: true, usd: 0.0141, why: 'a'}), look('ask_person', {reason: 'x', by: 'ai', picture: false, usd: 0.004, why: 'b'}),
  look('click', {picture: true, usd: 0.02}), '2026-10-13T01:00:01.000Z [extension] fill: blind spot confirmed: the picture\'s control led to a form {}',
  '2026-10-13T01:00:02.000Z [extension] fill: blind spot not confirmed: the picture found no way on {}', '2026-10-13T01:00:03.000Z [extension] fill: closer look: click {"picture":tru'].join('\n');

test('only a look with its picture counts as a screenshot ask; a text-only look and a cut line do not', () => {
  assert.deepEqual(pictureAsks([log]), {count: 2, usd: 0.0341, confirmed: 1, notConfirmed: 1, measured: 0, partial: 0});
  assert.deepEqual(pictureAsks([]), {count: 0, usd: 0, confirmed: 0, notConfirmed: 0, measured: 0, partial: 0});
});

test('the picture-vs-sketch view: asks whose picture counted its controls, and the ones that showed more than the sketch lists', () => {
  const views = [look('ask_person', {picture: true, usd: 0.01, shown: 9, listed: 3, partial: true}), look('click', {picture: true, usd: 0.01, shown: 4, listed: 4, partial: false}), look('wait', {picture: true, usd: 0.01, shown: -1, listed: -1, partial: false})].join('\n');
  const found = pictureAsks([views]);
  assert.equal(found.measured, 2);
  assert.equal(found.partial, 1);
  assert.match(pictureAsksLine(found), /Partial views: 1 of 2 measured\./);
});

test('the summary line says the count and the dollars; a folder with none says nothing', () => {
  assert.equal(pictureAsksLine({count: 2, usd: 0.0341, confirmed: 1, notConfirmed: 1, measured: 0, partial: 0}), 'Screenshot asks: 2 ($0.0341); blind spots confirmed by the picture 1, not confirmed 1.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-picture-asks-'));
  try {
    assert.equal(pictureAsksOf(dir), '');
    fs.writeFileSync(path.join(dir, 'row.app.log'), log);
    assert.match(pictureAsksOf(dir), /^Screenshot asks: 2 \(\$0\.0341\)/);
    assert.equal(pictureAsksOf(path.join(dir, 'missing')), '');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('the pool summary prints it beside the AI spend', () => {
  const summary = fs.readFileSync(new URL('../../pool-ci-summary.mjs', import.meta.url), 'utf8');
  assert.match(summary, /pictureAsksOf\(dir\)/);
});
