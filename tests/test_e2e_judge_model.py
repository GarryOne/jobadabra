"""Every e2e judge in CI runs on Haiku 5.5, the quality suite's too (owner, 27 Oct 2026: "let's do", after the Finder judge measurement).

The quality suite kept a Sonnet judge from 7 Oct 2026 (~$0.3 a run); a workflow that sets E2E_JUDGE_MODEL to anything else fails here.
"""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[1] / '.github' / 'workflows'


class E2eJudgeModelTests(unittest.TestCase):
    def test_every_e2e_judge_runs_on_haiku(self):
        seen = 0
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for line in path.read_text().splitlines():
                if re.match(r'\s*E2E_JUDGE_MODEL:', line):
                    seen += 1
                    with self.subTest(workflow=path.name):
                        self.assertRegex(line, r'E2E_JUDGE_MODEL:\s*claude-haiku-5-5(\s|$)', line.strip())
        self.assertGreater(seen, 0, 'no workflow sets E2E_JUDGE_MODEL: the guard reads nothing')


if __name__ == '__main__':
    unittest.main()
