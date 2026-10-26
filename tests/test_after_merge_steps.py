"""After each merge, main runs the e2e steps that merge touched (PR 4 of the PR-checks plan, owner's yes 26 Oct 2026: "Yes, affected steps"; a newer merge
replaces a queued one; the nightly full run stays): main-steps.yml plans like a PR (pr-suites.mjs) from the push's diff and starts e2e.yml on main."""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from tools.main_e2e_state import AFTER_MERGE  # noqa: E402

FLOW = (ROOT / '.github/workflows/main-steps.yml').read_text()
E2E = (ROOT / '.github/workflows/e2e.yml').read_text()


def paths(text, event):
    block = re.search(rf'(?ms)^  {event}:\n(.*?)(?=^\S|^  \w)', text).group(1)
    return {p for p in re.findall(r"^\s+- '([^']+)'", block, re.M)}


class MainSteps(unittest.TestCase):
    def test_a_push_to_main_with_the_files_a_pr_check_watches(self):
        self.assertRegex(FLOW, r"(?m)^  push:\n    branches: \[main\]")
        # Less the CI plumbing a PR watches only for its one Windows smoke (PR 3): after a merge no Windows check runs.
        pr = paths((ROOT / '.github/workflows/pr-suites.yml').read_text(), 'pull_request') - {'.github/workflows/pr-suites.yml', '.github/**', 'tools/*.sh', 'desktop/scripts/*.sh'}
        self.assertEqual(paths(FLOW, 'push') - {'.github/workflows/main-steps.yml'}, pr, 'a file a PR runs steps for runs them after its merge too')

    def test_plans_from_the_push_s_own_diff_and_starts_e2e_on_main(self):
        self.assertIn('BEFORE: ${{ github.event.before }}', FLOW)
        self.assertIn('node desktop/e2e/pr-suites.mjs --base "$BEFORE" --plan', FLOW)
        start = re.search(r'gh workflow run e2e\.yml[^\n]*', FLOW).group(0)
        for arg in ('--ref main', '-f pr_suites="$SUITES"', '-f pr_steps="$STEPS"', '-f after_merge="${MERGED:0:7}"'):
            self.assertIn(arg, start)

    def test_its_run_is_titled_after_the_merge_before_the_pr_title_is_tried(self):
        name = re.search(r'(?m)^run-name: (.*)$', E2E).group(1)
        after = name.index("inputs.after_merge && format('" + AFTER_MERGE + "{0} · {1}', inputs.after_merge, inputs.pr_suites)")
        self.assertLess(after, name.index("inputs.pr_suites && format('E2E for PR · "), 'a PR title would make pr-verdict.py and the nightly read it as a PR run')
        self.assertRegex(E2E, r"(?m)^      after_merge:\n        description:")

    def test_a_newer_merge_replaces_the_queued_one_never_the_running_one(self):
        block = re.search(r'(?ms)^    concurrency:\n(.*?)(?=^    \w)', E2E).group(1)
        self.assertIn("inputs.after_merge != '' && format('e2e-after-merge-{0}', matrix.key)", block)
        self.assertIn("cancel-in-progress: ${{ inputs.pr_suites != '' && inputs.after_merge == '' }}", block)

    def test_a_red_is_told_and_filed_on_the_merged_pr_and_a_green_is_not_back_to_green(self):
        alert = re.search(r'(?ms)^  alert:\n(.*?)(?=^  \w)', E2E).group(1)
        self.assertIn("inputs.after_merge != ''", re.search(r'(?m)^    if: (.*)$', alert).group(1))
        self.assertIn('python3 tools/e2e_bisect.py after-merge "$GITHUB_RUN_ID"', alert)
        self.assertRegex(alert, r'elif \[ -z "\$AFTER_MERGE" \]; then node ci-alert\.mjs success', 'a few green steps never say main is green again')

    def test_no_pr_verdict_for_a_run_on_main(self):
        step = re.search(r"(?ms)- name: Write the PR's verdict\n        if: ([^\n]*)", E2E).group(1)
        self.assertIn("inputs.after_merge == ''", step)


if __name__ == '__main__':
    unittest.main()
