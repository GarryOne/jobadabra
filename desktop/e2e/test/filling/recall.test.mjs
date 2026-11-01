/* global document, window */
// The recall benchmark: on a page like the app's, every planted bug is caught by the detector it was planted for, nothing planted is left behind,
// and the planted window errors are removed from the journey's record (never filed as real ones).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {journey, resetJourney} from '../../lib/journey.mjs';
import {measureRecall, recallFindings, PLANTS} from '../../lib/recall.mjs';

test('every planted bug is caught by its detector, and nothing planted stays', async () => {
  resetJourney();
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1200, height: 800}});
    page.on('pageerror', error => journey.pageErrors.push(`${error.name}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') journey.consoleErrors.push(message.text()); });
    page.on('requestfailed', request => journey.failedLoads.push(request.url()));
    // Like the app: the page itself never scrolls sideways, the content area does (overflow auto), and the page is long (a plant at the end would be off-screen).
    await page.setContent('<html lang="en"><head><title>t</title><style>.notice{display:flex;gap:8px;align-items:center}.spinner{display:inline-block;width:14px;height:14px;flex:none}</style></head><body style="margin:0;overflow:hidden"><div class="app" style="height:100vh;position:relative"><nav class="sidebar" style="position:absolute;right:0;top:0;height:100%;width:120px;display:flex;flex-direction:column;overflow-y:auto"><div class="nav-scroll" style="display:flex;flex-direction:column">'+Array.from({length: 16}, (_, n) => `<button style="height:40px;flex:none">Item ${n}</button>`).join('')+'</div></nav><main style="height:100vh;overflow:auto;width:calc(100% - 140px)"><section class="view" data-view="focus" style="overflow-x:auto"><h1>Focus</h1><p>Up next</p>'+Array.from({length: 12}, (_, n) => `<p style="height:60px;margin:0 0 8px;background:#eee">Row ${n}</p>`).join('')+'<div style="height:3000px"></div></section></main></div></body></html>');
    const ipc = {mark: async () => 0, since: async () => []};
    const result = await measureRecall({page, view: 'focus', ipc});
    assert.equal(result.planted, PLANTS.length);
    assert.deepEqual(result.rows.filter(row => !row.caught).map(row => `${row.id} (${row.saw})`), []);
    assert.equal(await page.evaluate(() => !!document.getElementById('recall-plant')), false, 'the last plant was taken out');
    assert.deepEqual([...journey.pageErrors, ...journey.consoleErrors, ...journey.failedLoads], [], 'nothing the plants caused is left for filing (#116, #117: the broken-image plant leaked)');
    assert.deepEqual(recallFindings(result), []);
    assert.match(recallFindings({rows: [{id: 'tiny-text', detector: 'layout', caught: false, saw: ''}]})[0].detail, /^tiny-text was planted for the layout check and not caught/);
  } finally { await browser.close(); }
});

// #321: a plant that reuses a real element's id (activity-phases, cal-grid…) used to receive the real nodes the app moves next to
// "its" element on every poll; taking the plant out then deleted them, and the app threw on `null.querySelector` from then on.
test('a plant that reuses the app\'s ids never takes the real elements out with it (#321)', async () => {
  resetJourney();
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1200, height: 800}});
    await page.setContent('<html lang="en"><head><title>t</title></head><body style="margin:0"><main><section class="view" data-view="focus"><h1>Focus</h1>'
      + '<div id="activity-warnings">warn</div><ol id="activity-phases"><li>real step</li></ol><b id="cal-title">real</b><div id="cal-grid"></div></section></main></body></html>');
    // Like pages/activity-render.js: every tick looks the list up by id and moves the warnings box beside it.
    await page.evaluate(() => { window.__ticks = 0; setInterval(() => { document.getElementById('activity-phases').before(document.getElementById('activity-warnings')); window.__ticks += 1; }, 20); });
    const ipc = {mark: async () => 0, since: async () => []};
    await measureRecall({page, view: 'focus', ipc});
    const state = await page.evaluate(() => ({ticks: window.__ticks, warnings: !!document.getElementById('activity-warnings'), phases: document.getElementById('activity-phases')?.textContent, plant: !!document.getElementById('recall-plant')}));
    assert.ok(state.ticks > 20, 'the app\'s own tick ran during the plants (positive control)');
    assert.equal(state.warnings, true, 'the real warnings box is still in the page');
    assert.equal(state.phases, 'real step', 'the real list is the one the page has');
    assert.equal(state.plant, false);
  } finally { await browser.close(); }
});

// A plant whose html uses an id the real page has (the detectors read some by id) is declared with `reusesIds`, so the collision is
// a choice: the app looks elements up by id and moves real nodes beside the plant's (#321). A new plant that collides by accident fails here.
test('a plant that reuses an id of the real page says so, and names exactly those ids', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../../../renderer/index.html', import.meta.url), 'utf8');
  const real = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const plant of PLANTS) {
    const reused = [...String(plant.html || '').matchAll(/\bid="([^"]+)"/g)].map(m => m[1]).filter(id => real.has(id)).sort();
    assert.deepEqual([...(plant.reusesIds || [])].sort(), reused, `plant ${plant.id}: the ids it shares with index.html must be listed in reusesIds`);
  }
});
