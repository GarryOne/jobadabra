"""The push gate runs its seconds-long commit-message checks before the minutes-long journey and ladder gates, so a missing trailer fails fast."""
# 11 Oct 2026: a missing "Rung:" line was reported only after a 255 s journey gate, three times in one landing.
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATE = (ROOT / 'tools' / 'pre-push-check.sh').read_text()


class GateOrderTest(unittest.TestCase):
    def test_cheap_checks_run_before_the_slow_gates(self):
        slow = GATE.index('gate_run() {')
        for cheap in ('timed "file size"', 'timed "commit checks"'):
            self.assertLess(GATE.index(cheap), slow, f'{cheap} must run before the journey and ladder gates')


    def test_the_slow_gates_reuse_a_pass_on_the_same_tree(self):
        for gate in ('gate_run journey-gate "journey gate"', 'gate_run ladder-gate "ladder gate"'):
            self.assertIn(gate, GATE, 'a retry that only changed a commit message must not re-run a slow gate')

    def test_both_slow_gates_key_their_pass_on_the_files_they_read_and_those_cover_the_flow_files(self):
        # owner, 11 Oct 2026: a refused push (main moved) re-ran ~10 min of gates after a rebase over commits that touched none of their files
        for gate in ('GATE_CACHE_PATHS="$gate_paths" timed "$2" gate_cache_run "$repo" "$1" "touched=$(gate_touched)"',):
            self.assertIn(gate, GATE)
        paths = re.search(r'^gate_paths="([^"]+)"', GATE, re.M).group(1).split()
        self.assertTrue(paths)
        if not shutil.which('node'):
            self.skipTest('needs node')
        flows = subprocess.run(['node', '-e', "import('./desktop/e2e/flows.mjs').then(m => console.log(JSON.stringify([...m.FLOW_FILES, ...m.JOURNEY_TESTS.map(t => 'desktop/' + t), 'desktop/test/ladder-ratchet.test.js', 'desktop/e2e/ladder-baseline.json'])))"],
                               cwd=ROOT, capture_output=True, text=True, check=True).stdout
        import json
        for file in json.loads(flows):
            self.assertTrue(any(file == path or file.startswith(path.rstrip('/') + '/') for path in paths), f'{file} is read by the journey/ladder gate but is not in gate_paths')

    def test_the_slow_gates_run_beside_the_area_suites_unless_serial_is_asked(self):
        # owner, 11 Oct 2026: a fresh flow-code push took lock wait + journey gate + slowest suite, one after another; now the longest of them
        self.assertLess(GATE.index('"${gate}_gate"; echo $? >"$out.code"'), GATE.index('gate_wait_budget ${watch'), 'started before the suites are collected')
        self.assertLess(GATE.index('gate_wait_budget ${watch'), GATE.index('slot_release\nfor tree'), 'collected with them')
        self.assertIn('JP_GATE_SERIAL', GATE)
        self.assertIn('JP_GATE_SERIAL=1: the journey and ladder gates run before the suites', GATE)   # said in the log when the fallback is used

    def test_the_e2e_unit_tests_are_not_run_locally_unless_asked(self):
        # owner, 11 Oct 2026: "I want the local e2e run dropped entirely" (143 s of a push under load; CI's e2e.yml plan job still runs them all)
        self.assertNotIn('want_e2e=1; fi\n  case "$command" in *PUSH_FULL=1*) want_e2e=1', GATE)
        self.assertIn('JP_E2E_UNIT', GATE)
        start = GATE.index('want_e2e=0')
        block = GATE[start:GATE.index('failed=()')]
        self.assertNotIn('PUSH_FULL', block, 'PUSH_FULL=1 does not bring the e2e unit tests back')
        self.assertIn('[ "${JP_E2E_UNIT:-0}" = 1 ]', block)


if __name__ == '__main__':
    unittest.main()
