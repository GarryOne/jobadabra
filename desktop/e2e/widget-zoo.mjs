#!/usr/bin/env node
// `npm run widget-zoo`: replays every widget-zoo page (e2e/widget-zoo/) with the real extension, offline, and prints per page whether the fill READ the question and whether the value
// stayed COMMITTED, then the totals per widget. A measure: a miss never fails the run (exit 1 only when the replay itself broke, or a page pressed a submit). --json <file> writes the
// verdicts; REPLAY_ONLY=<part of a name> runs those pages. --model (a Mac, plan path, $0, never an API key): the fill check (spec 2026-10-12-fill-ladder, PR 3's shadow) is answered by the real model and its
// verdicts are printed per page: the zoo pass of the short shadow mode. Lib: lib/widget-zoo.mjs. CI: .github/workflows/control-tests.yml (not a required check).
import fs from 'node:fs';
import {replayInTabs} from './lib/replay-browser.mjs';
import {harnessLine, loadZoo, summarizeZoo, verdictOf} from './lib/widget-zoo.mjs';

const args = process.argv.slice(2), jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : '';
const cases = loadZoo().filter(one => one.name.includes(process.env.REPLAY_ONLY || ''));
const shadow = new Map();   // page host -> the model's verdicts on the fill check (--model)
// A harness that cannot start (a module the app needs is missing: desktop/shared not staged) or replays nothing is said first and fails the run, never shown as zoo findings.
let results = [], startError = '';
try {
  if (args.includes('--model')) { const {modelRoute} = await import('./lib/widget-zoo-model.mjs'); for (const item of cases) item.ai['/extension/account-judge'] = await modelRoute(shadow); }
  results = await replayInTabs(cases, {tabs: Math.max(1, Number(process.env.JP_REPLAY_TABS || 3)), extensionDir: process.env.REAL_EXTENSION_DIR || undefined});
} catch (error) { startError = error?.message || String(error); }
const verdicts = results.length ? cases.map((item, index) => verdictOf(item, results[index])) : [];
const notRun = harnessLine(verdicts, cases.length, startError);
if (notRun) {
  console.log(notRun);
  process.exit(1);
}
const summary = summarizeZoo(verdicts);

const pad = (text, width) => String(text).padEnd(width).slice(0, width);
const lines = [];
const say = line => { lines.push(line); console.log(line); };
say(`control tests: ${summary.total} pages, read ${summary.read}, committed ${summary.committed}, truthful ${summary.truthful}`);   // truthful: the fill's record, the panel and the judge say what the page holds
for (const one of verdicts) say(`  ${pad(one.name, 26)} ${pad(one.widget, 19)} read ${one.read ? 'yes' : 'NO '}  committed ${one.committed ? 'yes' : 'NO '}  truthful ${one.truthful ? 'yes' : 'NO '}  bounded ${one.bounded ? 'yes' : 'NO '}${one.failures.length ? `  (${one.failures.join('; ').slice(0, 160)})` : ''}`);
say('Per widget (committed / pages):');
for (const [widget, entry] of Object.entries(summary.byWidget)) say(`  ${pad(widget, 19)} ${entry.committed}/${entry.total}`);
if (args.includes('--model')) {
  say('Fill check in shadow (the real model; per page, the controls it named):');
  for (const item of cases) { const host = new URL(item.pages[0].url).hostname, found = shadow.get(host); say(`  ${pad(item.name, 26)} ${found ? found.map(row => `${row.label.slice(0, 22)}=${row.verdict}${row.reason ? `/${row.reason}` : ''}`).join(', ') || '(no miss named)' : '(not asked)'}`); }
}
if (jsonOut) fs.writeFileSync(jsonOut, `${JSON.stringify({summary, verdicts}, null, 1)}\n`);
const broken = verdicts.filter(one => one.failures.some(line => /^(error|isolation)\b/.test(line)));
if (summary.unsafe.length) console.error(`UNSAFE: a submit was pressed on ${summary.unsafe.join(', ')}`);
if (broken.length) console.error(`replay broke on ${broken.map(one => one.name).join(', ')}`);
process.exit(summary.unsafe.length || broken.length ? 1 : 0);
