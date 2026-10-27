"""tools/pr-conflict-fix.sh (18 Oct 2026, #1356 and #1362 sat CONFLICTING after their stacked parent was squash-merged): the stacked-parent case is rebased with
`git rebase --onto origin/main <old parent tip>` and pushed with a lease; every other case (a real two-sided conflict, a dirty tree, a ship running, a failed push) leaves the branch untouched.
Real git repos in a temp folder (bare origin, a clone as the PR's worktree) and a fake `gh` that lists the merged PRs from a file."""
import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'tools' / 'pr-conflict-fix.sh'
FAKE = """#!/bin/sh
printf 'HTTP/2.0 200 OK\\n\\n'
jq -c '[.[] | {number, head: {sha: .headRefOid, ref: "parent"}, merged_at: "t"}]' "$FAKE_GH_DIR/merged.json"
"""


def git(cwd, *args, check=True):
    return subprocess.run(['git', *args], cwd=cwd, check=check, capture_output=True, text=True).stdout.strip()


def put(cwd, name, text, message):
    (Path(cwd) / name).write_text(text)
    git(cwd, 'add', '-A'); git(cwd, 'commit', '-qm', message)


@unittest.skipUnless(shutil.which('jq') and shutil.which('git') and shutil.which('bash'), 'needs jq, git and bash')
class PrConflictFixTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.origin, self.work, self.up = self.tmp / 'origin.git', self.tmp / 'work', self.tmp / 'up'
        subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', str(self.origin)], check=True)
        subprocess.run(['git', 'clone', '-q', self.origin.as_uri(), str(self.work)], check=True, capture_output=True)
        subprocess.run(['git', 'clone', '-q', self.origin.as_uri(), str(self.up)], check=True, capture_output=True)
        for repo in (self.work, self.up):
            git(repo, 'config', 'user.email', 't@example.com'); git(repo, 'config', 'user.name', 'Test'); git(repo, 'checkout', '-q', '-B', 'main')
        put(self.work, 'a.txt', 'one\ntwo\nthree\n', 'Start'); git(self.work, 'push', '-q', 'origin', 'main')
        (self.tmp / 'bin').mkdir()
        gh = self.tmp / 'bin' / 'gh'; gh.write_text(FAKE); gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        self.log = self.tmp / 'ship.log'; self.log.write_text('')
        self.env = {**os.environ, 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.tmp), 'PR_REST_CACHE': str(self.tmp / 'rest-cache')}
        (self.tmp / 'merged.json').write_text('[]')

    def stacked(self):
        """parent branch P (edits a.txt) and child C on top of it (adds c.txt); P is then squash-merged to main, and main moves on in the same lines."""
        git(self.work, 'checkout', '-q', '-b', 'parent'); put(self.work, 'a.txt', 'one\nparent\nthree\n', 'Parent change')
        self.parent_tip = git(self.work, 'rev-parse', 'HEAD')
        git(self.work, 'checkout', '-q', '-b', 'child'); put(self.work, 'c.txt', 'child\n', 'Child change')
        git(self.work, 'push', '-q', 'origin', 'parent', 'child')
        git(self.up, 'pull', '-q', 'origin', 'main')
        put(self.up, 'a.txt', 'one\nparent\nthree\n', 'Parent (#1)')   # the squash
        put(self.up, 'a.txt', 'one\nparent\nthree\nfour\n', 'Later work')   # rebasing the parent's own commit onto this would conflict
        git(self.up, 'push', '-q', 'origin', 'main')
        (self.tmp / 'merged.json').write_text(json.dumps([{'number': 1, 'headRefOid': self.parent_tip}]))

    def fix(self, env=None):
        done = subprocess.run(['bash', str(SCRIPT), '9', str(self.log)], cwd=self.work, capture_output=True, text=True, env={**self.env, **(env or {})}, timeout=60)
        return done, self.log.read_text().splitlines()

    def test_a_squash_merged_stacked_parent_is_dropped_and_pushed(self):
        self.stacked()
        done, lines = self.fix()
        self.assertEqual(lines, ['ship: CONFLICT FIXED #9 (stacked parent #1)'], done.stderr)
        git(self.work, 'fetch', '-q', 'origin')
        self.assertEqual(git(self.work, 'rev-parse', 'HEAD'), git(self.work, 'rev-parse', 'origin/child'), 'pushed')
        self.assertEqual(git(self.work, 'rev-list', '--count', 'origin/main..HEAD'), '1', 'only the child commit is left')
        self.assertEqual((self.work / 'a.txt').read_text(), 'one\nparent\nthree\nfour\n')

    def test_a_real_two_sided_conflict_is_left_untouched(self):
        git(self.work, 'checkout', '-q', '-b', 'child'); put(self.work, 'a.txt', 'one\nmine\nthree\n', 'Mine')
        git(self.work, 'push', '-q', 'origin', 'child')
        git(self.up, 'pull', '-q', 'origin', 'main'); put(self.up, 'a.txt', 'one\ntheirs\nthree\n', 'Theirs'); git(self.up, 'push', '-q', 'origin', 'main')
        before = git(self.work, 'rev-parse', 'HEAD')
        done, lines = self.fix()
        self.assertEqual(lines, [])
        self.assertEqual((git(self.work, 'rev-parse', 'HEAD'), git(self.work, 'status', '--porcelain')), (before, ''), 'no rebase left half done')
        self.assertEqual(git(self.work, 'rev-parse', 'origin/child'), before)

    def test_a_dirty_tree_is_left_untouched(self):
        self.stacked()
        (self.work / 'c.txt').write_text('edited\n')
        before = git(self.work, 'rev-parse', 'HEAD')
        done, lines = self.fix()
        self.assertEqual((lines, git(self.work, 'rev-parse', 'HEAD'), (self.work / 'c.txt').read_text()), ([], before, 'edited\n'))

    def test_unpushed_local_commits_are_left_untouched(self):
        self.stacked()
        put(self.work, 'd.txt', 'local only\n', 'Local')
        before = git(self.work, 'rev-parse', 'HEAD')
        self.assertEqual((self.fix()[1], git(self.work, 'rev-parse', 'HEAD')), ([], before))

    def test_a_refused_push_puts_the_branch_back(self):
        self.stacked()
        before = git(self.work, 'rev-parse', 'HEAD')
        hook = self.origin / 'hooks' / 'pre-receive'; hook.write_text('#!/bin/sh\nexit 1\n'); hook.chmod(hook.stat().st_mode | stat.S_IEXEC)
        done, lines = self.fix()
        self.assertEqual((lines, git(self.work, 'rev-parse', 'HEAD')), ([], before))

    def test_a_failed_fast_check_puts_the_branch_back(self):
        self.stacked()
        (self.work / 'tools').mkdir(); (self.work / 'tools' / 'pre-push-check.sh').write_text('#!/bin/sh\ncat >/dev/null; echo red >&2; exit 2\n')
        git(self.work, 'add', '-A'); git(self.work, 'commit', '-qm', 'hook'); git(self.work, 'push', '-q', 'origin', 'child')   # in the PR already
        before = git(self.work, 'rev-parse', 'HEAD')
        done, lines = self.fix()
        self.assertEqual((lines, git(self.work, 'rev-parse', 'HEAD')), ([], before))

    def test_no_merged_parent_found_is_left_untouched(self):
        self.stacked()
        (self.tmp / 'merged.json').write_text('[]')
        before = git(self.work, 'rev-parse', 'HEAD')
        self.assertEqual((self.fix()[1], git(self.work, 'rev-parse', 'HEAD')), ([], before))

    def test_a_running_ship_in_the_worktree_is_left_alone(self):
        self.stacked()
        before = git(self.work, 'rev-parse', 'HEAD')
        done, lines = self.fix({'PR_CONFLICT_SHIP_RUNNING': '1'})
        self.assertEqual((lines, git(self.work, 'rev-parse', 'HEAD')), ([], before))


if __name__ == '__main__':
    unittest.main()
