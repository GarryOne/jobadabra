"""tools/ship.sh and tools/pr-body.sh in a repo that has none of the toolkit (20 Oct 2026: the private jobadabra-web opened PRs with a bare `gh pr create`, so their
descriptions skipped the layout the owner reads in 2-5 seconds). A private PR body must pass tools/pr-body-check.py, the check CI runs on the public repo's PRs.
Run on a throwaway origin and clone with no tools/ folder, shipped with THIS checkout's ship.sh, and a fake `gh` (tests/fake_gh.py)."""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests.ship_fixture import ROOT, git

AREAS = ('Real users', 'Form filling', 'Admin data accuracy', 'Offline replays', 'Tests & harness', 'Development speed', 'Cost')
SUMMARY = ('🟢 A private page now shows its numbers\n\n**Why:** a test.\n**Unblocks:** nothing.\n\n| Area | Impact | How |\n|---|---|---|\n'
           + ''.join(f'| {area} | — None | — |\n' for area in AREAS)
           + '\n- ✅ a bullet\n\n| | Before | After |\n|---|---|---|\n| x | a | b |\n\nNo screenshots: nothing drawn changed in this test.\n')


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash') and shutil.which('git'), 'needs jq, bash and git')
class ShipPrivateRepoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.origin, self.repo = self.tmp / 'origin.git', self.tmp / 'job-pilotto-site-topic'
        subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', str(self.origin)], check=True)
        self.repo.mkdir()
        git(self.repo, 'init', '-q', '-b', 'main')
        for key, value in (('user.email', 't@example.com'), ('user.name', 'Test')):
            git(self.repo, 'config', key, value)
        (self.repo / 'a.txt').write_text('a\n')
        git(self.repo, 'add', '-A'); git(self.repo, 'commit', '-qm', 'Start')
        git(self.repo, 'remote', 'add', 'origin', str(self.origin)); git(self.repo, 'push', '-q', 'origin', 'main')
        git(self.repo, 'checkout', '-q', '-b', 'topic')
        (self.repo / 'site.txt').write_text('y\n'); git(self.repo, 'add', '-A'); git(self.repo, 'commit', '-qm', 'Show the numbers')
        self.state, self.bin = self.tmp / 'gh-state.json', self.tmp / 'bin'
        self.bin.mkdir()
        shim = self.bin / 'gh'
        shim.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{ROOT / "tests" / "fake_gh.py"}" "$@"\n')
        shim.chmod(shim.stat().st_mode | stat.S_IEXEC)

    def test_a_repo_without_the_toolkit_gets_the_laid_out_body_from_the_public_tools(self):
        self.assertFalse((self.repo / 'tools').exists())
        summary = self.tmp / 'summary.md'; summary.write_text(SUMMARY)
        self.state.write_text(json.dumps({'origin': str(self.origin)}))
        env = {**os.environ, 'PATH': f'{self.bin}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_STATE': str(self.state), 'SHIP_MODE': 'pr', 'SHIP_REVIEW': '0', 'SHIP_WATCH': '0',
               'SHIP_PR_POLL': '0', 'SHIP_RED_POLL': '0', 'JOB_PILOTTO_SESSION': '', 'JP_SESSION': '', 'JP_SESSIONS_DIR': str(self.tmp / 'no-sessions')}
        result = subprocess.run(['bash', str(ROOT / 'tools' / 'ship.sh'), f'--body={summary}'], cwd=self.repo, capture_output=True, text=True, timeout=90, env=env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        calls = json.loads(self.state.read_text()).get('calls', [])
        create = next(call for call in calls if call.startswith('pr create'))
        self.assertIn('A private page now shows its numbers', create)
        self.assertIn('<details>', create, 'the commit message is folded, as in the public repo')
        self.assertIn('Generated with [Claude Code]', create)
        self.assertFalse((self.repo / 'tools').exists(), 'nothing was copied into the repo')

    def test_a_repo_without_the_toolkit_cannot_open_a_pr_without_a_body(self):
        self.state.write_text(json.dumps({'origin': str(self.origin)}))
        env = {**os.environ, 'PATH': f'{self.bin}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_STATE': str(self.state), 'SHIP_MODE': 'pr', 'SHIP_REVIEW': '0', 'SHIP_WATCH': '0',
               'SHIP_PR_POLL': '0', 'SHIP_RED_POLL': '0', 'JOB_PILOTTO_SESSION': '', 'JP_SESSION': '', 'JP_SESSIONS_DIR': str(self.tmp / 'no-sessions')}
        result = subprocess.run(['bash', str(ROOT / 'tools' / 'ship.sh')], cwd=self.repo, capture_output=True, text=True, timeout=90, env=env)
        self.assertNotEqual(result.returncode, 0, 'a lab/site PR with no --body would have a free-form description (lab #57)')
        self.assertIn('no --body', result.stdout + result.stderr)
        self.assertFalse([c for c in json.loads(self.state.read_text()).get('calls', []) if c.startswith('pr create')])

    def test_pr_body_of_a_repo_without_the_toolkit_passes_the_ci_layout_check(self):
        summary = self.tmp / 'summary.md'; summary.write_text(SUMMARY)
        body = subprocess.run(['bash', str(ROOT / 'tools' / 'pr-body.sh'), 'origin/main', f'--body={summary}'], cwd=self.repo, capture_output=True, text=True)
        self.assertEqual(body.returncode, 0, body.stderr)
        check = subprocess.run([sys.executable, str(ROOT / 'tools' / 'pr-body-check.py')], input=body.stdout, capture_output=True, text=True)
        self.assertEqual(check.returncode, 0, check.stdout + check.stderr)

    def test_a_bare_body_without_the_layout_fails_the_same_check(self):
        check = subprocess.run([sys.executable, str(ROOT / 'tools' / 'pr-body-check.py')], input='Serve why a dead end has no feed\n\nSome text.\n', capture_output=True, text=True)
        self.assertNotEqual(check.returncode, 0, 'a private PR body that skips the layout must fail')

    def test_a_commit_subject_over_72_characters_stops_the_private_checks(self):
        (self.repo / 'b.txt').write_text('b\n'); git(self.repo, 'add', '-A'); git(self.repo, 'commit', '-qm', 'x' * 80)
        bad = subprocess.run(['bash', str(ROOT / 'tools' / 'ship-private-checks.sh'), 'origin/main'], cwd=self.repo, capture_output=True, text=True)
        self.assertEqual(bad.returncode, 1, bad.stderr)


if __name__ == '__main__':
    unittest.main()
