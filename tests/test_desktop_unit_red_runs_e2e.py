"""A red unit test no longer hides the beta's e2e results (owner, 31 Oct 2026: "D: unit red still runs e2e").

Beta by hand 41215677698 stopped at "Build · Mac" on 1 of 5,102 unit tests: the unit step ran before Compile, so no app was built and every E2E suite was skipped, a
45-minute beta that told us nothing about the e2e. A red unit test stops no Compile, Smoke or e2e gate; both Release jobs still refuse ("Not released: red: Unit tests · <lane>"),
and a failed Compile or Smoke still stops the e2e (no app to test).

Owner, 1 Nov 2026: "Yes" to moving the unit tests into their own parallel jobs ("Unit tests · Mac" / "Unit tests · Windows"): in a tested run they run beside Build, no E2E job needs
them, both Release jobs do. A run that is not tested (no gate) runs the same action inside Build, before Compile, and stops the build on a red.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = (ROOT / '.github/workflows/desktop.yml').read_text()
LANES = (('build', 'Mac', 'test-mac', 'release-mac', 'unit-mac'), ('windows', 'Windows', 'test-windows', 'release-windows', 'unit-windows'))
UNIT_STEP = 'Unit tests · desktop app'


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
    def test_a_tested_run_has_the_unit_tests_in_their_own_job_beside_the_build(self):
        for _, lane, _, _, unit in LANES:
            body = job(unit)
            self.assertIn(f'name: Unit tests · {lane}', body)
            self.assertIn("needs: changes\n", body, f'{lane}: it starts with Build, not after it')
            self.assertIn("needs.changes.outputs.released == 'true' && needs.changes.outputs.gate == 'true'", body, f'{lane}: a tested run only; a Build only run keeps the step inside Build')
            self.assertEqual(len(re.findall(r'uses: \./\.github/actions/unit-tests', body)), 1, lane)
            self.assertIn('Why (31 Oct 2026, owner', WORKFLOW.split(f'\n  {unit}:\n')[0][-2500:], f'{lane}: the decision carries its Why')
            self.assertIn('Why (1 Nov 2026, owner', WORKFLOW.split('\n  build:\n')[0][-2500:], 'the move carries its Why, above the build jobs')

    def test_one_body_for_the_step_and_nothing_else_runs_the_checks(self):
        action = (ROOT / '.github/actions/unit-tests/action.yml').read_text()
        self.assertIn('for area in $UNIT_AREAS; do bash tools/check.sh --area "$area"', action)
        self.assertNotIn('bash tools/check.sh', WORKFLOW, 'the step body lives in the action, so no copy grows')
        self.assertEqual(WORKFLOW.count('uses: ./.github/actions/unit-tests'), 4, 'two unit jobs, two Build only callers')
        areas = lambda text: re.search(r"areas: '([^']*)'", text).group(1)
        self.assertEqual(areas(job('unit-mac')), 'python desktop')
        self.assertEqual(areas(job('build')), 'python desktop', 'a Build only run tests what the tested run does')
        self.assertEqual(areas(job('unit-windows')), 'desktop')   # TEMPORARY since 10 Oct 2026: the 196 Windows-only Python reds
        self.assertEqual(areas(job('windows')), 'desktop')
        for area in ('worker', 'site'):
            self.assertNotIn(f"areas: '{area}", WORKFLOW)
        self.assertIn("if: runner.os == 'Windows'", action.split('python -m pip install tzdata')[0][-200:], 'Windows needs the time-zone data the tests load')

    def test_the_build_boxes_no_longer_publish_a_unit_output_the_release_reads_the_unit_jobs(self):
        for name, lane, _, release, unit in LANES:
            self.assertNotIn('outputs:', job(name).split('\n    steps:\n')[0], f'{lane}: the Build box has no unit output any more')
            gate = step(release, f'Not released on {lane}')
            # Gitar on #2858: the gate only counts 'failure'; a unit job that ended cancelled or skipped must refuse the release too, so only 'success' passes as success.
            self.assertIn("--unit-mac \"${{ needs.unit-mac.result == 'success' && 'success' || 'failure' }}\"", gate)
            self.assertIn("--unit-windows \"${{ needs.unit-windows.result == 'success' && 'success' || 'failure' }}\"", gate)
        self.assertNotIn('outputs.unit', WORKFLOW)

    def test_the_e2e_jobs_never_wait_for_a_unit_job_and_both_release_jobs_do(self):
        for _, lane, test, release, _ in LANES:
            needs = re.search(r'(?m)^    needs: (\[[^\]]*\])', job(test)).group(1)
            self.assertNotIn('unit', needs, f'{lane}: the e2e starts when its build is done, not when the unit tests are')
            self.assertNotIn('unit-', job(test).split('\n    steps:\n')[0], f'{lane}: nothing in the e2e job header reads a unit job')
            release_needs = re.search(r'(?m)^    needs: (\[[^\]]*\])', job(release)).group(1)
            for unit in ('unit-mac', 'unit-windows'):
                self.assertIn(unit, release_needs, f'{lane}: the release reads {unit}')
        for name in ('ai-ready', 'gate-ran'):
            self.assertNotIn('unit-', re.search(r'(?m)^    needs: (\[[^\]]*\])', job(name)).group(1))

    def test_only_the_unit_step_is_decoupled_compile_and_smoke_still_stop_the_e2e(self):
        for name, lane, test, _, _ in LANES:
            for s in steps(name):
                title = s.split('\n')[0]
                if title.startswith('name: Compile') or title.startswith('name: Smoke'):
                    self.assertNotIn('continue-on-error', s, f'{lane}: {title} red = no app to test')
                    self.assertNotIn('steps.unit', s, f'{lane}: {title} runs after a red unit step')
            quiet = [s.split('\n')[0] for s in steps(name) if re.search(r'(?m)^        continue-on-error:', s)]
            self.assertEqual([t for t in quiet if 'Unit tests' in t or 'Speed' in t], quiet, f'{lane}: only the Build only unit step (and the Defender speed-up) may fail quietly: {quiet}')
            self.assertTrue(any('Unit tests' in t for t in quiet), lane)
            # The e2e job waits on the build box's result: a failed Compile or Smoke fails the box, so the e2e skips.
            self.assertIn("needs.build.result == 'success'" if name == 'build' else "needs.windows.result == 'success'", job(test))

    def test_a_build_only_run_that_is_not_tested_still_ends_red_on_a_unit_failure(self):
        # Without the gate nothing else reads the unit result, and Build publishes itself: the unit step runs inside Build (the same action), before Compile and the release upload,
        # and a red stops the box there. A tested run skips that step (its unit job runs beside Build).
        for name, lane, _, _, _ in LANES:
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
        for _, lane, _, release, _ in LANES:
            body = job(release)
            gate = step(release, f'Not released on {lane}')
            self.assertLess(body.index(f'Not released on {lane}'), body.index('tools/beta-approve.sh'), f'{lane}: the refusal comes before the approval')
            self.assertNotIn('beta-approve', gate)


if __name__ == '__main__':
    unittest.main()
