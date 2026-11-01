// The rung trailer (tools/rung-trailer.mjs): a push that touches the ladder's flow code says in a commit message which rung it changes and which fixture shows it:
//   Rung: <0-6 | router | judges>        Fixture: <fixture id[, id] | none: <why>>
// Fake commit ranges; the hook must not ask a push that touches no flow file.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isFlowPush, missingTrailer} from '../../tools/rung-trailer.mjs';
import {FLOW_FILES} from '../e2e/flows.mjs';

const IDS = ['aldi-suisse', 'hornbach-successfactors', 'trap-press-address-de'];
const ask = (changed, messages) => missingTrailer(changed, messages, FLOW_FILES, IDS);
const FLOW = ['extension/fill-flow.js'];

test('a push touching no flow file is never asked: docs, fixtures, the baseline, the renderer, tools', () => {
  assert.equal(ask(['docs/flows/ladder.md', 'desktop/e2e/ladder-fixtures/aldi-suisse.json', 'desktop/e2e/ladder-baseline.json', 'desktop/renderer/pages/jobs.js', 'tools/x.mjs'], ['Fix a label']), '');
  assert.equal(isFlowPush(['README.md'], FLOW_FILES), false);
});

test('which files count as flow code: FLOW_FILES, the rung folders, the page-kind facade and the two judges', () => {
  for (const file of [...FLOW, 'desktop/lib/ladder/rung3-digest.js', 'desktop/lib/page-kind.js', 'desktop/lib/account-judge.js', 'desktop/lib/form-judge.js', 'extension/ladder/core.js']) assert.equal(isFlowPush([file], FLOW_FILES), true, file);
});

test('a flow push without the trailers is stopped, naming what is missing', () => {
  const none = ask(FLOW, ['Fix a press']);
  assert.match(none, /Rung:/); assert.match(none, /Fixture:/);
  assert.match(ask(FLOW, ['Fix\n\nRung: 3']), /Fixture:/);
  assert.doesNotMatch(ask(FLOW, ['Fix\n\nRung: 3']), /add a line "Rung:/);
  assert.match(ask(FLOW, ['Fix\n\nFixture: aldi-suisse']), /Rung:/);
});

test('the right trailers let it through, from one commit or two, with a list of fixtures', () => {
  assert.equal(ask(FLOW, ['Fix a press\n\nRung: 2\nFixture: aldi-suisse\n\nCo-Authored-By: x']), '');
  assert.equal(ask(FLOW, ['Rung: router', 'Another\n\nFixture: aldi-suisse, hornbach-successfactors']), '');
  assert.equal(ask(FLOW, ['Rung: judges\nFixture: trap-press-address-de']), '');
  assert.equal(ask(FLOW, ['Rung: 0\nFixture: none: a pure move of files']), '');
  assert.equal(ask(FLOW, ['Rung: 2, 3\nFixture: aldi-suisse']), '');
});

test('a flow edit no rung decides (a log line, a timing) says "Rung: none: <why>" and needs no fixture', () => {
  assert.equal(ask(FLOW, ['Keep required in the logged fill line\n\nRung: none: only the fill log line changes']), '');
  assert.match(ask(FLOW, ['Rung: none']), /needs a reason/);
  assert.match(ask(FLOW, ['Rung: none: ']), /needs a reason/);
  assert.match(ask(FLOW, ['Rung: none: log only', 'Rung: 2']), /Fixture:/);   // a real rung in the range still needs its fixture
});

test('a wrong value is named: an unknown rung, an unknown fixture, a "none" without a reason', () => {
  assert.match(ask(FLOW, ['Rung: 7\nFixture: aldi-suisse']), /Rung: 7/);
  assert.match(ask(FLOW, ['Rung: banana\nFixture: aldi-suisse']), /Rung: banana/);
  assert.match(ask(FLOW, ['Rung: 2\nFixture: aldi-suiss']), /no fixture "aldi-suiss"/);
  assert.match(ask(FLOW, ['Rung: 2\nFixture: aldi-suisse, nope']), /no fixture "nope"/);
  assert.match(ask(FLOW, ['Rung: 2\nFixture: none']), /needs a reason/);
  assert.match(ask(FLOW, ['Rung: 2\nFixture: none: ']), /needs a reason/);
});
