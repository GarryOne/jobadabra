// lib/live-still.mjs: a live run ends 20 s after the page last changed (limit unchanged), never early on a slow page, and apply-live.mjs uses it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {STILL_SECONDS, hardCapMs, pageLines, signature, stillClock, stillSeconds} from '../../lib/live-still.mjs';

// The run's loop in miniature: one reading a second, `at` seconds after the start; -> the second the run ends (or the limit).
const watch = (readingAt, {limit = 90, seconds = STILL_SECONDS, opened = () => true} = {}) => {
  const clock = stillClock({seconds, startedAt: 0});
  for (let at = 0; at <= limit; at++) {
    clock.see(readingAt(at), at * 1000);
    if (clock.over(at * 1000, {opened: opened(at)})) return at;
  }
  return limit;
};

test('the default is 20 s, LIVE_STILL_SECONDS changes it, 0 turns it off', () => {
  assert.equal(stillSeconds({}), 20);
  assert.equal(stillSeconds({LIVE_STILL_SECONDS: '30'}), 30);
  assert.equal(stillSeconds({LIVE_STILL_SECONDS: '0'}), 0);
  assert.equal(stillSeconds({LIVE_STILL_SECONDS: 'x'}), 0, 'a value that is not a number is off, said by the log, never a silent default');
});

test('a page that loaded at 10 s and then stays still ends 20 s after its last change', () => {
  assert.equal(watch(at => signature({shape: at < 10 ? 'blank' : 'form:6'})), 30);
});

test('a LATE form (drawn after a spinner, at 35 s) is not cut off: the wait before it changes nothing, but every change moves the clock', () => {
  // 0-15 s: the posting; 15 s: the Apply tab opens on a spinner; 35 s: the spinner is replaced by the form (the LATE fixture's shape); the fill goes on until 50 s.
  const reading = at => signature({states: at < 15 ? ['posting'] : ['posting', 'tab'], shape: at < 15 ? 'posting' : at < 35 ? 'spinner' : 'form:9', logLines: at < 50 ? Math.floor(at / 2) : 25});
  assert.equal(watch(reading), 70, 'ended 20 s after the LAST change (the fill at 49 s), not at 20 s or 35 s');
  assert.ok(watch(reading) > 35, 'never before the late form appeared');
});

test('a quiet page that never changes ends at 20 s once the posting is open; before it is open the run goes on to its limit', () => {
  assert.equal(watch(() => signature({shape: 'posting'})), 20);
  assert.equal(watch(() => signature({shape: 'blank'}), {opened: () => false}), 90, 'Apply never opened: the limit and its own error decide');
});

test('the limit still holds, and off means off', () => {
  assert.equal(watch(at => signature({logLines: at}), {limit: 90}), 90, 'a page that keeps changing runs to the limit');
  assert.equal(watch(() => signature({}), {seconds: 0}), 90);
});

test('apply-live.mjs ends the watch by this clock and says why', () => {
  const source = fs.readFileSync(new URL('../../lib/apply-live.mjs', import.meta.url), 'utf8');
  assert.match(source, /stillClock\(/);
  assert.match(source, /clock\.over\(Date\.now\(\)/);
  assert.match(source, /watched \$\{Math\.round\(\(Date\.now\(\) - started\) \/ 1000\)\}s; frames in/, 'the end-of-watch line keeps the shape runFinished reads');
});

// The app's own heartbeat (every 15 s: [run] start/end of `cron_runs list`, [store] cron_runs.list) is not a change of the page (a Datadog run on 11 Oct 2026 watched 91 s
// for nothing: 3 such lines each 15 s kept moving the clock). Only the lines about the page and the fill count.
test('the app\'s heartbeat lines do not move the clock; the extension\'s lines do', () => {
  const heartbeat = ['2026-10-11T02:25:26Z [run] start: python -m src.stores call cron_runs list {"run_id":"a"}', '2026-10-11T02:25:26Z [run] end: python -m src.stores call cron_runs list -> exit 0 in 0s', '2026-10-11T02:25:26Z [store] cron_runs.list {"exit":0}'];
  const page = ['2026-10-11T02:25:28Z [review] form 5647cb43: 7/16 left', '2026-10-11T02:25:29Z [extension] fill: watch ended', '2026-10-11T02:25:30Z [page-kind] form'];
  assert.equal(pageLines([...heartbeat, ...page, ...heartbeat]), 3);
  assert.equal(pageLines(heartbeat), 0);
  // a quiet page whose only news is the heartbeat ends 20 s after its last real line
  const reading = at => signature({shape: 'form', logLines: pageLines([...(at >= 5 ? page : []), ...Array(Math.floor(at / 15) * 3).fill(heartbeat[0])])});
  assert.equal(watch(reading), 25);
});
test('apply-live.mjs feeds the clock only the page lines', () => {
  assert.match(fs.readFileSync(new URL('../../lib/apply-live.mjs', import.meta.url), 'utf8'), /logLines: pageLines\(all\)/);
});

test('the quiet window is 45 s on the Claude Code engine (its asks take 5-12 s), 20 s on the API engine; the env wins', () => {
  assert.equal(stillSeconds({}, 'cli'), 45);
  assert.equal(stillSeconds({}, 'api'), 20);
  assert.equal(stillSeconds({LIVE_STILL_SECONDS: '30'}, 'cli'), 30);
});

// 12 Oct 2026, FNAC: the run ended at 31 s with "Reading this page…" still on screen. While the extension's own step line is up the quiet window never ends the run; the limit is the cap and says so.
test('a still page does not end the run while the extension is still deciding, and does once it is not', () => {
  const clock = stillClock({seconds: 20, startedAt: 0});
  clock.see('same', 0);
  assert.equal(clock.over(60000, {opened: true, deciding: true}), false, 'ended on a quiet window while the step line was up');
  assert.equal(clock.over(60000, {opened: true, deciding: false}), true);
});

test('the deciding signal: the panel button busy or the floating step box, nothing else', async () => {
  const {chromium} = await import('playwright-core');
  const {isDeciding} = await import('../../lib/deciding.mjs');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const shadow = busy => page.setContent(`<body><div id="jobadabra-review-host"></div><script>document.getElementById('jobadabra-review-host').attachShadow({mode:'open'}).innerHTML='<button class="fill" ${busy ? 'aria-busy="true"' : ''}></button>'</script></body>`);
    await shadow(true); assert.equal(await isDeciding(page), true, 'panel busy');
    await shadow(false); assert.equal(await isDeciding(page), false, 'panel idle');
    await page.setContent('<body><div id="jobadabra-progress">Reading this page…</div></body>'); assert.equal(await isDeciding(page), true, 'floating step box');
    await page.setContent('<body>plain</body>'); assert.equal(await isDeciding(page), false);
  } finally { await browser.close(); }
});

test('live-row waits for the decision (the limit is the cap), uses the cli window, and live.mjs says "ended while deciding" as an error', () => {
  const row = fs.readFileSync(new URL('../../lib/live-row.mjs', import.meta.url), 'utf8'), cli = fs.readFileSync(new URL('../../live.mjs', import.meta.url), 'utf8');
  assert.match(row, /isDeciding\(/);
  assert.match(row, /clock\.over\(Date\.now\(\), \{opened: true, deciding, quiet: quietSeconds\(stillSeconds, logText, process\.env, \{now: open, atEnd: tabsAtEnd\}\)\}\)/);
  assert.match(row, /stillSecondsFor\(process\.env, 'cli'\)/);
  assert.match(cli, /ended while deciding[\s\S]*process\.exit\(1\)/);
});

// 14 Oct 2026: ~45 of a replayed row's ~93 s was the quiet window after the extension's last line. Once it says "run ended" (extension/ladder/progress.js) the window is AFTER_END_SECONDS.
test('after the extension says its run ended, the quiet window shrinks; a progress note after it brings the full window back', async () => {
  const {AFTER_END_SECONDS, quietSeconds, runEnded} = await import('../../lib/live-still.mjs');
  const ended = '[extension] fill: progress: navigated {}\n[extension] fill: run ended {}\n[extension] fill verify (shadow) {}';
  assert.equal(runEnded(ended), true);
  assert.equal(runEnded(`${ended}\n[extension] fill: progress: navigated {}`), false, 'the run went on: a new page');
  assert.equal(runEnded('[extension] fill: progress: navigated {}'), false);
  // 14 Oct 2026, arbeitnow board -> employer: the board tab ended, its press opened the employer page, and the row was cut to 46 s.
  for (const moved of ['[extension] panel: mark carried to the next page {"host":"apply.workable.com"}', '[extension] panel: panel on a tab the app opened {"host":"apply.workable.com"}',
    '[extension] page kind: posting {"shape":"apply.workable.com/x/*|0"}', '[extension] fill: page kind: posting {"host":"apply.workable.com"}']) {
    assert.equal(runEnded(`${ended}\n${moved}`), false, `the application moved on: ${moved.slice(12, 40)}`);
    assert.equal(quietSeconds(45, `${ended}\n${moved}`, {}), 45, 'the full window again');
  }
  assert.equal(runEnded(`${ended}\n[extension] account judgment form: needs_person {}`), true, 'a shadow check after the end keeps the short window');
  // A tab opened after the end gives the full window back even before its page writes a line (the employer page was still "Reading this page…").
  assert.equal(quietSeconds(45, ended, {}, {now: 2, atEnd: 1}), 45, 'a new tab after the end');
  assert.equal(quietSeconds(45, ended, {}, {now: 1, atEnd: 1}), AFTER_END_SECONDS, 'the same tabs: the short window');
  assert.equal(quietSeconds(45, ended, {}, {now: 2, atEnd: null}), AFTER_END_SECONDS, 'no end tab count yet: the log decides');
  assert.equal(quietSeconds(45, ended, {}), AFTER_END_SECONDS);
  assert.equal(quietSeconds(45, 'nothing ended', {}), 45);
  assert.equal(quietSeconds(10, ended, {}), 10, 'never longer than the window asked for');
  assert.equal(quietSeconds(0, ended, {}), 0, 'LIVE_STILL_SECONDS=0 still watches to the limit');
  assert.equal(quietSeconds(45, ended, {LIVE_AFTER_END_SECONDS: '30'}), 30);
  const clock = stillClock({seconds: 45, startedAt: 0});
  clock.see('a', 0);
  assert.equal(clock.over(25000, {opened: true}), false);
  assert.equal(clock.over(25000, {opened: true, quiet: AFTER_END_SECONDS}), true);
  assert.equal(clock.over(25000, {opened: true, deciding: true, quiet: AFTER_END_SECONDS}), false, 'still deciding: never ends');
  assert.ok(AFTER_END_SECONDS >= 20, 'a shadow check\'s AI ask after the end: a replay keeps the live AI\'s time, capped at 20 s (replay-net.mjs)');
});

test('every still-clock watch (live row, live e2e, row replay) uses the shorter window after the run ended', () => {
  for (const file of ['live-row.mjs', 'apply-live.mjs', 'row-replay.mjs']) {
    const source = fs.readFileSync(new URL(`../../lib/${file}`, import.meta.url), 'utf8');
    if (/stillClock\(/.test(source)) assert.match(source, /quietSeconds\(/, `${file} watches with stillClock but ignores the run's end`);
  }
});

// 15 Oct 2026: a recording ended at 90 s while the extension was still on a step (plan-path asks ~28 s each). While it decides the run goes on, up to a hard cap.
test('the hard cap is twice the limit while the extension is deciding, settable, never below the limit', () => {
  assert.equal(hardCapMs(90, {}), 180000);
  assert.equal(hardCapMs(90, {LIVE_HARD_SECONDS: '240'}), 240000);
  assert.equal(hardCapMs(90, {LIVE_HARD_SECONDS: '10'}), 90000, 'never below the limit');
  assert.equal(hardCapMs(90, {LIVE_HARD_SECONDS: '0'}), 90000, '0 = no extra time');
  const source = fs.readFileSync(new URL('../../lib/live-row.mjs', import.meta.url), 'utf8');
  assert.match(source, /ended by cap while the extension was still deciding/);
  assert.match(source, /age >= hardMs \|\| \(age >= seconds \* 1000 && !deciding\)/);
});
