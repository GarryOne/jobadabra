import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import daily, digest
from src.ai import enrich
from src import store as job_store


def facts(**overrides):
    data = {'languages': [], 'english_is_enough': {'value': 'unknown', 'evidence': ''},
            'seniority': {'value': 'unknown', 'evidence': ''},
            'work_mode': {'value': 'unknown', 'remote_scope': '', 'evidence': ''}, 'workload': 'unknown',
            'salary': {'stated': False, 'text': ''}, 'employer_type': {'value': 'unknown', 'evidence': ''},
            'role_family': 'sre', 'technologies': [], 'on_call': 'unknown', 'confidence': 'high'}
    data.update(overrides)
    return data


class FakeClient:
    """Stands in for anthropic.Anthropic; records requests and returns canned JSON."""
    def __init__(self, data):
        self.data, self.requests = data, []
        self.messages = self

    def create(self, **params):
        self.requests.append(params)
        return SimpleNamespace(stop_reason='end_turn',
                               content=[SimpleNamespace(type='text', text=json.dumps(self.data))],
                               usage=SimpleNamespace(input_tokens=10, output_tokens=5))


def seed(db, jobs):
    job_store.import_watch_report(db, {'jobs': [
        dict({'company': 'Example', 'location': 'Zurich', 'description': 'Kubernetes and Terraform.'},
             id=str(i), url=f'https://x.test/{i}', **job) for i, job in enumerate(jobs)]})


class EnrichTests(unittest.TestCase):
    def test_only_new_or_changed_descriptions_are_pending(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed(db, [{'title': 'SRE'}, {'title': 'No text', 'description': ''}])
                pending = enrich.pending_jobs(db, 10)
                self.assertEqual([j['title'] for j in pending], ['SRE'])
                data, _ = enrich.extract(FakeClient(facts()), 'claude-opus-5', pending[0])
                enrich.save(db, pending[0], 'claude-opus-5', data)
                self.assertEqual(enrich.pending_jobs(db, 10), [])
                seed(db, [{'title': 'SRE', 'description': 'Now also on-call.'}])
                self.assertEqual(len(enrich.pending_jobs(db, 10)), 1)

    def test_run_enriches_all_pending_jobs_in_parallel(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed(db, [{'title': f'SRE {i}'} for i in range(12)])
                client = FakeClient(facts())
                stats = {}
                summary = enrich.run(db, 'claude-haiku-4-5', 50, client=client, workers=4, stats=stats)
                self.assertIn('Enriched 12 of 12', summary)
                self.assertEqual((stats['pending'], stats['done'], stats['failed']), (12, 12, 0))
                self.assertEqual((stats['tokens_in'], stats['tokens_out']), (120, 60))
                # Haiku 4.5: $1 in, $5 out per million tokens.
                self.assertAlmostEqual(stats['usd'], (120 * 1 + 60 * 5) / 1e6)
                self.assertEqual(len(client.requests), 12)
                self.assertEqual(len(enrich.load(db)), 12)
                self.assertEqual(enrich.pending_jobs(db, 50), [])

    def test_request_uses_json_schema_and_effort_only_where_supported(self):
        job = {'title': 'SRE', 'company': 'Example', 'location': 'Zurich', 'description': 'text'}
        client = FakeClient(facts())
        enrich.extract(client, 'claude-opus-5', job)
        enrich.extract(client, 'claude-haiku-4-5', job)
        self.assertEqual(client.requests[0]['output_config']['format']['type'], 'json_schema')
        self.assertEqual(client.requests[0]['output_config']['effort'], 'low')
        self.assertNotIn('effort', client.requests[1]['output_config'])

    def test_required_german_is_hidden_and_badges_render(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed(db, [{'title': 'SRE German'}, {'title': 'SRE English'}])
                english, german = sorted(enrich.pending_jobs(db, 10), key=lambda j: j['title'])
                enrich.save(db, german, 'm', facts(languages=[
                    {'language': 'German', 'level': 'required', 'evidence': 'fliessend Deutsch'}]))
                enrich.save(db, english, 'm', facts(
                    english_is_enough={'value': 'yes', 'evidence': 'English is our working language'},
                    seniority={'value': 'senior', 'evidence': 'Senior'},
                    languages=[{'language': 'French', 'level': 'nice_to_have', 'evidence': 'French is a plus'}],
                    salary={'stated': True, 'text': 'CHF 130k–150k'}))
                message = digest.format_digest(db)
        self.assertNotIn('SRE German', message)
        self.assertNotIn('filtered', message)   # the pipeline counts block is gone (owner, 24 Oct 2026)
        for word in ('Senior', '<b>Check:</b> English', 'French +', 'CHF 130k–150k'):   # plain words, no emoji per line (src/tgcard.py)
            self.assertIn(word, message)
        self.assertNotIn('🇬🇧', message)


class TimeBudgetTopUpTests(unittest.TestCase):
    """7 Oct 2026: a first refresh guessed 12 s a job (no measured pace yet), read 6 of 10 in 15 s of its 3 minutes and left 4 for the next
    refresh. When a batch is done with time left, the next batch is sized from the pace just measured."""
    def tearDown(self):
        from src import time_budget
        time_budget.start(0)

    def run_with(self, seconds, now=None):
        import contextlib, io
        from unittest import mock
        from src import time_budget
        with tempfile.TemporaryDirectory() as tmp, mock.patch('src.paths.DATA', Path(tmp)), job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            seed(db, [{'title': f'SRE {i}'} for i in range(10)])
            time_budget.start(seconds, now=now)
            first = time_budget.batch('enrich', 10, say=False)
            client, out, stats = FakeClient(facts()), io.StringIO(), {}
            with contextlib.redirect_stdout(out):
                summary = enrich.run(db, 'claude-haiku-4-5', 50, client=client, workers=4, stats=stats)
            return first, summary, out.getvalue(), stats, len(client.requests)

    def test_time_left_after_a_batch_reads_the_next_one(self):
        first, summary, out, stats, calls = self.run_with(180)
        self.assertLess(first, 10, 'positive control: the default pace takes only part of the jobs in the first batch')
        self.assertEqual(calls, 10)
        self.assertIn('Enriched 10 of 10', summary)
        self.assertEqual(stats['late'], 0)
        self.assertNotIn('next', out, 'nothing waits, so the log says nothing waits')

    def test_time_up_reads_none_and_says_how_many_wait(self):
        first, summary, out, stats, calls = self.run_with(1, now=0)   # long spent
        self.assertEqual((first, calls, stats['late']), (0, 0, 10))
        self.assertIn('10 job(s) left for the next one', out)


class ExcludedCompanyTests(unittest.TestCase):
    def test_excluded_company_is_hard_filtered_like_a_language(self):
        original = digest.PREFERENCES.get('excluded_companies', [])
        digest.PREFERENCES['excluded_companies'] = ['Current Employer']
        try:
            with tempfile.TemporaryDirectory() as tmp:
                with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                    job_store.import_watch_report(db, {'jobs': [
                        {'company': 'Current Employer', 'id': '1', 'title': 'SRE', 'location': 'Zurich',
                         'url': 'https://x.test/1', 'description': 'd'},
                        {'company': 'current employer', 'id': '2', 'title': 'SRE', 'location': 'Zurich',
                         'url': 'https://x.test/2', 'description': 'd'},
                        {'company': 'Other Co', 'id': '3', 'title': 'SRE', 'location': 'Zurich',
                         'url': 'https://x.test/3', 'description': 'd'}]})
                    eligible, blocked = digest.eligible_jobs(db)
            self.assertEqual({j['id'] for j in eligible}, {3})
            self.assertEqual({j['id'] for j in blocked}, {1, 2})  # case-insensitive match
        finally:
            digest.PREFERENCES['excluded_companies'] = original


class SalaryTests(unittest.TestCase):
    def test_salary_shows_only_the_figure(self):
        self.assertIsNone(digest._salary('In the UK, the base compensation range for this role'))
        self.assertEqual(digest._salary('In the UK, the Base compensation range for this role is £92,000 - £110,000.'),
                         '£92,000 - £110,000')
        self.assertEqual(digest._salary('CHF 130k–150k'), 'CHF 130k–150k')
        self.assertEqual(digest._salary('SEK 878,578 - SEK 1,054,294'), 'SEK 878,578 - SEK 1,054,294')
        self.assertIsNone(digest._salary('Team of 12 engineers, founded 2019'))


class ApiOutageTests(unittest.TestCase):
    """2 Oct 2026 (the activity e2e suite): the API answered 429 / 500 to every call. The run printed "Stopping early, API unavailable: RateLimitError", the app
    read no warning in it and showed the run as plain "Completed" while the jobs stayed unread."""

    def outage(self, error):
        class Failing:
            def __init__(self):
                self.messages = self

            def create(self, **params):
                raise error
        return Failing()

    def run_enrich(self, error):
        import contextlib
        import io
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed(db, [{'title': f'SRE {i}'} for i in range(3)])
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    enrich.run(db, 'claude-haiku-4-5', 50, client=self.outage(error), workers=1)
                return out.getvalue().splitlines()

    def test_an_api_outage_leaves_a_warning_line_the_app_can_show(self):
        try:
            import anthropic
        except ImportError:
            self.skipTest('the anthropic package is not installed')

        def response(status):  # what the SDK reads of an HTTP answer
            return SimpleNamespace(status_code=status, headers={}, request=SimpleNamespace(), json=lambda: {})
        for error in (anthropic.RateLimitError('slow down', response=response(429), body=None),
                      anthropic.InternalServerError('boom', response=response(500), body=None)):
            lines = self.run_enrich(error)
            warning = [line for line in lines if line.startswith('Warning:')]
            self.assertEqual(len(warning), 1, lines)
            self.assertIn('AI unavailable', warning[0])  # plain words for the person since 4f96988
            self.assertNotIn(type(error).__name__, warning[0])
            self.assertIn('job(s) left for the next check', warning[0])
            technical = [line for line in lines if line.startswith('Technical: enrich:')]
            self.assertEqual(len(technical), 1, lines)
            self.assertIn(type(error).__name__, technical[0])  # the class name goes to the technical line


if __name__ == '__main__':
    unittest.main()
