"""A red unit test no longer hides the beta's e2e results (owner, 31 Oct 2026: "D: unit red still runs e2e").

Beta by hand 41215677698 stopped at "Build · Mac" on 1 of 5,102 unit tests: the unit step runs before Compile, so no app was built and every E2E suite was skipped, a
45-minute beta that told us nothing about the e2e. Now the unit step is red in the Build box but does not stop Compile, Smoke or the e2e gates; both Release jobs
still refuse ("Not released: red: Unit tests · <lane>"), and a failed Compile or Smoke still stops the e2e (no app to test).
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = (ROOT / '.github/workflows/desktop.yml').read_text()
LANES = (('build', 'Mac', 'test-mac', 'release-mac'), ('windows', 'Windows', 'test-windows', 'release-windows'))


def job(name):
    return WORKFLOW.split(f'\n  {name}:\n')[1].split('\n\n  # ')[0].split('\n  prune:\n')[0]


def steps(name):
    """The job's steps, each as its text from `- name:` / `- uses:` to the next step."""
    return re.split(r'(?m)^      - ', job(name).split('\n    steps:\n')[1])[1:]


def step(name, part):
    found = [s for s in steps(name) if part in s.split('\n')[0] or part in s.split('run:')[0]]
    assert len(found) == 1, (name, part, len(found))
    return found[0]


class UnitRedRunsE2E(unittest.TestCase):
    def test_a_red_unit_step_does_not_stop_the_build_box(self):
        for name, lane, _, _ in LANES:
            unit = step(name, 'Unit tests · desktop app')
            self.assertIn('id: unit', unit, lane)
            self.assertRegex(unit, r'(?m)^        continue-on-error: true$', f'{lane}: the unit step is red but the box goes on to Compile and Smoke')
            self.assertIn('Why (31 Oct 2026, owner', job(name).split('Unit tests · desktop app')[0][-1500:], f'{lane}: the decision carries its Why')

    def test_the_unit_result_leaves_the_build_box_as_an_output(self):
        for name, lane, _, _ in LANES:
            header = job(name).split('\n    steps:\n')[0]
            self.assertRegex(header, r'(?m)^    outputs:\n      unit: \$\{\{ steps\.unit\.outcome \}\}', f'{lane}: the release jobs read the unit step\'s own outcome')

    def test_only_the_unit_step_is_decoupled_compile_and_smoke_still_stop_the_e2e(self):
        for name, lane, test, _ in LANES:
            for s in steps(name):
                title = s.split('\n')[0]
                if title.startswith('name: Compile') or title.startswith('name: Smoke'):
                    self.assertNotIn('continue-on-error', s, f'{lane}: {title} red = no app to test')
                    self.assertNotIn('steps.unit', s, f'{lane}: {title} runs after a red unit step')
            quiet = [s.split('\n')[0] for s in steps(name) if re.search(r'(?m)^        continue-on-error:', s)]
            self.assertEqual([t for t in quiet if 'Unit tests' in t or 'Speed' in t], quiet, f'{lane}: only the unit step (and the Defender speed-up) may fail quietly: {quiet}')
            self.assertTrue(any('Unit tests' in t for t in quiet), lane)
            # The e2e job waits on the build box's result: a failed Compile or Smoke fails the box, so the e2e skips.
            self.assertIn("needs.build.result == 'success'" if name == 'build' else "needs.windows.result == 'success'", job(test))

    def test_a_build_only_run_that_is_not_tested_still_ends_red_on_a_unit_failure(self):
        # Without the gate nothing else reads the unit result, so the box itself must stay red there (as before): stop at once, before Compile and the release upload.
        for name, lane, _, _ in LANES:
            stop = [s for s in steps(name) if "steps.unit.outcome == 'failure'" in s]
            self.assertEqual(len(stop), 1, lane)
            self.assertIn("needs.changes.outputs.gate != 'true'", stop[0])
            self.assertIn('exit 1', stop[0])
            titles = [s.split('\n')[0] for s in steps(name)]
            at = titles.index(stop[0].split('\n')[0])
            self.assertLess(at, next(i for i, t in enumerate(titles) if t.startswith('name: Compile')), lane)
            self.assertGreater(at, next(i for i, t in enumerate(titles) if t.startswith('name: Unit tests')), lane)

    def test_both_release_jobs_refuse_on_a_unit_red_even_when_every_e2e_passed(self):
        for _, lane, _, release in LANES:
            body = job(release)
            self.assertIn('needs: [changes, build, windows, test-mac, test-windows]', body, f'{lane}: the release reads both lanes\' unit results')
            gate = step(release, f'Not released on {lane}')
            self.assertIn('--unit-mac "${{ needs.build.outputs.unit }}"', gate)
            self.assertIn('--unit-windows "${{ needs.windows.outputs.unit }}"', gate)
            self.assertLess(body.index(f'Not released on {lane}'), body.index('tools/beta-approve.sh'), f'{lane}: the refusal comes before the approval')
            self.assertNotIn('beta-approve', gate)


if __name__ == '__main__':
    unittest.main()
