"""tools/ship-watch.sh (18 Oct 2026): after `ship: REVIEW` a detached watcher adds MERGED / CLOSED / RED / WATCH ENDED to ship's log, so a session learns of the owner's merge.
A fake `gh` reads its answers from files: state.txt (OPEN|MERGED|CLOSED, then an optional sha) and checks.txt (the failing check name or empty); a script of steps may rewrite them between looks.\nverdicts: the \"All checks passed\" status per look (pending, else green; pr-verdict.yml since 26 Oct 2026); runs: the head's check-runs (none, running, gate = the old job, else green)."""
import json
import os
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class ShipWatchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'bin').mkdir()
        gh = self.tmp / 'bin' / 'gh'
        gh.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{ROOT / "tests" / "fake_gh_rest.py"}" "$@"\n')
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        (self.tmp / 'fix.sh').write_text('#!/bin/sh\necho "$1" >> "$(dirname "$0")/fixes"\n[ -f "$(dirname "$0")/fixes-ok" ] && echo "ship: CONFLICT FIXED #$1 (stacked parent #1)" >> "$2"\nexit 0\n')
        self.log, self.pidfile = self.tmp / 'ship.log', self.tmp / 'watch.pid'
        self.log.write_text('ship: [3s] opened the pull request: https://example.test/pull/7\n')

    def env(self, poll=0, cap=60):
        return {**os.environ, 'CODEX_THREAD_ID': '', 'CODEX_SESSION_ID': '', 'CMUX_SURFACE_ID': '', 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.tmp), 'PR_REST_CACHE': str(self.tmp / 'cache'),
                'SHIP_WATCH_POLL': str(poll), 'SHIP_WATCH_CAP': str(cap), 'SHIP_WATCH_FIX': str(self.tmp / 'fix.sh'), **getattr(self, 'codex_env', {})}

    def watch(self, states, checks='', cap=60, poll=0, mergeables='', runs='', verdicts='', heads='', labels=''):
        (self.tmp / 'states').write_text(states)
        (self.tmp / 'mergeables').write_text(mergeables)
        (self.tmp / 'fixes').write_text('')
        (self.tmp / 'checks').write_text(checks)
        (self.tmp / 'runs').write_text(runs)
        (self.tmp / 'verdicts').write_text(verdicts)
        (self.tmp / 'heads').write_text(heads)
        (self.tmp / 'labels').write_text(labels)
        (self.tmp / 'looks').write_text('0')
        subprocess.run(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile), 'o/r'], env=self.env(poll, cap), timeout=30, check=True)
        return self.log.read_text().splitlines()[1:]

    def test_codex_session_receives_state_events_without_terminal_input(self):
        codex = self.tmp / 'bin' / 'codex'
        codex.write_text(f'#!{sys.executable}\nimport json,sys\nwith open({str(self.tmp / "queued")!r}, "a") as out: out.write(json.dumps(sys.argv[1:])+"\\n")\n')
        codex.chmod(0o700)
        thread = '01a18ac0-a906-7ba1-bf47-93e2bf1db6a7'
        self.codex_env = {'CODEX_THREAD_ID': thread, 'CMUX_AGENT_LAUNCH_EXECUTABLE': str(codex)}
        self.watch('OPEN\nOPEN\nMERGED abc1234\n', checks='python\npython\n')
        queued = [json.loads(line) for line in (self.tmp / 'queued').read_text().splitlines()]
        self.assertEqual(len(queued), 2)
        for args in queued:
            self.assertEqual(args[:3], ['queue', '--thread', thread])
            self.assertEqual(args[-1], '--resume')
        self.assertIn('RED #7 python', queued[0][4])
        self.assertIn('MERGED #7 abc1234', queued[1][4])

    def test_codex_terminal_queue_failure_is_retried_before_watcher_exits(self):
        codex = self.tmp / 'bin' / 'codex'
        attempts = self.tmp / 'attempts'
        codex.write_text(f'#!{sys.executable}\nfrom pathlib import Path\np=Path({str(attempts)!r})\nn=int(p.read_text())+1 if p.exists() else 1\np.write_text(str(n))\nraise SystemExit(1 if n==1 else 0)\n')
        codex.chmod(0o700)
        self.codex_env = {'CODEX_THREAD_ID': '01a18ac0-a906-7ba1-bf47-93e2bf1db6a7',
                          'CMUX_AGENT_LAUNCH_EXECUTABLE': str(codex)}
        lines = self.watch('MERGED abc1234\n')
        self.assertEqual(lines, ['ship: MERGED #7 abc1234'])
        self.assertEqual(attempts.read_text(), '2')

    def test_persistent_terminal_delivery_failure_stops_without_post_merge_polling(self):
        codex = self.tmp / 'bin' / 'codex'
        attempts = self.tmp / 'attempts'
        codex.write_text(f'#!{sys.executable}\nfrom pathlib import Path\np=Path({str(attempts)!r})\nn=int(p.read_text())+1 if p.exists() else 1\np.write_text(str(n))\nraise SystemExit(1)\n')
        codex.chmod(0o700)
        self.codex_env = {'CODEX_THREAD_ID': '01a18ac0-a906-7ba1-bf47-93e2bf1db6a7',
                          'CMUX_AGENT_LAUNCH_EXECUTABLE': str(codex)}
        lines = self.watch('MERGED abc1234\n', cap=3)
        self.assertEqual((self.tmp / 'looks').read_text().strip(), '1')
        self.assertEqual(attempts.read_text(), '3')
        self.assertIn('ship: CODEX DELIVERY PENDING #7 (PR MERGED; events remain in the log)', lines)
        self.assertFalse(any('still open' in line for line in lines))

    def test_open_then_merged_reports_the_merge_commit_and_stops(self):
        self.assertEqual(self.watch('OPEN\nOPEN\nMERGED abc1234def\n', checks='pending\npending\n'), ['ship: MERGED #7 abc1234'])
        self.assertFalse(self.pidfile.exists(), 'the pid file goes with the watcher')

    def test_open_then_closed_says_unmerged(self):
        self.assertEqual(self.watch('OPEN\nCLOSED\n', checks='pending\n'), ['ship: CLOSED #7 (unmerged)'])

    def test_a_check_turning_red_is_reported_once_then_green_once_and_watching_goes_on_to_the_merge(self):
        lines = self.watch('OPEN\nOPEN\nOPEN\nOPEN\nOPEN\nMERGED fff0000\n', checks='pending\npython\npython\npending\n\n')
        self.assertEqual(lines, ['ship: RED #7 python', 'ship: GREEN #7', 'ship: MERGED #7 fff0000'])

    def test_red_from_the_first_look_is_reported_without_any_review_line(self):
        """Started when the PR opens: the log has no REVIEW line, ship may have ended FAILED."""
        self.log.write_text('ship: FAILED pull request #7 check python failed\n')
        self.assertEqual(self.watch('OPEN\nCLOSED\n', checks='python\n'), ['ship: RED #7 python', 'ship: CLOSED #7 (unmerged)'][:2])

    def test_a_second_red_after_a_rerun_speaks_again(self):
        lines = self.watch('OPEN\nOPEN\nOPEN\nOPEN\nCLOSED\n', checks='python\npending\npython\n\n')
        self.assertEqual(lines, ['ship: RED #7 python', 'ship: RED #7 python', 'ship: GREEN #7', 'ship: CLOSED #7 (unmerged)'])

    def test_green_waits_for_the_current_heads_checks_and_speaks_once(self):
        """#1476: the rollup still held the old head's passing checks right after a push; the head's own check-runs decide."""
        lines = self.watch('OPEN\nOPEN\nOPEN\nOPEN\nMERGED fff0000\n', runs='none\nrunning\nok\nok\n')
        self.assertEqual(lines, ['ship: GREEN #7', 'ship: MERGED #7 fff0000'])
        self.assertEqual((self.tmp / 'looks').read_text().strip(), '5')

    def test_green_waits_for_the_all_checks_passed_status(self):
        """26 Oct 2026: "All checks passed" is a status pr-verdict.yml writes when the PR's workflows end; every check-run green is not enough while it is pending."""
        lines = self.watch('OPEN\nOPEN\nOPEN\nMERGED fff0000\n', verdicts='pending\npending\n')
        self.assertEqual(lines, ['ship: GREEN #7', 'ship: MERGED #7 fff0000'])
        self.assertEqual((self.tmp / 'looks').read_text().strip(), '4', 'green only at the third look, when the status is green')

    def test_a_pr_whose_runs_predate_the_status_is_green_by_the_old_gate_job(self):
        self.assertEqual(self.watch('OPEN\nMERGED fff0000\n', runs='gate\n', verdicts='none\n'), ['ship: GREEN #7', 'ship: MERGED #7 fff0000'])

    def test_no_green_while_the_new_heads_checks_are_missing_or_running(self):
        self.assertEqual(self.watch('OPEN\nOPEN\nCLOSED\n', runs='none\nrunning\n'), ['ship: CLOSED #7 (unmerged)'])

    def test_ready_needs_green_and_gitars_approval_on_this_head_and_a_new_head_re_arms_it(self):
        # Owner via d3, 30 Oct 2026: "my PRs are not fully approved by Gitar": d3 said ready on GREEN while Gitar read "approved with suggestions".
        approved, suggests = 'Gitar: approved', 'Gitar: approved with suggestions'
        lines = self.watch('OPEN\nOPEN\nOPEN\nOPEN\nOPEN\nMERGED fff0000\n', checks='\n\n\npending\n\n\n', heads='new1\nnew1\nnew1\nnew2\nnew2\nnew2\n',
                           labels=f'{suggests}\n{approved}\n{approved}\nGitar: reviewing\n{approved}\n{approved}\n')
        self.assertEqual(lines, ['ship: GREEN #7', 'ship: READY #7 new1', 'ship: GREEN #7', 'ship: READY #7 new2', 'ship: MERGED #7 fff0000'])

    def test_no_ready_while_a_session_works_on_comments_or_the_owner_waits_for_an_answer(self):
        working = self.watch('OPEN\nOPEN\nMERGED fff0000\n', labels='Gitar: approved,Working on PR comments\nGitar: approved\n')
        self.assertEqual(working, ['ship: GREEN #7', 'ship: READY #7 new1', 'ship: MERGED #7 fff0000'], 'READY once the session is done')
        self.log.write_text('ship: [3s] opened the pull request: https://example.test/pull/7\n')
        (self.tmp / 'rest').mkdir(exist_ok=True)
        (self.tmp / 'rest' / 'repos_o_r_issues_7_comments_per_page_100').write_text(json.dumps([
            {'node_id': 'C1', 'user': {'login': 'GarryOne'}, 'body': 'Please rename it', 'html_url': 'u', 'created_at': '2026-10-30T00:00:00Z'}]))
        asked = self.watch('OPEN\nMERGED fff0000\n', labels='Gitar: approved\n')
        self.assertEqual(asked, ['ship: COMMENT #7 owner comment u', 'ship: GREEN #7', 'ship: MERGED #7 fff0000'])

    def test_a_failed_check_read_never_repeats_ready_for_the_same_head(self):
        lines = self.watch('OPEN\nOPEN\nOPEN\nMERGED fff0000\n', runs='ok\nrefused\nok\n', labels='Gitar: approved\n' * 3)
        self.assertEqual(lines.count('ship: READY #7 new1'), 1, lines)

    def test_the_labels_ready_reads_are_the_ones_gitar_label_writes(self):
        source, labels = (ROOT / 'tools' / 'ship-watch.sh').read_text(), (ROOT / 'tools' / 'gitar-label.mjs').read_text()
        for name in ('Gitar: approved', 'Working on PR comments'):
            self.assertIn(f"name: '{name}'", labels, 'tools/gitar-label.mjs writes it')
            self.assertIn(f'index("{name}")', source, 'tools/ship-watch.sh reads the same name')

    def test_a_pr_still_open_at_the_cap_ends_the_watch(self):
        self.assertEqual(self.watch('OPEN\n', checks='pending\n' * 4, cap=2, poll=1), ['ship: WATCH ENDED #7 (still open)'])

    def test_a_refused_look_waits_twice_as_long_each_time(self):
        # 27 Oct 2026: the owner's GraphQL limit ran out; ~38 pollers kept asking every minute and every watcher was blind until the hour reset.
        start = time.monotonic()
        self.assertEqual(self.watch('REFUSED\n', cap=6, poll=1), ['ship: WATCH ENDED #7 (still open)'])
        self.assertEqual((self.tmp / 'looks').read_text().strip(), '3', 'looks after 2 s, then 4 s: not one a second')
        self.assertLess(time.monotonic() - start, 15)

    def test_a_look_that_answers_again_goes_back_to_the_normal_pace(self):
        self.assertEqual(self.watch('REFUSED\nOPEN\nOPEN\nMERGED abc1234def\n', checks='pending\n' * 4, poll=1), ['ship: MERGED #7 abc1234'])

    def test_a_second_watcher_replaces_the_first_by_pid_file(self):
        env = self.env(poll=1)
        (self.tmp / 'states').write_text('OPEN\n')
        first = subprocess.Popen(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile), 'o/r'], env=env)
        self.addCleanup(lambda: first.poll() is None and first.kill())
        for _ in range(50):
            if self.pidfile.exists(): break
            time.sleep(0.1)
        second = subprocess.Popen(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile), 'o/r'], env=env)
        self.addCleanup(lambda: second.poll() is None and second.kill())
        first.wait(timeout=10)   # killed by the second
        self.assertIsNotNone(first.returncode)
        self.assertIsNone(second.poll(), 'only the newest watcher keeps running')
        self.assertEqual(self.pidfile.read_text().strip(), str(second.pid))

    def test_a_conflict_is_reported_once_asks_the_fixer_once_and_clearing_re_arms_green(self):
        lines = self.watch('OPEN\nOPEN\nOPEN\nOPEN\nOPEN\nCLOSED\n', checks='\n\n\n\n\n', mergeables='MERGEABLE\nCONFLICTING\nCONFLICTING\nMERGEABLE\nCONFLICTING\n')
        self.assertEqual(lines, ['ship: GREEN #7', 'ship: CONFLICT #7', 'ship: GREEN #7', 'ship: CONFLICT #7', 'ship: CLOSED #7 (unmerged)'])
        self.assertEqual((self.tmp / 'fixes').read_text().split(), ['7', '7'], 'the fixer runs once per new conflict')

    def test_unknown_mergeable_is_never_reported_and_keeps_the_last_known_state(self):
        lines = self.watch('OPEN\nOPEN\nOPEN\nOPEN\nCLOSED\n', checks='pending\n' * 6, mergeables='CONFLICTING\nUNKNOWN\nUNKNOWN\nCONFLICTING\n')
        self.assertEqual(lines, ['ship: CONFLICT #7', 'ship: CLOSED #7 (unmerged)'], 'UNKNOWN neither clears nor repeats the conflict')

    def test_a_fixed_conflict_is_logged_by_the_fixer_and_a_later_conflict_speaks_again(self):
        (self.tmp / 'fixes-ok').write_text('x')
        lines = self.watch('OPEN\nOPEN\nOPEN\nCLOSED\n', checks='pending\n' * 6, mergeables='CONFLICTING\nMERGEABLE\nCONFLICTING\n')
        self.assertEqual(lines, ['ship: CONFLICT #7', 'ship: CONFLICT FIXED #7 (stacked parent #1)', 'ship: CONFLICT #7', 'ship: CONFLICT FIXED #7 (stacked parent #1)', 'ship: CLOSED #7 (unmerged)'])

    def test_a_web_pr_is_watched_in_its_own_repo_and_its_merge_seen_after_the_worktree_is_deleted(self):
        """27 Oct 2026: web #177's watcher ran `gh pr view 177` in a worktree deleted after the merge; every look failed and it looked for 17 h without seeing MERGED."""
        wt = self.tmp / 'jobadabra-web-mobile'
        subprocess.run(['git', 'init', '-q', str(wt)], check=True)
        subprocess.run(['git', '-C', str(wt), 'remote', 'add', 'origin', 'git@github.com:GarryOne/jobadabra-web.git'], check=True)
        (self.tmp / 'states').write_text('OPEN\nOPEN\nMERGED e2ca81e9\n')
        (self.tmp / 'checks').write_text('pending\n' * 3)
        w = subprocess.Popen(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '177', str(self.log), str(self.pidfile)], cwd=wt, env=self.env(poll=1))
        self.addCleanup(lambda: w.poll() is None and w.kill())
        for _ in range(100):
            if (self.tmp / 'looks').exists() and (self.tmp / 'looks').read_text().strip() == '1': break
            time.sleep(0.05)
        shutil.rmtree(wt)
        w.wait(timeout=20)
        self.assertEqual(self.log.read_text().splitlines()[1:], ['ship: MERGED #177 e2ca81e'])
        calls = (self.tmp / 'calls').read_text()
        self.assertIn('repos/GarryOne/jobadabra-web/pulls/177', calls)
        self.assertNotIn('graphql', calls)

    def test_a_folder_without_a_github_origin_ends_the_watch_at_once(self):
        plain = self.tmp / 'plain'
        subprocess.run(['git', 'init', '-q', str(plain)], check=True)
        subprocess.run(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile)], cwd=plain, env=self.env(), timeout=30, check=True)
        self.assertEqual(self.log.read_text().splitlines()[1:], ['ship: WATCH ENDED #7 (no GitHub repository)'])

    def test_an_unchanged_pr_costs_no_call_after_the_first_look(self):
        """27 Oct 2026, GraphQL budget ran out: every look sends the last ETag; GitHub's 304 is free and the cached answer is used."""
        self.assertEqual(self.watch('OPEN\n' * 3 + 'MERGED abc1234\n', checks='pending\n' * 4), ['ship: MERGED #7 abc1234'])
        calls = (self.tmp / 'calls').read_text().splitlines()
        conditional = [c for c in calls if 'If-None-Match' in c and '/comments' in c]
        self.assertTrue(conditional, 'the comment reads after the first look are conditional')


if __name__ == '__main__':
    unittest.main()
