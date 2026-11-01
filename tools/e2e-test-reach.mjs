// Prints {harness test file: every repo path it reaches} as JSON, for tools/affected-tests.py (reuses desktop/e2e/lib/test-reach.mjs, the harness's own parser).
// Why (c27, 1 Nov 2026, owner "Yes, via affected-tests"): the picker's Python import graph misses folder reads by URL and declared reach lines; the parser that already knows them is not copied.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {reach} from '../desktop/e2e/lib/test-reach.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = 'desktop/e2e/test';
const cache = new Map();
const out = {};
for (const name of fs.readdirSync(path.join(root, folder)).filter(file => /\.test\.[mc]?js$/.test(file)).sort()) {
  const file = `${folder}/${name}`;
  out[file] = [...reach(root, file, cache).paths];
}
process.stdout.write(JSON.stringify(out));
