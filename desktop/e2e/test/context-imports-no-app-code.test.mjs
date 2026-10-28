// context.mjs is loaded before desktop/shared/ is staged (lib/suite-main.mjs), so the lib files it imports must not import app code that needs shared/ (#2364: every apply suite died on CI).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const lib = path.join(import.meta.dirname, '..', 'lib');
const importsOf = file => [...fs.readFileSync(file, 'utf8').matchAll(/^import [^'\n]*from '([^']+)'/gm)].map(match => match[1]);

test('the files context.mjs imports do not import the app\'s own code (it needs desktop/shared/, staged only after context.mjs loads)', () => {
  const bad = [];
  for (const spec of importsOf(path.join(lib, 'context.mjs')).filter(name => name.startsWith('./'))) {
    const file = path.join(lib, spec);
    if (!fs.existsSync(file)) continue;
    for (const inner of importsOf(file).filter(name => /^\.\.\/\.\.\/(lib|shared)\//.test(name))) bad.push(`${spec} imports ${inner}`);
  }
  assert.deepEqual(bad, [], 'move the app-code part out of the file context.mjs imports (see lib/hidden-browser-env.mjs)');
});
