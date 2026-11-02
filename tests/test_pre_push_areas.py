"""tools/pre-push-check.sh (2 of 3): which areas a push runs (the affected tests, docs alone, PUSH_FULL, an area with nothing affected). Fixture: pre_push_fixture.py."""
import unittest
import shutil
import time
from pathlib import Path

from tests.pre_push_fixture import *   # noqa: F401,F403 (the fixture: setUp, hook, commit, ...)
from tests.pre_push_fixture import PrePushFixture


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class PrePushCheckTest(PrePushFixture):
    def test_a_local_push_asks_for_the_affected_tests_and_push_full_asks_for_everything(self):
        self.needed_committed()
        self.hook('git push origin HEAD:main')
        self.assertTrue(all('--affected-from origin/main' in line for line in self.log.read_text().splitlines()))
        self.log.unlink()
        self.hook('PUSH_FULL=1 git push origin HEAD:main')
        self.assertFalse(any('--affected-from' in line for line in self.log.read_text().splitlines()))

    def test_only_the_areas_a_push_touches_run(self):
        self.needed_committed()
        self.assertEqual(self.areas_run()[:2], (0, ['desktop']))
        self.commit('Worker only', {'app-core/a.js': 'x'})
        self.assertEqual(self.areas_run()[:2], (0, ['desktop', 'worker']))   # origin/main..HEAD still holds the desktop commit
        git(self.repo, 'push', '-q', 'origin', 'HEAD:main')
        self.commit('Engine change', {'src/ai/x.py': 'x'})
        self.assertEqual(self.areas_run()[:2], (0, ['desktop', 'python']), 'the engine also runs its desktop callers')
        git(self.repo, 'push', '-q', 'origin', 'HEAD:main')
        self.commit('Site only', {'admin/p.html': 'x'})   # Why (1 Nov 2026, owner, test stages 3-5): the site lives in the private repo; no suite here
        self.assertEqual(self.areas_run()[:2], (0, []))
        git(self.repo, 'push', '-q', 'origin', 'HEAD:main')
        self.commit('Unknown top-level file', {'Makefile': 'x'})
        self.assertEqual(self.areas_run()[:2], (0, ['desktop', 'python', 'worker']), 'an unknown path runs everything')

    def test_docs_alone_run_no_suite_and_full_forces_all(self):
        self.needed_committed()
        git(self.repo, 'push', '-q', 'origin', 'HEAD:main')
        self.commit('Docs', {'README.md': 'x', 'docs/a.md': 'y'})
        code, areas, err = self.areas_run()
        self.assertEqual((code, areas), (0, []), err)
        # The hook's own output on failure (9 Oct 2026: a Mac CI run got (2, no desktop) once, with nothing saying why).
        code, areas, err = self.areas_run('PUSH_FULL=1 git push origin HEAD:main')
        self.assertEqual((code, areas), (0, ['desktop', 'python', 'worker']), err)

    def test_an_area_with_no_affected_tests_is_not_started(self):
        # Tiers (11 Oct 2026): a push nothing tests no longer starts every area just for stage + lint. The empty pick is the premise: no tests exist in this repo.
        shutil.copy(ROOT / 'tools' / 'affected-tests.py', self.repo / 'tools' / 'affected-tests.py')
        self.needed_committed()
        git(self.repo, 'push', '-q', 'origin', 'main')
        self.log.unlink(missing_ok=True)
        self.commit('Change a helper', {'tools/helper.sh': 'echo hi\n'})
        code, err = self.hook('git push origin HEAD:main')
        self.assertEqual(code, 0)
        self.assertIn('no affected tests', err)
        self.assertFalse(self.log.exists(), 'no suite started')
        self.assertEqual(self.hook('git push origin HEAD:main', JOBADABRA_TIERS='0')[0], 0)
        self.assertEqual(len(self.log.read_text().splitlines()), 3, 'the escape hatch runs every area the paths want')
        self.log.unlink()
        self.commit('Change a script', {'desktop/lib/x.js': 'export {};\n'})
        self.hook('git push origin HEAD:main')
        self.assertIn('--area desktop', self.log.read_text(), 'a changed JS file keeps desktop (its lint)')


if __name__ == '__main__':
    unittest.main()
