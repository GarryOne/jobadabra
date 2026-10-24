// Upgrade proof for the Windows installer (CI): install the last released installer, then this build over it with the updater's own arguments,
// and check what a user would see: one uninstall entry, no leftover shortcut or executable under the old name, the data folder kept, and the
// updater still able to find this platform's download in the latest release.
//   node scripts/windows-upgrade-proof.mjs <old installer.exe> <new installer.exe>
// Why (owner, 25 Oct 2026, renaming Job Pilotto.exe to Jobadabra.exe): a changed executableName / shortcutName can leave a second install.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LEGACY_NAME} from '../lib/app-identity.js';
import {WINDOWS_INSTALLER_ARGS, asset} from '../lib/updater.js';

const [oldInstaller, newInstaller] = process.argv.slice(2);
if (!oldInstaller || !newInstaller) throw new Error('usage: node scripts/windows-upgrade-proof.mjs <old installer.exe> <new installer.exe>');
const say = line => console.log(`• ${line}`);
const ps = script => execFileSync('powershell', ['-NoProfile', '-Command', script], {encoding: 'utf8'}).trim();

const programs = path.join(process.env.LOCALAPPDATA, 'Programs');
const shortcutFolders = [path.join(os.homedir(), 'Desktop'), path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')];
const state = () => ({
  exes: fs.readdirSync(programs).flatMap(dir => { try { return fs.readdirSync(path.join(programs, dir)).filter(name => name.endsWith('.exe') && /^(Job Pilotto|Jobadabra)\.exe$/.test(name)).map(name => path.join(dir, name)); } catch { return []; } }),
  shortcuts: shortcutFolders.flatMap(dir => { try { return fs.readdirSync(dir).filter(name => /^(Job Pilotto|Jobadabra)\.lnk$/.test(name)).map(name => path.join(path.basename(dir), name)); } catch { return []; } }),
  uninstall: ps(`Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '${LEGACY_NAME}|Jobadabra' } | ForEach-Object { $_.DisplayName }`).split(/\r?\n/).filter(Boolean),
});

execFileSync(path.resolve(oldInstaller), ['/S'], {stdio: 'inherit', timeout: 5 * 60 * 1000});
const dataFolder = path.join(process.env.APPDATA, LEGACY_NAME);   // lib/app-identity.js keeps the data folder under the legacy name
fs.mkdirSync(dataFolder, {recursive: true});
const sentinel = path.join(dataFolder, 'upgrade-proof.txt');
fs.writeFileSync(sentinel, 'kept');
const before = state();
say(`before: ${JSON.stringify(before)}`);

execFileSync(path.resolve(newInstaller), [...WINDOWS_INSTALLER_ARGS.filter(arg => arg !== '--force-run'), '/S'], {stdio: 'inherit', timeout: 5 * 60 * 1000});
await new Promise(resolve => setTimeout(resolve, 5000));
const after = state();
say(`after: ${JSON.stringify(after)}`);

const problems = [];
if (after.uninstall.length !== 1) problems.push(`${after.uninstall.length} uninstall entries after the upgrade (${after.uninstall.join(', ')}), expected 1`);
if (after.exes.filter(exe => exe.endsWith('Jobadabra.exe')).length !== 1) problems.push(`Jobadabra.exe not installed exactly once: ${after.exes.join(', ')}`);
if (after.exes.some(exe => exe.endsWith(`${LEGACY_NAME}.exe`))) problems.push(`the old ${LEGACY_NAME}.exe is still installed: ${after.exes.join(', ')}`);
if (after.shortcuts.some(link => link.endsWith(`${LEGACY_NAME}.lnk`))) problems.push(`a leftover ${LEGACY_NAME} shortcut: ${after.shortcuts.join(', ')}`);
if (!after.shortcuts.some(link => link.endsWith('Jobadabra.lnk'))) problems.push(`no Jobadabra shortcut: ${after.shortcuts.join(', ')}`);
if (!fs.existsSync(sentinel) || fs.readFileSync(sentinel, 'utf8') !== 'kept') problems.push(`the data folder lost its file: ${sentinel}`);

// The updater: the latest release still offers this platform's installer (it finds it by name, not by the executable inside).
const latest = JSON.parse(execFileSync('gh', ['api', `repos/${process.env.GITHUB_REPOSITORY}/releases/latest`], {encoding: 'utf8'}));
if (!asset(latest, 'win32')) problems.push(`the updater finds no Windows installer in release ${latest.tag_name}`);

if (problems.length) throw new Error(`upgrade proof failed:\n- ${problems.join('\n- ')}`);
say('upgrade ok: one uninstall entry, no leftover old-name exe or shortcut, data folder kept, the updater still finds the Windows installer');
