"""A red unit test no longer hides the beta's e2e results (owner, 31 Oct 2026: "D: unit red still runs e2e").

Beta by hand 41215677698 stopped at "Build · Mac" on 1 of 5,102 unit tests: the unit step ran before Compile, so no app was built and every E2E suite was skipped, a
45-minute beta that told us nothing about the e2e. A red unit test stops no Compile, Smoke or e2e gate; both Release jobs still refuse ("Not released: red: Unit tests · <lane>"),
and a failed Compile or Smoke still stops the e2e (no app to test).

Owner, 1 Nov 2026: "Yes" to moving the unit tests off the Build box's critical path, then "let's go this way" to making them a LEG of the Test matrix ("Unit tests · Mac" /
"Unit tests · Windows", beside the E2E suites; Build → Test matrix [Unit | e2e suites] → Release). A run that is not tested (no gate) has no Test matrix: Build runs the same action
inline, before Compile, and stops the build on a red.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = (ROOT / '.github/workflows/desktop.yml').read_text()
ACTION = (ROOT / '.github/actions/unit-tests/action.yml').read_text()
LANES = (('build', 'Mac', 'test-mac', 'release-mac'), ('windows', 'Windows', 'test-windows', 'release-windows'))
UNIT_STEP = 'Unit tests · desktop app'
# The steps a unit leg shares with the suite legs: the checkouts, the call ledger, node and python, and the app's `npm ci` the unit tests need.
SHARED = ('uses: actions/checkout@', 'uses: ./.github/actions/gh-ledger', 'uses: actions/setup-node@', 'uses: actions/setup-python@', 'name: Install the app')


def job(name):
    return re.split(r'\n\n  (?:# |[a-z0-9-]+:\n)', WORKFLOW.split(f'\n  {name}:\n')[1])[0].split('\n  prune:\n')[0]


def steps(name):
    """The job's steps, each as its text from `- name:` / `- uses:` to the next step."""
    return re.split(r'(?m)^      - ', job(name).split('\n    steps:\n')[1])[1:]


def step(name, part):
    found = [s for s in steps(name) if part in s.split('\n')[0] or part in s.split('run:')[0]]
    assert len(found) == 1, (name, part, len(found))
    return found[0]


class UnitRedRunsE2E(unittest.TestCase):
    def test_the_unit_tests_are_a_leg_of_each_test_matrix_not_a_job_of_their_own(self):
        for _, lane, test, _ in LANES:
            self.assertNotIn('\n  unit-mac:\n', WORKFLOW)
            self.assertNotIn('\n  unit-windows:\n', WORKFLOW)
            body = job(test)
            header = body.split('\n    steps:\n')[0]
            prefix = 'E2E · Mac + Linux' if lane == 'Mac' else 'E2E · Windows'
            # The unit leg is named whole and never starts with "E2E · ": every reader of the E2E jobs by that prefix (gate, canary, reports) ignores it.
            self.assertIn("name: ${{ matrix.name || format('%s · {0}', matrix.key) }}" % prefix, header, lane)
            self.assertNotIn('unit', re.search(r'(?m)^    needs: (\[[^\]]*\])', body).group(1), f'{lane}: the unit leg starts with the suites, when its build ends')
            self.assertRegex(header, r'(?m)^      fail-fast: false', f'{lane}: a red unit leg must not cancel the e2e legs (owner, 31 Oct 2026: unit red still runs e2e)')
            self.assertNotIn('continue-on-error: ${{ matrix.unit', header)
            self.assertEqual(body.count("uses: ./.github/actions/unit-tests"), 1, lane)
            self.assertIn("if: matrix.suite == 'unit'", step(test, UNIT_STEP), f'{lane}: the unit step runs on the unit leg only')

    def test_every_step_of_the_test_jobs_is_a_suite_step_or_a_unit_step_or_shared(self):
        for _, lane, test, _ in LANES:
            for s in steps(test):
                first = s.split('\n')[0]
                if any(mark in first or mark in s.split('with:')[0].split('run:')[0] for mark in SHARED):
                    continue
                conditions = re.findall(r'(?m)^(?:if: |        if: )(.*)$', s)
                self.assertTrue(conditions and ("matrix.suite != 'unit'" in conditions[0] or "matrix.suite == 'unit'" in conditions[0]),
                                f"{lane}: this step has no leg condition, so the unit leg would run it: {first}")

    def test_the_unit_leg_runs_the_tests_with_none_of_the_e2e_jobs_tokens(self):
        # The test jobs' env holds live Notion, AI and GitHub tokens; the unit leg shares it, so the action unsets them (a denylist: tests/test_unit_leg_env.py derives the secrets).
        for _, _, test, _ in LANES:
            self.assertIn('uses: ./.github/actions/unit-tests', job(test))
        self.assertIn('unset "$name"', ACTION)
        self.assertIn('E2E_*|CI_*|FREE_AI_*|AI_COST_*', ACTION)

    def test_one_body_for_the_step_and_nothing_else_runs_the_checks(self):
        self.assertIn('for area in $UNIT_AREAS; do bash tools/check.sh --area "$area"', ACTION)
        self.assertNotIn('bash tools/check.sh', WORKFLOW, 'the step body lives in the action, so no copy grows')
        self.assertEqual(WORKFLOW.count('uses: ./.github/actions/unit-tests'), 4, 'two Test-matrix legs, two Build only callers')
        areas = lambda text: re.search(r"areas: '([^']*)'", text).group(1)
        self.assertEqual(areas(step('test-mac', UNIT_STEP)), 'python desktop')
        self.assertEqual(areas(step('build', UNIT_STEP)), 'python desktop', 'a Build only run tests what the tested run does')
        self.assertEqual(areas(step('test-windows', UNIT_STEP)), 'desktop')   # TEMPORARY since 10 Oct 2026: the 196 Windows-only Python reds
        self.assertEqual(areas(step('windows', UNIT_STEP)), 'desktop')
        self.assertIn("if: runner.os == 'Windows'", ACTION.split('python -m pip install tzdata')[0][-200:], 'Windows needs the time-zone data the tests load')

    def test_the_plan_step_asks_for_the_unit_legs_and_the_release_reads_them_by_name(self):
        plan = step('changes', 'Plan the E2E suites for both lanes')
        self.assertIn("GATE_UNIT: '1'", plan)
        for _, lane, _, release in LANES:
            self.assertNotIn('--unit', WORKFLOW, 'the gate finds the unit legs among the run\'s jobs; no argument carries their result')
            self.assertIn('beta_rate_gate.py --repo', step(release, f'Not released on {lane}'))
        self.assertNotIn('outputs.unit', WORKFLOW)
        for name, *_ in LANES:
            self.assertNotIn('outputs:', job(name).split('\n    steps:\n')[0], f'{name}: the Build box has no unit output any more')

    def test_the_e2e_jobs_wait_for_their_build_only_and_both_release_jobs_wait_for_every_test_leg(self):
        for name, lane, test, release in LANES:
            needs = re.search(r'(?m)^    needs: (\[[^\]]*\])', job(test)).group(1)
            self.assertEqual(needs, f'[changes, {name}]', lane)   # Why-changed (1 Nov 2026, a8): ai-ready left the beta (no live AI calls, beta #7)
            self.assertEqual(re.search(r'(?m)^    needs: (\[[^\]]*\])', job(release)).group(1), '[changes, build, windows, test-mac, test-windows]', lane)
            self.assertIn(f"needs.{name}.result == 'success'", job(test))

    def test_compile_and_smoke_still_stop_the_e2e_and_only_the_build_only_unit_step_fails_quietly(self):
        for name, lane, _, _ in LANES:
            for s in steps(name):
                title = s.split('\n')[0]
                if title.startswith('name: Compile') or title.startswith('name: Smoke'):
                    self.assertNotIn('continue-on-error', s, f'{lane}: {title} red = no app to test')
                    self.assertNotIn('steps.unit', s, f'{lane}: {title} runs after a red unit step')
            quiet = [s.split('\n')[0] for s in steps(name) if re.search(r'(?m)^        continue-on-error:', s)]
            self.assertEqual([t for t in quiet if 'Unit tests' in t or 'Speed' in t], quiet, f'{lane}: only the Build only unit step (and the Defender speed-up) may fail quietly: {quiet}')

    def test_a_build_only_run_that_is_not_tested_still_ends_red_on_a_unit_failure(self):
        # Without the gate there is no Test matrix, and Build publishes itself: the unit step runs inside Build (the same action), before Compile and the release upload, and a red
        # stops the box there. A tested run skips that step (its unit leg runs in the Test matrix).
        for name, lane, _, _ in LANES:
            inline = step(name, UNIT_STEP)
            self.assertIn("if: needs.changes.outputs.gate != 'true'", inline, lane)
            self.assertIn('uses: ./.github/actions/unit-tests', inline, lane)
            stop = [s for s in steps(name) if "steps.unit.outcome == 'failure'" in s]
            self.assertEqual(len(stop), 1, lane)
            self.assertIn("needs.changes.outputs.gate != 'true'", stop[0])
            self.assertIn('exit 1', stop[0])
            titles = [s.split('\n')[0] for s in steps(name)]
            at = titles.index(stop[0].split('\n')[0])
            self.assertLess(at, next(i for i, t in enumerate(titles) if t.startswith('name: Compile')), lane)
            self.assertGreater(at, next(i for i, t in enumerate(titles) if t.startswith('name: Unit tests')), lane)
            publish = next(i for i, t in enumerate(titles) if t.startswith('name: Add to the release'))
            self.assertLess(at, publish, f'{lane}: a red unit test stops the box before it publishes')

    def test_both_release_jobs_refuse_on_a_unit_red_even_when_every_e2e_passed(self):
        for _, lane, _, release in LANES:
            body = job(release)
            gate = step(release, f'Not released on {lane}')
            self.assertLess(body.index(f'Not released on {lane}'), body.index('tools/beta-approve.sh'), f'{lane}: the refusal comes before the approval')
            self.assertNotIn('beta-approve', gate)


if __name__ == '__main__':
    unittest.main()
