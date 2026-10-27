"""A run cancelled by hand never sends a red CI alert, in every workflow that sends one (owner, 27 Oct 2026, via the coordinator).

Refill run 40451220954, cancelled on the owner's own yes, sent "🔴 CI · Replay refill failed … the estimate is above the cap, or the key is
missing": the alert step ran under always() and read the cancelled jobs as a failure, then guessed a cause. Each step that runs
`ci-alert.mjs failure` must skip a cancelled run: its `if:` holds `!cancelled()` (the run's own cancel, never a job's timeout), or it is
`failure()` alone (false for a cancelled run). A new alerting workflow without the guard fails here.
"""
import pathlib
import re
import unittest

WORKFLOWS = pathlib.Path(__file__).resolve().parent.parent / '.github' / 'workflows'


def alert_steps(text):
    """Yield (step name, its if: line or '') for each step whose run calls ci-alert.mjs failure. Steps start at `- name:` lines."""
    steps = re.split(r'\n(?=\s*- (?:name|uses):)', text)
    for step in steps:
        if 'ci-alert.mjs failure' not in step:
            continue
        name = re.search(r'- name:\s*(.+)', step)
        cond = re.search(r'\n\s+if:\s*(.+)', step)
        yield (name.group(1).strip() if name else '?'), (cond.group(1).strip() if cond else '')


class AlertSkipsCancelledRun(unittest.TestCase):
    def test_every_failure_alert_step_skips_a_cancelled_run(self):
        seen = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for name, cond in alert_steps(path.read_text(encoding='utf-8')):
                seen.append(path.name)
                guarded = '!cancelled()' in cond.replace(' ', '') or re.match(r'(\$\{\{\s*)?failure\(\)', cond)
                self.assertTrue(guarded, f'{path.name}: step "{name}" sends a failure alert without skipping a cancelled run (if: {cond or "none"})')
        self.assertGreaterEqual(len(set(seen)), 5, f'the alerting workflows were not found: {sorted(set(seen))}')

    def test_a_by_hand_run_on_a_branch_sends_no_alert(self):
        # Why (27 Oct 2026, coordinator): a by-hand harness-daily run on a PR branch sent the owner a red alert. A tag (the gate) and main still alert.
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for name, cond in alert_steps(path.read_text(encoding='utf-8')):
                flat = cond.replace(' ', '')
                self.assertTrue("github.ref=='refs/heads/main'" in flat, f'{path.name}: step "{name}" alerts on a by-hand branch run (if: {cond})')

    def test_the_refill_alert_names_failed_jobs_never_a_guessed_cause(self):
        text = (WORKFLOWS / 'replay-refill.yml').read_text(encoding='utf-8')
        self.assertNotIn('the estimate is above the cap, or the key is missing: see the run', text)
        self.assertIn('select(.conclusion == "failure")', text)



class AlertReadsTheFailedSteps(unittest.TestCase):
    def test_every_failure_alert_can_read_the_failed_steps_annotations(self):
        # Review on #2249: ci-alert.mjs stepCauses reads check-run annotations; without `checks: read` the API refuses and the cause silently falls back.
        missing, seen = [], 0
        for path in sorted(WORKFLOWS.glob('*.yml')):
            text = path.read_text(encoding='utf-8')
            top, body = text.split('\njobs:\n', 1)
            for job in re.split(r'(?m)^  [A-Za-z0-9_-]+:\s*$', body)[1:]:
                if 'ci-alert.mjs failure' not in job:
                    continue
                seen += 1
                own = re.search(r'(?m)^    permissions:\n((?:      .*\n)+)', job)
                scopes = own.group(1) if own else (re.search(r'(?m)^permissions:\n((?:  .*\n)+)', top + '\n') or [None, ''])[1]
                if not re.search(r'(?m)^\s+checks: (read|write)', scopes):
                    missing.append(path.name)
        self.assertGreaterEqual(seen, 5, 'positive control: the alert jobs are read')
        self.assertEqual(missing, [], 'give these alert jobs `checks: read`')

if __name__ == '__main__':
    unittest.main()
