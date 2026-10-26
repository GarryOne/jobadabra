// A connect button that waits for a browser sign-in turns into "Cancel sign-in" and is usable again after it, instead of staying disabled up to 5 minutes (owner, 26 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {signInWait} from '../renderer/sign-in-wait.js';

const fakeButton = () => Object.assign(new EventTarget(), {textContent: 'Connect Google', disabled: false, busy: null,
  setAttribute(name, value) { if (name === 'aria-busy') this.busy = value; }, removeAttribute(name) { if (name === 'aria-busy') this.busy = null; }});
const press = button => button.dispatchEvent(new Event('click', {cancelable: true}));

test('a sign-in that never returns: Cancel ends it and the button is usable again', async () => {
  const button = fakeButton();
  let release, started = 0, opened = 0;
  const wait = signInWait(button, () => release({ok: false, error: 'Cancelled.'}));
  button.addEventListener('click', () => { opened++; });
  const first = wait(() => { started++; return new Promise(resolve => { release = resolve; }); });
  assert.equal(button.textContent, 'Cancel sign-in');
  assert.equal(button.disabled, false);
  assert.equal(button.busy, 'true', 'the spinner is inside the button');
  press(button);                       // Cancel
  assert.deepEqual(await first, {ok: false, error: 'Cancelled.'});
  assert.equal(opened, 0, 'the press while waiting never reaches the connect handler');
  assert.equal(button.textContent, 'Connect Google');
  assert.equal(button.busy, null);
  assert.equal(button.disabled, false);
  press(button);
  assert.equal(opened, 1, 'after Cancel the button connects again');
  assert.equal(started, 1);
});

test('a second start while one waits never starts a second sign-in', async () => {
  const button = fakeButton();
  let release, started = 0;
  const wait = signInWait(button, () => release({ok: true}));
  const first = wait(() => { started++; return new Promise(resolve => { release = resolve; }); });
  const second = await wait(() => { started++; return {ok: true}; });
  assert.equal(second.ok, false);
  assert.equal(started, 1);
  release({ok: true});
  await first;
});

// The class: every renderer call that waits for a browser sign-in goes through signInWait.
const renderer = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const sources = (dir => fs.readdirSync(dir, {recursive: true}).filter(f => String(f).endsWith('.js')).map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]))(renderer);

test('every Google/Notion browser sign-in call is behind the Cancel button', () => {
  const calls = [];
  for (const [file, source] of sources) {
    source.split('\n').forEach((line, index) => {
      if (/window\.pilot\.(googleConnect|notionOAuth)\(/.test(line)) calls.push({file, index, line});
    });
  }
  assert.ok(calls.length >= 3, `found ${calls.length} sign-in calls`);
  for (const {file, line} of calls) assert.match(line, /\bwait\w*\(\(\) => window\.pilot\./, `${file}: ${line.trim()}`);
});
