// The truth checks (lib/uicheck.mjs, kind wrong-result): a page that states a wrong result about itself, caught exactly, and the right page left alone (5 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {LIMITS, inspect} from '../../lib/uicheck.mjs';
import {layoutSeverity} from '../../lib/triage.mjs';

const month = (title, days) => `<b id="cal-title">${title}</b><div id="cal-grid">${days.map(day => `<div class="cal-cell"><span class="cal-num">${day}</span></div>`).join('')}<div class="cal-cell out"><span class="cal-num">1</span></div></div>`;
const run = (pill, steps) => `<span id="activity-status"><span>${pill}</span></span><ol id="activity-phases">${steps.map(([cls, text]) => `<li class="${cls}">${text}</li>`).join('')}</ol>`;
const range = n => Array.from({length: n}, (_, i) => i + 1);

async function wrong(page, body) {
  await page.setContent(`<section class="view" data-view="x">${body}</section>`);
  return (await page.evaluate(inspect, {view: 'x', limits: LIMITS})).filter(item => item.kind === 'wrong-result');
}

test('a month that lost a day, repeats one or is cut short is wrong; a whole month is not', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage();
    assert.match((await wrong(page, month('October 2026', range(31).filter(day => day !== 4))))[0].detail, /day 4 missing/);
    assert.match((await wrong(page, month('October 2026', [...range(4), 4, ...range(31).slice(4)])))[0].detail, /day 4 twice/);
    assert.match((await wrong(page, month('February 2026', range(30))))[0].detail, /30 days shown, the month has 28/);
    assert.deepEqual(await wrong(page, month('October 2026', range(31))), []);
    assert.deepEqual(await wrong(page, month('February 2028', range(29))), [], 'a leap year');
  } finally { await browser.close(); }
});

test('a run whose pill and steps disagree is wrong; agreeing ones are not', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage();
    assert.match((await wrong(page, run('Failed', [['done', 'Search'], ['done', 'Score']])))[0].detail, /says "Failed" but every step is ticked done/);
    assert.match((await wrong(page, run('Completed', [['done', 'Search'], ['fail', 'Score']])))[0].detail, /a step is marked failed/);
    assert.equal((await wrong(page, run('With warnings', [['done', 'Search'], ['done', 'Score']]))).length, 1);
    assert.deepEqual(await wrong(page, run('Failed', [['done', 'Search'], ['fail', 'Score']])), []);
    assert.deepEqual(await wrong(page, run('With warnings', [['done', 'Search'], ['warn', 'Score']])), []);
    assert.deepEqual(await wrong(page, run('Completed', [['done', 'Search'], ['done', 'Score']])), []);
    assert.deepEqual(await wrong(page, run('Failed', [['update', 'a line']])), [], 'update lines are not steps');
  } finally { await browser.close(); }
});

test('a wrong result is filed high', () => {
  assert.equal(layoutSeverity({kind: 'wrong-result', severity: 'warning'}), 'high');
});

test('two runs on one page: each status is judged against its own steps, not the other run\'s', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage();
    // The real panel: its status shows, its step list is hidden (as in the app while recall plants run).
    const panel = `<div class="panel">${run('Failed', [['done', 'Search'], ['fail', 'Score']]).replace('<ol id="activity-phases">', '<ol id="activity-phases" hidden>')}</div>`;
    const plant = `<div class="plant">${run('Completed', [['done', 'Search'], ['fail', 'Score']])}</div>`;
    const found = await wrong(page, panel + plant);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.match(found[0].detail, /says "Completed" but a step is marked failed/);
    assert.deepEqual(await wrong(page, `<div>${run('Failed', [['done', 'Search'], ['fail', 'Score']])}</div><div>${run('Completed', [['done', 'Search'], ['done', 'Score']])}</div>`), [], 'both right in their own box');
  } finally { await browser.close(); }
});
