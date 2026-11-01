"""tools/gate-cache.sh: a suite that passed on the same inputs is not run again; any changed input byte runs it; a failure is never cached."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HELPER = ROOT / 'tools' / 'gate-cache.sh'
IGNORE = ROOT / 'tools' / 'gate-cache-ignore.txt'


def git(cwd, *args):
    subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True)


@unittest.skipUnless(shutil.which('bash') and shutil.which('git') and shutil.which('shasum'), 'needs bash, git, shasum')
class GateCacheTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.repo = self.tmp / 'repo'
        (self.repo / 'tools').mkdir(parents=True)
        (self.repo / 'src.py').write_text('a')
        (self.repo / 'SECURITY.md').write_text('s')
        shutil.copy(IGNORE, self.repo / 'tools' / 'gate-cache-ignore.txt')
        git(self.repo, 'init', '-q', '-b', 'main')
        git(self.repo, 'config', 'user.email', 't@example.com')
        git(self.repo, 'config', 'user.name', 'T')
        self.commit('start')
        self.runs = self.tmp / 'runs'
        self.notes = self.tmp / 'notes'

    def commit(self, message):
        git(self.repo, 'add', '-A')
        git(self.repo, 'commit', '-qm', message)

    def run_area(self, area='desktop', command='echo x >> "$RUNS"', extra='', **env):
        result = subprocess.run(['bash', '-c', f'source "{HELPER}"; gate_cache_run "{self.repo}" {area} "{extra}" bash -c \'{command}\''],
                                capture_output=True, text=True,
                                env={**{k: v for k, v in os.environ.items() if not k.startswith('GATE_CACHE')}, 'RUNS': str(self.runs), 'GATE_CACHE_NOTES': str(self.notes), **env})
        return result.returncode

    def count(self):
        return len(self.runs.read_text().split()) if self.runs.exists() else 0

    def test_same_inputs_are_skipped_and_say_so(self):
        self.assertEqual(self.run_area(), 0)
        self.assertEqual(self.run_area(), 0)
        self.assertEqual(self.count(), 1)
        self.assertIn('cached pass from', self.notes.read_text())
        self.assertIn('for desktop', self.notes.read_text())

    def test_any_changed_input_byte_runs_it_again(self):
        self.run_area()
        (self.repo / 'src.py').write_text('b')
        self.commit('change')
        self.run_area()
        self.assertEqual(self.count(), 2)

    def test_area_and_extra_key_text_are_part_of_the_key(self):
        self.run_area('desktop')
        self.run_area('worker')
        self.run_area('desktop', extra='pick=2')
        self.assertEqual(self.count(), 3)

    def test_a_gate_keyed_on_its_paths_ignores_unrelated_commits_but_not_its_own_files(self):
        # The journey and ladder gates (GATE_CACHE_PATHS): a rebase over commits that touch nothing they read reuses the pass (owner, 11 Oct 2026).
        (self.repo / 'ext').mkdir()
        (self.repo / 'ext' / 'flow.js').write_text('1')
        self.commit('flow')
        paths = {'GATE_CACHE_PATHS': 'ext tools/gate.mjs'}
        self.run_area(**paths)
        (self.repo / 'src.py').write_text('unrelated')
        (self.repo / 'docs.md').write_text('docs')
        self.commit('unrelated')
        self.run_area(**paths)
        self.assertEqual(self.count(), 1)
        self.assertIn('cached pass', self.notes.read_text())
        (self.repo / 'ext' / 'flow.js').write_text('2')
        self.commit('own file')
        self.run_area(**paths)
        self.assertEqual(self.count(), 2)
        (self.repo / 'tools' / 'gate.mjs').write_text('gate')
        self.commit('the gate itself')
        self.run_area(**paths)
        self.assertEqual(self.count(), 3)
        self.run_area()   # the same area without paths keeps keying on the whole tree
        self.assertEqual(self.count(), 4)

    def test_a_path_gate_still_takes_the_extra_text_and_dirty_changes_in_its_paths_only(self):
        (self.repo / 'ext').mkdir()
        (self.repo / 'ext' / 'flow.js').write_text('1')
        self.commit('flow')
        paths = {'GATE_CACHE_PATHS': 'ext', 'GATE_CACHE_DIRTY': '1'}
        self.run_area(**paths)
        (self.repo / 'src.py').write_text('uncommitted elsewhere')
        self.run_area(**paths)
        self.assertEqual(self.count(), 1)
        (self.repo / 'ext' / 'flow.js').write_text('edited')
        self.run_area(**paths)
        self.assertEqual(self.count(), 2)
        self.run_area(extra='touched=a', **paths)
        self.assertEqual(self.count(), 3)

    def test_a_failure_is_never_cached(self):
        self.assertNotEqual(self.run_area(command='echo x >> "$RUNS"; exit 3'), 0)
        self.run_area(command='echo x >> "$RUNS"; exit 3')
        self.assertEqual(self.count(), 2)

    def test_ignored_paths_do_not_invalidate_but_others_do(self):
        self.run_area()
        (self.repo / 'SECURITY.md').write_text('t')
        self.commit('ignored file')
        self.run_area()
        self.assertEqual(self.count(), 1)
        (self.repo / 'tools' / 'x.py').write_text('x')
        self.commit('tracked file')
        self.run_area()
        self.assertEqual(self.count(), 2)

    def test_fresh_and_off_switches_run_anyway(self):
        self.run_area()
        self.run_area(GATE_CACHE_FRESH='1')
        self.run_area(GATE_CACHE='0')
        self.assertEqual(self.count(), 3)

    def test_dirty_mode_sees_uncommitted_and_untracked_files(self):
        self.run_area(GATE_CACHE_DIRTY='1')
        (self.repo / 'src.py').write_text('edited, not committed')
        self.run_area(GATE_CACHE_DIRTY='1')
        (self.repo / 'new.py').write_text('untracked')
        self.run_area(GATE_CACHE_DIRTY='1')
        self.run_area(GATE_CACHE_DIRTY='1')   # nothing changed since the last one: skipped
        self.assertEqual(self.count(), 3)

    def test_the_pass_is_shared_through_the_git_common_dir(self):
        self.run_area()
        self.assertEqual(len(list((self.repo / '.git' / 'gate-cache').iterdir())), 1)

    def test_nothing_on_the_ignore_list_is_read_by_a_test(self):
        names = [line.strip() for line in IGNORE.read_text().splitlines() if line.strip() and not line.startswith('#')]
        self.assertTrue(names)
        tests = [p for folder in ('tests', 'desktop/test', 'desktop/e2e/test', 'app-core/test', 'test') for p in (ROOT / folder).rglob('*')
                 if p.is_file() and p.suffix in ('.py', '.js', '.mjs') and p != Path(__file__).resolve()]
        for name in names:
            for test in tests:
                self.assertNotIn(name, test.read_text(errors='replace'), f'{test} reads {name}: take it off the ignore list')   # a folder keeps its '/', so the workflow file site-next.yml is not read as the folder preview/

    def test_both_hooks_use_the_cache_and_the_stop_hook_counts_uncommitted_files(self):
        push = (ROOT / 'tools' / 'pre-push-check.sh').read_text()
        stop = (ROOT / 'tools' / 'stop-test-check.sh').read_text()
        self.assertIn('gate_cache_run "$repo" "$area"', push)
        self.assertIn('GATE_CACHE_FRESH=1', push)   # PUSH_FULL=1 ignores a stored pass
        self.assertIn('GATE_CACHE_DIRTY=1', stop)
        self.assertIn('gate_cache_run "$repo" "$s"', stop)


if __name__ == '__main__':
    unittest.main()
