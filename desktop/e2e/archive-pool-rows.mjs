// node archive-pool-rows.mjs [--write] [--only fixed,posting-gone]: reads /admin/form-filling/lab's rows that may be archived (owner key from the Keychain, never printed), lists them with their
// reason, and with --write marks them `stage: "archived"` in smoke-sites.json (lib/pool-archive.mjs) for a PR. Without --write it changes nothing. Guard: e2e/test/pool-archive.test.mjs.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WHY, archiveRows} from './lib/pool-archive.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), file = path.join(here, 'smoke-sites.json');
const args = process.argv.slice(2), write = args.includes('--write'), only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',').filter(why => WHY.includes(why)) : WHY;
const key = execFileSync('security', ['find-generic-password', '-s', 'job-pilotto.site.api_key', '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
const answer = await fetch('https://www.jobpilotto.top/admin/form-filling/lab?json', {headers: {Authorization: `Bearer ${key}`, 'X-Caller': 'archive-pool-rows'}, signal: AbortSignal.timeout(30000)});
if (!answer.ok) { console.error(`archive: the page answered ${answer.status}`); process.exit(1); }
const items = Object.values((await answer.json()).pool || {}), pool = JSON.parse(fs.readFileSync(file, 'utf8'));
const done = archiveRows(pool, items, {only, day: new Date().toISOString().slice(0, 10)});
console.log(done.length ? done.map(item => `${write ? 'archived' : 'would archive'} ${item.shape} (${item.why})`).join('\n') : 'nothing to archive');
if (write && done.length) fs.writeFileSync(file, `${JSON.stringify(pool, null, 1)}\n`);
