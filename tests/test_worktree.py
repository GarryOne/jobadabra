"""tools/worktree.sh: a new worktree is ready to test at once, from main or another base (9 Oct 2026: release lanes made theirs with a bare
`git worktree add`, got no Python .venv, and every API-engine step died with "No module named 'anthropic'"). Run on a throwaway origin."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGES = ('.venv', 'desktop/node_modules', 'desktop/e2e/node_modules', 'worker/node_modules', 'site/node_modules')


def git(cwd, *args):
    return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class WorktreeTest(unittest.TestCase):
    def setUp(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        origin, self.main = tmp / 'origin.git', tmp / 'main'
        subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', str(origin)], check=True)
        (self.main / 'tools').mkdir(parents=True)
        shutil.copy(ROOT / 'tools' / 'worktree.sh', self.main / 'tools' / 'worktree.sh')
        (self.main / '.gitignore').write_text('.venv\nnode_modules\n.claude/\n')
        for name in ('desktop', 'desktop/e2e', 'worker', 'site'):
            (self.main / name).mkdir(parents=True, exist_ok=True)
            (self.main / name / 'keep.txt').write_text(name)
        git(self.main, 'init', '-q', '-b', 'main')
        for key, value in (('user.email', 't@example.com'), ('user.name', 'Test')):
            git(self.main, 'config', key, value)
        git(self.main, 'add', '-A')
        git(self.main, 'commit', '-qm', 'Start')
        git(self.main, 'checkout', '-qb', 'release/x')
        (self.main / 'release.txt').write_text('release\n')
        git(self.main, 'add', '-A')
        git(self.main, 'commit', '-qm', 'Release only')
        git(self.main, 'checkout', '-q', 'main')
        git(self.main, 'remote', 'add', 'origin', str(origin))
        git(self.main, 'push', '-q', 'origin', 'main', 'release/x')
        for package in PACKAGES:   # what the main checkout has installed
            (self.main / package).mkdir(parents=True)

    def make(self, *args):
        done = subprocess.run(['sh', str(self.main / 'tools' / 'worktree.sh'), *args], cwd=self.main, capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        return Path(done.stdout.strip())

    def assert_linked(self, tree):
        for package in PACKAGES:
            with self.subTest(package=package):
                self.assertTrue((tree / package).is_symlink(), f'{package} is not linked')
                self.assertEqual((tree / package).resolve(), (self.main / package).resolve())
        self.assertEqual(git(tree, 'status', '--porcelain'), '', 'the links are git-ignored')

    def test_from_main_every_package_is_linked(self):
        tree = self.make('topic')
        self.assert_linked(tree)
        self.assertFalse((tree / 'release.txt').exists())

    def test_from_another_base_it_starts_there_with_the_same_links(self):
        tree = self.make('lane', 'origin/release/x')
        self.assert_linked(tree)
        self.assertTrue((tree / 'release.txt').exists(), 'the worktree starts from the base it was given')
        self.assertEqual(git(tree, 'rev-parse', '--abbrev-ref', 'HEAD'), 'lane')


if __name__ == '__main__':
    unittest.main()


class PruneTest(WorktreeTest):
    """prune removes only a landed, untouched, clean worktree's folder; the branch stays (owner, 11 Oct 2026)."""

    def prune(self, *args, days='0'):
        import os
        done = subprocess.run(['sh', str(self.main / 'tools' / 'worktree.sh'), 'prune', *args], cwd=self.main, capture_output=True, text=True,
                              env={**os.environ, 'JP_PRUNE_DAYS': days})
        self.assertEqual(done.returncode, 0, done.stderr)
        return done.stdout

    def land(self, tree, name):
        (tree / f'{name}.txt').write_text(name)
        git(tree, 'add', '-A')
        git(tree, 'commit', '-qm', name)
        git(tree, 'push', '-q', 'origin', f'HEAD:main')

    def test_a_landed_clean_untouched_worktree_is_listed_then_removed_and_its_branch_kept(self):
        tree = self.make('landed')
        self.land(tree, 'landed')
        out = self.prune()
        self.assertIn('would remove landed (branch kept)', out)
        self.assertTrue(tree.exists(), 'a dry run removes nothing')
        out = self.prune('--yes')
        self.assertIn('removed landed (branch kept)', out)
        self.assertFalse(tree.exists())
        self.assertIn('landed', git(self.main, 'branch', '--list', 'landed'))

    def test_unlanded_dirty_or_recently_touched_worktrees_are_kept(self):
        unlanded = self.make('unlanded')
        (unlanded / 'work.txt').write_text('mine')
        git(unlanded, 'add', '-A')
        git(unlanded, 'commit', '-qm', 'not pushed')
        dirty = self.make('dirty')
        self.land(dirty, 'dirty')
        (dirty / 'scratch.txt').write_text('uncommitted')
        recent = self.make('recent')
        self.land(recent, 'recent')
        out = self.prune('--yes', days='7')
        self.assertIn('keep unlanded: commits not on main', out)
        self.assertIn('keep dirty: uncommitted or untracked work', out)
        self.assertIn('keep recent: touched in the last 7 days', out)
        for tree in (unlanded, dirty, recent):
            self.assertTrue(tree.exists(), tree.name)


class PruneSquashTest(WorktreeTest):
    """A squash merge leaves the branch's commits off main; prune must still call a merged PR's head landed (25 Oct 2026: it kept ~95% of 667 worktrees)."""

    def two_commit_branch(self, name):
        tree = self.make(name)
        for part in ('a', 'b'):
            (tree / f'{name}-{part}.txt').write_text(part)
            git(tree, 'add', '-A')
            git(tree, 'commit', '-qm', f'{name} {part}')
        return tree

    def squash(self, tree, name):
        """main gets ONE new commit with the branch's files: what GitHub's squash merge does."""
        other = self.main.parent / f'squash-{name}'
        git(self.main, 'worktree', 'add', '-q', '--detach', str(other), 'origin/main')
        for part in ('a', 'b'):
            (other / f'{name}-{part}.txt').write_text(part)
        git(other, 'add', '-A')
        git(other, 'commit', '-qm', f'Squash {name}')
        git(other, 'push', '-q', 'origin', 'HEAD:main')
        git(self.main, 'worktree', 'remove', '--force', str(other))

    def heads(self, name, *shas):
        path = self.main.parent / name
        path.write_text('\n'.join(shas) + '\n')
        return str(path)

    def prune_with(self, merged, opened, *args):
        import os
        env = {**os.environ, 'JP_PRUNE_DAYS': '0', 'JP_MERGED_PR_HEADS': merged, 'JP_OPEN_PR_HEADS': opened}
        done = subprocess.run(['sh', str(self.main / 'tools' / 'worktree.sh'), 'prune', *args], cwd=self.main, capture_output=True, text=True, env=env)
        self.assertEqual(done.returncode, 0, done.stderr)
        return done.stdout

    def test_a_squash_merged_worktree_is_removed_and_its_branch_kept(self):
        tree = self.two_commit_branch('squashed')
        merged = self.heads('merged.txt', git(tree, 'rev-parse', 'HEAD'))
        self.squash(tree, 'squashed')
        self.assertIn('keep squashed: commits not on main', self.prune_with(self.heads('none.txt'), self.heads('open0.txt')),
                      'without the PR lookup a squash merge looks unlanded')
        out = self.prune_with(merged, self.heads('open.txt'), '--yes')
        self.assertIn('removed squashed (branch kept)', out)
        self.assertFalse(tree.exists())
        self.assertIn('squashed', git(self.main, 'branch', '--list', 'squashed'))

    def test_squash_merged_still_keeps_unpushed_commits_open_prs_and_dirty_work(self):
        later = self.two_commit_branch('later')   # merged PR head, then one more local commit
        (later / 'later-c.txt').write_text('c')
        git(later, 'add', '-A')
        git(later, 'commit', '-qm', 'after the merge')
        opened = self.two_commit_branch('opened')
        dirty = self.two_commit_branch('dirty')
        (dirty / 'scratch.txt').write_text('uncommitted')
        both = self.heads('both.txt', *(git(t, 'rev-parse', 'HEAD') for t in (opened, dirty)))
        out = self.prune_with(self.heads('merged2.txt', git(later, 'rev-parse', 'HEAD~1'), *Path(both).read_text().split()), both, '--yes')
        self.assertIn('keep later: commits not on main', out)
        self.assertIn('keep opened: its PR is open', out)
        self.assertIn('keep dirty: its PR is open', out)   # an open head wins before the other checks
        for tree in (later, opened, dirty):
            self.assertTrue(tree.exists(), tree.name)
