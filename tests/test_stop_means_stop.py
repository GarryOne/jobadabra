"""A run stopped by the app (SIGTERM: Stop, quitting the app) ends within seconds, even with checks in flight, and keeps what it finished.

7 Oct 2026: a Find new employers run went on for minutes after the app quit (its 6 worker threads were waited for), held the run lock so the
restarted run waited for it, and lost every employer it had checked (they were saved only at the end of the batch)."""
import os
import signal
import sqlite3
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SCRIPT = textwrap.dedent('''
    import sys, time
    from pathlib import Path
    from src.notion import cron_runs   # installs the SIGTERM handler, as every engine command does
    from src import scout, scout_core, store
    scout_core.CENTRAL = True               # no central "no job site" list in a test
    db = store.connect(Path(sys.argv[1]))
    names = ['Fast1', 'Fast2', 'Slow1', 'Slow2']
    scout.harvest(db, {}, sources=[lambda: [dict(name=n, origin='AI idea', priority=90 - i) for i, n in enumerate(names)]])
    def probe(system, slug):
        if slug.startswith('slow'):
            time.sleep(120)            # a check that is still running when the stop comes
        return []
    print('ready', flush=True)
    scout.run(db, batch=4, harvest_sources=[], probe=probe, workers=4)
    print('finished', flush=True)
''')


class StopMeansStop(unittest.TestCase):
    def test_a_stopped_scout_ends_at_once_and_keeps_its_finished_checks(self):
        for sig in (signal.SIGTERM, signal.SIGINT):   # SIGINT: Stop on a GitHub run (Actions' cancel sends it first)
            with self.subTest(signal=sig.name):
                self._stop_with(sig)

    def _stop_with(self, sig):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'jobs.sqlite'
            env = {**os.environ, 'JOBADABRA_FOLLOW_APP': '0', 'JOBADABRA_DISABLE': 'mail,notion,telegram,google_jobs', 'PYTHONUNBUFFERED': '1'}
            child = subprocess.Popen([sys.executable, '-c', SCRIPT, str(path)], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            try:
                def checked():
                    # The child creates the table a moment after the file: polled in between, "no such table" is "nothing checked yet" (7 Oct 2026: 2 of 5 local runs failed so).
                    try:
                        return {row[0] for row in sqlite3.connect(path).execute("SELECT name FROM scout_candidates WHERE checked_at IS NOT NULL")} if path.exists() else set()
                    except sqlite3.OperationalError:
                        return set()
                deadline = time.time() + 30
                while time.time() < deadline and not {'Fast1', 'Fast2'} <= checked():
                    time.sleep(0.2)
                self.assertEqual(checked(), {'Fast1', 'Fast2'}, 'setup: the fast checks are saved while the slow ones still run')
                self.assertIsNone(child.poll(), 'setup: the run is still going')
                started = time.time()
                child.send_signal(sig)
                output, _ = child.communicate(timeout=15)
                self.assertLess(time.time() - started, 8, 'ended within seconds, not after the slow checks')
            finally:
                if child.poll() is None:
                    child.kill()
            self.assertIn('Stopped before it finished', output)
            self.assertNotIn('finished\n', output.replace('Stopped before it finished', ''))
            self.assertEqual(checked(), {'Fast1', 'Fast2'}, 'the finished checks were kept; the slow ones wait for the next run')


if __name__ == '__main__':
    unittest.main()
