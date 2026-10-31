"""E2E uploads fail closed on fake credentials in files, nested traces, or unreadable archives."""
import importlib.util
import io
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SCANNER = ROOT / 'tools/scan-e2e-artifacts.py'


def workflow_jobs(text):
    """Read job blocks by YAML indentation without requiring packages in Python-only CI."""
    jobs = text.split('\njobs:\n', 1)[1]
    parts = re.split(r'(?m)^  ([A-Za-z_][\w-]*):\n', jobs)
    return zip(parts[1::2], parts[2::2])


def env_mappings(text):
    """Read direct YAML env mappings by indentation, retaining their first consumer expression."""
    result = {}
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
            mapping = re.match(rf' {{{indent + 2}}}([A-Za-z_][\w]*):\s*(.*)', child)
            if mapping:
                result.setdefault(mapping[1], mapping[2].split(' #', 1)[0].strip())
    return result


def credential_refs(value):
    """Compare credential provenance by reference, never by a real credential value."""
    return set(re.findall(r'\b(?:secrets\.[\w]+|github\.token|steps\.[\w-]+\.outputs\.token)', value))


def job_scan_names(job):
    """One job-owned list is inherited by each scan, including composites."""
    head = job.split('    steps:', 1)[0]
    found = re.search(r'(?m)^      E2E_ARTIFACT_SECRET_NAMES: \|\n((?:        [^\n]*\n)*)', head)
    if not found:
        return set()
    lines = [line.strip() for line in found[1].splitlines()]
    return {line for line in lines if re.fullmatch(r'[A-Z_][A-Z_0-9]*', line)} | set(re.findall(r"'([A-Z_][A-Z_0-9]*)'", found[1]))


def local_actions(job):
    """Resolve local composite env consumers through only the inputs that this job supplies."""
    actions = []
    for step in re.split(r'(?m)^      - ', job):
        found = re.search(r'uses: \./(?:[\w.-]+/)*(\.github/actions/[\w-]+)', step)
        if not found:
            continue
        action = (ROOT / found[1] / 'action.yml').read_text()
        for target in set(re.findall(r'inputs\.([\w-]+)', action)):
            binding = re.search(rf'(?m)^          {re.escape(target)}: (.*)$', step)
            if binding:
                action = action.replace('${{ inputs.' + target + ' }}', binding[1])
        actions.append(action)
    return '\n'.join(actions)


def scan_contract(job, action=''):
    """Require list coverage, readable values, and no new credential reference granted by a scan."""
    steps = re.split(r'(?m)^      - ', job)
    consumers = ''.join(step for step in steps if 'id: artifact_scan_' not in step)
    action_steps = re.split(r'(?m)^    - ', action)
    consumers += ''.join(step for step in action_steps if 'id: artifact_scan_' not in step)
    original = {name: value for name, value in env_mappings(consumers).items() if credential_refs(value)}
    allowed = set().union(*(credential_refs(value) for value in original.values())) if original else set()
    inherited = env_mappings(job.split('    steps:', 1)[0])
    native = set()
    if 'id-token: write' in job:
        native.add('ACTIONS_ID_TOKEN_REQUEST_TOKEN')
    if re.search(r'uses: \./(?:[\w.-]+/)*\.github/actions/free-ai-relay\b', job):
        native.add('E2E_FREE_AI_KEY')   # that existing action publishes the generated key through GITHUB_ENV
    required = set(original) | native
    listed = job_scan_names(job)
    problems = [f'missing list name: {name}' for name in sorted(required - listed)]
    for step in steps:
        if not re.search(r'uses: \./(?:[\w.-]+/)*\.github/actions/free-ai-relay\b', step):
            continue
        condition = re.search(r'(?m)^        if: (.*)$', step)
        if condition:
            expression = condition[1].split(' #', 1)[0].strip().removeprefix('${{').removesuffix('}}').strip()
            expected = "${{ " + expression + " && 'E2E_FREE_AI_KEY' || '' }}"
            if expected not in job.split('    steps:', 1)[0]:
                problems.append('generated key condition differs from its producer: E2E_FREE_AI_KEY')
    scans = [step for step in steps + action_steps if 'id: artifact_scan_' in step]
    for step in scans:
        supplied = env_mappings(step)
        effective = {**inherited, **supplied}
        for name, value in supplied.items():
            if credential_refs(value) - allowed:
                problems.append(f'scan grants unrelated credential: {name}')
        for name in sorted(listed - native):
            if name not in effective:
                problems.append(f'scan cannot read: {name}')
            elif name in original and credential_refs(original[name]) - credential_refs(effective[name]):
                problems.append(f'scan changed credential source: {name}')
    return problems


def scan_tool_problems(job):
    """Every scan runs main's tool: through the workflow's own checkout wherever the job may check out another ref."""
    steps = re.split(r'(?m)^      - ', job)
    refs, lock_tools = [], False
    for step in steps:
        if 'uses: actions/checkout@' not in step:
            continue
        ref = re.search(r'(?m)^          ref: (.*?)(?:\s+#.*)?$', step)
        refs.append(ref[1].strip() if ref else '')
        sparse = re.search(r'(?ms)^          sparse-checkout: \|\n((?:            [^\n]*\n)+)', step)
        listed = sparse[1].split() if sparse else []
        if 'path: lock-tools' in step and ref and ref[1].strip() == '${{ github.sha }}':
            lock_tools = not sparse or 'tools/scan-e2e-artifacts.py' in listed or 'tools' in listed
    other_ref = any(ref not in ('', '${{ github.sha }}') for ref in refs)
    problems = []
    for line in re.findall(r'(?m)^\s*run: python3? .*scan-e2e-artifacts\.py.*$', job):
        own = 'lock-tools/tools/scan-e2e-artifacts.py' in line
        if own and not lock_tools:
            problems.append(f'no lock-tools checkout of this workflow\'s commit that holds the scanner: {line.strip()}')
        if not own and (other_ref or any('path: lock-tools' in step for step in steps)):
            problems.append(f'runs the scanner from the job\'s workspace, which may be another ref: {line.strip()}')
    return problems


class ArtifactSecretsTests(unittest.TestCase):
    def scan(self, folder, **extra):
        env = {'PATH': os.environ.get('PATH', ''), 'E2E_ARTIFACT_SECRET_NAMES': 'E2E_NOTION_TOKEN_APPLY\nACTIONS_ID_TOKEN_REQUEST_TOKEN', 'E2E_NOTION_TOKEN_APPLY': 'fake-notion-secret-123456', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN': 'fake-runtime-token-123456', **extra}
        result = subprocess.run(['python3', str(SCANNER), str(folder)], env=env, capture_output=True, text=True)
        self.assertNotIn('fake-notion-secret-123456', result.stdout + result.stderr)
        self.assertNotIn('fake-runtime-token-123456', result.stdout + result.stderr)
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

    def test_nested_trace_with_many_members_is_decompressed_once(self):
        # Why (31 Oct 2026, personas runs 41167629768/41169971636): a ZipFile opened on a nested ZipExtFile decompressed
        # the inner zip from its start on every member seek, so a long run's blob-report scan hung for 17+ minutes.
        spec = importlib.util.spec_from_file_location('scan_e2e_artifacts', SCANNER)
        scanner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(scanner)
        inner = io.BytesIO()
        with zipfile.ZipFile(inner, 'w', zipfile.ZIP_DEFLATED) as archive:
            for index in range(300):
                archive.writestr(f'resources/{index}.png', os.urandom(4000))
        with tempfile.TemporaryDirectory() as folder:
            with zipfile.ZipFile(Path(folder) / 'report.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('trace.zip', inner.getvalue())
            decompressed = []
            real_read1 = zipfile.ZipExtFile._read1
            def counting_read1(stream, n):
                data = real_read1(stream, n)
                decompressed.append(len(data))
                return data
            with mock.patch.object(zipfile.ZipExtFile, '_read1', counting_read1):
                found = scanner.Scanner({'E2E_NOTION_TOKEN_APPLY': 'fake-notion-secret-123456'})
                found.paths([folder])
        self.assertFalse(found.failed)
        self.assertLess(sum(decompressed), 4 * (len(inner.getvalue()) + 300 * 4000))

    def test_clean_and_missing_folders_pass(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'steps.json').write_text('{"status":"passed"}')
            self.assertEqual(self.scan(folder).returncode, 0)
            self.assertEqual(self.scan(Path(folder) / 'missing').returncode, 0)

    def test_unfinished_zip_is_removed_and_good_evidence_still_passes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'app.log').write_text('fictional app log')
            (root / 'steps.json').write_text('{"status":"failed"}')
            with zipfile.ZipFile(root / 'good.zip', 'w') as archive:
                archive.writestr('snapshot.txt', 'fictional snapshot')
            broken = root / 'trace-apply-6.zip'
            broken.write_bytes(b'PK\x03\x04unfinished trace without central directory')
            result = self.scan(root)
            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertFalse(broken.exists(), 'nothing unreadable remains in the upload')
            self.assertIn('not uploaded: unreadable,', result.stdout)
            self.assertIn('trace-apply-6.zip', result.stdout)
            self.assertEqual(sorted(file.name for file in root.iterdir()), ['app.log', 'good.zip', 'steps.json'])

    def test_complete_blob_with_unfinished_nested_trace_is_removed(self):
        # The failed job attached a trace after stop timed out, then finished its blob reporter normally.
        with tempfile.TemporaryDirectory() as folder:
            blob = Path(folder) / 'apply.zip'
            with zipfile.ZipFile(blob, 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('report.jsonl', '{"result":"failed"}')
                archive.writestr('resources/trace.zip', b'PK\x03\x04unfinished nested trace')
            with zipfile.ZipFile(blob) as archive:
                self.assertIsNone(archive.testzip(), 'the outer blob is a complete, readable ZIP')
            result = self.scan(folder)
            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertFalse(blob.exists())
            self.assertIn('not uploaded: unreadable,', result.stdout)
            self.assertIn('apply.zip', result.stdout)

    def test_unreadable_file_that_cannot_be_removed_still_blocks_upload(self):
        spec = importlib.util.spec_from_file_location('scan_e2e_artifacts', SCANNER)
        scanner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(scanner)
        with tempfile.TemporaryDirectory() as folder:
            broken = Path(folder) / 'unfinished.zip'
            broken.write_bytes(b'PK\x03\x04unfinished')
            found = scanner.Scanner({})
            with mock.patch.object(Path, 'unlink', side_effect=PermissionError('private exception')), mock.patch('builtins.print') as output:
                found.paths([folder])
            self.assertTrue(found.failed)
            self.assertTrue(broken.exists())
            self.assertIn('SCAN_ERROR', str(output.call_args_list))
            self.assertNotIn('private exception', str(output.call_args_list))

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

    def test_scan_runs_the_workflows_own_tool(self):
        """Why (31 Oct 2026, stable canary 41202570730): the suite job checks out an older tag with no scanner; 15 suites went red on \"can't open file\"."""
        checked = 0
        for workflow in ('e2e.yml', 'e2e-windows.yml', 'desktop.yml'):
            text = (ROOT / '.github/workflows' / workflow).read_text()
            for name, job in workflow_jobs(text):
                if 'scan-e2e-artifacts.py' not in job:
                    continue
                self.assertEqual(scan_tool_problems(job), [], f'{workflow}/{name}')
                checked += 1
        self.assertGreaterEqual(checked, 12)

    def test_scan_tool_guard_rejects_the_canary_shape(self):
        old_ref = """    steps:
      - uses: actions/checkout@v5
        with:
          ref: ${{ needs.plan.outputs.ref }}
      - uses: actions/checkout@v5
        with:
          ref: ${{ github.sha }}
          path: lock-tools
          sparse-checkout: |
            tools/e2e-lock.sh
            tools/scan-e2e-artifacts.py
      - id: artifact_scan_1
        run: python "$GITHUB_WORKSPACE/tools/scan-e2e-artifacts.py"
"""
        self.assertEqual(len(scan_tool_problems(old_ref)), 1)
        fixed = old_ref.replace('WORKSPACE/tools/scan', 'WORKSPACE/lock-tools/tools/scan')
        self.assertEqual(scan_tool_problems(fixed), [])
        no_tool = fixed.replace('            tools/scan-e2e-artifacts.py\n', '')
        self.assertEqual(len(scan_tool_problems(no_tool)), 1)
        default_ref = "    steps:\n      - uses: actions/checkout@v5\n      - run: python tools/scan-e2e-artifacts.py\n"
        self.assertEqual(scan_tool_problems(default_ref), [])

    def test_no_repository_wide_secret_context_or_input_is_restored(self):
        for file in ('.github/actions/e2e-review/action.yml', '.github/workflows/e2e.yml', '.github/workflows/e2e-windows.yml', '.github/workflows/desktop.yml'):
            text = (ROOT / file).read_text()
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

    def test_missing_and_empty_named_values_fail_with_names_only(self):
        with tempfile.TemporaryDirectory() as folder:
            for extra in ({}, {'REQUIRED': ''}):
                result = self.scan(folder, E2E_ARTIFACT_SECRET_NAMES='REQUIRED', **extra)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout.strip(), 'REQUIRED')
                self.assertEqual(result.stderr, '')

    def test_short_values_are_skipped_by_name_and_eight_characters_are_scanned(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'log.txt').write_text('short12')
            result = self.scan(folder, E2E_ARTIFACT_SECRET_NAMES='SHORT', SHORT='short12')
            self.assertEqual(result.returncode, 0)
            self.assertIn('SKIPPED_SHORT: SHORT', result.stdout)
            self.assertNotIn('short12', result.stdout)
            (Path(folder) / 'log.txt').write_text('eight123')
            self.assertEqual(self.scan(folder, E2E_ARTIFACT_SECRET_NAMES='EIGHT', EIGHT='eight123').returncode, 1)

    def test_job_with_no_credential_environment_can_declare_an_empty_list(self):
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run(['python3', str(SCANNER), folder], env={'PATH': os.environ.get('PATH', ''), 'E2E_ARTIFACT_SECRET_NAMES': ''}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0)

    def test_every_job_covers_and_supplies_its_credentials_without_new_grants(self):
        checked = 0
        for workflow in ('e2e.yml', 'e2e-windows.yml', 'desktop.yml'):
            text = (ROOT / '.github/workflows' / workflow).read_text()
            for name, job in workflow_jobs(text):
                if 'uses: actions/upload-artifact@' not in job and 'uses: ./.github/actions/e2e-review' not in job:
                    continue
                self.assertEqual(job.count('E2E_ARTIFACT_SECRET_NAMES:'), 1, f'{workflow}/{name}: one job-owned list')
                self.assertEqual(scan_contract(job, local_actions(job)), [], f'{workflow}/{name}')
                checked += 1
        self.assertGreaterEqual(checked, 10)

    def test_same_job_mapping_is_allowed_but_a_planted_unrelated_secret_is_rejected(self):
        job = """    env:
      E2E_ARTIFACT_SECRET_NAMES: |
        FIRST
        ALIAS
      FIRST: ${{ secrets.ONE }}
    steps:
      - name: original consumer
        env:
          ALIAS: ${{ secrets.TWO }}
        run: echo done
      - name: scan
        id: artifact_scan_1
        env:
          ALIAS: ${{ secrets.TWO }}
        run: python scan-e2e-artifacts.py
"""
        self.assertEqual(scan_contract(job), [])
        planted = job.replace('        run: python scan-e2e-artifacts.py', '          PLANTED: ${{ secrets.NOT_USED_BY_JOB }}\n        run: python scan-e2e-artifacts.py')
        self.assertIn('scan grants unrelated credential: PLANTED', scan_contract(planted))
        missing = job.replace('          ALIAS: ${{ secrets.TWO }}\n        run: python', '        run: python')
        self.assertIn('scan cannot read: ALIAS', scan_contract(missing))
