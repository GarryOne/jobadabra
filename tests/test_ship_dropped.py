"""tools/ship.sh refuses to report nothing to push when rebasing drops a change main lacks. Fixture: tests/ship_fixture.py."""
import unittest

from tests.ship_fixture import ShipFixture, git


class DroppedChangeTests(ShipFixture):
    def test_refuses_nothing_to_push_when_rebase_skips_change_later_reverted_on_main(self):
        self.change(self.tree, 'a.txt', 'owner setting\n', 'Owner setting')
        self.change(self.other, 'a.txt', 'owner setting\n', 'Same setting reached main')
        self.change(self.other, 'a.txt', 'default\n', 'Revert setting on main')
        git(self.other, 'push', '-q', 'origin', 'main')

        result = self.ship()
        out = result.stdout + result.stderr

        self.assertNotEqual(result.returncode, 0, out)
        self.assertIn('main lacks its change to: a.txt', out)
        self.assertEqual(git(self.origin, 'show', 'main:a.txt'), 'default')

    def merged_then_amended(self):
        self.change(self.tree, 'a.txt', 'mail on\n', 'Turn on mail')
        git(self.tree, 'push', '-q', 'origin', 'HEAD:refs/heads/topic')
        git(self.other, 'fetch', '-q', 'origin')
        git(self.other, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #1', 'origin/topic')   # the owner merges the PR
        git(self.other, 'push', '-q', 'origin', 'main')
        git(self.tree, 'fetch', '-q', 'origin')
        git(self.tree, 'rebase', '-q', 'origin/main')   # the branch is now main's merge commit
        (self.tree / 'b.txt').write_text('sender no-reply\n')
        git(self.tree, 'add', 'b.txt')
        git(self.tree, 'commit', '-q', '--amend', '-m', 'Turn on mail, from no-reply')   # amends the MERGE commit

    def test_a_change_amended_into_a_merge_is_preserved_when_updating_from_main(self):
        self.merged_then_amended()
        result = self.ship()
        out = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, out)
        self.assertIn('ship: DONE', out)
        self.assertEqual(git(self.origin, 'show', 'main:b.txt'), 'sender no-reply')

    def test_a_branch_fully_on_main_still_says_nothing_to_push(self):
        self.change(self.tree, 'a.txt', 'on\n', 'Change a')
        git(self.tree, 'push', '-q', 'origin', 'HEAD:main')
        result = self.ship()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('nothing to push', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
