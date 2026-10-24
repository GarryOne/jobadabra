"""Job boards proposed by Claude (src/ai/board_ideas.py): only a checked shape is ever read, one call per countries/roles/kinds, nothing
without AI. Spec: docs/superpowers/specs/2026-10-08-job-board-discovery.md."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import board_ideas  # noqa: E402

LISBON = {'role_keywords': ['developer'], 'locations': {'top_tier': ['Lisboa'], 'country_wide': [], 'abroad': []}}
ANSWER = {'boards': [
    {'name': 'Net-Empregos', 'search_url': 'https://www.net-empregos.com/pesquisa-empregos.asp?chaves={role}&zona={place}', 'countries': ['Portugal'], 'kinds': ['any']},
    {'name': 'ITJobs', 'search_url': 'https://www.itjobs.pt/emprego?q={role}', 'countries': ['Portugal'], 'kinds': ['software']},
    {'name': 'Indeed', 'search_url': 'https://pt.indeed.com/jobs?q={role}&l={place}', 'countries': ['Portugal'], 'kinds': ['any']},
    {'name': 'Plain http', 'search_url': 'http://jobs.example/?q={role}', 'countries': [], 'kinds': []},
    {'name': 'No role', 'search_url': 'https://jobs.example/all', 'countries': [], 'kinds': []},
    {'name': 'Odd field', 'search_url': 'https://jobs.example/?q={role}&k={token}', 'countries': [], 'kinds': []},
    {'name': 'jobs.ch again', 'search_url': 'https://www.jobs.ch/en/vacancies/?term={role}', 'countries': ['Switzerland'], 'kinds': ['any']}]}


class FakeClient:
    def __init__(self):
        self.calls = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason='end_turn', usage=None, content=[SimpleNamespace(type='text', text=json.dumps(ANSWER))])


class BoardIdeasTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)),
                      mock.patch('src.places.load', return_value={'lisboa': {'kind': 'city', 'countries': ['Portugal']}})):
            patch.start()
            self.addCleanup(patch.stop)

    def test_only_checked_boards_are_kept_and_asked_once(self):
        client = FakeClient()
        found = board_ideas.ideas(LISBON, client)
        self.assertEqual([b['host'] for b in found], ['net-empregos.com', 'itjobs.pt'])   # a portal, http, no {role}, odd fields, an own reader: out
        self.assertEqual(found[1]['kinds'], ['software'])
        self.assertEqual(board_ideas.ideas(LISBON, client), found)
        self.assertEqual(len(client.calls), 1)
        sent = json.loads(client.calls[0]['messages'][0]['content'])
        self.assertEqual(sent['countries'], ['Portugal'])
        self.assertNotIn('cv', json.dumps(sent).lower())

    def test_without_ai_or_countries_nothing_is_proposed(self):
        with mock.patch('src.ai.engine.ready', return_value=False):
            self.assertEqual(board_ideas.ideas(LISBON), [])
        with mock.patch('src.places.load', return_value={}):
            self.assertEqual(board_ideas.ideas({'role_keywords': ['x'], 'locations': {'top_tier': ['Nowhere']}}, FakeClient()), [])


    def test_a_board_other_installs_share_reaches_a_new_install_of_that_country_even_without_ai(self):
        facts = {'board': {'emprego.example': {'url': 'https://emprego.example/busca?q={role}', 'countries': ['pt']},
                           'banned.example': {'url': 'https://elsewhere.example/?q={role}', 'countries': ['pt']},   # not on its own host
                           'swiss.example': {'url': 'https://swiss.example/?q={role}', 'countries': ['ch']}}}
        with mock.patch('src.sources.visits_jobpages.pool_facts', return_value=facts), mock.patch('src.ai.engine.ready', return_value=False):
            self.assertEqual([b['host'] for b in board_ideas.ideas(LISBON)], ['emprego.example'])

    def test_a_scout_measured_board_comes_first_and_keeps_its_section_link_when_the_ai_proposes_the_same_board(self):
        """24 Oct 2026, board seeding: the central scout publishes a board's own section page; the AI names the same board with a plain search link."""
        facts = {'board': {'jobs.example': {'url': 'https://jobs.example/jobs/it-software', 'countries': ['pt'],
                                            'relevant': [{'country': 'pt', 'family': 'software', 'installs': 1, 'in_places': 14, 'fit70': 0}]},
                           'weak.example': {'url': 'https://weak.example/?q={role}', 'countries': ['pt'],
                                            'relevant': [{'country': 'pt', 'family': 'software', 'installs': 1, 'in_places': 1, 'fit70': 0}]}}}
        answer = {'boards': [{'name': 'Net-Empregos', 'search_url': 'https://www.net-empregos.com/pesquisa-empregos.asp?chaves={role}&zona={place}',
                              'countries': ['Portugal'], 'kinds': ['any']},
                             {'name': 'Jobs Example', 'search_url': 'https://jobs.example/search?q={role}', 'countries': ['Portugal'], 'kinds': ['software']}]}

        class Client(FakeClient):
            def create(self, **kwargs):
                super().create(**kwargs)
                return SimpleNamespace(stop_reason='end_turn', usage=None, content=[SimpleNamespace(type='text', text=json.dumps(answer))])
        dev = {**LISBON, 'role_keywords': ['software engineer']}
        with mock.patch('src.sources.visits_jobpages.pool_facts', return_value=facts), mock.patch('src.ai.board_ideas._families', return_value={'software'}):
            found = board_ideas.ideas(dev, Client())
            again = board_ideas.ideas(dev, Client())   # the cached proposal is merged with the served boards afresh
            with mock.patch('src.ai.engine.ready', return_value=False):
                offline = board_ideas.ideas({**dev, 'role_keywords': ['software engineer', 'x']})
        self.assertEqual([b['host'] for b in found][:2], ['jobs.example', 'weak.example'], 'served boards first, best by local jobs per install')
        self.assertEqual(found[0]['search_url'], 'https://jobs.example/jobs/it-software', 'the measured section link is kept, not the AI template')
        self.assertIn('net-empregos.com', [b['host'] for b in found], 'the AI still adds its own boards')
        self.assertEqual(found, again)
        self.assertEqual([b['host'] for b in offline][:2], ['jobs.example', 'weak.example'], 'without AI the served boards still come')

    def test_without_served_boards_the_ai_proposal_stands_alone(self):
        with mock.patch('src.sources.visits_jobpages.pool_facts', return_value={}):
            self.assertEqual([b['host'] for b in board_ideas.ideas(LISBON, FakeClient())], ['net-empregos.com', 'itjobs.pt'])

    def test_a_board_that_read_jobs_is_shared_as_its_template_and_countries_only(self):
        from src import contribute
        board_ideas.save({'boards': {'net-empregos.com': {'name': 'Net-Empregos', 'state': 'ok', 'countries': ['Portugal'],
                                                          'search_url': 'https://www.net-empregos.com/pesquisa?chaves={role}&zona={place}'},
                                     'quiet.example': {'state': 'empty', 'countries': ['Portugal'], 'search_url': 'https://quiet.example/?q={role}'}}})
        with mock.patch('src.sources.visits._load', return_value={}):
            boards = [f for f in contribute.site_facts() if f['kind'] == 'board']
        self.assertEqual(boards, [{'host': 'net-empregos.com', 'kind': 'board', 'url': 'https://www.net-empregos.com/pesquisa?chaves={role}&zona={place}',
                                   'board': {'countries': ['pt']}}])


if __name__ == '__main__':
    unittest.main()
