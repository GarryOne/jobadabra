"""Several fake `gh` processes at once on one state file (tests/fake_gh.py): none crashes on a half-written file and none loses another's record of its call.
Why (1 Nov 2026, CI run 41309674444 + 41256371919: test_ship_pr's test_review_starts_one_watcher_and_a_second_ship_replaces_it timed out at 90 s): that is the one test whose old watcher keeps
polling with the fake `gh` while the next ship uses it. Every call loaded the file, added itself to `calls` and wrote the file back with no lock and a truncating write, so two calls at the
same moment lost an update or read a torn file (a crashed fake: ship's wait loop sees no PR and spins at SHIP_PR_POLL=0 until the test's limit). Guard for: tests/fake_gh.py, tests/fake_gh_state.py."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAKE = ROOT / 'tests' / 'fake_gh.py'
PROCESSES, CALLS_EACH = 6, 40


class FakeGhConcurrencyTest(unittest.TestCase):
    def test_parallel_calls_neither_crash_nor_lose_each_others_record(self):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder) / 'gh-state.json'
            state.write_text(json.dumps({'origin': folder}))
            env = {**os.environ, 'FAKE_GH_STATE': str(state)}
            # One shell loop per process: each runs CALLS_EACH calls back to back, all PROCESSES loops at the same time (a watcher and a ship polling).
            loop = f'i=0; while [ $i -lt {CALLS_EACH} ]; do "{sys.executable}" "{FAKE}" pr list --head topic || exit 1; i=$((i+1)); done'
            runs = [subprocess.Popen(['sh', '-c', loop], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True) for _ in range(PROCESSES)]
            failures = []
            for run in runs:
                _, error = run.communicate(timeout=120)
                if run.returncode:
                    failures.append(error.strip().splitlines()[-1] if error.strip() else f'exit {run.returncode}')
            self.assertEqual(failures, [], 'a fake gh call crashed while others used the same state file')
            calls = json.loads(state.read_text()).get('calls', [])
            self.assertEqual(len(calls), PROCESSES * CALLS_EACH, 'a call was lost: two fake gh processes wrote the state file over each other')


if __name__ == '__main__':
    unittest.main()
