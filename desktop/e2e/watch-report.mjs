// node watch-report.mjs <smoke reports dir> <picked.json> <out dir> <states dir> [journey log]: after the watch's live recording and its journey check, the verdict per row against the row's
// last live run (lib/watch-list.mjs), ONE Telegram message only when a flow got worse (none on the first run), this run's state file (<out dir>/watch.json: spend, each row's last measured state)
// and the job log. Never fails the job on a Telegram problem. Guard: e2e/test/watch-cli.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MONTH_CAP_USD, budget, judgeWatch, telegramText} from './lib/watch-list.mjs';
import {verdictWord} from './lib/discovery-judge.mjs';
import {postTelegram} from './lib/telegram-post.mjs';
import {readStates} from './watch-pick.mjs';

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const latestReport = dir => { try { const day = fs.readdirSync(dir).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name)).sort().at(-1); return day ? readJson(path.join(dir, day)) : null; } catch { return null; } };

// journey-run.mjs prints "journey-run: FAIL <row> (...)" for a journey that failed or has no record: those rows' names.
export function failedJourneys(log = '') {
  return new Set(String(log).split('\n').map(line => /^journey-run: FAIL (.+?)(?: \(exit \d+\)|: no record.*)?$/.exec(line)?.[1]).filter(Boolean));
}

export async function main(argv = process.argv.slice(2), env = process.env, send = postTelegram) {
  const [reports = 'reports', pickedFile = 'picked.json', out = 'watch-out', statesDir = 'watch-states', journeyLog = ''] = argv, now = new Date(env.WATCH_NOW || Date.now());
  fs.mkdirSync(out, {recursive: true});
  const picked = readJson(pickedFile) || {rows: []}, report = latestReport(reports) || {}, states = readStates(statesDir);
  const previous = Object.assign({}, ...states.map(state => state.rows || {}));   // oldest first: the newest measured state of each row wins
  const failed = failedJourneys(journeyLog ? (() => { try { return fs.readFileSync(journeyLog, 'utf8'); } catch { return ''; } })() : '');
  const judged = judgeWatch(report, picked.rows, previous, failed), ran = new Set(report.thisRun?.ran || []);
  const usd = Math.round(picked.rows.filter(shape => ran.has(shape)).reduce((sum, shape) => sum + (Number((report.results || {})[shape]?.usd) || 0), 0) * 1000) / 1000;
  const money = budget([...states.map(state => ({at: state.at, usd: state.usd})), {at: now.toISOString(), usd}], now);
  fs.writeFileSync(path.join(out, 'watch.json'), `${JSON.stringify({at: now.toISOString(), usd, rows: judged.rows, capAlertMonth: states.find(state => state.capAlertMonth === money.month)?.capAlertMonth || ''}, null, 1)}\n`);
  const text = telegramText({day: now.toISOString().slice(0, 10), judged, usd, monthSpent: money.spent});
  const lines = [`watch: ${judged.measured.length} measured, ${judged.held.length} held, ${judged.worse.length} worse, $${usd.toFixed(2)} spent (month $${money.spent.toFixed(2)} of $${MONTH_CAP_USD.toFixed(2)})`,
    ...picked.rows.map(shape => `watch: ${shape}: ${judged.held.includes(shape) ? 'held' : `${verdictWord(judged.rows[shape]?.verdict)}${judged.rows[shape]?.journey === 'failed' ? ', journey failed' : ''}`}${judged.worse.find(item => item.shape === shape) ? ` — WORSE: ${judged.worse.find(item => item.shape === shape).why}` : ''}`)];
  console.log(lines.join('\n'));
  try { console.log(`watch: ${await send(text, {env})}`); } catch (error) { console.log(`watch: telegram failed (${String(error?.message || error).slice(0, 80)})`); }
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main());
