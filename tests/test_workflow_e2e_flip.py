"""Retry-flip workflow contract and offline execution of its paginated attempt collector."""
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
FIXTURE = ROOT / 'desktop/e2e/test/fixtures/suspend-flip-sharded.json'


class E2eFlipWorkflow(unittest.TestCase):
    def setUp(self):
        self.assertTrue(WORKFLOW.exists(), 'a completed e2e rerun needs its flip workflow')
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
        self.assertEqual(workflow['permissions'], {'actions': 'read', 'issues': 'write', 'contents': 'read'})
        checkout = next(step for step in workflow['jobs']['flip']['steps'] if step.get('uses', '').startswith('actions/checkout@'))
        self.assertEqual(checkout['with']['ref'], 'main', 'never execute a supplied run SHA with issue-write permissions')

    def test_open_requires_a_named_owner_and_the_workflow_has_one_design_job(self):
        self.assertEqual(re.findall(r'^# Job: (.+)$', self.text, re.M), ['report health'])
        command = next(line for line in self.text.splitlines() if 'node tools/suspend-flip.mjs' in line)
        self.assertIn('--open', command)
        self.assertIn('--owner "$OWNER"', command)
        self.assertIn('OWNER: ${{ github.repository_owner }}', self.text)
        self.assertIn('--repo "$GITHUB_REPOSITORY"', command)
        self.assertNotRegex(self.text, r'\b(?:git push|gh pr create)\b')
        self.assertIn('cancel-in-progress: false', self.text, 'serialize issue lookups and creation')

    @unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'collector requires bash and jq')
    def test_collector_reads_all_attempts_and_pages_and_refuses_other_runs(self):
        block = re.search(r'      - name: Collect every attempt\n(.*?)(?=\n      - )', self.text, re.S).group(1)
        script = textwrap.dedent(block.split('run: |\n', 1)[1])
        self.assertNotIn('${{', script, 'untrusted input reaches shell through env only')
        with tempfile.TemporaryDirectory() as folder:
            tmp = Path(folder)
            (tmp / 'bin').mkdir()
            fake = tmp / 'bin/gh'
            fake.write_text(f'#!{sys.executable}\n' + textwrap.dedent('''\
                import json, os, sys
                from pathlib import Path
                args = sys.argv[1:]
                tmp = Path(os.environ['RUNNER_TEMP'])
                with (tmp / 'calls').open('a') as log: log.write(json.dumps(args) + '\\n')
                run = json.loads((tmp / 'run.json').read_text())
                if args[:2] == ['api', 'repos/example/fixture/actions/runs/9001']:
                    print(json.dumps(run))
                elif args[0] == 'api' and '/attempts/' in args[1]:
                    assert '--paginate' in args and '--slurp' in args, args
                    attempt = int(args[1].split('/attempts/')[1].split('/')[0])
                    pages = json.loads(Path(os.environ['FLIP_FIXTURE']).read_text())['attempts']
                    print(json.dumps([page for page in pages if page['jobs'][0]['run_attempt'] == attempt]))
                else: sys.exit(2)
            '''))
            fake.chmod(0o755)
            env = {**os.environ, 'PATH': f"{tmp / 'bin'}{os.pathsep}{os.environ['PATH']}", 'RUNNER_TEMP': str(tmp),
                   'GITHUB_OUTPUT': str(tmp / 'output'), 'RUN_ID': '9001', 'GITHUB_REPOSITORY': 'example/fixture', 'FLIP_FIXTURE': str(FIXTURE)}
            run = {'run_attempt': 2, 'head_branch': 'main', 'status': 'completed', 'path': '.github/workflows/e2e.yml',
                   'head_repository': {'full_name': 'example/fixture'}}
            for override, expected_attempts in (({}, 2), ({'run_attempt': 1}, 0), ({'head_branch': 'pr'}, 0),
                                                ({'path': '.github/workflows/build.yml'}, 0), ({'status': 'in_progress'}, 0),
                                                ({'head_repository': {'full_name': 'someone/fork'}}, 0)):
                with self.subTest(override=override):
                    (tmp / 'run.json').write_text(json.dumps({**run, **override}))
                    (tmp / 'calls').write_text('')
                    (tmp / 'output').write_text('')
                    done = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', script], env=env, cwd=tmp, capture_output=True, text=True)
                    self.assertEqual(done.returncode, 0, done.stderr)
                    calls = [json.loads(line) for line in (tmp / 'calls').read_text().splitlines()]
                    self.assertEqual(sum('/attempts/' in args[1] for args in calls), expected_attempts)
                    if expected_attempts:
                        output = (tmp / 'output').read_text()
                        attempts_file = Path(re.search(r'^attempts=(.+)$', output, re.M).group(1))
                        collected = json.loads(attempts_file.read_text())
                        self.assertEqual(len(collected['attempts']), 4, 'both pages of each attempt survive')
                        (tmp / 'lanes.json').write_text('{"suites": {}}')
                        proposal = subprocess.run(['node', str(ROOT / 'tools/suspend-flip.mjs'), '--attempts', str(attempts_file),
                                                   '--registry', str(tmp / 'lanes.json'), '--owner', 'e2e-owner'], capture_output=True, text=True)
                        self.assertEqual(proposal.returncode, 0, proposal.stderr)
                        self.assertEqual(proposal.stdout.count('Title: Suspend settings:'), 1)
                    else:
                        self.assertNotIn('attempts=', (tmp / 'output').read_text())


if __name__ == '__main__':
    unittest.main()
