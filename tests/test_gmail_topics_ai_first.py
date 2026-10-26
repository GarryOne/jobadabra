"""The mail and calendar meanings (is this event an interview, does this note ask to book, which round) are the AI's judgement: the seed's keyword
patterns answer only with no AI at all (config/meanings_schema.json 'ai_first'; owner, 26 Oct 2026: "AI as much as needed ... not a scriptic algorithm")."""
import json
import sqlite3
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ai import decide, meanings, meanings_pack  # noqa: E402

TOPICS = ('calendar-event', 'asks-to-book', 'interview-round')


class Client:
    """A stand-in AI that says 'other' to every item: a pattern word must not have answered first."""
    def __init__(self):
        self.calls = 0
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls += 1
        content = kwargs['messages'][0]['content']
        count = content.count('### Item ')
        return SimpleNamespace(stop_reason='end_turn', usage=None, content=[SimpleNamespace(
            type='text', text=json.dumps({'results': [{'index': i, 'answer': 'other'} for i in range(count)]}))])


class GmailTopicsAiFirst(unittest.TestCase):
    def setUp(self):
        decide._calls['n'] = 0
        self.client = Client()
        self.ready = mock.patch.object(decide.engine, 'ready', return_value=True)
        for patch in (mock.patch.object(decide, '_db', lambda: sqlite3.connect(':memory:')), self.ready,
                      mock.patch.object(decide.engine, 'client', lambda **k: self.client),
                      mock.patch.object(meanings_pack, 'queue', lambda *a, **k: None),
                      mock.patch.object(meanings_pack, 'tables', lambda: meanings_pack._load(meanings_pack.SEED_FILE.read_text(), ''))):
            patch.start()
            self.addCleanup(patch.stop)

    def test_every_topic_asks_the_ai_first(self):
        for topic in TOPICS:
            with self.subTest(topic=topic):
                self.assertTrue(meanings_pack.ai_first(topic))

    def test_a_pattern_word_does_not_answer_while_the_ai_is_ready(self):
        event = {'id': 'e1', 'summary': 'Interview with the dentist', 'description': ''}
        paths = {
            'calendar-event': lambda: meanings.job_events([event], lambda e: e['description']) == [],
            'asks-to-book': lambda: meanings.asks_to_book('Thanks, I am available all week') is False,
            'interview-round': lambda: meanings.round_kind('Technical') == 'other',
        }
        for topic, path in paths.items():
            with self.subTest(topic=topic):
                self.assertEqual(sorted(paths), sorted(TOPICS))
                before = self.client.calls
                self.assertTrue(path())
                self.assertGreater(self.client.calls, before, 'the AI was asked')

    def test_without_any_ai_the_patterns_are_the_floor(self):
        self.ready.stop()
        with mock.patch.object(decide.engine, 'ready', return_value=False):
            self.assertTrue(meanings.asks_to_book('Please pick a time on calendly'))
            self.assertEqual(meanings.round_kind('Technical'), 'technical')
            self.assertEqual(len(meanings.job_events([{'id': 'e', 'summary': 'Interview', 'description': ''}], lambda e: '')), 1)
        self.ready.start()

    def test_past_the_cap_an_item_stays_unknown_not_a_pattern_guess(self):
        decide._calls['n'] = decide.MAX_CALLS_PER_RUN
        with mock.patch.object(decide.budget_tape, 'within', return_value=False):
            self.assertFalse(meanings.asks_to_book('Please pick a time on calendly'))
            self.assertEqual(meanings.round_kind('Technical'), 'other')


if __name__ == '__main__':
    unittest.main()
