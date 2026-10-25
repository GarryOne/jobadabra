// App updates (lib/updater.js): which release is newer, which download fits, the Mac swap, the Windows install.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {asset, check, install, macSwapScript, newer, resetLimit, stableRelease, windowsExplanation} from '../lib/updater.js';

test('the download is the Jobadabra-* file, or the Job-Pilotto-* one on a release made before the rename (an installed 0.8.27 reads only those)', () => {
  const both = {tag_name: 'desktop-v0.9.1', assets: ['Job-Pilotto-0.9.1-arm64.zip', 'Jobadabra-0.9.1-arm64.zip', 'Job-Pilotto-0.9.1-x64.exe', 'Jobadabra-0.9.1-x64.exe',
    'Job-Pilotto-windows-x64.exe', 'Jobadabra-windows-x64.exe'].map(name => ({name, browser_download_url: 'https://dl/' + name}))};
  assert.equal(asset(both, 'darwin').name, 'Jobadabra-0.9.1-arm64.zip');
  assert.equal(asset(both, 'win32').name, 'Jobadabra-0.9.1-x64.exe');
  assert.equal(asset(both, 'win32', {own: true}).name, 'Jobadabra-0.9.1-x64.exe');
  const aliases = {tag_name: 'desktop-v0.9.1', assets: [{name: 'Jobadabra-mac-arm64.zip'}, {name: 'Jobadabra-windows-x64.exe'}]};
  assert.equal(asset(aliases, 'darwin').name, 'Jobadabra-mac-arm64.zip');
  assert.equal(asset(aliases, 'win32').name, 'Jobadabra-windows-x64.exe');
  assert.equal(asset(aliases, 'win32', {own: true}), null, 'a beta never takes a generic installer');
  const old = {tag_name: 'desktop-v0.8.27', assets: [{name: 'Job-Pilotto-0.8.27-arm64.zip'}, {name: 'Job-Pilotto-0.8.27-x64.exe'}]};
  assert.equal(asset(old, 'darwin').name, 'Job-Pilotto-0.8.27-arm64.zip');
  assert.equal(asset(old, 'win32', {own: true}).name, 'Job-Pilotto-0.8.27-x64.exe');
});

test('versions compare as releases do: numbers, then a release beats its pre-releases', () => {
  assert.ok(newer('0.4.0-alpha.41', '0.4.0-alpha.39'));
  assert.ok(newer('0.4.0-alpha.10', '0.4.0-alpha.9'));
  assert.ok(newer('desktop-v0.4.0', '0.4.0-alpha.50'));
  assert.ok(newer('0.5.0', '0.4.0-alpha.254') && !newer('0.4.0-alpha.254', '0.5.0'));   // an alpha install updates to the plain 0.5 builds
  assert.ok(newer('0.5.0-alpha.1', '0.4.9'));
  assert.ok(!newer('0.4.0-alpha.39', '0.4.0-alpha.39'));
  assert.ok(!newer('0.3.9', '0.4.0-alpha.1'));
});

const RELEASE = {tag_name: 'desktop-v0.4.0-alpha.41', name: '0.4 Alpha 41', body: 'Notes', html_url: 'https://github.com/x',
  assets: [{name: 'Job-Pilotto-0.4.0-alpha.41-arm64.dmg'}, {name: 'Job-Pilotto-0.4.0-alpha.41-arm64.zip', browser_download_url: 'https://dl/zip', size: 9},
    {name: 'Job-Pilotto-windows-x64.exe', browser_download_url: 'https://dl/exe'}]};

test('the download for this computer: the Mac .zip (not the .dmg), the Windows installer', () => {
  assert.equal(asset(RELEASE, 'darwin').name, 'Job-Pilotto-0.4.0-alpha.41-arm64.zip');
  assert.equal(asset(RELEASE, 'win32').name, 'Job-Pilotto-windows-x64.exe');
  assert.equal(asset(RELEASE, 'linux'), null);
});

test('an update is offered only when the latest stable release is newer', async () => {
  const fetcher = async () => ({ok: true, json: async () => RELEASE});
  assert.equal((await check('0.4.0-alpha.39', {fetcher, platform: 'darwin'})).download, 'https://dl/zip');
  assert.equal(await check('0.4.0-alpha.41', {fetcher, platform: 'darwin'}), null);
});

test('the Mac swap waits for the app to quit, replaces it, clears quarantine and reopens it', () => {
  const script = macSwapScript(123, "/Applications/Job Pilotto.app", '/tmp/x/Job Pilotto.app');
  assert.match(script, /kill -0 123/);
  assert.match(script, /mv '\/Applications\/Job Pilotto.app' '\/Applications\/Job Pilotto.app.old'/);
  assert.match(script, /open '\/Applications\/Job Pilotto.app'$/);
});

// 9 Oct 2026: the old way, a PowerShell script in %TEMP%, never ran on a managed Windows PC: the app closed and nothing came back.
test('installing on Windows starts the installer itself, quiet, updating and reopening, and only then quits', async () => {
  const calls = [];
  const steps = [];
  await install({download: 'https://dl/exe'}, {
    platform: 'win32', pid: 4242, exe: 'C:\\Programs\\Job Pilotto\\Job Pilotto.exe',
    fetcher: async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(4)}),
    spawn: (file, args, options) => { calls.push({file, args, options}); return fakeChild(calls, 'spawn'); },
    quit: () => calls.push('quit'),
    onStep: text => steps.push(text),
  });
  const run = calls[0];
  assert.match(run.file, /Job-Pilotto-Setup\.exe$/, 'the downloaded installer runs, no script in between');
  assert.ok(fs.existsSync(run.file));
  // --updated: it waits for this app to close, then ends it if it lingers; --force-run: it opens the new version. Not /S, and its
  // window not hidden: the person sees the installer's progress instead of a closed app and nothing (owner, 9 Oct 2026).
  assert.deepEqual(run.args, ['--updated', '--force-run']);
  assert.ok(!run.args.includes('/S'));
  assert.ok(!run.options.windowsHide, 'the installer window is shown');
  assert.equal(run.options.detached, true, 'it outlives the app it is about to close');
  assert.ok(!calls.some(call => call.file === 'powershell.exe'));
  assert.equal(calls.at(-1), 'quit', 'the app quits only once the installer has started');
  assert.ok(calls.indexOf('unref') < calls.indexOf('quit'));
  assert.deepEqual(steps, ['Downloading…', 'Ready to install…', 'Installing and restarting…']);
});

test('on Windows the person is told what happens before the app closes, and nothing starts until they have read it', async () => {
  const calls = [];
  let release;
  const explained = new Promise(resolve => { release = resolve; });
  const done = install({version: '0.6.24', download: 'https://dl/exe'}, {
    platform: 'win32', exe: 'C:\\Programs\\Job Pilotto\\Job Pilotto.exe',
    fetcher: async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(4)}),
    spawn: (file, args, options) => { calls.push('installer'); return fakeChild(calls, 'spawn'); },
    quit: () => calls.push('quit'),
    explain: async update => { calls.push(`explain ${update.version}`); await explained; },
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(calls, ['explain 0.6.24'], 'the installer waits for the explanation');
  release();
  await done;
  assert.deepEqual(calls.filter(call => call !== 'unref'), ['explain 0.6.24', 'installer', 'quit']);
  const words = windowsExplanation({version: '0.6.24'});
  assert.match(words.message, /0\.6\.24/);
  assert.match(words.detail, /closes now.*installer window shows the progress.*opens again by itself/s);
  assert.deepEqual(words.buttons, ['Install now']);
});

test('a Windows installer that cannot start leaves the app open and says why', async () => {
  const calls = [];
  await assert.rejects(install({download: 'https://dl/exe'}, {
    platform: 'win32', exe: 'C:\\Programs\\Job Pilotto\\Job Pilotto.exe',
    fetcher: async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(4)}),
    spawn: () => fakeChild(calls, 'error', new Error('blocked by group policy')),
    quit: () => calls.push('quit'),
  }), /The installer couldn't start: blocked by group policy/);
  assert.ok(!calls.includes('quit'), 'the app stays open: no update must never mean no app');
});

function fakeChild(calls, outcome, error) {
  const handlers = {};
  setImmediate(() => handlers[outcome]?.(error));
  return {once: (event, handler) => { handlers[event] = handler; }, unref: () => calls.push('unref')};
}

// Beta: only for people who switched it on, and only builds the release gate approved.
const release = (n, {prerelease = true, body = '', assets} = {}) => ({tag_name: `desktop-v0.4.0-alpha.${n}`, name: `Alpha ${n}`, prerelease, draft: false, body, html_url: `https://github.com/x/${n}`,
  assets: assets || [{name: `Job-Pilotto-0.4.0-alpha.${n}-arm64.zip`, browser_download_url: `https://dl/${n}.zip`, size: 9},
    {name: `Job-Pilotto-0.4.0-alpha.${n}-x64.exe`, browser_download_url: `https://dl/${n}.exe`}, {name: 'Job-Pilotto-windows-x64.exe', browser_download_url: 'https://dl/generic.exe'}]});
const APPROVED = 'Beta-approved: unit suites and every end-to-end suite passed on commit abc1234 (2026-10-04)';
const listOf = items => async () => ({ok: true, json: async () => items});

test('a beta tester is offered the newest approved pre-release, never an unapproved one', async () => {
  const items = [release(54), release(53, {body: APPROVED}), release(52, {prerelease: false}), release(51)];
  const offer = await check('0.4.0-alpha.52', {channel: 'beta', fetcher: listOf(items), platform: 'darwin'});
  assert.equal(offer.version, '0.4.0-alpha.53');
  assert.equal(offer.beta, true);
  assert.equal(await check('0.4.0-alpha.53', {channel: 'beta', fetcher: listOf(items), platform: 'darwin'}), null, 'alpha.54 is unapproved');
});

test('the stable channel asks only for the latest stable release', async () => {
  const fetcher = async url => { assert.match(url, /releases\/latest$/); return {ok: true, json: async () => release(52, {prerelease: false})}; };
  assert.equal((await check('0.4.0-alpha.50', {fetcher, platform: 'darwin'})).version, '0.4.0-alpha.52');
});

test('a beta tester is offered a newer stable release too: the newest approved or stable wins', async () => {
  const items = [release(53, {body: APPROVED}), release(55, {prerelease: false})];
  assert.equal((await check('0.4.0-alpha.50', {channel: 'beta', fetcher: listOf(items), platform: 'darwin'})).version, '0.4.0-alpha.55');
});

test('a beta or a rollback on Windows takes the build\'s own installer, not the generic one a failed build leaves behind', () => {
  const noOwn = release(53, {body: APPROVED, assets: [{name: 'Job-Pilotto-windows-x64.exe', browser_download_url: 'https://dl/generic.exe'}]});
  assert.equal(asset(noOwn, 'win32'), noOwn.assets[0], 'stable keeps its fallback');
  assert.equal(asset(noOwn, 'win32', {own: true}), null);
  assert.equal(asset(release(53), 'win32', {own: true}).browser_download_url, 'https://dl/53.exe');
});

test('"Back to stable" offers the latest stable release even though it is older, and says the install is ahead of it', async () => {
  const fetcher = listOf(release(52, {prerelease: false}));
  const back = await stableRelease('0.4.0-alpha.54', {fetcher, platform: 'darwin'});
  assert.deepEqual([back.version, back.rollback, back.ahead], ['0.4.0-alpha.52', true, true]);
  assert.equal((await stableRelease('0.4.0-alpha.52', {fetcher, platform: 'darwin'})).ahead, false, 'already on stable');
});

// One release for both platforms, each approved on its own (owner, 6 Oct 2026): a platform takes a beta once its own suites passed, never waiting for the other.
test('each platform takes a beta on its own line: Mac-only on a Mac, Windows-only on Windows, both lines on both', async () => {
  const {approvedFor} = await import('../lib/updater.js');
  const mac = 'notes\n\nBeta-approved: unit suites and every end-to-end suite passed on commit abc1234 (2026-10-06)';
  const both = `${mac}\nBeta-approved (Windows): every Windows end-to-end suite passed on commit abc1234 (2026-10-06)`;
  assert.equal(approvedFor(mac, 'darwin'), true);
  assert.equal(approvedFor(mac, 'win32'), false);
  assert.equal(approvedFor(both, 'win32'), true);
  const windows = 'Beta-approved (Windows): every Windows end-to-end suite passed on commit abc1234 (2026-10-06)';
  assert.equal(approvedFor(windows, 'win32'), true, 'Windows does not wait for the Mac/Linux suites');
  assert.equal(approvedFor(windows, 'darwin'), false, 'nor does a Windows pass approve a Mac');
  assert.equal(approvedFor(windows, 'linux'), false);
  assert.equal(approvedFor('', 'darwin'), false);
});

test('a test-builds install is offered the newest build, approved or not; beta and stable still are not', async () => {
  const items = [release(54), release(53, {body: APPROVED}), release(52, {prerelease: false})];
  assert.equal((await check('0.4.0-alpha.52', {channel: 'test', fetcher: listOf(items), platform: 'darwin'})).version, '0.4.0-alpha.54');
  assert.equal(await check('0.4.0-alpha.54', {channel: 'test', fetcher: listOf(items), platform: 'darwin'}), null, 'nothing newer than the newest build');
  assert.equal((await check('0.4.0-alpha.52', {channel: 'beta', fetcher: listOf(items), platform: 'darwin'})).version, '0.4.0-alpha.53', 'the beta still waits for the gate');
  // On Windows a test build takes the build's own installer, never the generic one a failed Windows build leaves behind.
  const noOwn = [release(54, {assets: [{name: 'Job-Pilotto-windows-x64.exe', browser_download_url: 'https://dl/generic.exe'}]}), release(52, {prerelease: false})];
  assert.equal((await check('0.4.0-alpha.50', {channel: 'test', fetcher: listOf(noOwn), platform: 'win32'})).version, '0.4.0-alpha.52');
});

// 9 Oct 2026: a friend's office network had used GitHub's 60 unsigned calls an hour: "Couldn't check for updates: GitHub answered 403".
const LATEST = {tag_name: 'desktop-v0.6.19', name: '0.6.19', body: '', html_url: 'https://github.com/x', assets: [{name: 'Job-Pilotto-0.6.19-x64.exe', browser_download_url: 'https://dl/exe'}]};
const headers = map => ({get: name => map[name.toLowerCase()] ?? null});

test('the update check reads our website first and never calls GitHub when it answers', async () => {
  resetLimit();
  const urls = [];
  const offer = await check('0.6.15', {platform: 'win32', fetcher: async url => { urls.push(url); return {ok: true, json: async () => LATEST}; }});
  assert.equal(offer.version, '0.6.19');
  assert.deepEqual(urls, ['https://www.jobpilotto.top/api/releases/latest']);
});

test('the site down: GitHub itself, then the same answer again costs a 304, not a call against the limit', async () => {
  resetLimit();
  const sent = [];
  const fetcher = async (url, init) => {
    if (!url.startsWith('https://api.github.com')) throw new Error('site unreachable');
    sent.push(init.headers['If-None-Match'] || null);
    return sent.length === 1 ? {ok: true, status: 200, headers: headers({etag: '"v1"'}), json: async () => LATEST} : {ok: false, status: 304, headers: headers({})};
  };
  assert.equal((await check('0.6.15', {platform: 'win32', fetcher})).version, '0.6.19');
  assert.equal((await check('0.6.15', {platform: 'win32', fetcher})).version, '0.6.19', 'the kept answer');
  assert.deepEqual(sent, [null, '"v1"']);
});

test('GitHub limiting this network says until when, and asks nothing more before then', async () => {
  resetLimit();
  const reset = Math.floor(Date.now() / 1000) + 1800;
  let calls = 0;
  const fetcher = async url => {
    if (!url.startsWith('https://api.github.com')) return {ok: false, status: 502};
    calls++;
    return {ok: false, status: 403, headers: headers({'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset)})};
  };
  await assert.rejects(check('0.6.15', {platform: 'win32', fetcher}), /GitHub is limiting update checks from this network; trying again at \d/);
  await assert.rejects(check('0.6.15', {platform: 'win32', fetcher}), /trying again at/);
  assert.equal(calls, 1, 'no second GitHub call while limited');
  resetLimit();
});

test('any other GitHub refusal still says its status', async () => {
  resetLimit();
  const fetcher = async url => (url.startsWith('https://api.github.com') ? {ok: false, status: 500, headers: headers({})} : {ok: false, status: 502});
  await assert.rejects(check('0.6.15', {platform: 'win32', fetcher}), /GitHub answered 500/);
});
