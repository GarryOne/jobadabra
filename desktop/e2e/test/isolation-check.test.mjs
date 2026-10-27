// The harness's isolation check (lib/real-extension.mjs isolationProblem): the extension talks to the stand-in app only, never the owner's live app on 47111.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isolationProblem} from '../lib/real-extension.mjs';

const ours = port => `{"token":"e2e","workerUrl":"http://127.0.0.1:${port}","ladderAct":true`;

test('a timestamp holding the digits 47111 is no live address (27 Oct 2026, run 40447725087: "boot":"1793074711121" failed an isolated run)', () => {
  assert.equal(isolationProblem(`${ours(42941)},"fillMemory":{"at":1793074714689,"boot":"1793074711121","items":{}}}`, 42941), '');
});

test('an address on the live port anywhere, or another app address, is not isolated', () => {
  assert.match(isolationProblem(`${ours(42941)},"lastApp":"http://127.0.0.1:47111/api"}`, 42941), /NOT ISOLATED: .*"127\.0\.0\.1:47111" stored at/);
  assert.match(isolationProblem(`${ours(42941)},"x":"localhost:47111"}`, 42941), /NOT ISOLATED/);
  assert.match(isolationProblem('{"workerUrl":"http://127.0.0.1:47111"}', 42941), /NOT ISOLATED: .*workerUrl stored: "workerUrl":"http:\/\/127\.0\.0\.1:47111"/);
  assert.match(isolationProblem('{}', 42941), /workerUrl stored: none/);
  assert.equal(isolationProblem(`${ours(42941)},"y":"127.0.0.1:471112"}`, 42941), '', 'another port that starts with 47111');
});
