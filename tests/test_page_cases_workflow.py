"""The recorded pages run on CI (owner, 11 Oct 2026: "CI heavy, local light"): every push to main replays all cases on Linux, sharded across a matrix, 4 tabs each.
The local push gate runs only the cases a change can affect, so this workflow is the net under it: it must exist, cover every shard, and fail the run loudly."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = (ROOT / '.github' / 'workflows' / 'page-cases.yml').read_text()


class RecordedPagesWorkflow(unittest.TestCase):
    def test_it_runs_on_every_push_to_main_and_by_hand(self):
        # since 15 Oct 2026 main runs every case as a step of build.yml's one Linux job (tests/test_main_one_job.py); this workflow is the PR split and the by-hand run
        self.assertNotRegex(WORKFLOW, r'(?m)^  push:')
        self.assertIn('pull_request:', WORKFLOW)
        self.assertIn('workflow_dispatch', WORKFLOW)

    def test_the_matrix_shards_cover_every_case_exactly_once(self):
        count = int(re.search(r'JP_REPLAY_SHARD_COUNT: (\d+)', WORKFLOW).group(1))
        shards = [int(n) for n in re.search(r'shard: \[([\d, ]+)\]', WORKFLOW).group(1).split(',')]
        self.assertEqual(shards, list(range(1, count + 1)), 'the matrix runs shards 1..N of N, each once')
        self.assertIn('JP_REPLAY_SHARD: ${{ matrix.shard }}/${{ env.JP_REPLAY_SHARD_COUNT }}', WORKFLOW)
        self.assertIn('fail-fast: false', WORKFLOW, 'one failing shard does not hide the others')

    def test_it_replays_with_the_real_extension_on_a_pinned_linux_runner(self):
        self.assertIn('ubuntu-24.04', WORKFLOW)
        self.assertIn('JP_REPLAY: 1', WORKFLOW)
        self.assertIn('playwright', WORKFLOW)   # Chromium for the real extension
        self.assertNotIn('heavy-lock', WORKFLOW, 'a CI runner is its own machine: no lock')
        self.assertEqual(WORKFLOW.count('continue-on-error'), WORKFLOW.count("name: Write the PR's verdict"), 'a failing case fails the run (only the verdict step may not)')
        self.assertIn('JP_REPLAY_TABS', WORKFLOW)

    def test_a_failing_run_is_seen_by_the_red_main_rule(self):
        hook = (ROOT / 'tools' / 'pre-push-check.sh').read_text()
        self.assertIn('page-cases.yml', hook, 'the push hook treats a red recorded-pages run on main like a red build')


if __name__ == '__main__':
    unittest.main()
