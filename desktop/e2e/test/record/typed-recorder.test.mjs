// Prove the read assertion retains transient writes without typing into a browser.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import {assertReadUntyped, sampleBeforeClose, TYPED_SNAPSHOT} from '../../lib/typed-recorder.mjs';

function fakePage() {
  class Input {
    constructor(type = 'text') { this.type = type; this.name = 'answer'; this.current = ''; }
    get value() { return this.current; }
    set value(value) { this.current = String(value); }
  }
  class Textarea extends Input {
    get value() { return this.current; }
    set value(value) { this.current = String(value); }
  }
  const listeners = {}, boxes = [new Input(), new Textarea()], observers = [];
  const context = vm.createContext({HTMLInputElement: Input, HTMLTextAreaElement: Textarea,
    document: {querySelectorAll: () => boxes, addEventListener: (name, fn) => { listeners[name] = fn; }},
    MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} }});
  const snapshot = () => JSON.parse(JSON.stringify(vm.runInContext(TYPED_SNAPSHOT, context)));
  return {boxes, listeners, observers, snapshot};
}

test('a value set and cleared in the same tick survives the next snapshot', () => {
  const {boxes, snapshot} = fakePage();
  assert.deepEqual(snapshot(), {installed: true, filled: []});
  for (const box of boxes) { box.value = 'brief fill'; box.value = ''; }
  assert.deepEqual(snapshot().filled, ['answer=brief fill', 'answer=brief fill']);
  assert.ok(boxes.every(box => box.value === ''));
});

test('installation only observes and repeated snapshots do not wrap setters twice', () => {
  const {boxes, snapshot} = fakePage();
  boxes[0].value = 'already present';
  assert.deepEqual(snapshot().filled, ['answer=already present']);
  boxes[0].value = '';
  snapshot();
  boxes[0].value = 'once'; boxes[0].value = '';
  assert.equal(snapshot().filled.filter(value => value === 'answer=once').length, 1);
});

test('native input and change events retain a transient value', () => {
  const {boxes, listeners, snapshot} = fakePage();
  snapshot();
  for (const event of ['input', 'change']) {
    boxes[0].current = event;
    listeners[event]({target: boxes[0]});
    boxes[0].current = '';
  }
  assert.deepEqual(snapshot().filled, ['answer=input', 'answer=change']);
});

test('attribute mutation old values retain a value cleared before observer delivery', () => {
  const {boxes, observers, snapshot} = fakePage();
  snapshot();
  observers[0]([{target: boxes[0], oldValue: ''}, {target: boxes[0], oldValue: 'attribute fill'}]);
  assert.deepEqual(snapshot().filled, ['answer=attribute fill']);
});

test('non-text controls keep the existing exclusion', () => {
  const {boxes, snapshot} = fakePage();
  snapshot();
  for (const type of ['hidden', 'submit', 'button', 'checkbox', 'radio', 'file']) {
    boxes[0].type = type; boxes[0].value = 'ignored'; boxes[0].value = '';
  }
  assert.deepEqual(snapshot(), {installed: true, filled: []});
});

test('an unseen form or uninstalled recorder cannot prove an empty read', () => {
  assert.throws(() => assertReadUntyped({samples: 0, installed: 0, filled: []}), /never seen open/);
  assert.throws(() => assertReadUntyped({samples: 1, installed: 0, filled: []}), /never installed/);
  assert.doesNotThrow(() => assertReadUntyped({samples: 1, installed: 1, filled: []}));
});

test('a transient write makes the read assertion fail even when the field is empty', () => {
  const {boxes, snapshot} = fakePage();
  snapshot();
  boxes[0].value = 'transient'; boxes[0].value = '';
  assert.throws(() => assertReadUntyped({samples: 1, installed: 1, filled: snapshot().filled}), /read typed into the form/);
});

test('an observer that stopped at its hang cap cannot prove an empty read', () => {
  assert.throws(() => assertReadUntyped({samples: 1, installed: 1, filled: [], expired: true}), /observer reached its hang cap/);
});

test('a failed checkpoint answers normally and the step assertion reports the failure', async () => {
  for (const sample of [async () => false, async () => { throw new Error('socket failed'); }]) {
    const watch = {sample, seen: {samples: 1, installed: 1, filled: []}};
    await assert.doesNotReject(() => sampleBeforeClose(watch));
    assert.throws(() => assertReadUntyped(watch.seen), /pre-close form read never acknowledged/);
  }
});

test('snapshots drain consumed writes so a persistent fill produces linear evidence', () => {
  const {boxes, snapshot} = fakePage();
  snapshot();
  boxes[0].value = 'sticky';
  let count = 0;
  for (let i = 0; i < 100; i += 1) {
    const report = snapshot();
    assert.ok(report.filled.length <= 2);
    count += report.filled.length;
  }
  assert.equal(count, 101);
  boxes[0].value = '';
  assert.deepEqual(snapshot().filled, []);
});
