# Exercises the workflow's local retry-lane lookup without GitHub, AI, or installed app state.
# Job: report health
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class LocalRetryGuard(unittest.TestCase):
    def guard(self, registry=None, malformed=False, node_missing=False, pr_run=True):
        """Run the workflow's actual lookup and output commands in a temporary suite directory."""
        workflow = (ROOT / '.github/workflows/e2e.yml').read_text()
        first = workflow.split('        id: suite_run\n', 1)[1].split('      # Flaky or real?', 1)[0]
        self.assertNotIn('GH_TOKEN:', first)
        script = first.split('        run: |\n', 1)[1].split('          # A run on an older commit', 1)[0]
        self.assertIn('node -e', script)
        self.assertNotIn('gh ', script)
        script = '\n'.join(line.removeprefix('          ') for line in script.splitlines()).replace('${{ matrix.suite }}', 'qualityai')
        with tempfile.TemporaryDirectory() as folder:
            cwd = Path(folder) / 'desktop/e2e'
            cwd.mkdir(parents=True)
            if registry is not None or malformed:
                (cwd / 'lanes.json').write_text('{broken' if malformed else json.dumps(registry))
            output = Path(folder) / 'output'
            env = {**os.environ, 'GITHUB_OUTPUT': str(output)}
            env.pop('PR_RUN', None)
            if pr_run:
                env['PR_RUN'] = '1'
            if node_missing:
                env['PATH'] = folder
            result = subprocess.run([shutil.which('bash'), '-e', '-c', script], cwd=cwd, env=env,
                                    capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            return output.read_text().strip()

    def test_tolerant_number_skips_retry(self):
        self.assertEqual(self.guard({'suites': {'qualityai': {'lane': 'tolerant', 'pr': 'number'}}}), 'report_only=1')

    def test_tolerant_without_pr_keeps_retry(self):
        self.assertEqual(self.guard({'suites': {'qualityai': {'lane': 'tolerant'}}}), 'report_only=0')

    def test_backbone_keeps_retry_even_with_pr_number(self):
        self.assertEqual(self.guard({'suites': {'qualityai': {'lane': 'backbone', 'pr': 'number'}}}), 'report_only=0')

    def test_missing_file_keeps_retry(self):
        self.assertEqual(self.guard(), 'report_only=0')

    def test_bad_file_keeps_retry(self):
        self.assertEqual(self.guard(malformed=True), 'report_only=0')

    def test_missing_node_keeps_retry_without_failing_the_step(self):
        self.assertEqual(self.guard(node_missing=True), 'report_only=0')

    def test_only_a_pr_run_skips_the_retry(self):
        self.assertEqual(self.guard({'suites': {'qualityai': {'lane': 'tolerant', 'pr': 'number'}}}, pr_run=False), 'report_only=0')

    def test_a_failed_report_only_try_still_fails_the_job(self):
        workflow = (ROOT / '.github/workflows/e2e.yml').read_text()
        step = workflow.split('- name: "Report-only ${{ matrix.key }} failed its only try', 1)[1].split('- name: "First try failed', 1)[0]
        self.assertIn("steps.suite_run.outcome == 'failure'", step)
        self.assertIn("steps.suite_run.outputs.report_only == '1'", step)
        self.assertIn('run: exit 1', step)
