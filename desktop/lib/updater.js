// App updates: the installed app checks GitHub for the latest *stable* release (a build promoted with
// tools/release-stable.sh; every push only makes a pre-release), and installs it on one click, the same way on both
// computers: the download is fetched, the app quits, the new version is put in place, and the app reopens. On the Mac
// that means unpacking the .zip and swapping this app (an install from before the rename moves to Jobadabra.app); on Windows, running the installer quietly once
// this process has let go of Jobadabra.exe and its app.asar. Its Notion schema, pipeline and extension come with it
// (the schema repair runs at the next start).
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO = 'GarryOne/jobadabra';

// "0.5.10" > "0.5.9"; the older suffixed builds still order: "0.4.0-alpha.41" > "0.4.0-alpha.9", and a plain version > its pre-releases.
export function newer(a, b) {
  const parse = v => { const [core, pre = ''] = String(v).replace(/^desktop-v/, '').split('-'); return {core: core.split('.').map(Number), pre}; };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.core[i] || 0) !== (y.core[i] || 0)) return (x.core[i] || 0) > (y.core[i] || 0);
  if (x.pre === y.pre) return false;
  if (!x.pre || !y.pre) return !x.pre;
  const [xa, ya] = [x.pre.split('.'), y.pre.split('.')];
  for (let i = 0; i < Math.max(xa.length, ya.length); i++) {
    if (xa[i] === ya[i]) continue;
    if (xa[i] === undefined || ya[i] === undefined) return ya[i] === undefined;
    const [xn, yn] = [Number(xa[i]), Number(ya[i])];
    return Number.isNaN(xn) || Number.isNaN(yn) ? xa[i] > ya[i] : xn > yn;
  }
  return false;
}

// A pre-release is offered to beta testers only after tools/beta-approve.sh wrote its platform's line in the notes: the shared release checks
// (tools/release-checks.sh: unit suites, schema) and that platform's own end-to-end suites passed on it. Mac (and Linux) read the first line,
// Windows only its own (tools/beta-approve.sh --windows): one release, each platform offered it on its own (owner, 6 Oct 2026).
export const BETA_MARK = /^Beta-approved:/m;
export const BETA_MARK_WINDOWS = /^Beta-approved \(Windows\):/m;
export const approvedFor = (body, platform = process.platform) => (platform === 'win32' ? BETA_MARK_WINDOWS : BETA_MARK).test(body || '');

// The download for this computer in a release, or null. `own`: only this build's own installer (a beta or a rollback never takes the generic Windows
// installer, which a failed Windows build leaves as the PREVIOUS release's: tools/release-stable.sh guards stable the same way).
export function asset(release, platform = process.platform, {own = false} = {}) {
  const version = String(release?.tag_name || '').replace(/^desktop-v/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Jobadabra-* first; Job-Pilotto-* is what a release made before 25 Oct 2026 has (and what is still uploaded beside it: tools/release-file-names.sh).
  const names = platform === 'darwin' ? [/^Jobadabra-[\d.]+.*-arm64\.zip$/, /^Jobadabra-mac-arm64\.zip$/, /^Job-Pilotto-[\d.]+.*-arm64\.zip$/, /^Job-Pilotto-mac-arm64\.zip$/]
    : platform === 'win32' ? [new RegExp(`^Jobadabra-${version}-x64\\.exe$`), new RegExp(`^Job-Pilotto-${version}-x64\\.exe$`),
      ...(own ? [] : [/^Jobadabra-windows-x64\.exe$/, /^Job-Pilotto-windows-x64\.exe$/, /^Jobadabra-.*-x64\.exe$/, /^Job-Pilotto-.*-x64\.exe$/])] : [];
  for (const pattern of names) {
    const found = (release?.assets || []).find(item => pattern.test(item.name));
    if (found) return found;
  }
  return null;
}

const offerOf = (release, platform, extra = {}) => {
  const version = String(release?.tag_name || '').replace(/^desktop-v/, '');
  const download = asset(release, platform, {own: !!extra.beta || !!extra.rollback});
  if (!version || !download) return null;
  return {version, name: release.name || version, notes: String(release.body || '').slice(0, 2000), url: release.html_url,
    download: download.browser_download_url, size: download.size, ...extra};
};
// Where the releases are read: GitHub, or the e2e's fake release server (JOB_PILOTTO_E2E_UPDATES_URL), only under the e2e (JOB_PILOTTO_E2E), never for a person.
export const apiBase = (env = process.env) => (env.JOB_PILOTTO_E2E && env.JOB_PILOTTO_E2E_UPDATES_URL) || 'https://api.github.com';
// A person's app reads our website first (site/src/releases.js: GitHub read with the site's token, kept 5 minutes for every install), then
// GitHub itself. 9 Oct 2026: unsigned GitHub calls are 60 an hour per IP, and an office network shares one: "GitHub answered 403".
export const SITE = process.env.JOB_PILOTTO_SITE || 'https://www.jobpilotto.top';
const HEADERS = {Accept: 'application/vnd.github+json'};
const kept = new Map();   // GitHub url -> {etag, data}: an unchanged answer (304) doesn't count against GitHub's limit
let limitedUntil = 0;     // GitHub said this network used its hour: no call before then
export const resetLimit = () => { limitedUntil = 0; kept.clear(); };   // tests
const at = ms => new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
const limitError = () => new Error(`GitHub is limiting update checks from this network; trying again at ${at(limitedUntil)}`);

async function fromGithub(fetcher, url, now) {
  if (now < limitedUntil) throw limitError();
  const before = kept.get(url);
  const response = await fetcher(url, {headers: {...HEADERS, ...(before ? {'If-None-Match': before.etag} : {})}});
  if (response.status === 304 && before) return before.data;
  if (response.status === 429 || (response.status === 403 && response.headers?.get?.('x-ratelimit-remaining') === '0')) {
    const reset = Number(response.headers?.get?.('x-ratelimit-reset')) * 1000, retry = Number(response.headers?.get?.('retry-after')) * 1000;
    limitedUntil = reset > now ? reset : now + (retry > 0 ? retry : 60 * 60 * 1000);
    throw limitError();
  }
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const data = await response.json();
  const etag = response.headers?.get?.('etag');
  if (etag) kept.set(url, {etag, data});
  return data;
}

// path: 'releases/latest' or 'releases?per_page=30'
async function getJson(fetcher, path, now = Date.now()) {
  const e2e = apiBase();
  if (e2e !== 'https://api.github.com') {
    const response = await fetcher(`${e2e}/repos/${REPO}/${path}`, {headers: HEADERS});
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    return response.json();
  }
  try {
    const response = await fetcher(`${SITE}/api/${path.startsWith('releases/latest') ? 'releases/latest' : 'releases'}`, {headers: HEADERS});
    if (response.ok) return await response.json();
  } catch { /* the site is down or unreachable: GitHub itself below */ }
  return fromGithub(fetcher, `https://api.github.com/repos/${REPO}/${path}`, now);
}

// -> {version, name, notes, url} when a newer release is on offer, else null. Stable (the default): the latest stable release, if newer than `current`.
// channel 'beta' (the person switched it on, Settings → Diagnostics → Beta): also pre-releases carrying the beta-approved line; the newest of them all wins.
// channel 'test' (Settings → Diagnostics → Test builds): the newest release of any kind, approved or not: a "Build only" run (tools/test-build.sh) publishes one without the e2e gate, so a friend
// who asked for it gets a fix in the time of a build instead of a gated beta. Nothing has checked it: that is the person's choice, and the label says so.
export async function check(current, {channel = 'stable', fetcher = globalThis.fetch, platform = process.platform} = {}) {
  if (channel === 'beta' || channel === 'test') {
    const list = await getJson(fetcher, 'releases?per_page=30');
    const open = (Array.isArray(list) ? list : []).filter(release => !release.draft && (!release.prerelease || channel === 'test' || approvedFor(release.body, platform)))
      .map(release => offerOf(release, platform, {beta: !!release.prerelease})).filter(Boolean);
    const best = open.reduce((top, offer) => (!top || newer(offer.version, top.version) ? offer : top), null);
    return best && newer(best.version, current) ? best : null;
  }
  const offer = offerOf(await getJson(fetcher, 'releases/latest'), platform);
  return offer && newer(offer.version, current) ? offer : null;
}

// -> the latest stable release as an offer even when it is OLDER than `current` ("Back to stable"), or null. `ahead`: this install is newer than it.
export async function stableRelease(current, {fetcher = globalThis.fetch, platform = process.platform} = {}) {
  const offer = offerOf(await getJson(fetcher, 'releases/latest'), platform, {rollback: true});
  return offer && {...offer, ahead: newer(current, offer.version)};
}

// The Mac bundle is called Jobadabra.app; installs made before the rename were called Job Pilotto.app.
export const MAC_APP = 'Jobadabra.app';
// Where the new app goes: next to the old one under the new name, unless something is already there (then the old path is kept).
export function swapTarget(oldApp, exists = fs.existsSync) {
  const target = path.posix.join(path.posix.dirname(oldApp), MAC_APP);   // the installed app's paths, whatever OS runs the test
  return path.posix.basename(oldApp) === MAC_APP || exists(target) ? oldApp : target;
}

// The Mac swap, run after the app quits: wait for it, put the new .app in its place, open it.
// target (default: oldApp): a different path when the app is renamed on the way (swapTarget); the old path then stays as a link to it,
// so a Dock pin, a Login Item or an alias made before the rename keeps opening the app.
// logFile: the app's log (logs/app.log); each step of the swap is written there as an [update] line, with any error, since
// it runs after the app has quit and nothing else would record it.
export function macSwapScript(pid, oldApp, newApp, logFile = '', target = oldApp) {
  const q = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
  const say = text => (logFile ? `echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [update] swap: ${text}" >> ${q(logFile)}` : ':');
  const renamed = target !== oldApp;
  const place = renamed
    ? `rm -rf ${q(oldApp)}.old ${q(target)}.old && mv ${q(oldApp)} ${q(`${oldApp}.old`)} && mv ${q(newApp)} ${q(target)} && ln -s ${q(path.posix.basename(target))} ${q(oldApp)} && rm -rf ${q(`${oldApp}.old`)}`
    : `rm -rf ${q(oldApp)}.old && mv ${q(oldApp)} ${q(`${oldApp}.old`)} && mv ${q(newApp)} ${q(oldApp)} && rm -rf ${q(`${oldApp}.old`)}`;
  return [...(logFile ? [`exec 2>> ${q(logFile)}`] : []),
    say(`waiting for the app (pid ${Number(pid)}) to quit`),
    `while kill -0 ${Number(pid)} 2>/dev/null; do sleep 0.3; done`,
    say(renamed ? `the app quit; putting the new version in place as ${path.posix.basename(target)}` : 'the app quit; putting the new version in place'),
    `${place} || ${say('replacing the app FAILED (error)')}`,
    `xattr -dr com.apple.quarantine ${q(target)} 2>/dev/null`,
    say('opening the new version'),
    `open ${q(target)}`].join('\n');
}

// The Windows update: the downloaded installer itself, started before the app quits, the way electron-updater does it. --updated
// makes it wait for this app to close (and end it if it lingers) without asking, --force-run opens the new version when done
// (electron-builder's NSIS templates). No script: a PowerShell file in %TEMP% never ran on a managed PC (Group Policy and AppLocker
// outrank -ExecutionPolicy Bypass), so the app closed and nothing came back (9 Oct 2026). And not silent (no /S, no hidden window):
// the person saw the app close and nothing for a minute, and could not tell an update from a crash (owner, 9 Oct 2026: "the user
// doesn't understand what's happening"). The one-click installer asks nothing; it only shows its progress bar.
export const WINDOWS_INSTALLER_ARGS = ['--updated', '--force-run'];

// Downloads and installs `update`; calls quit() when the app should close. onStep(text) for progress.
// What a Windows person reads before the app closes for an update (lib/app-updates.js shows it as a dialog).
export const windowsExplanation = update => ({type: 'info', buttons: ['Install now'], defaultId: 0, title: 'Jobadabra update',
  message: `Installing Jobadabra ${update.version}`,
  detail: 'Jobadabra closes now. A small installer window shows the progress (about a minute), then Jobadabra opens again by itself. Your data stays as it is.'});
// explain(update): Windows only, awaited after the download and before the installer starts: says what happens next (the app
// closes, the installer shows its progress, the app opens again), so the closing window is never a surprise.
export async function install(update, {exe, pid = process.pid, quit, onStep = () => {}, logFile = '', fetcher = globalThis.fetch,
  platform = process.platform, spawn: run = spawn, explain = async () => {}}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-pilotto-update-'));
  onStep('Downloading…');
  const response = await fetcher(update.download);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const file = path.join(dir, platform === 'win32' ? 'Job-Pilotto-Setup.exe' : 'update.zip');
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  if (platform === 'win32') {
    onStep('Ready to install…');
    await explain(update);
    onStep('Installing and restarting…');
    const child = run(file, WINDOWS_INSTALLER_ARGS, {detached: true, stdio: 'ignore'});   // its window shown: the progress is the feedback
    await new Promise((resolve, reject) => {   // a blocked installer (antivirus, AppLocker) says so here, and the app stays open
      child.once('error', error => reject(new Error(`The installer couldn't start: ${error.message}`)));
      child.once('spawn', resolve);
    });
    child.unref();
    quit();
    return;
  }
  const oldApp = path.resolve(exe, '..', '..', '..');  // …/Jobadabra.app/Contents/MacOS/Jobadabra (Job Pilotto.app before the rename)
  if (!oldApp.endsWith('.app') || oldApp.startsWith('/Volumes/')) throw new Error('Move Jobadabra to Applications first, then update.');
  fs.accessSync(path.dirname(oldApp), fs.constants.W_OK);  // an Applications folder this user can write to
  onStep('Unpacking…');
  await new Promise((resolve, reject) => run('ditto', ['-x', '-k', file, dir]).on('exit', code => (code ? reject(new Error('Unpacking failed')) : resolve())));
  const newApp = fs.readdirSync(dir).map(name => path.join(dir, name)).find(name => name.endsWith('.app'));
  if (!newApp) throw new Error('The download has no app in it');
  onStep('Restarting…');
  run('/bin/sh', ['-c', macSwapScript(pid, oldApp, newApp, logFile, swapTarget(oldApp))], {detached: true, stdio: 'ignore'}).unref();
  quit();
}
