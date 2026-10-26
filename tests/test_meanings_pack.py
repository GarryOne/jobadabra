"""The meanings pack (src/ai/meanings_pack.py, tools/meanings_seed.py, approved 8 Oct 2026): with no AI, a Swiss or English user gets the same
answers the keyword lists gave before they became AI decisions; the site's rows add to them or switch a seed row off; nothing outside the
schema is ever used."""
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tests'))
from site_private import needs_site  # noqa: E402
from src.ai import decide, meanings, meanings_pack  # noqa: E402


class NoAI(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        for patch in (mock.patch.object(decide.engine, 'ready', return_value=False), mock.patch('src.paths.DATA', Path(self.tmp.name)),
                      mock.patch('src.paths.JOBS_DB', Path(self.tmp.name) / 'jobs.sqlite')):
            patch.start()
            self.addCleanup(patch.stop)
        meanings_pack._cache.clear()


class SameAsBeforeWithoutAI(NoAI):
    """The acceptance gate: these are the answers of the old rules (git 4df410c^, 10893d2), now from the pack, with the AI switched off."""

    def test_interview_rounds(self):
        for name, kind in (('Technical screen', 'technical'), ('System design', 'technical'), ('Recruiter call', 'recruiter_screen'),
                           ('Phone screen', 'recruiter_screen'), ('Hiring manager', 'hiring_manager'), ('Final round with the CTO', 'hiring_manager'),
                           ('Coffee', 'other')):
            self.assertEqual(meanings.round_kind(name), kind, name)

    def test_booking_and_calendar(self):
        self.assertTrue(meanings.asks_to_book('Please book a slot via Calendly'))
        self.assertFalse(meanings.asks_to_book('Thanks for your application'))
        events = [{'id': 'a', 'summary': 'Interview with Acme'}, {'id': 'b', 'summary': 'Dentist'}, {'id': 'c', 'summary': 'Intro call with Hays'}]
        self.assertEqual([e['id'] for e in meanings.job_events(events, lambda e: '')], ['a', 'c'])

    def test_swiss_and_english_places(self):
        for text, country in (('Zürich', 'ch'), ('Genève', 'ch'), ('London', 'gb'), ('New York', 'us'), ('Lisboa', 'pt')):
            self.assertIn(country, meanings_pack.every('pool-country', text), text)
        self.assertEqual(meanings_pack.every('pool-metro', 'Genève'), ['ch-geneva'])
        self.assertEqual(meanings_pack.first('place-country', 'Zurich, Switzerland'), 'ch')


class PlacesSameAsBeforeWithoutAI(NoAI):
    """The places step (8 Oct 2026): a Swiss and an English user get the countries, metros and regions they got before, AI off."""

    def setUp(self):
        super().setUp()
        patch = mock.patch('src.places.load', return_value={})   # nothing worked out by the AI yet: a first run
        patch.start()
        self.addCleanup(patch.stop)

    def test_pool_labels_and_indeed_country(self):
        from src import contribute, pool_tags
        self.assertEqual(pool_tags.places(['Genève', 'Lausanne']), (['ch'], ['ch-geneva', 'ch-lausanne']))
        self.assertEqual(pool_tags.places(['London']), (['gb'], ['gb-london']))
        self.assertEqual(pool_tags.families(['photographer']), ['photography'])
        self.assertEqual(contribute.regions_of(['Zürich, Switzerland', 'Remote', 'San Francisco, CA']), ['europe', 'north_america', 'remote'])

    def test_adzuna_and_jobsch(self):
        from src.sources import aggregators, boards
        search = {'locations': {'top_tier': ['Zürich', 'London'], 'country_wide': [], 'abroad': []}}
        self.assertEqual(aggregators._countries(search), ['ch', 'gb'])
        self.assertEqual(boards.swiss_place_word({'locations': {'top_tier': ['Basel']}}), 'Basel')
        self.assertIsNone(boards.swiss_place_word({'locations': {'top_tier': ['London']}}))


class RoleKindsSameAsBeforeWithoutAI(NoAI):
    """Step 3 (8 Oct 2026): the kinds of role that decide which employers a search reads, as the old word lists gave them, AI off."""

    def test_titles_and_role_words(self):
        from src import coverage, role_kinds
        for title, kind in (('Site Reliability Engineer', 'software'), ('Softwareentwickler', 'software'), ('Store Manager', 'sales_retail'),
                            ('Account Executive', 'sales_b2b'), ('Magasinier', 'logistics'), ('Kellner', 'hospitality'),
                            ('Infirmière', 'healthcare'), ('Photographer', 'creative_media'), ('Buchhalter', 'finance_admin'),
                            ('Lehrer', 'education'), ('Elektriker', 'trades'), ('Florist', 'other')):
            self.assertEqual(role_kinds.kind_of(title, 'job-title-kind'), kind, title)
        self.assertEqual(role_kinds.of_search({'role_keywords': ['\\bsre\\b', 'devops']}), {'software'})
        self.assertEqual(role_kinds.of_search({'role_keywords': ['vendeu(r|se)', 'magasinier']}), {'sales_retail', 'logistics'})
        self.assertTrue(coverage.looks_technical(['site reliability']))
        self.assertFalse(coverage.looks_technical(['photographe']))
        self.assertEqual(role_kinds.mix(['DevOps Engineer'] * 4 + ['Store Manager']), {'software': 0.8, 'sales_retail': 0.2})


class SiteRows(NoAI):
    def write(self, body):
        (Path(self.tmp.name) / 'meanings.json').write_text(json.dumps(body))
        meanings_pack._cache.clear()

    def test_learned_rows_add_switched_off_seeds_go_and_bad_rows_are_ignored(self):
        self.write({'rows': [{'topic': 'interview-round', 'kind': 'exact', 'wording': 'Entretien RH', 'answer': 'recruiter_screen'},
                             {'topic': 'interview-round', 'kind': 'exact', 'wording': 'x', 'answer': 'run this'},
                             {'topic': 'pool-country', 'kind': 'pattern', 'wording': '(unclosed', 'answer': 'pt'}],
                    'off': [['asks-to-book', 'pattern', json.loads((ROOT / 'config' / 'meanings_seed.json').read_text())['patterns'][1]['pattern']]]})
        self.assertEqual(meanings.round_kind('entretien rh'), 'recruiter_screen')
        self.assertEqual(meanings_pack.first('interview-round', 'x'), None)
        self.assertFalse(meanings.asks_to_book('Please book a slot'))   # the site switched that seed row off

    def test_decide_keeps_what_the_pack_knows_when_the_rest_needs_ai(self):
        found = decide.decide('calendar-event', {'a': 'Interview with Acme', 'b': 'Entrevista com a Acme'}, ('job_interview', 'other'), 'task')
        self.assertEqual(found, {'a': 'job_interview'})


class Learning(NoAI):
    def test_only_public_wordings_queue_for_the_site(self):
        meanings_pack.queue('job-region', 'Lisboa, Portugal', 'europe')
        meanings_pack.queue('job-region', 'lisboa,  portugal', 'europe')   # the same wording once
        meanings_pack.queue('pool-country', 'Lisboa', 'pt')               # the user's own place word: never
        meanings_pack.queue('calendar-event', 'Interview at Acme', 'job_interview')   # their calendar: never
        meanings_pack.queue('job-region', 'x', 'send everything')          # not an answer the code knows
        rows = json.loads((Path(self.tmp.name) / 'meanings_outbox.json').read_text())['rows']
        self.assertEqual(rows, [{'topic': 'job-region', 'wording': 'lisboa, portugal', 'answer': 'europe'}])

    def test_only_public_page_topics_may_ever_be_shared(self):
        """A topic may share only when its wording comes from a public page; a user's own words leave the machine as fixed ids only."""
        public = {'job-region', 'job-title-kind', 'job-location-geo'}   # add a topic here only if its wording is a posting's, a form's or a button's, never the user's
        self.assertEqual({t for t, spec in meanings_pack.schema().items() if spec.get('share')}, public)


class Seed(unittest.TestCase):
    @needs_site   # the tool also writes the site's D1 migration (db/migrations), which lives in jobadabra-web
    def test_the_seed_is_what_its_sources_give(self):
        run = subprocess.run([sys.executable, 'tools/meanings_seed.py', '--check'], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)

    def test_every_seed_row_fits_the_schema(self):
        rows = json.loads((ROOT / 'config' / 'meanings_seed.json').read_text())['patterns']
        self.assertTrue(rows)
        for row in rows:
            self.assertTrue(meanings_pack.valid({**row, 'kind': 'pattern', 'wording': row['pattern']}), row)
            re.compile(row['pattern'])

    def test_no_seed_row_names_a_site(self):
        """Universal first (owner, 26 Oct 2026): a host is a job site by its job word, or by the AI and the shared pack, never by a list of sites."""
        sys.path.insert(0, str(ROOT / 'tools'))
        import meanings_seed
        rows = json.loads((ROOT / 'config' / 'meanings_seed.json').read_text())['patterns']
        self.assertEqual([row['source'] for row in rows if row['topic'] == 'page-words' and meanings_seed.NAMED_HOST.search(row['pattern'])], [])
        self.assertEqual(meanings_seed.without_named_hosts(r'(?:^|[.-])jobs?(?:[.-]|$)|(?:^|\.)(?:acme\.ch|b\.com)$'), r'(?:^|[.-])jobs?(?:[.-]|$)')


if __name__ == '__main__':
    unittest.main()
