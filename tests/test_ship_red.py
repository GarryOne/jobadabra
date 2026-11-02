"""tools/ship.sh while main is red (11 Oct 2026, the owner: someone made a red main and others kept landing): every landing but the fix waits and says so, a revert is advised after 5 minutes (15 with a claim), the fix itself never waits, SHIP_IGNORE_RED=1 skips, and the red period is logged. A fake gh serves main's CI runs."""
import json
import os
import subprocess
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from tests.ship_fixture import ShipFixture, git


def iso(minutes_ago):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).strftime('%Y-%m-%dT%H:%M:%SZ')


class ShipRedTest(ShipFixture):
    def setUp(self):
        super().setUp()
        self.gh = self.tmp / 'gh'
        self.gh.mkdir()
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'gh').write_text(f'#!/bin/bash\nstate="{self.gh.as_posix()}"\ncase "$1 $2" in\n  "run list") cat "$state/runs.json" ;;\n  "run view") echo 1 ;;\n  "run rerun") ;;\nesac\n')
        (bin_dir / 'gh').chmod(0o755)
        self.tip = git(self.tree, 'rev-parse', 'origin/main')
        self.env = {**os.environ, 'PATH': f'{bin_dir.as_posix()}{os.pathsep}{os.environ["PATH"]}', 'SHIP_RED_POLL': '0.2', 'JOBADABRA_SESSION': 'test-session'}
        self.change(self.tree, 'mine.txt', 'x\n', 'My change')

    def runs(self, minutes_ago=1, red=True):
        rows = [{'workflowName': name, 'headSha': self.tip, 'status': 'completed', 'conclusion': 'failure' if (red and n == 0) else 'success', 'databaseId': 40 + n, 'updatedAt': iso(minutes_ago), 'url': f'https://x/runs/{40 + n}'}
                for n, name in enumerate(('CI · Tests', 'CI · Integration · Page cases (all cases, real extension, Linux)'))]
        self.write_runs(rows)

    def write_runs(self, rows):
        """Written aside and renamed: the fake gh, read every 0.2 s by a waiting ship.sh, never serves a half-written file."""
        (self.gh / 'runs.json.new').write_text(json.dumps(rows))
        os.replace(self.gh / 'runs.json.new', self.gh / 'runs.json')

    def ship_red(self, *flags, **env):
        return subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh'), *flags], cwd=self.tree, capture_output=True, text=True, timeout=90, env={**self.env, 'SHIP_LOG': str(self.tmp / 'ship.log'), **env})

    def green_once_it_waits(self):
        """Main turns green when the landing has said it waits (not after a guessed time: a loaded Mac may take seconds to start it)."""
        def watch():
            deadline = time.monotonic() + 60
            log = self.tmp / 'ship.log'
            while time.monotonic() < deadline:
                if log.exists() and 'main is red at' in log.read_text():
                    time.sleep(0.5)   # clock: no assertion depends on it; the landing has already said it waits
                    return self.runs(red=False)
                time.sleep(0.1)   # clock: a poll of the landing's log
        thread = threading.Thread(target=watch, daemon=True)
        thread.start()
        return thread

    def test_a_landing_waits_while_main_is_red_says_so_and_goes_on_when_it_is_green(self):
        self.runs(minutes_ago=1)
        self.green_once_it_waits()
        result = self.ship_red()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertRegex(result.stdout, rf'main is red at {self.tip[:7]} \(CI · Tests, \d+s ago\), nobody has claimed it; a revert is advised after 5 min: waiting for the fix, before the checks \(SHIP_IGNORE_RED=1 only with the owner')
        self.assertIn('main is green again', result.stdout)
        self.assertIn('My change', git(self.origin, 'log', '--format=%s', 'main'))
        log = (self.main / '.git' / 'gate-timing.log').read_text()
        self.assertRegex(log, r'red-main begins sha=')
        self.assertRegex(log, r'red-main ended start=\S+ cause=CI_·_Tests sha=\S+ claim=- fix=\S+ minutes=\d+(\.\d+)? waited=1')

    def test_after_five_minutes_without_a_claim_a_revert_is_advised_loudly_and_nothing_is_pushed(self):
        self.runs(minutes_ago=6)
        result = self.ship_red()
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertRegex(result.stderr, rf'RED MAIN FOR 6 MIN \d+ s at {self.tip[:7]}')
        self.assertIn(f'tools/revert-red.sh {self.tip[:7]}', result.stderr)
        self.assertNotIn('My change', git(self.origin, 'log', '--format=%s', 'main'))

    def test_a_claim_extends_the_limit_to_fifteen_minutes_once(self):
        self.runs(minutes_ago=6)
        subprocess.run(['bash', str(self.tree / 'tools' / 'red-main.sh'), 'claim', self.tip, '--session', 'fixer-session'], cwd=self.tree, check=True, capture_output=True, env=self.env)
        self.green_once_it_waits()
        result = self.ship_red()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('fixer-session is fixing it, waits up to 15 min', result.stdout)
        (self.tmp / 'ship.log').unlink(missing_ok=True)
        self.runs(minutes_ago=16)
        self.change(self.tree, 'again.txt', 'y\n', 'Another change')
        late = self.ship_red()
        self.assertEqual(late.returncode, 3)
        self.assertIn('RED MAIN FOR 16 MIN', late.stderr)
        self.assertIn('fixer-session claimed it', late.stderr)

    def test_the_fix_never_waits_and_the_off_switch_skips_the_wait(self):
        self.runs(minutes_ago=30)
        self.assertEqual(self.ship_red('--fix').returncode, 0)
        self.change(self.tree, 'other.txt', 'z\n', 'Third change')
        self.assertEqual(self.ship_red(SHIP_IGNORE_RED='1').returncode, 0)

    def test_a_landing_through_a_pull_request_never_waits_on_a_red_main(self):
        # 12 Oct 2026: the PR's required checks guard main; three PR landings gave up on a red main that was a flake already re-run green
        self.runs(minutes_ago=30)
        script = f'here={self.tree.as_posix()}; flags=""; mode=pr; step() {{ echo "ship: $*"; }}; source tools/ship-red.sh; ship_red_gate "before the checks"; echo "went on"'
        result = subprocess.run(['bash', '-c', script], cwd=self.tree, capture_output=True, text=True, timeout=30, env=self.env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('went on', result.stdout)
        self.assertRegex(result.stdout, rf'main is red at {self.tip[:7]}: not waiting, the pull request.s own checks decide')
        self.assertNotIn('waiting for the fix', result.stdout)

    def test_a_red_fix_still_building_does_not_unblock_the_wait(self):
        self.runs(minutes_ago=6)
        rows = json.loads((self.gh / 'runs.json').read_text())
        building = [{**r, 'headSha': 'f' * 40, 'status': 'in_progress', 'conclusion': ''} for r in rows]
        self.write_runs(building + rows)
        self.assertEqual(self.ship_red().returncode, 3, 'the in-flight fix on top of the red commit proves nothing')


if __name__ == '__main__':
    import unittest
    unittest.main()
