// lib/window-shot.mjs: every app shot is the window's own painted surface, taken in the still (reduced-motion) look, and the look is always given back (#2749, #2742, #2806).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appPicture, windowShot} from '../../lib/window-shot.mjs';

const PNG = Buffer.from('fake-png');
/** A fake app and page that record what the shot asked, in order; `capture` is what the window's capturePage gives. */
function fakes({capture = async () => ({toPNG: () => PNG})} = {}) {
  const asked = [];
  const page = {emulateMedia: async media => { asked.push(['media', media.reducedMotion]); }, evaluate: async () => { asked.push(['frames']); return true; }};
  const win = {webContents: {capturePage: async () => { asked.push(['capture']); return capture(); }}};
  const app = {browserWindow: async of => { assert.equal(of, page, 'the window of the page being shot'); return {evaluate: (fn, ...rest) => fn(win, ...rest)}; }};
  return {app, page, asked};
}

test('the window as painted, after the still look reached the screen, then the look is given back', async () => {
  const {app, page, asked} = fakes();
  assert.deepEqual(await windowShot(app, page), PNG);
  assert.deepEqual(asked, [['media', 'reduce'], ['frames'], ['capture'], ['media', null]]);
});

test('a failure never loses its picture: an empty window capture falls back to the CSS-px screenshot, with one logged line', async () => {
  const empty = fakes({capture: async () => ({toPNG: () => Buffer.alloc(0)})}), lines = [];
  empty.page.screenshot = async () => Buffer.from('css-px');
  assert.deepEqual(await appPicture(empty.app, empty.page, line => lines.push(line)), Buffer.from('css-px'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /window capture empty \(the window painted nothing to capture\): CSS-px screenshot instead/);
  const fine = fakes(), quiet = [];
  fine.page.screenshot = async () => { throw new Error('not asked when the window gave its picture'); };
  assert.deepEqual(await appPicture(fine.app, fine.page, line => quiet.push(line)), PNG);
  assert.deepEqual(quiet, []);
});

test('a capture that fails still gives the look back and says why, so the caller can log it', async () => {
  const {app, page, asked} = fakes({capture: async () => { throw new Error('window gone'); }});
  await assert.rejects(windowShot(app, page), /window gone/);
  assert.deepEqual(asked.at(-1), ['media', null]);
  const empty = fakes({capture: async () => ({toPNG: () => Buffer.alloc(0)})});
  await assert.rejects(windowShot(empty.app, empty.page), /painted nothing/);
  assert.deepEqual(empty.asked.at(-1), ['media', null]);
});
