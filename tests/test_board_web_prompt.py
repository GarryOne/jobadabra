"""The board web search's instruction, cap and answer form live in one public file, config/board_web_search.json, read by the engine and by the
site relay that runs the same search for Free AI without a plan (owner's yes 26 Oct 2026: a paid site search, $10/month cap), so both ask the
same thing and no copy of the prompt drifts. An unknown role kind keeps the search weekly: it is then the search's main source (role-kinds
session, 26 Oct 2026). Fake AI client only."""
import json
import unittest
from datetime import timedelta
from pathlib import Path
from unittest import mock

from src import role_kinds
from src.ai import board_ideas
from src.sources import board_web
from tests.test_board_web import NOW, SEARCH, STAGE, Base, Client, board, setUpModule, tearDownModule  # noqa: F401 — page reader off

FILE = Path(__file__).resolve().parents[1] / 'config' / 'board_web_search.json'


class OneSharedPrompt(unittest.TestCase):
    def test_the_file_holds_the_instruction_the_cap_and_the_board_answer_form(self):
        shared = json.loads(FILE.read_text())
        self.assertEqual(shared['schema'], board_ideas.SCHEMA, 'the answer form is the one the engine validates boards with')
        self.assertLessEqual(shared['max_uses'], 3, 'at most 3 searches a call: the cost the owner approved rests on it')
        self.assertIn('untrusted', shared['system'], 'search results never steer the model')
        for word in ('{role}', '{place}'):
            self.assertIn(word, shared['system'])


class TheCallUsesTheFile(Base):
    def test_the_engine_sends_the_file_s_instruction_and_caps(self):
        shared = json.loads(FILE.read_text())
        client = Client([STAGE])
        board_web.search(SEARCH, [board(1)], client=client, now=NOW)
        asked = client.asked[0]
        self.assertEqual(asked['system'][0]['text'], shared['system'])
        self.assertEqual(asked['tools'][0]['max_uses'], shared['max_uses'])
        self.assertEqual(asked['max_tokens'], shared['max_tokens'])


class UnknownKindIsThin(Base):
    def test_an_unknown_kind_searches_weekly_even_with_working_boards(self):
        working = {'s1.example': {'source_kind': 'sector', 'state': 'ok', 'relevant': 4},
                   's2.example': {'source_kind': 'regional', 'state': 'ok', 'relevant': 2}}
        data = {'web': {'k': NOW.isoformat()}}
        later = NOW + timedelta(days=board_web.RECENT)
        self.assertFalse(board_web._due(data, 'k', later, working, SEARCH), 'a known kind with working boards: monthly')
        with mock.patch.object(role_kinds, 'UNKNOWN', 'unknown', create=True), mock.patch.object(role_kinds, 'of_search', return_value='unknown'):
            self.assertTrue(board_web._due(data, 'k', later, working, SEARCH))
            self.assertTrue(board_web.needed(working, [{'host': host, **entry} for host, entry in working.items()], SEARCH))

    def test_before_role_kinds_has_unknown_nothing_changes(self):
        with mock.patch.object(role_kinds, 'of_search', side_effect=AssertionError('not asked')):
            if not hasattr(role_kinds, 'UNKNOWN'):
                self.assertFalse(board_web._unknown_kind(SEARCH))


if __name__ == '__main__':
    unittest.main()
