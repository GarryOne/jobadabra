"""The Stop hook's suites wait for a check slot like a push gate (11 Oct 2026: whole lint + test runs of several sessions at once drove the load to 160-205): it says so in one line, gives up waiting after JOBADABRA_STOP_SLOT_WAIT seconds, and STOP_CHECK_NO_SLOT=1 skips it."""
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK = ROOT / 'tools' / 'stop-test-check.sh'


def take_slot_script():
    """The hook's own take_slot function, cut out of the script (it needs a transcript and a repo to run whole), run next to tools/check-slot.sh."""
    text = HOOK.read_text()
    start = text.index('slot_taken=""')
    end = text.index('\n}\n', text.index('take_slot() {')) + 3
    return text[start:end]


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class StopHookSlotTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'tools').mkdir()
        shutil.copy(ROOT / 'tools' / 'check-slot.sh', self.tmp / 'tools' / 'check-slot.sh')
        (self.tmp / 'tools' / 'hook.sh').write_text('#!/bin/bash\n' + take_slot_script() + 'take_slot\necho "ran with slot: ${SLOT_MINE:-none}"\n')
        self.env = {**os.environ, 'JOBADABRA_CHECK_SLOT_DIR': (self.tmp / 'slots').as_posix(), 'JOBADABRA_CHECK_SLOTS': '1', 'JOBADABRA_CHECK_TIMING_LOG': (self.tmp / 'timing.log').as_posix()}
        self.env.pop('STOP_CHECK_NO_SLOT', None)

    def run_hook(self, **env):
        return subprocess.run(['bash', str(self.tmp / 'tools' / 'hook.sh')], capture_output=True, text=True, timeout=60, env={**self.env, **env})

    def hold_slot(self, seconds):
        holder = subprocess.Popen(['bash', str(self.tmp / 'tools' / 'check-slot.sh'), 'sleep', str(seconds)], env=self.env)
        self.addCleanup(holder.kill)
        deadline = time.monotonic() + 30
        while not list((self.tmp / 'slots').glob('slot*')) and time.monotonic() < deadline:
            time.sleep(0.05)
        return holder

    def test_a_free_slot_is_taken_at_once(self):
        result = self.run_hook()
        self.assertIn('ran with slot:', result.stdout)
        self.assertNotIn('none', result.stdout)
        self.assertNotIn('waiting', result.stderr)

    def test_with_every_slot_taken_it_waits_in_line_and_says_so(self):
        holder = self.hold_slot(3)
        result = self.run_hook()
        holder.wait(timeout=30)
        self.assertIn('waiting for a free slot', result.stderr)
        self.assertIn('got a slot after', result.stderr)

    def test_it_gives_up_waiting_after_its_limit_and_the_off_switch_skips_the_slot(self):
        holder = self.hold_slot(30)
        began = time.monotonic()
        result = self.run_hook(JOBADABRA_STOP_SLOT_WAIT='2')
        self.assertLess(time.monotonic() - began, 15)
        self.assertIn('running anyway', result.stderr)
        skipped = self.run_hook(STOP_CHECK_NO_SLOT='1')
        self.assertIn('ran with slot: none', skipped.stdout)
        self.assertNotIn('waiting', skipped.stderr)
        holder.kill()

    def test_the_suites_are_started_only_after_the_slot_is_taken(self):
        text = HOOK.read_text()
        self.assertLess(text.index('    take_slot\n'), text.index('( cd "$dir" && JOBADABRA_AFFECTED_FILES'))


if __name__ == '__main__':
    unittest.main()
