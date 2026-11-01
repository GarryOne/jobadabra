// The class of #43 / #2747 / #2753: a report from a tab in the hidden browser (a read of a job, `#jobadabra-fill=tr<8 hex>`) is never matched to the person's session of the
// same job in real Chrome by the job address. One loop plays that scene against EVERY matcher that can fall back to a job address (the list below is the class: a new matcher
// is added here, and the scan at the end fails when a file outside the list matches a session by a job address). Real review.js, journey-identity.js, session-flow.js and terminals.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import * as apply from '../lib/apply.js';
import * as review from '../lib/review.js';
import * as terminals from '../lib/terminals.js';
import {createSessionFlow} from '../lib/session-flow.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const JOB = 'https://www.jobs.ch/en/vacancies/detail/manor/';
const settle = () => new Promise(resolve => setImmediate(resolve));

/** The person's form of JOB open in Chrome (session s1, run-a, tab 7), a Claude session on the same job bound the same way (c1), and the hidden browser (run-b) reporting. */
async function scene() {
  review._reset();
  terminals._reset();
  terminals.usePty(async () => ({spawn: () => ({onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {}})}));
  terminals.startForm({id: 's1', url: JOB, company: 'Manor AG'});
  await terminals.start({id: 'c1', url: JOB, kind: 'claude', file: 'claude'});
  const all = terminals.list();
  review.report(all, {session: 's1', tab: 7, boot: 'run-a', url: `${JOB}#jobadabra-fill=s1`, job: JOB, total: 1, left: 0});
  review.report(all, {session: 'c1', tab: 8, boot: 'run-a', url: `${JOB}#jobadabra-fill=c1`, job: JOB, total: 1, left: 0});   // Claude's own tab in the same Chrome
  review.noteTabs({ids: [7, 8], boot: 'run-a', browser: 'chrome'});       // the person's Chrome: its run is live
  review.noteTabs({ids: [130], boot: 'run-b', browser: 'hidden'});     // the hidden browser that reads jobs
  return {sessions: terminals.list()};
}
// What the hidden browser's read tab sends with every report (extension/tab-identity.js identityOf): the read id as its session, the posting as its job, the browser run.
const read = {session: 'tr1a2b3c4d', tab: 130, boot: 'run-b', job: JOB, url: JOB, host: 'www.jobs.ch'};

const MATCHERS = [
  ['the form report (review.report -> pick)', ({sessions}) => assert.equal(review.report(sessions, {...read, url: `${JOB}#jobadabra-fill=tr1a2b3c4d`, total: 0, left: 0}).matched, null)],
  ['the focus report (review.noteFocus)', async ({sessions}) => {
    assert.deepEqual(review.noteFocus(sessions, {...read, found: true}), {ok: false}, 'the read tab answered the person\'s "show me this field"');
    assert.equal(await review.focusFound('s1', 20), null);
  }],
  ['the site password, account fact and account pressed handlers (journey-identity resolveSession)', async ({sessions}) => {
    const {identityServices, resolveSession} = await import('../lib/journey-identity.js');
    assert.equal(typeof identityServices, 'function', 'the handlers build their services in one place');
    assert.equal(resolveSession(read, identityServices({terminals, review, isFormOf: apply.isFormOf})), '', 'the read tab was resolved to the person\'s session');
    assert.equal(resolveSession({...read, boot: 'run-a', session: ''}, identityServices({terminals, review, isFormOf: apply.isFormOf})), 's1', 'positive control: the person\'s own browser still resolves by the job');
    assert.ok(sessions.length);
  }],
  ['the stuck report (session-flow.stuck: the session and the Claude sessions of the same job)', async () => {
    const logs = [];
    const flow = createSessionFlow({terminals, review, apply, appLog: (area, text) => logs.push(`${area}: ${text}`), startClaude: async () => ({ok: true}), claudeAllowed: () => false});
    assert.equal(flow.stuck({...read, why: 'no-form'}), 'no-session', 'the read tab\'s stuck report was noted on the person\'s session');
    assert.equal(terminals.get('s1').stuck || null, null);
    assert.equal(flow.stuck({...read, why: 'account'}), 'no-session');
    assert.equal(terminals.get('c1').stage || '', '', 'the read tab\'s sign-in page moved the person\'s Claude session to the account step');
    assert.equal(flow.stuck({...read, boot: 'run-a', session: '', tab: 8, why: 'account'}), 'offered', 'positive control: the person\'s own browser still reaches the sessions');
    assert.equal(terminals.get('c1').stage, 'account', 'positive control: Claude session stage');
    assert.equal(flow.stuck({...read, boot: 'run-a', session: '', tab: 7, why: 'no-form'}), 'noted', 'positive control: the person\'s own browser still reaches the session');
    await settle();
  }],
];

for (const [name, play] of MATCHERS) {
  test(`a hidden-browser read tab is never matched to the person's session by its job address: ${name}`, async () => { await play(await scene()); });
}

// The class guard: a file that matches a session (or a job) by an address must be on this list, with why it cannot hand a read tab the person's session. Add a matcher: add it to MATCHERS above.
const ADDRESS_MATCHERS = {
  'review.js': 'MATCHERS: report, focus (pick)',
  'journey-identity.js': 'MATCHERS: resolveSession',
  'session-flow.js': 'MATCHERS: stuck',
  'apply.js': 'defines isFormOf and opens forms; matches no report to a session',
  'form-address.js': 'defines isFormOf',
  'server-pages.js': 'sessionOfJob only picks which session card a notification opens; it writes nothing to a session',
  'server.js': 'matches a fill event to a JOB row (find), not to a session',
  'cv.js': 'matches a saved record by its job address; no session',
  'ext-server-handlers.js': 'isFormOf only passed into identityServices (resolveSession asks heldElsewhere): checked below',
};
test('the class: no other file matches a session by a job address (isFormOf)', () => {
  const lib = path.join(here, '..', 'lib');
  const users = fs.readdirSync(lib).filter(name => name.endsWith('.js') && /\bisFormOf\b/.test(fs.readFileSync(path.join(lib, name), 'utf8').replace(/\/\/.*$/gm, '')));
  const unknown = users.filter(name => !(name in ADDRESS_MATCHERS));
  assert.deepEqual(unknown, [], `${unknown.join(', ')} matches by a job address: add it to MATCHERS (test above) and ADDRESS_MATCHERS, so a hidden-browser read tab cannot reach the person's session through it`);
});

test('the class: in ext-server-handlers.js every isFormOf goes through identityServices', () => {
  const lines = fs.readFileSync(path.join(here, '..', 'lib', 'ext-server-handlers.js'), 'utf8').split('\n').map(line => line.replace(/\/\/.*$/, ''));
  const stray = lines.map((line, at) => [at + 1, line]).filter(([, line]) => /\bisFormOf\b/.test(line) && !/identityServices|^import /.test(line));
  assert.deepEqual(stray, [], 'ext-server-handlers.js matches a session by a job address outside identityServices (lib/journey-identity.js)');
});
