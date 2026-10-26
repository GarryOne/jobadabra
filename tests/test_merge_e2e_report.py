"""A broken HTML report never decides a run (gate runs 40054602771 and 40058169671, 24 Oct 2026: 34/34 suites green, run red on a corrupt blob zip)."""
import os
import re
import stat
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'tools/merge-e2e-report.sh'
WORKFLOWS = ROOT / '.github/workflows'


def corrupt_zip(path):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_STORED) as z:
        z.writestr('report.jsonl', 'x' * 400)
    data = bytearray(path.read_bytes()); data[60] ^= 0xFF   # inside the stored entry: its CRC no longer matches
    path.write_bytes(bytes(data))


@unittest.skipIf(os.name == 'nt', 'bash script run on Linux runners')
class MergeReportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.blobs = self.tmp / 'blobs'; self.blobs.mkdir()
        bin_dir = self.tmp / 'bin'; bin_dir.mkdir()
        npx = bin_dir / 'npx'   # a fake npx: records the folder it was given, fails when told to
        npx.write_text('#!/usr/bin/env bash\nls "${@: -1}" > "$FAKE_NPX_SAW"\n[ -z "$FAKE_NPX_FAIL" ]\n'); npx.chmod(npx.stat().st_mode | stat.S_IEXEC)
        self.output = self.tmp / 'output.txt'; self.saw = self.tmp / 'saw.txt'
        self.env = {**os.environ, 'PATH': f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', 'GITHUB_OUTPUT': str(self.output), 'FAKE_NPX_SAW': str(self.saw)}

    def good_zip(self, name):
        with zipfile.ZipFile(self.blobs / name, 'w') as z: z.writestr('report.jsonl', 'ok')

    def run_script(self, **env):
        return subprocess.run(['bash', str(SCRIPT), str(self.blobs), str(self.tmp / 'out')], env={**self.env, **env}, capture_output=True, text=True, timeout=60)

    def read(self, p): return p.read_text() if p.exists() else ''

    def test_a_corrupt_blob_is_left_out_and_named_and_the_rest_is_merged(self):
        self.good_zip('report-a.zip'); corrupt_zip(self.blobs / 'report-bad.zip')
        done = self.run_script()
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn('report-bad.zip', done.stdout)
        self.assertIn('made=1', self.read(self.output))
        self.assertNotIn('report-bad.zip', self.read(self.saw), 'the merge never sees the corrupt zip')
        self.assertIn('report-a.zip', self.read(self.saw))

    def test_a_merge_that_still_fails_leaves_the_job_green_and_says_so(self):
        self.good_zip('report-a.zip')
        done = self.run_script(FAKE_NPX_FAIL='1')
        self.assertEqual(done.returncode, 0)
        self.assertNotIn('made=1', self.read(self.output))
        self.assertIn('could not be merged', done.stdout)

    def test_only_corrupt_blobs_is_still_green(self):
        corrupt_zip(self.blobs / 'report-bad.zip')
        done = self.run_script()
        self.assertEqual(done.returncode, 0)
        self.assertIn('No readable suite report', done.stdout)


class WorkflowsUseTheScriptTest(unittest.TestCase):
    def test_every_report_merge_goes_through_the_script(self):
        for path in sorted(WORKFLOWS.glob('*.yml')):
            text = re.sub(r'#.*', '', path.read_text())
            self.assertNotIn('playwright merge-reports', text, f'{path.name}: merge through tools/merge-e2e-report.sh, so a corrupt blob never turns a green run red')
        users = [p.name for p in WORKFLOWS.glob('*.yml') if 'tools/merge-e2e-report.sh' in p.read_text()]
        self.assertEqual(sorted(users), ['desktop.yml', 'e2e-windows.yml', 'e2e.yml'])


if __name__ == '__main__':
    unittest.main()
