"""tools/wait-build-tag.sh (11 Oct 2026): a push that changes workflow files waits until the running desktop build has tagged itself (its "Tag this build now" step), not for the whole build. A fake `gh` on PATH serves the run list and the job steps; ship.sh calls the tool and SHIP_NO_WAIT=1 skips it."""
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from tests.ship_fixture import ShipFixture, git

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / 'tools' / 'wait-build-tag.sh'
STEPS = '{"jobs":[{"name":"Anything new?","steps":[{"name":"Checkout","status":"completed"},{"name":"Tag this build now (its workflows still match main\'s)","status":"%s"}]}]}'


def fake_gh(tmp):
    """`gh run list` prints the id in <tmp>/gh/running (nothing when empty); `gh run view ... -q <jq>` runs the jq on <tmp>/gh/jobs.json."""
    state = Path(tmp) / 'gh'
    state.mkdir(exist_ok=True)
    bin_dir = Path(tmp) / 'ghbin'
    bin_dir.mkdir(exist_ok=True)
    state_dir = state.as_posix()
    (bin_dir / 'gh').write_text('#!/bin/bash\n'
                                f'state="{state_dir}"\n'
                                'if [ "$2" = list ]; then cat "$state/running" 2>/dev/null; exit 0; fi\n'
                                'q=""; while [ $# -gt 0 ]; do [ "$1" = -q ] && q="$2"; shift; done\n'
                                'jq -r "$q" "$state/jobs.json"\n')
    (bin_dir / 'gh').chmod(0o755)
    return state, {'PATH': f'{bin_dir.as_posix()}{os.pathsep}{os.environ["PATH"]}'}


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class WaitBuildTagTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.state, self.path = fake_gh(self.tmp)
        self.env = {**os.environ, **self.path, 'SHIP_WAIT_POLL': '0.1', 'GATE_TIMING': '0'}

    def run_tool(self, **env):
        start = time.time()
        result = subprocess.run(['bash', str(TOOL)], capture_output=True, text=True, timeout=30, env={**self.env, **env})
        return result, time.time() - start

    def build(self, running='4242', tag_status='in_progress'):
        (self.state / 'running').write_text(running)
        (self.state / 'jobs.json').write_text(STEPS % tag_status)

    def test_no_running_build_means_no_wait_and_no_words(self):
        (self.state / 'running').write_text('')
        result, took = self.run_tool()
        self.assertEqual((result.returncode, result.stderr), (0, ''))
        self.assertLess(took, 3)

    def test_a_build_that_has_tagged_itself_does_not_hold_the_push(self):
        self.build(tag_status='completed')
        result, _ = self.run_tool(SHIP_WAIT_MAX='3')
        self.assertEqual(result.returncode, 0)
        self.assertNotIn('waiting until it has tagged', result.stderr, 'tagged already: nothing to wait for')

    def test_a_build_that_has_not_tagged_yet_is_waited_for_until_it_does(self):
        self.build()
        start = time.time()
        err_file = self.tmp / 'err'
        with open(err_file, 'w') as err_out:
            proc = subprocess.Popen(['bash', str(TOOL)], stderr=err_out, text=True, env=self.env)
            deadline = time.monotonic() + 60
            # Why (30 Oct 2026, bb): the tag flipped after a fixed sleep 0.6; on a loaded Mac the tool had not looked yet, saw "tagged" at once and said nothing (push gate red twice). The tool says it waits: then the tag step ends.
            while 'waiting until it has tagged itself' not in err_file.read_text() and proc.poll() is None and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertIsNone(proc.poll(), 'it ended without ever saying it waits')
            (self.state / 'jobs.json').write_text(STEPS % 'completed')
            proc.wait(timeout=60)
        err = err_file.read_text()
        self.assertIn('waiting until it has tagged itself', err)
        self.assertIn('(tagged)', err)
        self.assertLess(time.time() - start, 10, 'it ended with the tag step; the build itself never ends in this test')

    def test_the_old_wait_for_the_whole_build_is_one_switch_away(self):
        self.build(tag_status='completed')
        err_file = self.tmp / 'err'
        with open(err_file, 'w') as err_out:
            proc = subprocess.Popen(['bash', str(TOOL)], stderr=err_out, text=True, env={**self.env, 'SHIP_WAIT_FOR_BUILD': '1'})
            deadline = time.monotonic() + 60
            while 'until it ends' not in err_file.read_text() and proc.poll() is None and time.monotonic() < deadline:   # it says it waits: then the build ends
                time.sleep(0.05)
            self.assertIsNone(proc.poll(), 'tagged already, yet it waits for the build to end')
            (self.state / 'running').write_text('')
            proc.wait(timeout=60)
        self.assertIn('until it ends', err_file.read_text())

    def test_it_gives_up_after_its_looks_and_never_fails_the_push(self):
        self.build()
        result, _ = self.run_tool(SHIP_WAIT_MAX='3')
        self.assertEqual(result.returncode, 0)
        self.assertIn('ended or gave up', result.stderr)

    def test_a_wait_is_logged_for_the_next_measurement(self):
        self.build()
        repo = self.tmp / 'repo'
        subprocess.run(['git', 'init', '-q', str(repo)], check=True)
        result = subprocess.run(['bash', str(TOOL)], cwd=repo, capture_output=True, text=True, timeout=30, env={**self.env, 'GATE_TIMING': '1', 'SHIP_WAIT_MAX': '2'})
        self.assertRegex((repo / '.git' / 'gate-timing.log').read_text(), r'workflow push wait=\d+s build=4242 tagged=0')


class ShipWaitsTest(ShipFixture):
    def test_a_workflow_push_calls_the_wait_and_ship_no_wait_skips_it(self):
        state, path = fake_gh(self.tmp)
        (state / 'running').write_text('7')
        (state / 'jobs.json').write_text(STEPS % 'in_progress')
        (self.tree / '.github' / 'workflows').mkdir(parents=True)
        self.change(self.tree, '.github/workflows/x.yml', 'name: x\n', 'Workflow file')
        env = {**os.environ, **path, 'SHIP_WAIT_POLL': '0.1', 'SHIP_WAIT_MAX': '2', 'GATE_TIMING': '0'}
        waited = subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh')], cwd=self.tree, capture_output=True, text=True, timeout=60, env=env)
        self.assertEqual(waited.returncode, 0, waited.stderr)
        self.assertIn('waiting until it has tagged itself', waited.stderr)
        self.change(self.tree, '.github/workflows/y.yml', 'name: y\n', 'Another workflow file')
        skipped = subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh')], cwd=self.tree, capture_output=True, text=True, timeout=60, env={**env, 'SHIP_NO_WAIT': '1'})
        self.assertEqual(skipped.returncode, 0, skipped.stderr)
        self.assertNotIn('waiting until', skipped.stderr)


if __name__ == '__main__':
    unittest.main()
