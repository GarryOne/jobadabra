"""Proven job boards first (spec docs/superpowers/specs/2026-10-18-search-learns-sources.md PR 6; owner, 18 Oct 2026: boards ranked by
"relevant jobs per role", the top 2 read in the first-jobs slice). A board's history over runs is the source_yield table (one copy):
3 runs with no job in your places drop it. What a board gave goes to the pool with the board fact; the index serves it per role family ×
country and installs read the best boards first. No AI call and no live site here."""
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from src import contribute, first_jobs, source_yield, store
from src.ai import board_ideas
from src.sources import aggregators, board_employers, board_yield, feeds, found_boards, visits_jobpages
from src.sources import careers  # noqa: E402

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


POOL_FACTS = visits_jobpages.pool_facts
SEARCH = {'role_keywords': ['controller'], 'locations': {'top_tier': ['Amsterdam'], 'country_wide': [], 'abroad': []}}
START = datetime(2026, 10, 18, 10, 0, tzinfo=timezone.utc)


def board(n, **extra):
    return {'name': f'Board {n}', 'host': f'b{n}.example', 'search_url': f'https://b{n}.example/?q={{role}}', 'countries': ['Netherlands'],
            'kinds': ['finance_admin'], 'source_kind': 'general', **extra}


def job(title, place, n=0, host='b1.example'):
    return {'company': 'Acme', 'id': f'{title}{place}{n}', 'title': title, 'location': place, 'url': f'https://{host}/job/{title}{place}{n}',
            'date_posted': '', 'description': '', 'remote': False, 'salary': ''}


def relevant(jobs):
    return [j for j in jobs if j['title'] == 'Controller' and j['location'] == 'Amsterdam']


class Fixture(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.data = Path(tmp.name)
        for patch in (mock.patch('src.paths.DATA', self.data), mock.patch('src.places.load', return_value={}),
                      mock.patch.object(visits_jobpages, 'pool_facts', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)
        found_boards._early.clear()
        self.db = store.connect(self.data / 'jobs.sqlite')
        self.addCleanup(self.db.close)
        self.fetched = []

    def search_run(self, run, jobs_by_host, boards=None):
        """One search: the found boards read, then the run's yield measured (what daily_search does)."""
        now = START + timedelta(hours=run)
        def fake(b, search, fetch, route=None, **kwargs):
            self.fetched.append(b['host'])
            found = jobs_by_host.get(b['host'], [])
            return found, 'ok' if found else 'empty', None
        with mock.patch.object(found_boards, 'read_board', fake):
            found_boards.read(SEARCH, boards or [board(1)], now=now, is_relevant=relevant)
        stamp = now.isoformat(timespec='seconds')
        source_yield.run(self.db, stamp, read=found_boards.read_since(stamp))


class HistoryTests(Fixture):
    def test_a_board_with_nothing_in_your_places_three_runs_running_is_dropped(self):
        banner = {'b1.example': [job('Wij zoeken jou', 'Utrecht', 1), job('Alle vacatures', 'Utrecht', 2)]}   # listed, none relevant
        for run in range(3):
            self.search_run(run, banner)
        self.assertEqual(board_yield.dead(self.db), {'b1.example'})
        self.fetched.clear()
        self.search_run(3, banner)
        self.assertEqual(self.fetched, [], 'not read again')

    def test_one_run_with_a_job_in_your_places_keeps_it_for_three_more(self):
        good = {'b1.example': [job('Controller', 'Amsterdam')]}
        for run, jobs in enumerate([{}, {}, good, {}, {}]):
            self.search_run(run, jobs)
        self.assertEqual(board_yield.dead(self.db), set(), 'the last 3 runs hold one with a relevant job')

    def test_a_board_whose_jobs_link_to_other_sites_keeps_its_reads_count(self):
        elsewhere = {'b1.example': [job('Controller', 'Amsterdam', host='careers.acme.example')]}
        for run in range(4):
            self.search_run(run, elsewhere)
        self.assertEqual(board_yield.dead(self.db), set())

    def test_the_boards_file_keeps_this_read_only(self):
        self.search_run(0, {'b1.example': [job('Wij zoeken jou', 'Utrecht')]})
        entry = board_ideas.load()['boards']['b1.example']
        self.assertEqual((entry['jobs'], entry['relevant'], entry['state']), (1, 0, 'ok'))
        self.assertNotIn('misses', entry, 'the history lives in source_yield, one copy')


class ShareTests(Fixture):
    def setUp(self):
        super().setUp()
        for patch in (mock.patch.object(feeds, 'wanted_location', lambda j: j['location'] in ('Amsterdam', 'Remote')),
                      mock.patch.object(feeds, 'in_my_place', lambda j: j['location'] == 'Amsterdam')):
            patch.start()
            self.addCleanup(patch.stop)

    def test_a_board_fact_carries_what_the_board_gave_this_search(self):
        self.search_run(0, {'b1.example': [job('Controller', 'Amsterdam', 1), job('Controller', 'Remote', 2)]}, boards=[board(1), board(2)])
        self.db.execute("INSERT INTO companies (id, name, updated_at) VALUES (1, 'Acme', ?)", (START.isoformat(),))
        self.db.execute("INSERT INTO sources (id, name, kind) VALUES (1, 'Job boards found', 'job board')")
        for n, place in ((1, 'Amsterdam'), (2, 'Remote')):   # the two jobs the board listed, saved
            self.db.execute('INSERT INTO jobs (id, canonical_key, source_id, company_id, title, url, location, first_seen_at, last_seen_at, state) '
                            "VALUES (?, ?, 1, 1, 'Controller', ?, ?, ?, ?, 'open')", (n, f'k{n}', f'https://b1.example/job/Controller{place}{n}', place, START.isoformat(), START.isoformat()))
        source_yield.run(self.db, (START + timedelta(hours=1)).isoformat(timespec='seconds'))
        facts = {fact['host']: fact for fact in contribute.site_facts(db=self.db) if fact['kind'] == 'board'}
        self.assertEqual(facts['b1.example']['board'], {'countries': ['nl']})
        self.assertEqual(facts['b1.example']['yield'], {'in_places': 1, 'fit70': 0}, 'the remote job is in your places for you but is not shared as local')
        self.assertNotIn('b2.example', facts, 'a board that listed nothing is not a fact')
        self.assertNotIn('yield', contribute.site_facts()[0], 'no job cache, no counts')


class RankTests(Fixture):
    def served(self, cells_by_host):
        return {'board': {f'b{n}.example': {'url': f'https://b{n}.example/?q={{role}}', 'countries': ['nl'], 'relevant': cells}
                          for n, cells in cells_by_host.items()}}

    def cell(self, family, installs, in_places, fit70=0, country='nl'):
        return {'family': family, 'country': country, 'installs': installs, 'in_places': in_places, 'fit70': fit70}

    def test_boards_are_ranked_by_jobs_in_places_per_install_for_your_role_families(self):
        facts = self.served({1: [self.cell('accounting_finance', 3, 6)], 2: [self.cell('accounting_finance', 4, 40), self.cell('software_dev', 9, 900)],
                             3: [], 4: [self.cell('software_dev', 5, 500)], 5: [self.cell('accounting_finance', 3, 9, country='de')]})
        with mock.patch.object(visits_jobpages, 'pool_facts', return_value=facts), \
                mock.patch.object(board_ideas, '_families', return_value={'accounting_finance'}), \
                mock.patch('src.places.countries', return_value=['Netherlands']):
            ranked = board_ideas.ranked(board_ideas.served(['Netherlands']), SEARCH)
            proven = board_ideas.proven(SEARCH)
        self.assertEqual([(b['host'], b['rank']) for b in ranked][:2], [('b2.example', 10.0), ('b1.example', 2.0)])
        self.assertEqual({b['host'] for b in ranked[2:]}, {'b3.example', 'b4.example', 'b5.example'}, 'another family or country gives no rank')
        self.assertEqual([b['host'] for b in proven], ['b2.example', 'b1.example'], 'the top 2, ranked boards only')

    def test_without_data_for_anyone_the_order_is_unchanged_and_no_family_is_asked(self):
        with mock.patch.object(visits_jobpages, 'pool_facts', return_value=self.served({1: [], 2: []})), \
                mock.patch.object(board_ideas, '_families', side_effect=AssertionError('no labels needed')):
            self.assertEqual([b['host'] for b in board_ideas.ranked(board_ideas.served(['Netherlands']), SEARCH)], ['b1.example', 'b2.example'])

    def test_a_ranked_board_claude_also_proposed_keeps_its_rank(self):
        merged = board_ideas._merge([board(2), board(7)], [{**board(2), 'rank': 4.0}, board(1)])
        self.assertEqual([(b['host'], b.get('rank')) for b in merged], [('b2.example', 4.0), ('b1.example', None), ('b7.example', None)])

    def test_the_index_cells_are_read_in_their_fixed_shape_only(self):
        index = {'sites': [{'host': 'b1.example', 'kind': 'board', 'url': 'https://b1.example/?q={role}', 'recipe': {'countries': ['nl']},
                            'relevant': [self.cell('accounting_finance', 3, 6), {'family': 'x', 'country': 'nl', 'installs': 'many'}, 'junk']}]}
        cache = self.data / 'employer_index.json'
        cache.write_text(json.dumps(index))
        with mock.patch('src.employer_index.CACHE', cache):
            facts = POOL_FACTS()   # the real reader, not the fixture's stand-in
        self.assertEqual(facts['board']['b1.example']['relevant'], [self.cell('accounting_finance', 3, 6)])


class FirstSliceTests(Fixture):
    def test_the_top_two_boards_are_read_in_the_first_slice_and_no_page_is_fetched_twice(self):
        """The full read asks those boards every query and their next pages (18 Oct 2026: a slice's 2-query read used to stand for the whole
        board, so its other queries and pages were never read); the pages the slice fetched are served from it, not asked again."""
        jobs = {'b1.example': [job('Controller', 'Amsterdam', 1)], 'b2.example': [job('Controller', 'Amsterdam', 2, host='b2.example')]}
        asked = []
        def fake(b, search, fetch, route=None, early=False, **kwargs):
            self.fetched.append((b['host'], early))
            fetch(f"https://{b['host']}/search")
            return jobs.get(b['host'], []), 'ok', None
        imported, said = [], []
        with feeds.database(self.data / 'jobs.sqlite') as feed_db, \
                mock.patch.object(board_ideas, 'proven', return_value=[board(1), board(2)]), \
                mock.patch.object(found_boards.careers, 'get_text', lambda url: asked.append(url) or '<html></html>'), \
                mock.patch.object(found_boards, 'read_board', fake), mock.patch.object(found_boards, '_dead', return_value=set()), \
                mock.patch.object(feeds, 'wanted_title', lambda title: title == 'Controller'), \
                mock.patch.object(feeds, 'wanted_location', lambda j: j['location'] == 'Amsterdam'), \
                mock.patch.object(board_employers, 'fill_missing'), mock.patch.object(board_employers, 'note'), \
                mock.patch.object(first_jobs.store, 'import_watch_report', lambda db, report: imported.extend(report['jobs']) or []), \
                mock.patch.object(first_jobs.score, 'queue', return_value=[]), mock.patch.object(first_jobs, 'to_score', return_value=[]):
            first_jobs.run(self.db, feed_db, [], profile='p', hidden=frozenset(), sync=lambda: None, say=said.append,
                           scan=lambda sources, db: {'jobs': [], 'sources': []}, scorer=mock.Mock())
            self.assertEqual(sorted(j['url'] for j in imported), ['https://b1.example/job/ControllerAmsterdam1', 'https://b2.example/job/ControllerAmsterdam2'])
            self.assertTrue(any('Board 1, Board 2' in line for line in said), said)
            full = found_boards.read(SEARCH, [board(1), board(2), board(3)])
        self.assertEqual(sorted(self.fetched), [('b1.example', False), ('b1.example', True), ('b2.example', False), ('b2.example', True), ('b3.example', False)],
                         'the full read reads every board in full')
        self.assertEqual(sorted(url for url in asked if not url.endswith(('.example/', '/robots.txt'))), ['https://b1.example/search', 'https://b2.example/search', 'https://b3.example/search'],
                         'the pages the slice fetched are not asked again')
        self.assertEqual(len(full), 2, 'and still returns the slice\'s jobs')

    def test_with_no_proven_board_the_slice_reads_the_boards_proposed_for_your_country(self):
        """18 Oct 2026: a driver's jobs all came from a board, read only after 140 employer sites (176 s); no install had shared one yet."""
        said, read = [], []
        proposed = [board(1), board(2), board(3)]
        data = {'boards': {'b1.example': {'state': 'browser'}}}   # refused us before: a visit, not a slice read
        with mock.patch.object(board_ideas, 'proven', return_value=[]), mock.patch.object(board_ideas, 'ideas', return_value=proposed), \
                mock.patch.object(board_ideas, 'load', return_value=data), \
                mock.patch.object(found_boards, 'read', lambda search, boards, early=False, **_: read.append((boards, early)) or []), \
                mock.patch.object(first_jobs, 'aggregators_kept', lambda feed_db, name, jobs: jobs):
            first_jobs.proven_boards(None, said.append, SEARCH)
        self.assertEqual([([b['host'] for b in boards], early) for boards, early in read], [(['b2.example', 'b3.example'], True)])
        self.assertTrue(any('Board 2, Board 3' in line for line in said), said)

    def test_the_slice_reads_its_boards_while_the_employer_sites_are_read(self):
        """18 Oct 2026: SRE's slice had a 70+ among its employer-site jobs and still waited for 2 boards read after them."""
        import threading
        sites_reading, boards_reading = threading.Event(), threading.Event()

        def boards(say):   # ends only once the employer sites' read has started, and lets that read end: one after the other hangs
            boards_reading.set()
            self.assertTrue(sites_reading.wait(5), 'the employer sites were not read meanwhile')
            return []

        def scan(sources, db):
            sites_reading.set()
            self.assertTrue(boards_reading.wait(5), 'the boards were not read meanwhile')
            return {'jobs': [], 'sources': []}
        with mock.patch.object(first_jobs.store, 'import_watch_report', return_value=[]), \
                mock.patch.object(first_jobs.score, 'queue', return_value=[]), mock.patch.object(first_jobs, 'to_score', return_value=[]):
            first_jobs.run(self.db, None, [], profile='p', hidden=frozenset(), sync=lambda: None, say=lambda _: None, scan=scan,
                           scorer=mock.Mock(), boards=boards)
        self.assertTrue(sites_reading.is_set() and boards_reading.is_set())

    def test_no_proven_and_no_proposed_board_reads_nothing_and_says_nothing(self):
        said = []
        with mock.patch.object(board_ideas, 'proven', return_value=[]), mock.patch.object(board_ideas, 'ideas', return_value=[]), \
                mock.patch.object(found_boards, 'read') as read:
            self.assertEqual(first_jobs.proven_boards(None, said.append, SEARCH), [])
        read.assert_not_called()
        self.assertEqual(said, [])

    def test_the_search_slice_reads_proven_boards_without_an_ai_call(self):
        with mock.patch.object(visits_jobpages, 'pool_facts', return_value={}), \
                mock.patch('src.places.countries', return_value=['Netherlands']), \
                mock.patch.object(board_ideas, 'ideas', side_effect=AssertionError('the slice never asks the AI for boards')):
            self.assertEqual(board_ideas.proven(SEARCH), [])


if __name__ == '__main__':
    unittest.main()
