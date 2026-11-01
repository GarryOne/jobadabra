// Apply with no browser installed (#520), registered by journeys.test.js so the shared scenario file stays within its size limit: no form session is left behind.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as terminals from '../lib/terminals.js';
import * as apply from '../lib/apply.js';
import {createStorage} from '../lib/storage.js';

const storageOf = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), {encrypt: v => Buffer.from(v).reverse().toString('base64'), decrypt: s => Buffer.from(s, 'base64').reverse().toString()});

// #520: start() made a form session per job and then found no browser: the sessions stayed in the Applying page with no tab (applyOne already removes its own).
test('scenario: Apply to N jobs with no browser installed leaves no form session behind in Applying (#520)', async () => {
  const real = process.platform, home = {HOME: process.env.HOME, LOCALAPPDATA: process.env.LOCALAPPDATA, ProgramFiles: process.env.ProgramFiles, 'ProgramFiles(x86)': process.env['ProgramFiles(x86)']};
  process.env.HOME = process.env.LOCALAPPDATA = process.env.ProgramFiles = process.env['ProgramFiles(x86)'] = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-home-'));   // a Windows runner has Chrome under Program Files   // the launcher reads a browser's profile folder: never the owner's
  Object.defineProperty(process, 'platform', {value: 'win32'});   // the only launcher that returns null when no browser is installed
  const before = terminals.list().map(s => s.id);
  try {
    const result = await apply.start(storageOf(), {n: 1, mode: 'chrome'}, () => ({unref() {}}),
      async () => ({jobs: [{url: 'https://jobs.example.test/nochrome-520', status: 'saved', fit: 60, title: 'SRE', company: 'A', kit: true}]}));
    assert.equal(result.ok, false);
    assert.match(result.error, /No supported browser/, 'the test must reach the no-browser branch');
    const left = terminals.list().filter(s => !before.includes(s.id));
    left.forEach(s => terminals.remove(s.id));
    assert.deepEqual(left.map(s => s.url), []);
  } finally { Object.defineProperty(process, 'platform', {value: real}); for (const [name, value] of Object.entries(home)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});
