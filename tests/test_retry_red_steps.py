"""A red first try's retry repeats only its red steps and their setup (owner, 27 Oct 2026: "Retry only the red steps"). Main's quality, 27 Oct 2026
(run 40440720029): one red step on the first try, then a whole-suite retry on fresh AI ran out of the 7-minute budget and was called "a real failure".
The step list comes from the first try's suite-failures.json (desktop/e2e/red-steps.mjs); with no step to name, the whole suite runs."""
import re
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


if __name__ == '__main__':
    unittest.main()
