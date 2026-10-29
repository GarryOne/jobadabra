"""Guard for tools/gitar-label.mjs (the PR-list label from Gitar's verdict): runs the node cases in tests/gitar_label_cases.mjs."""
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class GitarLabelTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'node missing')
    def test_node_cases_pass(self):
        done = subprocess.run(['node', '--test', str(ROOT / 'tests/gitar_label_cases.mjs')], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)


    def test_no_label_run_is_ever_cancelled(self):
        # 28 Oct 2026, owner's PR list: #2400 showed a red ✗ from a label run that a Gitar comment's run cancelled on the same head (cancel-in-progress).
        # Every run reads the live state, so overlapping runs agree; a cancelled one is drawn as a failed check.
        flow = (ROOT / '.github/workflows/gitar-label.yml').read_text()
        self.assertNotIn('concurrency:', flow, 'no group on the workflow or the label job: a group cancels a run, and the script converges instead')

    def test_labels_change_on_a_push_or_gitars_review_or_new_comment_never_on_a_comment_edit(self):
        # Owner, 30 Oct 2026 (PR list without labels; #2516's run: "HTTP 403: API rate limit exceeded for installation"): 151 label runs an hour on Gitar's
        # comment edits used up the repo's REST budget. Design chosen by the owner: run only on review + push; plus Gitar's new comment, its only verdict
        # after a push that keeps the verdict (9 of 60 PRs had no review for their head).
        flow = (ROOT / '.github/workflows/gitar-label.yml').read_text()
        on = flow.split('\non:\n', 1)[1].split('\n\n', 1)[0]
        triggers = {line.strip().rstrip(':'): None for line in on.splitlines() if line.startswith('  ') and not line.startswith('    ')}
        self.assertEqual(set(triggers), {'pull_request_target', 'pull_request_review', 'issue_comment'}, on)
        self.assertIn('types: [submitted, dismissed]', on.split('pull_request_review:', 1)[1].split('issue_comment:', 1)[0])
        self.assertEqual(on.split('issue_comment:', 1)[1].split('types:', 1)[1].strip().splitlines()[0], '[created]', 'an edit starts no run')
        self.assertIn("github.event.review.user.login == 'gitar-bot[bot]'", flow, 'another reviewer\'s review starts no run')
        self.assertIn("github.event.comment.user.login == 'gitar-bot[bot]'", flow, 'another author\'s comment starts no run')
        run_name = next(line for line in flow.splitlines() if line.startswith('run-name:'))
        self.assertIn('"Gitar label on #${{ github.event.pull_request.number || github.event.issue.number }}"', run_name, 'quoted, so the number is not cut off as a YAML comment')

if __name__ == '__main__':
    unittest.main()
