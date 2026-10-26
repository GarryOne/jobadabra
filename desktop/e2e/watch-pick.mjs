// node watch-pick.mjs <out dir> <states dir>: the daily watch's first job (.github/workflows/watch-live.yml). Lists the pool's watch rows, reads the earlier watch runs' spend lines
// (<states dir>/<run>/watch.json) and sets count/only/max_usd through GITHUB_OUTPUT; at the month's $25 cap it sets count=0 and tells Telegram once a month. No AI, no browser.
// Guard: e2e/test/watch-cli.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MAX_ROWS, budget, capText, watchRows} from './lib/watch-list.mjs';
import {postTelegram} from './lib/telegram-post.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// <states dir>/<run id>/watch.json: {at, usd, rows: {shape: state}, capAlertMonth?}
export function readStates(dir) {
  try { return fs.readdirSync(dir).map(name => readJson(path.join(dir, name, 'watch.json'))).filter(Boolean).sort((a, b) => String(a.at).localeCompare(String(b.at))); } catch { return []; }
}

export async function main(argv = process.argv.slice(2), env = process.env, send = postTelegram) {
  const [out = 'watch-out', statesDir = 'watch-states'] = argv, now = new Date(env.WATCH_NOW || Date.now());
  fs.mkdirSync(out, {recursive: true});
  const pool = readJson(path.join(here, 'smoke-sites.json'))?.shapes || [], rows = watchRows(pool).slice(0, MAX_ROWS), states = readStates(statesDir);
  const money = budget(states, now, rows.length), alerted = states.some(state => state.capAlertMonth === money.month), alert = money.capped && !alerted;
  const count = money.capped ? 0 : rows.length;
  if (alert) {   // told once a month: this state file (uploaded by the workflow) is how the next runs know
    fs.mkdirSync(path.join(out, 'alert-state'), {recursive: true});
    fs.writeFileSync(path.join(out, 'alert-state', 'watch.json'), `${JSON.stringify({at: now.toISOString(), usd: 0, rows: {}, capAlertMonth: money.month})}\n`);
    console.log(`watch: ${await send(capText({month: money.month, spent: money.spent, cap: 25}), {env}).catch(error => `telegram failed (${String(error?.message || error).slice(0, 80)})`)}`);
  }
  fs.writeFileSync(path.join(out, 'picked.json'), `${JSON.stringify({day: now.toISOString().slice(0, 10), rows: rows.map(row => row.shape), budget: money}, null, 1)}\n`);
  const lines = [`watch: month ${money.month}: spent $${money.spent} of $25, ${rows.length} watch row(s), AI cap $${money.maxUsd} for this run${money.capped ? ' (cap reached: no run)' : ''}`, ...rows.map(row => `watch: ${row.shape}`)];
  console.log(lines.join('\n'));
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `count=${count}\nonly=${rows.map(row => row.shape).join('|')}\nmax_usd=${money.maxUsd.toFixed(2)}\ncap_alert=${alert ? 1 : 0}\n`);
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main().catch(error => { console.error(`watch: ${error.message}`); return 1; }));
