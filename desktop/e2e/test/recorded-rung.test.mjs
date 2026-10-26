// A recorded case may name the AI-ladder rung it guards (an integer 0 to 6, optional): the loader passes it on and /admin/form-filling/lab shows it as "Rung guarded".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {loadCases} from '../lib/page-replay.mjs';

test('every recorded case has no rung or an integer from 0 to 6, and the cases that decide a page name theirs', () => {
  const cases = loadCases();
  assert.ok(cases.length);
  for (const item of cases) assert.ok(item.rung === undefined || (Number.isInteger(item.rung) && item.rung >= 0 && item.rung <= 6), `${item.name}: rung must be an integer 0 to 6`);
  const rung = Object.fromEntries(cases.map(item => [item.name, item.rung]));
  for (const name of ['cv-choice-step-1', 'email-application-1', 'workday-start-dialog-1', 'workday-start-dialog-2']) assert.equal(rung[name], 2, name);
});

test('the loader keeps a case\'s rung as written', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rung-'));
  fs.mkdirSync(path.join(dir, 'a-1')); fs.writeFileSync(path.join(dir, 'a-1', 'case.json'), JSON.stringify({shape: 's', rung: 4, pages: []}));
  fs.mkdirSync(path.join(dir, 'b-1')); fs.writeFileSync(path.join(dir, 'b-1', 'case.json'), JSON.stringify({shape: 's', pages: []}));
  assert.deepEqual(loadCases(dir).map(item => [item.name, item.rung]), [['a-1', 4], ['b-1', undefined]]);
});

test('the recorded-pages test sends the rung with each result', () => {
  assert.match(fs.readFileSync(new URL('./recorded-pages.test.mjs', import.meta.url), 'utf8'), /rung: item\.rung/);
});
