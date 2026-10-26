// Replays a live row from its network record (lib/net-record.mjs), the site's own scripts running, memo-only AI.
//   node replay-net.mjs <record dir> <out dir> [--slow] [--no-clock] [--fill-memo]
// --fill-memo (a Mac, by hand; e2e/fill-memo.mjs): the asks the memo lacks (a fix changed what the app asks) are answered by the plan's claude -p and the NEW answers are
// merged into <record dir>/model-memo.json (never the network record); the privacy tripwire and the fake applicant stay on, a tripped run keeps nothing, never on CI.
// The row runs exactly as live (lib/live-row.mjs runLiveRow: the app, Apply, the real extension), but its browser resolves no host (offline) and every
// request is served from the record; the AI answers only from the live run's kept answers, at their live latency; a miss is refused and counted.
// Writes <out>/replay.json (requests by rule, not recorded, misses by step) beside the run's own end.png and step-*.png.
/* global navigator */
import fs from 'node:fs';
import path from 'node:path';
import {runLiveRow} from './lib/live-row.mjs';
import {replayAccounts} from './lib/test-accounts.mjs';
import {startRealExtension} from './lib/real-extension.mjs';
import {netReplay} from './lib/net-record.mjs';
import {forceScrollbar} from './lib/scrollbar.mjs';
import {seedRandom} from './lib/seeded-random.mjs';
import {outputOfLog, parseLive} from './lib/record-sites.mjs';
import {CONTACT} from './lib/apply-fixtures.mjs';
import {wrongValues} from './lib/wrong-values.mjs';
import {ELIGIBILITY_ENV, recordedEligibility} from './lib/pool-eligibility.mjs';
import {shiftDate, zoneOf} from './lib/replay-date.mjs';
import {keepFilled} from './lib/fill-memo.mjs';
import {usage, apiErrors} from './lib/ai-meter.mjs';
import {outOfCredits, creditsLine} from './lib/refill.mjs';
import {slotsLeftOf} from './lib/upload-slots.mjs';
import {watchJourney} from './lib/journey-watch.mjs';

const [recordDir, out] = process.argv.slice(2), SLOW = process.argv.includes('--slow'), NO_CLOCK = process.argv.includes('--no-clock'), FILL = process.argv.includes('--fill-memo'), FAKE_TIMERS = process.argv.includes('--fake-timers'), JOURNEY = process.argv.includes('--journey'), SCROLLBAR = process.argv.includes('--linux-scrollbar'), CPU = Number((process.argv.find(arg => arg.startsWith('--cpu=')) || '').slice(6)) || 0;
if (!recordDir || !out) { console.error('usage: node replay-net.mjs <record dir> <out dir> [--slow] [--no-clock] [--fill-memo]'); process.exit(2); }
if (FILL && process.env.CI && process.env.JP_REFILL_CI !== '1') { console.error('replay-net: --fill-memo asks the plan\'s claude -p: a Mac, or CI only through the refill workflow (lib/refill.mjs)'); process.exit(2); }
const record = JSON.parse(fs.readFileSync(path.join(recordDir, 'record.json'), 'utf8'));
if (zoneOf(record)) process.env.TZ = zoneOf(record);   // the live run's time zone for the whole browser, before it starts (lib/replay-date.mjs)
const bodies = new Map(fs.readdirSync(path.join(recordDir, 'bodies')).map(hash => [hash, fs.readFileSync(path.join(recordDir, 'bodies', hash))]));
fs.mkdirSync(out, {recursive: true});
if (fs.existsSync(path.join(recordDir, 'model-memo.json'))) fs.copyFileSync(path.join(recordDir, 'model-memo.json'), path.join(out, 'model-memo.json')); else fs.writeFileSync(path.join(out, 'model-memo.json'), '{}');   // a live run whose AI was refused kept no answers: every ask is reported missing   // a copy: the live run's kept answers stay as they were
process.env.JOB_PILOTTO_SITE_LEDGER_DIR = path.join(out, 'ledger');   // no site is visited: never a visit in the Mac's ledger
delete process.env.JP_NET_RECORD_DIR;
process.env.JOB_PILOTTO_MODEL_MEMO_MISSLOG = path.join(out, 'misslog.jsonl');   // each miss's whole list of differing parts (the app log cuts it): the gate's "recording out of date" (replay-gate.mjs)
process.env.JOB_PILOTTO_MODEL_MEMO_HITS = path.join(out, 'hits.txt');   // each kept answer the replay used (lib/ai/model-memo.js): test (a), every live ask hits
process.env.JOB_PILOTTO_MODEL_MEMO_LATENCY_CAP_MS ||= '20000';   // the live AI's own time, not capped at 3 s: the replay keeps the live pace (P0b's gap)
const SW_BLOCK = () => { if (navigator.serviceWorker) navigator.serviceWorker.register = async () => {}; };

let replay = null;
const browser = async options => {
  const run = await startRealExtension({...options, offline: true, timezoneId: zoneOf(record)});   // the browser's own zone setting too: TZ alone left the runner's page in UTC (Databricks, 14 Oct 2026)
  await run.context.addInitScript(SW_BLOCK);
  await seedRandom(run.context, record.seed);   // the live run's own seed (a record made before it: the page's own random)
  await run.context.addInitScript({path: path.join(path.dirname(new URL(import.meta.url).pathname), 'lib', 'upload-events.js')});   // a fulfilled upload fires no upload events (lib/upload-events.js)
  // The live browser's scrollbar width (the record's own, else --linux-scrollbar for a record made before it: a CI runner draws 15 px, a Mac none)
  await forceScrollbar(run.context, Number.isFinite(record.scrollbar) ? record.scrollbar : SCROLLBAR ? 15 : undefined);
  // The live run's date with real timers (lib/replay-date.mjs); --fake-timers is the old Playwright clock (it also fakes timers), --no-clock leaves the date alone.
  if (!NO_CLOCK) await (FAKE_TIMERS ? run.context.clock.install({time: record.startMs}) : shiftDate(run.context, record.startMs));
  if (CPU > 1) await (await run.context.newCDPSession(run.page)).send('Emulation.setCPUThrottlingRate', {rate: CPU});   // a CI runner is slower than a Mac: --cpu=4 slows this browser to about its pace
  const pageLog = page => { page.on('pageerror', error => fs.appendFileSync(path.join(out, 'page-errors.txt'), `pageerror ${String(error.message).slice(0, 300)}\n`)); page.on('console', message => { if (['error', 'warning'].includes(message.type())) fs.appendFileSync(path.join(out, 'page-errors.txt'), `${message.type()} ${message.text().slice(0, 300)}\n`); }); };
  run.context.pages().forEach(pageLog); run.context.on('page', pageLog);
  replay = await netReplay(run.context, {entries: record.entries, bodies}, {slow: SLOW, say: line => console.log(`replay: ${line}`)});
  return run;
};
const first = record.entries.find(entry => entry.type === 'document')?.url || record.url;
const liveLog = (() => { try { return fs.readFileSync(path.join(recordDir, 'app.log'), 'utf8'); } catch { return ''; } })();
// The eligibility stop as the live run had it (a pool run turns it off: lib/pool-eligibility.mjs); left on, the kept "not a fit" answer ends the fill early.
if (recordedEligibility(record, liveLog) === 'off') process.env[ELIGIBILITY_ENV] = 'off';
process.env.JP_TEST_ACCOUNTS = JSON.stringify(replayAccounts(record, liveLog));   // a row the live run signed in on signs in again with a FAKE account (lib/test-accounts.mjs replayAccounts); every other row has none; never the Keychain, never a CI secret
// The replay's watch may last as long as the live run did (its app log's first to last line) plus 90 s, 120-300 s: the replay starts ~25-35 s later (the offline app)
// and drifts further behind as it goes (coreweave, 14 Oct 2026: 22 s late at the first page, 43 s at the AI's answers), so a flat 120 s cut it before its form was
// reported. It is a cap, not a length: a row that finished still ends on its quiet window.
export const replaySeconds = text => { const times = String(text).split('\n').map(line => Date.parse(line.slice(0, 24))).filter(Number.isFinite);
  return times.length > 1 ? Math.min(300, Math.max(120, Math.round((times.at(-1) - times[0]) / 1000) + 90)) : 120; };
let seen = null;   // the zone and date the page itself read at the end (replay.json pageSees): proof the live run's zone reached it
let wrong = null;   // the typed values that are not the decided ones, and the decided ones that are not the applicant's (lib/wrong-values.mjs): at the last tab, before the browser closes
const result = await runLiveRow({atEnd: async (tab, replies) => { seen = await tab.evaluate(() => ({zone: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: new Date().getTimezoneOffset()})).catch(() => null); wrong = await wrongValues(tab, replies, CONTACT); }, posting: {url: first, title: '', company: ''}, captureDir: out, ask: false, browser, say: console.log, seconds: replaySeconds(liveLog), fill: FILL, loose: path.join(out, 'loose.jsonl'), watch: JOURNEY ? watchJourney : null});   // loose: a kept answer is served although only the system side or the model changed (cc, 14 Oct 2026: a replay cannot judge a prompt change, its answers are recorded); a user-side change is still a miss
const log = result.appLog || '', misses = log.split('\n').filter(line => /not in the row's kept answers/.test(line));
const live = Object.keys(JSON.parse(fs.readFileSync(path.join(out, 'model-memo.json'), 'utf8'))).filter(key => !key.includes('#'));
const hits = new Set((() => { try { return fs.readFileSync(path.join(out, 'hits.txt'), 'utf8').split('\n').filter(Boolean); } catch { return []; } })());
// The row's outcome, read as a live row is (lib/record-sites.mjs parseLive): the step reached, boxes filled and left; the live run's from the record's own app log.
const outcomeOf = text => { const r = parseLive(outputOfLog(text, text.trim() ? first : '')); return {reached: r.reached, filled: r.filled, left: r.left, slotsLeft: slotsLeftOf(r.fieldList), fields: (r.fieldList || []).slice(0, 40).map(item => ({label: item.label, outcome: item.outcome}))}; };   // fields: the gate's field-by-field diff (lib/replay-field-diff.mjs): labels and outcomes, never a value
const firstMiss = (() => { try { return JSON.parse(fs.readFileSync(path.join(out, 'misslog.jsonl'), 'utf8').split('\n')[0]); } catch { return null; } })();
const filled = FILL && !result.tripped ? keepFilled(recordDir, out) : [];   // a tripped run keeps nothing
const looseLines = (() => { try { return fs.readFileSync(path.join(out, 'loose.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { return []; } })();   // each loose hit with the parts that differ (lib/ai/model-memo.js)
const summary = {looseHits: looseLines.length, looseParts: [...new Set(looseLines.flatMap(hit => hit.differs || []))].slice(0, 8), filled: FILL ? filled.length : undefined, pageSees: seen, firstMiss, outcome: {...outcomeOf(log), wrong: wrong ? wrong.wrong.length : null}, wrongValues: wrong, liveOutcome: liveLog ? outcomeOf(liveLog) : null, liveAsks: live.length, liveHit: live.filter(key => hits.has(key)).length, liveNotAsked: live.filter(key => !hits.has(key)).length, seconds: result.seconds, counts: replay?.counts, misses: misses.length, missLines: misses.map(line => line.slice(24, 200)), tripped: result.tripped};
if (JOURNEY) fs.writeFileSync(path.join(out, 'journey-steps.json'), `${JSON.stringify(result.journey || [], null, 1)}\n`);   // what the card and the panel said, step by step (lib/journey-watch.mjs; judged by journey.mjs)
fs.writeFileSync(path.join(out, 'replay.json'), `${JSON.stringify(summary, null, 1)}\n`);
for (const one of wrong?.wrong || []) console.log(`replay-net: WRONG ${one.layer} ${one.field}: holds "${one.held}", answer "${one.answer}"`);
console.log(`replay-net: done ${JSON.stringify({...summary, missLines: undefined})}`);
// The refill's own spend, from the API's usage figures (lib/ai-meter.mjs): the workflow sums these files into the job log and /admin/intelligence/ai-cost.
if (FILL && process.env.CI) {
  const spent = usage().app, broke = outOfCredits(apiErrors());
  fs.writeFileSync(path.join(out, 'refill-spend.json'), JSON.stringify({usd: spent.usd, calls: spent.calls, input: spent.input, output: spent.output, filled: filled.length, outOfCredits: broke}));
  console.log(`replay-net: refill spent $${spent.usd.toFixed(4)} in ${spent.calls} call(s), ${filled.length} answer(s) filled`);
  if (broke) { console.error(creditsLine); process.exitCode = 3; }
}
