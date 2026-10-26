"""A main e2e run that tests nothing never ends green (gate G7, 26 Oct 2026: the 23:33 and 23:47 runs skipped while beta 2 ran and read as a green main)."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
E2E = (ROOT / '.github/workflows/e2e.yml').read_text()


def job(name):
    match = re.search(rf'^  {re.escape(name)}:\n(.*?)(?=^  [a-z][\w-]*:\n|\Z)', E2E, re.S | re.M)
    return match.group(1) if match else ''


class NothingTested(unittest.TestCase):
    def test_a_run_with_no_suite_cancels_itself_and_says_why(self):
        body = job('nothing-tested')
        self.assertTrue(body, 'e2e.yml needs the "Nothing tested" job')
        cond = re.search(r'^    if: (.*)$', body, re.M).group(1)
        self.assertIn("needs.plan.outputs.count == '0'", cond)
        self.assertIn('!inputs.gate_tag', cond, 'inside a release gate, cancelling the run would cancel the release')
        self.assertIn("github.ref == 'refs/heads/main'", cond)
        self.assertIn('gh run cancel "$GITHUB_RUN_ID"', body)
        self.assertIn('needs.plan.outputs.why', body, 'the summary names why nothing ran')
        self.assertIn('actions: write', body)

    def test_the_plan_job_exposes_why(self):
        self.assertRegex(job('plan'), r'\n      why: \$\{\{ steps\.list\.outputs\.why \}\}')

    def test_the_planner_counts_only_green_or_red_runs_as_tested(self):
        plan = (ROOT / 'desktop/e2e/plan-run.mjs').read_text()
        self.assertIn("const tested = run => ['success', 'failure'].includes(run.conclusion);", plan)
        self.assertRegex(plan, r'const lastSha = runs\.find\(run => [^\n]*tested\(run\)')
        self.assertRegex(plan, r'const own = run => [^\n]*tested\(run\)')


if __name__ == '__main__':
    unittest.main()
