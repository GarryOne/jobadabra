// The cookie layer is closed on every path a run can end on (Fidag, 11 Oct 2026): the sweep itself, and that the flow calls it in the watch loop, at the watch's end and before a "can't reach" report.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

globalThis.chrome = { runtime: { id: 'x', getManifest: () => ({ version: '0' }) }, storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({}), set: async () => {} } } };

test('the sweep asks the consent closer for cookies only and says what it pressed; a failing closer is no error', async () => {
  const { sweepConsent } = await import('../../extension/consent-sweep.js');
  let seen;
  assert.equal(await sweepConsent(7, 'test', async (tab, opts) => { seen = [tab, opts]; return 'Ok'; }), 'Ok');
  assert.deepEqual(seen, [7, { cookiesOnly: true }]);
  assert.equal(await sweepConsent(7, 'test', async () => { throw new Error('tab gone'); }), '');
  assert.equal(await sweepConsent(7, 'test', async () => ''), '');
});

test('the flow sweeps in the watch loop, when the watch ends and before a stuck report', () => {
  const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
  const watch = flow.slice(flow.indexOf('async function watchForFields'), flow.indexOf('export async function consider'));
  const loop = watch.slice(watch.indexOf('for (let i = 0; i < looks'));
  assert.match(loop.slice(0, loop.indexOf('const shape = await pageShape')), /sweepConsent\(/, 'each look in the watch loop');
  assert.match(watch.slice(watch.indexOf("'watch ended: no form and no new frame'")), /sweepConsent\(/, 'when the watch ends');
  const stuck = flow.slice(flow.indexOf('export async function stuck'));
  assert.match(stuck.slice(0, stuck.indexOf("type: 'stuck'")), /sweepConsent\(/, 'before the stuck report');
});
