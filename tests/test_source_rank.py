"""Each field + place remembers which sources worked, for every user (spec docs/superpowers/specs/2026-10-18-search-learns-sources.md item B;
owner, 26 Oct 2026: "Parallel + learned"). 25-26 Oct 2026: a "First Officer, Europe" search read 1,025 then 1,123 office employers (48,265 jobs)
for 6 minutes and found 0; owner: "it shouldn't check 1200 employers if we know about them they don't have jobs for aviation. If we don't know,
we should save this information for each employer". Before: only boards were ranked across installs, employer feeds never; nothing timed a read.
After: every feed read fine is shared with its local jobs, fit 70+ and seconds; the index's ranking per role kind × country orders a run's
sources (proven first, per minute), skips the proven dead, and gives 1 slot in 5 to an untried one."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import contribute, contribute_yield, source_rank, source_yield, store
from src.sources import feed_scan, feeds

RUN = '2026-10-26T10:00:00+00:00'
CELL = lambda proven=(), dead=(): {'proven': [dict(item) for item in proven], 'dead': list(dead)}  # noqa: E731
P = lambda kind, source, local, per_min, installs=1, fit70=0: {'kind': kind, 'source': source, 'installs': installs, 'local': local,  # noqa: E731
                                                                'fit70': fit70, 'seconds': 1.0, 'per_run': local / installs, 'per_min': per_min}


class Fixture(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.cache = self.dir / 'employer_index.json'

    def index(self, ranking):
        self.cache.write_text(json.dumps({'feeds': [], 'ranking': ranking}))


class RankingTests(Fixture):
    def test_proven_first_by_jobs_per_minute_then_the_dead(self):
        self.index({'aviation|de': CELL([P('employer', 'lever:slowair', 9, 2.0), P('board', 'avjobs.example', 4, 30.0)], ['employer:greenhouse:office']),
                    'aviation|fr': CELL([P('employer', 'lever:slowair', 3, 5.0, installs=2)], ['employer:lever:fronly']),
                    'finance_admin|de': CELL([P('employer', 'greenhouse:office', 50, 99.0)])})
        ranked = source_rank.ranked_sources({}, ['Germany', 'fr'], kinds=['aviation'], cache=self.cache)
        self.assertEqual([(s['state'], s['kind'], s['source']) for s in ranked],
                         [('proven', 'board', 'avjobs.example'), ('proven', 'employer', 'lever:slowair'),
                          ('dead', 'employer', 'greenhouse:office'), ('dead', 'employer', 'lever:fronly')])
        slow = ranked[1]
        self.assertEqual((slow['installs'], slow['per_run'], slow['per_min']), (3, 4.0, 5.0), 'two countries summed; the best per minute kept')

    def test_a_source_proven_in_one_of_your_cells_is_never_dead(self):
        self.index({'aviation|de': CELL([P('employer', 'lever:x', 2, 1.0)]), 'aviation|at': CELL(dead=['employer:lever:x'])})
        ranked = source_rank.ranked_sources({}, ['de', 'at'], kinds=['aviation'], cache=self.cache)
        self.assertEqual([s['state'] for s in ranked], ['proven'])

    def test_no_data_for_your_kind_and_countries_is_an_empty_ranking(self):
        self.index({'healthcare|de': CELL([P('employer', 'lever:x', 2, 1.0)])})
        self.assertEqual(source_rank.ranked_sources({}, ['de'], kinds=['aviation'], cache=self.cache), [])
        self.assertEqual(source_rank.ranked_sources({}, ['de'], kinds=[], cache=self.cache), [])
        self.assertEqual(source_rank.ranked_sources({}, ['de'], kinds=['aviation'], cache=self.dir / 'missing.json'), [])

    def test_the_served_ranking_is_read_in_its_fixed_shape_only(self):
        cleaned = source_rank.clean({'aviation|de': {'proven': [P('employer', 'lever:x', 2, 1.0), {'kind': 'evil', 'source': 'x', 'local': 1},
                                                                {'kind': 'board', 'source': 'b.example', 'local': 'many'}, 'junk'],
                                                     'dead': ['board:y.example', 'shell:rm', 7]},
                                     'no-pipe': CELL([P('employer', 'lever:y', 1, 1.0)]), 'a|b': 'junk'})
        self.assertEqual(list(cleaned), ['aviation|de'])
        self.assertEqual([s['source'] for s in cleaned['aviation|de']['proven']], ['lever:x'])
        self.assertEqual(cleaned['aviation|de']['dead'], ['board:y.example'])


class OrderTests(Fixture):
    def test_proven_first_one_untried_in_every_five_slots_and_the_dead_skipped(self):
        proven = [P('employer', f'lever:p{n}', 10 - n, 10.0 - n) for n in range(6)]
        self.index({'aviation|de': CELL(proven, ['employer:lever:dead1', 'board:deadboard.example'])})
        candidates = ([{'ats': 'lever', 'slug': f'u{n}', 'company': f'U{n}'} for n in range(3)] + [{'ats': 'lever', 'slug': 'dead1', 'company': 'D'}]
                      + [{'ats': 'lever', 'slug': f'p{n}', 'company': f'P{n}'} for n in reversed(range(6))]
                      + [{'host': 'www.deadboard.example', 'name': 'Dead board'}])
        ordered, skipped = source_rank.order(candidates, {}, ['de'], kinds=['aviation'], cache=self.cache)
        self.assertEqual([c.get('slug') for c in ordered], ['p0', 'p1', 'p2', 'p3', 'u0', 'p4', 'p5', 'u1', 'u2'])
        self.assertEqual([c.get('slug') or c.get('host') for c in skipped], ['dead1', 'www.deadboard.example'])

    def test_without_a_ranking_the_order_is_unchanged_and_nothing_is_skipped(self):
        candidates = [{'ats': 'lever', 'slug': 'a'}, {'host': 'b.example'}]
        self.assertEqual(source_rank.order(candidates, {}, ['de'], kinds=['aviation'], cache=self.dir / 'missing.json'), (candidates, []))


class ShareTests(Fixture):
    def test_every_feed_read_fine_is_shared_with_its_local_jobs_fit70_and_seconds(self):
        """Before: a feed went with jobs listed and matches only; one with nothing for you could never be told apart from one never measured."""
        given = {'Skyair': {'local': 3, 'fit70': 1}}
        self.assertEqual(contribute_yield.feed_counts(given, 'Skyair', {'ok': True, 'seconds': 2.4}), {'local': 3, 'fit70': 1, 'seconds': 2.4})
        self.assertEqual(contribute_yield.feed_counts(given, 'Office Co', {'ok': True, 'seconds': 1.0}), {'local': 0, 'fit70': 0, 'seconds': 1.0},
                         'read fine, no job in your places: 0, which is what makes it dead once 3 installs agree')
        self.assertEqual(contribute_yield.feed_counts(given, 'Broken', {'ok': False}), {}, 'a failed read says nothing about the source')
        self.assertIsNone(contribute_yield.employer_counts(None))

    def test_the_payload_carries_the_counts_per_feed(self):
        report = {'sources': [{'company': 'Skyair', 'ok': True, 'total': 40, 'matches': 3, 'seconds': 2.4},
                              {'company': 'Office Co', 'ok': True, 'total': 900, 'matches': 0, 'seconds': 6.0}]}
        feed_list = [{'company': 'Skyair', 'ats': 'lever', 'slug': 'skyair'}, {'company': 'Office Co', 'ats': 'greenhouse', 'slug': 'office'}]
        with tempfile.TemporaryDirectory() as tmp, store.connect(Path(tmp) / 'jobs.sqlite') as db, \
                mock.patch.object(contribute_yield, 'employer_counts', return_value={'Skyair': {'local': 3, 'fit70': 1}}), \
                mock.patch.object(contribute, 'tags', return_value=(['aviation'], ['europe'])), \
                mock.patch.object(contribute, 'fine_tags', return_value={'countries': ['de']}), \
                mock.patch.object(contribute, 'site_facts', return_value=[]):
            sent = {feed['slug']: feed for feed in contribute.payload(feed_list, report, db=db, search={})['feeds']}
        self.assertEqual({k: sent['skyair'][k] for k in ('local', 'fit70', 'seconds')}, {'local': 3, 'fit70': 1, 'seconds': 2.4})
        self.assertEqual({k: sent['office'][k] for k in ('local', 'fit70', 'seconds')}, {'local': 0, 'fit70': 0, 'seconds': 6.0})


class TimingTests(unittest.TestCase):
    def tearDown(self):
        source_yield._timed.clear()

    def test_each_employer_read_is_timed_and_said_in_the_report(self):
        with tempfile.TemporaryDirectory() as tmp, store.connect(Path(tmp) / 'jobs.sqlite') as db, \
                mock.patch.object(feeds, 'triage_places'), mock.patch.object(feeds, 'triage'), \
                mock.patch.object(feeds, 'wanted_location', return_value=False), mock.patch.object(feeds, 'sure_title', return_value=False):
            report = feed_scan.scan([{'company': 'Skyair', 'ats': 'lever', 'slug': 'skyair'}], db,
                                    fetcher=lambda source: [{'id': 1, 'title': 'Pilot', 'location': 'Berlin', 'url': 'https://x.test/1'}])
        self.assertIsInstance(report['sources'][0]['seconds'], float)
        self.assertIn(('employer feed', 'Skyair'), source_yield._timed)

    def test_seconds_reach_the_run_rows_and_the_web_search_is_a_source_of_its_own(self):
        with tempfile.TemporaryDirectory() as tmp, store.connect(Path(tmp) / 'jobs.sqlite') as db:
            db.execute("INSERT INTO companies (id, name, updated_at) VALUES (1, 'X', ?)", (RUN,))
            db.executemany('INSERT INTO sources (id, name, kind) VALUES (?, ?, ?)', [(1, 'Skyair', 'employer feed'), (2, 'Job boards found', 'job board')])
            for n, source, url in ((1, 1, 'https://skyair.test/1'), (2, 2, 'https://www.avjobs.test/2'), (3, 2, 'https://www.avjobs.test/3')):
                db.execute('INSERT INTO jobs (id, canonical_key, source_id, company_id, title, url, location, first_seen_at, last_seen_at, state) '
                           "VALUES (?, ?, ?, 1, 'First Officer', ?, 'Berlin', ?, ?, 'open')", (n, f'k{n}', source, url, RUN, RUN))
            source_yield.timed('employer feed', 'Skyair', 2.5)
            source_yield.timed('job board', 'www.avjobs.test', 4.0)
            with mock.patch('src.ai.board_ideas.load', return_value={'boards': {'avjobs.test': {'origin': 'web'}}}), \
                    mock.patch.object(feeds, 'in_my_place', return_value=True):
                rows = {row['source']: row for row in source_yield.measure(db, RUN, in_places=lambda job: True)}
                source_yield.record(db, RUN, list(rows.values()))
                self.assertEqual(source_yield.board_counts(db), {'avjobs.test': {'in_places': 2, 'fit70': 0, 'seconds': 4.0}})
                self.assertEqual(source_yield.employer_counts(db), {'Skyair': {'local': 1, 'fit70': 0}})
        self.assertEqual(rows['Skyair']['seconds'], 2.5)
        self.assertEqual((rows['web search']['kind'], rows['web search']['local'], rows['web search']['seconds']), ('web search', 2, 4.0))


if __name__ == '__main__':
    unittest.main()
