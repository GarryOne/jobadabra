// No verdict while the extension still works (extension/working-mark.js; owner, 27 Oct 2026: "That's a very big bug. Please, don't show a verdict" ... "IF the extension didn't stop
// thinking"): on a Greenhouse form the panel said "This page shows no application" + "Fill again", then filled it seconds later. The class: every mark markOf can give.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { END_MARKS, workingMark } from '../../extension/working-mark.js';
import { markOf } from '../../extension/tab-pages.js';

const ROLES = ['no-form', 'form', 'account', 'signing', 'reading', 'signing-in', 'signing-up', ''];
const KINDS = ['', 'other', 'posting', 'closed', 'form', 'account', 'account-form'];

test('a working mark is never an end verdict, for every role, kind, step and press', () => {
  const seen = new Set();
  for (const role of ROLES) for (const kind of KINDS) for (const step of ['', 'sign_in', 'sign_up']) for (const pressed of [false, true]) {
    const mark = markOf(role, pressed, step, kind);
    seen.add(mark);
    assert.ok(!END_MARKS.includes(workingMark(mark)), `${role}/${kind}/${step}/${pressed} → ${mark}`);
    if (!END_MARKS.includes(mark)) assert.equal(workingMark(mark), mark, 'progress marks stay as they are');
  }
  for (const end of END_MARKS) assert.ok(seen.has(end), `END_MARKS names a mark markOf really gives: ${end}`);
});

test('fill-flow: marks set while the read goes on are working marks; the end verdict waits for a field watch that may judge the page again', () => {
  const flow = ['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8')).join('\n');
  const marks = [...flow.matchAll(/markPage\(tab\.id, role, [^)]*\)/g)].map((m) => m[0]);
  const plain = marks.filter((m) => m === 'markPage(tab.id, role, pressed, kind)');
  assert.ok(plain.length >= 1, 'the verdict is said somewhere');
  // Every plain (verdict) mark is the watch's end or its failure, never a mark set before the watch starts.
  const end = flow.indexOf('await markPage(tab.id, role, pressed, kind, {working: !!watching});'), watch = flow.indexOf('if (watching) watchForFields(');
  assert.ok(end > 0 && watch > end, 'the end block marks working while a watch runs, then starts it');
  assert.match(flow.slice(watch, flow.indexOf('\n', watch)), /\(\) => markPage\(tab\.id, role, pressed, kind\)\)\.catch\(\(\) => markPage\(tab\.id, role, pressed, kind\)\)/, 'the verdict once the watch ends, or fails');
  for (const mark of marks.filter((m) => m !== 'markPage(tab.id, role, pressed, kind)')) assert.match(mark, /working: /, mark);
});

test('fill-flow: the field watch says the verdict on every ending with no form (ran out, or looked at once already), never after a re-judge', () => {
  const flow = ['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8')).join('\n');
  const body = flow.slice(flow.indexOf('async function watchForFields('), flow.indexOf('\n}\n', flow.indexOf('async function watchForFields(')));
  assert.match(body, /if \(lookedAgain\.has\(key\)\) \{ if \(onEnd\) await onEnd\(\); return false; \}/);
  assert.match(body, /'watch ended: no form and no new frame'[^\n]*\n\s*if \(onEnd\) await onEnd\(\);/);
  const rejudge = body.indexOf('await consider(live, jobUrl);');
  assert.ok(rejudge > 0 && !body.slice(body.lastIndexOf('lookedAgain.add(key)', rejudge), rejudge).includes('onEnd'), 'a re-judge says its own mark');
});
