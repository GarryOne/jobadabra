"""E2E uploads fail closed on fake credentials in files, nested traces, or unreadable archives."""
import io
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SCANNER = ROOT / 'tools/scan-e2e-artifacts.py'


def workflow_jobs(text):
    """Read job blocks by YAML indentation without requiring packages in Python-only CI."""
    jobs = text.split('\njobs:\n', 1)[1]
    parts = re.split(r'(?m)^  ([A-Za-z_][\w-]*):\n', jobs)
    return zip(parts[1::2], parts[2::2])


def secret_env_names(text):
    """Collect env aliases for direct secrets.X mappings at both job and step scopes."""
    names = set()
    lines = text.splitlines()
    for index, line in enumerate(lines):
        found = re.fullmatch(r'(\s*)env:', line)
        if not found:
            continue
        indent = len(found[1])
        for child in lines[index + 1:]:
            if not child.strip() or child.lstrip().startswith('#'):
                continue
            if len(child) - len(child.lstrip()) <= indent:
                break
            mapping = re.match(r'\s*([A-Za-z_][\w]*):\s*(.*)', child)
            if mapping and re.search(r'\$\{\{[^}]*\bsecrets\.[A-Za-z_][\w]*', mapping[2].split(' #', 1)[0]):
                names.add(mapping[1])
    return names


def job_scan_names(job):
    """The one scanner-name list belongs to job env and is inherited by each scan process."""
    head = job.split('    steps:', 1)[0]
    found = re.search(r'(?m)^      E2E_ARTIFACT_SECRET_NAMES: \|\n((?:        [A-Za-z_][\w]*\n)+)', head)
    return set(found[1].split()) if found else set()


class ArtifactSecretsTests(unittest.TestCase):
    def scan(self, folder, **extra):
        env = {'PATH': os.environ.get('PATH', ''), 'E2E_ARTIFACT_SECRET_NAMES': 'E2E_NOTION_TOKEN_APPLY\nACTIONS_ID_TOKEN_REQUEST_TOKEN', 'E2E_NOTION_TOKEN_APPLY': 'fake-notion-secret-123456', **extra}
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
                    self.assertNotIn('toJSON(secrets)', steps[index - 1])

    def test_review_scans_inherit_the_callers_name_list_without_secret_inputs(self):
        action = (ROOT / '.github/actions/e2e-review/action.yml').read_text()
        self.assertIn("steps.artifact_scan_cost.outcome == 'success'", action)
        self.assertIn("steps.artifact_scan_findings.outcome == 'success'", action)
        self.assertNotIn('artifact-secrets', action)
        for step in re.split(r'(?m)^    - ', action):
            if 'id: artifact_scan_' in step:
                self.assertEqual(re.findall(r'(?m)^        ([A-Z_0-9]+):', step), ['E2E_ARTIFACT_PATHS'])
        for name in ('e2e.yml', 'e2e-windows.yml', 'desktop.yml'):
            text = (ROOT / '.github/workflows' / name).read_text()
            self.assertNotIn('toJSON(secrets)', text)
            self.assertNotIn('artifact-secrets:', text)

    def test_scanner_handles_binary_and_escaped_values_without_showing_them(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'log.bin').write_bytes('fake-notion-secret-123456'.encode('utf-16-le'))
            self.assertEqual(self.scan(folder).returncode, 1)

    def test_sparse_report_and_coverage_checkouts_include_the_scanner(self):
        for name, job in (('e2e.yml', 'coverage-map'), ('e2e.yml', 'report'), ('e2e-windows.yml', 'report')):
            text = (ROOT / '.github/workflows' / name).read_text()
            # Select by sparse checkout where job names differ between the two lanes.
            sparse = re.findall(r'(?ms)^          sparse-checkout: \|\n((?:            [^\n]*\n)+)', text)
            checked = [block for block in sparse if 'desktop/e2e\n' in block]
            self.assertTrue(checked, (name, job))
            for block in checked:
                self.assertTrue('tools/scan-e2e-artifacts.py' in block or '            tools\n' in block, name)

    def test_scanner_reads_only_named_environment_variables(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'log.txt').write_text('fake-unlisted-secret-123456')
            result = self.scan(folder, UNLISTED_TOKEN='fake-unlisted-secret-123456')
            self.assertEqual(result.returncode, 0)
            result = self.scan(folder, UNLISTED_TOKEN='fake-unlisted-secret-123456', E2E_ARTIFACT_SECRET_NAMES='UNLISTED_TOKEN')
            self.assertEqual(result.returncode, 1)
            self.assertIn('UNLISTED_TOKEN', result.stdout)
            self.assertNotIn('fake-unlisted-secret-123456', result.stdout + result.stderr)

    def test_short_or_unset_named_values_are_skipped_and_empty_list_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'log.txt').write_text('short12')
            self.assertEqual(self.scan(folder, E2E_ARTIFACT_SECRET_NAMES='SHORT\nUNSET', SHORT='short12').returncode, 0)
            self.assertEqual(self.scan(folder, E2E_ARTIFACT_SECRET_NAMES='').returncode, 1)
            (Path(folder) / 'log.txt').write_text('eight123')
            self.assertEqual(self.scan(folder, E2E_ARTIFACT_SECRET_NAMES='EIGHT', EIGHT='eight123').returncode, 1)

    def test_job_scan_names_cover_every_secret_backed_env_mapping(self):
        checked = 0
        for workflow in ('e2e.yml', 'e2e-windows.yml', 'desktop.yml'):
            text = (ROOT / '.github/workflows' / workflow).read_text()
            for name, job in workflow_jobs(text):
                if 'uses: actions/upload-artifact@' not in job and 'uses: ./.github/actions/e2e-review' not in job:
                    continue
                expected = secret_env_names(job)
                if 'uses: ./.github/actions/e2e-review' in job:
                    # Resolve the composite's existing secret inputs to the env aliases its consumers use.
                    action = (ROOT / '.github/actions/e2e-review/action.yml').read_text()
                    for alias, input_name in re.findall(r'(?m)^        (\w+): \$\{\{ inputs\.([\w-]+) \}\}', action):
                        if re.search(rf'(?m)^          {re.escape(input_name)}: .*secrets\.', job):
                            expected.add(alias)
                declared = job_scan_names(job)
                self.assertFalse(expected - declared, f'{workflow}/{name}: missing scanner env names: {sorted(expected - declared)}')
                self.assertTrue(declared, f'{workflow}/{name}: missing job-owned scanner name list')
                self.assertEqual(job.count('E2E_ARTIFACT_SECRET_NAMES:'), 1, f'{workflow}/{name}: one job-owned name list')
                scans = [step for step in re.split(r'(?m)^      - ', job) if 'id: artifact_scan_' in step]
                for step in scans:
                    # A scanner inherits the job list; it must not inject any extra credential values.
                    self.assertFalse(secret_env_names(step), f'{workflow}/{name}: scanner grants a secret')
                    self.assertNotIn('E2E_LOCK_TOKEN:', step)
                    self.assertNotIn('GH_TOKEN:', step)
                    self.assertEqual(re.findall(r'(?m)^          ([A-Z_0-9]+):', step), ['E2E_ARTIFACT_PATHS'], f'{workflow}/{name}: scanner env must contain paths only')
                checked += 1
        self.assertGreaterEqual(checked, 10)

    def test_job_parser_includes_step_env_and_detects_missing_names(self):
        job = """    env:
      E2E_ARTIFACT_SECRET_NAMES: |
        FIRST
      FIRST: ${{ secrets.ONE }}
    steps:
      - name: original credential consumer
        env:
          ALIAS: ${{ secrets.TWO }}
          PUBLIC: ${{ vars.SOMETHING }}
        run: echo done
"""
        self.assertEqual(secret_env_names(job), {'FIRST', 'ALIAS'})
        self.assertEqual(secret_env_names(job) - job_scan_names(job), {'ALIAS'})
