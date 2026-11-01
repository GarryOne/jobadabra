"""A pasted job link is scored and written to Job Matches as Open. It is not an application."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import desktop, import_url, store

FACTS = {'languages': [], 'english_is_enough': {'value': 'yes', 'evidence': ''},
         'seniority': {'value': 'senior', 'evidence': ''}, 'work_mode': {'value': 'remote', 'remote_scope': 'Europe', 'evidence': ''},
         'workload': {'value': '100%', 'evidence': ''}, 'salary': {'stated': True, 'text': '€70k–90k'},
         'employer_type': {'value': 'recruiter', 'evidence': ''}, 'role_family': 'DevOps', 'technologies': ['AWS', 'EKS'],
         'on_call': {'value': 'unknown', 'evidence': ''}, 'visa_sponsorship': {'value': 'unknown', 'evidence': ''},
         'confidence': 'high'}
FIT = {'score': 81, 'tier': 'A', 'reason': 'AWS/EKS ownership', 'strengths': ['EKS'], 'gaps': ['Aurora'], 'confidence': 'high',
       'components': {'role_fit': 90, 'location': 80, 'compensation': 60, 'growth': 70, 'risk': 40}}
POSTING = 'Own AWS and EKS: networking, DNS, load balancing. Run Aurora PostgreSQL in production. Terraform + Argo CD. ' * 2
URL = 'https://boards.greenhouse.io/acme/jobs/1'
AI_ON = {'ANTHROPIC_API_KEY': 'sk-test', 'NOTION_TOKEN': 'secret-test',
         'JOBADABRA_ENRICH_MODEL': 'claude-haiku-5-5', 'JOBADABRA_SCORE_MODEL': 'claude-sonnet-5-5'}
META = {'title': 'Senior DevOps Engineer', 'company': 'Acme', 'location': 'Remote', 'description': POSTING}


class Client:
    def __init__(self, *answers):
        self.answers, self.calls, self.messages = list(answers), [], self

    def create(self, **params):
        self.calls.append(params['model'])
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(self.answers.pop(0)))],
                               stop_reason='end_turn',
                               usage=SimpleNamespace(input_tokens=1000, output_tokens=300, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))


def memory_store(profile_text=''):
    from src.stores import memory
    stores = memory.open_store()
    if profile_text:
        stores.texts.set('profile', profile_text)
    return stores


class ImportUrlTests(unittest.TestCase):
    """On the memory store (every store takes the same path; Notion's pages: tests/test_daily_store_notion.py ImportOnNotionTests)."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = store.connect(Path(self.tmp.name) / 'jobs.sqlite')

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def run_import(self, stores, client, url=URL, meta=META, profile='Profile: SRE in Zurich'):
        with mock.patch.dict('os.environ', AI_ON, clear=False), \
                mock.patch.object(import_url.ledger, 'page_meta', lambda _url: dict(meta)), \
                mock.patch.object(import_url, 'local_profile', lambda: profile):
            return import_url.run(self.db, url, stores=stores, client=client, stats={})

    def test_a_link_is_scored_and_written_as_an_open_match_not_an_application(self):
        stores, client = memory_store(), Client(FACTS, FIT)
        outcome = self.run_import(stores, client)
        self.assertTrue(outcome['ok'])
        self.assertTrue(outcome['created'])
        self.assertIn('fit 81/100, tier A', outcome['line'])
        self.assertEqual(client.calls, ['claude-haiku-5-5', 'claude-sonnet-5-5'])
        self.assertEqual(stores.applications.list(), [])
        [match] = stores.matches.list()
        self.assertEqual((match['status'], match['url'], match['tier']), ('Open', URL, 'A'))
        self.assertEqual(outcome['row'], {'id': match['id'], 'title': 'Senior DevOps Engineer', 'url': URL, 'company': 'Acme'})
        row = self.db.execute(
            'SELECT jobs.notes, sources.name, sources.kind, applications.status FROM jobs '
            'JOIN sources ON sources.id = jobs.source_id JOIN applications ON applications.job_id = jobs.id'
        ).fetchone()
        self.assertEqual((row['notes'], row['name'], row['kind'], row['status']),
                         ('imported', 'Imported link', 'job board', 'unreviewed'))
        again = self.run_import(stores, Client(FACTS, FIT))
        self.assertFalse(again['created'])
        self.assertEqual(again['row']['id'], match['id'])
        self.assertEqual(len(stores.matches.list()), 1)

    def test_a_board_link_is_stored_as_the_posting_the_crawl_would_store(self):
        canonical = 'https://n26.com/en-eu/careers/positions/7768035?gh_jid=7768035'
        stores = memory_store()
        outcome = self.run_import(stores, Client(FACTS, FIT), meta=dict(META, url=canonical))
        self.assertTrue(outcome['ok'])
        self.assertEqual([m['url'] for m in stores.matches.list()], [canonical])

    def test_a_match_already_there_is_updated_instead_of_added_again(self):
        stores = memory_store()
        stores.matches.upsert({'url': URL, 'title': 'Senior DevOps Engineer', 'company': 'Acme', 'status': 'Not seen'})
        outcome = self.run_import(stores, Client(FACTS, FIT))
        self.assertFalse(outcome['created'])
        [match] = stores.matches.list()
        self.assertEqual((match['status'], match['fit']), ('Open', 81))

    def test_an_unreadable_page_is_refused_before_any_model_call(self):
        client = Client(FACTS, FIT)
        with self.assertRaises(ValueError) as raised:
            self.run_import(memory_store(), client, meta={'title': 'Role', 'description': 'too short'})
        self.assertIn('could not be read', str(raised.exception))
        self.assertEqual(client.calls, [])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 0)

    def test_linkedin_is_refused_without_a_model_call(self):
        client = Client(FACTS, FIT)
        with mock.patch.dict('os.environ', AI_ON, clear=False), \
                mock.patch.object(import_url, 'local_profile', lambda: 'Profile: SRE'):
            with self.assertRaises(ValueError):
                import_url.run(self.db, 'https://www.linkedin.com/jobs/view/1', stores=memory_store(), client=client, stats={})
        self.assertEqual(client.calls, [])

    def test_a_job_already_in_applications_is_left_alone(self):
        stores = memory_store()
        stores.applications.create({'url': URL, 'title': 'Senior DevOps Engineer', 'company': 'Acme'}, 'Applied')
        client = Client(FACTS, FIT)
        outcome = self.run_import(stores, client)
        self.assertFalse(outcome['created'])
        self.assertIn('Already in your applications (Applied)', outcome['line'])
        self.assertEqual(client.calls, [])
        self.assertEqual(stores.matches.list(), [])

    def test_scoring_waits_for_a_profile_and_does_not_call_the_model(self):
        client = Client(FACTS, FIT)
        with self.assertRaises(ValueError) as raised:
            self.run_import(memory_store(), client, profile='')
        self.assertIn('profile', str(raised.exception).lower())
        self.assertEqual(client.calls, [])

    def test_the_profile_is_read_as_the_search_reads_it(self):
        """read_profile (store_access.profile_source: Notion's page text on Notion) comes before the store's Profile text."""
        stores, client = memory_store('Profile: from the store'), Client(FACTS, FIT)
        with mock.patch.dict('os.environ', AI_ON, clear=False), \
                mock.patch.object(import_url.ledger, 'page_meta', lambda _url: dict(META)), \
                mock.patch.object(import_url, 'local_profile', lambda: ''), \
                mock.patch.object(import_url.score, 'score_one', wraps=import_url.score.score_one) as scored:
            import_url.run(self.db, URL, stores=stores, read_profile=lambda: 'Profile: the search reads this', client=client, stats={})
        self.assertIn('the search reads this', scored.call_args.args[3])

    def test_an_imported_job_stays_in_the_list_when_its_company_is_excluded(self):
        self.run_import(memory_store(), Client(FACTS, FIT))
        notion_jobs = [{'url': URL, 'title': 'Senior DevOps Engineer', 'company': 'Acme',
                        'match_status': 'Open', 'fit': 81, 'reason': 'AWS/EKS ownership'}]
        with mock.patch.dict(desktop.digest.PREFERENCES, {'excluded_companies': ['Acme']}):
            shown = desktop.jobs(self.db, notion_jobs=notion_jobs)['jobs']
        self.assertEqual([job['url'] for job in shown], [URL])
        self.assertEqual(shown[0]['status'], 'unreviewed')


class ImportUrlOnThisMacsStoreTests(unittest.TestCase):
    """The same link, without Notion: an Open match in this Mac's store (src/stores), the Profile from the store."""
    setUp, tearDown = ImportUrlTests.setUp, ImportUrlTests.tearDown

    def run_on_store(self, stores, client, url=URL, profile=''):
        with mock.patch.dict('os.environ', AI_ON, clear=False), \
                mock.patch.object(import_url.ledger, 'page_meta', lambda _url: dict(META)), \
                mock.patch.object(import_url, 'local_profile', lambda: profile):
            return import_url.run(self.db, url, stores=stores, client=client, stats={})

    def test_a_link_becomes_an_open_match_in_the_store_scored_against_its_profile(self):
        from src.stores import memory
        stores = memory.open_store()
        stores.texts.set('profile', 'Profile: SRE in Zurich')
        outcome = self.run_on_store(stores, Client(FACTS, FIT))
        self.assertTrue(outcome['created'], outcome)
        self.assertIn('fit 81/100, tier A', outcome['line'])
        self.assertEqual([(m['url'], m['status'], m['fit']) for m in stores.matches.list()], [(URL, 'Open', 81)])
        self.assertEqual(stores.applications.list(), [])            # not an application
        self.assertFalse(self.run_on_store(stores, Client(FACTS, FIT))['created'])
        self.assertEqual(len(stores.matches.list()), 1)

    def test_a_link_already_among_your_applications_is_said_so(self):
        from src.stores import memory
        stores = memory.open_store()
        stores.applications.set_stage({'url': URL, 'title': 'SRE', 'company': 'Acme'}, 'Applied')
        outcome = self.run_on_store(stores, Client(FACTS, FIT))
        self.assertEqual(outcome['line'], 'Already in your applications (Applied): SRE')

    def test_without_a_profile_it_asks_for_one(self):
        from src.stores import memory
        with self.assertRaisesRegex(ValueError, 'Add your profile first'):
            self.run_on_store(memory.open_store(), Client(FACTS, FIT))

if __name__ == '__main__':
    unittest.main()
