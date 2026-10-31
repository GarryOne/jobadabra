"""A test module must leave the run-wide title cache (feeds.TRIAGED) as it found it: the shards run many modules in one process.
Why (31 Oct 2026, a8): test_sources_follow_strategy ran the real feeds.triage, which marks the whole process as "the AI title sort ran" (feeds.ASKED in feeds.TRIAGED);
test_feed_facts, run after it in the same process, then lost the jobs it expected (red on CI order only, green alone). The pair is replayed in a child process the way a shard runs it.
The child never includes this module, so the replay cannot start itself."""
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FOLLOWERS = ('tests.test_sources_follow_strategy', 'tests.test_feed_facts')


class TitleCacheBetweenModulesTest(unittest.TestCase):
    def test_feed_facts_still_passes_after_the_module_that_runs_the_title_sort(self):
        done = subprocess.run([sys.executable, '-m', 'unittest', '-q', *FOLLOWERS], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr[-1500:])


if __name__ == '__main__':
    unittest.main()
