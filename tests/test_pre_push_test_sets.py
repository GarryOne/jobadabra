"""The push hook runs the harness test-sets check, so a new desktop/e2e test file in no set is blocked before its PR opens red (26 Oct 2026, #1976: coverage.test.mjs)."""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class PushHookTestSets(unittest.TestCase):
    def test_the_hook_runs_the_same_test_ci_runs(self):
        hook = (ROOT / 'tools' / 'pre-push-check.sh').read_text(encoding='utf8')
        self.assertIn('node --test test/test-sets.test.mjs', hook)
        self.assertIn("grep -q '^desktop/e2e/test'", hook, 'only a push touching the harness tests pays for it')

    def test_it_fails_on_a_test_file_in_no_set(self):
        stray = ROOT / 'desktop' / 'e2e' / 'test' / 'zz-stray-set-check.test.mjs'
        stray.write_text('// stray file for tests/test_pre_push_test_sets.py\n', encoding='utf8')
        try:
            done = subprocess.run(['node', '--test', 'test/test-sets.test.mjs'], cwd=ROOT / 'desktop' / 'e2e', capture_output=True, text=True)
        finally:
            stray.unlink()
        self.assertNotEqual(done.returncode, 0)
        self.assertIn('zz-stray-set-check.test.mjs', done.stdout + done.stderr)


if __name__ == '__main__':
    unittest.main()
