// extension/ladder/rung3-candidates.js marks a candidate drawn under a dialog or a fixed overlay as covered (the digest tells the AI), by structure (elementFromPoint); a sticky header over a strip, a closed
// dialog and a button inside the layer itself are not covered. Headless Chromium; skipped without Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const root = path.resolve(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..', '..', '..');
let chromium = null;
try { ({chromium} = await import('playwright-core')); if (!fs.existsSync(chromium.executablePath())) chromium = null; } catch { /* no playwright */ }

const POSTING = '<main><h1>Stock controller</h1><p>We are looking for a stock controller for our store.</p><a href="https://apply.example.net/start">Apply now</a><button id="b">Save job</button></main>';
const SHAPES = [
  ['a cookie wall over the posting', `${POSTING}<div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:#fffe;z-index:9"><button>Accept all</button></div>`, {'Apply now': true, 'Save job': true, 'Accept all': false}],
  ['a fixed overlay with no role', `${POSTING}<div style="position:fixed;inset:0;background:#fff;z-index:9">Please wait</div>`, {'Apply now': true, 'Save job': true}],
  ['a closed dialog', `${POSTING}<dialog><button>Hidden</button></dialog>`, {'Apply now': false, 'Save job': false}],
  ['a sticky header over a strip', `<div style="position:fixed;top:0;left:0;right:0;height:30px;background:#ccc;z-index:9">Menu</div><div style="height:60px"></div>${POSTING}`, {'Apply now': false, 'Save job': false}],
];

test('candidates under a layer are covered; others are not', {skip: !chromium && 'no Chromium installed'}, async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 900, height: 700}});
    const source = fs.readFileSync(path.join(root, 'extension', 'ladder', 'rung3-candidates.js'), 'utf8');
    for (const [name, html, want] of SHAPES) {
      await page.setContent(`<!doctype html><html><body style="margin:0">${html}</body></html>`);
      await page.evaluate(source);
      const found = await page.evaluate('window.__jobadabraCandidates.candidatesOf()');
      for (const [text, covered] of Object.entries(want)) assert.equal(!!found.find(item => item.text === text)?.covered, covered, `${name}: ${text}`);
    }
  } finally { await browser.close(); }
});
