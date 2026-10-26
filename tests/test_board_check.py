"""A proposed job board is checked to be one when its read gave nothing (src/sources/board_check.py; owner's yes 19 Oct 2026, step 1 of
the local-sources sketch: fahrerjobs.de is one haulage company's own site, trucker.jobs has no address). Fake AI only."""
import socket
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from src.ai import board_ideas
from src.sources import board_check, board_employers, board_yield, careers, found_boards

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'role_keywords': ['Berufskraftfahrer'], 'locations': {'top_tier': ['nürnberg'], 'country_wide': [], 'abroad': []}}
HAULIER = ('<html><head><title>Müller Spedition | Transporte</title><meta name="description" content="Ihr Partner für Megatrailer-Transporte">'
           '</head><body><a href="/leistungen">Leistungsportfolio</a><a href="/frachtanfrage">Frachtanfrage</a>'
           '<a href="/karriere">Offene Stellenangebote</a></body></html>')
PORTAL = '<html><head><title>Jobs finden</title></head><body><a href="/s">Jobs suchen</a><a href="/firmen">Arbeitgeber</a></body></html>'


def board(n, host=None):
    host = host or f'b{n}.example'
    return {'name': f'Board {n}', 'host': host, 'search_url': f'https://{host}/jobs?q={{role}}&l={{place}}', 'countries': ['Germany'],
            'kinds': ['any'], 'source_kind': 'sector'}


def http(code):
    return urllib.error.HTTPError('https://x/', code, 'x', {}, None)


class KindTests(unittest.TestCase):
    def setUp(self):
        careers.READER = 'auto'
        self.addCleanup(setattr, careers, 'READER', None)
        self.asked = []

    def ask(self, answer):
        return lambda topic, key, text, answers, instructions: self.asked.append((topic, key, text, answers)) or answer

    def kind(self, fetch, answer='one employer'):
        return board_check.kind(board(1, 'haulier.example'), fetch, ask=self.ask(answer))[0]

    def test_no_address_or_no_home_page_is_gone_without_asking_the_ai(self):
        for error in (ValueError('not a public web address'), http(404), http(410), urllib.error.URLError(socket.gaierror(8, 'nodename'))):
            with self.subTest(error=error):
                self.assertEqual(self.kind(mock.Mock(side_effect=error)), 'gone')
        self.assertEqual(self.asked, [])

    def test_a_refusal_or_a_passing_error_is_unknown(self):
        for error in (http(403), http(429), http(503), urllib.error.URLError(TimeoutError('timed out'))):
            with self.subTest(error=error):
                self.assertIsNone(self.kind(mock.Mock(side_effect=error)))

    def test_the_ai_says_what_the_home_page_is_with_a_fixed_answer(self):
        self.assertEqual(self.kind(lambda url: HAULIER), 'one employer')
        topic, key, text, answers = self.asked[0]
        self.assertEqual((topic, key, answers), (board_check.TOPIC, 'haulier.example', board_check.KINDS))
        self.assertIn('Müller Spedition', text)
        self.assertIn('Frachtanfrage', text)
        self.assertEqual(board_check.name_of(HAULIER, 'haulier.example'), 'Müller Spedition')

    def test_no_ai_or_an_answer_outside_the_list_is_unknown(self):
        self.assertIsNone(self.kind(lambda url: HAULIER, answer=None))
        self.assertIsNone(self.kind(lambda url: HAULIER, answer='a bakery'))

    def test_the_page_reader_off_means_no_check(self):
        careers.READER = None
        fetch = mock.Mock(return_value=HAULIER)
        self.assertIsNone(self.kind(fetch))
        self.assertEqual((self.asked, fetch.call_count), ([], 0), 'no page fetched, no AI asked')


class ReadTests(unittest.TestCase):
    """found_boards.read: a board found not to be one gives its place to a spare, goes to the scout when it is an employer, and is skipped."""
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.data, self.said, self.kinds = {'boards': {}}, [], {'b1.example': ('one employer', HAULIER), 'b2.example': ('gone', '')}
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(board_ideas, 'load', side_effect=lambda: self.data),
                      mock.patch.object(board_ideas, 'save'), mock.patch.object(found_boards, '_dead', return_value=set()),
                      mock.patch.object(found_boards.board_employers, 'note'),
                      mock.patch.object(board_check, 'kind', side_effect=lambda b, fetch: self.kinds.get(b['host'], ('job board', PORTAL))),
                      mock.patch('builtins.print', lambda *a, **k: self.said.append(' '.join(map(str, a))))):
            patch.start()
            self.addCleanup(patch.stop)

    def read(self, boards, spare=(), now=None):
        def read_board(b, search, fetch, route=None, early=False, show=None):
            return ([], 'empty', None) if b['host'] in ('b1.example', 'b2.example', 'b3.example') else \
                ([{'title': 'Berufskraftfahrer', 'url': f"https://{b['host']}/1", 'location': 'Nürnberg'}], 'ok', None)
        with mock.patch.object(found_boards, 'read_board', read_board), mock.patch.object(found_boards, '_another_way', side_effect=lambda *a: a[-1]):
            return found_boards.read(SEARCH, boards, early=True, workers=4, spare=spare, is_relevant=list, dead=set(), now=now)

    def test_a_board_that_is_none_is_replaced_by_a_spare_and_an_employer_goes_to_the_scout(self):
        jobs = self.read([board(1), board(2), board(3), board(4)], spare=[board(5), board(6)])
        self.assertEqual(sorted(job['url'] for job in jobs), ['https://b4.example/1', 'https://b5.example/1', 'https://b6.example/1'])
        self.assertTrue(any("Board 1 is one employer's own site; reading Board" in line for line in self.said), self.said)
        self.assertTrue(any("Board 2 can't be reached; reading Board" in line for line in self.said), self.said)
        self.assertNotIn('Board 3', ' '.join(line for line in self.said if 'in its place' in line), 'an empty real board keeps its place')
        kept = {c['name']: c for c in board_employers.candidates()}
        self.assertEqual(kept['Müller Spedition'].get('website'), 'https://b1.example/', 'the scout gets the employer with its address')

    def test_one_employer_is_skipped_next_time_and_a_gone_board_after_two_days(self):
        from datetime import datetime, timedelta, timezone
        day = datetime(2026, 10, 19, 9, tzinfo=timezone.utc)
        self.read([board(1), board(2)], now=day)
        self.read([board(2)], now=day + timedelta(hours=1))   # the same search's full read, or a Mac offline all day
        later = [b['host'] for b in board_yield.pick([board(1), board(2)], self.data['boards'])]
        self.assertEqual(later, ['b2.example'], 'gone on one day only: read again')
        self.read([board(2)], now=day + timedelta(days=1))
        self.assertEqual(board_yield.pick([board(1), board(2)], self.data['boards']), [])

    def test_the_board_step_says_what_a_board_that_is_none_is(self):
        from datetime import datetime, timezone
        self.read([board(1), board(2)])
        with mock.patch.object(board_ideas, 'ideas', return_value=[board(1), board(2)]), mock.patch.object(found_boards, 'read'), \
                mock.patch.object(board_yield, '_read_since', return_value=datetime(2000, 1, 1, tzinfo=timezone.utc)):   # this search read them
            lines = board_yield.step(SEARCH)
        self.assertEqual([line['status'] for line in lines], ["one employer's own site: added to your employers", "can't be reached"])

    def test_the_employer_s_name_is_the_site_s_not_its_page_s(self):
        for title in ('TLH Transport Logistics Hauke: Bewerbung', 'TLH Transport Logistics Hauke | Karriere', 'TLH Transport Logistics Hauke - Home'):
            with self.subTest(title=title):
                self.assertEqual(board_check.name_of(f'<title>{title}</title>', 'x.example'), 'TLH Transport Logistics Hauke')

    def test_an_empty_real_board_is_checked_once(self):
        self.read([board(3)])
        self.read([board(3)])
        self.assertEqual(board_check.kind.call_count, 1)
        self.assertEqual(self.data['boards']['b3.example']['site_kind'], 'job board')


if __name__ == '__main__':
    unittest.main()
