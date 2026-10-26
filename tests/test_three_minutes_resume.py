"""A Find jobs run that hits its 3 minutes stops softly and the next one resumes without redoing anything (owner, 26 Oct 2026: "will this be
a hard stop? We want a soft stop. And next one to continue/start properly without redoing the same job"). One loop over every stage
(src/time_budget.py STAGES): run 1 is cut, run 2 starts fresh; per stage, what run 1 finished is kept (a read or AI call open at the cut ends
and its answer is kept, src/sources/late_reads.py), what it did not reach is queued, and run 2 redoes none of run 1's work.
JP_SHOW_TABLE=1 prints the kept / queued / redone table."""
import io
import json
import os
import sys
import threading
import time
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock

from src import time_budget
from src.sources import aggregators, board_web, careers, feeds, found_boards, late_reads, read_budget
from tests import test_three_minutes as three
from tests.test_three_minutes import BUDGET, Isolated, board, job

_READER = careers.READER


def setUpModule():   # no page read reaches a real model here (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def wait_for(condition, seconds=6.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if condition():
            return True
        time.sleep(0.05)
    return False


def kept_late(kind, key):
    try:
        return key in (json.loads((late_reads._file()).read_text()).get(kind) or {})
    except (OSError, ValueError):
        return False


class Counting:
    """A fake AI client: answers every call, counts what it was asked (titles, locations, jobs)."""
    def __init__(self, answer):
        self.asked, self.answer, self.lock = [], answer, threading.Lock()
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        content = kwargs['messages'][0]['content']
        lines = [line.split('. ', 1)[1] for line in content.split(':\n', 1)[-1].split('\n') if '. ' in line] or [content.split('\n', 1)[0]]
        with self.lock:
            self.asked += lines
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(self.answer(lines)))],
                               usage=SimpleNamespace(input_tokens=1, output_tokens=1, cache_read_input_tokens=0))


class ARunResumesWhereTheLastOneStopped(Isolated):
    def two_runs(self, stage):
        """(kept by run 1, queued for run 2, redone by run 2) for `stage`; each a set of work items."""
        return getattr(self, 'stage_' + stage.replace(' ', '_').replace('-', '_'))()

    def stage_employer_sites(self):
        started = {1: [], 2: []}
        run, slow, lock = [1], [], threading.Lock()
        slow_done = threading.Event()

        def fetcher(source):
            with lock:
                started[run[0]].append(source['slug'])
                if not slow:   # the first site read is still being read at the cut, however busy the machine
                    slow.append(source['slug'])
            time.sleep(3 if source['slug'] == slow[0] and run[0] == 1 else 0.3)
            if source['slug'] == slow[0]:
                slow_done.set()
            return [job(source['slug'])]
        sites = [{'company': f'Co{i}', 'ats': 'lever', 'slug': f's{i}'} for i in range(10)]
        with mock.patch.object(feeds, 'FETCH_WORKERS', 2), mock.patch.object(read_budget, 'READ_FLOOR', 0):
            time_budget.start(BUDGET)
            feeds.scan(sites, self.db, fetcher=fetcher, details={})
            self.assertTrue(wait_for(lambda: slow_done.is_set() and kept_late('employer', f'lever:{slow[0]}')), 'the open site ended and was kept')
            run[0] = 2
            time_budget.start(60)
            feeds.scan(sites, self.db, fetcher=fetcher, details={})
        self.assertEqual(set(started[1]) | set(started[2]), {s['slug'] for s in sites}, 'every site read once in the two runs')
        return set(started[1]), set(started[2]), set(started[1]) & set(started[2])

    def stage_job_boards(self):
        reads, ladders, run = {1: [], 2: []}, {1: [], 2: []}, [1]
        store = {'boards': {}}

        def read_board(b, *a, **k):
            reads[run[0]].append(b['host'])
            time.sleep({'b3.test': 3, 'b4.test': 1.2}.get(b['host'], 0))   # b3: open at the cut; b4: read, its other ways due past it
            return [job(b['host'])], 'ok', None

        def another_way(b, entry, proposed, search, fetch, judge, before, show=None):
            ladders[run[0]].append(b['host'])
            return before
        boards = [board(i) for i in range(6)]
        relevant = lambda found: [j for j in found if j['id'] != 'b4.test']   # noqa: E731 — b4 gives no job in your roles: its ladder is due
        with mock.patch('src.ai.board_ideas.load', return_value=store), mock.patch.object(found_boards, 'read_board', side_effect=read_board), \
                mock.patch.object(found_boards, '_another_way', side_effect=another_way):
            time_budget.start(BUDGET)
            found_boards.read({}, boards, fetch=lambda url: '', is_relevant=relevant, dead=set(), web=False)
            self.assertTrue(wait_for(lambda: kept_late('board', 'b3.test')), 'b3 ended and was kept')
            self.assertEqual(ladders[1], [], 'no other way started past the cut')
            run[0] = 2
            time_budget.start(60)
            found_boards.read({}, boards, fetch=lambda url: '', is_relevant=relevant, dead=set(), web=False,
                              since=datetime.now(timezone.utc) - timedelta(hours=6))   # as boards_ahead.start: the same search within its spacing
        self.assertEqual(ladders[2], ['b4.test'], "run 2 goes up b4's ladder from run 1's page")
        done1 = set(reads[1])
        return done1, set(reads[2]) | {f'{h} ladder' for h in ladders[2]}, done1 & set(reads[2])

    def stage_web_search(self):
        store, asked = {'boards': {}}, []
        answered = threading.Event()

        def search():
            asked.append(1)
            time.sleep(0.4)
            copy['web'] = {'pilots': 'now'}
            copy['ideas'] = {'pilots': [{**board(9), 'origin': 'web'}]}
            answered.set()
            return [board(9)]
        copy = {}
        from concurrent.futures import ThreadPoolExecutor
        with mock.patch('src.ai.board_ideas.load', return_value=store), mock.patch('src.ai.board_ideas.save', side_effect=store.update):
            time_budget.start(BUDGET, now=time.monotonic() - BUDGET)   # past the cut when the read asks for the answer
            future = ThreadPoolExecutor(max_workers=1).submit(search)
            with redirect_stdout(io.StringIO()):
                self.assertEqual(board_web.finish((future, copy), [], data=store), [])
            self.assertTrue(wait_for(lambda: answered.is_set() and 'pilots' in (store.get('web') or {})), 'its answer was kept when it came')
        self.assertIn('b9.test', {b['host'] for b in store['ideas']['pilots']}, 'its boards are proposed to the next search')
        return {'search'}, {'its boards read'}, set()   # the stamp in store['web'] makes the next search read them, not search again

    def stage_free_job_APIs(self):
        reads = {1: [], 2: []}
        readers = [(f'API {i}', lambda search, i=i, run=None: reads[self.run].append(i) or []) for i in range(3)]
        self.run = 1
        time_budget.start(BUDGET, now=time.monotonic() - BUDGET)
        aggregators.scan(self.db, {}, readers=readers)
        self.run = 2
        time_budget.start(60)
        aggregators.scan(self.db, {}, readers=readers)
        return set(reads[1]), set(reads[2]), set(reads[1]) & set(reads[2])

    def queued_only(self, stage):
        """A stage that starts nothing past the cut: run 1 does nothing of it, run 2 reaches its work."""
        work = three.EveryStageOnlyQueuesPastTheRunsTime(methodName='run')
        work.db = self.db
        time_budget.start(BUDGET, now=time.monotonic() - BUDGET - 1)
        first = work.work(stage)
        time_budget.start(0)   # the next search, with its own time
        second = work.work(stage)
        self.assertTrue(second, f'{stage}: the next search does it')
        return set() if not first else {stage}, {stage}, set()

    def stage_Google_Jobs(self):
        return self.queued_only('Google Jobs')

    def stage_job_alert_emails(self):
        return self.queued_only('job-alert emails')

    def stage_descriptions(self):
        return self.queued_only('descriptions')

    def stage_kits(self):
        return self.queued_only('kits')

    def stage_employer_names(self):
        return self.queued_only('employer names')

    def ai_runs(self, ask, client, k):
        """Run 1 cut after `k` AI calls (its in-flight calls end and are kept), run 2 with its own time: (asked in 1, asked in 2)."""
        calls = []
        original = client.messages.create
        client.messages.create = lambda **kw: calls.append(1) or original(**kw)
        time_budget.start(180)
        with mock.patch.object(time_budget, '_over', side_effect=lambda step, now: len(calls) >= k), mock.patch.object(time_budget, 'FLOOR', 0):
            ask()
        first = list(client.asked)
        time_budget.start(0)
        ask()
        return first, client.asked[len(first):]

    def stage_title_sorting(self):
        from src.ai import title_triage
        titles = [f'Engineer {n}' for n in range(90)]
        client = Counting(lambda lines: {'fit': [1]})
        with mock.patch.object(title_triage, 'STORE', self.data / 't.json'), mock.patch('src.ai.engine.PARALLEL', 1):
            first, second = self.ai_runs(lambda: title_triage.decide(titles, {'role_keywords': ['pilot'], 'title_exclude_keywords': []}, client), client, 1)
        self.assertEqual(len(set(first) | set(second)), 90)
        return set(first), set(second), set(first) & set(second)

    def stage_places(self):
        from src.ai import place_triage
        places = [f'Town {n}, Austria' for n in range(90)]
        client = Counting(lambda lines: {'locations': [{'n': n, 'answer': 'out'} for n in range(1, len(lines) + 1)]})
        with mock.patch.object(place_triage, 'STORE', self.data / 'p.json'), mock.patch('src.geo.verdicts', return_value={}), \
                mock.patch('src.ai.engine.PARALLEL', 1), mock.patch.object(time_budget, 'in_calls', side_effect=lambda step, n, *a, **k: n):
            first, second = self.ai_runs(lambda: place_triage.decide(places, {'locations': {'top_tier': ['vienna']}}, client), client, 1)
        asked1 = {line.split(', ')[0] for line in first}
        asked2 = {line.split(', ')[0] for line in second}
        self.assertEqual(len(asked1 | asked2), 90)
        return asked1, asked2, asked1 & asked2

    def scored_db(self, n):
        from pathlib import Path
        from src import store
        db = store.connect(Path(self.data) / 'jobs.sqlite').__enter__()
        store.import_watch_report(db, {'jobs': [{'company': 'Example', 'id': str(i), 'title': f'SRE {i}', 'location': 'Zurich', 'url': f'https://x.test/{i}',
                                                 'description': 'Kubernetes, Terraform, Datadog.', 'status': 'new'} for i in range(n)], 'sources': []})
        return db

    def stage_scoring(self):
        from src.ai import score
        from src.daily_helpers import to_score
        from tests.test_score import fit
        db = self.scored_db(6)
        client = Counting(lambda lines: fit(70))
        first, second = self.ai_runs(lambda: score.run(db, to_score(db, frozenset()), 'Profile v1', 'm', 50, client=client, workers=1), client, 2)
        self.assertEqual(len(set(first) | set(second)), 6)
        return set(first), set(second), set(first) & set(second)

    def stage_job_facts(self):
        from src.ai import enrich
        from tests.test_enrich import full as facts
        db = self.scored_db(6)
        client = Counting(lambda lines: facts())
        first, second = self.ai_runs(lambda: enrich.run(db, 'claude-haiku-4-5', 50, client=client, workers=1), client, 2)
        self.assertEqual(len(first) + len(second), 6, 'each job read once')
        return set(first), set(second), set(first) & set(second)

    def test_every_stage_keeps_queues_and_redoes_nothing(self):
        table = {}
        for stage in time_budget.STAGES:
            with self.subTest(stage):
                late = self.data / late_reads.FILE
                if late.exists():
                    late.unlink()
                with redirect_stdout(io.StringIO()):
                    kept, queued, redone = self.two_runs(stage)
                table[stage] = (len(kept), len(queued), len(redone))
                self.assertEqual(redone, set(), f'{stage}: run 2 did again what run 1 had done')
        if os.getenv('JP_SHOW_TABLE'):
            print('\n'.join(f'{stage:18} kept {k:3} · queued {q:3} · redone {r}' for stage, (k, q, r) in table.items()), file=sys.stderr)


if __name__ == '__main__':
    unittest.main()
