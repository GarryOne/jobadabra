"""The beta by hand is built from the newest fully green main commit, whatever workflow files changed since (owner, 1 Nov 2026: the beta promotes what main's CI already proved)."""
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
    def test_the_newest_green_commit_on_main_wins(self):
        self.assertEqual(beta_pick.pick(['c', 'b', 'a'], lambda sha: True), ('c', []))
        sha, skipped = beta_pick.pick(['c', 'b', 'a'], lambda sha: sha != 'c')
        self.assertEqual(sha, 'b')
        self.assertEqual([s for s, _ in skipped], ['c'])
        self.assertIn("not on main's history", skipped[0][1])

    def test_nothing_qualifies_when_no_green_commit_is_on_main(self):
        self.assertEqual(beta_pick.pick(['b', 'a'], lambda sha: False)[0], '')
        self.assertEqual(beta_pick.pick([], lambda sha: True), ('', []))

    def test_a_forced_commit_must_itself_be_green_and_on_main(self):
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

    def test_an_older_green_commit_says_how_far_behind(self):
        code, out, _ = self.pick('D', ['C', 'B'])
        self.assertEqual((code, out), (0, f"{self.sha['C']} 1"))

    def test_a_green_commit_whose_workflows_differ_from_the_heads_is_still_picked(self):
        # Owner, 1 Nov 2026 ("latest green one"): beta 12 skipped all 30 green commits because main's head had new workflow files.
        code, out, _ = self.pick('E', ['D', 'C', 'B'])
        self.assertEqual((code, out), (0, f"{self.sha['D']} 1"))

    def test_a_green_commit_that_is_not_on_main_is_skipped_and_named(self):
        git(self.work, 'checkout', '-q', '-b', 'side', self.sha['A'])
        (self.work / 'side.txt').write_text('s')
        git(self.work, 'add', '-A')
        git(self.work, 'commit', '-q', '-m', 'side')
        self.sha['S'] = git(self.work, 'rev-parse', 'HEAD')
        git(self.work, 'push', '-q', 'origin', f"{self.sha['S']}:refs/heads/side")
        code, out, err = self.pick('B', ['S'])
        self.assertEqual(code, 1, out)
        self.assertIn(f"skipped {self.sha['S'][:7]}", err)
        self.assertIn("builds main's head instead", err)
        self.assertNotIn('--head', err, 'the hint must not tell the owner to start a second beta')

    def test_a_forced_commit_is_picked_only_when_it_is_green_and_on_main(self):
        self.assertEqual(self.pick('D', ['D', 'C', 'B'], '--commit', self.sha['C'][:7])[1], f"{self.sha['C']} 1")
        self.assertEqual(self.pick('D', ['D', 'B'], '--commit', self.sha['C'][:7])[0], 1)
        self.assertEqual(self.pick('E', ['D', 'C', 'B'], '--commit', self.sha['C'][:7])[1], f"{self.sha['C']} 2", 'older workflow files do not stop a named commit')


class BetaReleaseFallback(unittest.TestCase):
    """Beta 9 (1 Nov 2026, a8): main's head had just added a workflow file, so the picker exited 1 and the one command stopped. Plays that scenario on the real script with stub gh, gate and picker."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        tools = base / 'tools'
        tools.mkdir()
        (tools / 'beta-release.sh').write_text((ROOT / 'tools' / 'beta-release.sh').read_text())
        (tools / 'red-main-gate.sh').write_text('#!/bin/sh\necho "Main\'s e2e: no suite red."\n')
        (tools / 'beta_pick.py').write_text('import sys\nprint("No commit of main qualifies: stub", file=sys.stderr)\nsys.exit(1)\n')
        bin_dir = base / 'bin'
        bin_dir.mkdir()
        self.log = base / 'gh.log'
        gh = bin_dir / 'gh'
        gh.write_text('#!/bin/sh\necho "$@" >> "$GH_LOG"\ncase "$1 $2" in "run list") echo "42 https://example.test/runs/42";; esac\n')
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        sleep = bin_dir / 'sleep'
        sleep.write_text('#!/bin/sh\n')
        sleep.chmod(sleep.stat().st_mode | stat.S_IEXEC)
        self.env = dict(os.environ, PATH=f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', GH_LOG=str(self.log))
        self.script = tools / 'beta-release.sh'

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, *args):
        return subprocess.run(['bash', str(self.script), '--no-watch', *args], env=self.env, capture_output=True, text=True)

    def test_no_eligible_commit_dispatches_the_head(self):
        done = self.run_script()
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("Building main's head instead", done.stdout)
        self.assertIn('workflow run desktop.yml -R GarryOne/jobadabra --ref main -f beta=true', self.log.read_text())

    def test_a_named_commit_that_does_not_qualify_still_stops(self):
        done = self.run_script('--commit', 'abc1234')
        self.assertEqual(done.returncode, 1, done.stdout)
        self.assertFalse(self.log.exists() and 'workflow run' in self.log.read_text(), 'nothing is dispatched')


class BetaPickTag(unittest.TestCase):
    """The real script on a real throwaway repo (A(w1) B(w1) C(w2) D(w3)): a pick behind main is run from a tag at that commit, whatever its workflow files are (beta 13's overlay failed its own unit test: one commit's tests under another's workflows)."""

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
        for name, workflows in (('A', 1), ('B', 1), ('C', 2), ('D', 3)):
            (self.work / '.github' / 'workflows' / 'x.yml').write_text(f'v{workflows}\n')
            (self.work / f'{name}.txt').write_text(name)
            git(self.work, 'add', '-A')
            git(self.work, 'commit', '-q', '-m', f'commit {name}')
            self.sha[name] = git(self.work, 'rev-parse', 'HEAD')
        git(self.work, 'push', '-q', 'origin', 'HEAD:main')
        self.origin = base / 'origin.git'
        tools = base / 'tools'
        tools.mkdir()
        (tools / 'beta-release.sh').write_text((ROOT / 'tools' / 'beta-release.sh').read_text())
        (tools / 'red-main-gate.sh').write_text('#!/bin/sh\necho "Main\'s e2e: no suite red."\n')
        bin_dir = base / 'bin'
        bin_dir.mkdir()
        self.log = base / 'gh.log'
        gh = bin_dir / 'gh'
        gh.write_text('#!/bin/sh\necho "$@" >> "$GH_LOG"\ncase "$1 $2" in "run list") echo "42 https://example.test/runs/42";; esac\n')
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        sleep = bin_dir / 'sleep'
        sleep.write_text('#!/bin/sh\n')
        sleep.chmod(sleep.stat().st_mode | stat.S_IEXEC)
        self.tools = tools
        self.env = dict(os.environ, PATH=f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', GH_LOG=str(self.log), GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t')

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, pick):
        (self.tools / 'beta_pick.py').write_text(f'print("{pick}")\n')
        return subprocess.run(['bash', str(self.tools / 'beta-release.sh'), '--no-watch'], cwd=self.work, env=self.env, capture_output=True, text=True)

    def test_a_pick_behind_main_runs_from_a_tag_at_that_very_commit(self):
        done = self.run_script(f"{self.sha['B']} 2")
        self.assertEqual(done.returncode, 0, done.stderr)
        tag = f"beta-pick-{self.sha['B'][:7]}"
        self.assertIn(f'tag {tag}', done.stdout)
        self.assertEqual(git(self.origin, 'rev-parse', f'refs/tags/{tag}'), self.sha['B'], 'the green commit itself: its tests and its workflows agree')
        self.assertEqual(git(self.origin, 'for-each-ref', 'refs/heads', '--format=%(refname)'), 'refs/heads/main', 'no branch is pushed')
        self.assertEqual(git(self.origin, 'rev-parse', 'refs/heads/main'), self.sha['D'], 'main is untouched')
        self.assertIn(f'--ref {tag} -f beta=true', self.log.read_text())

    def test_a_pick_at_main_head_runs_on_main_and_pushes_nothing(self):
        done = self.run_script(f"{self.sha['D']} 0")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(git(self.origin, 'tag', '-l'), '')
        self.assertIn('--ref main -f beta=true', self.log.read_text())


if __name__ == '__main__':
    unittest.main()
