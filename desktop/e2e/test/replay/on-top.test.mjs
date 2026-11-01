// extension/on-top.js: what sits on top of the form, by structure (11 Oct 2026, a site dialog covered the form after the fill). A modal over the form and a fixed full-page overlay count;
// a closed dialog, a dialog that holds the form itself, and a sticky header that covers a strip do not. Headless Chromium; skipped without Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {functionSource} from '../../ladder-capture.mjs';

let chromium = null;
try { ({chromium} = await import('playwright-core')); if (!fs.existsSync(chromium.executablePath())) chromium = null; } catch { /* no playwright */ }

const FORM = '<form><label for="a">Name</label><input id="a" style="display:block;width:300px"><label for="b">Phone</label><input id="b" style="display:block;width:300px"></form><p>Apply</p>';
const SHAPES = [
  ['a modal dialog over the form', `${FORM}<div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:#0008"><div style="background:#fff;margin:100px;padding:20px">Your filled fields may be replaced. Continue?<button>Continue</button><button>Cancel</button></div></div>`, {shape: 'dialog', buttons: ['Continue', 'Cancel'], covered: ['Name', 'Phone']}],
  ['a fixed overlay with no role', `${FORM}<div style="position:fixed;inset:0;background:#fffe;z-index:50">Please wait<button>Close</button></div>`, {shape: 'overlay', buttons: ['Close']}],
  ['a closed dialog', `${FORM}<dialog>Hidden words<button>OK</button></dialog><div role="dialog" style="display:none">gone</div>`, null],
  ['a sticky header over a strip', `<div style="position:fixed;top:0;left:0;right:0;height:40px;background:#ccc;z-index:9">Menu <a href="#">Jobs</a></div><div style="height:60px"></div>${FORM}`, null],
  ['a cookie bar at the bottom', `${FORM}<div style="position:fixed;bottom:0;left:0;right:0;height:60px;background:#ddd;z-index:9">Cookies<button>OK</button></div>`, null],
  ['the form lives in the dialog', `<div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:#fff">${FORM}</div>`, null],
  ['a plain page', FORM, null],
];

test('on-top finds a layer drawn over the form, and only that', {skip: !chromium && 'no Chromium installed'}, async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 900, height: 700}});
    const run = functionSource('on-top.js', 'export function onTop');
    for (const [name, html, want] of SHAPES) {
      await page.setContent(`<!doctype html><html><body style="margin:0">${html}</body></html>`);
      const got = await page.evaluate(run);
      if (!want) assert.equal(got, null, name);
      else { assert.equal(got?.shape, want.shape, name); assert.deepEqual(got.buttons, want.buttons, name); assert.ok(got.text.length > 0, name); if (want.covered) assert.deepEqual(got.covered, want.covered, name); }
    }
  } finally { await browser.close(); }
});
