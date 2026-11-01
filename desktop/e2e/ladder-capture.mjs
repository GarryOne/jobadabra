/* global document, location */
// Fills the `sketch` of each ladder fixture (desktop/e2e/ladder-fixtures/<id>.json) with the page sketch exactly as the extension builds it: it runs the extension's OWN builder functions
// (extension/page-reads.js pageSketchOf, extension/ladder/outcomes.js mailsOf, read from their source) in a bare headless Chromium, with no extension, no profile and no app.
//   capture.page: a page of this repo (relative to desktop/e2e/), loaded from disk with the network blocked.
//   capture.url:  a public posting, read once (a plain GET, nothing pressed, nothing typed); the sketch is stored without its query string, with any email turned into contact@example.com.
//                 A page with another host's iframe waits (<= 20 s) for one to pass the frame finder's floor and lists it in frameCandidates (extension/ladder/rung3-frames.js + climb.js frameSketch);
//                 capture.frame says whether one qualified (none = a finding). Guard: e2e/test/ladder-capture-frames.test.mjs.
//   --from-candidates [--day <YYYY-MM-DD>] [--candidates-dir <folder>] [--only <shape>]: the pool run's replay candidates (e2e/lib/ladder-candidates.mjs) that did NOT reach the form become fixtures with expect `pending` (the page.html
//     of the candidate, loaded from disk with the network blocked; scrubbed); a fixture that exists is kept (--force replaces it); --only takes a candidate whatever it reached.
//   node desktop/e2e/ladder-capture.mjs [--only <id>] [--force] [--candidates] [--dir <fixtures folder>]      Used when a fixture is added or a page changed; the committed sketch is what the tests use.
import {guardLiveVisit} from './lib/site-ledger.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {CANDIDATES_DIR, candidateFixture, readCandidates, selectCandidates} from './lib/ladder-candidates.mjs';
import {candidatesFromRequest, readAiCalls, requestOf, sketchFromRequest} from './lib/ladder-ai-calls.mjs';
import {DIR, loadFixtures} from './lib/ladder-fixtures.mjs';
import {noEmail, noPhone} from './lib/ladder-scrub.mjs';
import {frameSketch} from '../../extension/ladder/climb.js';
import {READER_FILES} from '../../extension/judge-sketch.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const E2E = path.dirname(fileURLToPath(import.meta.url));

// The body of the `func: () => {…}` that follows `marker` in an extension source file.
export function builderSource(file, marker) {
  const text = fs.readFileSync(path.join(ROOT, 'extension', file), 'utf8');
  const start = text.indexOf('func: () => {', text.indexOf(marker));
  const end = text.indexOf('}}).then(rows', start);
  if (start < 0 || end < 0) throw new Error(`cannot find the builder after "${marker}" in extension/${file}`);
  return `(() => {${text.slice(start + 'func: () => {'.length, end)}})()`;
}
// The numbered candidates of rung 3 (extension/ladder/rung3-candidates.js, a classic page script): run in the page as the extension would.
export const candidatesOfPage = page => page.evaluate(`${fs.readFileSync(path.join(ROOT, 'extension/ladder/rung3-candidates.js'), 'utf8')}\nwindow.__jobPilottoCandidates.candidatesOf()`);

// The whole `export function <name>() {…}` of an extension file (balanced braces), as an expression to run in the page.
export function functionSource(file, header) {
  const text = fs.readFileSync(path.join(ROOT, 'extension', file), 'utf8'), start = text.indexOf(header);
  if (start < 0) throw new Error(`cannot find "${header}" in extension/${file}`);
  let depth = 0, end = -1;
  for (let at = text.indexOf('{', start); at < text.length; at++) { if (text[at] === '{') depth++; else if (text[at] === '}' && --depth === 0) { end = at + 1; break; } }
  return `(${text.slice(start, end).replace(/^export\s+/, '')})()`;
}
// The one control reader (extension/page/read-back.js and the typed-box rule it uses), loaded into the page before the judges' sketch, as the extension does (judge-sketch.js).
export async function loadReader(page) {
  for (const file of READER_FILES) await page.addScriptTag({content: fs.readFileSync(path.join(ROOT, 'extension', file), 'utf8')});
}
// What the judges are shown (extension/account-fill.js accountSketch: controls with their state, never their values), the page's own `at` positions dropped; fromPath/sameForm from the fixture (a result question).
export async function judgeSketchOf(page, capture = {}) {
  await loadReader(page);
  const found = await page.evaluate(functionSource('account-fill.js', 'export function accountSketch'));
  const {url: _url, ...rest} = found;   // the fixture's own url (query-free) is written by the caller
  return {...rest, controls: found.controls.map(({at: _at, ...control}) => control), ...(capture.fromPath ? {fromPath: capture.fromPath} : {}), ...(capture.sameForm ? {sameForm: capture.sameForm} : {})};
}

// The frame candidates as the extension lists them (extension/ladder/rung3-frames.js run in the page, then climb.js frameSketch: host, path, size; the address never kept).
export const frameCandidatesOfPage = page => page.evaluate(`${fs.readFileSync(path.join(ROOT, 'extension/ladder/rung3-frames.js'), 'utf8')}\nwindow.__jobPilottoFrames.frameCandidates()`).then(frameSketch);
// A live page with another host's iframe: wait (at most waitMs) until one qualifies as a candidate (the finder's own floor), as the extension judges again when a frame grows
// (climb.js frameGrew; a hosted board's iframe is born ~150 px high). -> {frameCandidates, frame: {read, qualified, after_s}}; `frame` is null when the page has no other host's iframe.
export async function grownFramesOf(page, {waitMs = 20000, stepMs = 500} = {}) {
  const foreign = () => page.evaluate(() => [...document.querySelectorAll('iframe[src]')].some(frame => { try { const url = new URL(frame.getAttribute('src'), location.href); return url.protocol === 'https:' && url.host !== location.host; } catch { return false; } }));
  const started = Date.now();
  let list = await frameCandidatesOfPage(page);
  if (!list.length && !(await foreign())) return {frameCandidates: [], frame: null};
  while (!list.length && Date.now() - started < waitMs) { await page.waitForTimeout(stepMs); list = await frameCandidatesOfPage(page); }
  const waited = Math.round((Date.now() - started) / 100) / 10;   // seconds after the load wait until one qualified (or the whole wait, when none did)
  if (list.length) { await page.waitForTimeout(1500); list = await frameCandidatesOfPage(page); }   // a growing frame settles its size
  return {frameCandidates: list, frame: {read: 'live load', qualified: list.length > 0, after_s: waited}};
}

export async function sketchOf(page) {
  const sketch = await page.evaluate(builderSource('page-reads.js', 'function pageSketchOf'));
  sketch.mails = await page.evaluate(builderSource('ladder/outcomes.js', 'export function mailsOf'));
  return sketch;
}

// The pool run's failed replay candidates -> pending fixtures (the sketch and the numbered candidates are built by the extension's own functions from the saved page.html, offline).
async function fromCandidates(browser, {dir, only, day, root, force}) {
  const picked = selectCandidates(readCandidates(root, {day}), {only});
  if (!picked.length) console.log(`no failed candidate in ${root}${day ? ` (${day})` : ''}${only ? ` matching ${only}` : ''}`);
  for (const item of picked) {
    const file = path.join(dir, `cand-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}.json`);
    if (fs.existsSync(file) && !force) { console.log(`kept ${path.basename(file)} (exists; --force replaces it)`); continue; }
    // What the app REALLY received in the failing run (ai-calls.json, the harness's capture): the sketch the model saw, frame candidates included. Preferred over a sketch rebuilt from page.html.
    const asked = requestOf(readAiCalls(item.dir), {digest: false});
    if (asked) {
      const digest = requestOf(readAiCalls(item.dir), {digest: true});
      const fixture = candidateFixture({name: item.name, day: item.day, caseJson: item.caseJson, sketch: sketchFromRequest(asked.request), candidates: digest ? candidatesFromRequest(digest.request) : [], observed: asked.answer, fromRequest: true});
      fs.writeFileSync(file, `${JSON.stringify(fixture, null, 1)}\n`);
      console.log(`${fixture.id}: built from ai-calls.json (what the app really sent): ${fixture.sketch.controls?.length ?? 0} controls, ${fixture.sketch.buttons?.length ?? 0} buttons, ${fixture.sketch.frameCandidates?.length ?? 0} frame candidates, ${fixture.candidates.length} candidates; run reached ${item.caseJson.run?.reached || 'nothing'}; expectation pending`);
      continue;
    }
    const context = await browser.newContext({viewport: {width: 1280, height: 900}, acceptDownloads: false});
    try {
      const page = await context.newPage();
      await page.route(url => !url.href.startsWith('file:'), route => route.abort());
      await page.goto(pathToFileURL(path.join(item.dir, 'page.html')).href, {waitUntil: 'load'});
      const lang = String(await page.evaluate(() => document.documentElement.lang || '')).slice(0, 2).toLowerCase();
      const fixture = candidateFixture({name: item.name, day: item.day, caseJson: item.caseJson, sketch: await sketchOf(page), candidates: await candidatesOfPage(page), lang});
      fs.writeFileSync(file, `${JSON.stringify(fixture, null, 1)}\n`);
      console.log(`${fixture.id}: ${fixture.sketch.controls.length} controls, ${fixture.sketch.buttons.length} buttons, ${fixture.candidates.length} candidates; run reached ${item.caseJson.run?.reached || 'nothing'}; expectation pending`);
    } catch (error) { console.log(`FAILED ${item.name}: ${String(error.message).split('\n')[0]}`); } finally { await context.close(); }
  }
}

async function main() {
  const args = process.argv.slice(2), arg = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
  const dir = arg('--dir') || DIR, only = arg('--only');
  const browser = await chromium.launch({headless: true});
  try {
    if (args.includes('--from-candidates')) return await fromCandidates(browser, {dir, only, day: arg('--day'), root: arg('--candidates-dir') || CANDIDATES_DIR, force: args.includes('--force')});
    for (const fixture of loadFixtures(dir)) {
      if ((only && fixture.id !== only) || !fixture.capture || (fixture.sketch && !args.includes('--force') && !args.includes('--candidates') && only !== fixture.id)) continue;   // a captured sketch is kept (a real page changes): --force or --only re-reads it
      try {
        const context = await browser.newContext({viewport: {width: 1280, height: 900}, acceptDownloads: false});
        const page = await context.newPage();
        let url = fixture.sketch?.url || '', grown = null;
        if (fixture.capture.page) {
          await page.route(url => !url.href.startsWith('file:'), route => route.abort());
          await page.goto(pathToFileURL(path.join(E2E, fixture.capture.page)).href, {waitUntil: 'load'});
        } else {
          guardLiveVisit(fixture.capture.url, {who: process.env.JOB_PILOTTO_SESSION || 'ladder-capture'});   // the per-site daily limit (lib/site-ledger.mjs)
          await page.goto(fixture.capture.url, {waitUntil: 'domcontentloaded', timeout: 30000});
          await page.waitForTimeout(4000);
          url = (await page.evaluate(() => location.href)).split(/[?#]/)[0];
          if (!fixture.question || fixture.question === 'page_kind') grown = await grownFramesOf(page);   // only a live load proves a frame (an offline scrubbed page has no CSS); a finding when none qualified
        }
        const detected = fixture.lang ? '' : String(await page.evaluate(() => document.documentElement.lang || '')).slice(0, 2).toLowerCase();   // a new fixture learns its page's language
        const judge = fixture.question && fixture.question !== 'page_kind';   // a judge question: the judges' sketch, no numbered candidates
        const candidates = judge ? undefined : noPhone(noEmail(await candidatesOfPage(page)));
        const fresh = args.includes('--candidates') && fixture.sketch ? null : noPhone(noEmail(judge ? await judgeSketchOf(page, fixture.capture) : await sketchOf(page)));   // --candidates keeps the sketch (a real page changes) and only adds the numbered candidates
        await context.close();
        if (fresh && grown) fresh.frameCandidates = grown.frameCandidates;
        const sketch = fresh || fixture.sketch;
        const file = path.join(dir, fixture.file), {file: _, ...kept} = fixture;
        const capture = grown?.frame ? {...kept.capture, frame: grown.frame} : kept.capture;
        fs.writeFileSync(file, `${JSON.stringify({...kept, capture, ...(detected ? {lang: detected} : {}), sketch: fresh ? {url: fixture.capture.page ? fixture.url || fixture.sketch?.url || '' : url, ...fresh} : fixture.sketch, ...(candidates ? {candidates} : {})}, null, 1)}\n`);
        console.log(`${fixture.id}: ${sketch.controls.length} controls, ${sketch.buttons.length} buttons, ${sketch.headings.length} headings, ${sketch.mails?.length ?? 0} addresses, ${sketch.frames.length} frames${grown?.frame ? `, ${grown.frameCandidates.length} frame candidates (${grown.frame.qualified ? `qualified after ${grown.frame.after_s} s` : `NONE qualified in ${grown.frame.after_s} s: a finding`})` : ''}${judge ? ` (${fixture.question})` : ''}`);
      } catch (error) { console.log(`FAILED ${fixture.id}: ${String(error.message).split('\n')[0]}`); }
    }
  } finally { await browser.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exit(1); });
