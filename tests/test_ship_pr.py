"""tools/ship.sh landing through a pull request (12 Oct 2026): push the branch, open a PR, turn on auto-merge, wait until it is merged; a failed required check says which and leaves the PR open.
Run on a throwaway origin with a fake `gh` (tests/fake_gh.py) that merges the branch into origin's main when auto-merge is on. Fixture: ship_fixture.py."""
import json
import os
import signal
import time
import shutil
import stat
import subprocess
import sys
import unittest
from pathlib import Path

from tests.ship_fixture import ROOT, ShipFixture, git


class ShipPrTest(ShipFixture):
    def setUp(self):
        super().setUp()
        self.state = self.tmp / 'gh-state.json'
        self.bin = self.tmp / 'bin'
        self.bin.mkdir()
        shim = self.bin / 'gh'
        shim.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{ROOT / "tests" / "fake_gh.py"}" "$@"\n')
        shim.chmod(shim.stat().st_mode | stat.S_IEXEC)

    def pr_ship(self, state=None, *flags, timeout=90, **extra):
        self.state.write_text(json.dumps({'origin': str(self.origin), **(state or {})}))
        env = {**os.environ, 'PATH': f'{self.bin}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_STATE': str(self.state), 'SHIP_MODE': 'pr', 'SHIP_REVIEW': '0', 'SHIP_WATCH': '0', 'SHIP_PR_POLL': '0', 'SHIP_RED_POLL': '0', 'JOB_PILOTTO_SESSION': '', 'JP_SESSION': '', 'JP_SESSIONS_DIR': str(self.tmp / 'no-sessions'), **extra}   # SHIP_REVIEW=0 by default: the auto-merge path
        return subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh'), *flags], cwd=self.tree, capture_output=True, text=True, timeout=timeout, env=env)

    def calls(self):
        return json.loads(self.state.read_text()).get('calls', [])

    def test_pushes_the_branch_opens_a_pr_turns_on_auto_merge_and_waits_for_the_merge(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = self.pr_ship()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('ship: DONE ', result.stdout)
        self.assertIn('My change', git(self.origin, 'log', '--format=%s', 'main'))
        self.assertIn('--head topic', ' '.join(self.calls()), 'the PR is from the pushed branch, not main directly')
        calls = ' | '.join(self.calls())
        self.assertIn('pr create', calls)
        self.assertIn('--title My change', calls)
        self.assertIn('Generated with [Claude Code]', calls, 'the PR body carries the attribution line')
        self.assertIn('<details>', calls, 'the commit message is folded (tools/pr-body.sh)')
        self.assertIn('pr merge', calls)
        self.assertIn('--auto --rebase', calls)
        self.assertTrue((self.main / 'mine.txt').exists(), 'the main checkout is brought up to date after the merge')

    def test_the_pr_title_names_what_changed_not_a_required_file_split(self):
        # 18 Oct 2026: #1375 was titled by its first commit, the split of a file. Cases: (commits oldest first, --title, expected title)
        cases = [
            (['Add the thing'], None, 'Add the thing'),
            (['Move feeds.scan into its own file', 'Show the new feed'], None, 'Show the new feed'),
            (['Show the new feed', 'Move feeds.scan into its own file'], None, 'Show the new feed'),
            (['Move a into b'], None, 'Move a into b'),
            (['Move feeds.scan into its own file', 'Show the new feed'], 'Chosen words', 'Chosen words'),
            (['Show the new feed', 'Tick the spec'], 'Chosen words', 'Chosen words'),
        ]
        for i, (subjects, title, want) in enumerate(cases):
            with self.subTest(subjects=subjects, title=title):
                git(self.tree, 'fetch', '-q', 'origin')
                git(self.tree, 'checkout', '-q', '-B', 'topic', 'origin/main')
                for j, subject in enumerate(subjects):
                    self.change(self.tree, f'f{i}_{j}.txt', 'y\n', subject)
                result = self.pr_ship(None, *([f'--title={title}'] if title else []))
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                create = [c for c in self.calls() if 'pr create' in c][-1]
                self.assertIn(f'--title {want} --body', create)

    def test_two_commits_need_a_title_naming_the_whole_pr_to_open_the_pr(self):
        # 24 Oct 2026: #1743 was titled "Name a file as the spec's fixtures proof", its 6th commit; the PR did something else.
        self.change(self.tree, 'a.txt', 'y\n', 'Show the new feed')
        self.change(self.tree, 'b.txt', 'y\n', 'Tick the spec')
        result = self.pr_ship()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('--title=', result.stdout + result.stderr)
        self.assertFalse([c for c in self.calls() if 'pr create' in c], 'no PR is opened')
        # a later ship of the open PR never needs it and never retitles it
        open_pr = {'state': 'OPEN', 'head': 'topic', 'title': '[9f] Whole change'}
        self.pr_ship(open_pr, JOB_PILOTTO_SESSION='job-pilotto-9f')
        self.assertFalse([c for c in self.calls() if 'pr edit' in c and '--title' in c])
        # --title= with 2+ commits and the "[xx] " tag are covered by the title cases above and test_the_pr_title_names_the_session_that_opened_it

    def test_a_title_given_on_a_reship_updates_the_open_pr_and_none_leaves_it(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        open_pr = {'state': 'OPEN', 'head': 'topic'}
        result = self.pr_ship(open_pr)
        self.assertIn('reusing it', result.stdout)
        self.assertNotIn('--title', ' | '.join(c for c in self.calls() if 'pr edit' in c))
        self.change(self.tree, 'more.txt', 'z\n', 'More')
        self.pr_ship(open_pr, '--title=Better words')
        self.assertIn('pr edit 1 --title Better words', ' | '.join(self.calls()))

    def test_a_title_that_already_has_the_session_tag_keeps_one(self):
        # 24 Oct 2026: --title="[d8] ..." became "[d8] [d8] ..." (#1750), on a new PR and on a retitle.
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        self.pr_ship(None, '--title=[9f] Tagged words', JOB_PILOTTO_SESSION='job-pilotto-9f')
        self.assertIn('--title [9f] Tagged words --body', ' | '.join(self.calls()))
        self.change(self.tree, 'more.txt', 'z\n', 'More')
        self.pr_ship({'state': 'OPEN', 'head': 'topic'}, '--title=[9f] Tagged again', JOB_PILOTTO_SESSION='job-pilotto-9f')
        self.assertIn('pr edit 1 --title [9f] Tagged again', ' | '.join(self.calls()))
        self.assertNotIn('[9f] [9f]', ' | '.join(self.calls()))

    def test_a_reship_adds_the_session_tag_to_an_open_pr_that_lacks_it(self):
        # 21 Oct 2026: site#18 and #19 were opened or retitled by hand without the "[xx] " tag
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        open_pr = {'state': 'OPEN', 'head': 'topic', 'title': 'Hand made title'}
        self.pr_ship(open_pr, JOB_PILOTTO_SESSION='job-pilotto-9f')
        self.assertIn('pr edit 1 --title [9f] Hand made title', ' | '.join(self.calls()))
        self.change(self.tree, 'more.txt', 'z\n', 'More')
        self.pr_ship({'state': 'OPEN', 'head': 'topic', 'title': '[9f] Tagged already'}, JOB_PILOTTO_SESSION='job-pilotto-9f')
        self.assertNotIn('Tagged already', ' | '.join(c for c in self.calls() if 'pr edit' in c), 'a tagged title is left alone')

    def test_a_branch_carrying_another_open_prs_commit_is_refused_before_any_push(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        oid = git(self.tree, 'rev-parse', 'HEAD')
        result = self.pr_ship({'others': [{'number': 7, 'headRefName': 'other', 'commits': [{'oid': oid}]}]})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('carries commits of the open PR #7 (other)', result.stdout + result.stderr)
        self.assertIn('no stacking', result.stdout + result.stderr)
        self.assertNotIn('pr create', ' | '.join(self.calls()))
        self.assertEqual(git(self.origin, 'branch', '--list', 'topic'), '', 'nothing was pushed')

    def test_another_open_pr_with_its_own_commits_does_not_block(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = self.pr_ship({'others': [{'number': 7, 'headRefName': 'other', 'commits': [{'oid': 'f' * 40}]}]})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_the_pr_title_names_the_session_that_opened_it(self):
        # Owner, 15 Oct 2026: "add in the PR title the name of the session that opened that PR".
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = self.pr_ship(JOB_PILOTTO_SESSION='job-pilotto-9f')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('--title [9f] My change', ' | '.join(self.calls()))
        self.assertIn('My change', git(self.origin, 'log', '--format=%s', 'main'), 'the commit subject itself stays as written')
        self.assertNotIn('[9f]', git(self.origin, 'log', '--format=%s', 'main'))

    def test_the_session_tag_is_the_names_last_part_in_every_name_shape(self):
        # 24 Oct 2026: sessions became "jobadabra-xx" after the rename and #1772 read "[jobadabra-70] ..."; the title hooks use the last part too.
        for n, name in enumerate(('job-pilotto-9f', 'jobadabra-9f', 'jobadabra-claude-x1b2-9f')):
            with self.subTest(name):
                self.change(self.tree, f'shape{n}.txt', 'y\n', f'Change {n}')
                self.pr_ship(None, JOB_PILOTTO_SESSION=name)
                self.assertIn(f'--title [9f] Change {n}', ' | '.join(self.calls()))
                self.change(self.tree, f'shape{n}b.txt', 'z\n', f'More {n}')
                self.pr_ship({'state': 'OPEN', 'head': 'topic', 'title': f'Hand made {n}'}, JOB_PILOTTO_SESSION=name)
                self.assertIn(f'pr edit 1 --title [9f] Hand made {n}', ' | '.join(self.calls()))

    def test_a_pr_landing_of_slow_gate_files_takes_no_landing_queue(self):
        # Owner, 12 Oct 2026: "Everybody can open PR at any time". The PR's required checks guard main, so a local queue only made PRs wait for each other.
        (self.tree / 'desktop' / 'lib').mkdir(parents=True)
        self.change(self.tree, 'desktop/lib/x.js', '1\n', 'Touch a slow-gate path')
        result = self.pr_ship()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('queueing for the landing lock', result.stdout + result.stderr)

    def test_a_second_landing_after_the_branch_was_deleted_on_merge_goes_through(self):
        self.change(self.tree, 'one.txt', '1\n', 'First change')
        self.assertEqual(self.pr_ship().returncode, 0)
        self.assertNotIn('topic', git(self.origin, 'branch', '--list'), 'merged: the branch is deleted on origin')
        self.change(self.tree, 'two.txt', '2\n', 'Second change')
        result = self.pr_ship()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('Second change', git(self.origin, 'log', '--format=%s', 'main'))

    def test_a_failed_required_check_says_which_and_leaves_the_pr_open(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = self.pr_ship({'fail_check': {'name': 'python', 'link': 'https://example.test/run/1'}})
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('ship: FAILED', result.stdout + result.stderr)
        self.assertIn('python', result.stdout + result.stderr)
        self.assertIn('https://example.test/run/1', result.stdout + result.stderr)
        self.assertNotIn('My change', git(self.origin, 'log', '--format=%s', 'main'))
        self.assertNotIn('pr close', ' '.join(self.calls()), 'the PR stays open for the session to fix and push again')

    def test_a_cancelled_check_is_a_superseded_run_not_a_failure(self):
        # 15 Oct 2026: every PR workflow cancels its older run on a push; ship.sh's own rebase push cancelled the run it was watching and it reported FAILED (#874)
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = self.pr_ship({'fail_check_once': {'name': 'replay (3)', 'link': 'https://example.test/run/3/job/1', 'bucket': 'cancel'}})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('looking again', result.stdout + result.stderr)

    def test_a_check_that_stays_cancelled_is_a_failure(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = self.pr_ship({'fail_check': {'name': 'replay (3)', 'link': 'https://example.test/run/3/job/1', 'bucket': 'cancel'}})
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)

    def test_a_second_run_reuses_the_open_pr_and_a_fixed_check_lands_it(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        self.assertEqual(self.pr_ship({'fail_check': {'name': 'python', 'link': 'https://example.test/run/1'}}).returncode, 1)
        data = json.loads(self.state.read_text()); data.pop('fail_check'); self.state.write_text(json.dumps(data))
        result = self.pr_ship(json.loads(self.state.read_text()))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(sum(1 for call in self.calls() if call.startswith('pr create')), 1, 'one PR per branch')
        self.assertIn('My change', git(self.origin, 'log', '--format=%s', 'main'))

    def test_a_second_run_with_a_new_body_refreshes_the_open_prs_description(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        first, second = self.tmp / 'first.md', self.tmp / 'second.md'
        def summary(line):
            rows = ''.join(f'| {area} | — None | — |\n' for area in ('Real users', 'Form filling', 'Admin data accuracy', 'Offline replays', 'Tests & harness', 'Development speed', 'Cost'))
            return f'🟢 {line}\n\n**Why:** a test.\n**Unblocks:** nothing.\n\n| Area | Impact | How |\n|---|---|---|\n{rows}\n- ✅ a bullet\n\n| | Before | After |\n|---|---|---|\n| x | a | b |\n'
        first.write_text(summary('First summary')); second.write_text(summary('Second summary with new numbers'))
        opened = self.pr_ship({'fail_check': {'name': 'python', 'link': 'https://example.test/run/1'}}, f'--body={first}')
        self.assertEqual(opened.returncode, 1, opened.stdout + opened.stderr)
        self.assertNotIn('pr edit', ' | '.join(self.calls()), 'a new PR gets its body at creation, no edit')
        data = json.loads(self.state.read_text()); data.pop('fail_check'); self.state.write_text(json.dumps(data))
        result = self.pr_ship(json.loads(self.state.read_text()), f'--body={second}')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('refreshed the description of #1', result.stdout)
        body = json.loads(self.state.read_text()).get('body') or ''
        self.assertIn('Second summary with new numbers', body)
        self.assertNotIn('First summary', body)
        self.assertEqual(sum(1 for call in self.calls() if call.startswith('pr create')), 1)

    def test_a_bad_body_stops_ship_before_any_check_or_push(self):
        # 26 Oct 2026 (c5): ship ran 139 s of push checks, pushed, then failed on "no Before/After table". The body is checked first now, in about a second.
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        bad = self.tmp / 'bad.md'
        bad.write_text('🟢 A change\n\n- ✅ a bullet\n')   # no Why, no impact table, no Before/After
        result = self.pr_ship(None, f'--body={bad}')
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('the PR description is not laid out', result.stderr)
        self.assertIn('nothing was pushed', result.stderr)
        self.assertNotIn('running the push checks', result.stdout + result.stderr)
        self.assertNotIn('topic', git(self.origin, 'branch', '--list', 'topic'), 'the branch never reached origin')
        self.assertFalse(any(call.startswith('pr create') for call in self.calls()))

    def test_a_failed_flow_check_rebases_and_pushes_again_by_itself(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        self.change(self.other, 'theirs.txt', 'x\n', 'Landed meanwhile')
        git(self.other, 'push', '-q', 'origin', 'main')
        result = self.pr_ship({'fail_check_once': {'name': 'All checks passed', 'link': 'https://example.test/run/2/job/9', 'step_red': True}})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('rebasing again', result.stdout)
        self.assertEqual(git(self.origin, 'log', '--format=%s', 'main').splitlines()[:2], ['My change', 'Landed meanwhile'])

    def test_a_failed_step_other_than_the_flow_one_stops_the_run(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = self.pr_ship({'fail_check': {'name': 'All checks passed', 'link': 'https://example.test/run/2/job/9'}})
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertNotIn('rebasing again', result.stdout)

    def test_no_gh_or_a_plain_path_origin_keeps_the_direct_push(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh')], cwd=self.tree, capture_output=True, text=True, timeout=60)   # no SHIP_MODE: a local-path origin is no GitHub
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('pushing to main', result.stdout)
        self.assertNotIn('topic', git(self.origin, 'branch', '--list'), 'a direct landing pushes main only')

    def mode(self, allowed):
        self.state.write_text(json.dumps({'origin': str(self.origin), 'auto_merge_allowed': allowed}))
        git(self.tree, 'remote', 'set-url', 'origin', 'https://github.com/example/repo.git')
        env = {**os.environ, 'PATH': f'{self.bin}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_STATE': str(self.state)}
        run = lambda code: subprocess.run(['bash', '-c', f'source "{self.tree}/tools/ship-pr.sh"; {code}'], cwd=self.tree, capture_output=True, text=True, env=env).stdout.strip()
        return run('ship_mode'), run('ship_review && echo review || echo auto')

    def test_a_github_origin_always_lands_through_a_pr_and_the_owner_merges_whatever_the_setting(self):
        # Owner, 12 Oct 2026: "I'd like to review them all, by hand". main takes PRs only, so auto-merge off no longer means a push to main.
        self.assertEqual(self.mode(False), ('pr', 'review'), 'auto-merge not allowed: the owner merges by hand')
        # 17 Oct 2026: the owner allowed auto-merge for his own button and ship armed it on #1139/#1140; the setting never says who merges
        self.assertEqual(self.mode(True), ('pr', 'review'), 'auto-merge allowed in the repository: still the owner merges')

    def test_review_mode_stops_with_the_pr_open_once_its_required_checks_are_green(self):
        self.change(self.tree, 'mine.txt', 'x\n', 'My change')
        result = self.pr_ship({}, SHIP_REVIEW='1')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('ship: REVIEW #1 https://example.test/pull/1', result.stdout)
        self.assertNotIn('ship: DONE', result.stdout)
        state = json.loads(self.state.read_text())
        self.assertEqual(state.get('state'), 'OPEN', 'never merged by ship: the owner merges')
        self.assertFalse(state.get('auto'), 'auto-merge never turned on')
        self.assertNotIn('My change', git(self.origin, 'log', '--format=%s', 'main'))

    def test_review_mode_still_reports_a_failed_required_check(self):
        self.change(self.tree, 'mine.txt', 'x\n', 'My change')
        result = self.pr_ship({'fail_check': {'name': 'python', 'link': 'https://example.test/run/9'}}, SHIP_REVIEW='1')
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("check 'python' failed", result.stdout + result.stderr)

    def test_draft_stays_a_draft_until_every_check_is_green(self):
        # Owner, 14 Oct 2026: a PR showed "Rebase and merge" while its checks still ran; --draft keeps it unmergeable until ship sees them all green.
        self.change(self.tree, 'mine.txt', 'x\n', 'My change')
        result = self.pr_ship({}, '--draft', SHIP_REVIEW='1')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        state = json.loads(self.state.read_text())
        self.assertTrue(any(call.startswith('pr create') and '--draft' in call for call in state['calls']), 'opened as a draft')
        self.assertFalse(state['draft'], 'marked ready once green')
        self.assertIn('marked ready for review', result.stdout)

    def test_draft_with_a_red_check_stays_a_draft(self):
        self.change(self.tree, 'mine.txt', 'x\n', 'My change')
        result = self.pr_ship({'fail_check': {'name': 'python', 'link': 'https://example.test/run/9'}}, '--draft', SHIP_REVIEW='1')
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertTrue(json.loads(self.state.read_text())['draft'], 'a red PR is never marked ready')

    # --- the watcher after REVIEW (tools/ship-watch.sh, 18 Oct 2026): review mode leaves one running, a second ship replaces it, SHIP_WATCH=0 starts none
    def pid(self):
        files = list((self.main / '.git').glob('ship-watch-*.pid'))
        return int(files[0].read_text()) if files else None

    def alive(self, pid):
        try: os.kill(pid, 0)
        except OSError: return False
        return True

    def test_review_starts_one_watcher_and_a_second_ship_replaces_it(self):
        self.change(self.tree, 'mine.txt', 'x\n', 'My change')
        result = self.pr_ship({}, SHIP_REVIEW='1', SHIP_WATCH='1', SHIP_WATCH_POLL='1')
        self.assertIn('ship: REVIEW #1', result.stdout)
        for _ in range(50):
            if self.pid(): break
            time.sleep(0.1)
        first = self.pid()
        self.assertIsNotNone(first, 'a watcher pid file next to the git dir')
        self.addCleanup(lambda: self.pid() and os.kill(self.pid(), signal.SIGTERM) if self.alive(self.pid() or 0) else None)
        self.change(self.tree, 'more.txt', 'y\n', 'More')
        self.pr_ship({}, '--title=Both changes', SHIP_REVIEW='1', SHIP_WATCH='1', SHIP_WATCH_POLL='1')   # 2 commits and a fresh fake state: a PR would be opened, which needs a title
        for _ in range(50):
            if self.pid() != first: break
            time.sleep(0.1)
        self.assertNotEqual(self.pid(), first)
        time.sleep(0.5)
        self.assertFalse(self.alive(first), 'the old watcher is gone: never two')

    def test_ship_watch_zero_starts_none(self):
        self.change(self.tree, 'mine.txt', 'x\n', 'My change')
        self.pr_ship({}, SHIP_REVIEW='1')   # setUp's SHIP_WATCH=0
        time.sleep(0.5)
        self.assertIsNone(self.pid())


if __name__ == '__main__':
    unittest.main()
