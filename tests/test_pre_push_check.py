"""tools/pre-push-check.sh, the Claude Code hook before every git commit/push (1 of 3: commit subjects, red main, the clean checkouts, the gates beside the suites). Fixture: pre_push_fixture.py."""
import json
import subprocess
import unittest
import shutil
import time
from pathlib import Path

from tests.pre_push_fixture import *   # noqa: F401,F403 (the fixture: setUp, hook, commit, ...)
from tests.pre_push_fixture import PrePushFixture


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class PrePushCheckTest(PrePushFixture):
    def test_other_commands_pass_untouched(self):
        self.assertEqual(self.hook('git status')[0], 0)
        self.assertFalse(self.log.exists())

    def test_a_long_subject_is_stopped_at_commit_time(self):
        long = 'x' * 80
        self.assertEqual(self.hook('git commit -m "Short subject"')[0], 0)
        code, err = self.hook(f'git commit -qm "{long}"')
        self.assertEqual(code, 2)
        self.assertIn('at most 72', err)
        self.assertEqual(self.hook(f'COMMIT_LONG_OK=1 git commit -m "{long}"')[0], 0)

    def test_a_pushed_long_subject_names_the_way_out_without_an_amend(self):
        self.needed_committed()
        self.commit('y' * 80)
        code, err = self.hook('git push origin HEAD:main')
        self.assertEqual(code, 2)
        self.assertIn('COMMIT_LONG_OK=1 git push', err)

    def test_suites_run_on_a_clean_checkout_so_leftovers_cannot_hide_a_break(self):
        # The fa1f838 case: the file the tests need is git-ignored and only left in this folder by an earlier run.
        (self.repo / 'desktop' / 'shared').mkdir()
        (self.repo / 'desktop' / 'shared' / 'needed.js').write_text('export {};\n')
        self.commit('Use the needed file')
        code, err = self.hook('git push origin HEAD:main')
        self.assertEqual(code, 2)
        self.assertIn('clean checkout', err)
        self.assertNotIn(str(self.repo), self.log.read_text())

    def linked_worktree(self):
        """A linked worktree of the fixture repo with one desktop change, whose main checkout HAS the installed folders (what a session's bare `git worktree add` looks like)."""
        self.needed_committed()
        for folder in ('desktop/node_modules', 'worker/node_modules'):
            (self.repo / folder).mkdir(parents=True)   # the main checkout's install; git-ignored in the real repo
        tree = self.tmp / 'wt'
        git(self.repo, 'worktree', 'add', '-q', str(tree), '-b', 'wt')
        (tree / 'desktop' / 'x.js').write_text('export {};\n')
        git(tree, 'add', '-A')
        git(tree, 'commit', '-qm', 'Change the desktop')
        return tree

    def hook_in(self, tree, command):
        payload = json.dumps({'tool_input': {'command': command}, 'cwd': str(tree)})
        done = subprocess.run(['bash', str(tree / 'tools' / 'pre-push-check.sh')], input=payload, capture_output=True, text=True, env=self.env, timeout=120)
        return done.returncode, done.stderr

    def test_a_worktree_without_the_modules_its_main_checkout_has_is_refused_at_once_with_the_way_out(self):
        # Owner, 29 Oct 2026 (#2462: a bare worktree add, no node_modules: the gate ran 437 s, failed in "desktop (clean checkout)" and showed no cause).
        tree = self.linked_worktree()
        started = time.time()
        code, err = self.hook_in(tree, 'git push origin HEAD:main')
        self.assertEqual(code, 2, err)
        self.assertLess(time.time() - started, 15, 'refused before any suite runs')
        self.assertIn('desktop/node_modules', err)
        self.assertIn('tools/link-modules.sh', err)
        self.assertFalse(self.log.exists(), 'no suite ran')

    def test_the_same_worktree_with_its_links_pushes(self):   # the positive control of the test above: only the links differ
        tree = self.linked_worktree()
        for folder in ('desktop/node_modules', 'worker/node_modules'):
            (tree / folder).symlink_to(self.repo / folder)
        code, err = self.hook_in(tree, 'git push origin HEAD:main')
        self.assertEqual(code, 0, err)

    def test_the_gates_own_checkouts_are_not_linked_twice(self):
        # Fresh review of 070c412, 29 Oct 2026: the post-checkout hook links each clean checkout the gate makes; the gate then linked again, and `ln -s` onto a link to a folder puts a new
        # link INSIDE that folder: here the main checkout's shared desktop/node_modules would gain a node_modules inside itself.
        self.needed_committed()
        for name in ('link-modules.sh', 'githooks/post-checkout'):
            dest = self.repo / 'tools' / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(ROOT / 'tools' / name, dest)   # the mode (executable) is kept
        git(self.repo, 'config', 'core.hooksPath', 'tools/githooks')
        git(self.repo, 'add', '-A')
        git(self.repo, 'commit', '-qm', 'Add the link hook')
        (self.repo / 'desktop' / 'node_modules').mkdir()   # the main checkout's install
        code, err = self.hook('git push origin HEAD:main')
        self.assertEqual(code, 0, err)
        self.assertEqual(list((self.repo / 'desktop' / 'node_modules').iterdir()), [], 'nothing was linked into the shared folder')

    def test_a_missing_module_is_named_in_the_blocked_push(self):
        # The same 29 Oct 2026 incident: the failure filter matched "not ok" and "npm ERR" but not "Cannot find module", so a suite that died on a missing package printed only timings.
        self.needed_committed()
        self.commit('Break the suite', {'tools/check.sh': "#!/usr/bin/env bash\necho \"Error: Cannot find module 'globals'\"\nexit 1\n"})
        code, err = self.hook('git push origin HEAD:main')
        self.assertEqual(code, 2)
        self.assertIn("Cannot find module 'globals'", err)

    def test_each_area_runs_alone_and_no_worktree_is_left(self):
        self.needed_committed()
        self.assertEqual(self.hook('PUSH_FULL=1 git push origin HEAD:main'), (0, ''))
        runs = self.log.read_text().splitlines()
        self.assertEqual(sorted(line.split(' --area ')[1].split()[0] for line in runs), ['desktop', 'python', 'worker'])   # areas run side by side: no order
        self.assertEqual(len({line.split()[0] for line in runs}), 3, 'a fresh checkout per area')
        self.assertEqual(len(git(self.repo, 'worktree', 'list').splitlines()), 1)

    def test_no_checkout_is_removed_while_another_area_runs(self):
        # git's worktree add and remove race on .git/worktrees (9 Oct 2026: "failed to read .git/worktrees/worker/commondir", and a red
        # main from "tests failed in site" with no reason): the checkouts are made before the suites start and removed after all end.
        # The desktop stub waits for the other two to finish, then looks whether their checkouts are still there.
        (self.repo / 'tools' / 'check.sh').write_text(CHECK + textwrap.dedent('''\
            if [ "$2" = desktop ]; then
              for _ in $(seq 400); do [ "$(wc -l < "$CHECK_LOG.done" 2>/dev/null || echo 0)" -ge 2 ] && break; sleep 0.05; done
              while read -r tree; do [ -d "$tree" ] && echo kept || echo gone; done < "$CHECK_LOG.done" > "$CHECK_LOG.seen"
            else echo "$PWD" >> "$CHECK_LOG.done"; fi
            '''))
        self.needed_committed()
        self.assertEqual(self.hook('PUSH_FULL=1 git push origin HEAD:main'), (0, ''))
        self.assertEqual(Path(f'{self.log}.seen').read_text().split(), ['kept'] * 2)
        self.assertEqual(len(git(self.repo, 'worktree', 'list').splitlines()), 1, 'every checkout removed at the end')

    def tip(self):
        return git(self.repo, 'rev-parse', 'origin/main')

    def test_a_red_main_with_no_failed_job_is_rerun_not_blocking(self):
        self.needed_committed()
        code, err = self.hook('git push origin HEAD:main', GH_RUNS=runs_json(self.tip(), tests=('completed', 'cancelled')), GH_FAILED_JOBS='0')
        self.assertEqual(code, 0, err)
        self.assertIn('run rerun 42 --failed', Path(f'{self.log}.rerun').read_text())
        # One job that really failed still blocks.
        code, _ = self.hook('git push origin HEAD:main', GH_RUNS=runs_json(self.tip(), tests=('completed', 'failure')), GH_FAILED_JOBS='1')
        self.assertEqual(code, 2)

    def test_a_red_main_blocks_with_the_way_to_unblock_it(self):
        self.needed_committed()
        bad = git(self.repo, 'rev-parse', '--short=7', 'origin/main')
        red = {'GH_RUNS': runs_json(self.tip(), tests=('completed', 'failure')), 'GH_FAILED_JOBS': '1'}
        code, err = self.hook('git push origin HEAD:main', **red)
        self.assertEqual(code, 2)
        self.assertIn(f'git revert --no-edit {bad}', err)
        self.assertIn('gh run view --log-failed 42', err)
        subject, author = git(self.repo, 'log', '-1', '--format=%s', 'origin/main'), git(self.repo, 'log', '-1', '--format=%an', 'origin/main')
        self.assertIn(f'main is RED: run 42 failed at {bad}, "{subject}" by {author} (https://x/runs/42)', err)   # one line: run, commit, author
        self.assertEqual(self.hook('CI_RED_OK=1 git push origin HEAD:main', **red)[0], 0, 'the fix itself goes through')
        self.assertEqual(self.hook('git push origin HEAD:main', SHIP_IGNORE_RED='1', **red)[0], 0, 'the explicit off switch')
        # 12 Oct 2026: a PR's own required checks guard main, so a push to a PR branch never waits on a red main (flakes stopped 3 landings that day)
        code, err = self.hook('SHIP_PR=1 git push origin my-branch', **red)
        self.assertNotIn('main is RED', err)
        self.assertEqual(code, 0, err)

    def test_a_fix_in_flight_on_top_of_red_does_not_let_anyone_through(self):
        # 11 Oct 2026: four landings went in on top of b6dd70e, a fix attempt that was still building and ended red
        self.needed_committed()
        red = runs_json(self.tip(), tests=('completed', 'failure'))
        building = json.loads(runs_json('f' * 40, tests=('in_progress', ''), pages=('in_progress', '')))
        code, err = self.hook('git push origin HEAD:main', GH_RUNS=json.dumps(building + json.loads(red)), GH_FAILED_JOBS='1')
        self.assertEqual(code, 2, err)

    @unittest.skipUnless(shutil.which('node'), 'needs node')
    def test_the_journey_gate_runs_beside_the_suites_and_a_failing_gate_blocks_with_its_output(self):
        # owner, 11 Oct 2026: lock wait + journey gate + slowest suite, one after another; the gate now starts with the suites
        self.gate_stubs(seconds=1)
        code, err = self.hook('git push origin HEAD:main')
        order = Path(str(self.log) + '.order').read_text().split()
        self.assertEqual(code, 0, err)
        self.assertLess(order.index('suite-start'), order.index('gate-end'), 'the suite starts before the gate has finished')
        self.assertLess(order.index('gate-start'), order.index('suite-end'))
        self.assertIn('journey gate: stub says yes', err, err)
        self.gate_stubs(journey_exit=1)
        code, err = self.hook('git push origin HEAD:main')
        self.assertEqual(code, 2)
        self.assertIn('Push blocked: the journey gate failed', err)
        self.assertIn('journey gate: stub says no', err)

    @unittest.skipUnless(shutil.which('node'), 'needs node')
    def test_jp_gate_serial_runs_the_gate_first_and_says_so(self):
        self.gate_stubs(seconds=1)
        code, err = self.hook('git push origin HEAD:main', JP_GATE_SERIAL='1')
        order = Path(str(self.log) + '.order').read_text().split()
        self.assertEqual(code, 0, err)
        self.assertLess(order.index('gate-end'), order.index('suite-start'), 'serial: the gate is done before the suite starts')
        self.assertIn('JP_GATE_SERIAL=1', err)

    @unittest.skipUnless(shutil.which('node'), 'needs node')
    def test_a_failing_serial_gate_still_blocks_before_the_suites(self):
        self.gate_stubs(journey_exit=1, seconds=0)
        code, err = self.hook('git push origin HEAD:main', JP_GATE_SERIAL='1')
        self.assertEqual(code, 2, err)
        self.assertIn('Push blocked: journey gate: stub says no', err)
        order = Path(str(self.log) + '.order').read_text().split()
        self.assertNotIn('suite-start', order)


if __name__ == '__main__':
    unittest.main()
