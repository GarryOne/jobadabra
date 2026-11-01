// The evidence bundle of a smoke run (lib/evidence-bundle.mjs): one folder per shape and day holding what a fixer needs to name the blocker without a re-run
// (job-pilotto-cc's post-mortem, 11 Oct 2026: ~40% of every fix was a wrong first guess), and a run that did not finish records and uploads nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {CAPTURE_FILES, evidenceLines, runFinished, saveElectronLeg, writeBundle} from '../../lib/evidence-bundle.mjs';
import {EventEmitter} from 'node:events';
import {WORKER_CONSOLE, keepWorkerConsole} from '../../lib/worker-console.mjs';

const LOG = `2026-10-10T23:22:02.048Z [extension] page kind: posting {"shape":"jobs.hornbach.com/austria/job/*/*|1-2","by":"ai","rung":2,"confidence":0.85,"usd":0,"applyBy":"form","frames":0}
2026-10-10T23:22:02.212Z [extension] fill: page kind: posting {"by":"ai","confidence":0.85,"host":"jobs.hornbach.com","ms":4461,"version":"0.9.184"}
2026-10-10T23:22:02.436Z [extension] fill: pressed the Apply button {"host":"jobs.hornbach.com","label":"Jetzt bewerben (ohne Anmeldung)","tag":"a","version":"0.9.184"}
2026-10-10T23:22:21.465Z [extension] fill: after the press: no form came {"host":"jobs.hornbach.com","openMs":-1,"opens":0,"tabs":1}
2026-10-10T23:22:41.105Z [extension] page kind: posting {"shape":"jobs.hornbach.com/austria/job/*/*|1-2","by":"digest","rung":3,"confidence":0.8,"frames":0,"digest":true}
2026-10-10T23:22:41.110Z [extension] digest: outcome=apply verb=press numbers=[4] press_kind=button dropped=-
2026-10-10T23:22:43.640Z [extension] fill: pressed the control the digest named {"host":"jobs.hornbach.com","label":"Jetzt bewerben (mit Anmeldung)"}
2026-10-10T23:22:51.296Z [extension] page kind: account {"shape":"career5.successfactors.eu/careers|p1-2","by":"ai","rung":2,"confidence":0.93}
2026-10-10T23:22:52.000Z [run] start: python -m src.desktop visit-list {"run_id":"x"}
2026-10-10T23:22:53.000Z [extension] fill: no form on this page {"role":"no-form"}
2026-10-10T23:22:59.000Z [extension] fill: filled the form {"ineligible":false,"aiEligible":false,"forced":"kit","url":"https://x"}`;

test('the four lines that matter: what was asked, the digest answer, what was pressed, where the page went', () => {
  const lines = evidenceLines(LOG);
  assert.deepEqual(Object.keys(lines), ['pageKind', 'digest', 'pressed', 'wentTo', 'verdict']);
  assert.match(lines.verdict[0], /filled the form .*"aiEligible":false,"forced":"kit"/, 'the AI\'s own verdict and what passed it');
  assert.equal(lines.pageKind.length, 3);   // the three decisions, with frames and the digest flag in them
  assert.match(lines.pageKind[1], /by":"digest".*"digest":true/);
  assert.match(lines.digest[0], /digest: outcome=apply verb=press numbers=\[4\]/);
  assert.deepEqual(lines.pressed.map(line => /pressed the Apply button|after the press|pressed the control the digest named/.exec(line)?.[0]),
    ['pressed the Apply button', 'after the press', 'pressed the control the digest named']);
  assert.ok(lines.wentTo.some(line => /page kind: account/.test(line)) && lines.wentTo.some(line => /no form on this page/.test(line)));
  assert.ok(!JSON.stringify(lines).includes('visit-list'), 'an unrelated line');
  assert.ok(Object.values(lines).flat().every(line => line.length <= 320 && !/^\d{4}-/.test(line)), 'a line is cut and shown from its time');
});

test('no log, no lines: empty lists, never a throw', () => {
  assert.deepEqual(evidenceLines(''), {pageKind: [], digest: [], pressed: [], wentTo: [], verdict: []});
  assert.deepEqual(evidenceLines(undefined), {pageKind: [], digest: [], pressed: [], wentTo: [], verdict: []});
});

test('a run that was killed or cut short did not finish: it records and uploads nothing', () => {
  const done = '  live 01:22: watched 90s; frames in 3\n  live: removed 0 job row(s) of the live posting\n';
  assert.equal(runFinished({output: `x\n${done}`, signal: null}), true);
  assert.equal(runFinished({output: `x\n${done}`, signal: 'SIGTERM'}), false);   // killed after it printed
  assert.equal(runFinished({output: 'live 01:22: page kind: posting\n', signal: null}), false);   // cut short: no end of watching (eb's 23 s row)
  assert.equal(runFinished({output: '', signal: null}), false);
});

test('the bundle: one folder per day and shape with the evidence file, the run log, the app log and the AI calls; a missing part is skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-bundle-'));
  const folder = writeBundle({dir, day: '2026-10-11', shape: 'Hornbach SuccessFactors', output: 'run output', appLog: LOG, aiCalls: '[]', result: {reached: 'form', filled: 8, left: 3}});
  assert.equal(folder, path.join(dir, '2026-10-11', 'hornbach-successfactors'));
  assert.deepEqual(fs.readdirSync(folder).sort(), ['ai-calls.json', 'app.log', 'evidence.md', 'run.log']);
  const text = fs.readFileSync(path.join(folder, 'evidence.md'), 'utf8');
  assert.match(text, /Hornbach SuccessFactors/);
  assert.match(text, /reached form, 8 filled, 3 left/);
  for (const part of ['page kind', 'digest', 'pressed', 'where the page went']) assert.match(text.toLowerCase(), new RegExp(part));
  assert.match(text, /after the press: no form came/);
  const lean = writeBundle({dir, day: '2026-10-11', shape: 'No logs', output: 'run output', appLog: '', aiCalls: '', result: {reached: 'posting'}});
  assert.deepEqual(fs.readdirSync(lean).sort(), ['evidence.md', 'run.log']);
});

test('record-sites.mjs: an unfinished run is dropped before anything is recorded or uploaded; a finished one writes its bundle', () => {
  const source = fs.readFileSync(new URL('../../record-sites.mjs', import.meta.url), 'utf8');
  const check = source.indexOf('runFinished('), record = source.indexOf('results[shape] = {url: posting.url, ...parseLive'), bundle = source.indexOf('writeBundle(');
  assert.ok(check > 0 && record > check, 'runFinished must be checked before the result is recorded');
  assert.ok(bundle > record, 'the bundle is written from a finished run');
  assert.match(source, /signal/, 'liveRun passes the exit signal on');
});

// 11 Oct 2026: a fixer and the owner see the final state of the application tab without a live run. One picture a run, kept next to the bundle's other files, never uploaded.
test('the run\'s end-of-run screenshot (LIVE_CAPTURE_DIR/end.png) is kept in the bundle as end.png; with none, nothing is made up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-bundle-')), capture = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cap-'));
  fs.writeFileSync(path.join(capture, 'end.png'), 'png bytes');
  const withShot = writeBundle({dir, day: '2026-10-11', shape: 'With picture', output: 'o', appLog: LOG, result: {reached: 'form'}, captureDir: capture});
  assert.ok(fs.readdirSync(withShot).includes('end.png'));
  assert.match(fs.readFileSync(path.join(withShot, 'evidence.md'), 'utf8'), /end\.png/);
  const without = writeBundle({dir, day: '2026-10-11', shape: 'No picture', output: 'o', appLog: LOG, result: {reached: 'form'}, captureDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cap-'))});
  assert.ok(!fs.readdirSync(without).includes('end.png'));
});

test('both live paths take the end-of-run picture before their last privacy check, so a tripwire hit deletes it with the rest', () => {
  for (const [file, final] of [['../../lib/apply-live.mjs', 'if (trip || (trip = await tripped()))'], ['../../lib/live-row.mjs', 'if (tripped || (tripped = await trip()))']]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8'), shot = source.indexOf('takeEndShot('), last = source.indexOf(final);
    assert.ok(shot > 0 && last > shot, `${file}: the end picture is taken before the final tripwire check`);
  }
});

test('takeEndShot photographs the last http tab into end.png and says why when it cannot (owner, 11 Oct 2026: the end picture is a must)', async () => {
  const {takeEndShot} = await import('../../lib/end-shot.mjs');
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-shot-')), 'cap');
  const tab = (url, shoot = file => fs.writeFileSync(file, 'png')) => ({url: () => url, screenshot: async ({path: file}) => shoot(file)});
  assert.deepEqual(await takeEndShot({pages: () => [tab('chrome-extension://x/options'), tab('https://a.example/apply')]}, dir), {file: path.join(dir, 'end.png'), why: ''});
  assert.ok(fs.existsSync(path.join(dir, 'end.png')));
  assert.match((await takeEndShot({pages: () => [tab('chrome-extension://x/options')]}, path.join(dir, 'none'))).why, /no page tab/);
  assert.match((await takeEndShot({pages: () => [tab('https://a.example/apply', () => { throw new Error('page crashed'); })]}, path.join(dir, 'bad'))).why, /page crashed/);
  assert.match((await takeEndShot({pages: () => [tab('https://a.example/apply')]}, '')).why, /no capture folder/);
});

test('both live paths say it out loud: "end screenshot kept" or "no end screenshot: <why>"', () => {
  for (const file of ['../../lib/apply-live.mjs', '../../lib/live-row.mjs']) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /endShotLine\(shot\)/, file);   // the one wording, lib/end-shot.mjs
  }
  const words = fs.readFileSync(new URL('../../lib/end-shot.mjs', import.meta.url), 'utf8');
  assert.match(words, /end screenshot kept/); assert.match(words, /no end screenshot: \$\{/);
});

test('the Electron leg keeps its run log, app log and end picture beside the plain bundle; a leg that got nowhere keeps just its log', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-electron-leg-')), capture = path.join(tmp, 'capture');
  fs.mkdirSync(capture);
  fs.writeFileSync(path.join(capture, 'app.log'), 'APP'); fs.writeFileSync(path.join(capture, 'end.png'), 'PNG');
  const folder = saveElectronLeg({dir: path.join(tmp, 'evidence'), day: '2026-10-11', shape: 'no-form@career.hm.com', output: 'OUT', captureDir: capture});
  assert.equal(path.basename(folder), 'electron');
  assert.deepEqual(fs.readdirSync(folder).sort(), ['app.log', 'end.png', 'run.log']);
  const bare = saveElectronLeg({dir: path.join(tmp, 'evidence'), day: '2026-10-12', shape: 'x', output: 'OUT', captureDir: path.join(tmp, 'none')});
  assert.deepEqual(fs.readdirSync(bare), ['run.log']);
  fs.rmSync(tmp, {recursive: true, force: true});
});

test('shotTab: a replay row\'s tab goes to the named file; no tab or a failing shot says why', async () => {
  const {shotTab} = await import('../../lib/end-shot.mjs');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-shot-')), 'end-replay.png');
  assert.deepEqual(await shotTab({screenshot: async ({path: out}) => fs.writeFileSync(out, 'png')}, file), {file, why: ''});
  assert.match((await shotTab(null, file)).why, /no page tab/);
  assert.match((await shotTab({screenshot: async () => { throw new Error('closed'); }}, file + '2')).why, /closed/);
});

test('row-replay takes its end picture of the row\'s tab (the replay twin of the live end.png) and row.mjs says where it is or why not', () => {
  const replay = fs.readFileSync(new URL('../../lib/row-replay.mjs', import.meta.url), 'utf8'), row = fs.readFileSync(new URL('../../row.mjs', import.meta.url), 'utf8');
  assert.match(replay, /shotTab\(tab, path\.join\(shotDir \|\| caseDir, shotName\)/);
  assert.match(row, /end screenshot/);
  assert.match(row, /no end screenshot: \$\{/);
});

// 12 Oct 2026 (HelloFresh pair): the Electron leg's fill hung and its bundle had no ai-calls.json and neither leg kept the extension's own console, so where it hung
// could not be read. The class: every capture file a fixer reads is kept by BOTH bundle writers (the plain run's and the Electron leg's).
test('both bundle writers keep every capture file: the app log, the AI calls and the extension\'s console', () => {
  assert.deepEqual([...CAPTURE_FILES].sort(), ['ai-calls.json', 'app.log', WORKER_CONSOLE].sort());
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-capture-files-')), capture = path.join(tmp, 'capture');
  fs.mkdirSync(capture);
  for (const name of CAPTURE_FILES) fs.writeFileSync(path.join(capture, name), name === 'ai-calls.json' ? '[]' : name);
  const plain = writeBundle({dir: path.join(tmp, 'evidence'), day: '2026-10-12', shape: 'row', output: 'OUT', appLog: 'app.log', aiCalls: '[]', captureDir: capture});
  const electron = saveElectronLeg({dir: path.join(tmp, 'evidence'), day: '2026-10-12', shape: 'row', output: 'OUT', captureDir: capture});
  for (const [writer, folder] of [['plain', plain], ['electron', electron]]) {
    for (const name of CAPTURE_FILES) assert.ok(fs.existsSync(path.join(folder, name)), `${writer} keeps ${name}`);
  }
  fs.rmSync(tmp, {recursive: true, force: true});
});

test('the extension\'s service-worker console is kept from the worker already running and from a restarted one; nothing heard writes no file', () => {
  const message = (type, text) => ({type: () => type, text: () => text});
  const first = new EventEmitter(), second = new EventEmitter(), context = new EventEmitter();
  context.serviceWorkers = () => [first];
  const kept = keepWorkerConsole(context, {now: () => Date.UTC(2026, 9, 12, 9, 41, 50)});
  first.emit('console', message('log', 'fill: waiting on the menu'));
  context.emit('serviceworker', second);   // the worker restarted ("worker started in a new browser run")
  second.emit('console', message('error', 'Uncaught (in promise) x'));
  assert.deepEqual(kept.lines(), ['2026-10-12T09:41:50.000Z log fill: waiting on the menu', '2026-10-12T09:41:50.000Z error Uncaught (in promise) x']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-worker-console-'));
  assert.equal(kept.write(dir), path.join(dir, WORKER_CONSOLE));
  assert.match(fs.readFileSync(path.join(dir, WORKER_CONSOLE), 'utf8'), /error Uncaught/);
  const quiet = keepWorkerConsole(Object.assign(new EventEmitter(), {serviceWorkers: () => []})), empty = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-worker-console-'));
  assert.equal(quiet.write(empty), '');
  assert.deepEqual(fs.readdirSync(empty), []);
});

test('both live legs keep the extension\'s console in their capture folder', () => {
  for (const file of ['../../lib/apply-live.mjs', '../../lib/live-row.mjs']) assert.match(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), /keepWorkerConsole\(/, file);
});
