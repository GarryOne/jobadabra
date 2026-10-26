"""On main the NEWEST commit's run decides (owner, 15 Oct 2026: "cancel main's push runs for every commit but the newest; we want to optimize the 20 runners at most": 27 page-case
runs of merged commits queued behind each other). Before that (12-13 Oct 2026) the rule was the opposite: every commit kept its own run, because a cancelled run drew a red cross.
A workflow that runs on a push to main shares ONE group on main and cancels its older run; a by-hand run is its own group and never cancelled. Exceptions are named with a reason:
a deploy (a started deploy finishes, a waiting older one is replaced: the newest carries everything). Since 15 Oct 2026 main starts two jobs per push (build.yml: one Linux job, one Windows job).
Readers of a commit's verdict (tools/red-main.sh, tools/release-checks.sh, tools/canary_promote.py) treat a cancelled run as 'superseded': tests/test_red_main.py, tests/test_e2e_gate.py."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXCEPTIONS = {
    'worker.yml': 'a deploy: one group, a started deploy finishes and a waiting older one is replaced by the newest',
}


def runs_on_push(text):
    trigger = text.split('\njobs:')[0]
    return bool(re.search(r'^  push:|^on:[ \t]*\[?[^\n#]*\bpush\b', trigger, re.M))


def concurrency(text):
    block = re.search(r'(?ms)^concurrency:[^\n]*\n(.*?)(?=^\S)', text)
    if not block: return None, None
    group = re.search(r'group:\s*([^\n#]+)', block.group(1))
    cancel = re.search(r'cancel-in-progress:\s*([^\n#]+)', block.group(1))
    return group and group.group(1).strip(), cancel and cancel.group(1).strip()


class NewestMainRunWins(unittest.TestCase):
    def push_workflows(self):
        found = {p.name: p.read_text(encoding='utf-8') for p in sorted((ROOT / '.github' / 'workflows').glob('*.yml'))}
        return {name: text for name, text in found.items() if runs_on_push(text)}

    def test_a_push_to_main_cancels_the_older_commits_run(self):
        pushed = self.push_workflows()
        self.assertGreaterEqual(len(pushed), 2, 'positive control: the push workflows are read (CI · Tests and the worker deploy)')
        offenders = []
        for name, text in pushed.items():
            if name in EXCEPTIONS: continue
            group, cancel = concurrency(text)
            if 'ci-tests-main' in (group or ''):
                if cancel != 'false': offenders.append(f'{name}: CI · Tests must let a started run finish, cancel-in-progress {cancel}')
                continue
            if not group or "github.event_name == 'push' && 'main'" not in group and 'ci-tests-main' not in group: offenders.append(f'{name}: no shared group on main ({group})')
            elif cancel not in ('true', "${{ github.event_name != 'workflow_dispatch' }}"): offenders.append(f'{name}: cancel-in-progress {cancel}')
        self.assertEqual(offenders, [], 'a push workflow: group <name>-main on a push and cancel-in-progress: true (a by-hand run is its own group, not cancelled); CI · Tests (ci-tests-main) is the exception: false, so a started run finishes')

    def test_a_by_hand_run_is_never_cancelled_by_a_push(self):
        for name, text in self.push_workflows().items():
            if name in EXCEPTIONS or 'workflow_dispatch' not in text.split('\njobs:')[0]: continue
            group, cancel = concurrency(text)
            self.assertIn('github.run_id', group, f'{name}: a by-hand run needs its own group')

    def test_the_exceptions_are_real_and_still_do_not_cancel(self):
        for name in EXCEPTIONS:
            text = (ROOT / '.github' / 'workflows' / name).read_text(encoding='utf-8')
            self.assertIn(name, self.push_workflows())
            self.assertEqual(concurrency(text)[1], 'false', name)

    def test_scheduled_and_workflow_run_workflows_are_not_cancelled_by_a_push(self):
        # their group never holds a push: they are not in the push list, and a cancel on them could only come from their own next run
        for path in (ROOT / '.github' / 'workflows').glob('*.yml'):
            text = path.read_text(encoding='utf-8')
            if runs_on_push(text) or not re.search(r'(?m)^  (schedule|workflow_run):', text.split('\njobs:')[0]): continue
            self.assertNotIn("'push'", concurrency(text)[0] or '', path.name)



# 26 Oct 2026: 10 red suites started 10 bisects at once (group e2e-bisect-<suite>) and main checks had no group; the job queue held PR checks 20+ minutes.
# A workflow that ANOTHER workflow starts (workflow_run, or a chain like the bisect) needs a group that cannot multiply: no run id, commit or input in it.
MULTIPLIERS = re.compile(r'github\.(run_id|run_number|run_attempt|sha)|inputs\.')
PER_COMMIT_OK = {   # may keep one run per commit: its trigger runs at most once a night, so it cannot fill the queue
    'fix-verdicts.yml': 'starts only after the nightly offline site replay on main; each commit keeps its verdict (tests/test_fix_verdicts_workflow.py)',
}
CHAINS = {   # started by another workflow through `gh workflow run`, with their one group
    'e2e-bisect.yml': 'e2e-bisect',
}


def workflows():
    return {p.name: p.read_text(encoding='utf-8') for p in sorted((ROOT / '.github' / 'workflows').glob('*.yml'))}


class NothingMultiplies(unittest.TestCase):
    def test_a_workflow_another_workflow_starts_has_one_group(self):
        started = {name: text for name, text in workflows().items() if re.search(r'(?m)^  workflow_run:', text.split('\njobs:')[0])}
        self.assertGreaterEqual(len(started), 3, 'positive control: the workflow_run workflows are read')
        for name, text in {**started, **{n: workflows()[n] for n in CHAINS}}.items():
            group, cancel = concurrency(text)
            self.assertTrue(group, f'{name}: no concurrency group: each start can add a run to the queue')
            if name not in PER_COMMIT_OK:
                self.assertIsNone(MULTIPLIERS.search(group), f'{name}: group {group} has one run per run/commit/input: it multiplies')
            self.assertEqual(cancel, 'false', f'{name}: a started run finishes; the newest waits')
            if name in CHAINS: self.assertEqual(group, CHAINS[name], name)

    def test_main_checks_share_one_e2e_group(self):
        group, cancel = concurrency(workflows()['e2e.yml'])
        self.assertIn("&& 'e2e-main' ||", group or '', 'the Worker cron and the backup schedule wait in one group')
        self.assertIn('inputs.scheduled', group)
        self.assertIn("github.event_name == 'schedule' && github.workflow == 'CI · End-to-end on Mac + Linux'", group, 'the release run calling it never joins')
        self.assertIn("inputs.bisect && 'e2e-bisect-step'", group, 'bisect steps (the runs cancelled by hand on 26 Oct 2026) wait in one line too')
        self.assertIn("format('e2e-{0}', github.run_id)", group, 'any other run is its own group')
        self.assertEqual(cancel, 'false')

    def test_the_bisect_chain_starts_one_bisect_per_check(self):
        self.assertIn('started = suite', (ROOT / 'tools' / 'e2e_bisect.py').read_text(encoding='utf-8'), 'tools/e2e_bisect.py after_run starts one bisect')


if __name__ == '__main__':
    unittest.main()
