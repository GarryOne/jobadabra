"""The old workflow file names (renamed 14 Oct 2026: control > page > site) are not referenced, except where an earlier run is still read (until 28 Oct 2026)."""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RETIRED = ('widget-zoo.yml', 'recorded-pages.yml', 'replay-pr.yml', 'replay-offline.yml', 'replay-verify.yml')
# Files that read the old names on purpose, with their removal date in a comment; docs/superpowers keeps dated history; this file names them.
READS_OLD_RUNS = {'worker/src/scheduler.js', 'worker/test/scheduler.test.js', 'worker/test/watchdog.test.js', 'desktop/e2e/replay-baseline.sh', 'desktop/e2e/ci-alert.mjs',
                  'desktop/e2e/test/ci-alert.test.mjs', 'tools/red-main.sh', '.github/workflows/site-replays.yml', '.github/workflows/page-cases.yml',
                  'tests/test_replays_site_workflow.py', 'tests/test_retired_workflow_names.py', 'docs/rules/why.md'}


class RetiredWorkflowNames(unittest.TestCase):
    def test_no_file_names_a_retired_workflow_except_the_readers_of_old_runs(self):
        found = set()
        for name in RETIRED:
            out = subprocess.run(['git', 'grep', '-lI', '-F', name, '--', '.', ':!docs/superpowers'], cwd=ROOT, capture_output=True, text=True).stdout.split()
            found |= set(out)
        self.assertEqual(sorted(found - READS_OLD_RUNS), [], 'a retired workflow name is still referenced (new names: control-tests, page-cases, site-replays, fix-verdicts)')


if __name__ == '__main__':
    unittest.main()
