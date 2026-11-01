// npm run twin (in desktop/): a live-test twin of the owner's app (owner, 8 Oct 2026): the real app's state 1:1, real websites, its OWN window and
// browser, and a one-way Notion mirror instead of the real workspace. Never the owner's app window, Chrome windows, Telegram or real Notion; never Submit.
//   1. syncs real Notion -> "Job Pilotto – Live Test" (tools/notion_copy.py, read-only on the source; --no-sync skips it)
//   2. asserts the mirror's token cannot open the real workspace (404), else stops
//   3. a fresh copy of the real app folder (APFS clone) without the real Notion token, Always on or Telegram, pointed at the mirror
//   4. the app in twin mode (desktop/lib/twin.js) on its own port + a debugging port; its own visible Chromium with an extension copy on that port
// Everything live-test lives in ~/Library/Application Support/Job Pilotto (live test)/: ids.env (the mirror's ids), notion-copy/ (sync map),
// home/ (the twin's folder, replaced at each start), browser/ (only its site sign-ins: cookies, local storage), isolated-secrets.json (the job-site passwords it made), site-accounts.json (the site accounts it learned), twin.json (ports, for a script that drives the window). Ctrl-C stops both.
// Job: wait on state
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {copyExtension, freePort, launchBrowser, makeOpenShim} from './lib/extension.mjs';
import {grantAllSites, killGroup, portsFree, refresh, reloadExtension} from './lib/twin-refresh.mjs';
import {realFolder} from '../lib/twin.js';
import {TOKEN_VAR} from './lib/real-notion-token.mjs';
import {withoutWrappers} from './lib/real-claude.mjs';   // never a terminal's claude wrapper (e2e/test/real-claude.test.mjs)

const DESKTOP = path.resolve(import.meta.dirname, '..'), REPO = path.resolve(DESKTOP, '..');
const REAL = realFolder(), LIVE = path.join(path.dirname(REAL), 'Jobadabra (live test)'), HOME = path.join(LIVE, 'home');
const MIRROR_TOKEN = 'jobadabra.notion.token-live-test';
const keychain = service => execFileSync('security', ['find-generic-password', '-s', service, '-w'], {encoding: 'utf8'}).trim();
const say = text => console.log(`twin: ${text}`);
const idsOf = file => Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').map(line => line.trim().split('=')).filter(([key, value]) => key?.startsWith('NOTION_') && value));

export async function notionStatus(token, id) {
  const response = await fetch(`https://api.notion.com/v1/databases/${id}`, {headers: {Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28'}});
  return response.status;
}

async function main() {
  if (!fs.existsSync(path.join(LIVE, 'ids.env'))) throw new Error(`no ${path.join(LIVE, 'ids.env')}: create the mirror first (tools/notion_copy.py create, docs/live-test.md)`);
  const mirror = idsOf(path.join(LIVE, 'ids.env')), real = JSON.parse(fs.readFileSync(path.join(REAL, 'settings.json'), 'utf8')).notionIds || {};
  const token = keychain(MIRROR_TOKEN);
  // 2. The mirror's token must not reach the real workspace: every real database answers 404 to it.
  for (const [key, id] of Object.entries(real).filter(([key]) => key.endsWith('_DB'))) {
    const status = await notionStatus(token, id);
    if (status !== 404) throw new Error(`the Live Test token can open the real ${key} (HTTP ${status}): fix its Notion access before running a twin`);
  }
  say(`isolated: the Live Test token gets 404 on all ${Object.keys(real).filter(key => key.endsWith('_DB')).length} real databases`);
  // 1. One-way sync, real -> mirror.
  if (!process.argv.includes('--no-sync')) {
    say('syncing real Notion -> Live Test (read-only on the real side)…');
    // The app's own current Notion token (its safeStorage-sealed secrets.json), read by a helper under Electron and given to the copy tool's environment only.
    // No fallback: if it cannot be read the helper says so and the sync stops (the old Keychain copy went stale on 10 Oct 2026).
    const copy = ['python3', path.join(REPO, 'tools', 'notion_copy.py'), 'copy', '--from', `env:${TOKEN_VAR}`, '--from-ids', path.join(REAL, 'settings.json'),
      '--to', MIRROR_TOKEN, '--to-ids', path.join(LIVE, 'ids.env'), '--state', path.join(LIVE, 'notion-copy')];
    execFileSync(path.join(DESKTOP, 'node_modules', '.bin', 'electron'), [path.join(DESKTOP, 'e2e', 'lib', 'real-notion-token-main.mjs'), REAL, '--', ...copy], {stdio: ['ignore', 'ignore', 'inherit'], cwd: REPO});
  }
  // 3. A fresh copy of the real folder, then what must not come along.
  fs.rmSync(HOME, {recursive: true, force: true});
  execFileSync('cp', ['-c', '-R', REAL, HOME]);   // an APFS clone: instant, no extra space
  for (const name of fs.readdirSync(HOME).filter(name => name.startsWith('Singleton'))) fs.rmSync(path.join(HOME, name), {force: true});
  fs.rmSync(path.join(HOME, 'logs'), {recursive: true, force: true});
  // The job-site passwords the twin made (lib/keychain.js isolatedFile) outlive the folder: an account a twin created on a real site
  // must still sign in at the next start (9 Oct 2026: they were wiped with home/ at every start). Kept beside browser/, 0600.
  const KEPT = path.join(LIVE, 'isolated-secrets.json');
  if (fs.existsSync(KEPT)) fs.copyFileSync(KEPT, path.join(HOME, 'isolated-secrets.json'));
  const secrets = JSON.parse(fs.readFileSync(path.join(HOME, 'secrets.json'), 'utf8'));
  delete secrets.NOTION_TOKEN; delete secrets.EXTENSION_TOKEN; delete secrets.TELEGRAM_BOT_TOKEN; delete secrets.GITHUB_TOKEN;
  fs.writeFileSync(path.join(HOME, 'secrets.json'), JSON.stringify(secrets, null, 2));
  const settings = JSON.parse(fs.readFileSync(path.join(HOME, 'settings.json'), 'utf8'));
  delete settings.cloud; delete settings.telegramChatId; delete settings.telegramCloud;
  settings.notionIds = mirror;
  if (settings.employersSyncedTo) settings.employersSyncedTo = mirror.NOTION_EMPLOYERS_DB;
  // The site accounts the twin made or learned (desktop/lib/site-accounts.js) outlive home/ too, added to the real ones: an account a twin
  // created must be signed in to at the next start, not signed up for again (9 Oct 2026, Migros: "Créer un compte" a second time).
  const ACCOUNTS = path.join(LIVE, 'site-accounts.json');
  if (fs.existsSync(ACCOUNTS)) settings.siteAccounts = {...(settings.siteAccounts || {}), ...JSON.parse(fs.readFileSync(ACCOUNTS, 'utf8'))};
  fs.writeFileSync(path.join(HOME, 'settings.json'), JSON.stringify(settings, null, 2));
  say(`folder: a fresh copy of the real one at ${HOME} (no real Notion token, Always on or Telegram)`);
  // 4. The app and its own browser.
  const port = await freePort(), cdp = await freePort(), browserCdp = await freePort(), shim = makeOpenShim(), extensionDir = copyExtension(port);
  // The owner's Chrome has the extension's "all sites" access granted (optional_host_permissions, one click there); the twin's copy has it
  // built in, so it reads any employer site as the owner's does (8 Oct 2026: on jobs.coop.ch the twin's extension saw no tab at all).
  grantAllSites(extensionDir);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('JOBADABRA_')));
  // The app is started by a function: a refresh that touches its main process restarts it alone (same ports, same folder, same environment), the browser stays.
  const startApp = () => spawn(path.join(DESKTOP, 'node_modules', '.bin', 'electron'), [DESKTOP, `--remote-debugging-port=${cdp}`], {cwd: DESKTOP, stdio: ['ignore', 'inherit', 'inherit'], detached: true,   // its own process group: lib/twin-refresh.mjs killGroup
    env: withoutWrappers({...env, JOBADABRA_TWIN: '1', JOBADABRA_USER_DATA: HOME, JOBADABRA_TWIN_NOTION_TOKEN: token, JOBADABRA_PORT: String(port), JOBADABRA_TWIN_BROWSER_CDP: `http://127.0.0.1:${browserCdp}`,
      PATH: `${shim.bin}${path.delimiter}${process.env.PATH}`, JOBADABRA_E2E_OPEN_DIR: shim.spool})});
  let app = startApp(), restarting = false;
  // A fresh browser profile at each start, with only the site sign-ins carried over (cookies, local storage) and saved back at stop.
  // A whole kept profile also kept the extension's worker state: once it ran stale background code, once (after clearing that) no worker
  // at all (8 Oct 2026). Nothing of the extension survives a restart now.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-twin-browser-'));
  const SIGN_INS = ['Cookies', 'Cookies-journal', 'Local Storage'];
  const carry = (from, to) => { for (const name of SIGN_INS) if (fs.existsSync(path.join(from, 'Default', name))) fs.cpSync(path.join(from, 'Default', name), path.join(to, 'Default', name), {recursive: true}); };
  fs.mkdirSync(path.join(profile, 'Default'), {recursive: true});
  carry(path.join(LIVE, 'browser'), profile);
  const browser = await launchBrowser({port, spool: shim.spool, extensionDir, real: true, profile, debugPort: browserCdp, installs: true});   // sign-ins carried into a NEW folder: a fresh install each start, so its settings page opens and is waited for
  // A page's own alert/confirm/"leave this page?" dialog: Playwright answers it for us, and when the page has moved on by then its answer fails with
  // "session closed" as an UNHANDLED error that ended this launcher and, with it, the twin app (9 Oct 2026, Migros, a click on the panel's Fill again).
  // The dialog is dismissed here, a failure is ignored, and nothing a stray rejection raises stops the twin.
  // "Leave this page?" (beforeunload) is ACCEPTED: you asked to leave (a reload, a closed tab); dismissing it cancelled every reload of a SuccessFactors
  // form and the tab looked stuck (owner, 9 Oct 2026). Any other dialog (alert, confirm, prompt) is still dismissed: the twin never says yes to a page.
  browser.context.on('dialog', dialog => { (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()).catch(() => {}); });
  process.on('unhandledRejection', error => say(`ignored (the twin stays up): ${String(error?.message || error).split('\n')[0].slice(0, 160)}`));
  fs.writeFileSync(path.join(LIVE, 'twin.json'), JSON.stringify({cdp: `http://127.0.0.1:${cdp}`, browser: `http://127.0.0.1:${browserCdp}`, port, app: app.pid, launcher: process.pid, repo: REPO, home: HOME, at: new Date().toISOString()}, null, 1));
  say(`running: app on port ${port}, window driver at http://127.0.0.1:${cdp} (${path.join(LIVE, 'twin.json')}); its browser is the separate Chromium window. Ctrl-C stops both. npm run twin:drive -- refresh brings it to origin/main without a restart.`);
  // Stopping always stops the app first (8 Oct 2026: a stop that awaited the browser first left the twin's app running on its ports),
  // and an exit by any path kills it as a last resort.
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await killGroup(app);
    fs.rmSync(path.join(LIVE, 'twin.json'), {force: true});
    await browser.close().catch(() => {});
    fs.rmSync(path.join(LIVE, 'browser'), {recursive: true, force: true});   // the sign-ins kept for next time, nothing else
    fs.mkdirSync(path.join(LIVE, 'browser', 'Default'), {recursive: true});
    carry(profile, path.join(LIVE, 'browser'));
    try {
      const real = JSON.parse(fs.readFileSync(path.join(REAL, 'settings.json'), 'utf8')).siteAccounts || {};
      const now = JSON.parse(fs.readFileSync(path.join(HOME, 'settings.json'), 'utf8')).siteAccounts || {};
      const learned = Object.fromEntries(Object.entries(now).filter(([host, value]) => JSON.stringify(real[host]) !== JSON.stringify(value)));
      fs.writeFileSync(ACCOUNTS, JSON.stringify(learned, null, 2));   // only what the twin learned, not a copy of the real ones
    } catch { /* no settings: nothing learned */ }
    if (fs.existsSync(path.join(HOME, 'isolated-secrets.json'))) { fs.copyFileSync(path.join(HOME, 'isolated-secrets.json'), KEPT); fs.chmodSync(KEPT, 0o600); }
    fs.rmSync(profile, {recursive: true, force: true});
    process.exit(0);
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('SIGHUP', stop);
  process.on('exit', () => { try { process.kill(-app.pid, 'SIGKILL'); } catch { /* already gone */ } });
  const watch = child => child.on('exit', code => { if (restarting) return; say(`app exited (${code})`); stop(); });
  watch(app);
  // A live update (twin:drive refresh sends SIGUSR1; lib/twin-refresh.mjs): the worktree goes to origin/main, the extension copy the browser has loaded is
  // rewritten and reloaded in place (its tabs stay), and only a change to the app's main process restarts the app, alone. The result is left in refresh.json.
  const restartApp = async () => {
    restarting = true;
    const old = app;
    await killGroup(old);
    if (!(await portsFree([port, cdp]))) throw new Error(`the app's ports ${port}/${cdp} are still taken: the app was not restarted`);
    execFileSync(process.execPath, ['scripts/stage.mjs'], {cwd: DESKTOP, stdio: 'ignore'});
    app = startApp(); watch(app); restarting = false;
    const file = path.join(LIVE, 'twin.json');
    fs.writeFileSync(file, JSON.stringify({...JSON.parse(fs.readFileSync(file, 'utf8')), app: app.pid}, null, 1));
  };
  let refreshing = false;
  process.on('SIGUSR1', async () => {
    if (refreshing) return;
    refreshing = true;
    let result;
    try {
      result = refresh({repo: REPO, extensionDir, port});
      if (!result.error && result.kinds.extension) {
        const loaded = await reloadExtension(browser.context).catch(error => ({state: `reload failed: ${String(error.message).split('\n')[0].slice(0, 100)}`}));
        result.extension = loaded.state === 'ENABLED' && loaded.running ? `reloaded (${loaded.version})` : `NOT running: ${loaded.state}`;
      }
      if (!result.error && result.kinds.app) { await restartApp(); result.app = 'restarted'; }
    } catch (error) { result = {error: String(error.message).split('\n')[0].slice(0, 200)}; }
    fs.writeFileSync(path.join(LIVE, 'refresh.json'), JSON.stringify({at: Date.now(), ...result}));
    say(`refresh: ${JSON.stringify(result)}`);
    refreshing = false;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(`twin: ${error.message}`); process.exit(1); });
