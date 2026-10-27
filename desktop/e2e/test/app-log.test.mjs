// The app's log as the tests read it (lib/app-log.mjs). 7 Oct 2026: the app rolled app.log into app-2026-10-07.log at its midnight, mid-step, and a step
// that counted engine starts in app.log alone saw "0 runs" for one click (Windows employers). Every read goes through the reader that sees both.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {appLogLines, rearmedSessions} from '../lib/app-log.mjs';

test('a line rolled into yesterday\'s day file is still read, in order', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'applog-'));
  fs.mkdirSync(path.join(profile, 'logs'));
  fs.writeFileSync(path.join(profile, 'logs', 'app-2026-10-07.log'), '[run] start: python -m src scout (first)\n');
  fs.writeFileSync(path.join(profile, 'logs', 'app.log'), '[run] start: python -m src scout (second)\n');
  const starts = appLogLines(profile).filter(line => /\[run\] start: python -m src scout/.test(line));
  assert.deepEqual(starts.map(line => line.match(/\((\w+)\)/)[1]), ['first', 'second'], 'both days, oldest first');
  assert.deepEqual(appLogLines(fs.mkdtempSync(path.join(os.tmpdir(), 'applog-empty-'))).filter(Boolean), [], 'no log yet: no lines');
});

test('no suite or harness file reads logs/app.log by itself (a midnight roll would hide its lines)', () => {
  const dirs = ['suites', 'lib'].map(dir => new URL(`../${dir}/`, import.meta.url));
  const offenders = [];
  for (const dir of dirs) for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.mjs') || name === 'app-log.mjs') continue;
    const text = fs.readFileSync(new URL(name, dir), 'utf8');
    if (/readFileSync\([^)]*'app\.log'/.test(text) || /readFileSync\(path\.join\([^)]*'logs', 'app\.log'\)/.test(text)) offenders.push(name);
  }
  assert.deepEqual(offenders, []);
});

test('rearmedSessions names each session whose menu was armed again, so a step can tell the first form\'s late re-arm from the next form\'s (main 40508145728)', () => {
  const log = [
    '2026-10-27T13:06:40.266Z [fill] menu armed again with the choice that means the same {"id":"e83f4cb1","field":"Indicatif de pays","times":1}',
    '2026-10-27T13:06:49.206Z [run] start: python -m src.ai.apply_batch --mark-applying https://boards.greenhouse.io/e2e-menus/4001011',
    '2026-10-27T13:06:50.274Z [fill] menu armed again: the field is still empty {"id":"e83f4cb1","field":"Indicatif de pays","times":2}',
  ].join('\n');
  const mark = log.indexOf('[run] start');
  const first = rearmedSessions(log.slice(0, mark));
  assert.deepEqual([...first], ['e83f4cb1']);
  assert.deepEqual([...rearmedSessions(log.slice(mark))].filter(id => !first.has(id)), [], 'the first form\'s 10 s re-arm is not the next form\'s detour');
  assert.deepEqual([...rearmedSessions(`${log}\n[fill] menu armed again with the choice that means the same {"id":"77aa01bc","times":1}`)].sort(), ['77aa01bc', 'e83f4cb1']);
});
