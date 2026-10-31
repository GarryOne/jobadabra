"""Flaky-step workflow contract (spec row 33, 31 Oct 2026): a red main e2e run is inspected for steps red on unchanged code; only main's own checks count; the registry is never edited."""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / '.github/workflows/e2e-flip.yml'


class E2eFlipWorkflow(unittest.TestCase):
    def setUp(self):
        self.assertTrue(WORKFLOW.exists(), 'a red main e2e run needs its flaky-step workflow')
        self.text = WORKFLOW.read_text()

    def test_yaml_parses_with_main_completion_and_manual_run_id_triggers(self):
        parser = subprocess.run(['node', '-e', "const fs = require('fs'); const yaml = require('./desktop/node_modules/js-yaml'); "
                                 "console.log(JSON.stringify(yaml.load(fs.readFileSync(process.argv[1], 'utf8'))));", str(WORKFLOW)],
                                cwd=ROOT, capture_output=True, text=True)
        if 'Cannot find module' in parser.stderr:
            self.skipTest('installed js-yaml unavailable; no packages installed for this test')
        self.assertEqual(parser.returncode, 0, parser.stderr)
        workflow = json.loads(parser.stdout)
        self.assertEqual(workflow['on']['workflow_run'], {'workflows': ['CI · End-to-end on Mac + Linux'], 'types': ['completed'], 'branches': ['main']})
        self.assertTrue(workflow['on']['workflow_dispatch']['inputs']['run_id']['required'])
        self.assertEqual(workflow['permissions'], {'actions': 'read', 'checks': 'read', 'issues': 'write', 'contents': 'read'})
        job = workflow['jobs']['flip']
        self.assertIn("workflow_run.conclusion == 'failure'", job['if'], 'a green run has nothing to say')
        checkout = next(step for step in job['steps'] if step.get('uses', '').startswith('actions/checkout@'))
        self.assertEqual(checkout['with']['ref'], 'main', 'never execute a supplied run SHA with issue-write permissions')

    def test_open_requires_a_named_owner_and_the_workflow_has_one_design_job(self):
        self.assertEqual(re.findall(r'^# Job: (.+)$', self.text, re.M), ['report health'])
        command = next(line for line in self.text.splitlines() if 'node tools/suspend-flip.mjs' in line)
        self.assertIn('--open', command)
        self.assertIn('--run "$RUN_ID"', command)
        self.assertIn('--owner "$OWNER"', command)
        self.assertIn('OWNER: ${{ github.repository_owner }}', self.text)
        self.assertIn('--repo "$GITHUB_REPOSITORY"', command)
        self.assertNotRegex(self.text, r'\b(?:git push|gh pr create)\b')
        self.assertNotIn('actions: write', self.text)
        self.assertIn('cancel-in-progress: false', self.text, 'serialize issue lookups and creation')

    def run_script(self, run):
        """The step's own shell with a fake gh (the run's JSON) and a fake node (records its arguments): -> (exit code, node arguments or None, stdout)."""
        block = self.text.split('      - name: Propose suspension and open its owner issue\n', 1)[1]
        script = textwrap.dedent(block.split('run: |\n', 1)[1])
        self.assertNotIn('${{', script, 'untrusted input reaches shell through env only')
        with tempfile.TemporaryDirectory() as folder:
            tmp = Path(folder)
            (tmp / 'tools').mkdir()
            (tmp / 'tools/suspend-flip.mjs').write_text('// stand-in\n')
            gh = tmp / 'gh'
            gh.write_text(f'#!{sys.executable}\nimport sys\nprint({json.dumps(json.dumps(run))})\n')
            gh.chmod(0o755)
            node = tmp / 'node'
            node.write_text('#!/bin/sh\necho "$@" > "$CALLS"\n')
            node.chmod(0o755)
            env = {**os.environ, 'PATH': f"{tmp}{os.pathsep}{os.environ['PATH']}", 'RUN_ID': '41200878403', 'OWNER': 'GarryOne', 'GITHUB_REPOSITORY': 'example/fixture', 'CALLS': str(tmp / 'calls')}
            done = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', script], env=env, cwd=tmp, capture_output=True, text=True)
            calls = (tmp / 'calls').read_text().strip() if (tmp / 'calls').exists() else None
            return done.returncode, calls, done.stdout + done.stderr

    @unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'the step requires bash and jq')
    def test_only_a_completed_main_check_of_this_repo_is_inspected(self):
        good = {'head_branch': 'main', 'head_repository': {'full_name': 'example/fixture'}, 'path': '.github/workflows/e2e.yml', 'status': 'completed', 'display_title': 'E2E Mac + Linux · apply · main'}
        code, calls, out = self.run_script(good)
        self.assertEqual(code, 0, out)
        self.assertEqual(calls, 'tools/suspend-flip.mjs --run 41200878403 --owner GarryOne --open --repo example/fixture')
        for override in ({'head_branch': 'a8-branch'}, {'head_repository': {'full_name': 'someone/fork'}}, {'path': '.github/workflows/build.yml'}, {'status': 'in_progress'},
                         {'display_title': 'Mutant apply'}, {'display_title': 'RC soak v1'}, {'display_title': 'Bisect apply abc'}, {'display_title': 'E2E check · outside world (real Notion)'}):
            with self.subTest(override=override):
                code, calls, out = self.run_script({**good, **override})
                self.assertEqual(code, 0, out)
                self.assertIsNone(calls, 'nothing is inspected, nothing is opened')
                self.assertIn('No completed main e2e run to inspect.', out)


if __name__ == '__main__':
    unittest.main()
