// Mac smoke test (CI, after the app is built): unpacks the built .zip the way a user's Mac would and checks the packaged app, not the source tree.
//   node scripts/mac-smoke.mjs <Jobadabra-….zip> <output folder>
// Checks, about 1 minute: the bundled Python imports what the pipeline needs and lists (no) jobs from an empty folder; a secret round-trips through the Keychain;
// the signature is valid; the packaged binary runs and its native terminal module loads; the app opens the Jobs list (smoke-screens.mjs).
// owner, 10 Oct 2026: a build is "compiles, unit tests pass, and a very small, fast smoke", the same on Mac and Windows; the Mac had none.
// Any failure exits non-zero, so the release isn't published with a Mac app that doesn't start.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {jobsScreen} from './smoke-screens.mjs';

const [archive, out] = process.argv.slice(2);
if (!archive || !out) throw new Error('usage: node scripts/mac-smoke.mjs <Jobadabra-….zip> <output folder>');
fs.mkdirSync(out, {recursive: true});
const t0 = Date.now();
const say = line => console.log(`• [${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s] ${line}`);

// Installed where a user puts it, /Applications: a packaged Mac app running from anywhere else opens a native "Move to Applications?" question (lib/applications.js
// offerMove) before it makes its window, and on a runner nobody answers it (10 Oct 2026: no window for 60 s, the process sampled idle). CI only: this puts a copy
// in /Applications, which must never replace somebody's real install.
if (!process.env.CI) throw new Error('mac-smoke.mjs installs into /Applications and runs only on CI (CI=true)');
const app = '/Applications/Jobadabra.app';   // the Mac build's productName (npm run build); Windows keeps its install folder
if (fs.existsSync(app)) throw new Error(`${app} already exists: not replacing it`);
execFileSync('ditto', ['-x', '-k', path.resolve(archive), '/Applications'], {stdio: 'inherit'});   // ditto keeps the bundle's symlinks and signature, unzip may not
if (!fs.existsSync(app)) throw new Error(`no ${app} inside ${archive}`);
const exe = path.join(app, 'Contents', 'MacOS', fs.readdirSync(path.join(app, 'Contents', 'MacOS'))[0]);
// The signature first, before anything runs from the bundle: running its Python writes .pyc files into it, and a file the seal does not list breaks the seal
// (10 Oct 2026: "a sealed resource is missing or invalid" on a build that was fine).
execFileSync('codesign', ['--verify', '--deep', '--strict', app], {stdio: 'inherit'});
say('codesign: the signature is valid');
const pilot = path.join(app, 'Contents', 'Resources', 'pilot');
const python = path.join(pilot, 'python', 'bin', 'python3');
if (!fs.existsSync(python)) throw new Error(`the bundled Python is missing: ${python}`);
say(`installed: ${app}`);

const py = (args, env = {}) => execFileSync(python, args, {cwd: pilot, encoding: 'utf8', timeout: 120000, env: {...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', ...env}}).trim();
// no keyring here: on the Mac src/secret_store.py talks to the Keychain through the `security` tool (keyring is the Windows Credential Manager's)
say(py(['-c', 'import anthropic, sqlite3, ssl, sys; from importlib.metadata import version; ' +
  "print('Python', sys.version.split()[0], 'anthropic', version('anthropic'))"]));
say(py(['-c', "from src import secret_store as s; s.put('job-pilotto.smoke.test', 'ok', 'ci'); " +
  "v = s.get('job-pilotto.smoke.test', 'ci'); s.delete('job-pilotto.smoke.test', 'ci'); " +
  "assert v == 'ok', v; assert s.get('job-pilotto.smoke.test', 'ci') is None; print('Keychain round-trip ok')"]));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-smoke-data-'));
for (const sub of ['config', 'data']) fs.mkdirSync(path.join(data, sub), {recursive: true});
for (const name of fs.readdirSync(path.join(pilot, 'config')).filter(n => n.endsWith('.json'))) fs.copyFileSync(path.join(pilot, 'config', name), path.join(data, 'config', name));
const jobs = py(['-m', 'src.desktop', 'jobs'], {JOB_PILOTTO_NO_DOTENV: '1', JOB_PILOTTO_CONFIG_DIR: path.join(data, 'config'),
  JOB_PILOTTO_DATA_DIR: path.join(data, 'data')}).split(/\r?\n/).pop();
JSON.parse(jobs);
say(`pipeline jobs list ok: ${jobs.slice(0, 80)}`);

// The packaged binary itself, with no window and no Keychain prompt: ELECTRON_RUN_AS_NODE makes it run a little Node code, which proves the signature holds, the Electron
// runtime starts, and the native terminal module (node-pty, unpacked from the asar) loads. Opening the window on a bare CI Mac hung (10 Oct 2026: a smoke run sat for
// minutes after the Python checks): the window comes last, with a hard timeout and the app's own output, so a hang names its cause.
const asNode = code => execFileSync(exe, ['-e', code, path.join(app, 'Contents', 'Resources')], {encoding: 'utf8', timeout: 60000, env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}}).trim();
say(asNode("console.log('Electron', process.versions.electron, 'runs the packaged binary')"));
say(asNode(`const path = require('path'); const pty = require(path.join(process.argv[1], 'app.asar.unpacked', 'node_modules', '@lydell', 'node-pty'));
  if (typeof pty.spawn !== 'function') throw new Error('node-pty loaded without spawn'); console.log('node-pty loads (its native module is in the app)')`));
await jobsScreen({exe, out, prefix: 'mac', say});   // last: the one check that opens a window
say('Mac smoke test passed');
