"""A web search for an employer's own job site (src/sources/web_search.py), the scout's last step (6 Oct 2026: Coop's jobs are on coopjobs.ch and
jobs.coop.ch, Rolex's on carrieres-rolex.com: no guess from the name reaches them, a person finds them with one search)."""
import json
import os
import unittest
from pathlib import Path
import sys
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import scout  # noqa: E402
from src.sources import web_search  # noqa: E402

BRAVE = {'web': {'results': [{'url': 'https://www.linkedin.com/company/coop/jobs'}, {'url': 'https://www.coopjobs.ch/de.html'},
                             {'url': 'https://jobs.coop.ch/'}, {'url': 'http://insecure.example/jobs'}]}}


KEYS = 'brave_search,google_jobs'   # these tests are about the keyed searches, parked by default (src/features.py PARKED)

class WebSearchTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(web_search, '_claude_code', lambda: False)   # these tests are about the keyed searches
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_brave_first_then_serpapi_and_nothing_without_a_key(self):
        asked = []
        get = lambda url, headers=None: asked.append((url, headers)) or BRAVE
        with mock.patch.dict(os.environ, {'BRAVE_SEARCH_API_KEY': 'b', 'SERPAPI_API_KEY': 's', 'JOB_PILOTTO_DISABLE': '', 'JOB_PILOTTO_ENABLE': KEYS}):
            self.assertEqual(web_search.job_sites('Coop', 'fr', get), ['https://www.coopjobs.ch/de.html', 'https://jobs.coop.ch/'])
        self.assertIn('api.search.brave.com', asked[0][0])
        self.assertIn('Coop+jobs+emplois', asked[0][0], 'the jobs word of the language goes into the search')
        with mock.patch.dict(os.environ, {'BRAVE_SEARCH_API_KEY': '', 'SERPAPI_API_KEY': 's', 'JOB_PILOTTO_DISABLE': '', 'JOB_PILOTTO_ENABLE': KEYS}):
            self.assertEqual(web_search.provider(), 'serpapi')
        with mock.patch.dict(os.environ, {'BRAVE_SEARCH_API_KEY': '', 'SERPAPI_API_KEY': '', 'JOB_PILOTTO_DISABLE': '', 'JOB_PILOTTO_ENABLE': KEYS}):
            self.assertEqual(web_search.job_sites('Coop', 'fr', get), [])
        with mock.patch.dict(os.environ, {'BRAVE_SEARCH_API_KEY': 'b', 'JOB_PILOTTO_DISABLE': 'web_search'}):
            self.assertIsNone(web_search.provider())

    def test_parked_keys_are_not_used_and_the_plan_search_still_is(self):
        """Owner, 26 Oct 2026: the Brave and SerpApi keys are parked (src/features.py PARKED). A saved key is left alone, unused; the user's own
        plan (Claude Code or Codex) still searches, with or without a key."""
        with mock.patch.dict(os.environ, {'BRAVE_SEARCH_API_KEY': 'b', 'SERPAPI_API_KEY': 's', 'JOB_PILOTTO_DISABLE': '', 'JOB_PILOTTO_ENABLE': ''}):
            self.assertIsNone(web_search.provider())
            with mock.patch.object(web_search, '_claude_code', lambda: True), mock.patch.object(web_search, '_plan_engine', lambda: 'claude'):
                self.assertEqual(web_search.provider(), 'claude')
        with mock.patch.dict(os.environ, {'BRAVE_SEARCH_API_KEY': '', 'SERPAPI_API_KEY': '', 'JOB_PILOTTO_DISABLE': '', 'JOB_PILOTTO_ENABLE': ''}), \
                mock.patch.object(web_search, '_claude_code', lambda: True), mock.patch.object(web_search, '_plan_engine', lambda: 'codex'):
            self.assertEqual(web_search.provider(), 'codex')
        for enable, expected in (('brave_search', 'brave'), ('google_jobs', 'serpapi')):
            with mock.patch.dict(os.environ, {'BRAVE_SEARCH_API_KEY': 'b', 'SERPAPI_API_KEY': 's', 'JOB_PILOTTO_DISABLE': '', 'JOB_PILOTTO_ENABLE': enable}):
                self.assertEqual(web_search.provider(), expected)

    def test_a_failed_search_is_an_empty_answer(self):
        def boom(url, headers=None):
            raise OSError('down')
        with mock.patch.dict(os.environ, {'BRAVE_SEARCH_API_KEY': 'b', 'JOB_PILOTTO_DISABLE': '', 'JOB_PILOTTO_ENABLE': KEYS}):
            self.assertEqual(web_search.job_sites('Coop', '', boom), [])

    def test_the_scout_searches_only_when_name_website_and_job_hosts_found_nothing(self):
        jobs = [{'title': f'Vendeur {i}', 'location': 'Genève'} for i in range(9)]
        searched = []
        search = lambda name: searched.append(name) or ['https://www.coopjobs.ch/de.html']
        discover = lambda url: {'ats': 'careers', 'slug': 'coopjobs', 'jobs': jobs} if 'coopjobs' in url else None
        found = scout.find_feed({'name': 'Coop', 'website': 'https://www.coop.ch'}, lambda system, slug: None, discover, search=search)
        self.assertEqual((found[0], found[1], len(found[2])), ('careers', 'coopjobs', 9))
        self.assertEqual(searched, ['Coop'])
        searched.clear()
        known = scout.find_feed({'name': 'Coop', 'website': 'https://www.coop.ch'}, lambda system, slug: None,
                                lambda url: {'ats': 'careers', 'slug': 'coop', 'jobs': jobs} if url == 'https://www.coop.ch' else None, search=search)
        self.assertEqual(known[1], 'coop')
        self.assertEqual(searched, [], 'no search when the website already led to jobs')


class ClaudeCodeSearchTests(unittest.TestCase):
    def test_claude_code_comes_first_and_only_its_answers_own_sites_are_kept(self):
        with mock.patch.object(web_search, '_claude_code', lambda: True), mock.patch.dict(os.environ, {'BRAVE_SEARCH_API_KEY': 'b', 'JOB_PILOTTO_DISABLE': '', 'JOB_PILOTTO_ENABLE': KEYS}), \
                mock.patch.object(web_search, 'only_job_lists', lambda company, site, urls, client=None: urls), \
                mock.patch.object(web_search, '_claude_search', lambda company, language, site='': ['https://jobs.coop.ch/viewalljobs/', 'https://www.linkedin.com/jobs/coop',
                                                                                          'https://www.coopjobs.ch/fr.html']):
            self.assertEqual(web_search.provider(), 'claude')
            self.assertEqual(web_search.job_sites('Coop', 'fr'), ['https://jobs.coop.ch/viewalljobs/', 'https://www.coopjobs.ch/fr.html'])

    def test_claude_code_is_allowed_web_search_and_nothing_else(self):
        from src.ai import engine
        cli = engine.CliClient(binary='claude', run=lambda *a, **k: None)
        with mock.patch('src.ai.providers.claude_code.flags', lambda binary, run: {'--tools', '--permission-mode', '--max-turns', '--allowedTools'}):
            args = cli.command('claude-haiku-4-5', 'system', web_search=True)
            plain = cli.command('claude-haiku-4-5', 'system')
        self.assertEqual(args[args.index('--tools') + 1], 'WebSearch')
        self.assertEqual(args[args.index('--allowedTools') + 1], 'WebSearch')
        self.assertEqual(plain[plain.index('--tools') + 1], '', 'other calls still have no tools at all')


if __name__ == '__main__':
    unittest.main()


class AppRenderTests(unittest.TestCase):
    def test_the_engine_renders_through_the_app_and_takes_a_403_as_a_refusal(self):
        from src.sources import render
        answers = {'ok': {'status': 200, 'html': '<html><a href="/job/1">Vendeur</a></html>'}, 'no': {'status': 403, 'html': 'Forbidden'}}
        sent = []
        def urlopen(request, timeout=None):
            body = json.loads(request.data)
            sent.append((request.full_url, request.get_header('X-job-pilotto-render'), body['user_agent']))
            import io
            return mock.MagicMock(__enter__=lambda self: io.BytesIO(json.dumps(answers['no' if 'coop' in body['url'] else 'ok']).encode()), __exit__=lambda *a: None)
        with mock.patch.dict(os.environ, {'JOB_PILOTTO_RENDER_URL': 'http://127.0.0.1:47111/engine/render', 'JOB_PILOTTO_RENDER_TOKEN': 'k'}), \
                mock.patch.object(render.urllib.request, 'urlopen', urlopen):
            self.assertTrue(render.available())
            self.assertIn('Vendeur', render.render('https://jobs.migros.ch/de'))
            with self.assertRaises(render.Refused):
                render.render('https://www.coop.ch/')
        self.assertEqual(sent[0][1], 'k')
        self.assertTrue(sent[0][2].startswith('JobPilotto/') and sent[0][2].endswith(' browser'))


class JobPagePickTests(unittest.TestCase):
    """The company's website goes into the search, and Claude keeps only this company's list of open jobs (7 Oct 2026: Omega's watches
    -> omega365.com, a Norwegian software firm; Fust -> its "application process" page)."""
    def test_the_website_is_searched_and_only_its_job_list_is_kept(self):
        import json
        from types import SimpleNamespace
        from unittest import mock
        asked, told = [], []

        def get(url, headers=None):
            asked.append(url)
            return {'web': {'results': [{'url': 'https://global.omega365.com/inside-omega/stavanger-jobs'}, {'url': 'https://www.omegawatches.com/careers/list'},
                                        {'url': 'https://www.omegawatches.com/careers/application-process'}]}}

        class Client:
            messages = SimpleNamespace(create=lambda **kw: told.append(kw) or SimpleNamespace(
                content=[SimpleNamespace(type='text', text=json.dumps({'keep': [2]}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1)))
        with mock.patch.dict('os.environ', {'BRAVE_SEARCH_API_KEY': 'k'}), mock.patch.object(web_search, 'provider', lambda: 'brave'):
            got = web_search.job_sites('Omega', '', get, site='https://www.omegawatches.com', client=Client())
        self.assertEqual(got, ['https://www.omegawatches.com/careers/list'])
        self.assertIn('omegawatches.com', asked[0], 'the website is in the search')
        self.assertIn('Website: https://www.omegawatches.com', told[0]['messages'][0]['content'])

    def test_without_ai_the_addresses_stay_as_found(self):
        from unittest import mock
        with mock.patch('src.ai.engine.ready', lambda *a: False):
            self.assertEqual(web_search.only_job_lists('Omega', '', ['https://a.test/jobs']), ['https://a.test/jobs'])
