"""Every workflow step that runs an e2e suite tells it its own time limit: E2E_TRY_MINUTES equals the step's timeout-minutes. A suite without an aggregate
budget (apply, applyflows, jobs, ...) stops 4 minutes before that limit (its 3-minute close-down cap + 1) with records flaky-proof reads as timing (desktop/e2e/lib/runner.mjs budgetMsOf).
Why (31 Oct 2026, owner's pick; main run 41146558456, the beta's re-check 41150330007): without it, a slow Mac runner hit GitHub's 15-minute step limit, the kill
left no record, and a passing retry stayed red (8 of 82 Mac apply first tries)."""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github' / 'workflows'


def suite_steps(text):
    """-> [(name, block)] for every step whose commands (not its comments) run `node suite.mjs`."""
    out = []
    for block in re.split(r'(?m)^      - ', text)[1:]:
        if any('node suite.mjs' in re.split(r'\s#\s', line)[0] for line in block.splitlines()):
            name = re.search(r'(?m)^(?:name: |        name: )(.+)$', block)
            out.append((name.group(1).strip().strip('"') if name else '?', block))
    return out


class TryMinutes(unittest.TestCase):
    def test_every_suite_step_names_its_own_limit(self):
        seen = 0
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for name, block in suite_steps(path.read_text(encoding='utf-8')):
                seen += 1
                limit = re.search(r'(?m)^        timeout-minutes: (\d+)', block)
                told = re.search(r'(?m)^          E2E_TRY_MINUTES: (\d+)', block)
                self.assertIsNotNone(limit, f'{path.name}: "{name}" runs a suite with no timeout-minutes of its own')
                self.assertIsNotNone(told, f'{path.name}: "{name}" runs a suite without E2E_TRY_MINUTES: a slow runner is killed with no record')
                self.assertEqual(told.group(1), limit.group(1), f'{path.name}: "{name}" tells the suite {told.group(1)} min, the step allows {limit.group(1)}')
        self.assertGreaterEqual(seen, 8, 'the suite steps of e2e.yml, desktop.yml and e2e-windows.yml were not found: the step parser is stale')


if __name__ == '__main__':
    unittest.main()
