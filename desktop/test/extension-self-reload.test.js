// The extension reloads itself when the app reports a newer version (extension/tab-report.js); the hidden browser's copy must never, because Chrome disables a reloaded
// unpacked extension when developer mode is off (measured 28 Oct 2026: reason 16777216, location 4 instead of 8) and Background automation then fills nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {mayReloadSelf} from '../../extension/self-reload.js';

const newer = (a, b) => {
  const [x, y] = [a, b].map(v => String(v || '0').split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
const idle = {newer, owned: false, busy: false};

test('a normal copy reloads once for a newer version, never while it is busy, never twice for one version', () => {
  assert.equal(mayReloadSelf({...idle, latest: '0.9.431', running: '0.9'}), true);
  assert.equal(mayReloadSelf({...idle, latest: '0.9.431', running: '0.9', busy: true}), false);
  assert.equal(mayReloadSelf({...idle, latest: '0.9.431', running: '0.9', reloadedFor: '0.9.431'}), false);
  assert.equal(mayReloadSelf({...idle, latest: '0.9', running: '0.9'}), false);
  assert.equal(mayReloadSelf({...idle, latest: '', running: '0.9'}), false);
});

test('the hidden browser\'s copy never reloads itself, whatever version the app reports', () => {
  assert.equal(mayReloadSelf({...idle, owned: true, latest: '0.9.431', running: '0.9'}), false, 'a development checkout reports a stamped version above the copy\'s base 0.9');
  assert.equal(mayReloadSelf({...idle, owned: true, latest: '1.0', running: '0.9'}), false);
  assert.equal(mayReloadSelf({...idle, owned: true, panel: true}), false, 'the panel\'s Reload button too');
  assert.equal(mayReloadSelf({...idle, panel: true}), true, 'a normal copy still reloads when the person presses Reload');
});

test('tab-report.js asks the helper at both places it reloads, with the owned flag the copy installs', () => {
  const report = fs.readFileSync(new URL('../../extension/tab-report.js', import.meta.url), 'utf8');
  assert.match(report, /import \{mayReloadSelf\} from '\.\/self-reload\.js';/);
  assert.equal((report.match(/chrome\.runtime\.reload\(\)/g) || []).length, 2, 'two reload calls, each behind the helper');
  assert.equal((report.match(/mayReloadSelf\(/g) || []).length, 2);
  const copy = fs.readFileSync(new URL('../../hosted/ready-fill/extension-copy.mjs', import.meta.url), 'utf8');
  assert.match(copy, /globalThis\.__jobPilottoBackgroundOwned = true/, 'the flag the helper reads is the one the owned copy sets');
});
