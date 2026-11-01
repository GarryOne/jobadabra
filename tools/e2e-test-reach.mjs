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
// Why (c27, 1 Nov 2026, area folders): the tests sit in test/<area>/; `fixtures` holds stand-ins, never tests.
const areas = ['', ...fs.readdirSync(path.join(root, folder), {withFileTypes: true}).filter(item => item.isDirectory() && item.name !== 'fixtures').map(item => item.name).sort()];   // '' = a flat file still runs (the npm script globs both)
for (const area of areas) {
  for (const name of fs.readdirSync(path.join(root, folder, area)).filter(file => /\.test\.[mc]?js$/.test(file)).sort()) {
    const file = area ? `${folder}/${area}/${name}` : `${folder}/${name}`;
    out[file] = [...reach(root, file, cache).paths];
  }
}
process.stdout.write(JSON.stringify(out));
