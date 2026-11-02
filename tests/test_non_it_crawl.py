"""The crawl for people who are not in IT: the search a draft proposed for a nurse and for an accountant keeps their roles, skips what
they would not want, and does not tell them to add engineering terms. Seconds, no AI: the search settings are real model output
saved in tests/fixtures/non_it/ (fictional people). The keywords are read when src/sources/feeds.py is imported, so each case runs in
its own process with JOBADABRA_LOCATIONS_FILE pointing at the fixture."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'tests' / 'fixtures' / 'non_it'

CRAWL = r'''
import json, sqlite3, sys
sys.path.insert(0, sys.argv[1])
from src import coverage
from src.sources import feeds
rows = json.loads(sys.argv[2])
posting = lambda i, title, place: {'id': str(i), 'title': title, 'location': place, 'url': f'https://x.test/{i}', 'date_posted': '',
                                   'description': 'd', 'remote': False, 'salary': ''}
db = sqlite3.connect(':memory:')
db.execute('CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))')
jobs = [posting(i, title, place) for i, (title, place) in enumerate(rows)]
report = feeds.scan([{'company': 'A', 'ats': 'lever', 'slug': 'a'}], db, fetcher=lambda source: jobs, details={})
keywords = json.loads(open(sys.argv[3]).read())['role_keywords']
verdict = coverage.verdict(report['funnel'], keywords, [])
print(json.dumps({'kept': sorted(job['title'] for job in report['jobs']), 'suggestions': [s['term'] for s in verdict['suggestions']],
                  'narrow': verdict['narrow']}))
'''

# A crowd of engineering postings in the same places: enough that an engineering vocabulary would have things to suggest.
ENGINEERING = [('Senior Software Engineer', '{place}'), ('Backend Developer', '{place}'), ('Software Engineer', '{place}')] * 4


def crawl(fixture, rows, place):
    rows = rows + [(title, where.format(place=place)) for title, where in ENGINEERING]
    # Why (31 Oct 2026, a8): the child is not a unit test process, so without a data folder it wrote the checkout's data/jobs.sqlite (tools/py-shards.py names such a leak).
    with tempfile.TemporaryDirectory() as data:
        env = {**os.environ, 'JOBADABRA_LOCATIONS_FILE': str(FIXTURES / fixture), 'JOBADABRA_CONFIG_DIR': str(ROOT / 'config'), 'JOBADABRA_DATA_DIR': data}
        done = subprocess.run([sys.executable, '-c', CRAWL, str(ROOT), json.dumps(rows), str(FIXTURES / fixture)],
                              capture_output=True, text=True, env=env, timeout=60)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout.strip().splitlines()[-1])


class NonItCrawlTest(unittest.TestCase):
    def test_a_nurse_keeps_nursing_roles_in_her_places_and_skips_the_rest(self):
        rows = [('Registered Nurse - Acute Medicine', 'Manchester, UK'), ('Band 6 Staff Nurse', 'Salford, UK'), ('Charge Nurse', 'Leeds, England'),
                ('Ward Sister - Medical', 'Manchester, UK'),
                ('Healthcare Assistant', 'Manchester, UK'), ('Student Nurse Placement', 'Manchester, UK'), ('Paediatric Nurse', 'Manchester, UK'),
                ('Registered Nurse', 'Sydney, Australia'), ('Hospital Cleaner', 'Manchester, UK')]
        said = crawl('nurse_search.json', rows, 'Manchester, UK')
        self.assertEqual(said['kept'], ['Band 6 Staff Nurse', 'Charge Nurse', 'Registered Nurse - Acute Medicine', 'Ward Sister - Medical'])
        self.assertEqual(said['suggestions'], [], 'a nurse is not offered engineering terms')
        self.assertFalse(said['narrow'])

    def test_an_accountant_keeps_german_and_english_titles_and_skips_internships(self):
        rows = [('Bilanzbuchhalter (m/w/d)', 'Hamburg, Germany'), ('Senior Accountant', 'Hamburg'), ('Finanzbuchhalter', 'München, Germany'),
                ('Praktikant Buchhaltung', 'Hamburg, Germany'), ('Werkstudent Controlling', 'Hamburg, Germany'),
                ('Accountant', 'London, UK'), ('Kassierer', 'Hamburg, Germany')]
        said = crawl('accountant_search.json', rows, 'Hamburg, Germany')
        self.assertEqual(said['kept'], ['Bilanzbuchhalter (m/w/d)', 'Finanzbuchhalter', 'Senior Accountant'])
        self.assertEqual(said['suggestions'], [])
        self.assertFalse(said['narrow'])

    def test_the_fixtures_are_what_a_draft_looks_like(self):
        for name in ('nurse_search.json', 'accountant_search.json'):
            search = json.loads((FIXTURES / name).read_text())
            self.assertTrue(search['role_keywords'] and search['locations']['top_tier'], name)


if __name__ == '__main__':
    unittest.main()
