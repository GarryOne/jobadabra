"""tools/auto-pull.sh keeps the owner's checkout on origin/main (owner, 14 Oct 2026): it fast-forwards a clean main only, never touches a dirty tree,
another branch or a diverged history, says a skip once, and says after an update whether the app needs a restart or only ⌘R."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / 'tools' / 'auto-pull.sh'


def git(cwd, *args):
    return subprocess.run(['git', '-C', str(cwd), *args], check=True, capture_output=True, text=True).stdout.strip()


class AutoPullTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.origin, self.repo, self.other = self.tmp / 'origin.git', self.tmp / 'repo', self.tmp / 'other'
        subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', str(self.origin)], check=True)
        subprocess.run(['git', 'clone', '-q', str(self.origin), str(self.other)], check=True, capture_output=True)
        for repo in (self.other,):
            git(repo, 'config', 'user.email', 't@example.org'); git(repo, 'config', 'user.name', 't')
        self.commit('README.md', 'one')
        subprocess.run(['git', 'clone', '-q', str(self.origin), str(self.repo)], check=True, capture_output=True)
        git(self.repo, 'config', 'user.email', 't@example.org'); git(self.repo, 'config', 'user.name', 't')
        self.notices = self.tmp / 'notices'

    def commit(self, path, text, repo=None):
        repo = repo or self.other
        (repo / path).parent.mkdir(parents=True, exist_ok=True)
        (repo / path).write_text(text)
        git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', f'change {path}')
        if repo == self.other:
            git(repo, 'push', '-q', 'origin', 'main')

    def run_pull(self, now=None):
        env = {**os.environ, 'JP_AUTOPULL_REPO': str(self.repo), 'JP_AUTOPULL_LOG': str(self.tmp / 'log'),
               'JP_AUTOPULL_STATE': str(self.tmp / 'state'), 'JP_AUTOPULL_NOTIFY_FILE': str(self.notices),
               'JP_AUTOPULL_NOW': str(1_000_000 + (now or 0))}
        subprocess.run(['bash', str(SCRIPT)], check=True, env=env, capture_output=True)
        return self.notices.read_text().splitlines() if self.notices.exists() else []

    def test_a_clean_main_fast_forwards_and_says_restart_for_app_code(self):
        self.commit('desktop/lib/x.js', 'x')
        notices = self.run_pull()
        self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), git(self.origin, 'rev-parse', 'main'))
        self.assertIn('restart the app', notices[-1])

    def test_a_window_only_change_says_reload_and_a_docs_change_nothing(self):
        self.commit('desktop/renderer/a.js', 'a')
        self.assertIn('⌘R', self.run_pull()[-1])
        self.commit('docs/a.md', 'a')
        self.assertIn('nothing to restart', self.run_pull()[-1])

    def test_shared_inputs_are_restaged_after_an_update_and_other_changes_are_not(self):
        stage = "import fs from 'node:fs'; fs.appendFileSync(new URL('../../staged.txt', import.meta.url), process.argv.slice(2).join(' ') + '\\n');"
        self.commit('desktop/scripts/stage.mjs', stage)
        self.run_pull()
        staged = self.repo / 'staged.txt'
        staged.unlink(missing_ok=True)
        # the class: every input stage.mjs copies, and nothing else
        for path in ('app-core/src/a.js', 'extension/recipe-schema.js', 'extension/alias-schema.js', 'extension/ladder/core.js'):
            self.commit(path, 'x')
            notices = self.run_pull()
            self.assertEqual(staged.read_text().splitlines()[-1], '--files-only', path)
            self.assertIn('restart the app', notices[-1], path)
            staged.unlink()
        self.commit('docs/d.md', 'd')
        self.run_pull()
        self.assertFalse(staged.exists(), 'an unrelated change restages nothing')

    def test_untracked_files_do_not_stop_an_update(self):
        (self.repo / 'scratch.txt').write_text('mine')
        self.commit('docs/b.md', 'b')
        self.run_pull()
        self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), git(self.origin, 'rev-parse', 'main'))
        self.assertEqual((self.repo / 'scratch.txt').read_text(), 'mine')

    # Every state auto-pull can meet that is not "clean main": (name, setup, healed, reason). healed = ends on main at origin/main by itself;
    # otherwise HEAD stays put and the owner hears about it once it lasts 10 minutes, then hourly (17 Oct 2026: detached HEAD sat 80 minutes unsaid).
    def cases(self):
        r = self.repo
        def detach(): git(r, 'switch', '-q', '--detach')
        def edit(): (r / 'README.md').write_text('edited by the owner')
        def local_commit(): self.commit('local.txt', 'local', repo=r)
        def detached_with_commit(): detach(); local_commit()
        def detached_edit(): detach(); edit()
        def detached_untracked(): detach(); (r / 'scratch.txt').write_text('mine')
        def detached_no_main(): detach(); git(r, 'branch', '-q', '-D', 'main')
        def detached_rebase(): detach(); (r / '.git' / 'rebase-merge').mkdir()
        def other_branch(): git(r, 'switch', '-q', '-c', 'other')
        def merge_in_progress(): (r / '.git' / 'MERGE_HEAD').write_text(git(r, 'rev-parse', 'HEAD') + '\n')
        def offline(): git(r, 'remote', 'set-url', 'origin', str(self.tmp / 'gone.git'))
        return [
            ('detached on an old main commit', detach, True, None),
            ('detached, untracked files only', detached_untracked, True, None),
            ('detached with a local commit', detached_with_commit, False, 'has commits origin/main lacks'),
            ('detached with an edited tracked file', detached_edit, False, 'modified tracked files'),
            ('detached and no local main', detached_no_main, False, 'no local main'),
            ('detached during a rebase', detached_rebase, False, 'rebase-merge is in progress'),
            ('another branch', other_branch, False, 'on branch other'),
            ('modified tracked file on main', edit, False, 'modified tracked files'),
            ('local commit on main', local_commit, False, 'not a fast-forward'),
            ('merge in progress', merge_in_progress, False, 'MERGE_HEAD is in progress'),
            ('fetch fails', offline, False, 'fetch failed'),
        ]

    def test_every_state_either_heals_or_warns_after_ten_minutes_then_hourly(self):
        for i in range(len(self.cases())):
            self.setUp()
            name, setup, healed, reason = self.cases()[i]
            with self.subTest(name):
                self.commit('docs/c.md', 'c')   # origin is ahead: there is something to pull
                setup()
                head = git(self.repo, 'rev-parse', 'HEAD') if reason != 'no local main' else None
                self.run_pull(0)
                if healed:
                    self.assertEqual(git(self.repo, 'symbolic-ref', '--short', 'HEAD'), 'main')
                    self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), git(self.origin, 'rev-parse', 'main'))
                    self.assertFalse((self.tmp / 'state').exists())
                    continue
                if head: self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), head, 'never moved')
                self.assertIn(reason, (self.tmp / 'state').read_text())
                self.assertEqual(self.run_pull(300), [], 'quiet before 10 minutes')
                warned = self.run_pull(660)
                self.assertEqual(len(warned), 1, 'one notice at 10 minutes')
                self.assertIn("isn't updating", warned[0]); self.assertIn(reason, warned[0]); self.assertIn('Fix:', warned[0])
                self.assertEqual(len(self.run_pull(1260)), 1, 'not again within the hour')
                self.assertEqual(len(self.run_pull(660 + 3600)), 2, 'again after an hour')

    def test_a_heal_never_discards_the_edit_and_a_resolved_skip_resets_the_clock(self):
        self.commit('docs/c.md', 'c')
        (self.repo / 'README.md').write_text('edited by the owner')
        self.run_pull(0)
        self.assertEqual((self.repo / 'README.md').read_text(), 'edited by the owner')
        git(self.repo, 'checkout', '-q', 'README.md')
        self.run_pull(100)   # healthy again: pulls and ends the streak
        self.assertFalse((self.tmp / 'state.since').exists())
        self.commit('docs/d.md', 'd')
        (self.repo / 'README.md').write_text('edited again')
        self.assertFalse([n for n in self.run_pull(700) if "isn't updating" in n], 'the clock restarted at the new streak')


if __name__ == '__main__':
    unittest.main()
