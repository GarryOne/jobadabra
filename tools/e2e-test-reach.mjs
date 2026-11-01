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
// Why (pa, 1 Nov 2026, prune audit 3/4): the flag --all adds the extension integration tests that harness.yml also runs (npm test globs both folders), so tests/test_workflow_paths.py checks that harness.yml's
// paths: start the run for everything those tests reach; this replaces test/harness/test-reach.test.mjs's own copy of that check. The picker (affected-tests.py) calls it without the flag.
if (process.argv.includes('--all')) {
  const base = 'desktop/integration/extension';
  for (const item of fs.readdirSync(path.join(root, base), {withFileTypes: true})) {
    const names = item.isDirectory() && item.name !== 'fixtures' ? fs.readdirSync(path.join(root, base, item.name)).map(name => `${item.name}/${name}`) : item.isFile() ? [item.name] : [];
    for (const name of names.filter(file => /\.test\.mjs$/.test(file)).sort()) out[`${base}/${name}`] = [...reach(root, `${base}/${name}`, cache).paths];
  }
}
process.stdout.write(JSON.stringify(out));
