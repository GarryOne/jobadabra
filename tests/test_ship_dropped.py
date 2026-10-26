"""tools/ship.sh never says "nothing to push" while the branch holds a change main lacks (26 Oct 2026, jobadabra-web #160: the PR merged, a later rebase moved the branch onto
main's merge commit, an amend rewrote that merge commit, and ship's rebase dropped it: "DONE nothing to push", the owner's sender change unpushed). Fixture: tests/ship_fixture.py."""
import unittest

from tests.ship_fixture import ShipFixture, git


class DroppedChangeTests(ShipFixture):
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

    def test_a_change_the_rebase_dropped_is_refused_not_called_nothing_to_push(self):
        self.merged_then_amended()
        result = self.ship()
        out = result.stdout + result.stderr
        self.assertNotIn('nothing to push', out)
        self.assertNotEqual(result.returncode, 0, out)
        self.assertIn('b.txt', out, 'the refusal names the file main lacks')
        self.assertIn('git reflog', out, 'and says where the change still is')

    def test_a_branch_fully_on_main_still_says_nothing_to_push(self):
        self.change(self.tree, 'a.txt', 'on\n', 'Change a')
        git(self.tree, 'push', '-q', 'origin', 'HEAD:main')
        result = self.ship()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('nothing to push', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
