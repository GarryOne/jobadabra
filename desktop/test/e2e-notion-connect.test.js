// Every e2e place that connects Notion says which kind of profile it is: one that reuses the suite's workspace goes through e2e/lib/notion-reuse.mjs (a profile with no saved workspace starts a new one, 16 Oct 2026), the rest are listed here with why.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const e2e = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'e2e');
const BY_DESIGN = {
  'lib/wizard.mjs': 'a new install builds its own workspace in an empty test page',
  'lib/notion-reuse.mjs': 'the helper itself',
  'lib/seed.mjs': 'saves RECONNECT right before the connect',
};
const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.name === 'node_modules' ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

test('every e2e notionConnect call reuses the suite workspace through notion-reuse, or is listed as by design', () => {
  for (const file of walk(e2e).filter(f => f.endsWith('.mjs'))) {
    const rel = path.relative(e2e, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    if (!/notionConnect\(/.test(text)) continue;
    assert.ok(BY_DESIGN[rel], `${rel} calls notionConnect directly: use connectExisting (e2e/lib/notion-reuse.mjs) or list it in BY_DESIGN with why`);
  }
  assert.match(fs.readFileSync(path.join(e2e, 'lib/seed.mjs'), 'utf8'), /saveSettings\(reconnect\)[\s\S]*notionConnect/, 'the seed must save RECONNECT before it connects');
});
