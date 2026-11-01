// node discovery-pick.mjs <out dir> <states dir>: the daily discovery batch's first job (.github/workflows/record-sites.yml, schedule). Reads the site's input
// (GET /applying/discovery-input, Bearer REPLAYS_PUBLISH_KEY), the pool and the earlier batch runs' own state files (<states dir>/<run>/discovery.json: their rows and spend),
// runs the picker (lib/discovery-pick.mjs) and writes <out dir>/discovery-rows.json (rows in the pool's format, read by the recorder as RECORD_SITES) and picked.json.
// Prints what it picked and why; sets count/only/max_usd for the next job through GITHUB_OUTPUT; when the week's cap stops the batch, writes cap-alert.txt once a week.
// A site that cannot be read is a red job (a batch that silently picks nothing is the failure to avoid). Guard: e2e/test/discovery-cli.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MAX_ROWS, ROW_USD, WEEK_CAP_USD, pickBatch} from './lib/discovery-pick.mjs';
import {postTelegram} from './lib/telegram-post.mjs';
import {FAILURES, capText} from './lib/discovery-judge.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const INPUT_URL = 'https://www.jobpilotto.top/applying/discovery-input';
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// <states dir>/<run id>/discovery.json: {at, usd, rows: [{shape, url, reached}], capAlertWeek?}
export function readStates(dir) {
  try { return fs.readdirSync(dir).map(name => readJson(path.join(dir, name, 'discovery.json'))).filter(Boolean); } catch { return []; }
}

export async function fetchInput({env = process.env, fetcher = fetch} = {}) {
  if (!env.REPLAYS_PUBLISH_KEY) throw new Error('REPLAYS_PUBLISH_KEY is not set');
  const answer = await fetcher(INPUT_URL, {headers: {Authorization: `Bearer ${env.REPLAYS_PUBLISH_KEY}`}, signal: AbortSignal.timeout(30000)});
  if (!answer.ok) throw new Error(`the site answered ${answer.status}`);
  return answer.json();
}

export async function main(argv = process.argv.slice(2), env = process.env, send = postTelegram) {
  const [out = 'discovery-out', statesDir = 'discovery-states'] = argv, now = new Date(env.DISCOVERY_NOW || Date.now());
  fs.mkdirSync(out, {recursive: true});
  const states = readStates(statesDir), pool = readJson(path.join(here, 'smoke-sites.json'))?.shapes || [];
  const result = pickBatch({input: await fetchInput({env}), pool, seen: states.flatMap(state => state.rows || []), spends: states.map(state => ({at: state.at, usd: state.usd})), now, max: MAX_ROWS, weekCap: WEEK_CAP_USD});
  const week = result.budget.week, alerted = states.some(state => state.capAlertWeek === week);
  // The recorder's pool upload replaces the whole list: yesterday's failing batch rows ride along (not run: --only names today's) so they stay on the lab page until the pool PR adds them.
  const carried = states.flatMap(state => state.rows || []).filter(row => FAILURES.includes(row.verdict) && row.url && !pool.some(item => item.shape === row.shape) && !result.rows.some(item => item.shape === row.shape));
  const shapes = [...result.rows.map(({shape, urls}) => ({shape, urls})), ...[...new Map(carried.map(row => [row.shape, {shape: row.shape, urls: [row.url]}])).values()]];
  fs.writeFileSync(path.join(out, 'discovery-rows.json'), `${JSON.stringify({shapes}, null, 1)}\n`);
  fs.writeFileSync(path.join(out, 'picked.json'), `${JSON.stringify({...result, day: now.toISOString().slice(0, 10)}, null, 1)}\n`);
  const alert = result.capped && !alerted;
  if (alert) {   // told once a week: this state file (uploaded by the workflow) is how the next runs know
    const text = capText({week, spent: result.budget.spent, cap: WEEK_CAP_USD});
    fs.mkdirSync(path.join(out, 'alert-state'), {recursive: true});
    fs.writeFileSync(path.join(out, 'alert-state', 'discovery.json'), `${JSON.stringify({at: now.toISOString(), usd: 0, rows: [], capAlertWeek: week})}\n`);
    console.log(`discovery: ${await send(text, {env}).catch(error => `telegram failed (${String(error?.message || error).slice(0, 80)})`)}`);
  }
  const lines = [`discovery: week ${week}: spent $${result.budget.spent} of $${WEEK_CAP_USD}, room for ${result.budget.rows} row(s)`,
    ...result.rows.map(row => `discovery: pick [${row.source}] ${row.shape}: ${row.why}`), ...result.skipped.map(item => `discovery: skipped [${item.source}] ${item.why}`),
    result.rows.length ? `discovery: ${result.rows.length} row(s) to record` : 'discovery: no new candidate: nothing is recorded today'];
  console.log(lines.join('\n'));
  if (env.GITHUB_OUTPUT) {
    const maxUsd = Math.min(result.budget.remaining, Math.max(ROW_USD * result.rows.length * 2, 0.2)).toFixed(2);   // twice the expected spend, never above what the week has left
    fs.appendFileSync(env.GITHUB_OUTPUT, `count=${result.rows.length}\nonly=${result.rows.map(row => row.shape).join('|')}\nmax_usd=${maxUsd}\ncap_alert=${alert ? 1 : 0}\n`);
  }
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main().catch(error => { console.error(`discovery: ${error.message}`); return 1; }));
