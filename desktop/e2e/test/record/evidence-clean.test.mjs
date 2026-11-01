// What the evidence folder keeps (lib/evidence-clean.mjs): end.png always, step pictures only of a row that needs a fix or is a site problem, day folders older than 14 days removed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {writeBundle, saveElectronLeg} from '../../lib/evidence-bundle.mjs';
import {STATUS_FILE, keepsSteps, removeOldEvidence} from '../../lib/evidence-clean.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-clean-'));
function capture() {
  const dir = tmp();
  for (const name of ['end.png', 'step-01-posting.png', 'step-02-form.png']) fs.writeFileSync(path.join(dir, name), 'png');
  return dir;
}
const bundle = (run, extra = {}) => {
  const root = tmp(), dir = path.join(root, 'evidence'), captureDir = capture();
  saveElectronLeg({dir, day: '2026-10-14', shape: 'a/b', captureDir});
  const folder = writeBundle({dir, day: '2026-10-14', shape: 'a/b', result: run, captureDir, keepSteps: keepsSteps(run), ...extra});
  return {folder, files: fs.readdirSync(folder).filter(n => n.endsWith('.png')).sort(), electron: fs.readdirSync(path.join(folder, 'electron')).filter(n => n.endsWith('.png')).sort()};
};

test('a run that works or is held keeps end.png only; a run that needs a fix or is a site problem keeps its steps too', () => {
  const rows = {
    works: [{reached: 'form', filled: 5, left: 0}, ['end.png']],
    held: [{reached: 'account', note: 'account-first: held'}, ['end.png']],
    fix: [{reached: 'posting'}, ['end.png', 'step-01-posting.png', 'step-02-form.png']],
    site: [{reached: 'none', note: 'site refused: retry later'}, ['end.png', 'step-01-posting.png', 'step-02-form.png']]};
  for (const [name, [run, expected]] of Object.entries(rows)) {
    const got = bundle(run);
    assert.deepEqual(got.files, expected, `${name}: the bundle`);
    assert.deepEqual(got.electron.filter(n => n !== 'end.png'), expected.filter(n => n !== 'end.png'), `${name}: the Electron leg`);
    assert.ok(got.files.includes('end.png') && got.electron.includes('end.png'), `${name}: end.png always`);
  }
});

// The follow-up (owner, 15 Oct 2026: "if we don't fix the issue in 14 days, we lose evidence"): the newest folder of a row stays however old; others go at 30 days, or at once when the newest run works.
test('the newest folder of every row stays, an older duplicate goes after 30 days, a working row keeps only its newest', () => {
  const root = tmp(), dir = path.join(root, 'evidence'), now = new Date('2026-12-31T12:00:00Z');
  const day = ago => new Date(now.getTime() - ago * 86400000).toISOString().slice(0, 10);
  const make = (ago, row, state) => { const f = path.join(dir, day(ago), row); fs.mkdirSync(f, {recursive: true}); fs.writeFileSync(path.join(f, 'end.png'), '1'); if (state) fs.writeFileSync(path.join(f, STATUS_FILE), JSON.stringify({state})); };
  make(60, 'old-row', 'fix');                                       // a row's only folder, 60 days old: kept
  make(31, 'dup-row', 'fix'); make(5, 'dup-row', 'fix');            // an older duplicate at 31 days: goes; its newest stays
  make(20, 'dup-young', 'fix'); make(5, 'dup-young', 'fix');        // 20 days and the row still fails: kept (evidence for the fix)
  make(10, 'ok-row', 'fix'); make(3, 'ok-row', 'works');           // the row works now: its older folder goes at once
  make(40, 'ok-old', 'fix'); make(2, 'ok-old');                     // a newest run with no status word (an older build): not known to work, so only the 30 days rule
  const lines = [];
  const removed = removeOldEvidence(dir, now, line => lines.push(line)).sort();
  assert.deepEqual(removed, [`${day(10)}/ok-row`, `${day(31)}/dup-row`, `${day(40)}/ok-old`].sort());
  const left = fs.readdirSync(dir).flatMap(d => fs.readdirSync(path.join(dir, d)).map(r => `${d}/${r}`)).sort();
  assert.deepEqual(left, [`${day(60)}/old-row`, `${day(5)}/dup-row`, `${day(20)}/dup-young`, `${day(5)}/dup-young`, `${day(3)}/ok-row`, `${day(2)}/ok-old`].sort());
  assert.match(lines[0], /^evidence: removed 3 folders/);
});

test('nothing outside the evidence folder is touched: any other folder is refused', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '2020-01-01', 'row'), {recursive: true});
  assert.throws(() => removeOldEvidence(root, new Date(), () => {}), /not an evidence folder/);
  assert.ok(fs.existsSync(path.join(root, '2020-01-01', 'row')));
});

test('a bundle records its row status for the cleanup', () => {
  const root = tmp(), dir = path.join(root, 'evidence');
  const folder = writeBundle({dir, day: '2026-10-14', shape: 'a/b', result: {reached: 'form', filled: 5, left: 0}, state: 'works'});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, STATUS_FILE), 'utf8')), {state: 'works'});
});
