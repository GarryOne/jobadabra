"""A red first try's retry repeats only its red steps and their setup (owner, 27 Oct 2026: "Retry only the red steps"). Main's quality, 27 Oct 2026
(run 40440720029): one red step on the first try, then a whole-suite retry on fresh AI ran out of the 7-minute budget and was called "a real failure".
The step list comes from the first try's suite-failures.json (desktop/e2e/red-steps.mjs); with no step to name, the whole suite runs."""
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github/workflows'


def retry_steps(text):
    return [step for step in re.split(r'(?m)^      - ', text)[1:] if step.startswith('name: "First try failed')]


class RetryRedStepsTests(unittest.TestCase):
    def test_every_retry_names_the_red_steps_before_it_runs(self):
        for name in ('e2e.yml', 'desktop.yml'):
            steps = retry_steps((WORKFLOWS / name).read_text())
            with self.subTest(file=name):
                self.assertEqual(len(steps), 1, 'one retry step')
                step = steps[0]
                pick = step.index('node red-steps.mjs "$first/suite-failures.json"')
                self.assertLess(pick, step.index('export E2E_STEP_NAMES="$red"'))
                self.assertLess(pick, step.index('if again ${{ matrix.suite }}'))
                self.assertNotIn('Red again with the whole suite', step)

    def test_every_workflow_that_runs_picked_steps_runs_whole_on_a_renamed_pick(self):
        # 26-27 Oct 2026: 19 of 54 e2e reds were a picked step renamed since the coverage map; on Windows (no retry) each one failed the PR.
        for path in sorted(WORKFLOWS.glob('*.yml')):
            text = path.read_text()
            if 'E2E_STEP_NAMES:' not in text or 'pr_steps' not in text:
                continue
            with self.subTest(file=path.name):
                self.assertIn('node red-steps.mjs --renamed-only "$E2E_ARTIFACTS/suite-failures.json"', text)
                self.assertIn('unset E2E_STEP_NAMES', text)

    @unittest.skipUnless(shutil.which('bash'), 'needs bash')
    def test_a_build_without_red_steps_retries_the_whole_suite(self):
        # Stable canary 40503508863 (27 Oct 2026): main's workflow on tag desktop-v0.8.41, which has no red-steps.mjs; the retry crashed under bash -e.
        for name in ('e2e.yml', 'desktop.yml'):
            step = retry_steps((WORKFLOWS / name).read_text())[0]
            lines = [line.strip() for line in step.splitlines() if line.strip().startswith(('red=', 'if [ -n "$red" ]'))]
            with self.subTest(file=name), tempfile.TemporaryDirectory() as empty:
                self.assertEqual(len(lines), 2, lines)
                done = subprocess.run(['bash', '-e', '-c', 'first=.\n' + '\n'.join(lines)], cwd=empty, capture_output=True, text=True)
                self.assertEqual(done.returncode, 0, done.stderr)
                self.assertIn('runs the whole suite', done.stdout)


if __name__ == '__main__':
    unittest.main()
