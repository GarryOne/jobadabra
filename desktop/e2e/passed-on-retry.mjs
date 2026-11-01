// The steps that failed and then passed on their beta retry, from the run's downloaded e2e artifacts: prints one release-notes line, or nothing.
//   node passed-on-retry.mjs --artifacts <dir>
// Why (1 Nov 2026, owner, "Auto-retry in betas only"): a beta releases past a step that passed on its retry, and the notes list it ("Passed on retry in this beta: <suite · step>, …").
// Reads steps.json of every suite folder (lib/runner.mjs writes `retried` on a passed step); a suite run on two stores is listed once.
// No reader of the list yet: the next night's fix list does not read `retried` (parked, not built). Tests: test/runner-beta-retry.test.mjs
// Job: report health
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {passedOnRetry, retryLine} from './lib/beta-retry.mjs';

const stepTables = folder => {
  const found = [], walk = dir => { for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes: true}) : []) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(full); else if (entry.name === 'steps.json') found.push(full);
  } };
  walk(folder);
  return found.sort();
};

/** The release-notes line for the steps that passed on retry in the artifacts under `folder` ('' when none did or a table cannot be read). */
export function retryLineFor(folder) {
  const items = new Set();
  for (const file of stepTables(folder)) {
    let table;
    try { table = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }   // clean-code-ok: Why (1 Nov 2026): an unreadable table lists nothing; the release never waits on a note
    for (const item of passedOnRetry(table.suite || file, table.results)) items.add(item);
  }
  return retryLine([...items]);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const line = retryLineFor(args[args.indexOf('--artifacts') + 1]);
  if (line) console.log(line);
}
