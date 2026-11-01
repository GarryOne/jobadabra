// The offline replay's gate (spec docs/superpowers/specs/2026-10-13-replay-by-network.md "Schedule, gate and alerts"; owner, 14 Oct 2026): each row's replay on main
// against the baseline (the last green run: same recordings, same runner), never against live. A row COUNTS only when it was 100% the same as live in the baseline
// ("only count the 100% same as live"); a counted row whose OUTCOME (step reached, boxes filled, boxes left) fell is worse; one whose outcome rose or only its
// asks changed is "different": it passes and says "re-record to confirm". A worse row replayed again (--retry) that matches the baseline is noise.
// Guard: e2e/test/replay/replay-gate.test.mjs. Run: node replay-gate.mjs <step-4 dir> <baseline results.json | -> <out results.json> [--retry <step-4 dir>] [--accepts <accepts.json>]
import fs from 'node:fs';
import path from 'node:path';
import {rank} from './lib/record-sites.mjs';
import {isSame} from './replay-records.mjs';
import {acceptFor, acceptNamed, DASH, HINT} from './replay-accepts.mjs';
import {fieldDiff, evidence} from './lib/replay-field-diff.mjs';
import {load as loadPins, pinned} from './lib/replay-ratchet.mjs';

const json = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

// Why a row's outcome fell from the baseline's, or '' (a missing number on either side never counts as a fall).
export function fell(before, now) {
  if (!before || !now) return '';
  if (rank(now.reached) < rank(before.reached)) return `reached ${now.reached}, baseline ${before.reached}`;
  if (before.filled != null && now.filled != null && now.filled < before.filled) return `filled ${now.filled}, baseline ${before.filled}`;
  if (before.left != null && now.left != null && now.left > before.left) return `left ${now.left}, baseline ${before.left}`;
  if (before.wrong != null && now.wrong != null && now.wrong > before.wrong) return `wrong values ${now.wrong}, baseline ${before.wrong}`;   // a baseline without the count never counts
  return '';
}
const rose = (before, now) => !!(before && now && (rank(now.reached) > rank(before.reached) || (now.filled ?? 0) > (before.filled ?? 0)));

// A recording made before a prompt change (owner via cc, 14 Oct 2026: 997af1f changed the digest's answer format; Swatch, Join, jobup and Deloitte "fell"): the row's
// FIRST miss is the same question about the same page with other instructions, its nearest kept ask differing ONLY in system blocks or the output schema (never the
// model, never a page-side part: a run that already diverged differs there too, Greenhouse). Such a row is "out of date": never red, listed to re-record.
const INSTRUCTION = /^(system(:\d+)?|output|tools)$/;
export const outdated = firstMiss => { const parts = (firstMiss?.differs || []).map(name => String(name).replace(/#\d+$/, '')); return parts.length > 0 && parts.every(name => INSTRUCTION.test(name)); };

// An ask the recording does not have (spec record-once, 15 Oct 2026): a fix changed what the app asks the model, so the replay's ask has no kept answer. The row has extra asks, no site
// request missing, and its first miss differs in a PAGE-SIDE part (what the ask carries: user:*, assistant:*; the output schema alone is "out of date"), never only the instructions (that is "out of date"). Its outcome
// cannot be judged (the model was refused): the row waits for a local replay that fills the memo (npm run fill-memo, desktop/e2e), never "not faithful" or red.
const PAGE_SIDE = /^(user|assistant):/;
export const askChanged = record => !!(record.network && record.network.extra > 0 && !record.network.notRecorded && (record.firstMiss?.differs || []).some(name => PAGE_SIDE.test(String(name).replace(/#\d+$/, '').replace(/ \(lines.*$/, ''))));

// A changed ask whose OUTCOME did not get worse (owner, 17 Oct 2026: "judge outcomes, not wording"; Recruitee 9/7 -> 9/7 and Teamtailor 8/5 -> 8/5 on #1147 were red for the ask's text alone): the pin
// means "the outcome is the live run's", so a row whose ask (or instructions) changed is judged by what it did: the step reached no earlier, no fewer filled, no more left, no more wrong values than live,
// and no site request missing. Equal or better = "same (ask changed: N lines)", a note, never red. No live outcome or no replay outcome to compare = not judged (stays red). Safety checks are untouched.
export const changedLines = differs => (differs || []).reduce((sum, name) => sum + (Number(/\(lines (\d+)/.exec(String(name))?.[1]) || 1), 0);
export const keptOutcome = record => !!(record.outcome && record.liveOutcome && record.network && !record.network.notRecorded && !fell(record.liveOutcome, record.outcome));

export const STREAK = 2;   // runs in a row a row must be 100% same as live before it counts

// (this run's records, the baseline's results, a retry's records) -> {rows: {name: {same, outcome, counted, verdict, why}}, counted, worse, red}
// pins (replay-faithful.json, lib/replay-ratchet.mjs): the pinned names. Given, the file IS the baseline (owner, 15 Oct 2026): every pinned row must be same as live, whatever else
// its verdict was (ask changed, different, out of date, not replayed): red, unless the owner's Replay-accept names that row; a row same and not pinned is "newly same" (ratchet up).
export const FLAKY_AT = 3, FLAKY_DAYS = 7;   // a pinned row that passed only on its retry this many times in this many days is flagged (owner via cc, 15 Oct 2026)
export function judge(records, baseline = {}, retry = [], accepts = {}, pins = null, picked = null, now = new Date()) {
  const pinSet = pins ? new Set(pins) : null, names = records.map(record => record.name), again = new Map(retry.map(record => [record.name, record])), rows = {};
  for (const record of records) {
    // Counted (14 Oct 2026, a red gate on Databricks: 8/8 then 1/8 on the same code): never a deferred row, and only a row 100% same as live in the baseline AND
    // the run before it (streak >= 2); a baseline from before the streak was kept counts as 1.
    const before = baseline.rows?.[record.name], same = isSame(record), outcome = record.outcome || null, beforeStreak = before ? before.streak ?? (before.same ? 1 : 0) : 0;
    let counted = !record.deferred && before?.same === true && beforeStreak >= STREAK; const streak = same ? beforeStreak + 1 : 0;
    let verdict = counted ? 'same' : 'not counted', why = counted ? '' : record.deferred ? `deferred: ${record.deferred}` : before?.same ? `same as live ${beforeStreak} run(s) before, needs ${STREAK}` : before ? 'replay not faithful in the baseline' : 'no baseline yet';
    if (outdated(record.firstMiss)) { verdict = 'out of date'; why = `re-record: the prompt changed (the first miss differs only in ${record.firstMiss.differs.join(', ')})`; }
    else if (askChanged(record)) { verdict = 'ask changed'; why = `needs a local replay: the ask changed (differs in ${record.firstMiss.differs.slice(0, 3).join(', ')}); on the Mac: npm run fill-memo -- <records dir> "${record.name}"`; }
    else if (counted && !record.network) { verdict = 'worse'; why = 'no replay result'; }
    else if (counted) {
      const down = fell(before.outcome, outcome);
      if (down) {
        const second = again.get(record.name), retried = second && fell(before.outcome, second.outcome);
        if (second && !retried) { verdict = 'noise'; why = `${down}; the retry matched the baseline`; } else { verdict = 'worse'; why = down; }
        const accept = verdict === 'worse' && acceptFor(record.name, accepts.entries, names);   // the owner's label + reason on a merged PR (replay-accepts.mjs)
        if (accept?.reason) { verdict = 'accepted'; why = `${down}; PR #${accept.pr}${accept.url ? ` (${accept.url})` : ''}: ${accept.reason}`; } else if (accept) why = `${down}; add the reason: comment "Replay-accept: <reason>" on PR #${accept.pr}`;
      } else if (!same) { verdict = 'different'; why = `${rose(before.outcome, outcome) ? 'further than the baseline' : 'other asks, same outcome'}: re-record to confirm`; }
    }
    let stale = verdict === 'ask changed' || verdict === 'out of date', askNote = '';   // its stored answers no longer match what the app asks: the refill workflow's job (lib/refill.mjs)
    if (pinSet) {   // the ratchet: the pinned file decides what counts
      const held = pinSet.has(record.name) && !record.deferred;
      counted = held;
      if (!held) { if (same && !record.deferred) { verdict = 'newly same'; why = 'ratchet up: pin it with node lib/replay-ratchet.mjs pin <results.json>'; } else if (verdict === 'same') verdict = 'not counted'; }
      else if (same) { verdict = 'same'; why = ''; }
      else if (stale && keptOutcome(record)) {   // the ask changed, the outcome did not get worse: nothing to refill, nothing to accept
        const lines = changedLines(record.firstMiss?.differs);
        verdict = 'same'; why = ''; stale = false; askNote = `ask changed: ${lines} line${lines === 1 ? '' : 's'}`;
      } else {
        const second = again.get(record.name), noise = second && isSame(second), was = verdict === 'not counted' ? 'not same as live' : verdict, reason = `pinned same as live, now ${was}${why ? `: ${why.replace(/^[a-z ]*: /, '')}` : ''}`;
        const accept = noise ? null : acceptNamed(record.name, accepts.entries, names);
        if (noise) { verdict = 'noise'; why = `${reason}; passed on retry`; }
        else if (accept?.reason) { verdict = 'accepted'; why = `${reason}; PR #${accept.pr}${accept.url ? ` (${accept.url})` : ''}: ${accept.reason}`; }
        else { verdict = 'worse'; why = reason; }
      }
    }
    // How often this row needed its retry lately (carried from the baseline run's results, a week back): a row that is "noise" 3 times a week is flagged, not left pinned on luck.
    const noiseAt = [...(before?.noiseAt || []).filter(at => now - Date.parse(at) < FLAKY_DAYS * 864e5), ...(pinSet && verdict === 'noise' ? [now.toISOString()] : [])];
    const asks = record.network ? {hit: record.network.hit ?? 0, of: record.live?.asks ?? null, extra: record.network.extra ?? 0} : null;   // the summary's table
    rows[record.name] = {refill: stale, loose: record.network?.loose || 0, looseParts: record.network?.looseParts || [], same, streak, outcome, liveOutcome: record.liveOutcome || null, asks, counted, verdict, why, ...(askNote ? {askNote} : {}), seconds: record.seconds ?? null, site: record.site || '', formHost: record.formHost || '', ...(noiseAt.length ? {noiseAt} : {}), wrongValues: record.wrongValues || [], ...(verdict === 'worse' || verdict === 'accepted' ? {baseOutcome: before?.outcome || null, diff: fieldDiff(before?.outcome, outcome)} : {})};   // seconds, site: the PR gate's pick (replay-pick.mjs)
  }
  // A PR replays one pinned row per kind (replay-pick.mjs): a pinned row it did not pick is not judged there ("not replayed on PRs"), never worse; the scheduled run (no picked list) still needs every one.
  if (pinSet && picked) for (const name of pinSet) if (!rows[name] && !picked.has(name)) rows[name] = {loose: 0, looseParts: [], same: false, streak: 0, outcome: null, liveOutcome: null, asks: null, counted: false, verdict: 'not counted', why: 'not replayed on PRs (the scheduled runs check it)', seconds: null, site: '', wrongValues: []};
  if (pinSet) for (const name of pinSet) if (!rows[name]) rows[name] = {loose: 0, looseParts: [], same: false, streak: 0, outcome: null, liveOutcome: null, asks: null, counted: true, verdict: 'worse', why: 'pinned same as live, but this run did not replay it (no result)', seconds: null, site: '', wrongValues: []};
  const list = Object.values(rows), accepted = list.filter(row => row.verdict === 'accepted').length, worse = list.filter(row => row.verdict === 'worse').length;
  return {rows, counted: list.filter(row => row.counted).length, total: list.length, worse, accepted, red: worse > 0, flaky: list.filter(row => (row.noiseAt || []).length >= FLAKY_AT).length, ...(pinSet ? {pinned: pinSet.size, sameCount: list.filter(row => row.same).length, newlySame: list.filter(row => row.verdict === 'newly same').length} : {})};
}

// The run's Markdown: one line "N of M rows counted · K worse", then EVERY row (owner, 14 Oct 2026: one table instead of a job per row): the worst first,
// its asks answered of the live run's, its outcome beside the live one, its verdict and why.
const MARK = {worse: '❌', 'newly same': '🆙', 'ask changed': '🖥', 'out of date': '🔁', accepted: '🆗', noise: '🟡', different: '🔵', 'not counted': '⏸', same: '✅'}, ORDER = Object.keys(MARK);
const shortOutcome = item => (item ? `${item.reached || '?'}${item.filled != null ? ` ${item.filled}/${item.left ?? '?'}` : ''}` : '–');
const asked = row => (row.asks ? `${row.asks.hit}/${row.asks.of ?? '?'}${row.asks.extra ? ` +${row.asks.extra}` : ''}` : '–');
// The next step for a pinned row whose stored answers are stale and whose outcome fell (owner via cc, 15 Oct 2026; 17 Oct 2026: the PR gate starts it by itself, from main, under a cap): the CI refill (replay-refill.yml).
export const refillLine = pr => `gh workflow run replay-refill.yml -f pr=${pr || '<n>'}  (the PR gate starts it by itself, at most $0.50 a run and $5 a month; by hand if a cap stopped it)`;
export function summary(result, {pr = process.env.PR} = {}) {
  const head = result.pinned != null ? `${result.sameCount} of ${result.total} same as live (pinned ${result.pinned})` : `${result.counted} of ${result.total} rows counted`;
  const lines = [`## Replay gate: ${head} · ${result.worse} worse${result.accepted ? ` · ${result.accepted} accepted` : ''}${result.newlySame ? ` · ${result.newlySame} newly same: ratchet up` : ''}`, ''];
  const shown = Object.entries(result.rows).sort(([a, x], [b, y]) => ORDER.indexOf(x.verdict) - ORDER.indexOf(y.verdict) || a.localeCompare(b));
  if (shown.length) {
    lines.push('Asks: answered from the record / asked live (+ extra the live run never asked). Outcome: step, filled/left.', '',
      '| # | Row | Asks | Outcome | Live | Verdict | Why |', '|---|---|---|---|---|---|---|',
      ...shown.map(([name, row], at) => `| ${at + 1} | ${name} | ${asked(row)} | ${shortOutcome(row.outcome)} | ${shortOutcome(row.liveOutcome)} | ${MARK[row.verdict] || ''} ${row.verdict === 'noise' ? 'noise (passed on retry)' : row.askNote ? `${row.verdict} (${row.askNote})` : row.verdict} | ${row.why || '–'} |`));
  }
  const noted = Object.entries(result.rows).filter(([, row]) => row.askNote);
  if (noted.length) lines.push('', `### ✅ ${noted.length} row${noted.length === 1 ? '' : 's'} with a changed ask, outcome not worse than live (no refill needed)`, '', ...noted.map(([name, row]) => `- ${name}: ${shortOutcome(row.outcome)} vs live ${shortOutcome(row.liveOutcome)} (${row.askNote})`));
  const stale = Object.entries(result.rows).filter(([, row]) => row.refill).map(([name]) => name);
  if (stale.length) lines.push('', `### 🖥 ${stale.length} row${stale.length === 1 ? '' : 's'} need their answers refilled (${stale.join(', ')})`, '', `Next step: \`${refillLine(pr)}\``);
  // Kept answers served although the system side changed (cc, 14 Oct 2026): the replay cannot judge a prompt change, so it still hits; the line says which rows and which parts.
  const looseRows = Object.entries(result.rows).filter(([, row]) => row.loose > 0);
  if (looseRows.length) lines.push('', `### Answered although the system side changed: ${looseRows.length} row${looseRows.length === 1 ? '' : 's'}`, '', '| Row | Loose hits | Parts that differ |', '|---|---|---|', ...looseRows.map(([name, row]) => `| ${name} | ${row.loose} | ${row.looseParts.join(', ') || '–'} |`));
  // A pinned row that passed only on its retry FLAKY_AT times in FLAKY_DAYS days (the scheduled runs carry the dates): named, so nobody leaves it pinned on luck.
  const flaky = Object.entries(result.rows).filter(([, row]) => (row.noiseAt || []).length >= FLAKY_AT);
  if (flaky.length) lines.push('', `### 🟡 Flaky: passed only on a retry ${FLAKY_AT}+ times in ${FLAKY_DAYS} days (${flaky.length})`, '', ...flaky.map(([name, row]) => `- ${name}: ${row.noiseAt.length} times (${row.noiseAt.map(at => at.slice(5, 10)).join(', ')}): take a look: a page that renders differently now and then, or a row that should not stay pinned`));
  // Every wrong field of every row, every run (not only a rise): a value wrong since the baseline stays visible. Fake data: the applicant's.
  const wrong = Object.entries(result.rows).flatMap(([name, row]) => (row.wrongValues || []).map(one => `| ${name} | ${one.field} | ${one.answer} | ${one.held} | ${one.layer} |`));
  if (wrong.length) lines.push('', `### Wrong values (${wrong.length})`, '', '| Row | Field | Expected | Typed | Check |', '|---|---|---|---|---|', ...wrong);
  // The evidence the owner reads before accepting (owner, 14 Oct 2026): each worse row's field-by-field diff against the baseline, with the accept line to copy.
  const bad = Object.entries(result.rows).filter(([, row]) => row.verdict === 'worse');
  if (bad.length) lines.push('', `### What changed in the ${bad.length} worse row${bad.length === 1 ? '' : 's'}`, '', ...bad.flatMap(([name, row]) => [...evidence(name, row, row.diff, row.baseOutcome), '']));
  if (result.worse) lines.push(`> ${HINT}. The gate then re-judges by itself (no replay re-run).${result.pinned != null ? ` A pinned row needs its own name in the line (\`Replay-accept: <row name>${DASH}<reason>\`): a bare reason accepts none.` : ''}`);
  return `${lines.join('\n')}\n`;
}

const recordsIn = dir => (dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter(file => file.endsWith('.json')).map(file => json(path.join(dir, file), null)).filter(Boolean) : []);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [dir, base, out] = process.argv.slice(2), at = process.argv.indexOf('--retry'), retryDir = at > 0 ? process.argv[at + 1] : '', ac = process.argv.indexOf('--accepts'), accepts = ac > 0 ? json(process.argv[ac + 1], {}) : {};
  if (!dir || !base || !out) { console.error('usage: node replay-gate.mjs <step-4 dir> <baseline results.json | -> <out results.json> [--retry <step-4 dir>] [--accepts <accepts.json>] [--pinned <replay-faithful.json> [--base-pinned <the base branch copy>] [--picked <names file>]]'); process.exit(2); }
  const force = list => list.map(record => (record.name === process.env.REPLAY_TEST_WORSE && process.env.GITHUB_REF_NAME !== 'main' && record.outcome   // a test-only fall (the end-to-end proof of an accept), also on the retry: never on main
    ? {...record, outcome: {...record.outcome, filled: Math.max(0, (record.outcome.filled ?? 1) - 1)}} : record));
  // --pinned: the ratchet is the baseline (lib/replay-ratchet.mjs); --base-pinned (the PR's base branch copy) keeps a row the PR unpinned held, until a Replay-accept names it.
  const flag = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : ''; };
  const pins = flag('--pinned') ? [...new Set([...pinned(loadPins(flag('--pinned'))), ...(flag('--base-pinned') ? pinned(loadPins(flag('--base-pinned'))) : [])])] : null;
  const picked = flag('--picked') ? new Set(fs.readFileSync(flag('--picked'), 'utf8').split('\n').map(line => line.trim()).filter(Boolean)) : null;   // a PR: the rows its pick replayed
  const result = judge(force(recordsIn(dir)), base === '-' ? {} : json(base, {}), force(recordsIn(retryDir)), accepts, pins, picked);
  fs.writeFileSync(out, `${JSON.stringify({at: new Date().toISOString(), sha: process.env.GITHUB_SHA || '', ...result}, null, 1)}\n`);
  if (!retryDir) fs.writeFileSync(`${out}.worse`, Object.entries(result.rows).filter(([, row]) => row.verdict === 'worse').map(([name]) => name).join('\n'));
  process.stdout.write(summary(result));
  process.exit(result.red ? 1 : 0);
}
