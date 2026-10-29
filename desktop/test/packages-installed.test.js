// A desktop test runs on CI with only desktop/'s packages installed. A package it reaches through a file outside desktop/ (jsdom through
// worker/test/helpers/page.js) loads locally through the worktree's links and fails only on CI: #2429, 29 Oct 2026. DOM tests go in worker/test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {builtinModules} from 'node:module';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const DESKTOP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'));
const INSTALLED = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
const SPEC = /^\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;   // import lines and import('x')

// -> the package name of a bare import specifier ('@scope/x/y' -> '@scope/x', 'x/y' -> 'x').
const packageOf = spec => spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];

// -> the bare packages missing from desktop/package.json that files outside desktop/ load, for every file the tests reach by relative imports.
function missingFrom(testFiles) {
  const missing = [], seen = new Set();
  const walk = file => {
    if (seen.has(file) || !fs.existsSync(file) || !/\.(m?js|cjs)$/.test(file)) return;
    seen.add(file);
    const outside = !file.startsWith(DESKTOP + path.sep);
    for (const match of fs.readFileSync(file, 'utf8').matchAll(SPEC)) {
      const spec = match[1] || match[2] || match[3];
      if (spec.startsWith('.')) walk(path.resolve(path.dirname(file), spec));
      else if (outside && !spec.startsWith('node:') && !builtinModules.includes(packageOf(spec)) && !INSTALLED.has(packageOf(spec)))
        missing.push(`${path.relative(DESKTOP, file).replaceAll('\\', '/')}: ${packageOf(spec)}`);
    }
  };
  testFiles.forEach(walk);
  return missing;
}

test('no desktop test reaches a package that desktop/ does not install, through a file outside desktop/', () => {
  const dir = path.join(DESKTOP, 'test');
  const found = missingFrom(fs.readdirSync(dir).filter(name => /\.m?js$/.test(name)).map(name => path.join(dir, name)));
  assert.deepEqual(found, [], 'a desktop test reaches these through files outside desktop/: move it to the suite that installs the package (a DOM test: worker/test)');
});
