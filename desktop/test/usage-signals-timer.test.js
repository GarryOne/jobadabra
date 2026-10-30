// The renderer's usage clock tolerates a stub DOM without hasFocus and stops when its page hides.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../renderer/usage-signals.js', import.meta.url), 'utf8').replace(/^export /gm, '');

function load(t, nodeTimer = false, focus = {hasFocus: () => true}) {
  t.mock.timers.enable({apis: ['setInterval']});
  const document = Object.assign(new EventTarget(), {hidden: false}, focus);
  const sent = [], window = Object.assign(new EventTarget(), {pilot: {usage: payload => sent.push(payload)}});
  const unref = t.mock.fn();
  const usage = vm.runInNewContext(`${source}\nusage;`, {
    document, window,
    setInterval: (callback, ms) => {
      const timer = setInterval(callback, ms);
      return nodeTimer ? {timer, unref} : timer;
    },
    clearInterval: handle => clearInterval(nodeTimer ? handle.timer : handle),
  });
  usage.viewChanged('jobs');
  return {document, window, usage, sent, unref};
}

test('a stub document that never had hasFocus does not throw or count as focused', t => {
  const {document, usage, sent} = load(t, false, {});
  assert.equal('hasFocus' in document, false, 'like tiny-dom, the document never defined hasFocus');
  assert.doesNotThrow(() => t.mock.timers.tick(1000));
  usage.flush();
  assert.equal(sent.length, 0, 'a document without hasFocus counts no seconds');
});

test('pagehide flushes the last second and cancels all further usage ticks', t => {
  const {window, usage, sent} = load(t);
  const tick = t.mock.method(usage, 'tick');
  t.mock.timers.tick(1000);
  assert.equal(tick.mock.callCount(), 1);
  window.dispatchEvent(new Event('pagehide'));
  assert.equal(sent[0]?.active, 1, 'pagehide still flushes the counted time');
  t.mock.timers.tick(3000);
  assert.equal(tick.mock.callCount(), 1, 'the departed page leaves no usage timer');
  usage.flush();
  assert.equal(sent.length, 1);
});

test('hidden and unfocused pages count no seconds; focus resumes the one-second tick', t => {
  const {document, usage, sent} = load(t);
  document.hidden = true;
  t.mock.timers.tick(1000);
  document.hidden = false;
  document.hasFocus = () => false;
  t.mock.timers.tick(1000);
  usage.flush();
  assert.equal(sent.length, 0);
  document.hasFocus = () => true;
  t.mock.timers.tick(999);
  usage.flush();
  assert.equal(sent.length, 0);
  t.mock.timers.tick(1);
  usage.flush();
  assert.equal(sent[0]?.active, 1);
});

test('a runtime offering unref does not keep the process alive for the usage clock', t => {
  const {unref, window, usage} = load(t, true);
  assert.equal(unref.mock.callCount(), 1);
  const tick = t.mock.method(usage, 'tick');
  t.mock.timers.tick(1000);
  window.dispatchEvent(new Event('pagehide'));
  t.mock.timers.tick(1000);
  assert.equal(tick.mock.callCount(), 1, 'the object timer handle is also cleared');
});
