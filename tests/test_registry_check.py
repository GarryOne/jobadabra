"""tools/registry-check.py (18 Oct 2026): a new tools/ script a lock test uses but LOCK_PATHS lacks (and a workflow missing from a registry) fails the fast checks of a push, naming the file and the line to edit, not ~10 minutes later in CI."""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK = (ROOT / 'tools' / 'pre-push-check.sh').read_text(encoding='utf-8')


class RegistryCheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.copy = self.tmp / 'repo'
        ignore = shutil.ignore_patterns('__pycache__', 'node_modules')
        for folder in ('tools', 'tests', 'docs', '.github'):
            shutil.copytree(ROOT / folder, self.copy / folder, ignore=ignore)

    def check(self):
        run = subprocess.run([sys.executable, str(self.copy / 'tools' / 'registry-check.py'), str(self.copy)], capture_output=True, text=True, timeout=120)
        return run.returncode, run.stdout

    def test_the_repo_passes_as_it_is(self):
        self.assertEqual(self.check(), (0, ''))

    def test_a_new_tool_a_lock_test_names_must_be_a_lock_path(self):
        (self.copy / 'tools' / 'brand-new-tool.sh').write_text('#!/bin/sh\n')
        helper = self.copy / 'tests' / 'heavy_wait.py'
        helper.write_text(helper.read_text(encoding='utf-8') + "\nNEW = 'brand-new-tool.sh'\n", encoding='utf-8')
        code, out = self.check()
        self.assertEqual(code, 1)
        self.assertIn('tools/brand-new-tool.sh', out)
        self.assertRegex(out, r'\(tools/py-shards\.py:\d+\)')
        shards = self.copy / 'tools' / 'py-shards.py'
        shards.write_text(shards.read_text(encoding='utf-8').replace("LOCK_PATHS = ('", "LOCK_PATHS = ('tools/brand-new-tool.sh', '", 1), encoding='utf-8')
        self.assertEqual(self.check(), (0, ''))

    def test_a_workflow_no_registry_knows_fails_naming_the_registries(self):
        (self.copy / '.github' / 'workflows' / 'brand-new.yml').write_text('name: CI · Brand new\non: workflow_dispatch\njobs: {}\n', encoding='utf-8')
        code, out = self.check()
        self.assertEqual(code, 1)
        self.assertIn('Brand new', out)
        self.assertIn('CLASSIFIED', out)

    def test_the_pull_request_push_runs_it_before_it_stops(self):
        run = HOOK.index('tools/registry-check.py')
        self.assertLess(run, HOOK.index('A push to a pull request branch (tools/ship.sh'))


if __name__ == '__main__':
    unittest.main()
