"""The recorded pages run on CI (owner, 11 Oct 2026: "CI heavy, local light"): every push to main replays all cases on Linux, sharded across a matrix, 4 tabs each.
The local push gate runs only the cases a change can affect, so this workflow is the net under it: it must exist, cover every shard, and fail the run loudly."""
import os
import re
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = (ROOT / '.github' / 'workflows' / 'page-cases.yml').read_text()


def changed_step():
    """The workflow step that lists the PR's changed files (id: changed), as text."""
    return re.search(r'id: changed\n(.*?)(?=\n      - name:)', WORKFLOW, re.S).group(1)


def changed_step_script():
    """The shell the `changed` step runs, ready to hand to bash; refuses a step that still needs a ${{ }} expression."""
    script = textwrap.dedent(changed_step().split('run: |\n', 1)[1])
    assert '${{' not in script, 'the step must run as plain shell (an expression cannot be played here)'
    return script


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

    # Why (28 Oct 2026): #2367 and #2364 went red on "API rate limit exceeded for installation" in the step that listed the PR's files through `gh api`; the
    # shared GITHUB_TOKEN budget (1,000 requests an hour per repository) decided a PR's red, and bash -e stopped before the closing line, so the run said
    # "Matching delimiter not found 'CHANGED_END'" instead of the cause. The merge commit already holds the PR's files: no network call is needed.
    def test_the_changed_files_come_from_the_merge_commit_not_the_api(self):
        step = changed_step()
        self.assertNotRegex(step, r'\bgh\b', 'no GitHub API call decides a PR red')
        self.assertIn('git diff --name-only HEAD^1 HEAD', step)
        shard_job = WORKFLOW.split('steps:', 1)[1].split('actions/checkout@v5', 1)[1][:200]
        self.assertRegex(shard_job, r'fetch-depth: 2', 'HEAD^1 (the base) is in the checkout')

    @unittest.skipUnless(shutil.which('bash') and shutil.which('git'), 'needs bash and git')
    def test_the_step_lists_the_prs_files_and_never_leaves_a_half_written_output_block(self):
        script = changed_step_script()
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / 'repo'
            repo.mkdir()
            env = {**os.environ, 'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@t',
                   'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_SYSTEM': os.devnull}
            git = lambda *a: subprocess.run(['git', *a], cwd=repo, env=env, check=True, capture_output=True, text=True)
            git('init', '-q', '-b', 'main')
            (repo / 'base.txt').write_text('1')
            git('add', '.'); git('commit', '-q', '-m', 'base')
            git('checkout', '-q', '-b', 'pr')
            (repo / 'desktop').mkdir()
            (repo / 'desktop' / 'changed.js').write_text('2')
            git('add', '.'); git('commit', '-q', '-m', 'pr')
            git('checkout', '-q', 'main')
            (repo / 'other.txt').write_text('3')
            git('add', '.'); git('commit', '-q', '-m', 'main moved on')
            git('merge', '-q', '--no-ff', '-m', 'merge', 'pr')   # what actions/checkout puts at HEAD on a pull_request run

            out = Path(tmp) / 'github-output'
            run = lambda cwd: subprocess.run(['bash', '-e', '-c', script], cwd=cwd, env={**env, 'GITHUB_OUTPUT': out.as_posix()}, capture_output=True, text=True)
            ok = run(repo)
            self.assertEqual(ok.returncode, 0, ok.stderr)
            self.assertEqual(out.read_text(), 'files<<CHANGED_END\ndesktop/changed.js\nCHANGED_END\n',
                             "the PR's files only, as the API's list was: not what main moved on by (other.txt)")

            # a checkout too shallow to have the base (HEAD has no first parent): the step stops with git's own message, before any line of the block is written
            shallow = Path(tmp) / 'shallow'
            git('clone', '-q', '--depth=1', 'file://' + repo.as_posix(), shallow.as_posix())
            out.write_text('')
            bad = run(shallow)
            self.assertNotEqual(bad.returncode, 0)
            self.assertEqual(out.read_text(), '', 'nothing half-written: GitHub would report "Matching delimiter not found" instead of the cause')
            self.assertIn('HEAD^1', bad.stderr, 'the step fails with git saying what it could not find')


if __name__ == '__main__':
    unittest.main()
