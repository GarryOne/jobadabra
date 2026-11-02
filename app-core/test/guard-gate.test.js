// The page-side gate of the popup guard (extension/page/guard-gate.js): the fill asks it between its stages; it asks the extension (through the isolated-world bridge,
// extension/guard-bridge.js) only when the page changed since the last ask, at most every GATE_EVERY_MS; "held" stops the fill, silence from the bridge lets it go on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const open = () => openPage(JSDOM, '<input id="a"><div id="host"></div>').window;
const bridge = (window, answer, marked = true) => { let asked = 0; if (marked) window.document.documentElement.setAttribute('data-jobadabra-gate', '1'); window.addEventListener('jobadabra-gate', () => { asked++; window.dispatchEvent(new window.CustomEvent(answer)); }); return () => asked; };

test('a quiet page: the gate says go on and asks nobody', { skip: !JSDOM }, async () => {
  const window = open(); const asked = bridge(window, 'jobadabra-gate-done');
  assert.equal(await window.__jobadabraGate(), true);
  assert.equal(asked(), 0);
});

test('the page changed: the extension is asked once, and the answer decides', { skip: !JSDOM }, async () => {
  const window = open(); const asked = bridge(window, 'jobadabra-gate-done');
  window.document.getElementById('host').appendChild(window.document.createElement('div'));
  assert.equal(await window.__jobadabraGate(), true);
  assert.equal(asked(), 1);
  assert.equal(await window.__jobadabraGate(), true, 'nothing new since the ask');
  assert.equal(asked(), 1);
  const held = open(); bridge(held, 'jobadabra-gate-held');
  held.document.getElementById('host').appendChild(held.document.createElement('div'));
  assert.equal(await held.__jobadabraGate(), false, 'held: the fill stops');
});

test('a bridge that does not answer: the gate lets the fill go on after a short wait', { skip: !JSDOM }, async () => {
  const window = open(); window.__jobadabraGateWaitMs = 30; window.document.documentElement.setAttribute('data-jobadabra-gate', '1');
  window.document.getElementById('host').appendChild(window.document.createElement('div'));
  const started = Date.now();
  assert.equal(await window.__jobadabraGate(), true);
  assert.ok(Date.now() - started < 1000);
});

test('asks are spaced: a page that changes all the time is asked at most every GATE_EVERY_MS', { skip: !JSDOM }, async () => {
  const window = open(); const asked = bridge(window, 'jobadabra-gate-done'); window.__jobadabraGateEveryMs = 5000;
  for (let i = 0; i < 3; i++) { window.document.getElementById('host').appendChild(window.document.createElement('div')); await window.__jobadabraGate(); }
  assert.equal(asked(), 1);
});

test('no bridge on the page (no mark): the gate never asks and never waits', { skip: !JSDOM }, async () => {
  const window = open(); const asked = bridge(window, 'jobadabra-gate-held', false);
  window.document.getElementById('host').appendChild(window.document.createElement('div'));
  const started = Date.now();
  assert.equal(await window.__jobadabraGate(), true);
  assert.equal(asked(), 0);
  assert.ok(Date.now() - started < 200);
});
