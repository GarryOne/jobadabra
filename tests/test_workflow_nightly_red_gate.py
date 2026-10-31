"""The nightly re-checks main's red suites before it builds (owner, 31 Oct 2026: "when we fix e2e on main. We should run first only the failing e2e suite, then rerun a beta
full e2e suite"). The 03:00 nightly of 31 Oct ran the whole beta over a main that had gone red at 02:38. A beta by hand is gated by tools/beta-release.sh, never twice."""
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEXT = (ROOT / '.github/workflows/desktop.yml').read_text()


def first_job():
    """The `changes` job: from its key to the next job's key."""
    return TEXT.split('\n  changes:\n', 1)[1].split('\n  build:\n', 1)[0]


def step(name_part):
    chunks = [c for c in re.split(r'(?m)^      - ', first_job())[1:] if name_part in c]
    assert len(chunks) == 1, name_part
    return chunks[0]


class NightlyRedGate(unittest.TestCase):
    def test_gate_runs_in_the_first_job_before_anything_is_released(self):
        job = first_job()
        gate = step('id: redmain')
        self.assertIn('tools/red-main-gate.sh "$GITHUB_REPOSITORY"', gate)
        self.assertEqual(job.count('tools/red-main-gate.sh "$GITHUB_REPOSITORY"'), 1, 'one call only')
        for later in ('id: version', 'id: release', 'id: plan'):
            self.assertLess(job.index('id: redmain'), job.index(later), f'the gate comes before {later}')
        self.assertIn('actions: write', job.split('steps:')[0], 'the gate dispatches e2e.yml for the red suites')

    def test_only_a_nightly_runs_it_never_a_beta_by_hand(self):
        condition = re.search(r'if: (.*)', step('id: redmain')).group(1)
        self.assertIn("github.event_name == 'schedule' || inputs.nightly", condition)
        self.assertNotIn('inputs.beta', condition, 'a beta by hand is gated by tools/beta-release.sh, not twice')
        self.assertIn("inputs.over_red_main == ''", condition, 'a --force beta skips the gate')
        self.assertIn('tools/red-main-gate.sh', (ROOT / 'tools/beta-release.sh').read_text())

    def test_a_red_main_builds_nothing_and_every_later_step_skips(self):
        job = first_job()
        self.assertIn("steps.redmain.outputs.red == 'true' && 'false'", job.split('steps:')[0], 'the build output says no build')
        for name in ('Version', 'Tag this build now', 'Release'):
            self.assertIn("steps.redmain.outputs.red != 'true'", step(f'name: {name}'), name)
        self.assertIn("steps.redmain.outputs.red != 'true'", step('actions/setup-node@v5'))
        # released stays empty → build, windows, tests, release and clean-up jobs (all `released == 'true'` or gate == 'true') skip.
        self.assertIn("steps.release.outputs.released == 'true'", step('id: plan'))

    def test_the_skip_is_named_once_through_the_existing_telegram_sender(self):
        gate = step('id: redmain')
        self.assertIn('::notice title=Nightly skipped::', gate)
        self.assertIn("Nightly skipped: $what (re-check $recheck)", gate)
        self.assertIn("import {send} from './desktop/e2e/ci-alert.mjs'", gate)
        self.assertNotIn('api.telegram.org', gate, 'no second sender')
        self.assertIn('set -o pipefail', gate)
        self.assertIn('${PIPESTATUS[0]}', gate, "the gate's own exit code, not tee's")


RED_OUTPUT = """Main's e2e is red:
  apply (since 1234567, https://example.test/runs/1)
  employers (since 1234567, https://example.test/runs/1)
Commits landed since: re-checking apply,employers on main abcdef0 before the beta (about 10-15 min)...
Re-check: https://example.test/runs/99
Re-check failure: main is still red (https://example.test/runs/99). No beta: fix the suite.
"""


def run_step(gate_exit, gate_output):
    """The step's own shell, with a stubbed gate and a stubbed sender: -> (exit code, GITHUB_OUTPUT text, the message sent or '', stdout)."""
    script = re.search(r'(?ms)^        run: \|\n(.*)\Z', step('id: redmain')).group(1)
    body = []
    for line in script.splitlines():   # the script ends where the indentation does (the next step's comments follow in the same chunk)
        if line.strip() and not line.startswith(' ' * 10):
            break
        body.append(line[10:])
    script = '\n'.join(body)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / 'tools').mkdir()
        (tmp / 'desktop/e2e').mkdir(parents=True)
        (tmp / 'tools/red-main-gate.sh').write_text(f"#!/bin/sh\ncat <<'EOF'\n{gate_output}EOF\nexit {gate_exit}\n")
        (tmp / 'tools/red-main-gate.sh').chmod(0o755)
        (tmp / 'desktop/e2e/ci-alert.mjs').write_text("import fs from 'node:fs';\nexport const send = async m => { fs.writeFileSync('sent.txt', m); return 'sent'; };\n")
        env = {**os.environ, 'GITHUB_OUTPUT': str(tmp / 'out'), 'RUNNER_TEMP': str(tmp), 'GITHUB_REPOSITORY': 'o/r', 'GITHUB_RUN_ID': '5', 'GITHUB_SERVER_URL': 'https://example.test'}
        done = subprocess.run(['bash', '-e', '-c', script], cwd=tmp, env=env, capture_output=True, text=True)
        out = (tmp / 'out').read_text() if (tmp / 'out').exists() else ''
        sent = (tmp / 'sent.txt').read_text() if (tmp / 'sent.txt').exists() else ''
        return done.returncode, out, sent, done.stdout


@unittest.skipUnless(shutil.which('node'), 'node is needed for the sender stub')
class NightlyRedGateRuns(unittest.TestCase):
    def test_a_green_main_goes_on_and_sends_nothing(self):
        code, out, sent, _ = run_step(0, 'Main\'s e2e: no suite red.\n')
        self.assertEqual((code, out.strip(), sent), (0, 'red=false', ''))

    def test_a_still_red_main_skips_the_night_and_names_the_suites_and_recheck(self):
        code, out, sent, stdout = run_step(1, RED_OUTPUT)
        self.assertEqual(code, 0, 'the job itself stays green: the night was skipped on purpose')
        self.assertEqual(out.strip(), 'red=true')
        self.assertEqual(sent, "Nightly skipped: main's e2e still red on apply,employers (re-check https://example.test/runs/99)")
        self.assertIn('::notice title=Nightly skipped::' + sent, stdout)

    def test_an_unreadable_main_is_not_green_either(self):
        code, out, sent, _ = run_step(1, 'Could not read main\'s e2e state: unknown, not green.\n')
        self.assertEqual((code, out.strip()), (0, 'red=true'))
        self.assertIn("main's e2e state could not be read (re-check https://example.test/o/r/actions/runs/5)", sent)


if __name__ == '__main__':
    unittest.main()
