// Layer 3 (Node + the real engine + a temp store, no window): a remembered answer is kept in this Mac's Availability & compensation. Moved from the e2e `stores` suite (1 Nov 2026, R2); the
// route is the one the page's "Remember" takes: lib/questions.js remember (the AI names the home) then profile-sections read (what Your details shows). The window side is the Your details tests.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {startEngineKit} from './engine-kit.mjs';

let kit, questions, sections, claudeAi;
before(async () => {
  kit = await startEngineKit({});
  [questions, sections, {claudeAi}] = await Promise.all([import('../../lib/questions.js'), import('../../lib/profile-sections.js'), import('../../lib/question-ai.js')]);
});
after(async () => { await kit?.close(); });

test('a remembered answer is kept in this Mac\'s Availability & compensation', async () => {
  const QUESTION = 'What is your notice period?', ANSWER = 'Three months, negotiable';
  // Why (29 Oct 2026, run 40836904987; #2427 exposed it, moved from e2e 1 Nov 2026): the test proves persistence in the returned home, given a fixed classification; any other question is refused.
  kit.proxy.setCanned(body => body.messages?.[0]?.content === JSON.stringify([{id: 'q', line: `${QUESTION}: ${ANSWER}`}])
    ? JSON.stringify({items: [{id: 'q', home: 'availability', topic: 'notice period', clarity: 'clear'}]}) : {refuse: 'invalid-key'});
  const calls = kit.proxy.stats.calls;
  const result = await questions.remember(kit.storage, QUESTION, ANSWER, undefined, {ai: claudeAi(kit.storage)});
  assert.ok(kit.proxy.stats.calls > calls, 'the AI was never asked where the answer belongs (test setup)');
  assert.ok(result?.ok && result.home === 'availability', `remember did not save to Availability & compensation: ${JSON.stringify(result)}`);
  const found = await sections.read(kit.storage);
  assert.ok(found[result.home]?.some(field => field.label === QUESTION && field.value === ANSWER), `${result.homeName} does not hold the remembered answer`);
});
