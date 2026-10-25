"""The download file names of a release (tools/release-file-names.sh): Jobadabra-* are the names, Job-Pilotto-* are copies kept so the 0.8.27 app and old links keep updating.
Also what desktop.yml uploads and the updater and the site read, so a name added in one place and missing in another fails here. Fake gh on PATH: no network."""
import os
import re
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'tools' / 'release-file-names.sh'
MAC = {'Jobadabra-0.9.1-arm64.dmg', 'Jobadabra-0.9.1-arm64.zip', 'Jobadabra-mac-arm64.dmg', 'Jobadabra-mac-arm64.zip',
       'Job-Pilotto-0.9.1-arm64.dmg', 'Job-Pilotto-0.9.1-arm64.zip', 'Job-Pilotto-mac-arm64.dmg', 'Job-Pilotto-mac-arm64.zip'}
WINDOWS = {'Jobadabra-0.9.1-x64.exe', 'Jobadabra-windows-x64.exe', 'Job-Pilotto-0.9.1-x64.exe', 'Job-Pilotto-windows-x64.exe'}


class FileNamesTests(unittest.TestCase):
    def make(self, platform, built):
        with tempfile.TemporaryDirectory() as dist:
            for name in built:
                (Path(dist) / name).write_text(name)
            out = subprocess.run(['bash', str(SCRIPT), 'make', platform, '0.9.1', dist], capture_output=True, text=True, check=True).stdout.split()
            names = {Path(line).name for line in out}
            for name in names:   # every name is a real file, a copy of the built one
                self.assertTrue((Path(dist) / name).exists(), name)
            return names, {name: (Path(dist) / name).read_text() for name in names}

    def test_make_gives_every_name_of_each_platform(self):
        names, _ = self.make('mac', ['Jobadabra-0.9.1-arm64.dmg', 'Jobadabra-0.9.1-arm64.zip'])
        self.assertEqual(names, MAC)
        names, texts = self.make('windows', ['Jobadabra-0.9.1-x64.exe'])
        self.assertEqual(names, WINDOWS)
        self.assertEqual(set(texts.values()), {'Jobadabra-0.9.1-x64.exe'}, 'the old names are copies of the same bytes')

    def check(self, platform, assets):
        with tempfile.TemporaryDirectory() as folder:
            gh = Path(folder) / 'gh'
            gh.write_text('#!/usr/bin/env bash\nprintf "%s\\n" $FAKE_ASSETS\n')
            gh.chmod(0o755)
            env = {**os.environ, 'PATH': f'{folder}{os.pathsep}{os.environ["PATH"]}', 'FAKE_ASSETS': ' '.join(sorted(assets))}
            return subprocess.run(['bash', str(SCRIPT), 'check', platform, 'desktop-v0.9.1'], capture_output=True, text=True, env=env)

    def test_check_needs_the_new_names_and_the_old_copies(self):
        self.assertEqual(self.check('mac', MAC).returncode, 0)
        self.assertEqual(self.check('windows', WINDOWS).returncode, 0)
        for gone in ('Jobadabra-mac-arm64.zip', 'Job-Pilotto-mac-arm64.dmg', 'Jobadabra-0.9.1-arm64.dmg'):
            done = self.check('mac', MAC - {gone})
            self.assertEqual(done.returncode, 1, gone)
            self.assertIn(gone, done.stderr)
        self.assertEqual(self.check('windows', WINDOWS - {'Job-Pilotto-windows-x64.exe'}).returncode, 1)

    def test_the_workflow_and_the_builder_use_these_names(self):
        workflow = (ROOT / '.github/workflows/desktop.yml').read_text()
        self.assertEqual(workflow.count('release-file-names.sh" make'), 2)
        self.assertEqual(workflow.count('release-file-names.sh" check'), 2)
        self.assertIn('"artifactName": "Jobadabra-${version}-${arch}.${ext}"', (ROOT / 'desktop/package.json').read_text())

    def test_the_release_notes_say_the_new_names(self):
        notes = (ROOT / 'desktop/scripts/release-notes.sh').read_text()
        self.assertIn('**Jobadabra-mac-arm64.dmg**', notes)
        self.assertIn('**Jobadabra-windows-x64.exe**', notes)
        self.assertNotRegex(re.sub(r'#.*', '', notes), r'\*\*Job-Pilotto-')

    def test_the_old_names_stay_while_old_updaters_exist(self):
        # Dropping them needs telemetry showing no active install on 0.8.27 or earlier (RELEASE.md §1): change this test in that PR, with the evidence.
        names, _ = self.make('mac', ['Jobadabra-0.9.1-arm64.dmg', 'Jobadabra-0.9.1-arm64.zip'])
        self.assertTrue({n for n in names if n.startswith('Job-Pilotto-')}, 'the Job-Pilotto-* copies are still made')
        updater = (ROOT / 'desktop/lib/updater.js').read_text()
        for pattern in ('Job-Pilotto-[\\d.]+', 'Job-Pilotto-mac-arm64', 'Job-Pilotto-windows-x64', 'Jobadabra-[\\d.]+', 'Jobadabra-mac-arm64', 'Jobadabra-windows-x64'):
            self.assertIn(pattern, updater, 'the updater matches both names')
        self.assertIn('Job-Pilotto-0.8.27', (ROOT / 'desktop/test/updater.test.js').read_text())
        self.assertIn('stop by evidence', (ROOT / 'RELEASE.md').read_text())


if __name__ == '__main__':
    unittest.main()
