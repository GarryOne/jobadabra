// Measures the affected-case map (e2e/recorded-case-map.json): every recorded case runs alone in its own browser with V8 coverage on the extension's worker and pages, and the files a named
// function ran in are kept (lib/replay-coverage.mjs). Run when the extension's file list or a case changed: `npm run recorded-map` (takes the heavy lock; about the time of a serial replay).
// lib/replay-select.mjs reads the map; a map that does not match extension/ is stale and every case runs.
// Job: serve stored answers
import fs from 'node:fs';
import path from 'node:path';
import {REPLAY_DIR, loadCases} from './lib/page-replay.mjs';
import {startReplayBrowser} from './lib/replay-browser.mjs';
import {connect, startCoverage} from './lib/replay-coverage.mjs';
import {MAP_FILE, extensionFiles} from './lib/replay-select.mjs';
import {extensionWorker} from './lib/own-worker.mjs';

const only = process.env.REPLAY_ONLY || '';
const root = path.resolve(REPLAY_DIR, '../../..');
const previous = (() => { try { return JSON.parse(fs.readFileSync(path.join(REPLAY_DIR, '..', MAP_FILE), 'utf8')); } catch { return null; } })();
const cases = {...(only && previous ? previous.cases : {})};
const failed = [];
for (const item of loadCases().filter(one => one.name.includes(only))) {
  const browser = await startReplayBrowser([item], {cdp: true});
  const cdp = await connect(browser.run.profile);
  try {
    const cover = await startCoverage(cdp, new URL((await extensionWorker(browser.run.context)).url()).host);
    const tick = setInterval(() => cover.refresh().catch(() => {}), 500);   // a tab the case opens later is covered too
    const result = await browser.runInTab(item);
    clearInterval(tick);
    cases[item.name] = [...await cover.stop()].sort();
    if (!result.ok) failed.push(item.name);
    console.log(`${item.name}: ${cases[item.name].length} files${result.ok ? '' : ' (the case FAILED: its map is from a failing run)'}`);
  } finally { cdp.close(); await browser.close(); }
}
if (failed.length) { console.error(`recorded-map: not written, these cases failed: ${failed.join(', ')}`); process.exit(1); }
const sorted = Object.fromEntries(Object.entries(cases).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(path.join(REPLAY_DIR, '..', MAP_FILE), `${JSON.stringify({note: 'Measured by `npm run recorded-map` (V8 function coverage): the extension files each recorded case really runs code from. Read by lib/replay-select.mjs; do not edit by hand.', extensionFiles: extensionFiles(root), cases: sorted}, null, 1)}\n`);
console.log(`recorded-map: ${Object.keys(sorted).length} cases written to ${MAP_FILE}`);
