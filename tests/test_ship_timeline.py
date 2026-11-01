"""The landing record (11 Oct 2026): ship.sh appends one line per attempt to ship-timeline.log, heavy-lock lines carry branch + session + run seconds + load, tools/landing-report.mjs turns both into one table per landing ("not measured" where a log is silent); tools/session-name.sh names the session."""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.ship_fixture import ShipFixture, git, ROOT

REPORT = ROOT / 'tools' / 'landing-report.mjs'
LOCK = ROOT / 'tools' / 'heavy-lock.sh'
FIELDS = ['ts_start', 'ts_end', 'first_commit', 'branch', 'session', 'result', 'total', 'queue', 'rebase', 'checks', 'wf_wait', 'push', 'refused', 'rechecked', 'skipped', 'gate_steps']


def fields(line):
    return dict(re.findall(r'(\w+)=(\S*)', line))


class ShipTimelineTest(ShipFixture):
    def ship_env(self, **extra):
        return {**os.environ, 'JOBADABRA_SESSION': 'test-session', **extra}

    def test_a_landing_appends_one_complete_line_and_the_next_one_is_appended_not_overwritten(self):
        self.change(self.tree, 'tools/pre-push-check.sh', '#!/bin/sh\ncat >/dev/null\necho "    7s  python (clean checkout)" >&2\necho "    2s  worker (clean checkout)" >&2\n', 'Hook with steps')
        for n in (1, 2):
            self.change(self.tree, f'f{n}.txt', 'x\n', f'Change {n}')
            result = subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh')], cwd=self.tree, capture_output=True, text=True, timeout=60, env=self.ship_env())
            self.assertEqual(result.returncode, 0, result.stderr)
        lines = (self.main / '.git' / 'ship-timeline.log').read_text().splitlines()
        self.assertEqual(len(lines), 2, lines)
        first = fields(lines[0])
        for name in FIELDS:
            self.assertIn(name, first, f'{name} is missing: {lines[0]}')
        self.assertEqual((first['branch'], first['session']), ('topic', 'test-session'))
        self.assertTrue(first['result'].startswith('DONE:'), first['result'])
        self.assertEqual(first['gate_steps'], 'python:7,worker:2')
        self.assertTrue(fields(lines[1])['result'].startswith('DONE:'))

    def test_a_new_log_file_is_there_before_the_timeline_reads_it(self):
        # CI, 12 Oct 2026 (run 38242778084): ship.sh sends its output through `tee` and the timeline counted the log's lines at once; when tee had not yet
        # created a new log, the read failed and set -e ended the landing with exit 1. A slow tee makes that moment certain.
        bin_dir = self.tmp / 'slow-tee'
        bin_dir.mkdir()
        (bin_dir / 'tee').write_text(f'#!/bin/sh\nsleep 0.5\nexec {shutil.which("tee")} "$@"\n')
        (bin_dir / 'tee').chmod(0o755)
        self.change(self.tree, 'f.txt', 'x\n', 'Change')
        log = self.tmp / 'new-ship.log'
        result = subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh')], cwd=self.tree, capture_output=True, text=True, timeout=60,
                                env=self.ship_env(PATH=f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', SHIP_LOG=str(log)))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('No such file', result.stdout + result.stderr)

    def test_a_failed_landing_is_recorded_with_its_exit_code(self):
        self.change(self.tree, 'tools/pre-push-check.sh', '#!/bin/sh\necho "Push blocked: x" >&2\nexit 2\n', 'Hook that refuses')
        subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh')], cwd=self.tree, capture_output=True, text=True, timeout=60, env=self.ship_env())
        self.assertEqual(fields((self.main / '.git' / 'ship-timeline.log').read_text())['result'], 'FAILED:exit2')

    def test_gate_timing_0_writes_nothing(self):
        self.change(self.tree, 'f.txt', 'x\n', 'Change')
        subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh')], cwd=self.tree, capture_output=True, text=True, timeout=60, env=self.ship_env(GATE_TIMING='0'))
        self.assertFalse((self.main / '.git' / 'ship-timeline.log').exists())


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class HeavyLineTest(unittest.TestCase):
    def test_every_hold_logs_branch_session_run_seconds_and_load(self):
        with tempfile.TemporaryDirectory() as d:
            log = Path(d) / 'gate-timing.log'
            env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOBADABRA_HEAVY', 'JP_HEAVY'))}, 'JOBADABRA_HEAVY_DIR': str(Path(d) / 'heavy'), 'JOBADABRA_HEAVY_SHARED': str(LOCK), 'JOBADABRA_HEAVY_TIMING_LOG': str(log),
                   'JOBADABRA_SESSION': 'sess-x', 'JOBADABRA_HEAVY_SLOTS': '1'}
            self.assertEqual(subprocess.run(['bash', str(LOCK), 'row-replay', 'bash', '-c', 'exit 3'], env=env, capture_output=True, text=True).returncode, 3)
            line = log.read_text().splitlines()[-1]
            data = fields(line)
            for name in ('run', 'wait', 'exit', 'what', 'branch', 'session', 'load_q', 'load_start'):
                self.assertIn(name, data, line)
            self.assertEqual((data['session'], data['what'], data['exit']), ('sess-x', 'row-replay', '3'))


class SessionNameTest(unittest.TestCase):
    def name(self, **env):
        return subprocess.run(['bash', '-c', f'source {ROOT / "tools" / "session-name.sh"}; session_name'], capture_output=True, text=True, env={**os.environ, **env}).stdout.strip()

    def test_the_env_names_win_and_the_sessions_folder_is_walked_through_the_parents(self):
        self.assertEqual(self.name(JOBADABRA_SESSION='a', JP_SESSION='b'), 'a')
        self.assertEqual(self.name(JOBADABRA_SESSION='', JP_SESSION='b'), 'b')
        with tempfile.TemporaryDirectory() as d:
            # a session file for this python process: bash's parent chain reaches it
            (Path(d) / f'{os.getpid()}.json').write_text(json.dumps({'name': 'found-by-walk'}))
            self.assertEqual(self.name(JOBADABRA_SESSION='', JP_SESSION='', JP_SESSIONS_DIR=d), 'found-by-walk')
            self.assertEqual(self.name(JOBADABRA_SESSION='', JP_SESSION='', JP_SESSIONS_DIR=d + '-none'), '?')


@unittest.skipUnless(shutil.which('node'), 'needs node')
class LandingReportTest(unittest.TestCase):
    def report(self, timeline, heavy, *args):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / 'ship-timeline.log').write_text(timeline)
            (Path(d) / 'gate-timing.log').write_text(heavy)
            return subprocess.run(['node', str(REPORT), *args, '--dir', d], capture_output=True, text=True).stdout

    LINE = ('ts_start=2026-10-11T10:10:00Z ts_end=2026-10-11T10:10:49Z first_commit=2026-10-11T09:50:00Z branch=fix-a session=s1 result=DONE:abc1234 total=49s queue=0s rebase=1s '
            'checks=45s wf_wait=0s push=3s refused=1 rechecked=0 skipped=1 gate_steps=python:39,desktop:26\n')

    def test_a_landing_is_split_into_edit_lock_wait_proof_runs_gate_and_push(self):
        heavy = ('# 2026-10-11T10:00:00Z heavy lock run=60s wait=120s exit=0 what=recorded-replay branch=fix-a session=s1 load_q=15 load_start=9\n'
                 '# 2026-10-11T10:05:00Z heavy lock run=70s wait=30s exit=0 what=e2e-smoke branch=other session=s2 load_q=1 load_start=1\n')
        out = self.report(self.LINE, heavy, 'fix-a')
        self.assertIn('fix-a (s1) DONE:abc1234', out)
        self.assertIn('lock wait   120s', out)
        self.assertIn('proof runs  60s', out)
        self.assertIn('edit/think  1020s', out)      # 20 min from the first commit to ship, minus 120 + 60
        self.assertIn('gate        45s  (python:39,desktop:26)', out)
        self.assertIn('push        3s', out)
        self.assertNotIn('e2e-smoke', out, 'another branch\'s lock hold is not this landing\'s')

    def test_what_the_logs_do_not_say_is_printed_as_not_measured(self):
        out = self.report(self.LINE.replace('first_commit=2026-10-11T09:50:00Z', 'first_commit=?'), '# 2026-10-11T10:00:00Z heavy lock wait=5s what=x\n', 'fix-a')
        self.assertIn('edit/think  not measured', out)
        self.assertIn('lock wait   not measured', out)

    def test_last_n_and_an_unknown_branch(self):
        two = self.LINE + self.LINE.replace('fix-a', 'fix-b')
        self.assertEqual(self.report(two, '', '--last', '1').count('DONE:abc1234'), 1)
        self.assertIn('no landing attempts found for nope', self.report(two, '', 'nope'))


if __name__ == '__main__':
    unittest.main()
