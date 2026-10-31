# A GitHub rate limit ends the PR verdict with one named line (limit, reset time), never a traceback; any other failure still raises.
import contextlib
import datetime
import importlib.util
import io
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('pr_verdict', ROOT / 'tools' / 'pr-verdict.py')
pv = importlib.util.module_from_spec(spec); spec.loader.exec_module(pv)


class TheVerdictNamesAGitHubLimit(unittest.TestCase):
    def test_a_rate_limit_ends_the_verdict_with_one_named_line_not_a_traceback(self):
        # CI run 41228178173 (31 Oct 2026): every verdict since 18:00 died with a CalledProcessError traceback; the log never said "rate limit ... reset at".
        reset = int(datetime.datetime(2026, 10, 31, 18, 30, 12, tzinfo=datetime.timezone.utc).timestamp())
        rate = lambda: {'resources': {'core': {'limit': 5000, 'remaining': 0, 'reset': reset}}}
        def refuse(): raise subprocess.CalledProcessError(1, ['gh'], stderr='failed to get runs: HTTP 403: API rate limit exceeded for installation.')
        seen = io.StringIO()
        with contextlib.redirect_stderr(seen):
            self.assertEqual(pv.run_main(refuse, rate=rate), 1)
        self.assertIn('::error::PR verdict not written: GitHub API rate limit (403 … for installation), reset at 18:30:12 UTC', seen.getvalue())

    def test_any_other_failure_still_raises(self):
        def broken(): raise subprocess.CalledProcessError(1, ['gh'], stderr='HTTP 404: Not Found')
        with self.assertRaises(subprocess.CalledProcessError):
            pv.run_main(broken, rate=lambda: None)


if __name__ == '__main__':
    unittest.main()
