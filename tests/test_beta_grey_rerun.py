# Prove the beta's single fresh-runner retry from attempt-tagged hold artifacts, without network.
import io
import json
import re
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from tools import beta_grey_rerun as rerun

ROOT = Path(__file__).resolve().parents[1]


class GreyRerun(unittest.TestCase):
    def test_only_first_grey_attempt_with_no_red_reruns(self):
        grey = {'attempt': 1, 'grey': ['Mac + Linux: apply'], 'red': []}
        self.assertEqual(rerun.decision(1, [grey]), ('rerun', ['Mac + Linux: apply']))
        self.assertEqual(rerun.decision(1, [grey, grey])[0], 'rerun')
        self.assertEqual(rerun.decision(2, [{**grey, 'attempt': 2}])[0], 'held')
        for attempt, reports in [(1, []), (1, [{**grey, 'red': ['Windows: settings']}]),
                                 (1, [{**grey, 'grey': []}]), (1, [grey, {'attempt': 1}]),
                                 (2, [grey]), (3, [{**grey, 'attempt': 3}]),
                                 (1, [{**grey, 'grey': 'apply'}])]:
            with self.subTest(attempt=attempt, reports=reports):
                self.assertEqual(rerun.decision(attempt, reports)[0], 'stop')

    def test_cli_reruns_each_annotation_proven_grey_job_by_id_once(self):
        def archive(report):
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w') as out:
                out.writestr('beta-held.json', json.dumps(report))
            return buffer.getvalue()
        def execute(attempt, red=None, proven=True, second_grey=False):
            calls = []
            report = {'attempt': attempt, 'grey': ['Mac + Linux: apply'], 'red': red or []}
            def github(*args, binary=False):
                calls.append(args)
                if '/artifacts?' in str(args):
                    return json.dumps([{'artifacts': [{'id': 12, 'name': 'beta-held-mac'}, {'id': 13, 'name': 'e2e-artifacts-apply'}]}])
                if args[-1].endswith('/12/zip'):
                    return archive(report)
                if '/jobs?' in str(args):
                    return json.dumps([{'jobs': [{'id': 21, 'name': 'E2E · Mac + Linux · apply', 'conclusion': 'success'},
                                                {'id': 22, 'name': 'E2E · Windows · settings', 'conclusion': 'success'}]}])
                if '/annotations?' in str(args):
                    return json.dumps([[{'title': 'Grey: the runner, not the app'}]] if proven and ('/21/' in str(args) or second_grey) else [[]])
                if args[:2] == ('run', 'rerun'):
                    return ''
                self.fail(f'unexpected GitHub call: {args}')
            output = io.StringIO()
            with patch('sys.stdout', output):
                self.assertEqual(rerun.main(['--repo', 'o/r', '--run', '99', '--attempt', str(attempt)], github=github), 0)
            return calls, output.getvalue()
        calls, _ = execute(1)
        self.assertEqual([call for call in calls if call[:2] == ('run', 'rerun')], [('run', 'rerun', '99', '--job', '21', '--repo', 'o/r')])
        calls, _ = execute(1, second_grey=True)
        self.assertEqual([call[4] for call in calls if call[:2] == ('run', 'rerun')], ['21', '22'])
        calls, _ = execute(1, proven=False)
        self.assertFalse(any(call[:2] == ('run', 'rerun') for call in calls), 'artifact labels alone cannot prove a grey job')
        for attempt, red in [(1, ['Windows: settings']), (2, [])]:
            calls, output = execute(attempt, red)
            self.assertFalse(any(call[:2] == ('run', 'rerun') for call in calls))
            if attempt == 2:
                self.assertIn('::notice::Beta held: grey twice on fresh runners (Mac + Linux: apply): the runner, not the app', output)

    def test_successful_grey_job_is_held_by_release_before_approval(self):
        from tools import beta_rate_gate as gate
        import tempfile
        jobs = [{'id': 21, 'name': 'E2E · Mac + Linux · apply', 'conclusion': 'success'},
                {'id': 22, 'name': 'E2E · Windows · apply', 'conclusion': 'success'}]
        def github(*args):
            return json.dumps([[{'title': 'Grey: the runner, not the app'}]] if '/21/' in str(args) else [[]])
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'beta-held.json'
            gate.backbone_check('o/r', jobs, {}, github, output=output)
            self.assertEqual(json.loads(output.read_text()), {'attempt': 1, 'grey': ['Mac + Linux: apply'], 'red': []})
        text = (ROOT / '.github/workflows/desktop.yml').read_text()
        for platform in ('mac', 'windows'):
            job = text.split(f'  release-{platform}:', 1)[1].split('\n  # Keep the release', 1)[0]
            gate_step = next(step for step in job.split('      - ') if '--e2e-only' in step)
            self.assertNotIn('if: needs.test-', gate_step)
            self.assertIn('id: backbone_gate', gate_step)
            self.assertIn('continue-on-error: true', gate_step)
            approval = next(step for step in job.split('      - ') if 'name: Release it to ' in step)
            self.assertIn("if: steps.backbone_gate.outputs.held != 'true'", approval)

    def test_fresh_attempt_can_replace_existing_suite_and_release_artifacts(self):
        workflow = (ROOT / '.github/workflows/desktop.yml').read_text().split('  test-mac:', 1)[1]
        uploads = [block for block in re.split(r'(?m)^      - ', workflow) if 'uses: actions/upload-artifact@' in block]
        self.assertGreaterEqual(len(uploads), 12)
        for block in uploads:
            self.assertIn('overwrite: true', block)
        windows = workflow.split('  test-windows:', 1)[1].split('  release-mac:', 1)[0]
        self.assertIn('            e2e-rerun/windows-${{ matrix.key }}', windows)
        self.assertIn('          path: e2e-rerun/windows-${{ matrix.key }}', windows)

    def test_workflow_reads_main_completed_desktop_runs_with_only_requested_permissions(self):
        workflow = (ROOT / '.github/workflows/beta-grey-rerun.yml').read_text()
        self.assertIn("workflows: ['Release · Build, test, beta']", workflow)
        self.assertIn('types: [completed]', workflow)
        self.assertIn('branches: [main]', workflow)
        self.assertIn('head_repository.full_name == github.repository', workflow)
        permissions = workflow.split('permissions:\n')[1].split('\n\n')[0]
        self.assertEqual(permissions.splitlines(), ['  actions: write', '  contents: read'])
        self.assertIn('python3 tools/beta_grey_rerun.py', workflow)
        self.assertIn('github.event.workflow_run.run_attempt', workflow)


if __name__ == '__main__':
    unittest.main()
