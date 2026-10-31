"""Every workflow step that runs an e2e suite tells it its own time limit: E2E_TRY_MINUTES equals the step's timeout-minutes. A suite without an aggregate
budget (apply, applyflows, jobs, ...) stops 4 minutes before that limit (its 3-minute close-down cap + 1) with records that read as timing (desktop/e2e/lib/runner.mjs budgetMsOf).
Why (31 Oct 2026, owner's pick; main run 41146558456, the beta's re-check 41150330007): without it, a slow Mac runner hit GitHub's 15-minute step limit, the kill
left no record and the red could not be told from a bug (8 of 82 Mac apply tries)."""
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
        self.assertGreaterEqual(seen, 6, 'the suite steps of e2e.yml, desktop.yml and e2e-windows.yml were not found: the step parser is stale')


    def test_the_headroom_guard_uses_the_same_limit(self):
        """desktop/e2e/lib/part-headroom.mjs keeps a copy of the gate step's limit (TRY_MINUTES): a part's 11 minutes are that limit less the suite's close-down margin."""
        root = WORKFLOWS.parent.parent
        mine = re.search(r'(?m)^export const TRY_MINUTES = (\d+);', (root / 'desktop' / 'e2e' / 'lib' / 'part-headroom.mjs').read_text(encoding='utf-8'))
        self.assertIsNotNone(mine, 'part-headroom.mjs no longer exports TRY_MINUTES: update this guard with it')
        told = set(re.findall(r'(?m)^          E2E_TRY_MINUTES: (\d+)', (WORKFLOWS / 'e2e.yml').read_text(encoding='utf-8')))
        self.assertEqual(told, {mine.group(1)}, f'e2e.yml gate steps tell suites {sorted(told)} min, part-headroom.mjs budgets its parts for {mine.group(1)}')


if __name__ == '__main__':
    unittest.main()
