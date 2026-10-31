"""A picked step renamed since the coverage map is no red: the only try runs the whole suite once (26-27 Oct 2026: 19 of 54 e2e reds were this).
The retry of red steps ("Retry only the red steps", owner 27 Oct 2026) is gone with every retry (owner, 31 Oct 2026; tests/test_e2e_single_try.py). Job: pick the suites"""
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github/workflows'


class RenamedPickFallback(unittest.TestCase):
    def test_every_workflow_that_runs_picked_steps_runs_whole_on_a_renamed_pick(self):
        seen = 0
        for path in sorted(WORKFLOWS.glob('*.yml')):
            text = path.read_text()
            if 'E2E_STEP_NAMES:' not in text or 'pr_steps' not in text:
                continue
            seen += 1
            with self.subTest(file=path.name):
                self.assertIn('node red-steps.mjs --renamed-only "$E2E_ARTIFACTS/suite-failures.json"', text)
                self.assertIn('unset E2E_STEP_NAMES', text)
        self.assertGreaterEqual(seen, 2, 'positive control: e2e.yml and e2e-windows.yml run picked steps')


if __name__ == '__main__':
    unittest.main()
