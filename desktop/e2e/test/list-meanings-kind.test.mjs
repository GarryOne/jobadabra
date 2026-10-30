// Prove Strategy's list-meanings ask names its step, so a backbone suite that opens Strategy is answered from the table.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {test} from 'node:test';
import {loadTable, questionOf, storedAnswer} from '../lib/ai-answers.mjs';

const backbone = {E2E_AI_ANSWERS: 'backbone', E2E_SUITE: 'list-meanings-kind', E2E_ARTIFACTS: path.join(os.tmpdir(), 'list-meanings-kind')};
// Why (30 Oct 2026, ap): the manifest's list_meanings entry is the request lib/list-meanings.js really builds, with the action header it really sends (tools/ai-format-capture.mjs runs the real sender and fails when the header differs), so this test needs no app import.
const entry = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/ai-format-manifest.json', import.meta.url), 'utf8')).entries.find(each => each.kind === 'list_meanings');
const request = {url: '/v1/messages', headers: {'content-type': 'application/json', 'x-jp-action': entry?.action}, body: JSON.stringify(entry?.request)};

// Why (30 Oct 2026, ap, wander red on main run 40985357367): the sender sent no x-jp-action, so before this the question was unkeyable.
test('the real list-meanings request names its step and is keyed as the list_meanings kind in backbone mode only', () => {
  assert.ok(entry, 'positive control: the manifest holds the captured list_meanings request');
  assert.equal(entry.action, 'list_meanings');
  assert.match(entry.request.system, /^You read the lists of a job seeker's search settings/);
  assert.deepEqual(questionOf(request, backbone), {operation: 'app.kind', id: 'list_meanings'});
  assert.match(questionOf(request, {E2E_AI_ANSWERS: 'off'}).unkeyable, /question identity is not in the request/);
});

test('its stored answer reads as "no groups, no typos", so Strategy shows the chips as written', () => {
  assert.ok(Object.hasOwn(loadTable().kinds, 'list_meanings'));
  const {reply} = storedAnswer(request, backbone);
  assert.deepEqual(JSON.parse(reply.content[0].text), {lists: []});
});
