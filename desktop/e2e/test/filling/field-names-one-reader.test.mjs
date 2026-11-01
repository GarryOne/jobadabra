// One reader names a field wherever the form judge's side names it (owner, 11 Oct 2026: the toast said "Needs you: cards[144cb968-...][field0]", the raw field name, while the panel listed the
// question's text): the judge's sketch (extension/account-fill.js accountSketch) and the covered labels of the layer on top (extension/on-top.js) use the fill kit's labelOf (page/fill-labels.js,
// the panel's and the fill trace's reader) when the page has it, and the old chain only when it does not. One loop over every place that names a field. Headless Chromium; skipped without it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {functionSource} from '../../ladder-capture.mjs';

const root = path.resolve(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..', '..', '..');
let chromium = null;
try { ({chromium} = await import('playwright-core')); if (!fs.existsSync(chromium.executablePath())) chromium = null; } catch { /* no playwright */ }
const read = file => fs.readFileSync(path.join(root, 'extension', file), 'utf8');

const QUESTION = 'Why do you want to work here?', RAW = 'cards[144cb968-d9cd-4e8e-948b-8041add7325b][field0]';
// Lever: the question is a title block beside the box, the box is named only by its raw name.
const PAGE = `<div class="application-question"><div class="application-label">${QUESTION}</div><div class="application-field"><textarea name="${RAW}"></textarea></div></div>
  <div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:#fff;z-index:9"><button>Close</button></div>`;
// every place that names a field on the judge's side: what it returns for the one textarea
const PLACES = [
  ['the judge\'s sketch', 'account-fill.js', 'export function accountSketch', result => result.controls.find(item => item.type === 'textarea')?.label],
  ['the layer on top (covered)', 'on-top.js', 'export function onTop', result => result?.covered?.[0]],
];

test('every place that names a field uses the fill kit\'s reader when the page has it, and falls back to the raw name only without it', {skip: !chromium && 'no Chromium installed'}, async () => {
  const browser = await chromium.launch({headless: true});
  try {
    for (const [name, file, header, pick] of PLACES) {
      const page = await browser.newPage({viewport: {width: 900, height: 700}});   // a fresh window each: the kit of the one place must not be in the next
      await page.setContent(`<!doctype html><html><body style="margin:0">${PAGE}</body></html>`);
      assert.equal(pick(await page.evaluate(functionSource(file, header))), RAW, `${name}: without the kit the old chain names it (fallback)`);
      await page.evaluate(['page/required-mark.js', 'page/radios.js', 'page/fill-labels.js'].map(read).join('\n'));
      assert.equal(pick(await page.evaluate(functionSource(file, header))), QUESTION, `${name}: with the kit it reads the question like the panel`);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('the form judge asks for its sketch and its layer in the page\'s own world, where the kit lives', () => {
  const source = read('form-ready.js');
  assert.match(source, /sketchOf\(tab\.id, frameId, 'MAIN'\)/);   // the sketch through judge-sketch.js, which loads the one control reader into that world first
  assert.match(source, /onTop, \[\], 'MAIN'/);
});
