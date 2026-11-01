// node discovery-report.mjs <smoke reports dir> <picked.json> <out dir> <states dir>: after the batch's recording, the verdict per row (lib/discovery-judge.mjs), ONE Telegram message when
// something new failed (Build Log bot; none when nothing did), this run's state file for the next runs (<out dir>/discovery.json: rows, spend, the week the cap alert went), the rows that
// reached a new shape for the pool PR (<out dir>/pool-add.json), and the job log. Never fails the job on a Telegram problem. Guard: e2e/test/discovery-cli.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FAILURES, judgeBatch, poolAdditions, telegramText, verdictWord} from './lib/discovery-judge.mjs';
import {WEEK_CAP_USD, budget} from './lib/discovery-pick.mjs';
import {postTelegram} from './lib/telegram-post.mjs';
import {readStates} from './discovery-pick.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const latestReport = dir => { try { const day = fs.readdirSync(dir).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name)).sort().at(-1); return day ? readJson(path.join(dir, day)) : null; } catch { return null; } };

export async function main(argv = process.argv.slice(2), env = process.env, send = postTelegram) {
  const [reports = 'reports', pickedFile = 'picked.json', out = 'discovery-out', statesDir = 'discovery-states'] = argv, now = new Date(env.DISCOVERY_NOW || Date.now());
  fs.mkdirSync(out, {recursive: true});
  const picked = readJson(pickedFile) || {rows: []}, report = latestReport(reports) || {}, states = readStates(statesDir);
  const judged = judgeBatch(report, picked.rows), ran = new Set(report.thisRun?.ran || []);
  const usd = Math.round((judged.filter(item => ran.has(item.shape)).reduce((sum, item) => sum + (Number((report.results || {})[item.shape]?.usd) || 0), 0)) * 1000) / 1000;
  const money = budget([...states.map(state => ({at: state.at, usd: state.usd})), {at: now.toISOString(), usd}], now);
  const pool = readJson(path.join(here, 'smoke-sites.json'))?.shapes || [];
  const known = new Set([...pool.map(item => item.signature), ...states.flatMap(state => (state.rows || []).map(row => row.signature))].filter(Boolean));
  const additions = poolAdditions(judged, known);
  fs.writeFileSync(path.join(out, 'discovery.json'), `${JSON.stringify({at: now.toISOString(), usd, rows: judged.map(({shape, url, reached, verdict, signature}) => ({shape, url, reached, verdict, signature})),
    capAlertWeek: states.find(state => state.capAlertWeek === money.week)?.capAlertWeek || ''}, null, 1)}\n`);
  fs.writeFileSync(path.join(out, 'pool-add.json'), `${JSON.stringify(additions, null, 1)}\n`);
  const text = telegramText({day: now.toISOString().slice(0, 10), judged, usd, weekSpent: money.spent, weekCap: WEEK_CAP_USD});
  const lines = [`discovery: ${judged.length} row(s) judged, ${judged.filter(item => FAILURES.includes(item.verdict)).length} failed, $${usd.toFixed(2)} spent (week $${money.spent.toFixed(2)} of $${WEEK_CAP_USD.toFixed(2)})`,
    ...judged.map(item => `discovery: ${item.host || item.shape}: ${verdictWord(item.verdict)}${item.detail ? ` (${item.detail})` : ''}`), `discovery: ${additions.length} new shape(s) for the pool`];
  console.log(lines.join('\n'));
  try { console.log(`discovery: ${await send(text, {env})}`); } catch (error) { console.log(`discovery: telegram failed (${String(error?.message || error).slice(0, 80)})`); }
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main());
