"""The scout end to end on a fixture site, with no network: candidate with a website -> careers page found -> feed registered -> the normal
crawl reads that feed -> the job is stored. The unit tests cover each piece; this covers the seams between them. Also the contract with the
website's index validator (api/employers.js), which is JavaScript with its own pattern for a feed's slug."""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src import employer_index, scout  # noqa: E402
from src.sources import ats, careers, feeds  # noqa: E402
from site_private import assert_site_accepts, needs_site  # noqa: E402

# The title and the places match the example search (data analyst; Amsterdam) and the owner's own (site reliability; Zürich) alike,
# so the test is the same in CI and on a machine whose terminal follows the Desktop App's settings.
TITLE = 'Site Reliability Engineer / Data Analyst'
JOB = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': TITLE, 'datePosted': '2026-10-01', 'description': 'SQL and dbt.',
       'jobLocation': [{'address': {'addressLocality': 'Amsterdam', 'addressCountry': 'NL'}}, {'address': {'addressLocality': 'Zürich', 'addressCountry': 'CH'}}]}


def page(body='', job=None):
    block = f'<script type="application/ld+json">{json.dumps(job)}</script>' if job else ''
    return f'<html><body>{body}{block}</body></html>'


class ScoutEndToEnd(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        files = {'jobs-1.html': page('<h1>Site Reliability Engineer / Data Analyst</h1>', {**JOB, 'url': 'https://acme.example/jobs/data-analyst'}),
                 'jobs.html': page('<a href="/jobs/data-analyst">Site Reliability Engineer / Data Analyst</a>'),
                 'home.html': page('<a href="/karriere">Karriere</a>')}
        for name, text in files.items():
            (Path(self.dir) / name).write_text(text)
        # The first matching route wins, so the most specific address comes first.
        (Path(self.dir) / 'routes.json').write_text(json.dumps({'acme.example/jobs/data-analyst': 'jobs-1.html', 'acme.example/karriere': 'jobs.html', 'acme.example': 'home.html'}))
        patch = mock.patch.dict(os.environ, {'JOBADABRA_FIXTURE_DIR': self.dir})
        patch.start()
        self.addCleanup(patch.stop)
        saved = careers.READER, careers.RENDER
        careers.READER = careers.RENDER = None
        self.addCleanup(lambda: (setattr(careers, 'READER', saved[0]), setattr(careers, 'RENDER', saved[1])))
        self.assertTrue(feeds.wanted_title(TITLE) and feeds.wanted_location({'location': 'Amsterdam, Netherlands; Zürich, Switzerland'}), 'the fixture job must match the search in use')

    def test_a_website_becomes_a_feed_and_the_crawl_reads_its_job(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        import contextlib
        import io
        said = io.StringIO()
        with contextlib.redirect_stdout(said):
            summary, results = scout.run(db, batch=5, stores=None, seeds={'excluded': []}, static=[],
                                         harvest_sources=[lambda: [dict(name='Acme AG', origin='SwissDevJobs employer', priority=88, website='https://acme.example')]])
        # The app streams these lines into Recent activity while the run works: a silent four-minute crawl showed "Nothing to show yet" (5 Oct 2026).
        for line in ('Scout: reading the employer lists', 'Scout: checking 1 employer', 'Scout: checked 1 of 1: Acme AG'):
            self.assertIn(line, said.getvalue())
        (candidate, outcome), = results
        self.assertEqual((outcome['status'], outcome['ats'], outcome['slug']), ('found', 'careers', 'acme.example__karriere'))
        self.assertEqual(db.execute("SELECT ats, slug, company FROM feed_sources").fetchall()[0][:], ('careers', 'acme.example__karriere', 'Acme AG'))
        self.assertEqual(summary['total_feeds'], 1)

        # The 4-hourly crawl: the registered feed is read like any other and the job lands in the feed history.
        sources = scout.active_sources(db, None, [], [])
        self.assertEqual([(s['ats'], s['slug']) for s in sources], [('careers', 'acme.example__karriere')])
        with feeds.database(Path(self.dir) / 'feeds.sqlite') as feed_db:
            report = feeds.scan(sources, feed_db)
        self.assertEqual([(j['company'], j['title'], j['location']) for j in report['jobs']], [('Acme AG', TITLE, 'Amsterdam, Netherlands; Zürich, Switzerland')])
        self.assertEqual(report['sources'][0]['ok'], True)

    def test_a_site_with_nothing_to_read_ends_as_no_feed_and_is_not_asked_again_soon(self):
        (Path(self.dir) / 'routes.json').write_text(json.dumps({'acme.example': 'home.html'}))
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        scout.run(db, batch=5, stores=None, seeds={'excluded': []}, static=[],
                  harvest_sources=[lambda: [dict(name='Acme AG', origin='x', priority=50, website='https://acme.example')]])
        row = db.execute('SELECT status, next_check FROM scout_candidates').fetchone()
        self.assertEqual(row['status'], 'none')
        self.assertTrue(row['next_check'])


@needs_site
@unittest.skipUnless(shutil.which('node'), 'node is not installed')
class IndexContract(unittest.TestCase):
    """What Python writes into the employer index, the website's validator (JavaScript) must accept: else a feed vanishes when published."""

    def site_clean(self, feeds_in):
        script = ("import {clean} from './api/employers.js'; const feeds = JSON.parse(process.argv[1]);"
                  "console.log(JSON.stringify(clean(feeds).map(f => f.ats + ':' + f.slug)));")
        result = subprocess.run(['node', '--input-type=module', '-e', script, json.dumps(feeds_in)], cwd=ROOT, capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_every_kind_of_slug_the_engine_produces_passes_the_websites_validator(self):
        samples = {'greenhouse': 'acme', 'lever': 'acme', 'ashby': 'acme.ai', 'workable': 'acme', 'recruitee': 'acme', 'personio': 'acme',
                   'smartrecruiters': 'AcmeAG', 'teamtailor': 'acme', 'join': 'acme-ag', 'workday': 'zuehlke.wd3.Zuhlke-Careers', 'umantis': 'recruitingapp-2824', 'successfactors': 'careers.swissre.com', 'oracle': 'acme.us2.CX_1', 'phenom': 'careers.acme.com', 'eightfold': 'jobs.acme.com',
                   'careers': careers.encode('https://www.acme.ch/de/ueber-uns/karriere/stellenangebote'), 'jobsch': '27602-manor-ag'}
        self.assertEqual(set(samples), set(ats.FETCHERS) - {'amazon', 'netflix'} - ats.LOCAL_ONLY, 'a new feed type needs a sample here')
        sent = [{'company': f'Co {system}', 'ats': system, 'slug': slug} for system, slug in samples.items()]
        self.assertEqual(self.site_clean(sent), [f'{system}:{slug}' for system, slug in samples.items()])

    def test_the_website_and_the_engine_know_the_same_feed_types(self):
        import re
        for name in ('employers.js', 'pool.js'):
            text = (ROOT / 'api' / name).read_text()
            listed = set(re.findall(r"'([a-z]+)'", re.search(r'const SYSTEMS = \[(.*?)\]', text, re.S).group(1)))
            assert_site_accepts(self, set(ats.FETCHERS) - ats.LOCAL_ONLY, listed, f'api/{name} SYSTEMS must list every src/sources/ats.py FETCHERS type (local-only excepted)')

    def test_the_engine_keeps_what_the_index_serves(self):
        served = [{'company': 'Acme AG', 'ats': 'careers', 'slug': 'www.acme.ch__jobs', 'places': ['Zürich']}]
        self.assertEqual([(f['ats'], f['slug']) for f in employer_index.clean(served)], [('careers', 'www.acme.ch__jobs')])


if __name__ == '__main__':
    unittest.main()
