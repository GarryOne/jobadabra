// An async answer is applied only if it is still about the tab's current read (extension/read-gen.js; pool run 38325158956, HelloFresh: a digest ask started for the page's first, empty
// read landed after a second read had judged the form and was filling it, and "no form" (door 1) was reported mid-fill). One generation per tab, one check; every late-answer site of
// fill-flow.js consider() asks it. Guards the next async step too: a new `await` of an ask in consider() without the check fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {beginRead, dropIfLate, forgetReads, isCurrent, openRead} from '../../extension/read-gen.js';

const flow = ['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8')).join('\n');
const consider = flow.slice(flow.indexOf('export async function consider('));

test('a newer read of the tab makes the older one stale; another tab is not touched; a forgotten tab starts again', () => {
  const first = beginRead(1), other = beginRead(2);
  assert.equal(isCurrent(1, first), true);
  const second = beginRead(1);
  assert.equal(isCurrent(1, first), false, 'the first read is late now');
  assert.equal(isCurrent(1, second), true);
  assert.equal(isCurrent(2, other), true, 'a read of another tab is its own');
  forgetReads(1);
  assert.equal(isCurrent(1, second), false, 'a closed tab has no current read');
});

test('class: every ask consider() waits on is checked right after, and the read is begun once the call is not skipped', () => {
  assert.match(consider, /if \(started\.has\(key\)\) return(?: false)?;\s*started\.add\(key\);/, 'a call that returns at once is not a read');
  const waits = [...consider.matchAll(/await (kindAsk|outcomeLook|readWhileDrawing\(|climbOnUnsure\(|climbOnStall\()/g)];
  assert.ok(waits.length >= 4, `${waits.length} awaited asks found: the list of late-answer sites changed, update this test`);
  for (const wait of waits) {
    const after = consider.slice(wait.index, wait.index + 520);
    assert.match(after, /late\(tab, gen,/, `the ask awaited at "${consider.slice(wait.index, wait.index + 60).replace(/\s+/g, ' ')}" is not checked with late(tab, gen, ...)`);
  }
});

// beta run 38383983490 (13 Oct 2026, Windows applyflows): a sign-up page's read waited 6 s on the app (identityOf + the site-password peek), the person pressed
// "Create account" meanwhile and the form's own read began; the stale read then wrote "running" with its token on the form and its fill's "done" was refused.
test('class: a read writes the page\'s state only while it is current (no await between the check and the write)', () => {
  const writes = [...consider.matchAll(/writeState\(tab\.id, \{state: (?!result)/g)];
  assert.ok(writes.length >= 2, `${writes.length} page-state writes found in consider(): update this test`);
  for (const write of writes) {
    const before = consider.slice(0, write.index), lastCheck = before.lastIndexOf('late(tab, gen,');
    assert.ok(lastCheck >= 0, 'no late() check before a page-state write');
    const between = before.slice(lastCheck).replace(/late\(tab, gen,[^)]*\)\) return(?: false)?;/, '').replace(/await\s*$/, '');   // the write's own await
    assert.doesNotMatch(between, /\bawait\b/, `an await sits between the last late() check and the write at "${consider.slice(write.index, write.index + 50)}"`);
  }
});

test('class: the app asks of the account block are checked right after', () => {
  const block = consider.slice(consider.indexOf("if (role === 'account') {"), consider.indexOf("decide('fill', `page kind:"));
  assert.match(block, /await apiFor\(tab\.id, await settings\(\), '\/extension\/site-password'/, 'the account block changed: update this test');
  assert.match(consider.slice(consider.indexOf("if (role === 'account') {")), /^[\s\S]*?\n {2}\}\n {2}if \(late\(tab, gen, /, 'the account block is not followed by late(tab, gen, ...)');
});

test('the late answer is logged, not silent, and the tab\'s reads are forgotten with the tab', () => {
  assert.match(flow, /const late = \(tab, gen, what\) => \{[^}]*decide\('fill', 'late answer dropped: a newer read of this tab answered'/);
  assert.match(fs.readFileSync(new URL('../../extension/read-gen.js', import.meta.url), 'utf8'), /tabs\?\.onRemoved\?\.addListener\(forgetReads\)/);
});

// 17 Oct 2026, CI journey "SuccessFactors: account and form" (run 38984259095): after the sign-in the page's form answer was dropped as "late: a newer read of this tab answered", no newer read
// logged anything, the form was never filled and the run ended by cap 260 s later. Two holes: a read that found the tab already moved on (and returned) had bumped the generation first, so it
// made the live read late; and a read dropped as late kept its key in `started`, so when the tab came back to that page nothing read it again. Scripted here as the flow does it.
test('a read that abandons itself does not make the live read late', () => {
  const started = new Set(['tab9 A', 'tab9 B']);
  const readB = openRead(9, 'tab9 B', started, false);   // B: the page the tab is on, a read that goes on
  const readC = openRead(9, 'tab9 C', started, true);   // C: found the tab moved on again and returned
  assert.equal(readC, 0, 'an abandoned read begins nothing');
  assert.equal(isCurrent(9, readB), true, 'B is still the current read, its answer is applied');
  assert.equal(dropIfLate(9, readB, 'tab9 B', started), false);
  assert.equal(started.has('tab9 B'), true, 'a read that is current keeps its page');
  forgetReads(9);
});

test('a read dropped as late gives its page back, so a return to that page is read again', () => {
  const started = new Set(['tab8 A']);
  const readA = openRead(8, 'tab8 A', started, false);
  openRead(8, 'tab8 B', started, false);   // a newer read of the tab begins: A is late
  assert.equal(dropIfLate(8, readA, 'tab8 A', started), true);
  assert.equal(started.has('tab8 A'), false, 'A\'s page can be read when the tab is back on it');
  assert.ok(openRead(8, 'tab8 A', started, false) > 0);
  forgetReads(8);
});

test('consider() goes through those two decisions only', () => {
  assert.match(consider, /openRead\(tab\.id, key, started, /);
  assert.doesNotMatch(consider, /beginRead\(/, 'no read begins before the moved-on check');
  assert.match(flow, /dropIfLate\(tab\.id, gen, fillKey\(tab\.id, tab\.url\), started\)/);
});
