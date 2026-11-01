// Every reader that shows a page to the AI or picks a control on it leaves out the extension's own UI: the panel (its open shadow root under
// #jobpilotto-review-host), the step box, the "didn't fill" note, the reading banner and the Submit guard (speed-5x, 11 Oct 2026: the page-kind sketch
// listed "Tailor my CV for this job", "Open in Jobadabra" and "77 left required fields", so the AI's input changed with the panel's timing and a replay
// of the same page sent another sketch). Each reader runs from its own source, as ladder-capture.mjs does; a new reader goes in READERS. Headless Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {builderSource, candidatesOfPage, functionSource, loadReader} from '../../ladder-capture.mjs';

const root = path.resolve(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..', '..', '..');
let chromium = null;
try { ({chromium} = await import('playwright-core')); if (!fs.existsSync(chromium.executablePath())) chromium = null; } catch { /* no playwright */ }

// The page's own content, then the extension's UI as the extension draws it (ids from review.js, background.js, visit-page.js, page/browser-submit-guard.js).
const PAGE = `<!doctype html><html><head><title>Engineer</title></head><body style="margin:0;min-height:1200px">
  <main><h1>Site Reliability Engineer</h1><p>Join the platform team. Write to jobs@example.com to ask.</p>
  <a href="/apply" style="display:inline-block;padding:10px">Apply now</a> <button>Share</button></main>
  <div role="dialog" style="position:fixed;left:0;bottom:0;width:100%;height:160px;z-index:50;background:#eee"><p>We use cookies for privacy and consent.</p><button>Reject all</button></div>
  <div id="jobpilotto-review-host" style="position:fixed;right:18px;bottom:18px;z-index:2147483646"></div>
  <div id="jobpilotto-progress" style="position:fixed;top:12px;right:12px;z-index:2147483647;width:320px;height:60px"><span>Jobadabra: reading the page</span></div>
  <div id="jobpilotto-note" style="position:fixed;top:80px;right:12px;z-index:2147483647;width:340px;height:120px"><div>Jobadabra didn't fill this form: cookie consent</div>
    <button type="button">Fill anyway</button><button type="button">Close note</button></div>
  <div id="jobpilotto-reading" role="status" style="position:fixed;right:16px;bottom:200px;z-index:2147483647">Jobadabra is reading</div>
  <div id="job-pilotto-submit-guard" style="position:fixed;bottom:12px;left:12px;z-index:2147483647"><span>Submit and legal consent paused. </span><button>Unlock Submit</button></div>
  <script>
    const shadow = document.getElementById('jobpilotto-review-host').attachShadow({mode: 'open'});
    shadow.innerHTML = '<div class="jp" role="dialog" style="position:fixed;right:18px;bottom:18px;z-index:5000;width:420px;height:420px;background:#fff">'
      + '<h2>77 left required fields</h2><p>2 consents to review, privacy</p><button>Tailor my CV for this job</button><a href="#open">Open in Jobadabra</a>'
      + '<label>First name <input aria-label="First name"></label></div>';
  </script></body></html>`;
const OURS = /Tailor my CV|Open in Jobadabra|77 left|consents to review|Fill anyway|Close note|Unlock Submit|Jobadabra/;

// The in-page function of a reader that takes arguments (apply-press.js applyCandidates: `func: selector => ...`), called with them.
const argsBuilder = (file, marker, head, args) => {
  const text = fs.readFileSync(path.join(root, 'extension', file), 'utf8'), start = text.indexOf(head, text.indexOf(marker)), end = text.indexOf(', args: [', start);
  if (start < 0 || end < 0) throw new Error(`cannot find the builder after "${marker}" in extension/${file}`);
  return `(${text.slice(start + 'func: '.length, end)})(...${JSON.stringify(args)})`;
};
const withArgs = (source, args) => `${source.replace(/\(\)$/, '')}(...${JSON.stringify(args)})`;

const READERS = [
  ['page-kind sketch (page-reads.js pageSketchOf)', page => page.evaluate(builderSource('page-reads.js', 'function pageSketchOf'))],
  ['judges\' sketch (account-fill.js accountSketch)', async page => { await loadReader(page); return page.evaluate(functionSource('account-fill.js', 'export function accountSketch')); }],   // with the one control reader, as judge-sketch.js loads it
  ['Apply candidates (apply-press.js applyCandidates)', page => page.evaluate(argsBuilder('apply-press.js', 'function applyCandidates', 'func: selector =>', ['a[href], button, [role="button"], input[type="button"]']))],
  ['named controls (apply-press.js with tab-pages.js NAMED_BUTTONS)', page => page.evaluate(argsBuilder('apply-press.js', 'function applyCandidates', 'func: selector =>', ['button, input[type=submit], [role=button], a']))],
  ['rung 3 candidates (ladder/rung3-candidates.js)', page => candidatesOfPage(page)],
  ['cookie box (visit-page.js closeConsent)', page => page.evaluate(withArgs(functionSource('visit-page.js', 'export function closeConsent'), [{list: true}]))],
  ['popup in the way (popup-page.js findPopup)', page => page.evaluate(withArgs(functionSource('popup-page.js', 'export function findPopup'), [{list: true}]))],
];

test('no reader shows the AI, or picks, the extension\'s own UI; the page\'s own content is still read', {skip: !chromium && 'no Chromium'}, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    await page.route('**/*', route => route.fulfill({status: 200, contentType: 'text/html', body: PAGE}));
    await page.goto('https://jobs.example.com/o/sre');
    const failures = [];
    for (const [name, read] of READERS) {
      const text = JSON.stringify(await read(page));
      if (OURS.test(text)) failures.push(`${name}: ${text.match(OURS)[0]}`);
    }
    assert.deepEqual(failures, []);
    // A positive control: the readers still see the page itself.
    assert.match(JSON.stringify(await READERS[0][1](page)), /Apply now/);
    assert.match(JSON.stringify(await READERS[2][1](page)), /Apply now/);
    assert.match(JSON.stringify(await READERS[5][1](page)), /Reject all/);
  } finally { await browser.close(); }
});

test('every extension script that walks open shadow roots is in READERS (a new walker must leave out the panel too)', () => {
  const dir = path.join(root, 'extension'), walkers = [];
  for (const file of fs.readdirSync(dir, {recursive: true}).map(f => String(f).split(path.sep).join('/')).filter(f => f.endsWith('.js') && !f.includes('node_modules'))) {
    if (/\.shadowRoot\)\s*walk\(/.test(fs.readFileSync(path.join(dir, file), 'utf8'))) walkers.push(file);
  }
  const covered = READERS.map(([name]) => name.match(/\(([\w/.-]+\.js)/)[1]);
  for (const file of walkers) assert.ok(covered.some(name => file.endsWith(name)), `${file} walks shadow roots but no READERS row runs it`);
});
