// The parts of the upgrade + data test that differ by OS or only write files: how an old release is installed and swapped for the new build, and the plain files a demo person owns.
// Used by upgrade-data-proof.mjs on CI only; fake people and companies, never anybody's data (spec 2026-11-01-upgrade-data-test-design.md).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {WINDOWS_INSTALLER_ARGS} from '../lib/updater.js';

const FIVE_MINUTES = 5 * 60 * 1000;

/** The data folder's plain files, as a person who finished setup and kept the data on this Mac would have them (settings.json is what makes the app open the Jobs list). */
export function seedFiles(userData) {
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(userData, rel)), {recursive: true}); fs.writeFileSync(path.join(userData, rel), text); };
  write('settings.json', JSON.stringify({setupDone: true, store: 'sqlite', autoSearch: false, lastSearchAt: '2099-01-01T00:00:00.000Z'}, null, 2));
  write('profile.md', '# Ada Example\n\nA careful nurse with ten years on a surgical ward.\n');
  write('answers.md', '## Why do you want this job?\nBecause I like the team.\n\n## Notice period\nTwo months.\n');
  write('knowledge.md', '- Prefers day shifts\n- Speaks German and English\n');
  write('portrait.md', 'Ada values steady teams and clear handovers.\n');
  write('cv.pdf', '%PDF-1.4\n% a demo CV, not a real one\n');
  write('cv/cv.json', JSON.stringify({summary: 'Nurse, ten years', skills: ['triage', 'wound care']}));
  write('config/search.json', JSON.stringify({roles: ['Nurse'], places: ['Zurich', 'Berlin']}, null, 2));
}

/** The OS's way of installing a release and updating it: {install(archive), update(archive), remove(), layout()} where layout() is {exe, pilot, python}. */
export function platform(os = process.platform) {
  if (os === 'darwin') {
    const app = '/Applications/Jobadabra.app';   // the Mac build's productName; a user's Mac runs it from here
    const layout = () => ({exe: path.join(app, 'Contents', 'MacOS', fs.readdirSync(path.join(app, 'Contents', 'MacOS'))[0]),
      pilot: path.join(app, 'Contents', 'Resources', 'pilot'), python: path.join(app, 'Contents', 'Resources', 'pilot', 'python', 'bin', 'python3')});
    const install = archive => {
      if (!process.env.CI) throw new Error('the upgrade test puts apps in /Applications and runs only on CI (CI=true)');
      if (fs.existsSync(app)) throw new Error(`${app} already exists: not replacing it`);
      execFileSync('ditto', ['-x', '-k', path.resolve(archive), '/Applications'], {stdio: 'inherit'});   // ditto keeps the bundle's symlinks and signature
      return layout();
    };
    const remove = () => fs.rmSync(app, {recursive: true, force: true});
    return {install, remove, layout, update: archive => { remove(); return install(archive); }};
  }
  if (os === 'win32') {
    const layout = () => {
      const programs = path.join(process.env.LOCALAPPDATA, 'Programs');
      const dir = fs.readdirSync(programs).map(name => path.join(programs, name)).find(d => fs.existsSync(path.join(d, 'Jobadabra.exe')));
      if (!dir) throw new Error(`Jobadabra.exe not found under ${programs}`);
      const pilot = path.join(dir, 'resources', 'pilot');
      return {exe: path.join(dir, 'Jobadabra.exe'), pilot, python: path.join(pilot, 'python', 'python.exe')};
    };
    const run = args => (installer) => { execFileSync(path.resolve(installer), args, {stdio: 'inherit', timeout: FIVE_MINUTES}); return layout(); };
    // The update runs the updater's own arguments (lib/updater.js), without --force-run: nobody opens the app from the installer here (as windows-upgrade-proof.mjs does).
    const update = async installer => { run([...WINDOWS_INSTALLER_ARGS.filter(arg => arg !== '--force-run'), '/S'])(installer); await new Promise(resolve => setTimeout(resolve, 5000)); return layout(); };
    return {install: run(['/S']), update, remove: () => {}, layout};   // the next release installs over this one
  }
  throw new Error(`the upgrade test runs on macOS and Windows, not ${os}`);
}
