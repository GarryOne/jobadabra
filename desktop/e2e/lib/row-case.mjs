// A pool row's capture becomes a case folder for the recorded-pages job (npm run row-to-case, skill fix-recorded-sites): every page scrubbed again (the fake applicant's contact), shrunk
// (lib/row-case-shrink.mjs), the row's model answers (with their part hashes) and presses scrubbed, `baseline` = what the LIVE run did (its evidence lines without times), `replay: "row"` so the recorded test
// replays it on the row path (lib/row-replay.mjs). `expect` stays empty: the proof (row-to-case.mjs) fills it from the new build's replay, never the fixer. Refused, nothing written, when the privacy gate
// (lib/row-case-gates.mjs, the recorded-privacy test's own function) or the size gate fails. Guard: e2e/test/pool/row-case.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {appProfileTexts, personalValues, scrub, scrubPage} from './capture-page.mjs';
import {folderVerdict, privacyFindings, sizeVerdict, CASE_FAIL, CASE_WARN} from './row-case-gates.mjs';
import {shrinkPages} from './row-case-shrink.mjs';
import {keptPresses} from './row-follow.mjs';

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
// A web address in the page's own TEXT (a job ad's links, with tracking queries) loses its query and fragment, as the memo key already ignores them (lib/ai/model-memo.js normalise: the same pattern),
// so the answers kept for the live ask still match. The attribute values were cut at the capture; this is the copy in prose.
export const stripQueries = text => String(text).replace(/(https?:\/\/[^\s"'<>?#\\]+)[?#][^\s"'<>\\]*/g, '$1');
const TIME = /^(?:log )?\d\d:\d\d:\d\d(?:\.\d+)?Z? /;   // the evidence lines' own clock
const bare = line => String(line).replace(TIME, '').replace(/^\[extension\]/, '[extension]');

// The live run's evidence as the baseline the OLD build must replay to: page-kind lines in order without their times, each wording once, and what the run reached.
const baselineOf = (item, presses) => ({pageKinds: [...new Set((item.evidence?.pageKinds || []).map(bare))].map(line => line.replace(/^\[extension\] /, '')), reached: item.run?.reached ?? null,
  filled: item.run?.filled ?? null, short: item.run?.short ?? null, path: item.run?.path || [],
  fields: (item.run?.fields || []).map(({label, outcome, reason}) => ({label, outcome, reason})), pressed: presses.map(press => press.what)});

// -> {dir, bytes, verdict}. shrink: injectable for tests (default: the headless-Chromium pruning). values: the person's own values to scrub (default: this Mac's app profile).
export async function buildCase({rowDir, name, outDir, shrink = shrinkPages, values = personalValues(appProfileTexts()), chromium = null, exe, gate = true, stub = []}) {   // gate false: measuring only (what each file weighs), never a case that is written
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(String(name))) throw new Error(`case name "${name}": use lowercase letters, digits and dashes (<shape>-<n>)`);
  if (!outDir) throw new Error('no cases folder: the private evaluation data is absent (lib/eval-data.mjs casesDir()); nothing written');
  const item = readJson(path.join(rowDir, 'case.json'), null);
  if (!item?.pages?.length) throw new Error(`no recorded pages in ${rowDir}/case.json`);
  const har = readJson(path.join(rowDir, 'styles.har.json'), {log: {entries: []}}).log?.entries || [];
  const harCss = har.filter(entry => /css/.test(entry.response?.content?.mimeType || '')).map(entry => scrubPage(entry.response.content.text || '', values));
  const pages = item.pages.map(page => ({url: String(page.url).replace(/[?#].*$/, ''), file: page.file, html: stripQueries(scrubPage(fs.readFileSync(path.join(rowDir, page.file), 'utf8'), values)), meta: page}));
  const browser = chromium || (await import('playwright-core')).chromium, input = pages.map(({url, file, html}) => ({url, file, html}));
  let {pages: shrunk, sheets} = await shrink(browser, input, harCss, {exe, stub}), budget = '';
  const weigh = (list, map) => list.reduce((sum, page) => sum + Buffer.byteLength(page.html), 0) + [...map.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0);
  if (weigh(shrunk, sheets) > CASE_WARN) {   // the page budget: over the size warning, the rules of the sheets are cut to what decides what is visible, where and how big (the case is proved by the replay afterwards, as any case)
    const before = weigh(shrunk, sheets);
    ({pages: shrunk, sheets} = await shrink(browser, input, harCss, {exe, layoutOnly: true, stub}));
    budget = `page budget: styles cut to layout and visibility, ${Math.round(before / 1024)} KB -> ${Math.round(weigh(shrunk, sheets) / 1024)} KB of pages and sheets`;
  }
  const files = {};
  const meta = item.pages.map((page, at) => ({...Object.fromEntries(['at', 'state', 'ask', 'answerAsk', 'view', 'frameOf'].filter(key => page[key] !== undefined).map(key => [key, page[key]])), url: pages[at].url, file: `pages/${at + 1}.html`}));
  shrunk.forEach((page, at) => { files[meta[at].file] = page.html; });
  files['styles.har.json'] = JSON.stringify({log: {entries: [...sheets].map(([url, text]) => ({request: {url}, response: {content: {mimeType: 'text/css', text}}}))}});
  const optional = (file, fallback) => { try { return fs.readFileSync(path.join(rowDir, file), 'utf8'); } catch { return fallback; } };   // a run with no presses writes no presses.json (the Ashby capture: 0 presses)
  files['model-memo.json'] = stripQueries(scrub(optional('model-memo.json', '{}'), values));
  files['presses.json'] = scrub(optional('presses.json', '[]'), values);
  const asks = (() => { try { return JSON.parse(optional('ai-calls.json', '[]')).map(call => ({route: String(call.route), at: call.at})).filter(call => Number.isFinite(call.at)).sort((a, b) => a.at - b.at); } catch { return []; } })();   // when the app had answered each model ask: a later page state follows its ask (lib/row-follow.mjs bindToAsks)
  const keep = {shape: item.shape, why: item.why, sample: item.sample, ...(item.seed ? {seed: item.seed} : {}), ...(item.control ? {control: item.control} : {})};   // seed: the applicant the capture was made with (lib/applicant-seed.mjs): a case keeps it, the replay names a stale one
  files['case.json'] = `${JSON.stringify({...keep, replay: 'row', pages: meta, ...(asks.length ? {asks} : {}), baseline: baselineOf(item, keptPresses(readJson(path.join(rowDir, 'presses.json'), []), Math.min(...item.pages.filter(page => !page.frameOf && page.at != null).map(page => page.at)) || null)), expect: {}}, null, 1)}\n`;
  const found = privacyFindings(Object.fromEntries(Object.entries(files).map(([file, text]) => [`${name}/${file}`, text])), values);
  if (found.length) throw new Error(`privacy gate: ${found.join('; ')}; nothing written`);
  const bytes = Object.values(files).reduce((sum, text) => sum + Buffer.byteLength(text), 0), verdict = sizeVerdict(bytes);
  if (verdict === 'fail' && gate) {
    const kb = text => Math.round(Buffer.byteLength(text) / 1024), pagesKb = shrunk.reduce((sum, page) => sum + kb(page.html), 0), biggest = shrunk.map((page, at) => [kb(page.html), meta[at].file]).sort((a, b) => b[0] - a[0])[0] || [0, ''];
    throw new Error(`size gate: ${name} is ${Math.round(bytes / 1024)} KB, over ${CASE_FAIL / 1024} KB (pages ${pagesKb} KB, styles ${kb(files['styles.har.json'])} KB, the biggest page ${biggest[1]} ${biggest[0]} KB${budget ? `; ${budget}` : '; the page budget did not apply'}); a large real page is left out of the cases: keep what the replay reads with --stub-page <n> (1-based: pages/<n>.html; repeatable), or cut a recorded page by hand; nothing written`);
  }
  const dir = path.join(outDir, name);
  if (folderVerdict(folderBytes(outDir) + bytes) === 'fail') throw new Error(`size gate: the cases folder would pass 8 MB; nothing written`);
  for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true}); fs.writeFileSync(path.join(dir, file), text); }
  return {dir, bytes, verdict, budget};
}

const folderBytes = dir => { let total = 0; try { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) total += entry.isDirectory() ? folderBytes(path.join(dir, entry.name)) : fs.statSync(path.join(dir, entry.name)).size; } catch { /* none yet */ } return total; };
