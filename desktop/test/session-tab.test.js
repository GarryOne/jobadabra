// Which tab is a session's: one function, no guessing (spec docs/superpowers/specs/2026-10-12-tab-owned.md, matrix rows 4, 5, 6, 8, 9).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {markedSession, tabOfSession, sessionsNamedIn} from '../lib/session-tab.js';
import {parseMark} from '../../extension/tab-pages.js';
import * as review from '../lib/review.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const posting = n => `https://forms.example/employer-${n}/job`;
const sessions = [1, 2, 3, 4].map(n => ({id: `s${n}`, company: `Employer ${n}`, url: posting(n), status: 'running'}));

test('the app and the extension read the same mark', () => {
  for (const url of ['https://a.test/x#jobadabra-fill=ab12', 'https://a.test/x#jobadabra-fill', 'https://a.test/x', 'https://a.test/x#jobadabra-fill=a b']) {
    assert.equal(markedSession(url), parseMark(url), url);
  }
});

test('row 4, the person\'s own tab of the same job: never a session\'s tab', () => {
  const tabs = [{id: 9, url: posting(1)}, {id: 10, url: `${posting(1)}/application`, title: 'Employer 1'}];
  assert.equal(tabOfSession('s1', tabs), null);
  assert.equal(tabOfSession('s1', tabs, ''), null);
});

test('row 6, four open forms and an unowned sign-in tab: each session gets its own tab, the sign-in one goes to nobody', () => {
  const signin = {id: 101, url: 'https://accounts.example/#jobadabra-fill', title: 'Sign in'};   // armed, no session in it: nobody\'s
  const forms = sessions.map((session, n) => ({id: 102 + n, url: `${session.url}/application#jobadabra-fill=${session.id}`, title: session.company}));
  for (const [n, session] of sessions.entries()) assert.equal(tabOfSession(session.id, [signin, ...forms]), forms[n]);
  assert.equal(tabOfSession('s5', [signin, ...forms]), null);
  assert.equal(tabOfSession('s3', [signin, forms[0]], 999), null, 'a closed tab: none, never the sign-in tab');
});

test('the bound tab id wins over an address, and an id from another run or browser is not passed at all', () => {
  const tabs = [{id: 5, url: 'https://x.test/a'}, {id: 6, url: 'https://x.test/b#jobadabra-fill=s1'}];
  assert.equal(tabOfSession('s1', tabs, 5).id, 5);
  assert.equal(tabOfSession('s1', tabs, '').id, 6);
});

test('row 5, a second browser: its tab ids only bind in its own run, so another run\'s id reaches the picker as none', () => {
  review._reset();
  review.report([sessions[0]], {session: 's1', tab: 7, boot: 'run-a', url: `${posting(1)}#jobadabra-fill=s1`, total: 1, left: 0});
  assert.equal(review.tabOf('s1', 'run-a'), 7);
  assert.equal(review.tabOf('s1', 'run-b'), '', 'another browser run: tab 7 there is some other page');
});

// 4/4, beta 41162490590 (#43, 31 Oct 2026): the person's form for a job was open in Chrome (session s1); a read of the same job in the hidden browser carried a read id that
// is no session, so the job address matched it to s1: s1 moved to the hidden tab, its pending commands went there, and the read became s1's fill. A job match never crosses runs.
test('row 5, a read of the same job in another browser run never takes the session, its commands or its tab', () => {
  review._reset();
  const binds = [];
  review.onBind(bind => binds.push(bind));
  const own = {session: 's1', tab: 7, boot: 'run-a', url: `${posting(1)}#jobadabra-fill=s1`, job: posting(1), total: 1, left: 0};
  assert.equal(review.report([sessions[0]], own).matched, 's1');
  review.noteTabs({ids: [7], boot: 'run-a', browser: 'chrome'});   // the person's Chrome reports its tabs every 30 s: its run is live
  review.noteTabs({ids: [130], boot: 'run-b', browser: 'hidden'});
  review.queueFill('s1', 'Phone', '123');
  const read = {session: 'tr1a2b3c4d', tab: 130, boot: 'run-b', url: `${posting(1)}#jobadabra-fill=tr1a2b3c4d`, job: posting(1), total: 0, left: 0};
  const answer = review.report([sessions[0]], read);
  assert.equal(answer.matched, null, 'the read is nobody\'s application');
  assert.deepEqual(answer.commands, [], 's1\'s pending fill is not handed to the read');
  assert.equal(review.tabOf('s1', 'run-a'), 7, 's1 keeps its tab in its own run');
  assert.equal(review.sessionOfTab(130, 'run-b'), '');
  assert.deepEqual(binds.map(bind => bind.tab), [7], 'no second bind');
  assert.deepEqual(review.report([sessions[0]], own).commands, [{fill: {label: 'Phone', value: '123'}}], 'the person\'s own tab still gets it');
  // The tab's own session mark still binds, in any run (Chrome restarted and the app reopened the form).
  assert.equal(review.report([sessions[0]], {...read, session: 's1', url: `${posting(1)}#jobadabra-fill=s1`}).matched, 's1');
  assert.equal(review.tabOf('s1', 'run-b'), 130);
});

// Gitar on #2747: after a Chrome restart the old run is dead, so a report by the job address alone (the address lost its mark) rebinds the session, as before.
test('row 5, a restarted Chrome: the old run holds nothing, so a job address alone rebinds the session', () => {
  review._reset();
  const own = {session: 's1', tab: 7, boot: 'run-a', url: `${posting(1)}#jobadabra-fill=s1`, job: posting(1), total: 1, left: 0};
  review.report([sessions[0]], own);
  review.noteTabs({ids: [7], boot: 'run-a', browser: 'chrome'});
  review.noteTabs({ids: [9], boot: 'run-c', browser: 'chrome'});   // the same browser started again: a new run replaces the old one
  assert.equal(review.report([sessions[0]], {tab: 9, boot: 'run-c', url: posting(1), job: posting(1), total: 1, left: 0}).matched, 's1');
  assert.equal(review.tabOf('s1', 'run-c'), 9);
});

test('row 8, the app restarts: the bound tab id is read back from the saved state', () => {
  review._reset();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-st-')), 'states.json');
  review.persist(file, ['s1']);
  review.report([sessions[0]], {session: 's1', tab: 7, boot: 'run-a', url: `${posting(1)}#jobadabra-fill=s1`, total: 1, left: 0});
  review._reset(); review.persist(file, ['s1']);
  assert.equal(review.tabOf('s1', 'run-a'), 7);
});

test('a restored tab not yet re-bound is open by its mark alone', () => {
  assert.deepEqual([...sessionsNamedIn(sessions, [`${posting(2)}#jobadabra-fill=s2`, posting(3)])], ['s2']);
});

// The class: no file picks a tab by guessing.
test('row 9, nothing outside the picker scores, matches or "finds the only" tab', () => {
  const banned = /\b(scoreTab|chooseTab|pickTab|markedTab|ownTabOf|withOpenForm|reloadTarget|mergeTabs|matchSession|freeSession)\b/;
  const files = fs.readdirSync(path.join(here, '..', 'lib')).filter(name => name.endsWith('.js')).map(name => path.join(here, '..', 'lib', name));
  files.push(path.join(here, '..', 'main.js'));
  for (const file of files) {
    const hit = fs.readFileSync(file, 'utf8').split('\n').findIndex(line => banned.test(line.replace(/\/\/.*$/, '')));
    assert.equal(hit, -1, `${path.basename(file)}:${hit + 1} picks a tab by guessing; use lib/session-tab.js`);
  }
});

test('a session with a tab Chrome shows right now is open, by its bound id or the id in its address; nothing else counts', async () => {
  const {sessionsWithTab} = await import('../lib/session-tab.js');
  const tabs = [{id: 5, url: 'https://x.test/a'}, {id: 6, url: 'https://x.test/b#jobadabra-fill=s2'}, {id: 7, url: `${posting(3)}`}];
  const bound = {s1: 5, s2: '', s3: '', s4: 99};
  assert.deepEqual([...sessionsWithTab(sessions, tabs, id => bound[id] ?? '')].sort(), ['s1', 's2']);   // s3's posting tab has no id or mark: the person's own tab; s4's tab is gone
  assert.deepEqual([...sessionsWithTab(sessions, null, () => '')], []);
});
