// "Look around first" (lib/demo.js): the demo folder, the restart arguments in and out, what demo mode refuses,
// and that the packaged app carries demo/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as demo from '../lib/demo.js';
import * as pipeline from '../lib/pipeline.js';
import {lookAround} from '../lib/setup-funnel.js';

const here = path.resolve(import.meta.dirname, '..');
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-demo-test-'));

test('the packaged app includes demo/ (the look-around and the demo mode read it)', () => {
  const files = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')).build.files;
  assert.ok(files.includes('demo/**'));
  for (const name of ['settings.json', 'secrets.json', 'jobs.json', 'focus.json']) assert.ok(fs.existsSync(path.join(here, 'demo', name)), name);
});

test('prepare: a fresh copy of demo/ in the temp folder, jobs.json left in the app, older copies removed', () => {
  const tmp = scratch();
  const old = fs.mkdtempSync(path.join(tmp, demo.PREFIX));
  fs.mkdirSync(path.join(tmp, 'other-app'));
  const folder = demo.prepare(path.join(here, 'demo'), tmp);
  assert.equal(path.dirname(folder), tmp);
  assert.ok(path.basename(folder).startsWith(demo.PREFIX));
  assert.ok(!fs.existsSync(old), 'the earlier demo copy is gone');
  assert.ok(fs.existsSync(path.join(tmp, 'other-app')), 'nothing else is touched');
  const copied = fs.readdirSync(folder).sort();
  const expected = fs.readdirSync(path.join(here, 'demo')).filter(name => name !== 'jobs.json').sort();
  assert.deepEqual(copied, expected);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'settings.json'), 'utf8')).setupDone, true);
  fs.rmSync(tmp, {recursive: true, force: true});
});

test('the flag is only taken for a demo folder in the temp folder, never the real data folder', () => {
  const tmp = scratch();
  const folder = path.join(tmp, `${demo.PREFIX}abc`);
  assert.equal(demo.folderFrom(['/Applications/Job Pilotto.app/Contents/MacOS/Job Pilotto', `${demo.FLAG}=${folder}`], tmp), folder);
  assert.equal(demo.folderFrom(['app'], tmp), null);
  assert.equal(demo.folderFrom(['app', `${demo.FLAG}=${path.join(os.homedir(), 'Library', 'Application Support', 'Job Pilotto')}`], tmp), null);
  assert.equal(demo.folderFrom(['app', `${demo.FLAG}=${path.join(tmp, 'other')}`], tmp), null);
  assert.equal(demo.folderFrom(['app', `${demo.FLAG}=${path.join(tmp, `${demo.PREFIX}x`, '..', '..', 'x')}`], tmp), null);
  assert.equal(demo.folderFrom(['app', `${demo.FLAG}=relative/${demo.PREFIX}x`], tmp), null);
  fs.rmSync(tmp, {recursive: true, force: true});
});

test('restart arguments: into the demo adds the flag; back out removes it; the rest stays (packaged and npm start)', () => {
  const folder = path.join(os.tmpdir(), `${demo.PREFIX}abc`);
  assert.deepEqual(demo.restartArgs(['/Applications/Job Pilotto.app/Contents/MacOS/Job Pilotto'], folder), [`${demo.FLAG}=${folder}`]);
  assert.deepEqual(demo.restartArgs(['C:\\Users\\A B\\Job Pilotto.exe'], folder), [`${demo.FLAG}=${folder}`]);
  assert.deepEqual(demo.restartArgs(['/x/electron', '.'], folder), ['.', `${demo.FLAG}=${folder}`]);
  const inDemo = ['/x/electron', '.', `${demo.FLAG}=${folder}`];
  assert.deepEqual(demo.restartArgs(inDemo), ['.']);
  assert.deepEqual(demo.restartArgs(['/x/electron', `${demo.FLAG}=${folder}`, '.'], folder), ['.', `${demo.FLAG}=${folder}`], 'never two flags');
});

test('demo mode answers the outside-reaching actions without running them', async () => {
  const registered = {};
  const logged = [];
  const handle = demo.guard((name, listener) => { registered[name] = listener; }, (area, text, fields) => logged.push([area, text, fields.name]));
  let ran = 0;
  for (const name of ['notionOAuth', 'checkMail', 'applyWithClaude', 'telegramConnect', 'lookAround', 'jobs']) handle(name, () => { ran++; return 'real'; });
  assert.deepEqual(await registered.notionOAuth(), {ok: false, error: demo.TEXT, text: demo.TEXT});
  assert.equal((await registered.checkMail()).ok, false);
  assert.equal((await registered.applyWithClaude()).ok, false);
  assert.equal((await registered.lookAround()).ok, false, 'no demo inside the demo');
  assert.equal(registered.jobs(), 'real', 'reading the demo data still works');
  assert.equal(ran, 1);
  assert.deepEqual(logged.map(row => row.slice(2)), [['notionOAuth'], ['checkMail'], ['applyWithClaude'], ['lookAround']], 'each blocked call is logged by name, a reading call is not');
  handle('saveSecret', () => 'real');
  assert.throws(() => registered.saveSecret(), /Demo mode/);
});

test('demo mode: Python runs only the jobs that read the demo folder', async () => {
  assert.equal(demo.pipelineAllowed(['src.desktop', 'strategy']), true);
  assert.equal(demo.pipelineAllowed(['src.desktop', 'posting', 'abc']), true);
  assert.equal(demo.pipelineAllowed(['src.daily']), false);
  assert.equal(demo.pipelineAllowed(['src.sources.google', 'auth']), false);
  pipeline.setDemo(true);
  try {
    const lines = [];
    const result = await pipeline.run({settings: () => { throw new Error('storage must not be read'); }}, ['src.sources.google', 'auth'], line => lines.push(line));
    assert.deepEqual(result, {code: 1, stdout: ''});
    assert.match(lines[0], /Demo mode/);
  } finally { pipeline.setDemo(false); }
});

test('the look-around report: a setup event the funnel does not count as a step', () => {
  const event = lookAround('cv', {firstRunAt: '2026-09-30T10:00:00Z'}, Date.parse('2026-09-30T10:05:00Z'));
  assert.deepEqual(event, {step: 'look_around', from: 'cv', minutes: 5});
  assert.equal(lookAround('<script>', {}).from, 'other');
  assert.equal(lookAround('welcome', {}).minutes, null);
});

test('the wizard offers the demo on Welcome (Notion is no longer a step), and the demo banner is there', () => {
  const html = fs.readFileSync(path.join(here, 'renderer', 'index.html'), 'utf8');
  const step = name => html.slice(html.indexOf(`<div class="step" data-step="${name}">`), html.indexOf('<div class="step"', html.indexOf(`<div class="step" data-step="${name}">`) + 10));
  assert.match(step('welcome'), /data-look-around="welcome"[^>]*>Look around first \(demo data\)</);
  assert.ok(!html.includes('data-step="notion"'));
  assert.match(html, /id="demo-banner"[^>]*hidden/);
  assert.match(html, /nothing is real, nothing is sent/);
  assert.match(html, /id="demo-leave">Set up my own</);
});

test('the demo Focus shows a follow-up card: your message unanswered, its chat and Done', () => {
  const {items} = JSON.parse(fs.readFileSync(path.join(here, 'demo', 'focus.json'), 'utf8'));
  const item = items.find(one => one.kind === 'follow_up');
  assert.ok(item, 'a follow_up item');
  assert.equal(item.headline, `Follow up with ${item.company}`);
  assert.match(item.detail, /^You wrote \w{3} \d{1,2} \w{3} \(\d+ days ago\), no reply yet\.$/);
  assert.ok(item.link && item.link_label && item.done && item.page_id);
  const focusPage = fs.readFileSync(path.join(here, 'renderer', 'pages', 'focus.js'), 'utf8');
  assert.match(focusPage, /item\.kind === 'follow_up' \? 'followed_up' : 'replied'/, 'Done logs your follow-up, which re-arms it');
});
