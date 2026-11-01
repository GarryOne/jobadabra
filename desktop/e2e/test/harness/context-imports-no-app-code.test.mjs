// context.mjs loads before staging: its static import graph must not need desktop/shared/ (#2364); pure app leaves need no staging.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const lib = path.join(path.resolve(import.meta.dirname, '..'), '..', 'lib');
const desktop = path.resolve(lib, '..', '..');
const importsOf = source => [...source.matchAll(/^\s*(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/gm)].map(match => match[1]);

/** Follow every static relative import and re-export, reporting staged files even when they exist on the developer's Mac. */
function unstagedImports(entry, read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '') {
  const seen = new Set(), bad = new Set(), queue = [entry];
  const shared = path.join(desktop, 'shared') + path.sep;
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(read(file)).filter(name => name.startsWith('.'))) {
      const imported = path.resolve(path.dirname(file), spec);
      if (imported.startsWith(shared)) bad.add(path.relative(desktop, imported).replaceAll('\\', '/'));
      else if (/\.(m?js|cjs)$/.test(imported)) queue.push(imported);
    }
  }
  return [...bad].sort();
}

test('the files context.mjs statically imports need no desktop/shared/ files before staging', () => {
  const bad = unstagedImports(path.join(lib, 'context.mjs'));
  assert.deepEqual(bad, [], 'move the staged-file dependency out of the context import graph (see lib/hidden-browser-env.mjs)');
});

test('a transitive staged dependency is rejected, including side-effect imports and re-exports', () => {
  const entry = path.join(lib, 'fixture-context.mjs');
  const graph = new Map([
    [entry, "import {helper} from '../fixture-helper.mjs';"],
    [path.join(lib, 'fixture-helper.mjs'), "export {leaf} from '../../../lib/fixture-leaf.js';"],
    [path.join(desktop, 'lib', 'fixture-leaf.js'), "import '../../shared/alias-schema.js';\nexport {x} from '../../shared/worker/ai.js';"],
  ]);
  assert.deepEqual(unstagedImports(entry, file => graph.get(file) || ''), ['shared/alias-schema.js', 'shared/worker/ai.js']);
  graph.set(path.join(desktop, 'lib', 'fixture-leaf.js'), "import path from 'node:path';\nexport const leaf = path.sep;");
  assert.deepEqual(unstagedImports(entry, file => graph.get(file) || ''), []);
});
