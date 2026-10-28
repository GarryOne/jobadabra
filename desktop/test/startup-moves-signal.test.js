// The app tells when its start-up move into the store is over ("startup moves finished", lib/background-handlers.js), because that move drops profile.md and answers.md
// once Notion has them: the settings suite's export lost them under it (main, 28 Oct 2026). The suite waits for that line before it writes its own local copies.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('the start-up move logs when it is over, after the move itself and on every outcome', () => {
  const handlers = read('lib/background-handlers.js');
  assert.match(handlers, /startupMove\.track\(critical\.during\('Moving your data to Notion', \(\) => migrate\.run\(storage, log\)\)\)\.then\(moved => \{ appLog\('migrate', 'startup moves finished'/);
});

test('the settings round trip waits for that line (a state wait) before it writes or packs the local copies', () => {
  const suite = read('e2e/suites/settings.mjs');
  const wait = suite.indexOf('await waitForLogLine(ctx.profile, /startup moves finished/g'), write = suite.indexOf("fs.writeFileSync(at(name), `# e2e ${name}");
  assert.ok(wait > 0 && write > wait, 'the wait comes before the local files are written');
  assert.match(suite, /startup moves finished/);
});
