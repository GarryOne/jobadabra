"""Every step of an e2e workflow job carries `timeout-minutes`, so a hung step ends with its log kept instead of running until a human cancels the job.

Why (31 Oct 2026, owner: "let's close all the gaps"; coordinator 27): the step "Scan artifact contents for CI secrets" hung 17+ minutes in personas runs
41167629768 and 41169971636 (a quadratic nested-zip scan, fixed in #2671). Nothing capped the step, a human cancelled the job, and a force-cancel lost every
log (BlobNotFound) and every artifact upload. A step with `timeout-minutes` fails alone, keeps its log, and the job's later `if: always()` steps still run.
Suite-run steps already had one (E2E_TRY_MINUTES, rule B); this extends it to every step around them (scan, upload, report, lock, cleanup, setup).
The numbers are about 3x the p95 of the last 20 successful runs, FLOOR minutes at least (PR #2677's body lists them): most of these steps take 0-30 s, so 3x p95
alone would turn a slow checkout or cache restore into a false red. A composite action's own steps cannot carry
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
FLOOR = 5  # minutes; rule B in docs/superpowers/specs/2026-10-28-e2e-reliability-design.md
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


def too_short(path):
    return [f'{name} ({m.group(1)} min)' for name, body in steps(path.read_text()) for m in TIMEOUT.finditer(body) if int(m.group(1)) < FLOOR]


def untimed(path):
    return [name for name, body in steps(path.read_text()) if not TIMEOUT.search(body)]


# Why (31 Oct 2026, a8; beta 41246139016): 518662a capped "The shared release checks" at 5 minutes, but tools/release-checks.sh waits up to RELEASE_CI_WAIT (3600 s) for main's
# build.yml; both Release jobs died with "has timed out after 5 minutes" over an all-green beta. A cap has to outlive the wait its own script declares.
# Each entry: (a pattern that finds the step by what it runs, the script that waits, the env names whose seconds add up to its longest wait). A step's `env:` value wins over the script's
# `NAME:-N` default, as it does when the script runs. A step that runs a waiting script and is not listed here is not checked: add the script when it gains a wait.
WAITING = [
    (r'tools/release-checks\.sh', 'tools/release-checks.sh', ['RELEASE_CI_WAIT']),
    (r'tools/red-main-gate\.sh(?! .*--status)', 'tools/red-main-gate.sh', ['RED_MAIN_FIND_S', 'RED_MAIN_WAIT_S']),
    (r'e2e-lock\.sh acquire', 'tools/e2e-lock.sh', ['E2E_LOCK_MAX']),
]
MARGIN = 120  # seconds the cap leaves after the longest wait, so the script's own "still running after N s" line prints before the runner kills the step


def declared_waits(body):
    """The (script, seconds) pairs a step may wait: the sum of the env names listed for each waiting script it runs."""
    found = []
    code = '\n'.join(line for line in body.splitlines() if not line.lstrip().startswith('#'))   # a comment that names a script does not run it
    for pattern, script, names in WAITING:
        if not re.search(pattern, code):
            continue
        text = (ROOT / script).read_text()
        seconds = 0
        for name in names:
            from_step = re.search(rf"(?m)^\s+{name}: '?(\d+)'?\s*(?:#.*)?$", body)
            seconds += int((from_step or re.search(rf'{name}:-(\d+)', text)).group(1))
        found.append((script, seconds))
    return found


def too_short_for_the_wait(path):
    bad = []
    for name, body in steps(path.read_text()):
        cap = TIMEOUT.search(body)
        for script, seconds in declared_waits(body):
            if cap and int(cap.group(1)) * 60 < seconds + MARGIN:
                bad.append(f'{name} ({cap.group(1)} min, but {script} may wait {seconds} s)')
    return bad


class E2eStepTimeouts(unittest.TestCase):
    def test_a_step_cap_outlives_the_wait_its_script_declares(self):
        short = [f'{name}.yml: {step}' for name in e2e_workflow_names() for step in too_short_for_the_wait(WORKFLOWS / f'{name}.yml')]
        self.assertEqual(short, [], f'raise `timeout-minutes` to the wait plus {MARGIN // 60} min (the script prints its own "not waiting any longer" line only if the runner has not killed it first)')

    def test_every_waiting_script_is_found_in_a_step(self):
        seen = {script: 0 for _, script, _ in WAITING}
        for name in e2e_workflow_names():
            for _, body in steps((WORKFLOWS / f'{name}.yml').read_text()):
                for script, _ in declared_waits(body):
                    seen[script] += 1
        self.assertEqual([script for script, count in seen.items() if not count], [], 'a WAITING entry no step runs any more: drop it, or fix its pattern')
        self.assertGreaterEqual(seen['tools/release-checks.sh'], 2, 'the Mac and the Windows release jobs both run the shared release checks')

    def test_the_wait_is_read_from_the_step_then_the_script(self):
        self.assertEqual(declared_waits('run: tools/release-checks.sh "$TAG" "$REF"'), [('tools/release-checks.sh', 3600)])
        self.assertEqual(declared_waits("env:\n  RELEASE_CI_WAIT: '600'\nrun: tools/release-checks.sh x"), [('tools/release-checks.sh', 600)])
        self.assertEqual(declared_waits('run: tools/red-main-gate.sh "$R" --status'), [])

    def test_every_e2e_step_has_a_timeout(self):
        bad = []
        for name in e2e_workflow_names():
            path = WORKFLOWS / f'{name}.yml'
            self.assertTrue(path.is_file(), f'{path.name} is named by the F rule but missing')
            bad += [f'{path.name}: {step}' for step in untimed(path) if (path.name, step) not in EXEMPT]
        self.assertEqual(bad, [], f'add `timeout-minutes: N` (about 3x the step\'s p95, {FLOOR} at least) to each step above')

    def test_no_step_cap_is_below_the_floor(self):
        short = [f'{name}.yml: {step}' for name in e2e_workflow_names() for step in too_short(WORKFLOWS / f'{name}.yml')]
        self.assertEqual(short, [], f'a step cap under {FLOOR} min turns a slow checkout or cache restore into a false red: raise it')

    def test_exemptions_are_not_stale(self):
        stale = [key for key in EXEMPT if key[1] not in untimed(WORKFLOWS / key[0])]
        self.assertEqual(stale, [], 'these steps now have a timeout (or are gone): drop them from EXEMPT')

    def test_the_splitter_sees_the_steps(self):
        sample = 'jobs:\n  a:\n    timeout-minutes: 9\n    steps:\n      - name: one\n        run: x\n      - name: two\n        timeout-minutes: 3\n        run: y\n  b:\n    timeout-minutes: 7\n    steps:\n      - uses: u\n'
        self.assertEqual([(n, bool(TIMEOUT.search(b))) for n, b in steps(sample)], [('one', False), ('two', True), ('u', False)])


if __name__ == '__main__':
    unittest.main()
