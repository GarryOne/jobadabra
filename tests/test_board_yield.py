"""Boards by yield (src/sources/board_yield.py, found_boards.read): a board keeps the jobs that are relevant (title and place), not the jobs it
lists; it is dropped after 3 reads with none; untried boards come up to 6 a run while fewer than 10 relevant jobs are found; the 'Searching job
boards' step reads the found boards in any country and says nothing misleading when there are none. Spec: 2026-10-18-search-learns-sources.md PR 2."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import board_ideas  # noqa: E402
from src.sources import board_yield, boards, found_boards  # noqa: E402
from src.sources import careers  # noqa: E402

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'role_keywords': ['controller'], 'locations': {'top_tier': ['Amsterdam'], 'country_wide': [], 'abroad': []}}


def board(n):
    return {'name': f'Board {n}', 'host': f'b{n}.example', 'search_url': f'https://b{n}.example/?q={{role}}', 'countries': ['Netherlands'],
            'kinds': ['finance_admin'], 'source_kind': 'general'}


def job(title, place, n=0):
    return {'title': title, 'location': place, 'url': f'https://x.example/{title}{place}{n}'}


class Fixture(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)


class YieldTests(Fixture):
    @staticmethod
    def relevant(jobs):
        return [j for j in jobs if j['title'] == 'Controller' and j['location'] == 'Amsterdam']

    def read(self, boards_, jobs_by_host, now=None):
        def fake(b, search, fetch, route=None, **kwargs):
            return jobs_by_host.get(b['host'], []), 'ok' if jobs_by_host.get(b['host']) else 'empty', None
        with mock.patch.object(found_boards, 'read_board', fake):
            return found_boards.read(SEARCH, boards_, is_relevant=self.relevant)

    def test_a_board_is_judged_by_relevant_jobs_not_by_jobs_listed(self):
        banner = [job('Wij zoeken jou', 'Utrecht', 1), job('Alle vacatures', 'Utrecht', 2)]   # a banner counted as 2 jobs before
        self.read([board(1)], {'b1.example': banner})
        entry = board_ideas.load()['boards']['b1.example']
        self.assertEqual((entry['jobs'], entry['relevant'], entry['state']), (2, 0, 'ok'))
        # Dropped after 3 runs with none: its history in source_yield (tests/test_proven_boards.py HistoryTests).

    def test_at_most_six_untried_boards_a_run_and_none_once_ten_relevant_jobs_are_found(self):
        asked = []
        def fake(b, search, fetch, route=None, **kwargs):
            asked.append(b['host'])
            return [], 'empty', None
        with mock.patch.object(found_boards, 'read_board', fake):
            found_boards.read(SEARCH, [board(n) for n in range(9)], is_relevant=self.relevant)
        self.assertEqual(sorted(asked), [f'b{n}.example' for n in range(6)])   # sorted: the reads run in a thread pool, their order is not defined
        asked.clear()
        with mock.patch.object(found_boards, 'read_board', fake):
            found_boards.read(SEARCH, [board(n) for n in range(9)], is_relevant=self.relevant)
        self.assertEqual(sorted(asked), [f'b{n}.example' for n in range(9)], 'the tried six again, then the next three untried')
        data = board_ideas.load()
        data['boards']['b0.example']['relevant'] = 12
        board_ideas.save(data)
        asked.clear()
        with mock.patch.object(found_boards, 'read_board', fake):
            found_boards.read(SEARCH, [board(n) for n in range(12)], is_relevant=self.relevant)
        self.assertEqual(sorted(asked), [f'b{n}.example' for n in range(9)], 'only the boards read before, no new one')

    def test_each_board_read_says_how_far_the_step_is(self):
        lines = []
        with mock.patch.object(found_boards, 'read_board', lambda *a, **k: ([], 'empty', None)), \
                mock.patch('builtins.print', lambda *a, **k: lines.append(' '.join(map(str, a)))):
            found_boards.read(SEARCH, [board(1), board(2)], is_relevant=self.relevant)
        self.assertEqual([l.split(' · ')[0] for l in lines if l.startswith('⏳')],
                         ['⏳ Reading job boards: 0 of 2', '⏳ Reading job boards: 1 of 2', '⏳ Reading job boards: 2 of 2'])

    def test_the_kind_of_source_is_kept(self):
        self.read([board(1)], {'b1.example': [job('Controller', 'Amsterdam')]})
        self.assertEqual(board_ideas.load()['boards']['b1.example']['source_kind'], 'general')


class StepTests(Fixture):
    def test_a_dutch_search_reads_the_found_boards_and_says_nothing_about_developer_boards(self):
        lines = []
        with mock.patch.object(board_ideas, 'ideas', return_value=[board(1)]), \
                mock.patch.object(found_boards, 'read_board', return_value=([job('Controller', 'Amsterdam')], 'ok', None)), \
                mock.patch('builtins.print', lambda *a, **k: lines.append(' '.join(map(str, a)))):
            sources = board_yield.step(SEARCH, is_relevant=lambda jobs: jobs)
        text = '\n'.join(lines)
        self.assertNotIn('SwissDevJobs', text)
        self.assertEqual(sources, [{'source': 'Board 1', 'status': '1 listed, 1 relevant (your roles, your places)'}])

    def test_with_no_board_found_it_says_so_plainly(self):
        lines = []
        with mock.patch.object(board_ideas, 'ideas', return_value=[]), mock.patch('builtins.print', lambda *a, **k: lines.append(' '.join(map(str, a)))):
            self.assertEqual(board_yield.step(SEARCH), [])
        self.assertEqual(lines, ['Job boards: no board found for these places and roles yet'])
        self.assertNotIn('SwissDevJobs', lines[0])

    def test_the_fixed_boards_message_names_no_board_for_a_search_outside_them(self):
        self.assertEqual(boards.boards(SEARCH), [])   # nothing fixed for a Dutch controller; the step then reads the found boards


class IdeasTests(Fixture):
    def test_boards_come_from_the_main_model_with_a_source_kind_and_more_than_two(self):
        from src.ai import models
        self.assertEqual(board_ideas.MODEL, models.MAIN_MODEL)
        self.assertIn('source_kind', board_ideas.SCHEMA['properties']['boards']['items']['required'])
        self.assertEqual(set(board_ideas.SOURCE_KINDS), {'public_service', 'general', 'sector', 'regional', 'agency'})
        self.assertIn('at least 8', board_ideas.SYSTEM)
        self.assertEqual(board_ideas.valid({'name': 'A', 'search_url': 'https://a.example/?q={role}', 'source_kind': 'sector'})['source_kind'], 'sector')
        self.assertEqual(board_ideas.valid({'name': 'A', 'search_url': 'https://a.example/?q={role}', 'source_kind': 'nonsense'})['source_kind'], 'general')


if __name__ == '__main__':
    unittest.main()


class RememberedTests(Fixture):
    """A board that gave this install relevant jobs is read again whatever the next AI proposal lists (18 Oct 2026, the board lottery)."""
    @staticmethod
    def relevant(jobs):
        return [j for j in jobs if j['title'] == 'Controller' and j['location'] == 'Amsterdam']

    def read_asked(self, proposal, results=None):
        asked = []
        def fake(b, search, fetch, route=None, **kwargs):
            asked.append(b['host'])
            return (results or {}).get(b['host'], ([], 'empty', None))
        with mock.patch.object(found_boards, 'read_board', fake):
            found_boards.read(SEARCH, proposal, is_relevant=self.relevant)
        return asked

    def test_a_board_that_gave_relevant_jobs_is_read_in_search_2_though_proposal_2_lacks_it(self):
        paid = ([job('Controller', 'Amsterdam', 1)], 'ok', None)
        self.read_asked([board(1), board(2)], {'b1.example': paid})
        asked = self.read_asked([board(2), board(3)])   # the second proposal drops board 1
        self.assertIn('b1.example', asked)

    def test_only_a_board_that_paid_stays_not_an_empty_a_browser_or_a_foreign_one(self):
        results = {'b1.example': ([job('Controller', 'Amsterdam', 1)], 'ok', None),   # paid
                   'b2.example': ([job('Cook', 'Utrecht', 2)], 'ok', None),            # listed jobs, none relevant
                   'b3.example': ([], 'browser', None)}                                 # refuses automated reading
        self.read_asked([board(1), board(2), board(3), {**board(4), 'countries': ['Germany']}], results)
        data = board_ideas.load()
        data['boards']['b4.example'] = {'name': 'Board 4', 'search_url': 'https://b4.example/?q={role}', 'state': 'ok', 'relevant': 9, 'countries': ['Germany'],
                                        'last_read': '2026-10-18T00:00:00+00:00'}
        board_ideas.save(data)
        kept = board_ideas.load()['boards']
        self.assertEqual([b['host'] for b in board_yield.remembered([board(9)], kept)], ['b1.example'],
                         'only the Dutch board that gave relevant jobs; none for the German one while the proposal serves the Netherlands')
