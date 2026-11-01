"""desktop/e2e/recorded-both.sh (11 Oct 2026): the new-build and old-build recorded replays of a fix run under ONE heavy-lock hold; the new build must pass, the old one must fail. A fake npm on PATH records each run's environment."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'desktop' / 'e2e' / 'recorded-both.sh'
LOCK = ROOT / 'tools' / 'heavy-lock.sh'


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class RecordedBothTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'old').mkdir()
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir()
        log = (self.tmp / 'npm.log').as_posix()
        # fake npm: logs "<args> old=<REAL_EXTENSION_DIR> held=<JP_HEAVY_HELD>" and exits with NEW_EXIT or OLD_EXIT
        (bin_dir / 'npm').write_text(f'#!/bin/bash\necho "$* old=${{REAL_EXTENSION_DIR:-}} held=${{JP_HEAVY_HELD:-}} cases=${{JP_REPLAY_CASES:-}}" >> "{log}"\n'
                                     'if [ -n "${REAL_EXTENSION_DIR:-}" ]; then exit "${OLD_EXIT:-1}"; else exit "${NEW_EXIT:-0}"; fi\n')
        (bin_dir / 'npm').chmod(0o755)
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOBADABRA_HEAVY', 'JP_HEAVY', 'REAL_EXTENSION'))}, 'PATH': f'{bin_dir.as_posix()}{os.pathsep}{os.environ["PATH"]}',
                    'JOBADABRA_HEAVY_DIR': (self.tmp / 'heavy').as_posix(), 'JOBADABRA_HEAVY_SHARED': str(LOCK), 'JOBADABRA_HEAVY_TIMING_LOG': (self.tmp / 'gate-timing.log').as_posix(),
                    'JOBADABRA_HEAVY_LOAD': '0', 'JOBADABRA_HEAVY_SLOTS': '1'}

    def run_both(self, *args, **env):
        return subprocess.run(['bash', str(LOCK), 'recorded-replay', 'bash', str(SCRIPT), *args], capture_output=True, text=True, timeout=60, env={**self.env, **env})

    def runs(self):
        return (self.tmp / 'npm.log').read_text().splitlines()

    def test_both_replays_run_in_one_hold_new_first_then_old_with_the_old_build_dir(self):
        result = self.run_both(str(self.tmp / 'old'), JP_REPLAY_CASES='case-a')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        new, old = self.runs()
        self.assertIn('run recorded old= held=', new)
        self.assertIn(f'old={self.tmp / "old"}', old)
        self.assertRegex(new, r'held=\d+')
        self.assertRegex(old, r'held=\d+')
        self.assertIn('cases=case-a', old, 'the case filter reaches the old-build run')
        held = [line for line in (self.tmp / 'gate-timing.log').read_text().splitlines() if 'heavy lock run=' in line]
        self.assertEqual(len(held), 1, 'one hold, not two')

    def test_a_failing_new_build_stops_before_the_old_run(self):
        result = self.run_both(str(self.tmp / 'old'), NEW_EXIT='1')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len(self.runs()), 1)

    def test_an_old_build_that_passes_means_the_control_proves_nothing(self):
        result = self.run_both(str(self.tmp / 'old'), OLD_EXIT='0')
        self.assertEqual(result.returncode, 3)
        self.assertIn('the control proves nothing', result.stdout)

    def test_the_old_folder_is_required_unless_skipped(self):
        self.assertEqual(self.run_both().returncode, 2)
        self.assertEqual(self.run_both(RECORDED_SKIP_OLD='1').returncode, 0)
        self.assertEqual(len(self.runs()), 1, 'RECORDED_SKIP_OLD=1: the new build only')
        self.assertEqual(self.run_both('/no/such/folder').returncode, 2)

    def test_the_npm_script_takes_the_lock_once_around_the_script(self):
        scripts = json.loads((ROOT / 'desktop' / 'e2e' / 'package.json').read_text())['scripts']
        self.assertEqual(scripts['recorded-both'], 'bash ../../tools/heavy-lock.sh recorded-replay bash recorded-both.sh')


if __name__ == '__main__':
    unittest.main()
