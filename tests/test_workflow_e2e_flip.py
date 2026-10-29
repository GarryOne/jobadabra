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

    def test_attempt_one_downloads_first_try_artifacts_with_read_only_actions_permission(self):
        self.assertNotIn('workflow_run.run_attempt > 1', self.text)
        self.assertIn('actions: read', self.text)
        self.assertNotIn('actions: write', self.text)
        block = re.search(r'      - name: Download first-try artifacts\n(.*?)(?=\n      - )', self.text, re.S)
        self.assertIsNotNone(block, 'attempt 1 needs the first-try artifacts, not only job conclusions')
        self.assertIn("if: steps.attempts.outputs.artifact_patterns != ''", block.group(1))
        self.assertIn('--pattern "$pattern"', block.group(1))
        self.assertIn('gh run download "$RUN_ID"', block.group(1))
        self.assertIn('--repo "$GITHUB_REPOSITORY"', block.group(1))
        self.assertIn('--artifacts "$ARTIFACTS"', self.text)
        self.assertNotIn('--merge', block.group(1), 'keep shard archive names for suite mapping')

    def test_download_step_preserves_shards_and_passes_attempt_one_markers_to_cli(self):
        block = re.search(r'      - name: Download first-try artifacts\n(.*?)(?=\n      - )', self.text, re.S)
        self.assertIsNotNone(block)
        script = textwrap.dedent(block.group(1).split('run: |\n', 1)[1])
        with tempfile.TemporaryDirectory() as folder:
            tmp = Path(folder)
            fake = tmp / 'gh'
            fake.write_text(f'#!{sys.executable}\n' + textwrap.dedent('''\
                import fnmatch, json, os, sys
                from pathlib import Path
                args = sys.argv[1:]
                assert args[:3] == ['run', 'download', '9001'], args
                assert args[args.index('--pattern') + 1] == 'e2e-artifacts-applyflows*', args
                assert args[args.index('--repo') + 1] == 'example/fixture', args
                fixture = json.loads(Path(os.environ['RETRY_FIXTURE']).read_text())
                root = Path(args[args.index('--dir') + 1])
                with (Path(os.environ['RUNNER_TEMP']) / 'downloads').open('a') as log: log.write(json.dumps(args) + '\\n')
                for name, files in fixture['folders'].items():
                    if not fnmatch.fnmatch(name, args[args.index('--pattern') + 1]): continue
                    dest = root / name
                    dest.mkdir()
                    for name, data in files.items(): (dest / name).write_text(json.dumps(data))
            '''))
            fake.chmod(0o755)
            fixture = ROOT / 'desktop/e2e/test/fixtures/suspend-flip-in-job.json'
            (tmp / 'patterns').write_text('e2e-artifacts-applyflows*\n')
            env = {**os.environ, 'PATH': f"{tmp}{os.pathsep}{os.environ['PATH']}", 'RUNNER_TEMP': str(tmp),
                   'GITHUB_OUTPUT': str(tmp / 'output'), 'RUN_ID': '9001', 'GITHUB_REPOSITORY': 'example/fixture', 'RETRY_FIXTURE': str(fixture), 'PATTERNS': str(tmp / 'patterns')}
            done = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', script], env=env, cwd=tmp, capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertEqual(len((tmp / 'downloads').read_text().splitlines()), 1, 'one download per suite')
            artifacts = re.search(r'^folder=(.+)$', (tmp / 'output').read_text(), re.M).group(1)
            self.assertEqual(sorted(path.name for path in Path(artifacts).iterdir()),
                             ['e2e-artifacts-applyflows-1of2', 'e2e-artifacts-applyflows-2of2'])
            (tmp / 'attempts.json').write_text(json.dumps({'attempts': [], 'run': json.loads(fixture.read_text())['run']}))
            (tmp / 'lanes.json').write_text('{"suites": {}}')
            done = subprocess.run(['node', str(ROOT / 'tools/suspend-flip.mjs'), '--attempts', str(tmp / 'attempts.json'),
                                   '--artifacts', artifacts, '--registry', str(tmp / 'lanes.json'), '--owner', 'e2e-owner'], capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertEqual(done.stdout.count('Title: Suspend applyflows:'), 1)
            self.assertIn('Expected saved value 42, got 0', done.stdout)

    def test_no_download_omits_the_empty_artifacts_flag(self):
        block = self.text.split('      - name: Propose suspension and open its owner issue\n', 1)[1]
        script = textwrap.dedent(block.split('run: |\n', 1)[1])
        with tempfile.TemporaryDirectory() as folder:
            tmp = Path(folder)
            (tmp / 'attempts.json').write_text('{"attempts": []}')
            fake = tmp / 'gh'
            fake.write_text(f'#!{sys.executable}\nraise SystemExit("unexpected gh call")\n')
            fake.chmod(0o755)
            env = {**os.environ, 'PATH': f"{tmp}{os.pathsep}{os.environ['PATH']}", 'ATTEMPTS': str(tmp / 'attempts.json'),
                   'ARTIFACTS': '', 'OWNER': 'e2e-owner', 'GITHUB_REPOSITORY': 'example/fixture'}
            done = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', script], env=env, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertIn('No new same-commit retry flips', done.stdout)

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
                   'GITHUB_OUTPUT': str(tmp / 'output'), 'RUN_ID': '9001', 'GITHUB_REPOSITORY': 'example/fixture', 'FLIP_FIXTURE': str(tmp / 'jobs.json')}
            run = {'id': 9001, 'run_attempt': 2, 'head_branch': 'main', 'status': 'completed', 'path': '.github/workflows/e2e.yml',
                   'head_repository': {'full_name': 'example/fixture'}}
            pages = json.loads(FIXTURE.read_text())
            # Two failed shards dedupe; a green suite and a failure only in attempt 2 never download.
            pages['attempts'][0]['jobs'].append({**pages['attempts'][0]['jobs'][0], 'id': 103, 'name': 'apply', 'conclusion': 'success'})
            pages['attempts'][2]['jobs'].append({**pages['attempts'][2]['jobs'][0], 'id': 203, 'name': 'quality', 'conclusion': 'failure'})
            for page in pages['attempts']: page['total_count'] = 3
            for override, expected_attempts in (({}, 2), ({'run_attempt': 1}, 1), ({'first_green': True}, 2), ({'head_branch': 'pr'}, 0),
                                                ({'path': '.github/workflows/build.yml'}, 0), ({'status': 'in_progress'}, 0),
                                                ({'head_repository': {'full_name': 'someone/fork'}}, 0)):
                with self.subTest(override=override):
                    first_green = override.get('first_green', False)
                    for page in pages['attempts'][:2]: page['jobs'][0]['conclusion'] = 'success' if first_green else 'failure'
                    (tmp / 'jobs.json').write_text(json.dumps(pages))
                    (tmp / 'run.json').write_text(json.dumps({**run, **{key: value for key, value in override.items() if key != 'first_green'}}))
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
                        self.assertEqual(len(collected['attempts']), 2 * expected_attempts, 'both pages of each attempt survive')
                        self.assertEqual(collected['run']['id'], 9001)
                        patterns = re.search(r'^artifact_patterns=(.+)$', output, re.M)
                        if first_green:
                            self.assertIsNone(patterns, 'no failed attempt-1 jobs: skip artifact download')
                        else:
                            self.assertIsNotNone(patterns, 'failed shards need their suite artifacts')
                            self.assertEqual(Path(patterns.group(1)).read_text().splitlines(), ['e2e-artifacts-settings*'])
                        (tmp / 'lanes.json').write_text('{"suites": {}}')
                        proposal = subprocess.run(['node', str(ROOT / 'tools/suspend-flip.mjs'), '--attempts', str(attempts_file),
                                                   '--registry', str(tmp / 'lanes.json'), '--owner', 'e2e-owner'], capture_output=True, text=True)
                        self.assertEqual(proposal.returncode, 0, proposal.stderr)
                        self.assertEqual(proposal.stdout.count('Title: Suspend settings:'), int(expected_attempts > 1 and not first_green))
                    else:
                        self.assertNotIn('attempts=', (tmp / 'output').read_text())


if __name__ == '__main__':
    unittest.main()
