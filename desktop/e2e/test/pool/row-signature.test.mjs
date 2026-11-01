// lib/row-signature.mjs: what a row replay (or the live run) DID, as a small comparable signature (page kinds in order, presses, each field's outcome and reason), the improvement a new build
// shows over the live run (the case's `expect`, written by the tool, never by the fixer) and the check a replay must pass against it.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {baselineSignature, checkSignature, expectFrom, filledBoxes, signatureOf} from '../../lib/row-signature.mjs';

const log = entries => ({route: '/extension/log', body: JSON.stringify({entries})});
const run = trace => ({route: '/extension/run', body: JSON.stringify({trace})});
const replay = (kinds, trace, presses = []) => ({appLog: kinds.map((kind, at) => `12:00:0${at}Z [extension] page kind: ${kind} {"by":"ai"}`).join('\n'),
  requests: [log(presses.map(label => ({text: 'fill: pressed the Apply button', fields: {label}}))), run(trace)], followed: presses.length, divergence: ''});

test('a replay\'s signature: page kinds in order (a repeat once), presses, fields as outcome and reason without timings', () => {
  const sig = signatureOf(replay(['posting', 'posting', 'form'], [{label: 'Email', outcome: 'filled', reason: 'your details'}, {label: 'Country', outcome: 'left', reason: 'dropdown clicked for you (1.2 s)'}], ['Apply']));
  assert.deepEqual(sig, {kinds: ['posting', 'form'], pressed: ['pressed the Apply button'], fields: {Email: 'filled: your details', Country: 'left: dropdown clicked for you'}, boxes: {}, diverged: false});
});

test('the live run\'s baseline in the same shape, from what the capture kept', () => {
  const base = baselineSignature({pageKinds: ['page kind: posting {"by":"ai"}'], fields: [{label: 'Email', outcome: 'filled', reason: 'your details'}], pressed: ['pressed the Apply button']});
  assert.deepEqual(base, {kinds: ['posting'], pressed: ['pressed the Apply button'], fields: {Email: 'filled: your details'}, diverged: false});
});

test('expect is what the new build does beyond the live run: a later page kind, more presses, a field that changed outcome or reason; nothing improved is refused, a regression is named', () => {
  const base = {kinds: ['posting'], pressed: [], fields: {Email: 'filled: your details', Why: 'left: no answer in the kit, Profile or your details'}, diverged: false};
  const better = {kinds: ['posting', 'form'], pressed: ['pressed the Apply button'], fields: {Email: 'filled: your details', Why: 'left: proposed for you to confirm'}, diverged: false};
  assert.deepEqual(expectFrom(base, better), {ok: true, expect: {kinds: ['posting', 'form'], pressed: ['pressed the Apply button'], fields: {Why: 'left: proposed for you to confirm'}}});
  assert.match(expectFrom(base, base).refused, /nothing improved/);
  assert.match(expectFrom(base, {...better, fields: {Email: 'left: x'}}).refused, /regressed.*Email/);
  assert.match(expectFrom(base, {...better, diverged: true}).refused, /diverged/);
});

test('a replay passes the check when it shows every part of expect; the old build\'s signature fails it, naming the part', () => {
  const expect = {kinds: ['posting', 'form'], pressed: ['pressed the Apply button'], fields: {Why: 'left: proposed for you to confirm'}};
  const good = {kinds: ['posting', 'form'], pressed: ['pressed the Apply button'], fields: {Email: 'filled: your details', Why: 'left: proposed for you to confirm'}, diverged: false};
  assert.deepEqual(checkSignature(good, expect), []);
  const old = {kinds: ['posting'], pressed: [], fields: {Why: 'left: no answer in the kit, Profile or your details'}, diverged: false};
  assert.deepEqual(checkSignature(old, expect), ['page kinds: posting, expected posting, form', 'presses: none, expected pressed the Apply button', 'field Why: left: no answer in the kit, Profile or your details, expected left: proposed for you to confirm']);
});

test('boxes: the text boxes that hold a value when the replay ends (labels only, never a value) are part of the signature, so a fix that retypes a box the page emptied shows', () => {
  const withBoxes = (boxes, extra = {}) => ({...replay(['form'], []), boxes, ...extra});
  assert.deepEqual(signatureOf(withBoxes({Prénom: 'filled', Nom: 'empty'})).boxes, {Prénom: 'filled', Nom: 'empty'});
  assert.deepEqual(signatureOf(replay(['form'], [])).boxes, {}, 'a replay that read none');
  const expect = {boxes: {Prénom: 'filled', Linkedin: 'filled'}};
  assert.deepEqual(checkSignature({...signatureOf(withBoxes({Prénom: 'filled', Linkedin: 'filled', Nom: 'empty'}))}, expect), []);
  assert.deepEqual(checkSignature(signatureOf(withBoxes({Prénom: 'filled', Linkedin: 'empty'})), expect), ['box Linkedin: empty, expected filled']);
  assert.deepEqual(checkSignature(signatureOf(withBoxes({Prénom: 'filled'})), expect), ['box Linkedin: absent, expected filled']);
  assert.deepEqual(filledBoxes({Prénom: 'filled', Nom: 'empty', Mail: 'filled'}), {Prénom: 'filled', Mail: 'filled'});
});

test('an expectation with no colon is an outcome only: the reason text may differ; one with a colon is exact', () => {
  const sig = {kinds: [], pressed: [], fields: {Name: 'left: no answer in the kit', Phone: 'filled: your details'}, boxes: {}};
  assert.deepEqual(checkSignature(sig, {fields: {Name: 'left', Phone: 'filled'}}), []);
  assert.deepEqual(checkSignature(sig, {fields: {Name: 'filled'}}), ['field Name: left: no answer in the kit, expected filled']);
  assert.deepEqual(checkSignature(sig, {fields: {Name: 'left'}, boxes: {}}), []);
  assert.equal(checkSignature(sig, {fields: {Name: 'left: another reason'}}).length, 1, 'with a colon: exact');
  assert.deepEqual(checkSignature(sig, {fields: {Missing: 'left'}}), ['field Missing: absent, expected left']);
});
