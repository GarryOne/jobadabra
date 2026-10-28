"""tools/linked-modules-guard.py: an npm install/ci/update through a node_modules that is a link into another checkout is refused before npm
empties the folder it points at (28 Oct 2026: `npm ci` in a worktree wiped the shared desktop/node_modules for every worktree)."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUARD = ROOT / 'tools' / 'linked-modules-guard.py'


def run_guard(command, cwd):
    return subprocess.run(['python3', str(GUARD)], input=json.dumps({'tool_input': {'command': command}, 'cwd': str(cwd)}), capture_output=True, text=True)


class LinkedModulesGuardTest(unittest.TestCase):
    def setUp(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        shared = tmp / 'main' / 'desktop' / 'node_modules'
        shared.mkdir(parents=True)
        (shared / 'kept.txt').write_text('x')
        self.tree = tmp / 'tree'
        (self.tree / 'desktop').mkdir(parents=True)
        (self.tree / 'worker').mkdir()
        (self.tree / '.git').mkdir()
        os.symlink(shared, self.tree / 'desktop' / 'node_modules')
        (self.tree / 'worker' / 'node_modules').mkdir()   # a real folder
        self.other = tmp / 'other'   # a checkout that owns its folders
        (self.other / 'desktop' / 'node_modules').mkdir(parents=True)
        (self.other / '.git').mkdir()

    def test_an_npm_install_is_refused_whatever_its_shell_form_while_a_package_dir_is_linked(self):
        d = self.tree / 'desktop'
        for command, cwd in [('npm ci', d), ('npm install --silent', d), (f'cd {d} && npm ci --silent', self.tree), ('(cd desktop && npm ci)', self.tree),
                             ('npm --prefix=desktop ci', self.tree), ('npm --prefix desktop ci', self.tree), ('npm i left-pad', d), ('npm update', d),
                             ('cd desktop; npm install', self.tree), ('echo go | npm ci', d), ('npm ci', self.tree / 'worker')]:
            with self.subTest(command=command):
                result = run_guard(command, cwd)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn('tools/worktree.sh own-modules desktop', result.stderr)

    def test_runs_that_do_not_install_are_left_alone(self):
        d = self.tree / 'desktop'
        for command, cwd in [('npm test', d), ('npm run lint', d), ('npm run install-hooks', d), ('node --test test/x.test.js', d), ('git status', self.tree),
                             ('ls', d)]:
            with self.subTest(command=command):
                self.assertEqual(run_guard(command, cwd).returncode, 0)

    def test_a_checkout_with_real_folders_may_install(self):
        for command in ('npm ci', 'npm install --silent'):
            with self.subTest(command=command):
                self.assertEqual(run_guard(command, self.other).returncode, 0)

    def test_own_modules_unlinks_the_worktree_and_leaves_the_shared_folder_whole(self):
        shared = (self.tree / 'desktop' / 'node_modules').resolve()
        subprocess.run(['git', 'init', '-q'], cwd=self.tree, check=True)
        script = ROOT / 'tools' / 'worktree.sh'
        result = subprocess.run(['sh', str(script), 'own-modules', 'desktop'], cwd=self.tree, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.tree / 'desktop' / 'node_modules').is_symlink())
        self.assertTrue((shared / 'kept.txt').exists(), 'the shared folder lost its files')
        self.assertEqual(run_guard('npm ci', self.tree / 'desktop').returncode, 0)   # no link left: the install may go on


if __name__ == '__main__':
    unittest.main()
