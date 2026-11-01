"""The beta by hand is built from the newest fully green main commit whose workflow files match main's head (owner, 1 Nov 2026: the beta promotes what main's CI already proved)."""
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from tools import beta_pick

FAKE_GH = '#!/bin/sh\ncat "$FAKE_GREEN"\n'   # only `gh api .../build.yml/runs ... --jq` is called: one sha per line, newest first


class PickTests(unittest.TestCase):
    def test_the_newest_green_commit_with_the_heads_workflows_wins(self):
        self.assertEqual(beta_pick.pick(['c', 'b', 'a'], lambda sha: True), ('c', []))
        sha, skipped = beta_pick.pick(['c', 'b', 'a'], lambda sha: sha != 'c')
        self.assertEqual(sha, 'b')
        self.assertEqual([s for s, _ in skipped], ['c'])
        self.assertIn('workflow files differ', skipped[0][1])

    def test_nothing_qualifies_when_every_green_commit_differs(self):
        self.assertEqual(beta_pick.pick(['b', 'a'], lambda sha: False)[0], '')
        self.assertEqual(beta_pick.pick([], lambda sha: True), ('', []))

    def test_a_forced_commit_must_itself_be_green_and_match(self):
        self.assertEqual(beta_pick.pick(['c', 'b', 'a'], lambda sha: True, forced='b')[0], 'b')
        self.assertEqual(beta_pick.pick(['c', 'a'], lambda sha: True, forced='b')[0], '', 'not green: not offered')
        self.assertEqual(beta_pick.pick(['c', 'b'], lambda sha: sha != 'b', forced='b')[0], '')


def git(cwd, *args):
    return subprocess.run(['git', '-C', str(cwd), *args], capture_output=True, text=True, check=True).stdout.strip()


class PickCli(unittest.TestCase):
    """The CLI against a real throwaway repo: history A(w1) B(w1) C(w2) D(w2) E(w3), a fake gh listing the green runs."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', str(base / 'origin.git')], check=True)
        self.work = base / 'work'
        subprocess.run(['git', 'clone', '-q', str(base / 'origin.git'), str(self.work)], check=True, capture_output=True)
        git(self.work, 'config', 'user.email', 't@t')
        git(self.work, 'config', 'user.name', 't')
        (self.work / '.github' / 'workflows').mkdir(parents=True)
        self.sha = {}
        for name, workflows in (('A', 1), ('B', 1), ('C', 2), ('D', 2), ('E', 3)):
            (self.work / '.github' / 'workflows' / 'x.yml').write_text(f'v{workflows}\n')
            (self.work / f'{name}.txt').write_text(name)
            git(self.work, 'add', '-A')
            git(self.work, 'commit', '-q', '-m', name)
            self.sha[name] = git(self.work, 'rev-parse', 'HEAD')
        git(self.work, 'push', '-q', 'origin', 'HEAD:main')
        bin_dir = base / 'bin'
        bin_dir.mkdir()
        gh = bin_dir / 'gh'
        gh.write_text(FAKE_GH)
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        self.env = dict(os.environ, PATH=f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', FAKE_GREEN=str(base / 'green'))
        self.base = base

    def tearDown(self):
        self.tmp.cleanup()

    def pick(self, head, green, *extra):
        git(self.work, 'push', '-q', '-f', 'origin', f'{self.sha[head]}:refs/heads/main')
        (self.base / 'green').write_text('\n'.join(self.sha[name] for name in green) + '\n')
        done = subprocess.run([sys.executable, str(ROOT / 'tools' / 'beta_pick.py'), 'o/r', *extra], cwd=self.work, env=self.env, capture_output=True, text=True)
        return done.returncode, done.stdout.strip(), done.stderr

    def test_the_head_itself_when_it_is_green(self):
        code, out, _ = self.pick('D', ['D', 'C'])
        self.assertEqual((code, out), (0, f"{self.sha['D']} 0"))

    def test_an_older_green_commit_with_the_same_workflows_says_how_far_behind(self):
        code, out, _ = self.pick('D', ['C', 'B'])
        self.assertEqual((code, out), (0, f"{self.sha['C']} 1"))

    def test_a_commit_whose_workflows_differ_is_skipped_and_named(self):
        code, out, err = self.pick('E', ['D', 'C', 'B'])
        self.assertEqual(code, 1, out)
        self.assertIn(f"skipped {self.sha['D'][:7]}", err)
        self.assertIn('tools/beta-release.sh --head', err)

    def test_a_forced_commit_is_picked_only_when_it_qualifies(self):
        self.assertEqual(self.pick('D', ['D', 'C', 'B'], '--commit', self.sha['C'][:7])[1], f"{self.sha['C']} 1")
        self.assertEqual(self.pick('D', ['D', 'B'], '--commit', self.sha['C'][:7])[0], 1)


class BetaReleaseFallback(unittest.TestCase):
    def test_no_eligible_commit_builds_the_head_but_a_named_commit_still_stops(self):
        # Beta 9 (1 Nov 2026, a8): main's head had just added a workflow file, so the picker found nothing and the one command stopped. Without --commit it now builds the head.
        text = (ROOT / 'tools' / 'beta-release.sh').read_text()
        self.assertIn("{ [ -n \"$commit\" ] && exit 1; echo \"Building main's head instead", text)
        self.assertIn('pick=""\nif [ "$at" != head ]; then', text)
        self.assertIn('if [ -n "$pick" ]; then', text)


if __name__ == '__main__':
    unittest.main()
