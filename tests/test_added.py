import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import store
from src.ai import added
from src.stores import memory
from src.notion import ledger

FACTS = {'languages': [], 'english_is_enough': {'value': 'yes', 'evidence': ''},
         'seniority': {'value': 'senior', 'evidence': ''}, 'work_mode': {'value': 'remote', 'remote_scope': 'Europe', 'evidence': ''},
         'workload': {'value': '100%', 'evidence': ''}, 'salary': {'stated': True, 'text': '€70k–90k'},
         'employer_type': {'value': 'recruiter', 'evidence': ''}, 'role_family': 'DevOps', 'technologies': ['AWS', 'EKS'],
         'on_call': {'value': 'unknown', 'evidence': ''}, 'visa_sponsorship': {'value': 'unknown', 'evidence': ''},
         'confidence': 'high'}
FIT = {'score': 81, 'tier': 'A', 'reason': 'AWS/EKS ownership', 'strengths': ['EKS'], 'gaps': ['Aurora'], 'confidence': 'high',
       'components': {'role_fit': 90, 'location': 80, 'compensation': 60, 'growth': 70, 'risk': 40}}
POSTING = 'Own AWS and EKS: networking, DNS, load balancing. Run Aurora PostgreSQL in production. Terraform + Argo CD. ' * 2
AI_ON = {'ANTHROPIC_API_KEY': 'sk-test', 'NOTION_TOKEN': 'secret-test', 'JOBADABRA_ENRICH_MODEL': 'claude-haiku-5-5', 'JOBADABRA_SCORE_MODEL': 'claude-sonnet-5-5'}


class Client:
    def __init__(self, *answers):
        self.answers, self.calls, self.messages = list(answers), [], self

    def create(self, **params):
        self.calls.append(params['model'])
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(self.answers.pop(0)))], stop_reason='end_turn',
                               usage=SimpleNamespace(input_tokens=1000, output_tokens=300, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))


class Tracker:
    database_id = 'apps'

    def __init__(self):
        self.matches, self.updates = [], []

    def query_database(self, database_id, filter_=None):
        return []

    def upsert_match(self, props, page_id=None):
        self.matches.append((page_id, props))
        return 'match-1'

    def update_page(self, page_id, props):
        self.updates.append((page_id, props))

    def page_text(self):
        return 'Profile: SRE in Zurich'


class AddedTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = store.connect(Path(self.tmp.name) / 'jobs.sqlite')

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def process(self, tracker, client, job=None, row=None, env=AI_ON, stores=None):
        stats = {}
        if stores is None:
            stores = memory.open_store()
            stores.texts.set('profile', 'Profile: SRE in Zurich')
        with mock.patch.dict('os.environ', env, clear=False), mock.patch.object(added, 'local_profile', lambda: None):
            line = added.process(self.db, 'https://x.test/job/1',
                                 job or {'title': 'Senior DevOps Engineer', 'company': 'Acme', 'description': POSTING},
                                 row=row, client=client, stats=stats, stores=stores)
        return line, stats

    def stores_with_job(self, **fields):
        """The memory store (any adapter: sqlite on this Mac, Notion) holding the job you added."""
        stores = memory.open_store()
        stores.texts.set('profile', 'Profile: SRE in Zurich')
        stores.applications.create({'url': 'https://x.test/job/1', 'title': 'Senior DevOps Engineer', **fields}, 'Applied')
        return stores

    def test_a_job_you_add_gets_facts_and_a_fit_score_on_its_application_but_no_job_matches_row(self):
        tracker, client, stores = Tracker(), Client(FACTS, FIT), self.stores_with_job()
        line, stats = self.process(tracker, client, row={'id': 'app-1'}, stores=stores)
        self.assertEqual(line, 'fit 81/100, tier A')
        self.assertEqual(client.calls, ['claude-haiku-5-5', 'claude-sonnet-5-5'])
        self.assertEqual((tracker.matches, stores.matches.list()), ([], []))  # Job Matches = what a search found (owner, 30 Sep 2026)
        self.assertEqual(tracker.updates, [])   # the job is filled through the store
        record = stores.applications.get('https://x.test/job/1')
        self.assertEqual((record['fit'], record['tier'], record['seniority'], record['work_mode'], record['recruiter'], record['salary']),
                         (81, 'A', 'Senior', 'Remote', True, '€70k–90k'))
        self.assertGreater(stats['enrich']['usd'] + stats['score']['usd'], 0)
        self.assertEqual(self.db.execute("SELECT count(*) n FROM sqlite_master WHERE name='notion_matches'").fetchone()['n'], 0)
        # the facts and the score stay in the job cache, like a found job's
        self.assertEqual(len(added.score.load(self.db)), 1)

    def test_what_you_set_on_the_application_stays(self):
        stores = self.stores_with_job(tier='C', salary='CHF 150k')
        self.process(Tracker(), Client(FACTS, FIT), row={'id': 'app-1'}, stores=stores)
        record = stores.applications.get('https://x.test/job/1')
        self.assertEqual((record['tier'], record['salary'], record['fit']), ('C', 'CHF 150k', 81))

    def test_with_no_applications_row_yet_the_columns_wait_on_the_job_for_add_application(self):
        tracker = Tracker()
        job = {'title': 'Senior DevOps Engineer', 'company': 'Acme', 'description': POSTING}
        self.process(tracker, Client(FACTS, FIT), job=job)
        self.assertEqual((tracker.updates, tracker.matches), ([], []))
        self.assertEqual(job['application_columns']['Fit score'], {'number': 81})
        self.assertEqual(job['application_fields']['fit'], 81)   # the same values as store fields

    def test_nothing_runs_without_the_ai_stages_or_a_description_or_for_a_job_already_scored(self):
        env_off = {'JOBADABRA_DISABLE': 'score'}
        self.assertIsNone(self.process(Tracker(), Client(), env={**AI_ON, **env_off})[0])
        self.assertIsNone(self.process(Tracker(), Client(), job={'title': 'SRE', 'description': 'short'})[0])
        self.process(Tracker(), Client(FACTS, FIT))
        tracker = Tracker()
        self.assertIsNone(self.process(tracker, Client())[0])  # the same job again: already scored
        self.assertEqual(tracker.matches, [])

    def test_a_message_without_a_posting_is_described_from_what_was_read(self):
        text = added.description_of({'title': 'SRE', 'client': 'logistics software', 'salary': '€120k', 'work_mode': 'Remote'})
        self.assertEqual(text, 'Role: SRE\nEmployer (not named): logistics software\nWork mode: Remote\nSalary: €120k')


class DailyAddTests(unittest.TestCase):
    def test_a_linkedin_application_is_scored_from_the_details_you_paste_before_its_record_is_frozen(self):
        from src import daily, daily_modes, ledger_store
        order, seen = [], {}

        def process(db, url, meta, stats=None, stores=None):
            order.append('ai'); seen.update(meta)
            return 'fit 81/100, tier A'

        def add_application(stores, url, **kwargs):
            order.append('record')
            return 'Tracked: Senior SRE — Acme'
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        argv = ['daily', '--mode', 'add', '--job', 'https://www.linkedin.com/jobs/view/1', '--note', 'two days ago',
                '--job-title', 'Senior SRE', '--job-company', 'Acme', '--job-text', POSTING, '--db', str(Path(tmp.name) / 'j.sqlite')]
        tracker = SimpleNamespace(query_database=lambda *a, **k: [])
        with mock.patch.object(sys, 'argv', argv), mock.patch.object(daily.notion.Tracker, 'from_env', lambda: tracker), \
                mock.patch.object(added, 'process', process), mock.patch.object(ledger_store, 'add_application', add_application), \
                mock.patch.object(ledger_store, 'company_for', lambda s, u, m: m.get('company')), \
                mock.patch.object(daily_modes, 'queue_mail_check', lambda: False), mock.patch('builtins.print') as printed:
            self.assertEqual(daily.main(), 0)
        self.assertEqual(order, ['ai', 'record'])
        self.assertEqual((seen['title'], seen['company'], seen['description']), ('Senior SRE', 'Acme', POSTING.strip()))
        self.assertIn('fit 81/100, tier A', printed.call_args_list[-1].args[0])

    def test_a_page_whose_text_was_not_read_says_it_is_not_scored_instead_of_staying_silent(self):
        from src import daily, daily_modes, ledger_store
        from src.notion import ledger
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        argv = ['daily', '--mode', 'add', '--job', 'https://careers.example.test/job/1', '--note', 'today',
                '--db', str(Path(tmp.name) / 'j.sqlite')]
        tracker = SimpleNamespace(query_database=lambda *a, **k: [])
        with mock.patch.object(sys, 'argv', argv), mock.patch.object(daily.notion.Tracker, 'from_env', lambda: tracker), \
                mock.patch.object(ledger, 'page_meta', lambda url: {'title': 'Controller'}), \
                mock.patch.object(added, 'process', lambda *a, **k: None), \
                mock.patch.object(ledger_store, 'add_application', lambda *a, **k: 'Tracked: Controller'), \
                mock.patch.object(ledger_store, 'company_for', lambda s, u, m: ''), \
                mock.patch.object(daily_modes, 'queue_mail_check', lambda: False), mock.patch('builtins.print') as printed:
            self.assertEqual(daily.main(), 0)
        self.assertIn('not scored yet', printed.call_args_list[-1].args[0])


class AddApplicationColumnsTests(unittest.TestCase):
    def test_add_writes_the_fit_columns_and_the_frozen_record_reads_them_without_a_job_matches_row(self):
        created, updates = [], []
        row = {'id': 'app-9', 'url': '', 'properties': {}}

        class Fake:
            database_id = 'apps'

            def find(self, url):
                return row if created else None

            def create_page(self, db, props):
                created.append(props)
                row['properties'] = {name: dict(value, type=next(iter(value))) for name, value in props.items()}
                return row

            def update_page(self, page_id, props):
                updates.append(props)

            def query_database(self, *args, **kwargs):
                return []  # no Job Matches row

            def read_kit(self, *args):
                return None

            def replace_section(self, *args):
                pass

        columns = {'Fit score': {'number': 81}, 'Tier': {'select': {'name': 'A'}}, 'Recruiter': {'checkbox': True}}
        found, again = {}, {}
        with mock.patch.object(ledger, 'add_event', lambda *a, **k: None), mock.patch.object(ledger, 'form_snapshot', lambda *a: None), \
                mock.patch.object(ledger, 'run_state', lambda *a: None):
            ledger.add_application(Fake(), 'https://x.test/job/9', source='Telegram',
                                   meta={'title': 'SRE', 'company': 'Acme', 'application_columns': columns}, found=found)
            ledger.add_application(Fake(), 'https://x.test/job/9', source='Telegram', meta={'title': 'SRE'}, found=again)
        self.assertEqual((created[0]['Fit score'], created[0]['Tier']), ({'number': 81}, {'select': {'name': 'A'}}))
        # The run links to the job: created the first time, updated (the same row) the second.
        self.assertEqual((found['row']['id'], found['created'], again['row']['id'], again['created']), ('app-9', True, 'app-9', False))
        record = updates[-1]
        self.assertEqual((record['Fit score'], record['Tier'], record['Recruiter']),
                         ({'number': 81}, {'select': {'name': 'A'}}, {'checkbox': True}))


class JobMatchesSyncTests(unittest.TestCase):
    def test_a_search_never_mirrors_a_job_you_added_into_job_matches(self):
        from src import daily, daily_modes
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        db = store.connect(Path(tmp.name) / 'j.sqlite')
        self.addCleanup(db.close)
        found, _ = store.upsert_job(db, {'url': 'https://x.test/found', 'title': 'SRE', 'company': 'Acme'}, 'Acme feed',
                                    source_kind='employer feed')
        mine, _ = store.upsert_job(db, {'url': 'https://x.test/mine', 'title': 'SRE', 'company': 'Beta'}, added.SOURCE,
                                   source_kind='you')
        db.commit()
        fits = {found: FIT, mine: FIT}
        with mock.patch.object(daily.score, 'load', lambda _db: fits), \
                mock.patch.object(daily.digest, 'eligible_jobs', lambda _db, hidden: (store.digest_jobs(_db, limit=100), [])):
            self.assertEqual([j['url'] for j in daily.for_job_matches(db, set())], ['https://x.test/found'])


class WalledSiteTests(unittest.TestCase):
    """7 Oct 2026, owner: LinkedIn, Glassdoor and the like are read like any page; a sign-in page instead of the posting asks for its text."""
    def test_a_linkedin_job_page_is_read_when_it_answers_with_its_posting(self):
        page = ('<script type="application/ld+json">{"@type": "JobPosting", "title": "Photographe", "hiringOrganization": {"name": "Studio"}, '
                '"description": "' + 'Shoots for the spring collection, studio and outdoor. ' * 4 + '"}</script>')
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = page.encode()
        response.__enter__.return_value.headers.get_content_charset.return_value = 'utf-8'
        with mock.patch.object(ledger.ats, 'posting', return_value=None):
            meta = ledger.page_meta('https://www.linkedin.com/jobs/view/123', opener=lambda *a, **k: response)
        self.assertEqual(meta.get('title'), 'Photographe')
        self.assertTrue(ledger.walled('https://ch.indeed.com/viewjob?jk=1'))
        self.assertFalse(ledger.walled('https://boards.greenhouse.io/acme/jobs/1'))


class HookTests(unittest.TestCase):
    """added.hook(stores, db_path, stats): the AI stages for a job added by a log, a lead or Gmail, through the caller's store alone."""

    def test_the_hook_scores_through_the_callers_store_with_no_notion_client(self):
        import tempfile
        from src.stores import memory
        stores, seen = memory.open_store(), {}
        def process(db, url, job, *, row=None, stats=None, stores=None, **_):
            seen.update(stores=stores, url=url, row=row)
            return 'fit 80/100, tier A'
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(added, 'process', process):
            on_new = added.hook(stores, str(Path(folder) / 'jobs.sqlite'), {})
            self.assertEqual(on_new('https://x.test/1', {'title': 'SRE'}, {'id': 'r1'}), 'fit 80/100, tier A')
        self.assertIs(seen['stores'], stores)
        self.assertEqual(seen['row'], {'id': 'r1'})

    def test_a_failure_is_printed_never_raised(self):
        import io
        import tempfile
        from contextlib import redirect_stdout
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(added, 'process', side_effect=RuntimeError('model down')), \
                redirect_stdout(io.StringIO()) as out:
            self.assertIsNone(added.hook(None, str(Path(folder) / 'jobs.sqlite'))('https://x.test/1', {}))
        self.assertIn('AI stages skipped', out.getvalue())


if __name__ == '__main__':
    unittest.main()
