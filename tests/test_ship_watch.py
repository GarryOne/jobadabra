"""tools/ship-watch.sh (18 Oct 2026): after `ship: REVIEW` a detached watcher adds MERGED / CLOSED / RED / WATCH ENDED to ship's log, so a session learns of the owner's merge.
A fake `gh` reads its answers from files: state.txt (OPEN|MERGED|CLOSED, then an optional sha) and checks.txt (the failing check name or empty); a script of steps may rewrite them between looks.\nverdicts: the \"All checks passed\" status per look (pending, else green; pr-verdict.yml since 26 Oct 2026); runs: the head's check-runs (none, running, gate = the old job, else green)."""
import os
import shutil
import signal
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAKE = """#!/bin/sh
d="$FAKE_GH_DIR"; n=$(cat "$d/looks" 2>/dev/null || echo 0)
case "$1 $2" in
  "pr view") n=$((n + 1)); echo $n > "$d/looks"; s=$(sed -n "${n}p" "$d/states"); [ -n "$s" ] || s=$(tail -n 1 "$d/states")
             m=$(sed -n "${n}p" "$d/mergeables" 2>/dev/null); [ -n "$m" ] || m=MERGEABLE
             set -- $s; if [ "$1" = MERGED ]; then echo "{\\"headRefOid\\":\\"new1\\",\\"url\\":\\"https://github.com/o/r/pull/7\\",\\"state\\":\\"MERGED\\",\\"mergeable\\":\\"$m\\",\\"mergeCommit\\":{\\"oid\\":\\"$2\\"}}"; else echo "{\\"headRefOid\\":\\"new1\\",\\"url\\":\\"https://github.com/o/r/pull/7\\",\\"state\\":\\"$1\\",\\"mergeable\\":\\"$m\\",\\"mergeCommit\\":null}"; fi ;;
  "api repos/o/r/commits/new1/check-runs?per_page=100") r=$(sed -n "${n}p" "$d/runs" 2>/dev/null); [ -n "$r" ] || r=ok
             case "$r" in none|running) echo no;; gate) echo gate;; *) echo green;; esac ;;
  "api repos/o/r/commits/new1/status") v=$(sed -n "${n}p" "$d/verdicts" 2>/dev/null); [ "$v" = pending ] && echo false || echo true ;;
  "pr checks") c=$(sed -n "${n}p" "$d/checks" 2>/dev/null); if [ "$c" = pending ]; then echo '[{"name":"x","bucket":"pending"}]'; elif [ -n "$c" ]; then echo "[{\\"name\\":\\"$c\\",\\"bucket\\":\\"fail\\"}]"; else echo '[{"name":"x","bucket":"pass"}]'; fi ;;
esac
"""


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class ShipWatchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'bin').mkdir()
        gh = self.tmp / 'bin' / 'gh'
        gh.write_text(FAKE)
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        (self.tmp / 'fix.sh').write_text('#!/bin/sh\necho "$1" >> "$(dirname "$0")/fixes"\n[ -f "$(dirname "$0")/fixes-ok" ] && echo "ship: CONFLICT FIXED #$1 (stacked parent #1)" >> "$2"\nexit 0\n')
        self.log, self.pidfile = self.tmp / 'ship.log', self.tmp / 'watch.pid'
        self.log.write_text('ship: [3s] opened the pull request: https://example.test/pull/7\n')

    def watch(self, states, checks='', cap=60, poll=0, mergeables='', runs='', verdicts=''):
        (self.tmp / 'states').write_text(states)
        (self.tmp / 'mergeables').write_text(mergeables)
        (self.tmp / 'fixes').write_text('')
        (self.tmp / 'checks').write_text(checks)
        (self.tmp / 'runs').write_text(runs)
        (self.tmp / 'verdicts').write_text(verdicts)
        (self.tmp / 'looks').write_text('0')
        env = {**os.environ, 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.tmp), 'SHIP_WATCH_POLL': str(poll), 'SHIP_WATCH_CAP': str(cap), 'SHIP_WATCH_FIX': str(self.tmp / 'fix.sh')}
        subprocess.run(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile)], env=env, timeout=30, check=True)
        return self.log.read_text().splitlines()[1:]

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
        """#1476: the rollup still held the old head's passing checks right after a push. gh pr checks says pass throughout; the head's own check-runs decide."""
        lines = self.watch('OPEN\nOPEN\nOPEN\nOPEN\nMERGED fff0000\n', runs='none\nrunning\nok\nok\n')
        self.assertEqual(lines, ['ship: GREEN #7', 'ship: MERGED #7 fff0000'])
        self.assertEqual((self.tmp / 'looks').read_text().strip(), '5')

    def test_green_waits_for_the_all_checks_passed_status(self):
        """26 Oct 2026: "All checks passed" is a status pr-verdict.yml writes when the PR's workflows end; every check-run green is not enough while it is pending."""
        lines = self.watch('OPEN\nOPEN\nOPEN\nMERGED fff0000\n', verdicts='pending\npending\n')
        self.assertEqual(lines, ['ship: GREEN #7', 'ship: MERGED #7 fff0000'])
        self.assertEqual((self.tmp / 'looks').read_text().strip(), '4', 'green only at the third look, when the status is green')

    def test_a_pr_whose_runs_predate_the_status_is_green_by_the_old_gate_job(self):
        self.assertEqual(self.watch('OPEN\nMERGED fff0000\n', runs='gate\n', verdicts='pending\n'), ['ship: GREEN #7', 'ship: MERGED #7 fff0000'])

    def test_no_green_while_the_new_heads_checks_are_missing_or_running(self):
        self.assertEqual(self.watch('OPEN\nOPEN\nCLOSED\n', runs='none\nrunning\n'), ['ship: CLOSED #7 (unmerged)'])

    def test_a_pr_still_open_at_the_cap_ends_the_watch(self):
        self.assertEqual(self.watch('OPEN\n', checks='pending\n' * 4, cap=2, poll=1), ['ship: WATCH ENDED #7 (still open)'])

    def test_a_second_watcher_replaces_the_first_by_pid_file(self):
        env = {**os.environ, 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.tmp), 'SHIP_WATCH_POLL': '1', 'SHIP_WATCH_CAP': '60'}
        (self.tmp / 'states').write_text('OPEN\n')
        first = subprocess.Popen(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile)], env=env)
        self.addCleanup(lambda: first.poll() is None and first.kill())
        for _ in range(50):
            if self.pidfile.exists(): break
            time.sleep(0.1)
        second = subprocess.Popen(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile)], env=env)
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


if __name__ == '__main__':
    unittest.main()
