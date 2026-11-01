"""tools/test-log-failures.sh reads a node test log's failing files and names in either reporter's shape (12 Oct 2026: the stop hook's fingerprint exemption read only
the by-file "✖ name (test/file)" lines, its own affected-tests run writes TAP, so every session that changed extension/ was told to fix the expected fingerprint failure)."""
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAP = """ok 367 - something else
not ok 368 - the extension files match the fingerprint recorded with its version
  ---
  duration_ms: 3.1
  location: '/home/runner/work/jobadabra/jobadabra/desktop/test/extension-version.test.js:6:1'
  failureType: 'testCodeFailure'
  ...
"""
BY_FILE = """Failing tests:
  ✖ a quiet page goes on after the quiet time   (test/extension-page-still.test.js)
  ✖ the extension files match the fingerprint (12.5ms)   (test/extension-version.test.js)
"""


def run(fn, text):
    with tempfile.NamedTemporaryFile('w', suffix='.log', delete=False, encoding='utf-8') as log:
        log.write(text)
    out = subprocess.run(['bash', '-c', f'source "{ROOT}/tools/test-log-failures.sh"; {fn} "$1"', '_', log.name], capture_output=True, text=True, check=True).stdout
    return out.split('\n')[:-1] if out else []


class TestLogFailures(unittest.TestCase):
    def test_files_from_a_tap_log(self):
        self.assertEqual(run('failing_files', TAP), ['test/extension-version.test.js'])

    def test_files_from_a_by_file_log(self):
        self.assertEqual(run('failing_files', BY_FILE), ['test/extension-page-still.test.js', 'test/extension-version.test.js'])

    def test_names_from_both_shapes(self):
        self.assertIn('the extension files match the fingerprint recorded with its version', run('failing_names', TAP))
        self.assertTrue(any('a quiet page goes on' in name for name in run('failing_names', BY_FILE)))

    def test_a_passing_log_names_nothing(self):
        self.assertEqual(run('failing_files', 'ok 1 - fine\nok 2 - fine\n'), [])

    def test_the_stop_hook_uses_it_for_the_names(self):
        # (Its extension-fingerprint exemption, the other user, went with the fingerprint on 13 Oct 2026: the build stamps the version.)
        hook = (ROOT / 'tools' / 'stop-test-check.sh').read_text(encoding='utf-8')
        self.assertIn('test-log-failures.sh', hook)
        self.assertIn('failing_names "$logs/$s.log"', hook)
        self.assertNotIn("grep -E '^ *✖ '", hook, 'one reader of failure lines: tools/test-log-failures.sh')


if __name__ == '__main__':
    unittest.main()
