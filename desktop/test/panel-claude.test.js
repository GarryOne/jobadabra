// The stuck page's Claude offer (extension/panel-claude.js; spec 2026-10-10-claude-finishes-stuck-pages.md parts 1-4): which view the panel shows, as a pure function.
// Guards the choices: offer (3 choices), consent line on the first press, 5 s countdown only with "always" + consent + "Do it for me", never when Claude is not ready.
import assert from 'node:assert/strict';
import {test} from 'node:test';

globalThis.window = {};   // a classic panel script: it hangs its helpers on window (no DOM needed for the state function)
await import('../../extension/panel-claude.js');
const {next} = globalThis.window.__jobadabraClaude;

const info = (extra = {}) => ({on: true, stuck: true, auto: false, consent: true, ...extra});
const fresh = () => ({phase: null, dismissed: false});

test('not stuck: nothing is shown, and what was decided is forgotten', () => {
  assert.equal(next(info({stuck: false}), {phase: 'sent', dismissed: true}).view, 'hidden');
  assert.deepEqual(next(info({stuck: false}), {phase: 'sent', dismissed: true}).mem, fresh());
});

test('stuck and Claude ready: the offer; first press asks the consent line once, a later one starts', () => {
  assert.equal(next(info(), fresh()).view, 'offer');
  assert.equal(next(info({consent: false}), fresh(), 'press').view, 'consent');
  assert.equal(next(info({consent: false}), {phase: 'consent', dismissed: false}, 'continue').view, 'sent');
  assert.equal(next(info({consent: true}), fresh(), 'press').view, 'sent');
});

test('"I\'ll do it myself" hides the offer for this page', () => {
  const after = next(info(), fresh(), 'myself');
  assert.equal(after.view, 'hidden');
  assert.equal(next(info(), after.mem).view, 'hidden');
});

test('"always" counts down only with consent; Cancel keeps it manual for the page', () => {
  assert.equal(next(info({auto: true}), fresh()).view, 'countdown');
  assert.equal(next(info({auto: true, consent: false}), fresh()).view, 'offer', 'no consent yet: the consent line first, never an auto-start');
  const cancelled = next(info({auto: true}), {phase: 'countdown', dismissed: false}, 'cancel');
  assert.equal(cancelled.view, 'hidden');
  assert.equal(next(info({auto: true}), cancelled.mem).view, 'hidden');
  assert.equal(next(info({auto: true}), {phase: 'countdown', dismissed: false}, 'done').view, 'sent');
});

test('Claude not ready (not installed, OpenAI engine, "Let me check each step" for the countdown): what is needed, or no countdown', () => {
  assert.equal(next(info({on: false}), fresh()).view, 'needs');
  assert.equal(next(info({on: false, auto: true}), fresh()).view, 'needs');
  assert.equal(next(info({on: false, stuck: false}), fresh()).view, 'hidden');
});

test('an email posting has no page for Claude to finish: the panel offers nothing', () => {
  assert.equal(next(info({stuck: 'email'}), fresh()).view, 'hidden');
  assert.equal(next(info({stuck: 'no-form'}), fresh()).view, 'offer');
});

test('a page that tells the person what to do has no page for Claude to finish either', () => {
  assert.equal(next(info({stuck: 'told'}), fresh()).view, 'hidden');
});

test('a page the ladder could not read has no page for Claude to finish either: nothing offered', () => {
  assert.equal(next(info({stuck: 'other'}), fresh()).view, 'hidden');
});
