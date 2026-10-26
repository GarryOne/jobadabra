"""No CI job writes a GitHub step summary (owner, 26 Oct 2026: "let's remove all the summaries"; a run page was a wall of "apply-1of2 summary" boxes).

What a person needs from a run lives in the job log, ::error/::warning annotations and the PR status "All checks passed" (tools/pr-verdict.py).
This scans every tracked file but Markdown (docs may tell the history) for a write to $GITHUB_STEP_SUMMARY or @actions/core's summary.
"""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WRITES = re.compile(r'GITHUB_STEP_SUMMARY|\bcore\.summary\b')
SELF = Path(__file__).resolve().relative_to(ROOT).as_posix()


def tracked():
    out = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True, check=True).stdout.decode('utf-8', 'replace')
    return [name for name in out.split('\0') if name and name != SELF and not name.endswith('.md') and '/node_modules/' not in f'/{name}']


class NoStepSummaries(unittest.TestCase):
    def test_the_scan_reads_the_places_ci_runs(self):
        names = tracked()
        for place in ('.github/workflows/', 'desktop/e2e/', 'tools/'):
            self.assertTrue(any(name.startswith(place) for name in names), f'nothing tracked under {place}: the scan reads nothing there')

    def test_no_workflow_or_script_writes_a_step_summary(self):
        bad = []
        for name in tracked():
            path = ROOT / name
            if not path.is_file():
                continue
            try:
                text = path.read_text(encoding='utf-8')
            except (UnicodeDecodeError, OSError):
                continue
            bad += [f'{name}:{number}: {line.strip()[:100]}' for number, line in enumerate(text.splitlines(), 1) if WRITES.search(line)]
        self.assertEqual(bad, [], 'print it to the log (echo, console.log, print) or as an ::error/::warning annotation; no step summaries')


if __name__ == '__main__':
    unittest.main()
