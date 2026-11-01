// Apply with Claude inside the app: sessions in a (fake) pseudo-terminal, their status from hooks and notify.sh.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as terminals from '../lib/terminals.js';

function fakePty() {
  const spawned = [];
  return {spawned, loader: async () => ({spawn: (file, args, options) => {
    const handlers = {};
    const term = {file, args, options, written: [], killed: false,
      onData: fn => { handlers.data = fn; }, onExit: fn => { handlers.exit = fn; },
      write: data => term.written.push(data), resize: (cols, rows) => { term.size = [cols, rows]; },
      kill: () => { term.killed = true; handlers.exit?.({exitCode: 0}); }, emit: data => handlers.data(data)};
    spawned.push(term);
    return term;
  }})};
}

test('a session runs in a pseudo-terminal, keeps its output and takes your typing', async () => {
  const pty = fakePty();
  terminals.usePty(pty.loader);
  const events = [];
  terminals.onChange((event, payload) => events.push([event, payload.id]));
  const started = await terminals.start({id: 's1', url: 'https://jobs.test/1', title: 'SRE', company: 'Acme', file: '/bin/claude', args: ['--chrome'], cwd: '/tmp', env: {}});
  assert.equal(started.status, 'running');
  pty.spawned[0].emit('hello ');
  pty.spawned[0].emit('world');
  assert.equal(terminals.output('s1'), 'hello world');
  terminals.write('s1', 'yes\r');
  terminals.resize('s1', 100, 30);
  assert.deepEqual([pty.spawned[0].written, pty.spawned[0].size], [['yes\r'], [100, 30]]);
  assert.equal(pty.spawned[0].options.env.TERM, 'xterm-256color');
  assert.deepEqual(events.slice(0, 2), [['update', 's1'], ['data', 's1']]);
  terminals.remove('s1');
});

test('hooks and notify.sh move a session between working, needs you and form filled', async () => {
  terminals.usePty(fakePty().loader);
  await terminals.start({id: 's2', url: 'https://jobs.test/2', file: 'claude', env: {}});
  const transcript = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-t-')), 't.jsonl');
  fs.writeFileSync(transcript, [JSON.stringify({type: 'user', message: {content: 'go'}}),
    JSON.stringify({type: 'assistant', message: {content: [{type: 'text', text: 'The role is on-site in SF. Continue anyway?'}]}})].join('\n'));
  let result = terminals.report('s2', {event: 'stop', transcript});
  assert.deepEqual([result.needsYou, result.session.status, result.session.question], [true, 'input', 'The role is on-site in SF. Continue anyway?']);
  assert.equal(terminals.report('s2', {event: 'stop', transcript}).needsYou, false);  // told once, not at every turn
  result = terminals.report('s2', {event: 'prompt'});
  assert.deepEqual([result.session.status, result.session.question], ['running', '']);
  terminals.report('s2', {event: 'note', message: 'Filling started'});
  assert.equal(terminals.get('s2').note, 'Filling started');
  result = terminals.report('s2', {event: 'note', message: 'Form filled — review and Submit'});
  assert.equal(result.session.status, 'done');
  assert.equal(terminals.report('s2', {event: 'stop'}).session.status, 'done');  // the hand-over turn ends: still done
  assert.equal(terminals.report('nope', {event: 'stop'}).session, null);
  terminals.remove('s2');
});

test('the hooks report to the app on this computer only, for this session', () => {
  const settings = JSON.parse(terminals.hookSettings('ab12', 47111));
  const command = settings.hooks.Stop[0].hooks[0].command;
  assert.match(command, /http:\/\/127\.0\.0\.1:47111\/claude\/session\?id=ab12&event=stop/);
  assert.match(command, /X-Jobadabra: launcher/);
  assert.doesNotMatch(command, /'|\/dev\/null|\|\|/);  // no single quotes or Unix-only redirects: cmd on Windows runs it too
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['Notification', 'Stop', 'UserPromptSubmit']);
});

test('marking a session submitted, then stopping it, is not a crash', async () => {
  let exit;
  terminals.usePty(async () => ({spawn: () => ({
    onData() {}, onExit(fn) { exit = fn; }, kill() { exit({exitCode: 129}); }, write() {}, resize() {},
  })}));
  await terminals.start({id: 'submitted', url: 'https://jobs.test/anthropic', company: 'Anthropic', claudeId: 'abc', file: 'claude', env: {}});
  terminals.setOutcome('submitted', 'submitted');
  terminals.stop('submitted');
  const view = terminals.get('submitted');
  assert.equal(view.outcome, 'submitted');
  assert.equal(view.status, 'ended');
  assert.equal(view.note, 'Submitted');
  assert.equal(view.exitCode, 129);
  assert.equal(view.live, false);
  assert.equal(view.resumable, false);
  terminals.remove('submitted');
});

test('a notification gets one plain sentence: the question if there is one, never markdown or a cut-off start', () => {
  const message = 'Filled 14 of 16 fields. Please check these kit answers before you submit:\n\n' +
    '- **Go/Ruby:** "No" to reading Go or Ruby.\n- **Visa:** "Yes, but not one of the visas listed".\n\nShall I change the visa answer?';
  assert.equal(terminals.briefly(message), 'Shall I change the visa answer?');
  assert.equal(terminals.briefly('**Needs your input**: the CAPTCHA'), 'Needs your input: the CAPTCHA');
  const long = terminals.briefly('word '.repeat(80), 40);
  assert.ok(long.endsWith('…') && long.length <= 41 && !/wor…$/.test(long));
});

// ---- sessions outlive the app ----
const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-sessions-')), 'sessions.json');

test('saved sessions come back after a restart: waiting ones as they were, working ones as stopped, all resumable', async () => {
  const file = tempFile();
  terminals._reset();
  terminals.persist(file);
  const pty = fakePty();
  terminals.usePty(pty.loader);
  await terminals.start({id: 'a1', url: 'https://jobs.test/a', company: 'Acme', claudeId: 'conv-a', file: 'claude', env: {}});
  await terminals.start({id: 'b2', url: 'https://jobs.test/b', company: 'Beta', claudeId: 'conv-b', file: 'claude', env: {}});
  await terminals.start({id: 'c3', url: 'https://jobs.test/c', company: 'Cirrus', file: 'claude', env: {}});  // started before conversations were kept
  pty.spawned[0].emit('filled the form\r\n');
  terminals.report('a1', {event: 'note', message: 'Form filled — review and Submit'});
  terminals.report('b2', {event: 'stop'});
  terminals.report('b2', {event: 'prompt'});  // working again
  assert.equal(terminals.running().length, 3);
  terminals.shutdown();  // the app quits: state saved as it was, processes ended without turning into "stopped"
  assert.ok(pty.spawned.every(term => term.killed));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).find(record => record.id === 'a1').status, 'done');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);  // its output can hold form answers

  terminals._reset();  // the next start
  terminals.persist(file);
  assert.equal(terminals.restore(), 3);
  const [a, b, c] = ['a1', 'b2', 'c3'].map(id => terminals.get(id));
  assert.deepEqual([a.status, a.live, a.resumable, a.company], ['done', false, true, 'Acme']);
  assert.deepEqual([b.status, b.note, b.live, b.resumable], ['ended', 'Stopped when the app closed', false, true]);
  assert.deepEqual([c.live, c.resumable], [false, false]);  // no conversation to reopen
  assert.equal(terminals.output('a1'), 'filled the form\r\n');
  assert.deepEqual(terminals.running(), []);  // nothing runs: the quit warning isn't for these
  terminals.write('a1', 'x');  // typing into a session with no process is ignored
  terminals.stop('a1');
  terminals._reset();
});

test('resume starts Claude again in the same record: a stopped session works again, a finished one stays finished', async () => {
  const file = tempFile();
  terminals._reset();
  terminals.persist(file);
  terminals.usePty(fakePty().loader);
  await terminals.start({id: 'a1', url: 'https://jobs.test/a', claudeId: 'conv-a', file: 'claude', env: {}});
  await terminals.start({id: 'b2', url: 'https://jobs.test/b', claudeId: 'conv-b', file: 'claude', env: {}});
  terminals.report('a1', {event: 'note', message: 'Form filled'});
  terminals.shutdown();
  terminals._reset();
  terminals.persist(file);
  terminals.restore();
  const pty = fakePty();
  terminals.usePty(pty.loader);
  const launch = id => ({file: 'claude', args: ['--resume', terminals.claudeIdOf(id)], cwd: '/repo', env: {}});
  const done = await terminals.resume('a1', launch('a1'));
  assert.deepEqual([done.status, done.live, done.resumable, done.endedAt], ['done', true, false, null]);
  const stopped = await terminals.resume('b2', launch('b2'));
  assert.deepEqual([stopped.status, stopped.note, stopped.live], ['running', 'Resuming…', true]);
  assert.deepEqual(pty.spawned.map(term => term.args), [['--resume', 'conv-a'], ['--resume', 'conv-b']]);
  assert.match(terminals.output('b2'), /resumed/);
  assert.equal((await terminals.resume('b2', launch('b2'))).live, true);  // already running: nothing is started twice
  assert.equal(pty.spawned.length, 2);
  await assert.rejects(terminals.resume('nope', launch('a1')), /no longer in the list/);
  terminals._reset();
});

test('a session ending on its own is still resumable, and older ones than two weeks are dropped', async () => {
  const file = tempFile();
  terminals._reset();
  terminals.persist(file);
  const pty = fakePty();
  terminals.usePty(pty.loader);
  await terminals.start({id: 'x1', url: 'https://jobs.test/x', claudeId: 'conv-x', file: 'claude', env: {}});
  pty.spawned[0].kill();
  assert.deepEqual([terminals.get('x1').status, terminals.get('x1').live, terminals.get('x1').resumable], ['ended', false, true]);
  terminals.saveNow();
  const records = JSON.parse(fs.readFileSync(file, 'utf8'));
  records.push({...records[0], id: 'old', startedAt: '2026-08-01T10:00:00Z'});
  fs.writeFileSync(file, JSON.stringify(records));
  terminals._reset();
  terminals.persist(file);
  assert.equal(terminals.restore(Date.parse('2026-09-29T10:00:00Z')), 1);
  assert.equal(terminals.get('old'), null);
  terminals._reset();
});

test('the log opens on the session\'s screen at its size, not a replay: redraws in place leave only the last frame', async () => {
  const pty = fakePty();
  terminals.usePty(pty.loader);
  await terminals.start({id: 'snap', url: 'https://jobs.test/snap', file: 'claude', env: {}, cols: 80, rows: 10});
  // Claude Code's way: the alternate screen, then each frame drawn over the last from the top.
  pty.spawned[0].emit('\x1b[?1049h\x1b[H\x1b[2JThinking… 1s');
  pty.spawned[0].emit('\x1b[H\x1b[2KForm filled in Chrome.');
  let shot = await terminals.snapshot('snap');
  assert.deepEqual([shot.cols, shot.rows], [80, 10]);
  assert.match(shot.data, /Form filled in Chrome\./);
  assert.doesNotMatch(shot.data, /Thinking/);
  terminals.resize('snap', 100, 20);
  shot = await terminals.snapshot('snap');
  assert.deepEqual([shot.cols, shot.rows], [100, 20]);
  terminals.remove('snap');
});

test('a restored session shows its saved screen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-snap-'));
  const file = path.join(dir, 'sessions.json');
  const pty = fakePty();
  terminals.usePty(pty.loader);
  terminals.persist(file);
  await terminals.start({id: 'kept', url: 'https://jobs.test/kept', file: 'claude', env: {}, cols: 90, rows: 12});
  pty.spawned[0].emit('\x1b[?1049h\x1b[HReview the form in Chrome.');
  await terminals.snapshot('kept');  // parsed
  terminals.saveNow();
  const record = JSON.parse(fs.readFileSync(file, 'utf8')).find(r => r.id === 'kept');
  assert.match(record.screen, /Review the form in Chrome\./);
  assert.deepEqual([record.cols, record.rows], [90, 12]);
  terminals.remove('kept');
  fs.writeFileSync(file, JSON.stringify([{...record, output: 'garbled tail', status: 'done'}]));
  terminals.restore();
  const shot = await terminals.snapshot('kept');
  assert.match(shot.data, /Review the form in Chrome\./);
  assert.deepEqual([shot.cols, shot.rows], [90, 12]);
  terminals.remove('kept');
  terminals.persist(null);
});

test('a Stop reported before the last message reached the transcript: the message is read again once it arrives', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  terminals.usePty(fakePty().loader);
  await terminals.start({id: 'race', url: 'https://jobs.test/race', file: 'claude', env: {}});
  const transcript = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-race-')), 't.jsonl');
  const said = text => JSON.stringify({type: 'assistant', message: {content: [{type: 'text', text}]}});
  fs.writeFileSync(transcript, said('Race is set. Checking the resume shows as attached.'));
  terminals.report('race', {event: 'stop', transcript});
  assert.equal(terminals.get('race').question, 'Race is set. Checking the resume shows as attached.');
  fs.appendFileSync(transcript, '\n' + said('The form is filled in the open Chrome tab, and nothing was submitted.'));
  t.mock.timers.tick(600);
  assert.equal(terminals.get('race').question, 'The form is filled in the open Chrome tab, and nothing was submitted.');
  // Once you reply, a late read doesn't bring the old message back.
  terminals.report('race', {event: 'prompt'});
  t.mock.timers.tick(5000);
  assert.equal(terminals.get('race').question, '');
  terminals.remove('race');
});

test('sessions left by the last run are asked about once: at start, not again, and not once resumed', async () => {
  const file = tempFile();
  terminals._reset();
  terminals.persist(file);
  terminals.usePty(fakePty().loader);
  await terminals.start({id: 'a1', url: 'https://jobs.test/a', claudeId: 'conv-a', file: 'claude', env: {}});
  await terminals.start({id: 'b2', url: 'https://jobs.test/b', claudeId: 'conv-b', file: 'claude', env: {}});
  assert.equal(terminals.get('a1').askAtStart, false);  // running now: nothing to ask
  terminals.shutdown();
  terminals._reset();
  terminals.persist(file);
  terminals.restore();
  assert.deepEqual(terminals.list().map(s => [s.id, s.askAtStart]), [['a1', true], ['b2', true]]);
  terminals.markAsked(['a1']);  // answered (kept, or asked one by one)
  terminals._reset();
  terminals.persist(file);  // next launch
  terminals.restore();
  assert.deepEqual(terminals.list().map(s => [s.id, s.askAtStart]), [['a1', false], ['b2', true]]);  // a1 is not asked again
  terminals.usePty(fakePty().loader);
  await terminals.resume('b2', {file: 'claude', args: [], cwd: '/repo', env: {}});
  assert.equal(terminals.get('b2').askAtStart, false);
  terminals._reset();
});

test('a restored session without its transcript\'s path gets it found by its instructions file, and its last message re-read', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-projects-'));
  fs.mkdirSync(path.join(root, 'repo'));
  const said = text => JSON.stringify({type: 'assistant', message: {content: [{type: 'text', text}]}});
  fs.writeFileSync(path.join(root, 'repo', 'other.jsonl'), JSON.stringify({type: 'user', message: {content: 'Read the file /tmp/x/prompt_zz999999.txt and do exactly what it says.'}}));
  const mine = path.join(root, 'repo', 'mine.jsonl');
  fs.writeFileSync(mine, [JSON.stringify({type: 'user', message: {content: 'Read the file /tmp/x/prompt_12e25e4e.txt and do exactly what it says.'}}),
    said('Race is set. Checking the resume shows as attached.'), said('The form is filled.\n\n- **Needs you:**\n  - ❓ **Maths at high school?** Suggested: "Cannot recall"')].join('\n'));
  assert.equal(terminals.findTranscript('12e25e4e', {root}), mine);
  assert.equal(terminals.findTranscript('00000000', {root}), '');
  assert.equal(terminals.findTranscript('12e25e4e', {root, now: Date.now() + 30 * 86400_000}), '');  // older than two weeks: not looked at

  const file = tempFile();
  fs.writeFileSync(file, JSON.stringify([{id: '12e25e4e', url: 'https://jobs.test/c', status: 'input', startedAt: new Date().toISOString(),
    question: 'Race is set. Checking the resume shows as attached.', output: ''}]));
  terminals._reset();
  terminals.persist(file);
  terminals.restore(Date.now(), {find: id => terminals.findTranscript(id, {root})});
  assert.match(terminals.get('12e25e4e').question, /^The form is filled\.\n\n- \*\*Needs you:\*\*/);
  terminals._reset();
});

test('Esc on a running turn is told apart from a phrase that was already on screen', () => {
  const screen = 'Interrupted · What should Claude do instead?';
  assert.equal(terminals.interruptedIn('working…', screen), true);
  assert.equal(terminals.interruptedIn('Interrupted · What should', ' Claude do instead?'), true);
  assert.equal(terminals.interruptedIn(`${screen}\n> `, 'next reply'), false);
});

test('a resumed Claude repainting an old "Interrupted" line does not pause the session; a real Esc after a prompt does', async () => {
  const pty = fakePty();
  terminals._reset();
  terminals.usePty(pty.loader);
  await terminals.start({id: 'p1', url: 'https://jobs.test/p', file: 'claude', env: {}});
  const screen = 'Interrupted · What should Claude do instead?';
  pty.spawned[0].emit(`history… ${screen}\r\n`);  // the conversation repainted at start: no prompt taken yet
  assert.equal(terminals.get('p1').status, 'running');
  terminals.report('p1', {event: 'prompt'});
  pty.spawned[0].emit('x'.repeat(120));
  pty.spawned[0].emit(`working… ${screen}`);  // Esc on the running turn
  assert.equal(terminals.get('p1').status, 'input');
  terminals._reset();
});

test('a Read with Claude session never needs you, is closed once Claude is done, and stays out of Applying', async () => {
  const pty = fakePty();
  terminals.usePty(pty.loader);
  const started = await terminals.start({id: 'r1', url: 'https://www.linkedin.com/jobs', company: 'LinkedIn', title: 'Read jobs: LinkedIn', kind: 'read', file: 'claude', env: {}});
  assert.equal(started.kind, 'read');
  assert.equal(terminals.report('r1', {event: 'input', message: 'Claude is waiting for your input'}).needsYou, false, 'an idle notice asks nobody');
  const done = terminals.report('r1', {event: 'stop'});
  assert.equal(done.needsYou, false);
  assert.equal(done.session.status, 'done');
  await new Promise(resolve => setTimeout(resolve, 2100));
  assert.equal(pty.spawned[0].killed, true, 'closed: a reply would go nowhere');
  // An application's session, the same events: it waits for you (unchanged).
  await terminals.start({id: 'a9', url: 'https://jobs.test/9', company: 'Acme', file: 'claude', env: {}});
  assert.equal(terminals.report('a9', {event: 'stop'}).needsYou, true);
  const sessions = fs.readFileSync(new URL('../renderer/pages/sessions.js', import.meta.url), 'utf8');
  assert.match(sessions, /const stillOpen = items => \(items \|\| \[\]\)\.filter\(item => !isSubmitted\(item\) && item\.kind !== 'read'\)/, 'Applying\'s one list leaves reads out');
});

// Owner, 8 Oct 2026: the Coop session read "Ended" (the app had closed under Claude) while its form was open and being filled in Chrome.
test('a stopped Claude session whose form tab reports is "Form open in Chrome", kept across a restart; one with an outcome is left alone', () => {
  terminals._reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-inchrome-')), file = path.join(dir, 'sessions.json');
  const startedAt = new Date().toISOString();
  const record = (id, extra = {}) => ({id, kind: 'claude', url: `https://jobs.coop.ch/${id}/`, title: 'Assistant', company: 'Coop Suisse', claudeId: 'c-1',
    status: 'running', note: 'Working…', startedAt, output: '', events: [], ...extra});
  fs.writeFileSync(file, JSON.stringify([record('a094'), record('done1', {outcome: 'submitted', status: 'done'})]));
  terminals.persist(file);
  terminals.restore();
  assert.equal(terminals.get('a094').status, 'ended');                       // the app closed under it
  assert.equal(terminals.formInChrome('a094'), true);
  assert.deepEqual(['status', 'inChrome', 'resumable', 'note'].map(key => terminals.get('a094')[key]), ['done', true, true, 'Form open in Chrome']);
  assert.equal(terminals.formInChrome('a094'), false);                       // once
  assert.equal(terminals.formInChrome('done1'), false);                      // submitted: nothing to reopen
  terminals.saveNow();                                                      // what the app does as it quits
  terminals._reset(); terminals.persist(file); terminals.restore();
  assert.deepEqual([terminals.get('a094').status, terminals.get('a094').inChrome], ['done', true]);
});

test('setAccount keeps the account state of a session and says it only when it changed', async () => {
  const terminals = await import('../lib/terminals.js');
  const seen = [];
  terminals.setListener?.((kind, view) => seen.push([kind, view.accountState]));
  const session = terminals.startForm({id: 'acct1', url: 'https://jobs.example.ch/a/1', title: 'T', company: 'C'});
  assert.equal(terminals.setAccount(session.id, 'confirm'), true);
  assert.equal(terminals.setAccount(session.id, 'confirm'), false);
  assert.equal(terminals.list().find(item => item.id === session.id).accountState, 'confirm');
  assert.equal(terminals.setAccount('nothing', 'created'), false);
});
