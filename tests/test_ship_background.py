"""tools/ship.sh --background, 2 of 2: it returns at once, the log ends with a marker, a kill of the caller or of the run, and the extension version taken at ship time after the rebase. Fixture: ship_fixture.py."""
import os
import re
import signal
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from tests.ship_fixture import *   # noqa: F401,F403 (git, ROOT: the fixture)
from tests.ship_fixture import ShipFixture


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class ShipTest(ShipFixture):
    def start_background(self, hook_seconds, started_marker=None):
        """A background run whose push checks take hook_seconds; returns (log, run pid) as the caller sees them."""
        touch = f'touch {started_marker}\n' if started_marker else ''
        self.change(self.tree, 'tools/pre-push-check.sh', f'#!/bin/sh\ncat > /dev/null\n{touch}sleep {hook_seconds}\n', 'Slow hook')
        log = self.tmp / 'ship-bg.log'
        out = subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh'), '--background'], cwd=self.tree, capture_output=True, text=True, timeout=60,
                             env={**os.environ, 'SHIP_LOG': str(log)}).stdout
        pid = int(re.search(r'\(pid (\d+)\)', out).group(1))
        for _ in range(40):                                   # until the checks are running
            if log.exists() and 'running the push checks' in log.read_text():
                break
            time.sleep(0.25)
        return log, pid

    def wait_for_marker(self, log):
        for _ in range(60):
            if re.search(r'^ship: (DONE|FAILED)', log.read_text(), re.M):
                break
            time.sleep(0.5)
        return log.read_text()

    def test_background_returns_at_once_and_the_log_ends_with_done(self):
        self.change(self.tree, 'tools/pre-push-check.sh', '#!/bin/sh\ncat > /dev/null\nsleep 3\n', 'Slow hook')
        log = self.tmp / 'ship.log'
        started = time.time()
        result = subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh'), '--background'], cwd=self.tree, capture_output=True, text=True, timeout=60,
                                env={**os.environ, 'SHIP_LOG': str(log)})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(time.time() - started, 2.5, 'it returned before the checks finished')
        self.assertIn(str(log), result.stdout)
        for _ in range(60):
            if log.exists() and 'ship: DONE' in log.read_text():
                break
            time.sleep(0.5)
        self.assertTrue(log.read_text().splitlines()[-1].startswith('ship: DONE '), log.read_text())
        self.assertIn('Slow hook', git(self.origin, 'log', '--format=%s', 'main'))

    def test_a_background_run_keeps_the_cmux_short_name_after_it_detaches(self):
        # Gitar on #2629: the detached run has no Claude parent left to walk, so ship.sh must export the short name the owner sees in cmux (27) first;
        # without the export the run only knows JOBADABRA_SESSION=mac-07 and tags "[07]".
        sessions, kept, seen = self.tmp / 'sessions', self.tmp / 'assignments', self.tmp / 'short-seen'
        sessions.mkdir(); kept.mkdir()
        (sessions / f'{os.getpid()}.json').write_text('{"name": "mac-07", "sessionId": "S1"}')   # this test is ship.sh's parent: the walk finds it
        (kept / 'S1.short').write_text('27\n')
        self.change(self.tree, 'tools/pre-push-check.sh', f'#!/bin/sh\ncat > /dev/null\n. "$(dirname "$0")/session-name.sh"\nsession_short > {seen}\n', 'Note the tag')
        log = self.tmp / 'ship-short.log'
        env = {**os.environ, 'SHIP_LOG': str(log), 'JOBADABRA_SESSION': '', 'JOBADABRA_SESSION_SHORT': '', 'JP_SESSION': '',
               'JP_SESSIONS_DIR': str(sessions), 'JP_ASSIGNMENTS_DIR': str(kept)}
        subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh'), '--background'], cwd=self.tree, capture_output=True, text=True, timeout=60, env=env)
        self.wait_for_marker(log)
        self.assertEqual(seen.read_text().strip(), '27', log.read_text())

    def test_the_printed_wait_reports_this_runs_ending_not_an_older_one(self):
        # Owner, 30 Oct 2026: "we don't have anymore the watches/monitors for when a PR merges": a Monitor ends after 30 min, so the hint names a background wait.
        log = self.tmp / 'ship-again.log'
        log.write_text('ship: FAILED (exit 2), log: an older run of this branch\n')
        Path(f'{log}.seen').write_text('0\n')   # its waiter never read it
        result = subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh'), '--background'], cwd=self.tree, capture_output=True, text=True, timeout=60,
                                env={**os.environ, 'SHIP_LOG': str(log)})
        command = re.search(r'run_in_background: (sh \S+ship-wait\.sh \S+),', result.stdout)
        self.assertIsNotNone(command, result.stdout)
        waited = subprocess.run(command.group(1).split(), capture_output=True, text=True, timeout=60, env={**os.environ, 'SHIP_WAIT_POLL': '1'})
        self.assertEqual(waited.returncode, 0, waited.stdout)
        self.assertRegex(waited.stdout, r'^ship: DONE ')
        self.assertNotIn('older run', waited.stdout)

    def test_a_background_run_killed_during_the_checks_ends_failed_and_pushes_nothing(self):
        # 10 Oct 2026: a killed run logged "ship: DONE nothing to push" with its commit unpushed.
        # 18 Oct 2026, CI: TERM sent the moment the log said "running the push checks" (before the check process existed) ended "FAILED (exit 1)": send it once the hook is running.
        started = self.tmp / 'hook-started'
        log, pid = self.start_background(30, started)
        for _ in range(120):
            if started.exists():
                break
            time.sleep(0.25)
        self.assertTrue(started.exists(), 'the push checks never started')
        os.kill(pid, signal.SIGTERM)
        text = self.wait_for_marker(log)
        self.assertIn('ship: stopped by signal TERM', text)
        self.assertTrue(text.splitlines()[-1].startswith('ship: FAILED'), text)   # ended failed by its meaning; the exit code (143) is the handler's, not the assertion
        self.assertNotIn('ship: DONE', text)
        self.assertNotIn('Slow hook', git(self.origin, 'log', '--format=%s', 'main'))

    def test_a_background_run_survives_a_kill_of_its_callers_process_group(self):
        # The run has its own session: the caller's group kill (a tool call ending) must not reach it.
        self.change(self.tree, 'tools/pre-push-check.sh', '#!/bin/sh\ncat > /dev/null\nsleep 4\n', 'Slow hook')
        log = self.tmp / 'ship-group.log'
        caller = subprocess.Popen(['bash', '-c', f'SHIP_LOG={log} bash {self.tree}/tools/ship.sh --background >/dev/null; sleep 60'], cwd=self.tree, start_new_session=True)
        for _ in range(40):
            if log.exists() and 'running the push checks' in log.read_text():
                break
            time.sleep(0.25)
        os.killpg(caller.pid, signal.SIGTERM)
        caller.wait(timeout=10)
        text = self.wait_for_marker(log)
        self.assertTrue(text.splitlines()[-1].startswith('ship: DONE '), text)
        self.assertIn('Slow hook', git(self.origin, 'log', '--format=%s', 'main'))


if __name__ == '__main__':
    unittest.main()
