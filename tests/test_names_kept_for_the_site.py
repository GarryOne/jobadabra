"""No public test file takes a name the private site repo owns (docs/site-test-names.json): in CI's joined tree it would replace or be replaced."""
# 24 Oct 2026 (test_workflow_pipefail), web#151 and 26 Oct 2026 (web#163 test_workflow_app_client_id): a site test at a public test's path
# turned web main red, and only after both sides merged, because a public PR cannot see the site's names. With disjoint prefixes, neither can collide.
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAMES = json.loads((ROOT / 'docs' / 'site-test-names.json').read_text(encoding='utf-8'))['folders']


def tracked(folder):
    """This repo's tracked files under `folder`, as paths relative to it (forward slashes, also on Windows)."""
    out = subprocess.run(['git', 'ls-files', '--', folder], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [line[len(folder) + 1:] for line in out.splitlines() if line]


class NamesKeptForTheSiteTests(unittest.TestCase):
    def test_the_list_names_every_folder_the_site_check_compares(self):
        # tools/site-guards.sh (site repo) compares these folders: a folder missing here would have no rule
        self.assertEqual(sorted(NAMES), ['desktop/e2e/test', 'desktop/test', 'test', 'tests'])

    def test_no_public_file_starts_with_a_site_prefix(self):
        taken = [f'{folder}/{name}' for folder, prefixes in NAMES.items() for name in tracked(folder)
                 if any(name.startswith(prefix) for prefix in prefixes)]
        self.assertEqual(taken, [], 'these names belong to the site repo (docs/site-test-names.json): rename the public file')

    def test_the_check_sees_files_here(self):
        self.assertIn('site_private.py', tracked('tests'))


if __name__ == '__main__':
    unittest.main()
