// Optional browser installation uses only a verified official download, preserves the current runtime on error, and reports explicit first-use progress.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {installBackgroundBrowser, findBackgroundBrowser} from '../lib/background-browser-download.js';

test('an explicit runtime install verifies its streamed bytes and reports download/unpack/ready without inspecting system profiles', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-browser-download-')), dir = path.join(work, 'runtime'), steps = [], calls = [];
  const bytes = Buffer.from('fictional browser archive'), digest = createHash('md5').update(bytes).digest('base64');
  const fetchImpl = async url => {
    calls.push(url);
    return url.includes('versions-with-downloads') ? {ok: true, json: async () => ({channels: {Stable: {downloads: {chrome: [{platform: 'linux64', url: 'https://storage.googleapis.com/chrome-for-testing-public/1/linux64/chrome-linux64.zip'}]}}}})}
      : {ok: true, headers: new Headers({'content-length': String(bytes.length), 'x-goog-hash': `md5=${digest}`}), body: (async function* () { yield bytes; })()};
  };
  assert.equal(findBackgroundBrowser(dir, {key: 'linux-x64'}), null);
  assert.equal(calls.length, 0);
  try {
    const file = await installBackgroundBrowser(dir, {key: 'linux-x64', work, fetchImpl, onProgress: row => steps.push(row.step), run: async (_command, args) => {
      const target = args.at(-1); fs.mkdirSync(path.join(target, 'chrome-linux64'), {recursive: true}); fs.writeFileSync(path.join(target, 'chrome-linux64', 'chrome'), 'fictional');
    }});
    assert.equal(file, path.join(dir, 'chrome-linux64', 'chrome'));
    assert.deepEqual(steps, ['checking', 'download', 'unpack', 'ready']);
    assert.equal(calls.length, 2);
  } finally { fs.rmSync(work, {recursive: true, force: true}); }
});

test('a mismatched digest or nonofficial URL cannot replace the runtime', async () => {
  for (const unsafe of [false, true]) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-browser-refused-')), dir = path.join(work, 'runtime');
    fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'keep'), 'old runtime');
    const fetchImpl = async url => url.includes('versions-with-downloads') ? {ok: true, json: async () => ({channels: {Stable: {downloads: {chrome: [{platform: 'linux64', url: unsafe ? 'https://wrong.example/browser.zip' : 'https://storage.googleapis.com/chrome-for-testing-public/1/linux64/chrome-linux64.zip'}]}}}})}
      : {ok: true, headers: new Headers({'x-goog-hash': 'md5=wrong'}), body: (async function* () { yield Buffer.from('changed'); })()};
    try {
      await assert.rejects(installBackgroundBrowser(dir, {key: 'linux-x64', work, fetchImpl, run: async () => { throw new Error('must not unpack'); }}), unsafe ? /address/ : /integrity digest/);
      assert.equal(fs.readFileSync(path.join(dir, 'keep'), 'utf8'), 'old runtime');
    } finally { fs.rmSync(work, {recursive: true, force: true}); }
  }
});

test("Jobadabra's browser is an add-on: nothing downloads until start, its steps reach the window, Cancel leaves it cancelled", async () => {
  const {backgroundBrowserAddon} = await import('../lib/background-browser-download.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-browser-addon-')), storage = {path: name => path.join(root, name)}, events = [];
  let installs = 0;
  const install = (dir, {signal, onProgress}) => { installs++; onProgress({step: 'download', share: 0.5}); return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))); };
  try {
    const addon = backgroundBrowserAddon(storage, {toWindow: (channel, event) => events.push([channel, event.step]), install, find: () => null});
    assert.deepEqual(addon.state(), {step: 'none'});
    assert.equal(installs, 0);
    const first = addon.start(), second = addon.start();
    assert.equal(first, second);
    addon.cancel();
    assert.equal(await first, null);
    assert.equal(installs, 1);
    assert.deepEqual(events, [['backgroundBrowserProgress', 'download'], ['backgroundBrowserProgress', 'download'], ['backgroundBrowserProgress', 'cancelled']]);
    assert.deepEqual(addon.state(), {step: 'cancelled'});
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
