// A live row without Electron (speed-5x landing 3): the app's own server and functions under plain node (lib/offline-app.mjs: the fake applicant, its network cut to
// this computer; the AI asked through the plan's claude -p when `ask`), the real extension in a test browser that reaches the real site, and the harness doing
// what the window would: save the applicant's contact, press Apply (the app hands the posting's address to this browser), then watch. Nothing is pressed on the
// page by the harness, never Submit. Every page is captured as the Electron run captures it (lib/capture-journey.mjs, at the extension's ask), and the privacy
// tripwire (lib/privacy-tripwire.mjs) checks every field every few seconds and before anything is written. -> {seconds, opened, evidence, tripped}.
// CLI: live-row.mjs. Guard: e2e/test/live-row.test.mjs (a fake site, memo-only).
// Job: serve stored answers
/* global document, location */
import {liveVideo} from './live-video.mjs';
import {stallNote} from './stall-note.mjs';
import fs from 'node:fs';
import {endShotLine, takeEndShot} from './end-shot.mjs';
import {readLive, readingsLine} from './live-readings.mjs';
import {kindFromLog, stepLines, stepShooter} from './step-shots.mjs';
import {ensureStagedWorker} from './staged-worker.mjs';
import path from 'node:path';
import {frontOf} from './app-front.mjs';
import {keepWorkerConsole} from './worker-console.mjs';
import {seedVersion} from './applicant-seed.mjs';
import {CONTACT} from './apply-fixtures.mjs';
import {cssRecorder, personalValues, scrubPage} from './capture-page.mjs';
import {journeyRecorder} from './capture-journey.mjs';
import {evidenceLines} from './evidence-bundle.mjs';
import {isDeciding} from './deciding.mjs';
import {PAGE_LINE, hardCapMs, quietSeconds, runEnded, stillClock, stillSeconds as stillSecondsFor} from './live-still.mjs';
import {startOfflineApp} from './offline-app.mjs';
import {coverageLine, ownerValues, pageFields, tripwire} from './privacy-tripwire.mjs';
import {applyPoolEligibility, eligibilityOff} from './pool-eligibility.mjs';
import {seedLivePosting} from './seed-data.mjs';
import {storeCall} from './store-call.mjs';
import {startRealExtension} from './real-extension.mjs';
import {livePresses} from './replay-candidate.mjs';
import {blockVerdict, guardLiveVisit, markBlocked} from './site-ledger.mjs';
import {startAiProxy} from './ai-proxy.mjs';
import {keyRefusal, refillCap, refillKey} from './refill.mjs';
import {allowedValues, contactFor, seedTestAccounts, signedInHosts, testAccounts} from './test-accounts.mjs';
import {apiErrors, usage} from './ai-meter.mjs';
import {appKey, isCi, keySecret, testKey} from './engine.mjs';
import {keepRecord, netRecorder} from './net-record.mjs';
import {seedRandom} from './seeded-random.mjs';
import {hereZone} from './replay-date.mjs';
import {extensionWorker} from './own-worker.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// posting: {url, title, company}; captureDir: where the journey, the AI calls and the asks go; ask: false keeps the AI to kept answers (a test), true asks live.
// aiProxy: a started lib/ai-proxy.mjs (a test's canned one). On CI one is started here: the runner has no Claude Code, so the app's API engine asks through it on the
// test key (.github/workflows/record-sites.yml) and the row's spend is metered (-> ai). A Mac without aiProxy: the plan's claude -p, no spend line.
export async function runLiveRow({posting, captureDir, extensionDir, ask = true, seconds = 120, stillSeconds = stillSecondsFor(process.env, 'cli'), browser = startRealExtension, say = () => {}, aiProxy = null, atEnd = null, fill = false, loose = '', watch = null} = {}) {   // atEnd(tab, replies): a replay's own reading of the last tab (replay-net.mjs: lib/wrong-values.mjs)
  const refill = fill && isCi() && process.env.JP_REFILL_CI === '1';   // the refill workflow (lib/refill.mjs): its own key, no other
  if (refill && keyRefusal()) throw new Error(keyRefusal());
  if (ask && isCi() && !aiProxy && !testKey()) throw new Error(`live row on CI: no ${keySecret('api')} (the Tests key); the app has no other way to ask the AI on a runner`);
  guardLiveVisit(posting.url, {who: process.env.JOBADABRA_SESSION || 'live row'});   // the per-site daily limit (lib/site-ledger.mjs): refused before anything starts
  ensureStagedWorker({say});   // a worker edit since the last staging would run the old prompt
  const started = Date.now();
  let shotAsked = false;
  fs.mkdirSync(captureDir, {recursive: true});
  const proxy = aiProxy || (refill ? await startAiProxy({maxCalls: refillCap()}) : ask && isCi() ? await startAiProxy() : null),   // a replay never asks: no proxy
    before = {...usage().app};
  const errorsBefore = {...apiErrors()};   // calls Anthropic refused (no credit, a limit, a bad key): the row then ran without AI, which the run must say
  const spend = () => {
    const now = usage().app, refused = Object.entries(apiErrors()).map(([why, count]) => [why, count - (errorsBefore[why] || 0)]).filter(([, count]) => count > 0);
    return {calls: now.calls - before.calls, usd: now.usd - before.usd, input: now.input - before.input, output: now.output - before.output,
      refused: refused.reduce((sum, [, count]) => sum + count, 0), why: refused[0]?.[0] || ''};
  };
  const app = await startOfflineApp({ask, fill, loose, journey: !!watch, review: process.env.LIVE_USE_PROPOSALS === '1', captureDir, memo: path.join(captureDir, 'model-memo.json'), ...(proxy ? {api: {url: proxy.url, key: refill ? refillKey() : appKey(testKey())}} : {})}).catch(async error => { if (proxy && !aiProxy) await proxy.close(); throw error; });
  const accounts = testAccounts(), seeded = seedTestAccounts(app.dir, accounts);   // a listed test account's saved password (docs/rules/applying.md "Signing in"); hosts only, never a value
  if (seeded.length) say(`live: test account for ${seeded.join(', ')} (the product's saved-password sign-in; never Submit)`);
  const front = await frontOf(app);
  const run = await browser({extensionDir, appPort: front.port, allowAllSites: true});
  const watcher = watch ? watch({app, context: run.context}) : null;   // the journey tests' sampler of the card and the panel (lib/journey-watch.mjs), read-only
  const owner = ownerValues();
  say(`live: ${coverageLine(owner)}`);   // kinds only, never a value; a kind it could not find is said, never a silent "clean"
  const values = personalValues([`Name: ${CONTACT.full_name}\nEmail: ${CONTACT.email}\nPhone: ${CONTACT.phone}`]);
  const journey = journeyRecorder(run.context, {scrub: html => scrubPage(html, values)}), styles = cssRecorder(run.context);
  const net = process.env.JP_NET_RECORD_DIR ? netRecorder(run.context, {startedAt: Date.now(), owner: new Map([...owner, ...values])}) : null, netStart = Date.now();   // the network record (CI: encrypted, .github/workflows/record-sites.yml)
  if (net) await seedRandom(run.context, netStart);   // the replay draws the same random numbers (lib/seeded-random.mjs)
  const workerConsole = keepWorkerConsole(run.context);   // the extension's own console, beside app.log (lib/worker-console.mjs)
  const steps = stepShooter({tabOf: () => run.context.pages().filter(page => /^https?:/.test(page.url())).at(-1), kindOf: () => kindFromLog(app.logText()), dir: captureDir});   // one full-page picture per page or step reached (lib/step-shots.mjs)
  let asksSeen = 0, tripped = '';
  const video = await liveVideo({context: run.context, page: run.page});   // CI's pool run only (JP_FILL_VIDEO_DIR): a short video of the tab being filled, for the Lab's ▶ Watch
  const asks = setInterval(() => {   // each ask noted by the app as it arrives (asks.jsonl): that page kept at once, as the extension saw it
    let lines = [];
    try { lines = fs.readFileSync(path.join(captureDir, 'asks.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return; }
    for (const line of lines.slice(asksSeen)) { try { journey.atAsk(JSON.parse(line).url).catch(() => {}); } catch { /* a line being written */ } }
    asksSeen = lines.length;
  }, 200);
  const trip = async () => {
    for (const tab of run.context.pages().filter(page => /^https?:/.test(page.url()))) {
      const check = await tripwire(pageFields(tab), {values: owner, saved: [captureDir], allow: allowedValues(accounts), accounts});
      if (!check.ok) return check.reason;
    }
    return '';
  };
  try {
    await applyPoolEligibility(await extensionWorker(run.context), {say});   // before Apply: a pool run measures filling
    await app.call('saveContact', contactFor(CONTACT, accounts, posting.url));   // a host with a test account: that account's email (lib/test-accounts.mjs contactFor)
    // The posting as the Electron path has it (suites/apply.mjs): tracked, Saved, no kit, in this app's own store (lib/seed-data.mjs seedLivePosting).
    const store = {store: 'sqlite', profile: app.dir};
    await seedLivePosting({...store, data: (entity, method, kwargs) => storeCall(store, entity, method, kwargs)}, posting);
    const opened = new Promise((resolve, reject) => { app.onOpen(resolve); setTimeout(() => reject(new Error('Apply never opened the posting')), 15000).unref(); });
    const applied = await app.call('applyOne', posting.url, {title: posting.title || '', company: posting.company || ''});
    if (!applied?.ok) throw new Error(`Apply failed: ${applied?.error || 'no answer'}`);
    const url = await opened;
    say(`live: Apply opened ${url.split('#')[0]}`);
    // As the Electron run's browser: one tab, the headless window's own size (lib/extension.mjs viewport null: 1200 x 818). A page laid out at another width
    // showed its dialog's buttons otherwise, and the AI judged it otherwise (11 Oct 2026, jobs.ch: "account" here, "posting" there).
    for (const page of run.context.pages()) if (page !== run.page && !page.url().startsWith('chrome-extension://')) await page.close().catch(() => {});
    await run.page.setViewportSize({width: 1200, height: 818}).catch(() => {});
    await run.page.goto(url, {waitUntil: 'domcontentloaded'}).catch(() => {});
    const clock = stillClock({seconds: stillSeconds, startedAt: Date.now()});
    let deciding = false, tabsAtEnd = null;
    // The limit is `seconds`; while the extension is still on a step (deciding) the run goes on up to a hard cap of twice that (record-once spec, 15 Oct 2026: a plan-path
    // ask takes ~28 s and a press climbs 3-5 asks, so a 90 s end cut a recording while the extension still worked). LIVE_HARD_SECONDS sets it; 0 = no extra time.
    const hardMs = hardCapMs(seconds);
    let endedByCap = '';
    const acceptProposals = process.env.LIVE_USE_PROPOSALS === '1', usedProposals = new Set();   // opt-in (docs/live-test.md): a held run past My Information
    for (let turn = 0; ; turn++) {
      const age = Date.now() - started;
      if (age >= hardMs || (age >= seconds * 1000 && !deciding)) { endedByCap = deciding ? `ended by cap while the extension was still deciding (${Math.round(hardMs / 1000)} s)${stallNote(app.logText(), Date.now()) ? `; ${stallNote(app.logText(), Date.now())}` : ''}` : ''; break; }
      const lines = app.logText().split('\n').filter(line => PAGE_LINE.test(line)).length;
      // Still = the page and its decisions stopped changing (as lib/apply-live.mjs: the extension's own check-ins to the app every few seconds are no news).
      const shape = await run.context.pages().filter(page => /^https?:/.test(page.url())).at(-1)?.evaluate(() => `${location.href.split('#')[0]}|${document.querySelectorAll('input, select, textarea, button, a').length}`).catch(() => '');
      clock.see(JSON.stringify([lines, shape]), Date.now());
      deciding = await isDeciding(run.context.pages().filter(page => /^https?:/.test(page.url())).at(-1) || run.page);   // the extension's step line is up: wait for its decision (the limit is the cap)
      const logText = app.logText(), open = run.context.pages().filter(page => /^https?:/.test(page.url())).length;
      tabsAtEnd = runEnded(logText) ? tabsAtEnd ?? open : null;   // the tab count when the end was first seen: a tab opened after it keeps the full window (live-still.mjs)
      if (clock.over(Date.now(), {opened: true, deciding, quiet: quietSeconds(stillSeconds, logText, process.env, {now: open, atEnd: tabsAtEnd})})) break;
      await journey.tick();
      await steps.tick();
      if (turn % 4 === 0 && (tripped = await trip())) break;
      if (acceptProposals && !deciding && turn % 4 === 2) {   // as the person's "Use" on each proposed answer; the extension fills it and goes on by its own rules (never Submit)
        const taken = await app.call('useProposals', [...usedProposals]).catch(() => null);
        for (const key of taken?.used || []) usedProposals.add(key);
        if (taken?.used?.length) say(`live: used ${taken.used.length} proposed answer(s) like the person's Use press${taken.skipped?.length ? `; left: ${taken.skipped.join(', ')}` : ''}`);
      }
      await wait(1500);
    }
    clearInterval(asks);
    if (endedByCap) say(`live: ${endedByCap}`);
    const endedWhileDeciding = deciding;   // the limit came while the extension was still on a step: an error, not a finished run
    shotAsked = true;
    // The false readings at the end (lib/live-readings.mjs: contact boxes hold the applicant's values, the panel's count agrees with the page): pool-ci.mjs makes them red.
    const lastTab = run.context.pages().filter(page => /^https?:/.test(page.url())).at(-1);
    if (lastTab) say(readingsLine(await readLive(lastTab, CONTACT).catch(error => ({failures: [], boxes: 0, error: String(error?.message || error).slice(0, 80)}))));
    if (lastTab && atEnd) await atEnd(lastTab, front.replies).catch(error => say(`live: end reading failed: ${String(error?.message || error).slice(0, 80)}`));
    const shot = await takeEndShot(run.context, captureDir);   // before the final privacy check: a hit deletes it with the capture (lib/end-shot.mjs); said out loud either way
    say(endShotLine(shot));
    for (const line of stepLines(steps, captureDir)) say(line);
    workerConsole.write(captureDir);   // before the final privacy check: a hit deletes it with the capture
    if (tripped || (tripped = await trip())) { say(`live: ${tripped}`); return {seconds: (Date.now() - started) / 1000, opened: url, evidence: evidenceLines(''), tripped, ...(proxy ? {ai: spend()} : {})}; }
    await journey.finish();
    const pages = journey.write(captureDir);
    // The capture is a row a replay can start from (npm run row -- <captureDir>): its pages and the live presses, as the pool keeps them (lib/replay-candidate.mjs).
    fs.writeFileSync(path.join(captureDir, 'case.json'), `${JSON.stringify({shape: posting.title || posting.url, pages, seed: seedVersion()}, null, 1)}\n`);
    fs.writeFileSync(path.join(captureDir, 'presses.json'), `${JSON.stringify(livePresses(app.logText()), null, 1)}\n`);
    fs.writeFileSync(path.join(captureDir, 'styles.har.json'), JSON.stringify(await styles.har()));
    fs.writeFileSync(path.join(captureDir, 'app.log'), app.logText());
    const {signal: blocked, contradicted} = blockVerdict(app.logText());
    if (blocked) { markBlocked(url, blocked); say(`live: the site blocked us (${blocked}): not visited again today (lib/site-ledger.mjs)`); }
    else if (contradicted) say(`live: ${contradicted}: the site stays open (lib/site-ledger.mjs)`);
    if (net && !blocked) {   // a bot-check row keeps no record (spec); the record never goes into the plain captures
      const settled = await net.settle(Number(process.env.JP_NET_SETTLE_SECONDS ?? 20) * 1000);   // an answer still on its way is part of the journey
      say(`live: network settled after ${(settled.waitedMs / 1000).toFixed(1)} s${settled.unfinished ? `, ${settled.unfinished} request(s) never answered (${Object.entries(settled.kinds || {}).map(([kind, count]) => `${count} ${kind}`).join(', ')})` : ''}`);
      await net.flush();
      const kept = keepRecord(net.result()), dir = path.join(process.env.JP_NET_RECORD_DIR, `${(posting.title || new URL(url).host).replace(/\W+/g, '-')}-${Date.now()}`);
      fs.mkdirSync(path.join(dir, 'bodies'), {recursive: true});
      for (const [hash, body] of kept.bodies) fs.writeFileSync(path.join(dir, 'bodies', hash), body);
      const scrollbar = await run.page.evaluate(() => { const probe = document.createElement('div'); probe.style.cssText = 'position:absolute;top:-999px;width:100px;height:100px;overflow:scroll'; document.documentElement.appendChild(probe); const width = probe.offsetWidth - probe.clientWidth; probe.remove(); return width; }).catch(() => null);   // the replay draws the same (lib/scrollbar.mjs)
      fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({name: process.env.JP_ROW_NAME || posting.title || '', where: process.env.CI ? 'ci' : 'mac', eligibility: eligibilityOff(process.env) ? 'off' : 'on', testAccountHosts: signedInHosts(app.logText()), startMs: netStart, seed: netStart, timezone: hereZone(), url, scrollbar, unfinished: settled.unfinished, unfinishedKinds: settled.kinds || {}, entries: kept.entries, stats: kept.stats}));
      for (const name of ['model-memo.json', 'app.log', 'asks.jsonl']) { try { fs.copyFileSync(path.join(captureDir, name), path.join(dir, name)); } catch { /* not written */ } }
      say(`live: network record kept: ${kept.stats.requests} requests, ${(kept.stats.keptBytes / 1e6).toFixed(2)} MB`);
      const lostNow = kept.entries.filter(entry => entry.bodyLost).length;
      if (lostNow) say(`live: ${lostNow} reply body(ies) could not be read while recording (the page navigated away): this record would replay an empty answer there; the publish guard refuses it`);
    }
    return {seconds: Math.round((Date.now() - started) / 100) / 10, opened: url, evidence: evidenceLines(app.logText()), tripped: '', endedWhileDeciding, requests: front.requests.length, appLog: app.logText(), ...(watcher ? {journey: await watcher.stop()} : {}), ...(proxy ? {ai: spend()} : {})};
  } finally {
    if (!shotAsked) { const shot = await takeEndShot(run.context, captureDir).catch(error => ({file: '', why: String(error?.message || error).slice(0, 80)})); say(endShotLine(shot)); }   // the run stopped early (an error): the picture of where it stopped is still a must
    clearInterval(asks);
    await video.finish({tripped: !!tripped, say});   // a privacy hit deletes the capture, so it deletes the video too
    await watcher?.stop().catch(() => {});
    await run.close().catch(() => {});
    await front.close().catch(() => {});
    await app.close().catch(() => {});
    if (proxy && !aiProxy) await proxy.close().catch(() => {});
  }
}
