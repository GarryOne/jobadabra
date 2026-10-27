"""A first Find jobs press reads its fast sources inside its 3 minutes, whatever its AI set-up takes (27 Oct 2026, the search benchmark: 6 fresh
personas found 0-2 jobs where the 20 Oct round found 49-1,459; the set-up's AI calls ran to 38 s, the run waited 28 s for its web search,
and the slice's boards and the free job APIs were asked at 80-94 s, past the read cut of 67 s, so "wait for the next search" meant nothing
this time). The class: every fast source starts with the search (src/daily_search.py early_reads), and what it read is kept past the cut;
the stage that feeds the FLOOR scores (title sorting) is not starved by an earlier slow one (the quality suite on Free AI, same day)."""
import io
import sqlite3
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from src import daily_search, first_jobs, time_budget
from src.sources import aggregators, board_web, read_budget

BUDGET = 3   # the app's 180 s, scaled (time_budget.part): the read cut is at 1.5 s


def job(key):
    return {'id': key, 'title': 'Truck driver', 'location': 'Sofia, Bulgaria', 'url': f'https://x.test/{key}', 'date_posted': '',
            'description': 'd', 'remote': False, 'salary': '', 'company': 'Co'}


class Isolated(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(daily_search, 'DATA', Path(tmp.name)),
                      mock.patch.object(daily_search, 'load_search_config', return_value={'role_keywords': ['driver']})):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(time_budget.start, 0)
        self.addCleanup(aggregators._asked.clear)
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)


class FastSourcesStartWithTheSearch(Isolated):
    def press(self, api_seconds):
        """A first press whose AI set-up runs past the read cut; -> (the slice's board jobs, the API scan's report, the log)."""
        started = {}

        def boards(say, search):
            started['boards'] = time.monotonic()
            time.sleep(0.2)
            return [job('board')]

        def api(search):
            started['api'] = time.monotonic()
            time.sleep(api_seconds)
            return [job('api')]
        log = io.StringIO()
        with mock.patch.object(first_jobs, 'board_jobs', side_effect=boards), mock.patch.object(board_web, 'early') as web, \
                mock.patch.object(aggregators, 'sources', return_value=[('API', api)]), \
                mock.patch.object(aggregators, 'kept', side_effect=lambda db, name, found, now=None: found), redirect_stdout(log):
            time_budget.start(BUDGET)
            began = time.monotonic()
            slice_boards = daily_search.early_reads(slice_first=True, full_read=True)
            time.sleep(time_budget.part(read_budget.READ_SECONDS + read_budget.READ_GRACE) + 0.1)   # the set-up: past the read cut
            self.assertTrue(read_budget.past_cut())
            found = slice_boards(print)
            report = aggregators.scan(self.db, {'role_keywords': ['driver']})
        web.assert_called_once()
        for source, at in started.items():
            self.assertLess(at - began, 0.3, f'{source} started with the search, not after its set-up')
        return found, report, log.getvalue()

    def test_a_slow_set_up_still_leaves_the_slices_boards_and_the_free_apis_read(self):
        found, report, said = self.press(api_seconds=0.2)
        self.assertEqual([j['id'] for j in found], ['board'], said)
        self.assertEqual([j['id'] for j in report['jobs']], ['api'], said)
        self.assertNotIn('for free job APIs', said, 'what was read before the cut is kept, not queued')

    def test_an_api_still_reading_at_the_cut_waits_for_the_next_search(self):
        _, report, said = self.press(api_seconds=3)
        self.assertEqual(report['jobs'], [])
        self.assertRegex(said, r'⏱ Time is up \(\d+ min \d\d s\) for free job APIs: 1 source waits for the next search')

    def test_no_slice_no_early_board_read(self):
        with mock.patch.object(first_jobs, 'begin') as begin, mock.patch.object(board_web, 'early'), \
                mock.patch.object(aggregators, 'sources', return_value=[]):
            self.assertIsNone(daily_search.early_reads(slice_first=False, full_read=True))
            self.assertIsNone(daily_search.early_reads(slice_first=True, full_read=False))
        begin.assert_not_called()

    def test_the_search_starts_them_before_its_set_up_and_reads_its_slice_before_the_web_searchs_boards(self):
        source = (Path(__file__).resolve().parents[1] / 'src' / 'daily_search.py').read_text()
        body = source[source.index('def search('):]
        self.assertLess(body.index('early_reads('), body.index('scout.active_sources('), 'the fast sources start before the employers\' AI set-up')
        self.assertLess(body.index('first_jobs.run('), body.index('boards_first.web_boards('), 'a first press never waits for the web search before its slice')
        self.assertIn('boards=slice_boards', body)


class TheTitlesThatFeedTheFirstScoresAreSorted(unittest.TestCase):
    def setUp(self):
        from src import run_counts
        run_counts.reset()
        self.addCleanup(run_counts.reset)
        self.addCleanup(time_budget.start, 0)
        # inside scoring's share (its last part(60) s), not yet at the run's end (part(TAIL) before it)
        time_budget.start(BUDGET, now=time.monotonic() - BUDGET * 130 / time_budget.PLANNED)   # 130 s of the app's 180
        self.assertTrue(time_budget._scorings() and not time_budget.ended())

    def test_one_batch_of_local_titles_is_sorted_while_no_score_started(self):
        self.assertEqual(time_budget.local_titles(10), 10)
        self.assertEqual(time_budget.local_titles(100), time_budget.FEED - 10, 'one batch, not the whole floor')
        self.assertEqual(time_budget.local_titles(10), 0)

    def test_none_once_the_first_score_started(self):
        self.assertTrue(time_budget.may_score())
        self.assertEqual(time_budget.local_titles(10), 0)

    def test_none_once_the_search_has_a_job_to_score(self):
        from src import run_counts
        with redirect_stdout(io.StringIO()):
            run_counts.matched([{'url': 'https://x.test/1'}])
        self.assertEqual(time_budget.local_titles(10), 0)


if __name__ == '__main__':
    unittest.main()
