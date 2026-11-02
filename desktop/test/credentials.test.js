// Settings → Credentials reads the Keychain's item attributes (never its secrets) and one password on request.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {list, parseDump, reveal} from '../lib/credentials.js';

const item = (service, {account = 'jobadabra', comment = null, cdat = '20261008115402'} = {}) => `keychain: "/Users/x/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="Jobadabra: x"
    "acct"<blob>="${account}"
    "cdat"<timedate>=0x32303236313030383131353430325A00  "${cdat}Z\\000"
    "icmt"<blob>=${comment === null ? '<NULL>' : `"${comment}"`}
    "svce"<blob>="${service}"
`;

test('every site account is listed with its email and job, newest first; the shared password and non-sites are not', () => {
  const dump = [
    item('jobadabra.career5.successfactors.eu.password', {cdat: '20260928003603'}),
    item('jobadabra.career2.successfactors.eu.password', {comment: 'email=ilie@example.com job=https://jobs.migros.ch/x'}),
    item('jobadabra.sites.password'), item('jobadabra.mac-sign.password'),
    item('jobadabra.auth.jobs.ch.password', {account: 'someone-else'}), item('other.app.password'),
  ].join('');
  assert.deepEqual(parseDump(dump), [
    {host: 'career2.successfactors.eu', email: 'ilie@example.com', job: 'https://jobs.migros.ch/x', created: '2026-10-08T11:54:02Z'},
    {host: 'career5.successfactors.eu', email: '', job: '', created: '2026-09-28T00:36:03Z'},
  ]);
});

test('the list asks for attributes only, and a password is read for a plain host name only', () => {
  const calls = [];
  list('darwin', (...args) => { calls.push(args); return ''; });
  assert.deepEqual(calls[0].slice(0, 2), ['security', ['dump-keychain']]);   // no -d: no secrets in the list
  assert.equal(reveal('career2.successfactors.eu', 'darwin', () => 'Maple-Rocket-42\n'), 'Maple-Rocket-42');
  assert.equal(reveal('x; rm -rf /', 'darwin', () => 'nope'), null);
  assert.equal(reveal('a.com', 'win32', () => 'nope'), null);
  assert.equal(list('win32').ok, false);
});

test('the extension gets a site password only while applying, for a plain site host, never another item', async () => {
  const {forExtension} = await import('../lib/credentials.js');
  const read = host => (host === 'career2.successfactors.eu' ? 'Maple-Rocket-42' : null);
  assert.deepEqual(forExtension('career2.successfactors.eu', {applying: true, read}), {ok: true, password: 'Maple-Rocket-42'});
  assert.deepEqual(forExtension('career2.successfactors.eu', {applying: false, read}), {ok: false});   // no application open
  assert.deepEqual(forExtension('sites', {applying: true, read: () => 'x'}), {ok: false});            // the shared item by name
  assert.deepEqual(forExtension('mac-sign', {applying: true, read: () => 'x'}), {ok: false});         // not a site
  assert.deepEqual(forExtension('a.com"; rm', {applying: true, read: () => 'x'}), {ok: false});
  assert.deepEqual(forExtension('auth.jobs.ch', {applying: true, read}), {ok: false});                 // none yet: the app makes it
});

test('emailOf reads the email recorded on one site\'s item (attributes only) and nothing else', async () => {
  const {emailOf} = await import('../lib/credentials.js');
  const fake = out => () => out;
  assert.equal(emailOf('career2.successfactors.eu', 'darwin', fake('    "icmt"<blob>="email=me@example.com job=https://jobs.example/x"\n')), 'me@example.com');
  assert.equal(emailOf('career2.successfactors.eu', 'darwin', fake('    "icmt"<blob>=<NULL>\n')), '');
  assert.equal(emailOf('bad host!', 'darwin', fake('x')), '');
  assert.equal(emailOf('a.example', 'win32', fake('x')), '');
  assert.equal(emailOf('a.example', 'darwin', () => { throw new Error('no item'); }), '');
});

test('a test account is listed as one (test: true, its key), never as a real site, and no application ever gets it', async () => {
  const {forExtension} = await import('../lib/credentials.js'), {testHosts} = await import('../e2e/lib/test-accounts.mjs');
  const dump = [item('jobadabra.test-account.richemont.wd3.myworkdayjobs.com.password'), item('jobadabra.richemont.wd3.myworkdayjobs.com.password', {comment: 'email=me@example.com'}),
    item('jobadabra.test-account.richemont.wd3.myworkdayjobs.com.email')].join('');
  const rows = parseDump(dump);
  assert.deepEqual(rows.map(row => [row.host, row.test || false, row.key || '']), [['richemont.wd3.myworkdayjobs.com', true, 'test-account.richemont.wd3.myworkdayjobs.com'], ['richemont.wd3.myworkdayjobs.com', false, '']]);
  assert.deepEqual(testHosts(() => dump), ['richemont.wd3.myworkdayjobs.com']);
  assert.equal(reveal('test-account.richemont.wd3.myworkdayjobs.com', 'darwin', () => 'pw'), 'pw');   // Show / Copy name the key
  assert.deepEqual(forExtension('test-account.richemont.wd3.myworkdayjobs.com', {applying: true, read: () => 'pw'}), {ok: false});
});

test('a test account row shows the address kept in its sibling email item; a real row never borrows one', () => {
  const dump = [item('jobadabra.test-account.a.example.password'), item('jobadabra.test-account.a.example.email'), item('jobadabra.b.example.password'),
    item('jobadabra.test-account.c.example.password')].join('');
  const asked = [];
  const exec = (cmd, args) => {
    if (args.includes('dump-keychain')) return dump;
    const service = args[args.indexOf('-s') + 1];
    asked.push(service);
    if (service === 'jobadabra.test-account.a.example.email') return 'owner+jp@example.com\n';
    throw new Error('no item');
  };
  const {rows} = list('darwin', exec);
  const byHost = Object.fromEntries(rows.map(row => [row.host, row.email]));
  assert.deepEqual(byHost, {'a.example': 'owner+jp@example.com', 'b.example': '', 'c.example': ''});   // c: a test account with no email item says so; b: a real account, no address of its own
  assert.deepEqual(asked.filter(service => service.startsWith('jobadabra.')).sort(), ['jobadabra.test-account.a.example.email', 'jobadabra.test-account.c.example.email']);   // only test rows ask, only for their own .email item, never a password
});

// Rename to Jobadabra (1 Nov 2026, owner: "small fallbacks"): accounts an older install saved as job-pilotto.<site>.password (account job-pilotto) are still listed;
// when both names exist for a site, one row (the newer).
test('accounts saved under the old job-pilotto.* names are listed, once per site', () => {
  const dump = [
    item('job-pilotto.career5.successfactors.eu.password', {account: 'job-pilotto', cdat: '20260928003603'}),
    item('jobadabra.career2.successfactors.eu.password', {cdat: '20261020000000'}),
    item('job-pilotto.career2.successfactors.eu.password', {account: 'job-pilotto', cdat: '20260901000000'}),
    item('job-pilotto.sites.password', {account: 'job-pilotto'}),
  ].join('');
  assert.deepEqual(parseDump(dump).map(row => row.host), ['career2.successfactors.eu', 'career5.successfactors.eu']);
});
