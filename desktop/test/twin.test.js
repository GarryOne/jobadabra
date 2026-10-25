// A live-test twin (lib/twin.js) runs on the owner's real state but reaches nothing of theirs: owner, 8 Oct 2026 ("not my main app window").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {realDataFolders} from '../lib/app-identity.js';
import {isTwin, realFolder, twinRefusal, twinSecret} from '../lib/twin.js';
import {createStorage} from '../lib/storage.js';
import {pipelineEnv} from '../lib/pipeline-env.js';
import {learningOff, reportingOff} from '../lib/telemetry.js';

const real = '/Users/someone/Library/Application Support/Job Pilotto';
const twin = {JOB_PILOTTO_TWIN: '1', JOB_PILOTTO_USER_DATA: '/tmp/jp-twin/data', JOB_PILOTTO_TWIN_NOTION_TOKEN: 'ntn_mirror'};

test('a twin starts only on its own folder and with the mirror\'s token', () => {
  assert.equal(twinRefusal({}, real), '');                                     // not a twin: nothing to check
  assert.equal(twinRefusal(twin, real), '');
  assert.match(twinRefusal({...twin, JOB_PILOTTO_USER_DATA: ''}, real), /never runs on the real folder/);
  assert.match(twinRefusal({...twin, JOB_PILOTTO_USER_DATA: `${real}/`}, real), /is the real folder/);
  assert.match(twinRefusal({...twin, JOB_PILOTTO_TWIN_NOTION_TOKEN: ''}, real), /Live Test mirror/);
  assert.equal(realFolder('/Users/someone', 'darwin', {}, () => false), '/Users/someone/Library/Application Support/Jobadabra');   // neither exists: the new name
  assert.equal(realFolder('/Users/someone', 'darwin', {}, dir => dir === real), real);                                           // an install not moved yet
  for (const name of ['Jobadabra', 'Job Pilotto']) {   // both names are "the real folder" for the refusal
    assert.match(twinRefusal({...twin, JOB_PILOTTO_USER_DATA: `/Users/someone/Library/Application Support/${name}`}, realDataFolders('/Users/someone', 'darwin', {})), /is the real folder/);
  }
});

test('the twin\'s Notion token is the mirror\'s, never one in the cloned secrets.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-twin-'));
  const crypto = {encrypt: value => `sealed:${value}`, decrypt: sealed => sealed.slice(7)};
  const storage = createStorage(dir, crypto);
  storage.setSecret('NOTION_TOKEN', 'ntn_REAL');
  storage.setSecret('EXTENSION_TOKEN', 'ext');
  const saved = {...process.env};
  try {
    Object.assign(process.env, twin);
    assert.equal(storage.secret('NOTION_TOKEN'), 'ntn_mirror');
    assert.equal(storage.secret('EXTENSION_TOKEN'), 'ext');                   // the others as usual
    assert.equal(twinSecret('NOTION_TOKEN', {...twin, JOB_PILOTTO_TWIN_NOTION_TOKEN: ''}), '');   // never falls back to the real one
  } finally { process.env = saved; }
  assert.equal(storage.secret('NOTION_TOKEN'), 'ntn_REAL');                   // not a twin: unchanged
});

test('a twin\'s engine sees no Keychain and nothing reports to the product but form learning', () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-twin-')), {encrypt: v => v, decrypt: v => v});
  assert.equal(pipelineEnv(storage, twin).JOB_PILOTTO_TWIN, '1');
  assert.equal(pipelineEnv(storage, {}).JOB_PILOTTO_TWIN, undefined);
  assert.equal(reportingOff(twin, {packaged: true}), 'a live-test twin');
  // Its fills are real use (owner, 9 Oct 2026): form learning goes both ways, from a source run too; a test run never learns.
  assert.equal(learningOff(twin, {packaged: false}), '');
  assert.equal(learningOff({...twin, JOB_PILOTTO_E2E: '1'}), 'the end-to-end journey');
  assert.equal(learningOff({CI: '1'}), 'CI');
  assert.equal(learningOff({}, {packaged: false}), reportingOff({}, {packaged: false}));
  assert.ok(isTwin(twin) && !isTwin({}));
});

test('every path out of a twin is guarded: Telegram, schedules, AppleScript on Chrome and Terminal, the Mac-only tab search', () => {
  const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.match(read('main.js'), /function restartTelegram\(\) \{\n  polling\?\.stop\(\);\n  if \(isTwin\(\)\) \{ polling = null; return; \}/);
  assert.match(read('main.js'), /if \(twinRefusal\(\)\) \{[^\n]*app\.exit\(3\)/);
  assert.match(read('lib/background-handlers.js'), /if \(!isTwin\(\)\) startSchedule\(/);
  assert.match(read('lib/form-tab.js'), /const jxa = script => new Promise\(\(resolve, reject\) => \(isTwin\(\) \? reject/);
  assert.match(read('lib/apply-handlers.js'), /process\.platform === 'darwin' && !isTwin\(\)/);
  // Every AppleScript in the app is one of the guarded two: a new one fails here until it is guarded too.
  const lib = fs.readdirSync(new URL('../lib/', import.meta.url)).filter(name => name.endsWith('.js'));
  const callers = lib.filter(name => /['"]osascript['"]/.test(read(`lib/${name}`))).sort();
  assert.deepEqual(callers, ['claude-session.js', 'form-tab.js']);
  assert.equal((read('lib/claude-session.js').match(/if \(isTwin\(\)\) throw/g) || []).length, 1);   // the Terminal launcher: never in a twin
  assert.equal((read('lib/claude-session.js').match(/'--chrome'/g) || []).length, 0);                // every in-app session takes browserFlags()
});

test('in a twin, "no page answered" is "no tab": the card then reopens the form in the twin\'s browser', async () => {
  const {openFormTab} = await import('../lib/form-tab.js');
  const saved = {...process.env};
  try {
    process.env.JOB_PILOTTO_TWIN = '1';
    assert.equal(await openFormTab({url: 'https://jobs.coop.ch/x', company: 'Coop'}, async () => { throw new Error('opened a URL'); }), 'none');
  } finally { process.env = saved; }
});

test('a twin\'s Claude sessions drive the twin\'s own browser through Playwright MCP, never --chrome; without that browser, no session at all', async () => {
  const {browserFlags, twinNote} = await import('../lib/twin.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-twin-mcp-'));
  assert.deepEqual(browserFlags(dir, {}), ['--chrome']);                                          // the owner's app
  const flags = browserFlags(dir, {...twin, JOB_PILOTTO_TWIN_BROWSER_CDP: 'http://127.0.0.1:63578'}, {secrets: ['pw-1', '', 'pw-1']});
  assert.deepEqual(flags.filter(flag => flag.startsWith('--')), ['--no-chrome', '--mcp-config', '--strict-mcp-config']);
  const config = JSON.parse(fs.readFileSync(flags[flags.indexOf('--mcp-config') + 1], 'utf8'));
  assert.deepEqual(config.mcpServers.playwright.args.slice(1, 3), ['--cdp-endpoint', 'http://127.0.0.1:63578']);
  assert.ok(config.mcpServers.playwright.args.includes('--init-script') && fs.existsSync(config.mcpServers.playwright.args[config.mcpServers.playwright.args.indexOf('--init-script') + 1]));   // the submit guard
  const secrets = config.mcpServers.playwright.args[config.mcpServers.playwright.args.indexOf('--secrets') + 1];
  assert.equal(fs.readFileSync(secrets, 'utf8'), 'SITE_PASSWORD_1="pw-1"\n');   // masked in what the session reads; once, no blanks
  if (process.platform !== 'win32') assert.equal(fs.statSync(secrets).mode & 0o777, 0o600);   // Windows has no Unix file modes (it reports 0o666)
  assert.throws(() => browserFlags(dir, twin), /without its own browser/);
  assert.match(twinNote({...twin, JOB_PILOTTO_TWIN_BROWSER_CDP: 'x'}), /^LIVE TEST.*overrides every claude-in-chrome step.*Never press Submit/s);
  assert.equal(twinNote({}), '');
  assert.equal((fs.readFileSync(new URL('../lib/claude-session.js', import.meta.url), 'utf8').match(/twinNote\(\) \+ /g) || []).length, 2);   // first in both in-app prompts (apply, read)
});

test('the twin keeps what it learned across starts: the job-site passwords it made and the site accounts it learned', () => {
  const source = fs.readFileSync(new URL('../e2e/twin.mjs', import.meta.url), 'utf8');
  assert.match(source, /path\.join\(LIVE, 'isolated-secrets\.json'\)/);
  assert.match(source, /path\.join\(LIVE, 'site-accounts\.json'\)/);
  assert.match(source, /settings\.siteAccounts = \{\.\.\.\(settings\.siteAccounts \|\| \{\}\), \.\.\./);   // added to the real ones, never replacing them
});

test('a page\'s own dialog or a stray rejection never takes the twin down (9 Oct 2026: Playwright\'s answer to a dialog failed and ended the launcher and the app)', () => {
  const source = fs.readFileSync(new URL('../e2e/twin.mjs', import.meta.url), 'utf8');
  assert.match(source, /browser\.context\.on\('dialog'/);
  assert.match(source, /process\.on\('unhandledRejection'/);
});
