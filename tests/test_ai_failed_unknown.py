"""A busy, failed or capped AI leaves items unknown, never a keyword's guess (owner's rule, CLAUDE.md "The AI decides"; 27 Oct 2026: Free AI's daily limit
was spent and 32 careers links fell to keyword rules, one warning per page). Only no AI at all (decide.no_ai) lets a caller use its offline floor."""
import re
import sqlite3
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ai import decide  # noqa: E402
from src.sources import refused_state  # noqa: E402

FREE_AI_SPENT = ("You reached today's Free AI use. It resets tomorrow, or add your own Claude or ChatGPT key in Settings → AI engine.")

# Every module that calls decide.decide / decide.one: how it treats an unknown answer. A new caller must be added here (and say how), or the class test fails.
CALLERS = {
    'src/ai/meanings.py': 'unknown = other / False / left out',
    'src/ai/page_words.py': 'unknown = link skipped (tests/test_page_words.py)',
    'src/ai/score_search.py': 'unknown = not a no',
    'src/geo.py': 'its own batches', 'src/role_kinds.py': 'unknown = no kind, left out of a mix',
    'src/scout_kind_counts.py': 'cap shared', 'src/scout_title_seed.py': 'remember only',
    'src/sources/aggregators.py': 'unknown place = left out', 'src/sources/board_check.py': 'unknown = the board stands as found',
    'src/scout_boards.py': 'unknown = the Google site waits for the next run (scout_google_boards TRIES); a board country unknown: its place-less jobs do not count',
    'src/sources/board_sections.py': 'unknown = retried (found_boards, FAILED)', 'src/sources/found_boards.py': 'FAILED retry',
    'src/sources/google.py': 'unknown = no code / no link, polled again', 'src/sources/one_posting.py': 'unknown = not one posting, asked next run',
    'src/sources/refused_state.py': 'unknown = None (the tab stops as refused); words only with no AI', 'src/target_roles.py': 'unknown = not set',
}


def spent_client():
    def create(**kwargs):
        error = RuntimeError(FREE_AI_SPENT)
        error.status_code = 429
        raise error
    return SimpleNamespace(messages=SimpleNamespace(create=create))


class FailedAIIsUnknown(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        decide._calls['n'] = 0
        decide.STOPPED['why'] = ''
        decide.WAITING.update(n=0, said=False, calls={})
        self.addCleanup(lambda: decide.STOPPED.update(why=''))

    def test_a_failed_call_is_unknown_and_the_floor_is_not_used(self):
        asked = mock.Mock(side_effect=RuntimeError('boom'))
        client = SimpleNamespace(messages=SimpleNamespace(create=asked))
        def first(topic, text, patterns=True):
            self.assertFalse(patterns, 'the keyword patterns were asked after the AI failed')
        with mock.patch('src.ai.meanings_pack.first', first), mock.patch.object(decide.engine, 'ready', return_value=True):
            self.assertEqual(decide.decide('link-kind', {'a': 'x'}, ('job_list', 'other'), 'task', client, self.db), {})
        self.assertEqual(decide.WAITING['n'], 1)

    def test_no_ai_at_all_is_the_only_floor(self):
        with mock.patch.object(decide.engine, 'ready', return_value=False):
            self.assertTrue(decide.no_ai())
            self.assertIsNone(decide.decide('t', {'a': 'x'}, ('yes', 'no'), 'task', db=self.db))

    def test_a_spent_limit_stops_asking_for_the_rest_of_the_run_and_says_one_plain_line(self):
        client = spent_client()
        calls = mock.Mock(wraps=client.messages.create)
        client.messages.create = calls
        for page in range(5):   # five careers pages, each with its own new wordings
            self.assertEqual(decide.decide('link-kind', {f'w{page}-{i}': 'x' for i in range(3)}, ('a', 'b'), 'task', client, self.db), {})
        self.assertEqual(calls.call_count, 1, 'one failed call, then no more asks')
        self.assertEqual(decide.WAITING['n'], 15)
        self.assertEqual(decide.items_waiting(), "Today's Free AI limit is reached: 15 items wait for tomorrow (or add your own key in Settings → Connections → AI)")
        self.assertEqual(decide.FAILED[0] > 0, True, 'callers that retry unjudged items can tell')

    def test_every_decide_caller_is_listed_with_how_it_treats_unknown(self):
        found = {str(f.relative_to(ROOT)) for f in (ROOT / 'src').rglob('*.py')
                 if f.name != 'decide.py' and re.search(r'decide\.(decide|one)\b|decide\.decide\b', f.read_text())}
        self.assertEqual(sorted(found - set(CALLERS)), [], 'a new decide() caller: say in CALLERS how an unknown answer is treated, and test it')

    def test_a_page_state_the_ai_could_not_judge_is_not_guessed_from_words(self):
        page = '<html><body>Please verify you are human</body></html>'
        with mock.patch.object(decide, 'one', return_value=None), mock.patch.object(decide.engine, 'ready', return_value=True):
            self.assertIsNone(refused_state.page_state(200, page))
        with mock.patch.object(decide, 'one', return_value=None), mock.patch.object(decide.engine, 'ready', return_value=False):
            self.assertEqual(refused_state.page_state(200, page), 'captcha')

    def test_a_sign_up_email_the_ai_could_not_judge_gets_no_regex_code(self):
        from src.sources import google
        email = {'from': 'a@b.c', 'subject': 'Your code', 'date': '', 'body': 'Your code: 4K7Q2Z https://b.c/confirm?t=1'}
        with mock.patch.object(decide, 'decide', lambda *a, **k: {}):
            found = google.confirmation(email)
        self.assertEqual((found['code'], found['links']), ('', []))

    def test_a_429_inside_a_page_read_never_stops_the_step(self):
        from src.ai import page_reader
        page = '<a href="/jobs/1234567">Nurse</a><a href="/jobs/2234567">Doctor</a><a href="/jobs/3234567">Porter</a>'
        self.db.execute('CREATE TABLE page_reads (url TEXT PRIMARY KEY, digest TEXT NOT NULL, jobs_json TEXT NOT NULL, read_at TEXT NOT NULL)')
        client = spent_client()
        client.messages.create = mock.Mock(wraps=client.messages.create)
        with mock.patch.object(page_reader.careers, 'READER', 'auto'):
            for n in range(3):   # three boards, one after the other: the step goes on, unread
                self.assertIsNone(page_reader.read(f'https://x{n}.example/jobs', page, client=client, db=self.db, careers_page=True))
            self.assertEqual(page_reader.choose_links('https://x.example', '<a href="/a">A</a>', client=client, db=self.db), [])
        self.assertEqual(client.messages.create.call_count, 1, 'after the limit, nothing asks again')
        self.assertTrue(decide.stopped())


if __name__ == '__main__':
    unittest.main()
