"""E2E uploads fail closed on fake credentials in files, nested traces, or unreadable archives."""
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SCANNER = ROOT / 'tools/scan-e2e-artifacts.py'


class ArtifactSecretsTests(unittest.TestCase):
    def scan(self, folder, **extra):
        env = {'PATH': os.environ.get('PATH', ''), 'E2E_ARTIFACT_SECRETS': json.dumps({'E2E_NOTION_TOKEN_APPLY': 'fake-notion-secret-123456'}), **extra}
        result = subprocess.run(['python3', str(SCANNER), str(folder)], env=env, capture_output=True, text=True)
        self.assertNotIn('fake-notion-secret-123456', result.stdout + result.stderr)
        return result

    def test_trace_with_secret_fails_and_names_only_variable_and_file(self):
        with tempfile.TemporaryDirectory() as folder:
            with zipfile.ZipFile(Path(folder) / 'trace-apply.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('trace.trace', json.dumps({'env': {'E2E_NOTION_TOKEN_APPLY': 'fake-notion-secret-123456'}}))
            result = self.scan(folder)
            self.assertEqual(result.returncode, 1)
            self.assertIn('E2E_NOTION_TOKEN_APPLY', result.stdout)
            self.assertIn('trace-apply.zip', result.stdout)

    def test_nested_zip_and_runtime_token_are_scanned(self):
        with tempfile.TemporaryDirectory() as folder:
            inner = io.BytesIO()
            with zipfile.ZipFile(inner, 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('trace.trace', 'fake-runtime-token-123456')
            with zipfile.ZipFile(Path(folder) / 'blob.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('trace.zip', inner.getvalue())
            result = self.scan(folder, ACTIONS_ID_TOKEN_REQUEST_TOKEN='fake-runtime-token-123456')
            self.assertEqual(result.returncode, 1)
            self.assertIn('ACTIONS_ID_TOKEN_REQUEST_TOKEN', result.stdout)
            self.assertNotIn('fake-runtime-token-123456', result.stdout + result.stderr)

    def test_clean_and_missing_folders_pass(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'steps.json').write_text('{"status":"passed"}')
            self.assertEqual(self.scan(folder).returncode, 0)
            self.assertEqual(self.scan(Path(folder) / 'missing').returncode, 0)

    def test_broken_zip_fails_without_exception_content(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'trace.zip').write_text('fake-notion-secret-123456')
            self.assertEqual(self.scan(folder).returncode, 1)

    def test_every_e2e_upload_has_a_successful_scan_guard(self):
        import re
        for name in ('e2e.yml', 'e2e-windows.yml', 'desktop.yml'):
            text = (ROOT / '.github/workflows' / name).read_text()
            steps = re.split(r'(?m)^      - ', text)
            for index, step in enumerate(steps):
                if 'uses: actions/upload-artifact@' not in step:
                    continue
                if not re.search(r'name: (?:e2e-|blob-|ai-answers-|windows-screens-|mac-screens-)', step):
                    continue
                with self.subTest(workflow=name, upload=index):
                    self.assertRegex(step, r"steps\.artifact_scan_\d+\.outcome == 'success'")
                    self.assertIn('scan-e2e-artifacts.py', steps[index - 1])
                    self.assertIn('toJSON(secrets)', steps[index - 1])

    def test_review_uploads_require_the_scan_and_callers_supply_all_secrets(self):
        action = (ROOT / '.github/actions/e2e-review/action.yml').read_text()
        self.assertIn("steps.artifact_scan_cost.outcome == 'success'", action)
        self.assertIn("steps.artifact_scan_findings.outcome == 'success'", action)
        for name in ('e2e.yml', 'e2e-windows.yml', 'desktop.yml'):
            text = (ROOT / '.github/workflows' / name).read_text()
            self.assertEqual(text.count('uses: ./.github/actions/e2e-review'), text.count('artifact-secrets: ${{ toJSON(secrets) }}'), name)

    def test_scanner_handles_binary_and_escaped_values_without_showing_them(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'log.bin').write_bytes('fake-notion-secret-123456'.encode('utf-16-le'))
            self.assertEqual(self.scan(folder).returncode, 1)

    def test_sparse_report_and_coverage_checkouts_include_the_scanner(self):
        import re
        for name, job in (('e2e.yml', 'coverage-map'), ('e2e.yml', 'report'), ('e2e-windows.yml', 'report')):
            text = (ROOT / '.github/workflows' / name).read_text()
            # Select by sparse checkout where job names differ between the two lanes.
            sparse = re.findall(r'(?ms)^          sparse-checkout: \|\n((?:            [^\n]*\n)+)', text)
            checked = [block for block in sparse if 'desktop/e2e\n' in block]
            self.assertTrue(checked, (name, job))
            for block in checked:
                self.assertTrue('tools/scan-e2e-artifacts.py' in block or '            tools\n' in block, name)

    def test_generated_lock_credentials_reach_every_suite_upload_scan(self):
        import re
        for name in ('e2e.yml', 'e2e-windows.yml', 'desktop.yml'):
            text = (ROOT / '.github/workflows' / name).read_text()
            for job in re.split(r'(?m)(?=^  [\w-]+:\n)', text):
                if '        id: lock_app\n' in job:
                    for step in re.split(r'(?m)^      - ', job):
                        if 'id: artifact_scan_' in step:
                            self.assertIn('E2E_LOCK_TOKEN: ${{ steps.lock_app.outputs.token }}', step, name)
