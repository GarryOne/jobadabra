"""The central scout's publish path end to end with every network piece replaced (seconds, no CI run): the checks, the board pass, the publish.
Why: 24 Oct 2026 the board pass was merged without ever running its path; CI showed it silently skipped (the checks used all the time) and a first fix
used a name before its import. This drives scout.main's --publish-index branch, so both would have failed here. Skill: check-central-scout-locally."""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from src import scout, scout_boards, scout_core, scout_overrun, trial


class PublishPathTest(unittest.TestCase):
    def run_main(self, board_run):
        feed = {'company': 'Acme', 'ats': 'greenhouse', 'slug': 'acme', 'countries': ['ch'], 'jobs': 3}
        seen = {}

        def build_index(db, sources, **kwargs):
            seen['check_deadline'] = kwargs['deadline']
            return [feed], []
        patches = [mock.patch.dict(os.environ, {'INDEX_PUBLISH_KEY': 'k', 'JOB_PILOTTO_INDEX_URL': 'http://127.0.0.1:1/api/index',
                                             'JOB_STARTED_AT': str(int(time.time()) - 20 * 60)}),   # the job began 20 min ago: the publish deadline is near, as in a slow run
                   mock.patch.object(scout, 'employer_store', lambda: None), mock.patch.object(scout, 'synced_key', lambda stores: False), mock.patch.object(trial, 'pause_run', lambda *a, **k: False),
                   mock.patch.object(scout, 'run', lambda *a, **k: ({}, [])), mock.patch.object(scout, 'telegram_summary', lambda *a, **k: 'summary'),
                   mock.patch.object(scout, 'fetch_contributions', lambda *a, **k: ([], {})),
                   mock.patch.object(scout.employer_index, 'fresh_nofeed', lambda dead: {}),
                   mock.patch.object(scout, 'build_index', build_index),
                   mock.patch.object(scout, 'market_coverage', lambda *a, **k: []),
                   mock.patch.object(scout, 'central_stats', lambda *a, **k: {'market': []}),
                   mock.patch.object(scout, 'fetch_boards', lambda *a, **k: []), mock.patch.object(scout, 'board_stats', lambda *a, **k: []),
                   mock.patch.object(scout, 'publish_index', lambda feeds, *a, **k: seen.setdefault('board_facts', k.get('board_facts')) or len(feeds)),
                   mock.patch.object(scout, 'publish_summary', lambda *a, **k: 'summary'), mock.patch.object(scout, 'dead_ends', lambda *a, **k: []),
                   mock.patch.object(scout, 'run_record', lambda *a, **k: {}),
                   mock.patch.object(scout_boards, 'run', board_run),
                   mock.patch.object(scout_overrun, 'arm', lambda *a, **k: None)]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(setattr, scout_core, 'CENTRAL', scout_core.CENTRAL)
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(sys, 'argv', ['scout', '--batch', '1', '--publish-index', '--db', str(Path(tmp) / 'jobs.sqlite')]):
            scout.main()
        return seen

    def test_the_run_reaches_the_publish_and_gives_the_board_pass_its_time(self):
        calls = []
        seen = self.run_main(lambda db, **kwargs: calls.append(kwargs) or [])
        self.assertEqual(len(calls), 1, 'the board pass ran once')
        self.assertLessEqual(seen['check_deadline'], calls[0]['until'] - scout_boards.RESERVE_S + 1,
                             'the feed checks end RESERVE_S before the pass must have started')


if __name__ == '__main__':
    unittest.main()
