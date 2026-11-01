// A replay draws the live page's scrollbar width (lib/scrollbar.mjs, recorded by lib/capture-journey.mjs as view.scrollbar): measured on a real page, forced 15 and 0.
// Opt-in like every browser run (JP_REPLAY=1); the CSS shape always runs.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {forceScrollbar, scrollbarCss} from '../../lib/scrollbar.mjs';

test('the forced style names the width, and 0 hides the scrollbar', () => {
  assert.match(scrollbarCss(15), /::-webkit-scrollbar\{width:15px;height:15px\}/);
  assert.equal(scrollbarCss(0), '::-webkit-scrollbar{width:0px;height:0px}');
});

test('no recorded width changes nothing (a capture made before the field)', async () => {
  let added = 0;
  assert.equal(await forceScrollbar({addInitScript: async () => { added += 1; }}, undefined), false);
  assert.equal(added, 0);
});

test('a page shows the forced width on this machine, whatever its own scrollbar', {skip: process.env.JP_REPLAY ? false : 'opt-in: set JP_REPLAY=1; it starts Chromium'}, async () => {
  const browser = await chromium.launch({ignoreDefaultArgs: ['--hide-scrollbars']});   // as the harness's browser (lib/real-extension.mjs): Playwright's headless default hides every scrollbar
  try {
    for (const width of [15, 0]) {
      const page = await browser.newPage();
      await forceScrollbar(page, width);
      await page.route('**/*', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><div style="height:3000px">tall</div>'}));
      await page.goto('https://page.example.test/');
      assert.equal(await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth), width);   // eslint-disable-line no-undef
      await page.close();
    }
  } finally { await browser.close(); }
});
