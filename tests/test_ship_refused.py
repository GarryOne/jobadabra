"""tools/ship.sh after a refused push (11 Oct 2026): the push checks run again only when the commits that just landed can clash with this landing (tools/recheck-needed.py); SHIP_RECHECK=1 always re-runs. Fixture: ship_fixture.py."""
import os
import subprocess
import unittest
from pathlib import Path

from tests.ship_fixture import ShipFixture, git


class ShipRefusedTest(ShipFixture):
    def land_with_other_pushing(self, other_edit, mine_edit, env=None):
        """Ship with a stub hook that counts its runs; on its first run another session pushes (`other_edit` = (file, text)), so ship's push is refused.
        Returns (result, how many times the hook ran)."""
        counter = self.tmp / 'runs'
        posix = lambda p: Path(p).as_posix()   # the hook script is shell: forward slashes on Windows too
        (name, text) = other_edit
        script = (f'#!/bin/sh\ncat > /dev/null\necho run >> {posix(counter)}\n'
                  f'if [ "$(wc -l < {posix(counter)} | tr -d " ")" = 1 ]; then (cd {posix(self.other)} && git pull -q origin main && mkdir -p $(dirname {name}) && printf "{text}" > {name} '
                  f'&& git add -A && git commit -qm "Another session" && git push -q origin main); fi\n'
                  f'git -C {posix(self.tree)} fetch -q origin\n')   # the real hook fetches origin too: origin/main already shows the new commits when the push is refused
        self.change(self.tree, 'tools/pre-push-check.sh', script, 'Hook that counts')
        (mine_name, mine_text) = mine_edit
        (self.tree / mine_name).parent.mkdir(exist_ok=True)
        self.change(self.tree, mine_name, mine_text, 'My docs')
        result = subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh')], cwd=self.tree, capture_output=True, text=True, timeout=90, env={**os.environ, **(env or {})})
        return result, len(counter.read_text().splitlines())

    def test_incoming_files_the_checks_do_not_read_push_at_once_without_a_second_check(self):
        result, runs = self.land_with_other_pushing(('docs/theirs.md', 'x\\n'), ('docs/mine.md', 'y\n'))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(runs, 1, result.stdout + result.stderr)
        self.assertIn('not re-running the checks', result.stdout)
        self.assertEqual(git(self.origin, 'log', '--format=%s', 'main').splitlines(), ['My docs', 'Hook that counts', 'Another session', 'Start'])

    def test_a_file_both_sides_changed_checks_again(self):
        lines = ''.join(f'line {n}\n' for n in range(10))
        self.change(self.other, 'a.txt', lines, 'Ten lines')
        git(self.other, 'push', '-q', 'origin', 'main')
        git(self.tree, 'fetch', '-q', 'origin')
        git(self.tree, 'rebase', '-q', 'origin/main')
        theirs = lines.replace('line 9', 'their 9').replace('\n', '\\n')
        result, runs = self.land_with_other_pushing(('a.txt', theirs), ('a.txt', lines.replace('line 0', 'my 0')))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(runs, 2, result.stdout + result.stderr)
        self.assertIn('both sides touched a.txt', result.stdout)

    def test_ship_recheck_1_checks_again_after_every_refusal(self):
        result, runs = self.land_with_other_pushing(('docs/theirs.md', 'x\\n'), ('docs/mine.md', 'y\n'), {'SHIP_RECHECK': '1'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(runs, 2, result.stdout + result.stderr)

    def test_a_main_advance_after_a_resolved_merge_is_merged_into_the_branch_on_retry(self):
        self.change(self.tree, 'shared.txt', 'feature version\n', 'Feature change')
        self.change(self.other, 'shared.txt', 'main version\n', 'Main change')
        git(self.other, 'push', '-q', 'origin', 'main')
        git(self.tree, 'fetch', '-q', 'origin')
        merged = subprocess.run(['git', 'merge', '--no-edit', 'origin/main'], cwd=self.tree, capture_output=True, text=True)
        self.assertNotEqual(merged.returncode, 0, 'the branches intentionally conflict')
        (self.tree / 'shared.txt').write_text('resolved feature and main\n')
        git(self.tree, 'add', 'shared.txt')
        git(self.tree, 'commit', '-qm', 'Merge main and resolve shared file')

        result, runs = self.land_with_other_pushing(('docs/theirs.md', 'x\\n'), ('docs/mine.md', 'y\n'))

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(runs, 1, result.stdout + result.stderr)
        self.assertIn('not re-running the checks', result.stdout)
        self.assertIn('origin/main advanced; merging it to preserve branch merge history', result.stdout)
        self.assertEqual(git(self.origin, 'show', 'main:shared.txt'), 'resolved feature and main')
        self.assertEqual(git(self.origin, 'show', 'main:docs/theirs.md'), 'x')

    def test_a_missing_decision_tool_checks_again(self):
        (self.tree / 'tools' / 'recheck-needed.py').unlink()
        git(self.tree, 'commit', '-qam', 'Drop the tool')
        result, runs = self.land_with_other_pushing(('docs/theirs.md', 'x\\n'), ('docs/mine.md', 'y\n'))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(runs, 2, 'doubt means check')


if __name__ == '__main__':
    unittest.main()
