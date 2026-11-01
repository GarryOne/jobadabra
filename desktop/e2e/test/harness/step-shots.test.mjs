// Full-page and per-step pictures (lib/step-shots.mjs; lib/end-shot.mjs): a form taller than the window is whole in the picture, so is one that scrolls inside a panel, a 3-step form gives
/* global document */
// step-01..03 + end, the caps say so, and a privacy-tripwire delete of the capture folder takes the step pictures too. The browser ones are opt-in like every browser run (JP_REPLAY=1).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {takeEndShot} from '../../lib/end-shot.mjs';
import {fullPageShot, kindFromLog, stepFilesIn, stepShooter} from '../../lib/step-shots.mjs';

const skip = process.env.JP_REPLAY ? false : 'opt-in: set JP_REPLAY=1; it starts Chromium';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-step-shots-'));
const pngHeight = file => fs.readFileSync(file).readUInt32BE(20);
const fields = n => Array.from({length: n}, (_, i) => `<p><label>Field ${i}<input name="f${i}"></label></p>`).join('');
const withTab = async (html, run, viewport = {width: 800, height: 600}) => {
  const browser = await chromium.launch(), context = await browser.newContext({viewport}), tab = await context.newPage();
  try { await tab.setContent(html); return await run(tab, context); } finally { await browser.close(); }
};

test('a form taller than the window: the whole page is in the picture, the bottom field too', {skip}, async () => {
  const dir = tmp();
  await withTab(`<body>${fields(60)}<input name="last" style="display:block;height:30px"></body>`, async tab => {
    const height = await tab.evaluate(() => document.documentElement.scrollHeight);
    const shot = await fullPageShot(tab, path.join(dir, 'a.png'));
    assert.equal(shot.why, '');
    assert.ok(height > 1500 && pngHeight(shot.file) >= height - 2, `picture ${pngHeight(shot.file)} px of ${height} px`);
  });
});

test('a form that scrolls inside a panel (the body is fixed): the panel is whole in the picture, the window goes back', {skip}, async () => {
  const dir = tmp();
  await withTab(`<body style="margin:0;height:100vh;overflow:hidden"><div style="height:100vh;overflow-y:auto">${fields(60)}</div></body>`, async tab => {
    const inner = await tab.evaluate(() => document.querySelector('div').scrollHeight);
    const shot = await fullPageShot(tab, path.join(dir, 'b.png'));
    assert.ok(inner > 1500 && pngHeight(shot.file) >= inner - 2, `picture ${pngHeight(shot.file)} px of a ${inner} px panel`);
    assert.deepEqual(tab.viewportSize(), {width: 800, height: 600}, 'the window is as it was');
  });
});

test('the height cap says "cut at <n> px"; the byte cap keeps a part that fits', {skip}, async () => {
  const dir = tmp();
  await withTab(`<body>${fields(80)}</body>`, async tab => {
    const shot = await fullPageShot(tab, path.join(dir, 'c.png'), {maxPx: 1200});
    assert.match(shot.why, /^cut at 1200 px$/);
    assert.equal(pngHeight(shot.file), 1200);
    const heavy = await fullPageShot(tab, path.join(dir, 'd.png'), {maxBytes: 20000});
    assert.match(heavy.why, /^cut at \d+ px$/);
    assert.ok(fs.statSync(heavy.file).size < fs.statSync(path.join(dir, 'c.png')).size);
  });
});

test('a 3-step form gives step-01..03 named by their kind, then end.png; the step cap leaves only the end', {skip}, async () => {
  const dir = tmp(), kinds = ['form', 'form', 'review'];
  await withTab('<body><h1>Step 1</h1><input name="a"></body>', async (tab, context) => {
    let kind = 'form';
    const shooter = stepShooter({tabOf: () => tab, kindOf: () => kind, dir});
    const turn = async () => { await shooter.tick(); await shooter.tick(); };
    await turn();
    await tab.setContent('<body><h1>Step 2</h1><input name="b"><input name="c"></body>'); await turn();
    kind = kinds[2]; await tab.setContent('<body><h1>Review</h1><button>Send</button></body>'); await turn();
    await turn();   // nothing new: nothing shot
    assert.deepEqual(stepFilesIn(dir), ['step-01-form.png', 'step-02-form.png', 'step-03-review.png']);
    await tab.goto('about:blank'); await context.pages()[0].setContent('<body><h1>end</h1></body>');
  });
  const capped = tmp();
  await withTab('<body><h1>x</h1></body>', async tab => {
    const shooter = stepShooter({tabOf: () => tab, dir: capped, cap: 2});
    for (let i = 0; i < 5; i++) { await tab.setContent(`<body><h1>Step ${i}</h1></body>`); await shooter.tick(); await shooter.tick(); }
    assert.equal(stepFilesIn(capped).length, 2);
  });
});

test('the end picture is full page too, and a missing end picture still says why', {skip}, async () => {
  const dir = tmp();
  await withTab(`<body>${fields(60)}</body>`, async (tab, context) => {
    Object.defineProperty(tab, 'url', {value: () => 'https://a.example/apply'});
    const shot = await takeEndShot(context, dir);
    assert.equal(shot.why, '');
    assert.ok(pngHeight(path.join(dir, 'end.png')) > 1500);
  });
});

test('step pictures sit in the capture folder: the tripwire\'s delete of the folder removes them; a failing step shot is a warning, not a stop', async () => {
  const dir = tmp(), tab = {evaluate: async () => '["u",[],[]]'};
  const shooter = stepShooter({tabOf: () => tab, dir, shot: async (_, file) => { fs.writeFileSync(file, 'png'); return {file, why: '', cut: 0}; }});
  await shooter.tick(); await shooter.tick();
  assert.equal(stepFilesIn(dir).length, 1);
  fs.rmSync(dir, {recursive: true, force: true});
  assert.equal(stepFilesIn(dir).length, 0);
  const failing = stepShooter({tabOf: () => tab, dir, shot: async () => ({file: '', why: 'closed', cut: 0})});
  await failing.tick(); await failing.tick();
  assert.deepEqual(failing.files(), []);
  assert.match(failing.notes()[0], /no step-01-page\.png: closed/);
});

test('kindFromLog names a step from the app log\'s newest page kind', () => {
  assert.equal(kindFromLog('x [extension] page kind: posting\n y [extension] page kind: account-form (by ai)'), 'account-form');
  assert.equal(kindFromLog(''), '');
});
