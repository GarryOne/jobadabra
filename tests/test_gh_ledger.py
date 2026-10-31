# The call ledger counts every gh call a job makes, by endpoint, so the next budget burst names its spender in the logs (3rd rate-limit fix; 31 Oct 2026).
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

LEDGER = Path(__file__).resolve().parents[1] / 'tools' / 'gh-ledger.sh'
BASH = shutil.which('bash')   # absolute, so a test can empty PATH (CI's runner has gh in /usr/bin: a PATH of /usr/bin:/bin is not 'no gh')


class Ledger(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        bin_dir = root / 'real'
        bin_dir.mkdir()
        (bin_dir / 'gh').write_text('#!/bin/sh\nif [ "$1 $2" = "api rate_limit" ]; then echo 4321; else echo "real gh: $*"; fi\n')
        (bin_dir / 'gh').chmod(0o755)
        self.env = {'PATH': f'{bin_dir}:/usr/bin:/bin', 'RUNNER_TEMP': str(root / 'tmp'), 'GITHUB_PATH': str(root / 'path'), 'GITHUB_JOB': 'build'}
        (root / 'path').write_text('')

    def tearDown(self):
        self.tmp.cleanup()

    def ledger(self, *args):
        return subprocess.run([BASH, str(LEDGER), *args], capture_output=True, text=True, env=self.env, check=True).stdout

    def shim_env(self):
        added = Path(self.env['GITHUB_PATH']).read_text().split()
        return {**self.env, 'PATH': f"{':'.join(added)}:{self.env['PATH']}"}

    def call(self, *args):
        return subprocess.run(['gh', *args], capture_output=True, text=True, env=self.shim_env(), check=True).stdout

    def test_calls_pass_through_and_are_counted_by_endpoint(self):
        self.ledger('start')
        self.assertEqual(self.call('run', 'list', '-R', 'o/r', '-L', '100'), 'real gh: run list -R o/r -L 100\n')
        for run_id in ('41226261602', '41226261603', '41226261604'):
            self.call('api', f'repos/o/r/actions/runs/{run_id}/jobs?per_page=100')
        self.call('api', '--paginate', 'repos/o/r/pulls/12/files', '--jq', '.[].filename')
        report = self.ledger('end')
        self.assertIn('ledger: job build: 5 gh calls', report)
        self.assertIn('3 api repos/o/r/actions/runs/N/jobs', report)
        self.assertIn('1 run list', report)
        self.assertIn('1 api repos/o/r/pulls/N/files', report)

    def test_the_free_rate_limit_read_is_not_counted_and_the_remainder_is_shown(self):
        self.ledger('start')
        self.call('api', 'rate_limit')
        report = self.ledger('end')
        self.assertIn('ledger: job build: 0 gh calls', report)
        self.assertIn('REST left in the budget: 4321', report)
        self.assertIn('the budget fell by 0 while this job ran', report)

    def test_a_job_with_no_gh_still_reports_and_never_fails(self):
        empty = Path(self.tmp.name) / 'empty'
        empty.mkdir()
        self.env['PATH'] = str(empty)
        self.assertIn('no gh on PATH', self.ledger('start'))
        self.assertIn('ledger: job build: no count', self.ledger('end'))

    def test_a_windows_job_reports_only_the_budget_delta(self):
        self.env['RUNNER_OS'] = 'Windows'
        self.ledger('start')
        self.assertEqual(Path(self.env['GITHUB_PATH']).read_text(), '')   # no shim in front of gh.exe
        report = self.ledger('end')
        self.assertIn('gh calls not counted on Windows', report)
        self.assertIn('the budget fell by 0 while this job ran', report)


WORKFLOWS = ('desktop', 'e2e', 'e2e-windows', 'pr-suites', 'pr-verdict', 'search-personas', 'ui-verdict')   # the busiest users of the repo's API budget (runs per hour, 31 Oct 2026); ui-verdict is the one measured to burst (12 judge jobs x 170 event pages)


class EveryCheckedOutJobKeepsTheLedger(unittest.TestCase):
    """A new job in these workflows must count its gh calls: the next budget burst is named from these lines, not guessed from timing."""

    def jobs(self, name):
        import re
        text = (Path(__file__).resolve().parents[1] / '.github' / 'workflows' / f'{name}.yml').read_text()
        body = text.split('\njobs:\n', 1)[1]
        parts = re.split(r'\n(?=  [A-Za-z0-9_-]+:\s*\n)', '\n' + body)
        return {part.strip().split(':', 1)[0]: part for part in parts if part.strip()}

    def test_each_job_with_a_checkout_starts_and_ends_the_ledger(self):
        missing = []
        for name in WORKFLOWS:
            for job, text in self.jobs(name).items():
                if 'uses: actions/checkout@' not in text or '    steps:' not in text:
                    continue   # no checkout: the tools are not there to count with (nothing-tested, windows in e2e.yml); a reusable-workflow caller
                counted = ('phase: start' in text and 'phase: end' in text) or ('gh-ledger.sh start' in text and 'gh-ledger.sh end' in text)
                if not counted:
                    missing.append(f'{name}.yml {job}')
                mark = max(text.rfind('phase: end'), text.rfind('gh-ledger.sh end'))
                if counted and 'if: always()' not in text[max(0, mark - 160):mark + 60]:
                    missing.append(f'{name}.yml {job}: the end step must run if: always()')
        self.assertEqual(missing, [], 'add the gh-ledger start step after the checkout and the end step (if: always()) last')


if __name__ == "__main__":
    unittest.main()
