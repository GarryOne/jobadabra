"""The by-hand "repeat one harness test file" dispatch of harness.yml plays the file `repeat` times in a row and stops at the first red.

Why (owner's manifest, 1 Nov 2026: "Do not present your solution to me until the script successfully registers 20/20 clean runs"): a real-browser or real-app harness test cannot be
looped on the Mac (the E2E_LOCAL_OK hook), so the loop runs on the Linux runner. The loop is shell inside the workflow; this test runs that very script with a stand-in `node`.
"""
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parent.parent / '.github/workflows/harness.yml'
STEP = 'One harness test file, repeated (by hand)'


def script():
    """The `run: |` text of the repeat step, un-indented."""
    text = WORKFLOW.read_text()
    chunk = text.split(f'- name: {STEP}\n', 1)[1].split('\n      - ', 1)[0]
    body = chunk.split('        run: |\n', 1)[1]
    return '\n'.join(line[10:] for line in body.splitlines())


@unittest.skipIf(os.name == 'nt' or not shutil.which('bash'), 'the step runs in bash on the Linux runner')
class HarnessRepeatDispatch(unittest.TestCase):
    def play(self, file, repeat, red_on=None):
        """Run the step's script in a folder holding test/ok.test.mjs, with a `node` that fails on its `red_on`-th call. Returns (exit code, output, node calls)."""
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'test').mkdir()
            (Path(folder) / 'test/ok.test.mjs').write_text('')
            bin_dir = Path(folder) / 'bin'
            bin_dir.mkdir()
            node = bin_dir / 'node'
            node.write_text('#!/bin/sh\necho x >> "$CALLS"\n[ "$(wc -l < "$CALLS")" -ne "${RED_ON:-0}" ]\n')
            node.chmod(0o755)
            calls = Path(folder) / 'calls'
            env = {**os.environ, 'PATH': f'{bin_dir}:{os.environ["PATH"]}', 'TEST_FILE': file, 'REPEAT': repeat, 'CALLS': str(calls), 'RED_ON': str(red_on or 0)}
            done = subprocess.run(['bash', '-c', script()], cwd=folder, env=env, capture_output=True, text=True)
            return done.returncode, done.stdout + done.stderr, len(calls.read_text().splitlines()) if calls.exists() else 0

    def test_the_dispatch_takes_a_file_and_a_repeat_of_20_and_never_runs_on_its_own(self):
        text = WORKFLOW.read_text()
        self.assertRegex(text, r"(?s)workflow_dispatch:\n    inputs:\n      file:.*?required: true.*?      repeat:.*?default: '20'")
        self.assertIn("if: github.event_name == 'workflow_dispatch'", text.split(f'- name: {STEP}', 1)[1].split('run:', 1)[0])
        every = text.split('- name: Every harness test\n', 1)[1].split('run:', 1)[0]
        self.assertIn("if: github.event_name != 'workflow_dispatch'", every, 'the whole-folder run must not also start on a dispatch')

    def test_a_dispatch_gets_a_job_budget_for_up_to_50_runs_and_a_pr_run_keeps_20_minutes(self):
        job = re.search(r"(?m)^    timeout-minutes: (.+)$", WORKFLOW.read_text()).group(1)
        self.assertIn("github.event_name == 'workflow_dispatch'", job, 'the 20-minute job budget was sized for one npm test pass, not for 50 runs of a real-browser file')
        self.assertRegex(job, r'&& 180 \|\| 20')

    def test_all_green_plays_the_file_repeat_times(self):
        code, out, calls = self.play('test/ok.test.mjs', '4')
        self.assertEqual((code, calls), (0, 4), out)
        self.assertIn('4/4 green: test/ok.test.mjs', out)

    def test_the_first_red_stops_the_loop_and_says_which_run(self):
        code, out, calls = self.play('test/ok.test.mjs', '5', red_on=3)
        self.assertEqual((code, calls), (1, 3), out)
        self.assertIn('red on run 3 of 5: test/ok.test.mjs', out)

    def test_a_bad_file_or_repeat_is_refused_before_anything_runs(self):
        for file, repeat in [('ok.test.mjs', '2'), ('test/../ok.test.mjs', '2'), ('test/a b.test.mjs', '2'), ('test/ok.test.mjs;ls', '2'), ('test/missing.test.mjs', '2'),
                             ('test/ok.test.mjs', '0'), ('test/ok.test.mjs', '51'), ('test/ok.test.mjs', 'abc'), ('test/ok.test.mjs', '1;ls'), ('test/ok.test.mjs', '')]:
            with self.subTest(file=file, repeat=repeat):
                code, out, calls = self.play(file, repeat)
                self.assertEqual((code, calls), (1, 0), out)


if __name__ == '__main__':
    unittest.main()
