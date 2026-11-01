// Every flow-core file starts with its invariants, each naming the test that guards it (docs/rules/applying.md "The flow core: one session at a time, invariants
// first", owner 10 Oct 2026). Fails on a core file without the block, or a block naming a test file that does not exist.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {FLOW_CORE} from '../e2e/flows.mjs';

const root = new URL('../../', import.meta.url);
const header = file => { const lines = fs.readFileSync(new URL(file, root), 'utf8').split('\n'); const end = lines.findIndex(line => !line.startsWith('//')); return lines.slice(0, end < 0 ? lines.length : end).join('\n'); };

test('every flow-core file has an Invariants block in its header', () => {
  const missing = FLOW_CORE.filter(file => !/Invariants?\b[^\n]*:/.test(header(file)));
  assert.deepEqual(missing, []);
});

test('every test an invariants block names exists', () => {
  const absent = [];
  for (const file of FLOW_CORE) {
    for (const [cited] of header(file).matchAll(/(?:desktop|worker)\/(?:e2e\/)?test\/(?:[\w-]+\/)?[\w.-]+\.test\.m?js/g)) if (!fs.existsSync(new URL(cited, root))) absent.push(`${file}: ${cited}`);
  }
  assert.deepEqual(absent, []);
});
