// Harness self-tests declare every external package their import graph reaches in desktop/e2e/package.json, independently of the app's install.
// On 9 Oct 2026 the Notion stand-in reached the app's AI client and CI lacked its SDK while every Mac had it.
// This walks static and literal dynamic imports, rejecting packages outside this folder's declared dependencies.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {builtinModules} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
const INSTALLED = new Set(Object.keys({...pkg.dependencies, ...pkg.devDependencies}));
const BUILTIN = new Set(builtinModules);
const STATIC = /^\s*(?:import|export)\s[^'"`]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/;
const DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
// A bare package imported lazily is needed only if that line runs at load (top level) with no fallback: `import('openai').then(m, () => null)`
// and an import inside a function body (indented) are optional; a relative module is always followed (the stand-in reached the AI client so).
const optional = line => /^\s/.test(line) || /\.catch\(|,\s*\(\)\s*=>/.test(line);
const packageOf = spec => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

// {package: [the first file that needs it]} for every package outside `installed`, reached from `entries`.
export function missingPackages(entries, installed = INSTALLED) {
  const seen = new Set(), missing = {}, queue = [...entries];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file) || !/\.(m?js|cjs)$/.test(file)) continue;
    seen.add(file);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const found = [];
    for (const line of text.split('\n')) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;   // a comment
      const fixed = STATIC.exec(line);
      if (fixed) found.push(fixed[1] || fixed[2]);
      for (const lazy of line.matchAll(DYNAMIC)) if (lazy[1].startsWith('.') || !optional(line)) found.push(lazy[1]);
    }
    for (const spec of found) {
      if (spec.startsWith('.')) { queue.push(path.resolve(path.dirname(file), spec)); continue; }
      const name = packageOf(spec.replace(/^node:/, ''));
      if (spec.startsWith('node:') || BUILTIN.has(name) || installed.has(name)) continue;
      (missing[name] ||= []).push(path.relative(path.join(HERE, '..', '..', '..'), file));
    }
  }
  return missing;
}

test('every module the harness\'s unit tests reach needs only desktop/e2e\'s own packages', () => {
  const tests = fs.readdirSync(HERE).filter(name => name.endsWith('.test.mjs')).map(name => path.join(HERE, name));
  const missing = missingPackages(tests);
  assert.deepEqual(Object.fromEntries(Object.entries(missing).map(([name, files]) => [name, files[0]])), {},
    'add the package to desktop/e2e/package.json, or import a leaf module (lib/root.js) instead of one that pulls the app in');
});

test('positive control: a module two imports away that needs an uninstalled package is found', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-installed-only-'));
  try {
    fs.writeFileSync(path.join(folder, 'entry.test.mjs'), "import {x} from './middle.mjs';\nexport const y = x;\n");
    fs.writeFileSync(path.join(folder, 'middle.mjs'), "export const x = 1;\nexport const later = () => import('./client.mjs');\n");
    fs.writeFileSync(path.join(folder, 'client.mjs'), "import Anthropic from '@anthropic-ai/sdk';\nimport fs from 'node:fs';\nexport default Anthropic;\n");
    // This fixture models an empty install even when the real harness declares the SDK.
    assert.deepEqual(Object.keys(missingPackages([path.join(folder, 'entry.test.mjs')], new Set())), ['@anthropic-ai/sdk']);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});
