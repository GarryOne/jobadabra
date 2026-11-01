// ladder-capture.mjs --from-candidates, end to end in a bare headless Chromium (no extension, no app, network blocked): a failed candidate of the pool run becomes a scrubbed pending fixture; a passed one is skipped.
// Skipped when Chromium is not installed (a CI box without browsers). Pure parts: desktop/test/ladder-candidates.test.js.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const e2e = path.resolve(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..');
let browser = false;
try { const {chromium} = await import('playwright-core'); browser = fs.existsSync(chromium.executablePath()); } catch { /* no playwright */ }

test('a failed candidate becomes a scrubbed pending fixture, a passed one is left out', {skip: !browser && 'no Chromium installed'}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-cand-e2e-')), out = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-fix-out-'));
  const put = (name, reached) => {
    const dir = path.join(root, '2026-10-10', name); fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'page.html'), '<!doctype html><html lang="de"><head><title>Job</title></head><body><main><h1>Verkäufer</h1><p>Fragen an jane.doe@acme.example.org, Tel. 044 555 66 77.</p><a href="https://apply.example.net/go?token=s3cret" role="button">Jetzt bewerben</a></main></body></html>');
    fs.writeFileSync(path.join(dir, 'case.json'), JSON.stringify({shape: `${name}: shape`, pages: [{url: 'https://www.example.org/jobs/1?token=abc', file: 'page.html'}], run: {day: '2026-10-10', reached, path: [{kind: 'posting', host: 'www.example.org'}]}}));
  };
  put('stuck-one', 'posting'); put('passed-one', 'form');
  const run = spawnSync('node', ['ladder-capture.mjs', '--from-candidates', '--candidates-dir', root, '--dir', out], {cwd: e2e, encoding: 'utf8', timeout: 120000});
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(fs.readdirSync(out), ['cand-stuck-one.json']);
  const fixture = JSON.parse(fs.readFileSync(path.join(out, 'cand-stuck-one.json'), 'utf8'));
  assert.deepEqual([fixture.source, fixture.expect, fixture.lang, fixture.sketch.url], ['captured', {outcome: 'pending'}, 'de', 'https://www.example.org/jobs/1']);
  assert.ok(fixture.candidates.length >= 2 && fixture.candidates.some(item => item.kind === 'email' && item.text.includes('contact@example.com')));
  assert.ok(!/jane\.doe|555|s3cret|token=/.test(JSON.stringify(fixture)));
  assert.ok(fixture.candidates.some(item => item.text === 'Jetzt bewerben' && item.host === 'apply.example.net'), 'the link keeps its host, never its address');
});
