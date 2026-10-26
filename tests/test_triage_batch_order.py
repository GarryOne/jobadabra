"""A search tape replays without misses whatever order two readers finish in (18 Oct 2026, Lab measurements: ~30 AI requests missed because place and
title batches held what the other reader had not yet decided). Readers that run side by side (first_jobs: the employer sites and the boards) each batch
only their own jobs against the store as it was when they began (src/ai/batch_scope.py)."""
import contextlib
import json
import pathlib
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest import mock

from src import geo
from src.ai import engine, place_triage, title_triage
from src.sources import feeds

try:
    from src.ai import batch_scope
except ImportError:   # main before the fix: no scope, readers see each other's answers
    batch_scope = None

PLACES = {'A': ['Lausanne', 'Sion', 'Zug', 'Aarau'], 'B': ['Sion', 'Brig', 'Bern', 'Zug']}
TITLES = {'A': ['Analyst 1', 'Analyst 2', 'Analyst 3'], 'B': ['Analyst 2', 'Analyst 4', 'Analyst 5']}


class Tape:
    """Records each request once; on replay a request not recorded is a miss."""
    def __init__(self):
        self.seen, self.mode, self.misses, self.calls, self.items = set(), 'record', [], 0, 0
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        content = kwargs['messages'][0]['content']
        self.calls += 1
        if self.mode == 'record':
            self.seen.add(content)
        elif content not in self.seen:
            self.misses.append(content)
        lines = content.split(':\n', 1)[1].split('\n') if ':\n' in content else []
        self.items += len(lines) if 'The job locations:' in content or 'The titles:' in content else 0
        if 'Countries:' in content:
            answer = {'visa': []}
        elif 'The job locations:' in content:
            answer = {'locations': [{'n': int(l.split('.', 1)[0]), 'where': '', 'country': 'Switzerland', 'nearest': 'none', 'km': -1,
                                     'answer': 'out' if 'Zug' in l or 'Aarau' in l else 'best'} for l in lines]}
        elif 'The titles:' in content:
            answer = {'fit': [int(l.split('.', 1)[0]) for l in lines]}
        elif 'Strings:' in content:
            answer = {'places': []}
        else:
            answer = {'vague': []}
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class BatchOrderTest(unittest.TestCase):
    def setUp(self):
        tmp = pathlib.Path(tempfile.mkdtemp())
        self.tmp = tmp
        for patch in (mock.patch.object(place_triage, 'STORE', tmp / 'p.json'), mock.patch.object(title_triage, 'STORE', tmp / 't.json'),
                      mock.patch.object(geo, 'STORE', tmp / 'g.json'), mock.patch.object(engine, 'ready', return_value=True),
                      mock.patch.object(feeds, 'wanted_title', lambda title: True), mock.patch.object(feeds, 'TITLES', feeds.keyword_regex(['zzzz'])),
                      mock.patch('builtins.print')):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(self.fresh)   # no judged titles left for the next test file (they mark that the AI sort ran)
        self.tape = Tape()
        patch = mock.patch.object(engine, 'client', lambda **kw: self.tape)
        patch.start()
        self.addCleanup(patch.stop)

    def fresh(self):
        for name in ('p.json', 't.json', 'g.json'):
            (self.tmp / name).unlink(missing_ok=True)
        feeds.PLACED = feeds.TRIAGED = feeds.READ = None

    def read(self, name):
        with batch_scope.reader(name) if batch_scope else contextlib.nullcontext():
            jobs = [{'location': place, 'title': title} for place, title in zip(PLACES[name], TITLES[name] + TITLES[name][:1])]
            feeds.triage_places(jobs)
            feeds.triage([{**job, 'title': title} for job, title in zip(jobs, TITLES[name])])

    def run_order(self, order):
        self.fresh()
        with batch_scope.concurrent() if batch_scope else contextlib.nullcontext():
            for name in order:
                self.read(name)

    def test_two_readers_finishing_in_the_other_order_ask_the_same_requests(self):
        self.tape.mode = 'record'
        self.run_order('AB')
        recorded = self.tape.calls
        self.tape.mode, self.tape.calls = 'replay', 0
        self.run_order('BA')
        self.assertEqual(self.tape.misses, [], 'every request of the replay is on the tape')
        self.assertEqual(self.tape.calls, recorded, 'the same number of requests')

    def test_a_reader_asks_nothing_twice(self):
        self.tape.mode = 'record'
        self.run_order('A')
        first = self.tape.calls
        with batch_scope.concurrent() if batch_scope else contextlib.nullcontext():
            self.read('A')
            self.read('A')
        self.assertEqual(self.tape.calls, first, 'a second pass over the same jobs, in one process, asks nothing new')

    def test_the_cost_is_only_what_both_readers_share(self):
        """Measured on this fixture (A and B share 2 of 4 places and 1 of 3 titles): shared first-time items are asked by both, in one scope."""
        self.fresh()
        for name in 'AB':
            self.read(name)
        shared_store, shared_items = self.tape.calls, self.tape.items
        self.fresh()
        self.tape.calls = self.tape.items = 0
        self.run_order('AB')
        self.assertEqual(self.tape.calls, shared_store, 'the same number of calls: the batches are short either way')
        self.assertLessEqual(self.tape.items, shared_items + 5, 'only the shared first-time items are asked twice')

    def test_a_reader_after_the_scope_sees_every_answer(self):
        self.run_order('AB')
        self.tape.mode, self.tape.calls = 'replay', 0
        self.read('A')
        self.read('B')
        self.assertEqual(self.tape.calls, 0, 'what the readers decided is shared once they end')

if __name__ == '__main__':
    unittest.main()
