"""Web searches on every install (owner, 26 Oct 2026: "The Free AI should have no limitation"): the user's own signed-in plan (Claude Code, then
Codex) does the web searches that find job boards and employers even when Free AI or an API key answers the rest; Free AI itself never gets
a web search tool it cannot run (25 Oct 2026: the owner's Free AI install had no web search anywhere, so a pilot search found no board).
Fake clients only: no test here starts a real CLI (JOB_PILOTTO_PLAN_SEARCH is set only by the app, from a signed-in check)."""
import os
import unittest
from unittest import mock

from src import scout_core, scout_hiring
from src.ai.providers import claude_code, codex_cli
from src.sources import board_web, careers, web_search
from tests.test_board_web import Base, Client, SEARCH, STAGE, NOW, board

FREE = {'JOB_PILOTTO_AI_ENGINE': 'api', 'ANTHROPIC_API_KEY': 'JPF1.install.token', 'JOB_PILOTTO_DISABLE': ''}
KEY = {'JOB_PILOTTO_AI_ENGINE': 'api', 'ANTHROPIC_API_KEY': 'sk-ant-own', 'JOB_PILOTTO_DISABLE': ''}
_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def env(base, **more):
    clean = {k: v for k, v in os.environ.items() if k not in ('JOB_PILOTTO_PLAN_SEARCH', 'JOB_PILOTTO_CLAUDE_BIN', 'JOB_PILOTTO_CODEX_BIN')}
    return mock.patch.dict(os.environ, {**clean, **base, **more}, clear=True)


class PlanClient(unittest.TestCase):
    def test_a_signed_in_plan_searches_when_another_engine_answers(self):
        for named, binary, adapter in (('claude', 'JOB_PILOTTO_CLAUDE_BIN', claude_code.ClaudeCode), ('codex', 'JOB_PILOTTO_CODEX_BIN', codex_cli.Codex)):
            with self.subTest(named), env(FREE, JOB_PILOTTO_PLAN_SEARCH=named, **{binary: f'/x/{named}'}), \
                    mock.patch.object(web_search, '_binary', side_effect=lambda name: f"/x/{'claude' if name == 'cli' else 'codex'}"):
                self.assertTrue(web_search._claude_code())
                self.assertEqual(web_search._plan_engine(), named)
                self.assertIsInstance(web_search.plan_client(), adapter)

    def test_no_plan_named_no_plan_search_even_with_a_cli_on_this_mac(self):
        with env(FREE), mock.patch.object(web_search, '_binary', return_value='/usr/local/bin/claude'):
            self.assertFalse(web_search._claude_code(), 'only the app says a plan is signed in: a test never starts a real CLI')
            self.assertIsNone(web_search.plan_client())

    def test_the_chosen_plan_engine_stays_the_search(self):
        with env({'JOB_PILOTTO_AI_ENGINE': 'cli'}), mock.patch.object(web_search, '_binary', return_value='/x/claude'), \
                mock.patch('src.ai.engine.client', return_value='the engine') as made:
            self.assertTrue(web_search._claude_code())
            self.assertEqual(web_search.plan_client(), 'the engine')
            made.assert_called_once()

    def test_free_ai_is_told_apart_from_an_own_key(self):
        with env(FREE):
            self.assertTrue(web_search.free_ai())
        with env(KEY):
            self.assertFalse(web_search.free_ai())


class BoardWebOnEveryInstall(Base):
    def test_free_ai_with_a_signed_in_plan_searches_through_the_plan(self):
        plan = Client([STAGE])
        with env(FREE), mock.patch.object(web_search, '_claude_code', return_value=True), \
                mock.patch.object(web_search, 'plan_client', return_value=plan), mock.patch('src.ai.engine.client') as made:
            found = board_web.search(SEARCH, [board(1)], now=NOW)
        self.assertEqual([b['host'] for b in found], ['buehnenjobs.example'])
        self.assertEqual(len(plan.asked), 1)
        made.assert_not_called()

    def test_free_ai_alone_never_sends_a_web_search_it_cannot_run(self):
        with env(FREE), mock.patch.object(web_search, '_claude_code', return_value=False), mock.patch('src.ai.engine.client') as made:
            self.assertEqual(board_web.search(SEARCH, [board(1)], now=NOW), [])
        made.assert_not_called()

    def test_an_own_api_key_still_searches_as_before(self):
        own = Client([STAGE])
        with env(KEY), mock.patch.object(web_search, '_claude_code', return_value=False), mock.patch('src.ai.engine.client', return_value=own):
            board_web.search(SEARCH, [board(1)], now=NOW)
        self.assertEqual(len(own.asked), 1)


class ScoutSearchesOnEveryInstall(unittest.TestCase):
    def test_who_hires_runs_on_an_install_with_a_signed_in_plan_and_asks_the_plan(self):
        plan = Client([])
        plan.create = lambda **kw: plan.asked.append(kw) or __import__('types').SimpleNamespace(
            content=[__import__('types').SimpleNamespace(type='text', text='{"employers": [], "portals": []}')],
            usage=__import__('types').SimpleNamespace(input_tokens=1, output_tokens=1))
        with mock.patch.object(scout_core, 'CENTRAL', False), mock.patch.object(web_search, '_claude_code', return_value=True), \
                mock.patch.object(web_search, 'plan_client', return_value=plan), mock.patch('src.ai.cost.side'), \
                mock.patch('src.ai.engine.client') as made:
            self.assertTrue(scout_hiring.allowed())
            self.assertEqual(scout_hiring.ask('pilot first officer', 'Germany'), {'employers': [], 'portals': []})
        self.assertEqual(len(plan.asked), 1)
        made.assert_not_called()


if __name__ == '__main__':
    unittest.main()
