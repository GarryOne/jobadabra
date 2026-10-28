"""The desktop tests run on Windows for a pull request only when it changes a file that can behave differently there (owner, 15 Oct 2026: fewer runner slots per PR);
on main every push runs them (build.yml). The list lives in one place, tests-desktop-windows.yml's `paths:`; this test keeps it complete: a desktop file that names win32,
process.platform or an .exe, and the installer and shell files, must start the Windows run, and a change that cannot reach Windows must not."""
import re
import subprocess
import unittest
from pathlib import Path

from tests.test_workflow_paths import ROOT, starts

NAME = 'tests-desktop-windows.yml'
SKIP_DIRS = {'node_modules', 'test', 'e2e', 'dist', 'assets', 'demo', 'docs'}
PLATFORM = re.compile(r'win32|process\.platform|\.exe\b|win-path|powershell|cmd\.exe')


def platform_files():
    # Tracked files only: the release build stages bundles into git-ignored folders first (desktop/shared/bot-worker.js holds node_modules'
    # process.platform; beta by hand, 15 Oct 2026, failed its Mac unit tests on it).
    out = []
    tracked = subprocess.run(['git', 'ls-files', '-z', 'desktop'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split('\0')
    for name in filter(None, tracked):
        path, rel = ROOT / name, Path(name).relative_to('desktop')
        if not path.is_file() or SKIP_DIRS & set(rel.parts) or path.suffix not in ('.js', '.mjs', '.cjs', '.sh'): continue
        if PLATFORM.search(path.read_text(encoding='utf-8', errors='ignore')): out.append(f'desktop/{rel.as_posix()}')
    return sorted(out)


class WindowsPaths(unittest.TestCase):
    def test_every_desktop_file_with_a_platform_branch_starts_windows(self):
        files = platform_files()
        self.assertGreater(len(files), 20, 'positive control: the platform files are found')
        self.assertIn('desktop/lib/credentials.js', files)
        self.assertEqual([f for f in files if not starts(NAME, [f])], [], 'add these to tests-desktop-windows.yml paths:')

    def test_a_built_file_the_release_stages_is_not_a_source_file(self):
        shared = ROOT / 'desktop' / 'shared'
        made = not shared.exists()
        probe = shared / 'zz-staged-probe.js'
        shared.mkdir(exist_ok=True)
        try:
            probe.write_text("module.exports = process.platform === 'win32';\n")
            self.assertNotIn('desktop/shared/zz-staged-probe.js', platform_files())
        finally:
            probe.unlink(missing_ok=True)
            if made: shared.rmdir()

    def test_the_installer_the_shell_and_the_tests_start_windows(self):
        for file in ('desktop/main.js', 'desktop/package.json', 'desktop/scripts/stage.mjs', 'desktop/test/credentials.test.js', 'tools/check.sh', '.github/workflows/tests-desktop-windows.yml'):
            self.assertTrue(starts(NAME, [file]), file)

    def test_a_change_that_cannot_reach_windows_does_not_start_it(self):
        for file in ('extension/fill-flow.js', 'worker/src/index.js', 'docs/ARCHITECTURE.md', 'desktop/e2e/lib/forms.mjs', 'desktop/e2e/recorded/x/case.json', 'src/daily.py', 'desktop/renderer/pages/activity.js'):
            self.assertFalse(starts(NAME, [file]), file)

    def test_main_runs_it_on_every_push(self):
        self.assertIn('uses: ./.github/workflows/tests-desktop-windows.yml', (ROOT / '.github/workflows/build.yml').read_text())
        self.assertIn('workflow_call:', (ROOT / '.github/workflows' / NAME).read_text().split('\njobs:')[0])


if __name__ == '__main__':
    unittest.main()
