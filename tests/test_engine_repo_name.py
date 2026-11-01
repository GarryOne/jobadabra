"""The engine repo is GarryOne/jobadabra since 24 Oct 2026: no tracked file names the old slug, except dated specs (history)."""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OLD = re.compile(r'GarryOne\\?/' + 'job-pilotto' + r'(?![\w-])')   # also the escaped regex form GarryOne\/...
# Dated specs are history; the app's own test feeds an old-name workflow file to prove the app rewrites it.
ALLOWED = ('docs/superpowers/specs/', 'desktop/test/engine-repo.test.js')


class EngineRepoNameTests(unittest.TestCase):
    def test_no_file_names_the_old_engine_repo(self):
        files = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split('\n')
        hits = []
        for name in files:
            if not name or name.startswith(ALLOWED):
                continue
            try:
                text = (ROOT / name).read_text(encoding='utf-8')
            except (UnicodeDecodeError, OSError):
                continue
            hits += [f'{name}:{n}' for n, line in enumerate(text.split('\n'), 1) if OLD.search(line)]
        self.assertEqual(hits, [], 'say GarryOne/jobadabra (the old name only redirects, and a workflow `uses:` is not redirected)')


if __name__ == '__main__':
    unittest.main()
