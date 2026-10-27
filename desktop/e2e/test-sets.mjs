// Which harness test files run where (test-sets.json): the PR set or the daily set; prints one set's files for the CI workflows to hand to node --test.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {reachedTests} from './lib/test-reach.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

export function testSets() {
  const {pr, daily} = JSON.parse(readFileSync(`${here}test-sets.json`, 'utf8'));
  return {pr, daily};
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'reached') {
  // `reached --base <ref>`: GITHUB_OUTPUT lines files=<test/... list> and browser=true|false; why each file runs goes to stderr (the job's log).
  const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'origin/main';
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const changed = execFileSync('git', ['-C', root, 'diff', '--name-only', `${base}...HEAD`], {encoding: 'utf8'}).split('\n').filter(Boolean);
  const {pr, daily} = testSets(), inRepo = file => `desktop/e2e/test/${file}`;
  const {files, browser, why} = reachedTests({root, tests: [...pr, ...daily].map(inRepo), changed, always: pr.map(inRepo)});
  for (const file of files) console.error(`runs ${file.replace('desktop/e2e/', '')}: ${why[file]}`);
  console.error(`${files.length} of ${pr.length + daily.length} harness test files reached by ${changed.length} changed file(s)`);
  console.log(`files=${files.map(file => file.replace('desktop/e2e/', '')).join(' ')}`);
  console.log(`browser=${browser}`);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sets = testSets();
  const which = process.argv[2];
  if (!sets[which] && which !== 'all') { console.error('usage: node test-sets.mjs pr|daily|all|reached [--base <ref>]'); process.exit(2); }
  const files = which === 'all' ? [...sets.pr, ...sets.daily] : sets[which];
  console.log(files.map((f) => `test/${f}`).join(' '));
}
