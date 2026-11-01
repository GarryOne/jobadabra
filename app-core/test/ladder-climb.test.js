// The extension's climb (extension/ladder/climb.js): what it does with a rung's signal, using the router (extension/ladder/core.js). Fake `ask`, no browser.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {blindOn, blindOr, climbOnStall, climbOnUnsure, forgetClimb, noteSignal, toldReport} from '../../extension/ladder/climb.js';

const digestAnswer = {role: 'no-form', kind: 'posting', by: 'digest', rung: 3, signal: 'confident', digest: {outcome: 'phone', verb: 'tell_person', numbers: [2], chosen: [{n: 2, kind: 'sentence', text: 'Call us: 044 555 01 00'}]}};

test('an unsure page-kind answer climbs to the digest: one more ask, with digest set; a confident one never climbs', async () => {
  const asked = [];
  const ask = async (tab, options) => { asked.push(options); return digestAnswer; };
  noteSignal(7, {rung: 2, signal: 'unsure'});
  assert.equal(await climbOnUnsure({id: 7}, ask), digestAnswer);
  assert.deepEqual(asked, [{digest: true}]);
  noteSignal(8, {rung: 2, signal: 'confident'});
  assert.equal(await climbOnUnsure({id: 8}, ask), null);
  assert.equal(await climbOnUnsure({id: 99}, ask), null, 'no signal noted: nothing to climb');
  assert.equal(asked.length, 1);
});

test('the digest is asked once per tab and page when a page without a form stalls, and never when the answer already came from the digest', async () => {
  forgetClimb(5);
  let calls = 0;
  const ask = async () => { calls += 1; return digestAnswer; };
  assert.equal(await climbOnStall({id: 5}, ask, '5 jobs.example/x', {by: 'ai'}), digestAnswer);
  assert.equal(await climbOnStall({id: 5}, ask, '5 jobs.example/x', {by: 'ai'}), null, 'once per tab and page');
  assert.equal(await climbOnStall({id: 5}, ask, '5 jobs.example/y', {by: 'digest'}), null, 'the digest already answered');
  assert.equal(calls, 1);
  forgetClimb(5);
  assert.equal(await climbOnStall({id: 5}, ask, '5 jobs.example/x', {by: 'ai'}), digestAnswer, 'a reload or a new tab may look again');
});

test('only a tell_person answer is reported as told, with the page\'s own sentence (an email has its own report)', () => {
  assert.deepEqual(toldReport({digest: {verb: 'tell_person', outcome: 'phone', chosen: [{text: 'Call us: 044 555 01 00'}]}}), {why: 'told', needs: 'Call us: 044 555 01 00'});
  for (const kind of [null, {}, {digest: {verb: 'press', outcome: 'form', chosen: [{text: 'Apply'}]}}, {digest: {verb: 'none', outcome: 'other', chosen: []}}, {digest: {verb: 'tell_person', outcome: 'email', chosen: [{text: 'a@example.com'}]}}]) assert.equal(toldReport(kind), null);
});

test('what the app is told when a digest-named press led to a form: fixed values only, never a sentence, never an address', async () => {
  const {verifiedBody} = await import('../../extension/ladder/climb.js');
  const kind = {by: 'digest', rung: 3, digest: {outcome: 'form', verb: 'press', chosen: [{n: 2, kind: 'button', text: 'Postuler'}]}};
  assert.deepEqual(verifiedBody(kind, 'https://jobs.example/x?token=secret#frag', [{type: 'text'}]), {verified: true, url: 'https://jobs.example/x', controls: [{type: 'text'}], rung: 3, outcome: 'form', kind: 'posting', signal: 'confident'});
  for (const nope of [null, {}, {by: 'ai', rung: 2, digest: {outcome: 'form'}}, {by: 'digest', rung: 3}]) assert.equal(verifiedBody(nope, 'https://jobs.example/x', []), null, 'only a digest answer is reported');
  assert.equal(JSON.stringify(verifiedBody(kind, 'https://jobs.example/x', [])).includes('Postuler'), false);
});

// The fast tier's decisions the page confirmed (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 1): the app COUNTS them (desktop/lib/ladder/learning.js confirm), so real use,
// the CI pool and the replays feed the learning. Fixed values only; a learned answer is a hit; a digest answer stays verifiedBody's; a kind the step did not confirm is never sent.
test('a confirmed fast-tier move is told to the app with fixed values only: the press led to a form, the fill put values in', async () => {
  const {confirmedBody} = await import('../../extension/ladder/climb.js');
  const url = 'https://jobs.example/careers/123?token=secret#jobpilotto-fill=s1', controls = [{type: 'text', label: 'Postuler maintenant'}];
  const sent = (kind, step) => confirmedBody(kind, url, controls, step);
  assert.deepEqual(sent({by: 'ai', rung: 2, kind: 'posting', applyButton: 'Postuler'}, 'pressed'), {verified: true, url: 'https://jobs.example/careers/123', controls, rung: 2, outcome: 'form', kind: 'posting', signal: 'confident'});
  assert.deepEqual(sent({by: 'remembered', rung: 1, kind: 'form'}, 'filled'), {verified: true, url: 'https://jobs.example/careers/123', controls, rung: 1, outcome: 'form', kind: 'form', signal: 'confident'});
  assert.equal(sent({by: 'ai', rung: 2, kind: 'account-form'}, 'filled').kind, 'account-form');
  assert.deepEqual([sent(null, 'pressed').rung, sent(null, 'pressed').kind, sent(null, 'filled').kind], [0, 'posting', 'form'], 'the structure rule decided: rung 0');
  assert.deepEqual(sent({by: 'learned', rung: 1, kind: 'posting', learnedBy: 3}, 'pressed'), {confirmed: true, url: 'https://jobs.example/careers/123', controls}, 'a learned answer is a hit');
  for (const [kind, step] of [[{by: 'digest', rung: 3, kind: 'posting'}, 'pressed'], [{by: 'ai', rung: 2, kind: 'posting'}, 'filled'], [{by: 'ai', rung: 2, kind: 'form'}, 'pressed'],
    [{by: 'ai', rung: 2, kind: 'other'}, 'pressed'], [{by: 'ai', rung: 2, kind: 'account'}, 'filled'], [{by: 'someone', kind: 'posting'}, 'pressed'], [{by: 'ai', rung: 2, kind: 'posting'}, 'clicked'], [{by: 'ai', rung: 2, kind: 'form'}, undefined]]) {
    assert.equal(sent(kind, step), null, `${JSON.stringify(kind)} ${step}`);
  }
  assert.deepEqual([sent({by: 'ai', kind: 'posting'}, 'pressed').rung, sent({by: 'remembered', kind: 'form'}, 'filled').rung], [2, 1], 'an answer without its rung: the rung of who answered');
  assert.ok(!JSON.stringify(sent({by: 'ai', rung: 2, kind: 'posting', applyButton: 'Postuler'}, 'pressed')).match(/token|secret|jobpilotto-fill|Postuler\b(?! maintenant)/));
});

test('an Apply press that moved the tab to another page is confirmed by that page taking the fill: kept per tab until the next page takes it, once', async () => {
  const {forgetClimb, notePressed, takePressed} = await import('../../extension/ladder/climb.js');
  const body = {verified: true, url: 'https://jobs.example/careers/1', controls: [], rung: 2, outcome: 'form', kind: 'posting', signal: 'confident'};
  notePressed(31, body);
  assert.deepEqual([takePressed(31), takePressed(31)], [body, null], 'the next page takes it once');
  notePressed(32, body); notePressed(32, null);
  assert.equal(takePressed(32), null, 'a press with nothing to confirm clears an older one');
  notePressed(33, body); forgetClimb(33);
  assert.equal(takePressed(33), null, 'a reload forgets it');
});

test('when the ladder ends with no usable answer (the digest answered nothing, or said other with nothing to tell), the page is reported as other, never silently', async () => {
  const {climbOnStall, climbOnUnsure, forgetClimb, noteSignal, otherReport} = await import('../../extension/ladder/climb.js');
  forgetClimb(11);
  noteSignal(11, {rung: 2, signal: 'unsure'});
  await climbOnUnsure({id: 11}, async () => null);   // the digest was unsure or failed: no answer
  assert.deepEqual(otherReport({by: 'ai'}, 11), {why: 'other', needs: ''});
  forgetClimb(12);
  assert.deepEqual(otherReport({by: 'digest', applyButton: '', digest: {outcome: 'other', verb: 'none', chosen: []}}, 12), {why: 'other', needs: ''}, 'the digest said other');
  assert.equal(otherReport({by: 'digest', applyButton: 'postuler', digest: {outcome: 'form', verb: 'press', chosen: [{text: 'Postuler'}]}}, 12), null, 'a button to press is an answer');
  assert.equal(otherReport({by: 'digest', digest: {outcome: 'phone', verb: 'tell_person', chosen: [{text: 'Call'}]}}, 12), null, 'a sentence to tell is an answer');
  assert.equal(otherReport({by: 'ai'}, 13), null, 'the digest was never asked: nothing to report as other');
  forgetClimb(14);
  assert.equal(await climbOnStall({id: 14}, async () => null, '14 x', {by: 'ai'}), null);
  assert.deepEqual(otherReport({by: 'ai'}, 14), {why: 'other', needs: ''}, 'a stall whose digest answered nothing');
});

test('the extension keeps each frame candidate\'s address for itself and sends only host, path and size; the index the app answers opens the stored address, https only', async () => {
  const {frameSketch, frameSrcOf, forgetClimb, noteFrames} = await import('../../extension/ladder/climb.js');
  forgetClimb(21);
  const list = [{host: 'job-boards.example-ats.io', path: '/embed/job_app', src: 'https://job-boards.example-ats.io/embed/job_app?token=secret', width: 650, height: 2432}, {host: 'x.example', path: '/a', src: 'http://x.example/a', width: 400, height: 300}];
  noteFrames(21, list);
  assert.deepEqual(frameSketch(list), [{host: 'job-boards.example-ats.io', path: '/embed/job_app', width: 650, height: 2432}, {host: 'x.example', path: '/a', width: 400, height: 300}]);
  assert.equal(JSON.stringify(frameSketch(list)).includes('secret'), false);
  assert.equal(frameSrcOf(21, 0), 'https://job-boards.example-ats.io/embed/job_app?token=secret');
  assert.equal(frameSrcOf(21, 1), '', 'never an http address');
  for (const bad of [2, -1, 0.5, undefined, 'a']) assert.equal(frameSrcOf(21, bad), '');
  assert.equal(frameSrcOf(99, 0), '', 'a tab with no frames noted');
});

test('a frame that BECOMES a form-frame candidate after the judgment is new; one the judgment already listed is not (Datadog, 11 Oct 2026: the embed is born 150 px high, below the 300x200 floor, and grows)', async () => {
  const {frameGrew, noteFrames, forgetClimb} = await import('../../extension/ladder/climb.js');
  const grown = {host: 'job-boards.example-ats.io', path: '/embed/job_app', src: 'https://job-boards.example-ats.io/embed/job_app', width: 650, height: 2432};
  forgetClimb(31);
  noteFrames(31, []);   // the judgment listed no candidate: the frame was too small then
  assert.equal(frameGrew(31, []), false, 'nothing listed, nothing grown');
  assert.equal(frameGrew(31, [grown]), true, 'now it qualifies: judge the page again');
  noteFrames(31, [grown]);   // the new judgment listed it
  assert.equal(frameGrew(31, [grown]), false, 'a candidate the judgment already carried is not new');
  assert.equal(frameGrew(31, [{...grown, height: 3000}]), false, 'a bigger box of the same address is not new');
  assert.equal(frameGrew(99, [grown]), true, 'a tab with no judgment noted: every candidate is new');
});

test('a digest that said the way on is not in its list marks the tab blind; the "other" stop carries it as its evidence signal (unresolved: cc, 13 Oct 2026)', () => {
  noteSignal(41, {rung: 3, signal: 'blind'});
  assert.equal(blindOn(41), true);
  assert.equal(blindOr(41, 'confident'), 'blind');
  noteSignal(41, {rung: 2, signal: 'confident'});
  assert.equal(blindOn(41), false);
  assert.equal(blindOr(41, 'confident'), 'confident');
  const flow = ['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8')).join('\n');
  assert.match(flow, /deadEndHere\(tab, jobUrl, host, \(email \|\| told \|\| closed \|\| other\)\.why, [^\n]*signal: blindOr\(tab\.id, said\?\.signal\)\}\)/);
});
