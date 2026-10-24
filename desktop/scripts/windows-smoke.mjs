// Windows smoke test (CI, after the installer is built): installs Jobadabra the way a user would, then checks
// the installed app, not the source tree.
//   node scripts/windows-smoke.mjs <installer.exe> <output folder> [smoke|packaging|full]
// The build stage runs `smoke` (a binary that installs and starts, about a minute: the build is not done without it), the beta gate runs `packaging`
// only when e2e follows (the slow checks the e2e cannot see because it runs from source), the weekly run (windows-smoke.yml) runs `full`.
// owner, 10 Oct 2026: a build is "compiles, unit tests pass, and a very small, fast smoke"; the rest is a gate.
//   smoke:     silent per-user install; the bundled Python imports what the pipeline and the Credential Manager need; a secret round-trips
//              through the Credential Manager; the pipeline lists (no) jobs from an empty folder; the installed app opens the Jobs list (smoke-screens.mjs).
//   packaging: the transcription add-on (not in the installer) installs with pip and loads, PyAV decodes a real file; the installer updates the
//              installed app over itself; the in-app terminal (node-pty) runs a command.
// The wizard and Settings pages are driven by the e2e wizard and settings suites, not here (welcome, wizard extras and Settings → Connections were cut).
// Any failure exits non-zero, so the release isn't published with a Windows app that doesn't start.
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {WINDOWS_INSTALLER_ARGS} from '../lib/updater.js';
import {jobsScreen} from './smoke-screens.mjs';

const [installer, out, mode = 'full'] = process.argv.slice(2);
if (!installer || !out || !['smoke', 'packaging', 'full'].includes(mode)) throw new Error('usage: node scripts/windows-smoke.mjs <installer.exe> <output folder> [smoke|packaging|full]');
const want = part => mode === 'full' || mode === part;
fs.mkdirSync(out, {recursive: true});
const t0 = Date.now();
const say = line => console.log(`• [${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s] ${line}`);   // seconds since the start: which stage makes this step slow

execFileSync(path.resolve(installer), ['/S'], {stdio: 'inherit', timeout: 5 * 60 * 1000});
const programs = path.join(process.env.LOCALAPPDATA, 'Programs');
const dir = fs.readdirSync(programs).map(name => path.join(programs, name)).find(d => fs.existsSync(path.join(d, 'Jobadabra.exe')));
if (!dir) throw new Error(`Jobadabra.exe not found under ${programs} after the install`);
const exe = path.join(dir, 'Jobadabra.exe');
const pilot = path.join(dir, 'resources', 'pilot');
const python = path.join(pilot, 'python', 'python.exe');
say(`installed: ${exe}`);

const py = (args, env = {}) => execFileSync(python, args, {cwd: pilot, encoding: 'utf8', timeout: 120000,
  env: {...process.env, PYTHONUTF8: '1', ...env}}).trim();
say(py(['-c', 'import anthropic, keyring, pip, sqlite3, ssl, sys; from importlib.metadata import version; ' +
  "print('Python', sys.version.split()[0], 'anthropic', version('anthropic'), 'keyring', version('keyring'))"]));
say(py(['-c', "from src import secret_store as s; s.put('job-pilotto.smoke.test', 'ok', 'ci'); " +
  "v = s.get('job-pilotto.smoke.test', 'ci'); s.delete('job-pilotto.smoke.test', 'ci'); " +
  "assert v == 'ok', v; assert s.get('job-pilotto.smoke.test', 'ci') is None; print('Credential Manager round-trip ok')"]));
if (want('packaging')) {
// The transcription add-on is downloaded on the first recording (src/ai/transcribe.py install_addon): do exactly that here,
// into a throwaway folder, so a Windows wheel that goes missing fails the release instead of a user's first interview.
const models = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-models-'));
say(py(['-c', "from src.ai import transcribe as t; assert not t.libraries(), 'bundled after all'; t.install_addon(); " +
  "assert t.libraries(), 'installed but not loadable'; import sherpa_onnx, numpy; print('Add-on installed:', t.addon_dir())"],
{JOB_PILOTTO_MODELS_DIR: path.join(models, 'models')}));
// The audio half of interview transcription: PyAV's bundled ffmpeg decoding a real file. The recogniser's models are
// a 520 MB download, so CI doesn't run those — but importing `av` proves nothing about whether its native codecs
// load on Windows, and this does.
say(py(['-c', `
import os, tempfile, wave
from src.ai import transcribe
transcribe.use_addon()
import av
folder = tempfile.mkdtemp(prefix='jp-av-')
path = os.path.join(folder, 'tone.wav')
with wave.open(path, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes(bytes([0, 0]) * 16000)
with av.open(path) as container:
    frames = list(container.decode(audio=0))
samples = sum(f.samples for f in frames)
assert samples >= 16000, samples
os.remove(path); os.rmdir(folder)
print('PyAV decoded', samples, 'samples at', frames[0].sample_rate, 'Hz')
`], {JOB_PILOTTO_MODELS_DIR: path.join(models, 'models')}));
}
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-smoke-data-'));
for (const sub of ['config', 'data']) fs.mkdirSync(path.join(data, sub), {recursive: true});
for (const name of fs.readdirSync(path.join(pilot, 'config')).filter(n => n.endsWith('.json'))) {
  fs.copyFileSync(path.join(pilot, 'config', name), path.join(data, 'config', name));
}
const jobs = py(['-m', 'src.desktop', 'jobs'], {JOB_PILOTTO_NO_DOTENV: '1', JOB_PILOTTO_CONFIG_DIR: path.join(data, 'config'),
  JOB_PILOTTO_DATA_DIR: path.join(data, 'data')}).split(/\r?\n/).pop();
JSON.parse(jobs);
say(`pipeline jobs list ok: ${jobs.slice(0, 80)}`);

// Updating itself (lib/updater.js, since 9 Oct 2026): the app starts the downloaded installer with WINDOWS_INSTALLER_ARGS and quits;
// the installer waits for the app to close (ends it if it lingers), installs quietly and opens the new version. Run for real here:
// the installed app is open, this same installer runs with those arguments, the old process must be gone and the app open again.
if (want('packaging')) {
  const running = () => execFileSync('tasklist', ['/FI', 'IMAGENAME eq Jobadabra.exe', '/FO', 'CSV', '/NH'], {encoding: 'utf8'})
    .split(/\r?\n/).map(line => line.split('","')[1]).filter(Boolean).map(Number);
  const wait = async (check, seconds) => { for (let i = 0; i < seconds * 4; i++) { if (check()) return true; await new Promise(resolve => setTimeout(resolve, 250)); } return false; };
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-smoke-update-'));
  const app = spawn(exe, [], {detached: true, stdio: 'ignore', env: {...process.env, JOB_PILOTTO_USER_DATA: userData}});
  app.unref();
  if (!(await wait(() => running().includes(app.pid), 60))) throw new Error('update: the installed app did not start');
  const started = Date.now();
  execFileSync(path.resolve(installer), WINDOWS_INSTALLER_ARGS, {stdio: 'inherit', timeout: 5 * 60 * 1000});
  if (running().includes(app.pid)) throw new Error('update: the installer finished while the old app was still running');
  if (!(await wait(() => running().length > 0, 60))) throw new Error(`update: the app was not opened again after installing (${WINDOWS_INSTALLER_ARGS.join(' ')})`);
  // Installed over what was there (a fresh runner never tried "replace in place" before this): the files and the bundled Python survive it.
  // That the reinstalled app starts and draws its screens is what every screen check below runs on.
  if (!fs.existsSync(exe)) throw new Error(`update: the app is gone after installing over itself: ${exe}`);
  py(['-c', 'import anthropic, keyring']);
  say(`update ok on Windows: the installer (${WINDOWS_INSTALLER_ARGS.join(' ')}) closed the open app, installed over it and reopened it in ${Date.now() - started} ms; the bundled Python still runs`);
  spawnSync('taskkill', ['/F', '/T', '/IM', 'Jobadabra.exe'], {stdio: 'ignore'});   // the next checks start the app themselves
  if (!(await wait(() => running().length === 0, 30))) throw new Error('update: the reopened app could not be closed');
}
// The in-app terminal (Apply with Claude sessions): node-pty loads in the installed app and runs a command.
if (want('packaging')) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-smoke-pty-'));
  const result = path.join(userData, 'pty.txt');
  spawnSync(exe, [], {timeout: 90000, stdio: 'inherit', env: {...process.env, JOB_PILOTTO_USER_DATA: userData,
    JOB_PILOTTO_SMOKE: path.join(userData, 'pty.png'), JOB_PILOTTO_SMOKE_JS: 'new Promise(r => setTimeout(r, 5000))', JOB_PILOTTO_PTY_SMOKE: result}});
  const text = fs.existsSync(result) ? fs.readFileSync(result, 'utf8') : 'no result file';
  if (!text.includes('pty-ok')) throw new Error(`in-app terminal: ${text.slice(0, 300)}`);
  say('in-app terminal ok (node-pty ran cmd.exe in the installed app)');
}
if (want('smoke')) await jobsScreen({exe, out, prefix: 'windows', say});
say(`Windows smoke test (${mode}) passed`);
