"""Every step of an e2e workflow job carries `timeout-minutes`, so a hung step ends with its log kept instead of running until a human cancels the job.

Why (31 Oct 2026, owner: "let's close all the gaps"; coordinator 27): the step "Scan artifact contents for CI secrets" hung 17+ minutes in personas runs
41167629768 and 41169971636 (a quadratic nested-zip scan, fixed in #2671). Nothing capped the step, a human cancelled the job, and a force-cancel lost every
log (BlobNotFound) and every artifact upload. A step with `timeout-minutes` fails alone, keeps its log, and the job's later `if: always()` steps still run.
Suite-run steps already had one (E2E_TRY_MINUTES, rule B); this extends it to every step around them (scan, upload, report, lock, cleanup, setup).
The numbers are about 3x the p95 of the last 20 successful runs, 2 minutes at least (the PR body lists them). A composite action's own steps cannot carry
`timeout-minutes` (GitHub does not allow it there), so the step that calls the action carries it.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / '.github/workflows'
# Workflows beside the list tools/e2e-reliability-check.mjs names: desktop.yml runs the same suites in the release gate, e2e-weekly.yml runs them weekly.
ALSO = ('desktop', 'e2e-weekly')
# (file, step name) -> why it has no `timeout-minutes`. Empty on purpose: a stale entry fails the test, so an exemption cannot outlive its step.
EXEMPT = {}
TIMEOUT = re.compile(r'(?m)^        timeout-minutes: (\d+)\b')


def e2e_workflow_names():
    """The workflows the F rule governs (the E2E_WORKFLOWS pattern in tools/e2e-reliability-check.mjs) plus ALSO."""
    source = (ROOT / 'tools/e2e-reliability-check.mjs').read_text()
    names = re.search(r"const E2E_WORKFLOWS = '\(\?:([^)]+)\)'", source).group(1).split('|')
    return sorted(set(names) | set(ALSO))


def step_name(chunk):
    found = re.search(r'(?m)^(?: {8})?(?:name|uses): (.+)$', chunk)
    return found.group(1).strip() if found else chunk.splitlines()[0].strip()


def steps(text):
    """Each step of a workflow as (name, its text). Only lines under a job's `steps:` count, so `needs:` lists and matrix entries are not steps and a job's own
    `timeout-minutes` (4 spaces) is never mistaken for a step's (8 spaces)."""
    chunks, in_steps = [], False
    for line in text.splitlines():
        if re.match(r' {0,4}\S', line):
            in_steps = line == '    steps:'
        elif in_steps and line.startswith('      - '):
            chunks.append([line[8:]])
        elif in_steps and chunks:
            chunks[-1].append(line)
    for lines in chunks:
        body = '\n'.join(lines)
        yield step_name(body), body


def untimed(path):
    return [name for name, body in steps(path.read_text()) if not TIMEOUT.search(body)]


class E2eStepTimeouts(unittest.TestCase):
    def test_every_e2e_step_has_a_timeout(self):
        bad = []
        for name in e2e_workflow_names():
            path = WORKFLOWS / f'{name}.yml'
            self.assertTrue(path.is_file(), f'{path.name} is named by the F rule but missing')
            bad += [f'{path.name}: {step}' for step in untimed(path) if (path.name, step) not in EXEMPT]
        self.assertEqual(bad, [], 'add `timeout-minutes: N` (about 3x the step\'s p95, 2 at least) to each step above')

    def test_exemptions_are_not_stale(self):
        stale = [key for key in EXEMPT if key[1] not in untimed(WORKFLOWS / key[0])]
        self.assertEqual(stale, [], 'these steps now have a timeout (or are gone): drop them from EXEMPT')

    def test_the_splitter_sees_the_steps(self):
        sample = 'jobs:\n  a:\n    timeout-minutes: 9\n    steps:\n      - name: one\n        run: x\n      - name: two\n        timeout-minutes: 3\n        run: y\n  b:\n    timeout-minutes: 7\n    steps:\n      - uses: u\n'
        self.assertEqual([(n, bool(TIMEOUT.search(b))) for n, b in steps(sample)], [('one', False), ('two', True), ('u', False)])


if __name__ == '__main__':
    unittest.main()
