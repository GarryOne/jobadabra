"""A push to main starts two jobs: one Linux job running every Linux suite in sequence, and the Windows desktop tests (owner, 15 Oct 2026: "on main we don't need readability or
speed, just as few runners as possible"; a push started ~10). Each suite is a named step that fails alone, and a last step lists every red one. A pull request keeps the parallel
split (speed matters there). This test keeps main's one job complete: every suite a pull request can start has its step in build.yml."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / '.github' / 'workflows'
BUILD = (WORKFLOWS / 'build.yml').read_text(encoding='utf-8')
LINUX_SUITES = {   # what a PR's workflow runs -> a line of its step in build.yml
    'tests-python.yml': 'bash tools/check.sh --area python',
    'tests-worker.yml': 'bash tools/check.sh --area worker',
    'tests-desktop.yml': 'bash tools/check.sh --area desktop',
    'page-cases.yml': 'node --test --test-concurrency=1 test/recorded-pages.test.mjs',
    'control-tests.yml': 'node widget-zoo.mjs --json widget-zoo.json',
}
# Why (owner, 27 Oct 2026: "Main, red on regression"): main runs the zoo inside the fill check (zoo + recorded pages vs main's last green), not the by-hand zoo command.
ON_MAIN_INSTEAD = {'control-tests.yml': 'node check-fill.mjs --all --baseline'}


class MainOneJob(unittest.TestCase):
    def test_two_jobs_one_linux_and_the_windows_tests(self):
        jobs = re.findall(r'(?m)^  ([\w-]+):\n(?:    .*\n)', BUILD.split('\njobs:\n', 1)[1])
        self.assertEqual(jobs, ['linux', 'windows'])
        self.assertIn('uses: ./.github/workflows/tests-desktop-windows.yml', BUILD)
        self.assertNotRegex(BUILD.split('\njobs:\n', 1)[1], r'(?m)^    strategy:', 'no matrix on main')

    def test_every_linux_suite_a_pr_runs_is_a_step_of_the_one_job(self):
        for workflow, command in LINUX_SUITES.items():
            self.assertIn(command, (WORKFLOWS / workflow).read_text(encoding='utf-8'), f'{workflow}: the command moved, update this test and build.yml')
            self.assertIn(ON_MAIN_INSTEAD.get(workflow, command), BUILD, f'build.yml has no step for {workflow}')

    def test_each_suite_fails_alone_and_a_last_step_lists_the_red_ones(self):
        steps = re.findall(r'(?ms)^      - name: (Suite · [^\n]*)\n(.*?)(?=^      - )', BUILD)
        self.assertGreaterEqual(len(steps), 5)
        for name, body in steps:
            self.assertIn('continue-on-error: true', body, name)
        for key in ('python', 'worker', 'desktop', 'pages'):
            self.assertIn(f'steps.{key}.outcome', BUILD, key)
        self.assertRegex(BUILD, r'(?s)if: always\(\)\n\s+env:\n\s+RESULTS:.*exit 1')

    def test_the_other_workflows_no_longer_start_on_a_push(self):
        for name in ('page-cases.yml', 'control-tests.yml'):
            trigger = (WORKFLOWS / name).read_text(encoding='utf-8').split('\njobs:')[0]
            self.assertNotRegex(trigger, r'(?m)^  push:', name)

    def test_a_timeout_fits_the_sum(self):
        self.assertRegex(BUILD, r'timeout-minutes: (4\d|5\d|60)\b')


if __name__ == '__main__':
    unittest.main()
