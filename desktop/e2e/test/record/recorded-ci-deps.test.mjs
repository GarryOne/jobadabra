// Every CI job that runs the harness's own tests or the recorded cases must install the app's own packages: they start the offline app (desktop/lib/server.js), which imports them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {builtinModules} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const root = path.resolve(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..', '..', '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/page-cases.yml'), 'utf8');

test('the recorded-pages workflow installs desktop/ packages, and the offline app\'s bare imports are all among them', () => {
  assert.match(workflow, /working-directory: desktop\n\s+run: npm (ci|install)\b/, 'a step installs desktop/ packages (the 34 old cases never started the app; the first row case did and died with ERR_MODULE_NOT_FOUND on 11 Oct 2026)');
  const deps = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'desktop/package.json'), 'utf8')).dependencies);
  const lib = path.join(root, 'desktop/lib');
  const bare = new Set();
  const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).forEach(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(file);
    if (!/\.(js|mjs)$/.test(entry.name)) return;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/(?:from|import\(|require\()\s*['"](@[^/'"]+\/[^'"/]+|[a-z][\w.-]*)(?:\/[^'"]*)?['"]/g)) bare.add(match[1]);
  });
  walk(lib);
  const builtin = new Set(['electron', ...builtinModules]);
  const missing = [...bare].filter(name => !builtin.has(name) && !name.startsWith('node:') && !deps.includes(name));
  assert.deepEqual(missing, [], 'a package desktop/lib imports that is not in desktop/package.json dependencies (the CI job installs only those)');
});

// The class (12 Oct 2026: the e2e plan job ran `npm test` without them and no scheduled suite ran for 11 hours): any job that runs the harness tests, whatever the workflow.
test('every workflow job that runs the harness tests or the recorded cases installs desktop/ packages first', () => {
  const dir = path.join(root, '.github/workflows');
  const lacking = [], unstaged = [];
  let seen = 0;
  for (const file of fs.readdirSync(dir).filter(name => /\.ya?ml$/.test(name))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const jobs = text.split(/^jobs:\n/m)[1]?.split(/^  ([\w-]+):\n/m) || [];
    for (let i = 1; i < jobs.length; i += 2) {
      const block = jobs[i + 1];
      const steps = block.split(/\n      - /);   // a step may carry an env: block between its working directory and its run
      if (!steps.some(step => /working-directory: desktop\/e2e\b/.test(step) && /^\s+run: (npm test|npm run recorded\b|node --test)/m.test(step))) continue;
      seen += 1;
      // Either spelling installs them: a `working-directory: desktop` step, or `cd desktop && npm ci` inside a step (main's one Linux job since #883).
      if (!/working-directory: desktop\n\s+run: npm (ci|install)\b/.test(block) && !/cd desktop && \(?npm (ci|install)\b/.test(block)) lacking.push(`${file} :: ${jobs[i]}`);
      // The harness's unit tests (not the recorded replay) also import desktop/shared, which is generated: a job that runs them stages it first.
      if (steps.some(step => /^\s+run: (npm test\b|node --test\b(?![^\n]*recorded-pages))/m.test(step)) && !/working-directory: desktop\n\s+run: node scripts\/stage\.mjs/.test(block) && !/cd desktop && [^\n]*node scripts\/stage\.mjs/.test(block)) unstaged.push(`${file} :: ${jobs[i]}`);
    }
  }
  assert.ok(seen >= 2, 'the check found the plan job and the recorded-pages job (the pattern still matches the workflows)');
  assert.deepEqual(lacking, [], 'a job runs the harness tests without installing desktop/ packages (ERR_MODULE_NOT_FOUND for @anthropic-ai/sdk)');
  assert.deepEqual(unstaged, [], 'a job runs the harness tests without staging desktop/shared (node scripts/stage.mjs --files-only: ERR_MODULE_NOT_FOUND for shared/alias-schema.js)');
});
