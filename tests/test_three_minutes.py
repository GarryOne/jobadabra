"""A Find jobs run takes at most its time budget, wall clock (owner, 26 Oct 2026: "A find jobs session should take at most 3min"; runs with
--budget 180 took 12-23 min: the budget stopped only the AI steps, the job boards' extra ways ran one by one after the cut, and the AI steps got
fresh minutes after the crawl). One run of slow fake stages ends inside its budget and lists what is left; then one loop over every stage
(src/time_budget.py STAGES): past the run's time, each only queues its work."""
import io
import json
import sqlite3
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from src import time_budget
from src.sources import aggregators, board_web, boards_ahead, careers, feeds, found_boards, read_budget

BUDGET = 3        # seconds: the app's 180 s, scaled (time_budget.part)
SLACK = 0.6       # a call already running when a stage stops may finish
TABLE = 'CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))'
_READER = careers.READER


def setUpModule():   # no page read reaches a real model here (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def job(key):
    return {'id': str(key), 'title': 'First Officer A320', 'location': 'Vienna, Austria', 'url': f'https://x.test/{key}', 'date_posted': '',
            'description': 'd', 'remote': False, 'salary': ''}


def board(i):
    return {'host': f'b{i}.test', 'name': f'b{i}.test', 'search_url': f'https://b{i}.test/?q={{role}}'}


class Isolated(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.data = Path(tmp.name)
        for patch in (mock.patch('src.paths.DATA', self.data), mock.patch('src.paths.JOBS_DB', self.data / 'jobs.sqlite'),   # the AI answers' cache (decide._db)
                      mock.patch('src.ai.board_ideas.load', return_value={'boards': {}}),
                      mock.patch('src.ai.board_ideas.save'), mock.patch.object(found_boards.board_employers, 'note')):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(time_budget.start, 0)
        self.db = sqlite3.connect(':memory:')
        self.db.execute(TABLE)
        self.addCleanup(self.db.close)


class ARunEndsInItsBudget(Isolated):
    def test_slow_boards_employers_and_apis_end_inside_the_budget_and_what_is_left_is_listed(self):
        def slow_site(source):   # 200 employer sites, a quarter second each, 8 at a time: ~6 s in all
            time.sleep(0.25)
            return [job(source['slug'])]

        def another_way(board, entry, proposed, search, fetch, judge, before, show=None):   # a board's extra ladder: a second each
            time.sleep(1)
            return before

        def slow_api(search):
            time.sleep(1)
            return []
        more = iter([[board(i) for i in range(6, 9)]])   # the web search's boards, found late
        log = io.StringIO()
        with mock.patch.object(found_boards, 'read_board', side_effect=lambda b, *a, **k: ([job(b['host'])], 'ok', None)), \
                mock.patch.object(found_boards, '_another_way', side_effect=another_way), \
                mock.patch.object(board_web, 'start', return_value=None), \
                mock.patch.object(board_web, 'finish', side_effect=lambda *a, **k: next(more, [])), redirect_stdout(log):
            time_budget.start(BUDGET)
            began = time.monotonic()
            ahead = boards_ahead.Ahead({'role_keywords': ['first officer']}, lambda search: found_boards.read(
                search, [board(i) for i in range(6)], fetch=lambda url: '', is_relevant=lambda found: [], dead=set()))
            feeds.scan([{'company': f'Co{i}', 'ats': 'lever', 'slug': f's{i}'} for i in range(200)], self.db, fetcher=slow_site, details={})
            ahead.wait()
            aggregators.scan(self.db, {}, readers=[(f'API {i}', slow_api) for i in range(3)])
            while not time_budget.over('score'):   # the AI steps take what the clock gives them
                time.sleep(0.05)
            took = time.monotonic() - began
        said = log.getvalue()
        self.assertLess(took, BUDGET + SLACK, f'the run took {took:.1f} s of its {BUDGET} s budget')
        left = json.loads((self.data / read_budget.FILE).read_text())['keys']
        self.assertTrue(left, 'the employer sites not reached are kept for the next run')
        for stage in ('job boards', 'free job APIs'):
            self.assertRegex(said, rf'⏱ Time is up \(\d+ min \d\d s\) for {stage}: \d+ .+ waits? for the next search', said[-2000:])


class EveryStageOnlyQueuesPastTheRunsTime(Isolated):
    """Each stage that reads or calls the AI after the budget starts; a new stage goes in time_budget.STAGES and here."""

    def work(self, stage):
        """Run `stage` past the run's time; True when it still did its work (a stage that got past its gate and failed on this test's empty
        setup did too)."""
        did = []
        try:
            self.run_stage(stage, did)
        except AssertionError:
            raise
        except Exception:  # noqa: BLE001
            did.append(1)
        return any(did)

    def run_stage(self, stage, did):
        spy = lambda *a, **k: did.append(1) or []   # noqa: E731
        if stage == 'web search':
            with mock.patch.object(board_web, '_submit', side_effect=spy):
                board_web.start({}, {})
        elif stage == 'job boards':
            with mock.patch.object(found_boards, 'read_board', side_effect=spy), mock.patch.object(board_web, 'start', side_effect=spy):
                found_boards.read({}, [board(0)], fetch=lambda url: '', is_relevant=lambda found: found, dead=set())
        elif stage == 'employer sites':
            feeds.scan([{'company': 'Co', 'ats': 'lever', 'slug': 's'}], self.db, fetcher=lambda source: did.append(1) or [[]], details={})
        elif stage == 'free job APIs':
            aggregators.scan(self.db, {}, readers=[('API', spy)])
        elif stage == 'Google Jobs':
            from src.sources import google_jobs
            google_jobs.scan(self.db, 'key', {'queries': ['pilot']}, opener=spy)
        elif stage == 'job-alert emails':
            from src.sources import job_alerts
            google = mock.Mock()
            job_alerts.scan(self.db, google, client=None)
            did.extend(google.method_calls)
        elif stage == 'descriptions':
            from src.sources import describe
            describe.backfill(self.db, fetcher=spy)   # this test's database has no jobs table: reaching the query is work
        elif stage == 'places':
            did.append(time_budget.in_calls('place_rounds', 100, 60, 2))
        elif stage == 'title sorting':
            did.append(not time_budget.over('titles') or time_budget.local_titles(10))
        elif stage == 'scoring':
            did.append(time_budget.may_score() or time_budget.batch('score', 10))
        elif stage == 'job facts':
            did.append(not time_budget.over('enrich'))
        elif stage == 'kits':
            from src.ai import kit
            with mock.patch.object(kit, 'pending_for_auto', return_value=[{'id': 1}]), mock.patch.object(kit.engine, 'client', side_effect=spy):
                kit.auto_run(self.db, [], mock.Mock(), 'model', 3, 70)
        elif stage == 'employer names':
            from src.sources import board_employers
            board_employers.fill_missing([{'company': 'Unknown employer', 'url': 'https://x.test/1'}], fetch=spy)
        else:
            raise AssertionError(f'{stage}: no check here; add one')

    def test_every_stage_does_no_new_work_once_the_run_is_over(self):
        self.assertEqual(len(time_budget.STAGES), len(set(time_budget.STAGES)))
        for stage in time_budget.STAGES:
            with self.subTest(stage):
                time_budget.start(BUDGET, now=time.monotonic() - BUDGET - 1)   # the run's time is spent; its first 3 scores were not taken
                with redirect_stdout(io.StringIO()):
                    self.assertFalse(self.work(stage), f'{stage} still worked past the run\'s time')

    def test_a_boards_other_ways_stop_at_the_cut_and_are_tried_next_time(self):
        # 26 Oct 2026, the proof run on a copy of the owner's data: a ladder started at 77 s ran to 133 s, past the 90 s cut
        time_budget.start(BUDGET, now=time.monotonic() - BUDGET - 1)
        fetched, entry, before = [], {}, ([job(1)], 'ok', [])
        with redirect_stdout(io.StringIO()):
            got = found_boards._another_way(board(0), entry, board(0)['search_url'], {'role_keywords': ['first officer']},
                                            lambda url: fetched.append(url) or '', lambda found: [], before)
        self.assertEqual((got, fetched), (before, []), 'no page asked past the cut')
        self.assertFalse(found_boards._went_up(entry, board(0)['search_url']), 'the next search goes up the ladder')

    def test_no_floor_starts_an_ai_call_in_the_runs_last_seconds(self):
        # 26 Oct 2026, a proof run at Free AI's pace (12 s a call): local-title calls started at 179 s ended the run at 188 s
        time_budget.start(180, now=0)
        last = 180 - time_budget.TAIL
        self.assertTrue(time_budget.ended(now=last))
        self.assertFalse(time_budget.may_score(now=last), 'the first 3 scores of a search, but not in its last seconds')
        self.assertEqual(time_budget.batch('score', 10, now=last), 0)
        with mock.patch.object(time_budget.time, 'monotonic', return_value=last):
            self.assertEqual(time_budget.local_titles(10), 0, 'the 300 local titles, but not in the last seconds')

    def test_before_the_cut_the_stages_work(self):
        time_budget.start(BUDGET)
        with redirect_stdout(io.StringIO()):
            for stage in ('employer sites', 'title sorting', 'scoring', 'job facts', 'employer names'):
                with self.subTest(stage):
                    self.assertTrue(self.work(stage), stage)


if __name__ == '__main__':
    unittest.main()
