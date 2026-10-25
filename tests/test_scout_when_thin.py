"""An install's scout adds new names only when the shared list is thin for its search (owner, 20 Oct 2026: "Central + Mac only when thin"):
when the downloaded employer list already has scout_cells.FLOOR employers that mostly hire for the search's kind of work in its places, the
install skips the name-finding steps and checks only the names the person added. No network."""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import scout, scout_core, scout_need, source_yield
from src import store as job_store
from src.scout_cells import FLOOR
from tests.test_budget_tape import contextlib_quiet
from tests.test_scout import SEEDS

DRIVER = {'role_keywords': ['chauffeur', 'fahrer'], 'locations': {'top_tier': ['Nürnberg'], 'country_wide': [], 'abroad': []}}


def index_file(folder, n, kind='logistics', place='Nürnberg'):
    feeds = [{'company': f'Co{i}', 'ats': 'greenhouse', 'slug': f'co{i}', 'places': [place], 'kinds': {kind: 0.8, 'other': 0.2}} for i in range(n)]
    path = Path(folder) / 'employer_index.json'
    path.write_text(json.dumps({'fetched': '2026-10-20T12:00:00+00:00', 'feeds': feeds}))
    return path


def yield_db(hits):
    """A job cache whose last measured run gave `hits` jobs in the person's places (None: no run measured yet)."""
    db = sqlite3.connect(':memory:')
    if hits is not None:
        source_yield.record(db, '2026-10-20T10:00:00', [dict.fromkeys(source_yield.FIELDS, 0) | {'kind': 'employer', 'source': 'Co1', 'in_places': hits}])
    return db


class CoveredTest(unittest.TestCase):
    def covered(self, n, hits=scout_need.MIN_HITS, **kw):
        with tempfile.TemporaryDirectory() as folder, mock.patch('src.sources.feeds.wanted_location', lambda job: job['location'] == 'Nürnberg'):
            return scout_need.covered(DRIVER, index_file(folder, n, **kw), db=yield_db(hits))

    def test_a_long_index_list_is_not_cover_when_the_search_itself_found_next_to_nothing(self):
        """The pilot search (26 Oct 2026): 1,000+ office employers filed under its kind, 0 hits, and the scout still found no new names."""
        self.assertIsNone(self.covered(FLOOR * 40, hits=0))
        self.assertIsNone(self.covered(FLOOR * 40, hits=scout_need.MIN_HITS - 1))
        self.assertIsNone(self.covered(FLOOR * 40, hits=None))   # never measured: thin

    def test_enough_employers_of_the_kind_in_the_places_cover_the_search(self):
        self.assertEqual(self.covered(FLOOR), FLOOR)

    def test_too_few_another_kind_or_another_place_leave_it_thin(self):
        self.assertIsNone(self.covered(FLOOR - 1))
        self.assertIsNone(self.covered(FLOOR, kind='software'))
        self.assertIsNone(self.covered(FLOOR, place='Lyon'))

    def test_no_list_or_an_unknown_kind_of_work_means_scout_as_before(self):
        self.assertIsNone(scout_need.covered(DRIVER, Path(tempfile.gettempdir()) / 'no-such-index.json'))
        with tempfile.TemporaryDirectory() as folder:
            self.assertIsNone(scout_need.covered({'role_keywords': []}, index_file(folder, FLOOR)))


class RunTest(unittest.TestCase):
    def run_scout(self, covered):
        steps, probed = [], []

        def probe(system, slug):
            probed.append(slug)
            return []
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, contextlib_quiet(), \
                mock.patch.object(scout_core, 'CENTRAL', False), mock.patch.object(scout_need, 'covered', lambda *a, **k: covered), \
                mock.patch.object(scout, 'harvest', mock.Mock(side_effect=lambda *a, **k: steps.append('harvest') or 0)), \
                mock.patch.object(scout, 'ai_ideas', lambda *a: steps.append('ideas')), \
                mock.patch.object(scout.scout_role_search, 'guarded', lambda *a: steps.append('role search')), \
                mock.patch.object(scout, 'load_search_config', lambda: DRIVER):
            scout_core.ensure_tables(db)
            for name, status in (('Waiting Co', 'pending'), ('My Own Co', 'manual')):
                db.execute("INSERT INTO scout_candidates (key, name, origin, priority, status, added_at) VALUES (?, ?, 'x', 50, ?, '2026-10-20T10:00:00')",
                           (name.lower().replace(' ', ''), name, status))
            db.commit()
            summary, results = scout.run(db, batch=10, seeds=SEEDS, static=[], probe=probe, workers=1)
        return steps, sorted(candidate['name'] for candidate, _ in results), summary

    def test_a_covered_search_finds_no_new_names_and_checks_only_the_persons_own(self):
        steps, checked, summary = self.run_scout(covered=FLOOR + 5)
        self.assertEqual(steps, [])
        self.assertEqual(checked, ['My Own Co'])
        self.assertEqual(summary.get('covered'), FLOOR + 5)

    def test_a_thin_search_scouts_as_before(self):
        steps, checked, summary = self.run_scout(covered=None)
        self.assertEqual(steps, ['harvest', 'ideas', 'role search'])
        self.assertEqual(checked, ['My Own Co', 'Waiting Co'])
        self.assertNotIn('covered', summary)


if __name__ == '__main__':
    unittest.main()
