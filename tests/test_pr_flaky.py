"""A red PR's verdict says which failed e2e steps are flaky (tools/pr_flaky.py, spec row 33, 31 Oct 2026): information only, never a state change."""
import importlib.util
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('pr_flaky', ROOT / 'tools/pr_flaky.py')
pf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pf)

PR_RUN = {'databaseId': 7, 'displayTitle': 'E2E for PR · apply · a8-x', 'conclusion': 'failure'}
OTHER = {'databaseId': 8, 'displayTitle': 'CI · Python tests', 'conclusion': 'failure'}
GREEN = {'databaseId': 9, 'displayTitle': 'E2E for PR · settings · a8-x', 'conclusion': 'success'}
FLAKY = 'Flaky: “a step” passed on the same commit fb1d711 (https://x/1): fix the non-deterministic input it depends on, not the step'
CHANGED = 'Changed: “b step” differs from its newest green 79e6c34 (https://x/2) in src/x.py: a likely regression'


def fake_run(output, calls):
    def run(args, **kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, stdout=output, stderr='')
    return run


class Clock:
    def __init__(self, step): self.now, self.step = 0, step
    def __call__(self):
        self.now += self.step
        return self.now


class PrFlaky(unittest.TestCase):
    def lines(self, runs, output=f'{FLAKY}\n{CHANGED}\nnoise from node\n'):
        calls = []
        said = pf.lines('o/r', runs, run=fake_run(output, calls), which=lambda _: '/usr/bin/node', tool=str(ROOT / 'tools/flaky-verdict.mjs'))
        return said, calls

    def test_only_a_red_e2e_run_of_the_pr_is_read_and_only_verdict_lines_come_back(self):
        said, calls = self.lines([PR_RUN, OTHER, GREEN])
        self.assertEqual(said, [FLAKY, CHANGED])
        self.assertEqual(len(calls), 1, 'a green e2e run and a non-e2e run are not read')
        self.assertEqual(calls[0][calls[0].index('--run') + 1], '7')
        self.assertEqual(calls[0][calls[0].index('--window') + 1], pf.WINDOW, 'the verdict writer shares a small API budget: a short window')
        self.assertLess(int(calls[0][calls[0].index('--deadline') + 1]), pf.TOTAL_S, 'the tool ends its own read before the caller kills it (a killed tool prints nothing)')

    def test_the_whole_read_stops_at_its_total_deadline_and_no_run_may_outlast_it(self):
        calls, timeouts = [], []
        def run(args, **kwargs):
            calls.append(args); timeouts.append(kwargs['timeout'])
            return subprocess.CompletedProcess(args, 0, stdout=f'{FLAKY}\n', stderr='')
        runs = [dict(PR_RUN, databaseId=n) for n in range(10)]
        said = pf.lines('o/r', runs, run=run, which=lambda _: '/usr/bin/node', tool=str(ROOT / 'tools/flaky-verdict.mjs'), clock=Clock(20))
        self.assertLess(len(calls), 10, 'ten red runs cannot all be read inside the deadline')
        self.assertEqual(len(said), len(calls))
        self.assertTrue(all(t <= pf.TOTAL_S for t in timeouts), timeouts)

    def test_note_prints_the_lines_and_appends_the_count_within_140_characters(self):
        import contextlib, io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            text = pf.note('o/r', [PR_RUN], 'x' * 120, run=fake_run(f'{FLAKY}\n', []), which=lambda _: '/usr/bin/node', tool=str(ROOT / 'tools/flaky-verdict.mjs'))
        self.assertIn(FLAKY, out.getvalue())
        self.assertEqual(len(text), 140)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(pf.note('o/r', [PR_RUN], 'why', run=fake_run(f'{CHANGED}\n', []), which=lambda _: '/usr/bin/node', tool=str(ROOT / 'tools/flaky-verdict.mjs')), 'why')

    def test_the_verdict_job_may_read_check_annotations(self):
        text = (ROOT / '.github/workflows/pr-verdict.yml').read_text()
        job = text[text.index('timeout-minutes: 5\n    permissions:\n      actions: read          # the commit'):]
        self.assertIn('checks: read', job.split('steps:')[0], 'stepCauses reads check-run annotations; without it the flaky read is always empty')

    def test_no_node_no_tool_or_a_broken_run_adds_nothing(self):
        self.assertEqual(pf.lines('o/r', [PR_RUN], which=lambda _: None), [])
        self.assertEqual(pf.lines('o/r', [PR_RUN], tool='/nonexistent/flaky-verdict.mjs', which=lambda _: '/usr/bin/node'), [])
        def broken(args, **kwargs):
            raise subprocess.TimeoutExpired(args, 1)
        self.assertEqual(pf.lines('o/r', [PR_RUN], run=broken, which=lambda _: '/usr/bin/node', tool=str(ROOT / 'tools/flaky-verdict.mjs')), [])

    def test_the_description_counts_flaky_steps_and_says_nothing_for_a_plain_red(self):
        self.assertEqual(pf.summary([FLAKY, CHANGED]), ' (flaky: 1 of 2 red step(s) passed on unchanged code)')
        self.assertEqual(pf.summary([CHANGED]), '')
        self.assertEqual(pf.summary([]), '')

    def test_the_verdict_writer_calls_it_only_for_a_red_and_never_lets_it_change_the_state(self):
        text = (ROOT / 'tools/pr-verdict.py').read_text()
        main = text.split('\ndef main():', 1)[1]
        block = main.split("if state == 'failure':\n        why = flaky_note(", 1)[1].split("print(f'{CONTEXT}", 1)[0]
        self.assertNotRegex(block, r'(?m)^\s+state\s*=', 'the flaky note changes the description, never the state')
        note = text.split('def flaky_note(', 1)[1].split('\ndef main():', 1)[0]
        self.assertIn('.note(repo, live, why)', note, 'the lines and the count come from tools/pr_flaky.py note')
        self.assertIn('except Exception', note, 'a failed read leaves the description as it was')
        self.assertIn('except Exception as error:', note, 'a companion that cannot be fetched never stops the verdict (the job-run test has no pr_flaky.py)')
        self.assertNotRegex(note, r'(?m)^\s+state\s*=')


if __name__ == '__main__':
    unittest.main()
