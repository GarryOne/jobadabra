// Box 6 part 2 of spec 2026-10-12-one-next-move.md: a page the digest called blind ("the way on is not in the list") is looked at with its PICTURE, in test runs only (the harness's ladderAct switch:
// the CI pool; owner, 13 Oct 2026: users keep it off), and the log says whether the picture confirmed the blind spot (the control it named led to a form). Each picture ask logs its cost.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

test('a blind page is looked at with its picture only under the test switch; the look says what it confirmed', () => {
  const flow = ['extension/fill-flow.js', 'extension/fill-flow-read.js', 'extension/fill-flow-steps.js'].map(read).join('\n');
  assert.match(flow, /const blindLook = blindOn\(tab\.id\) && \(await settings\(\)\.catch\(\(\) => null\)\)\?\.ladderAct === true;/);
  assert.match(flow, /closerLook\(tab, 0, 'the ladder ended at the person', \{kind: 'page', picture: blindLook\}\)/);
  assert.match(flow, /const blindVerdict = \(blindLook, look, led\) => \{ if \(blindLook\) decide\('fill', led \? "blind spot confirmed: the picture's control led to a form" : 'blind spot not confirmed: the picture found no way on', \{look\}\); \};/);
  assert.equal([...flow.matchAll(/blindVerdict\(blindLook, look, (true|led)\)/g)].length, 2, 'a verdict on every way out of the look: the early return and the fall-through');
});

test('every closer look logs whether it had a picture and what it cost', () => {
  const look = read('extension/ladder/rung4-picture.js');
  assert.match(look, /decide\('fill', `closer look: \$\{action\}`, \{tab: tab\.id, reason, by: answer\?\.by \|\| '', picture: !!image, usd: Number\(answer\?\.usd\) \|\| 0, \.\.\.viewOf\(answer\), why:/);
});

test('the app prices the look from its own usage and returns it, never more than the answer\'s own fields', async () => {
  const {escalate} = await import('../../desktop/lib/ladder/rung4-picture.js');
  const dir = fs.mkdtempSync(new URL('./', import.meta.url).pathname.replace(/\/worker\/test\/$/, '/') + '.tmp-blind-');
  try {
    const storage = {settings: () => ({accountAutomation: 'full'}), path: name => `${dir}/${name}`};
    const client = {messages: {create: async () => ({usage: {input_tokens: 2500, output_tokens: 200}, content: [{type: 'text', text: JSON.stringify({action: 'ask_person', control: '', control_kind: '', detail: '', option: '', why: 'no apply control is visible', confidence: 0.6})}]})}};
    const body = {kind: 'page', url: 'https://jobs.example.org/job/1', image: 'AAAA', reason: 'the ladder ended at the person', sketch: {title: 'Job', headings: ['Job'], controls: [], buttons: ['Share'], texts: [], frames: []}};
    const answer = await escalate(storage, body, {client});
    assert.equal(answer.action, 'ask_person');
    assert.equal(answer.usd, 0.014, '2500 in x $4/M + 200 out x $20/M (claude-opus-5-5)');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
