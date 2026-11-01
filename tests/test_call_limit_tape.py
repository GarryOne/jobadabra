"""A per-run call limit asks the same pages in a replay as in its recording, whatever order its threads arrive in (src/budget_tape.within).
19 Oct 2026, heal proof 5: a fresh tape's two replays matched its recording on every number but asked 2 careers pages the recording did not (the page reader
may make 25 calls a run; the recording used them on the pages that arrived first, a replay's threads arrived in another order). The class: every per-run limit on
model calls in the search path (page reads, link choices, decide batches) is decided by what is asked, never by how many came first."""
import json
import os
import re
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import budget_tape
from src.ai import decide, meanings_pack, page_reader

ROOT = Path(__file__).resolve().parent.parent
PAGE = '<html><body><p>Wir suchen einen Site Reliability Engineer.</p><a href="/jobs/1">Site Reliability Engineer</a></body></html>'
ANSWER = {'jobs': [{'name': 'Site Reliability Engineer', 'place': 'Berlin', 'link': '/jobs/1'}]}


class FakeClient:
    def __init__(self):
        self.asked = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.asked.append(kwargs['messages'][0]['content'].split('\n')[0])
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(ANSWER))], usage=None)


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        for patch in (mock.patch.dict(os.environ, {'JOBADABRA_SEARCH_TAPE': self.dir.name}), mock.patch('src.paths.DATA', Path(self.dir.name)),
                      mock.patch.object(page_reader, 'wanted_text', lambda: re.compile(r'site reliability', re.I)), mock.patch.object(page_reader.cost, 'side')):
            patch.start()
            self.addCleanup(patch.stop)

    def mode(self, mode):
        """A fresh process of the same run: the counters are zero, the tape is read again."""
        (Path(self.dir.name) / 'budget_epoch.txt').unlink(missing_ok=True)
        budget_tape._seen.clear()
        budget_tape._tape.clear()
        page_reader._reads.clear()
        page_reader._reads['n'] = 0
        decide._calls['n'] = 0
        return mock.patch.dict(os.environ, {'JOBADABRA_SEARCH_TAPE_MODE': mode})


class WithinTest(Base):
    def test_a_limit_is_decided_per_question_whatever_the_order(self):
        with self.mode('record'):
            used = [0]
            got = {}
            for key in ('a', 'b', 'c'):
                got[key] = budget_tape.within('reads', key, used[0], 2)
                used[0] += got[key]
        self.assertEqual(got, {'a': True, 'b': True, 'c': False})
        with self.mode('replay'):
            used = [0]
            again = {}
            for key in ('c', 'b', 'a'):   # the other order: a count would give c the first two
                again[key] = budget_tape.within('reads', key, used[0], 2)
                used[0] += again[key]
        self.assertEqual(again, got)

    def test_without_a_tape_it_is_the_plain_count(self):
        with mock.patch.dict(os.environ, {'JOBADABRA_SEARCH_TAPE': ''}):
            self.assertEqual([budget_tape.within('reads', 'a', used, 2) for used in (0, 1, 2, 3)], [True, True, False, False])


class PageReaderTest(Base):
    def setUp(self):
        super().setUp()
        for name in ('MAX_ANY_LANGUAGE_READS', 'MAX_READS_PER_RUN'):
            patch = mock.patch.object(page_reader, name, 1)
            patch.start()
            self.addCleanup(patch.stop)

    def read(self, urls):
        client, db = FakeClient(), sqlite3.connect(':memory:')
        db.execute('CREATE TABLE page_reads (url TEXT PRIMARY KEY, digest TEXT NOT NULL, jobs_json TEXT NOT NULL, read_at TEXT NOT NULL)')
        for url in urls:
            page_reader.read(url, PAGE + url, client, db, careers_page=True)
        return client.asked

    def test_the_pages_a_replay_reads_are_the_ones_the_recording_read(self):
        urls = ['https://a.example/jobs', 'https://b.example/jobs', 'https://c.example/jobs']
        with self.mode('record'):
            recorded = self.read(urls)
        self.assertEqual(recorded, ['Careers page: https://a.example/jobs'], 'the limit of one call is used on the first page that arrived')
        with self.mode('replay'):
            replayed = self.read(list(reversed(urls)))
        self.assertEqual(replayed, recorded, 'the same page is asked, though the replay\'s order is the other way round')

    def test_the_links_of_a_home_page_are_chosen_for_the_sites_the_recording_chose(self):
        home = '<a href="/karriere">Karriere</a><a href="/about">About</a>'
        sites = ['https://a.example', 'https://b.example']

        def choose(order):
            client, asked = FakeClient(), []
            client.messages = SimpleNamespace(create=lambda **kw: (asked.append(kw['messages'][0]['content'].split('\n')[0]),
                                                                    SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text='{"links": []}')], usage=None))[1])
            db = sqlite3.connect(':memory:')
            for site in order:
                page_reader.choose_links(site, home, client, db)
            return asked
        with mock.patch.object(page_reader, 'MAX_READS_PER_RUN', 1):
            with self.mode('record'):
                recorded = choose(sites)
            with self.mode('replay'):
                replayed = choose(list(reversed(sites)))
        self.assertEqual(recorded, ['Home page: https://a.example'])
        self.assertEqual(replayed, recorded)


class DecideTest(Base):
    def test_the_batches_a_replay_decides_are_the_ones_the_recording_decided(self):
        def run(topics):
            asked = []

            def create(**kw):
                asked.append(kw['messages'][0]['content'].split('\n')[0])
                return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text='{"results": []}')], usage=None)
            client = SimpleNamespace(messages=SimpleNamespace(create=create))
            db = sqlite3.connect(':memory:')
            for topic in topics:
                decide.decide(topic, {'k': 'some text'}, ['yes', 'no'], f'Task {topic}', client=client, db=db)
            return asked
        with mock.patch.object(decide, 'MAX_CALLS_PER_RUN', 1), mock.patch.object(meanings_pack, 'first', return_value=None), mock.patch.object(meanings_pack, 'queue'), \
                mock.patch.object(decide.cost, 'side'):
            with self.mode('record'):
                recorded = run(['one', 'two'])
            with self.mode('replay'):
                replayed = run(['two', 'one'])
        self.assertEqual(recorded, ['Task: Task one'])
        self.assertEqual(replayed, recorded)


class OverTest(Base):
    def test_time_up_is_decided_per_batch_whatever_the_order(self):
        """19 Oct 2026, heal proof 6: the title batches run in threads; the recording skipped the batches whose turn came when time was up,
        a replay's threads came in another order and asked batches the recording had skipped (18 questions missing)."""
        from src import time_budget
        with self.mode('record'):
            clock = iter([True, True, False, False])
            with mock.patch.object(time_budget, '_over', lambda step, now: next(clock)):
                got = {key: time_budget.over('titles', key=key) for key in ('a', 'b', 'c', 'd')}
        self.assertEqual(got, {'a': True, 'b': True, 'c': False, 'd': False})
        with self.mode('replay'):
            again = {key: time_budget.over('titles', key=key) for key in ('d', 'c', 'b', 'a')}
        self.assertEqual(again, got)


class ClassTest(unittest.TestCase):
    def test_every_time_up_check_in_a_thread_pool_names_its_batch(self):
        """`budget.over('step')` without a key is decided by call position: fine in a single loop, wrong where batches run side by side."""
        bad = []
        for path in sorted((ROOT / 'src' / 'ai').glob('*.py')):
            for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
                if re.search(r"budget\.over\('[a-z_]+'\)", line):
                    bad.append(f'{path.name}:{number}: {line.strip()}')
        self.assertEqual(bad, [], 'name the batch: budget.over(step, key) is decided per batch in a search tape')

    def test_every_per_run_call_limit_in_the_ai_modules_asks_the_tape(self):
        """A new limit written as a plain comparison on a counter fails here, with its line."""
        bad = []
        for path in sorted((ROOT / 'src' / 'ai').glob('*.py')):
            for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
                if re.search(r"(_reads|_calls)\b.*>=|>=.*\b(_reads|_calls)\b|_reads\.get\(counter.*>= *limit", line) and 'budget_tape.within' not in line:
                    bad.append(f'{path.name}:{number}: {line.strip()}')
        self.assertEqual(bad, [], 'a per-run call limit is decided through budget_tape.within, so a replay asks what its recording asked')
        for name in ('page_reader.py', 'decide.py'):
            self.assertIn('budget_tape.within', (ROOT / 'src' / 'ai' / name).read_text(encoding='utf-8'), name)


if __name__ == '__main__':
    unittest.main()
