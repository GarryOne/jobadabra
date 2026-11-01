import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import desktop, store
from src.stores import memory


class DesktopTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = store.connect(Path(self.tmp.name) / 'jobs.sqlite')
        store.upsert_job(self.db, {'title': 'Site Reliability Engineer', 'company': 'Acme', 'url': 'https://x.test/1',
                                   'location': 'Zurich'}, 'Acme', source_kind='employer feed')
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def test_jobs_lists_open_jobs_as_json(self):
        result = desktop.jobs(self.db)
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['jobs'][0]['title'], 'Site Reliability Engineer')
        json.dumps(result)

    def test_posting_finds_a_job_by_its_code(self):
        from src.notion.client import job_code
        found = desktop.posting(self.db, job_code('https://x.test/1'))
        self.assertTrue(found['ok'])
        self.assertEqual((found['title'], found['company'], found['url']), ('Site Reliability Engineer', 'Acme', 'https://x.test/1'))
        self.assertEqual((found['source'], found['source_kind']), ('Acme', 'employer feed'), 'where it came from: the Description tab says so')
        self.assertTrue(found['first_seen_at'], 'and when the search first found it')
        self.assertIn('posted_at', found)
        self.assertFalse(desktop.posting(self.db, 'nope0000')['ok'])

    def test_a_job_has_a_kit_when_its_notion_stage_is_kit_ready(self):
        self.assertFalse(desktop.jobs(self.db)['jobs'][0]['kit'])
        self.assertTrue(desktop.jobs(self.db, stages={'https://x.test/1': 'Kit ready'})['jobs'][0]['kit'])
        self.assertFalse(desktop.jobs(self.db, stages={'https://x.test/1': 'Saved'})['jobs'][0]['kit'])
        row = desktop.jobs(self.db, stages={'https://x.test/1': ('Kit ready', '⛔ Not eligible: UK residents only')})['jobs'][0]
        self.assertEqual((row['kit'], row['ineligible']), (True, 'UK residents only'))
        page = desktop.jobs(self.db, stages={'https://x.test/1': ('Kit ready', '', 'https://notion.so/p')})['jobs'][0]
        self.assertEqual(page['notion_url'], 'https://notion.so/p')
        # starred first, kit drafted later: the stage stays Saved, Next step shows the kit
        self.assertTrue(desktop.jobs(self.db, stages={'https://x.test/1': ('Saved', '📝 Kit ready: review it, then Apply')})['jobs'][0]['kit'])

    def test_status_is_local_and_reaches_the_stores_applications(self):
        stores = memory.open_store()
        self.assertEqual(desktop.set_status(self.db, 'https://x.test/1', 'saved', stores), {'ok': True, 'notion': 'created', 'stage': 'Saved'})
        row = stores.applications.get('https://x.test/1')
        self.assertEqual((row['title'], row['company'], row['stage']), ('Site Reliability Engineer', 'Acme', 'Saved'))
        self.assertEqual(desktop.jobs(self.db)['jobs'][0]['status'], 'saved')

    def test_notion_stage_is_the_truth_and_refreshes_the_local_cache(self):
        desktop.set_status(self.db, 'https://x.test/1', 'saved')  # stale local value
        listed = desktop.jobs(self.db, stages={'https://x.test/1': ('Rejected', '', '')}, notion=True)
        self.assertEqual(listed['jobs'][0]['status'], 'applied')  # Rejected = it was applied to
        self.assertEqual(desktop.jobs(self.db)['jobs'][0]['status'], 'applied')  # cache updated
        # No row in Notion (e.g. the Saved row was deleted there) = not reviewed.
        self.assertEqual(desktop.jobs(self.db, stages={}, notion=True)['jobs'][0]['status'], 'unreviewed')
        self.assertEqual([desktop.stage_status(s) for s in (None, 'Kit ready', 'Saved', 'Dismissed', 'Closed', 'Interview scheduled')],
                         ['unreviewed', 'unreviewed', 'saved', 'dismissed', 'dismissed', 'applied'])

    def test_dismissing_a_job_in_process_closes_it_instead_of_pretending(self):
        stores = memory.open_store()  # the store keeps a real stage against Saved/Dismissed (src/stores/rules.py)
        stores.applications.create({'url': 'https://x.test/1', 'title': 'Site Reliability Engineer'}, 'Interview scheduled')
        result = desktop.set_status(self.db, 'https://x.test/1', 'dismissed', stores)
        self.assertEqual((result['ok'], result['stage']), (True, 'Closed'))
        self.assertEqual(stores.applications.get('https://x.test/1')['stage'], 'Closed')
        self.assertEqual(desktop.jobs(self.db)['jobs'][0]['status'], 'dismissed')
        # Saved on a job in process is refused, so the screen never shows a change the store did not take
        stores.applications.set_stage({'url': 'https://x.test/1'}, 'Interview scheduled')
        refused = desktop.set_status(self.db, 'https://x.test/1', 'saved', stores)
        self.assertFalse(refused['ok'])
        self.assertIn('already in process', refused['error'])

    def test_a_job_only_in_the_store_gets_its_status_there(self):
        stores = memory.open_store()
        stores.applications.create({'url': 'https://x.test/elsewhere', 'title': 'SRE', 'company': 'Beta'}, 'Saved')
        self.assertEqual(desktop.set_status(self.db, 'https://x.test/elsewhere', 'applied', stores)['stage'], 'Applied')
        self.assertFalse(desktop.set_status(self.db, 'https://x.test/none', 'applied', stores)['ok'])

    def test_saving_a_job_only_in_job_matches_makes_its_applications_row(self):
        stores = memory.open_store()
        stores.matches.upsert({'url': 'https://x.test/found', 'title': 'Platform Engineer', 'company': 'Gamma',
                               'location': 'Bern', 'fit': 81, 'status': 'Open'})
        self.assertEqual(desktop.set_status(self.db, 'https://x.test/found/', 'saved', stores), {'ok': True, 'notion': 'created', 'stage': 'Saved'})
        row = stores.applications.get('https://x.test/found')
        self.assertEqual((row['title'], row['company'], row['location'], row['stage']), ('Platform Engineer', 'Gamma', 'Bern', 'Saved'))

    def test_a_job_kept_only_in_the_store_tailors_from_its_description(self):
        from unittest import mock
        url = 'https://www.linkedin.com/messaging/#jp-abc'
        code = desktop.job_code(url)
        stores = memory.open_store()
        record = stores.applications.create({'url': url, 'title': 'Principal SRE', 'via': 'Kestrel Agency', 'location': 'Remote, Europe'}, 'Recruiter lead')
        long = '# 🧾 Job description\n' + 'Lead the reliability of a Kubernetes platform on AWS, own SLOs and on-call, mentor four engineers. ' * 3
        with mock.patch('src.ai.prep.role_text', return_value=long) as role_text:
            found = desktop.store_posting(stores, code)
        role_text.assert_called_once_with(stores, record)
        self.assertEqual((found['ok'], found['title'], found['company']), (True, 'Principal SRE', 'Kestrel Agency'))
        self.assertIn('Kubernetes', found['description'])
        # a page with only a greeting says what is missing, instead of "job not found"
        with mock.patch('src.ai.prep.role_text', return_value='# 📥 Logged\nHi, are you open to talk?'):
            empty = desktop.store_posting(stores, code)
        self.assertEqual((empty['ok'], empty['error']), (False, desktop.NO_POSTING))
        self.assertEqual(desktop.store_posting(stores, 'nope'), {'ok': False, 'error': 'job not found'})

    def test_a_status_the_store_rejects_changes_nothing(self):
        stores = memory.open_store()

        def down(url):
            raise TimeoutError()
        stores.applications.get = down
        result = desktop.set_status(self.db, 'https://x.test/1', 'dismissed', stores)
        self.assertFalse(result['ok'])
        self.assertIn('could not be updated', result['error'])
        self.assertEqual(desktop.jobs(self.db)['jobs'][0]['status'], 'unreviewed')

    def test_without_notion_status_stays_local(self):
        self.assertEqual(desktop.set_status(self.db, 'https://x.test/1', 'applied'), {'ok': True})
        self.assertFalse(desktop.set_status(self.db, 'https://x.test/404', 'applied')['ok'])


if __name__ == '__main__':
    unittest.main()


class StrategyTests(unittest.TestCase):
    def test_a_screen_lists_the_places_as_written_not_the_regexes_the_crawl_adds(self):
        # 5 Oct 2026: the Strategy page showed one "place" made of every Swiss city's regex, and ":<!Wzurich!W".
        import json
        import tempfile
        from pathlib import Path
        from unittest import mock
        from src import paths
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'search.json').write_text(json.dumps({'locations': {'top_tier': ['zurich'], 'country_wide': ['switzerland'], 'abroad': ['berlin']}}))
            with mock.patch.object(paths, 'CONFIG', Path(tmp)):
                written = paths.load_search_config(matching=False)['locations']
                crawled = paths.load_search_config()['locations']
        self.assertEqual(written, {'top_tier': ['zurich'], 'country_wide': ['switzerland'], 'abroad': ['berlin']})
        self.assertIn('(?:', ''.join(crawled['country_wide']))  # the crawl still matches the cities of a region

    def test_strategy_goals_come_from_the_local_profile_when_notion_gives_none(self):
        # The demo's Notion is fictional (its read fails), and the app passes the demo's profile.md: its goals show (7 Oct 2026: all "—").
        import os
        import tempfile
        from pathlib import Path
        from types import SimpleNamespace
        from unittest import mock
        from src import desktop, store
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'profile.md').write_text('- **Work mode:** Hybrid\n- **Minimum acceptable:** CHF 48,000 a year (estimate)\n')
            db = store.connect(Path(tmp) / 'j.sqlite')
            def fails():
                raise RuntimeError('no Notion')
            tracker = SimpleNamespace(url_stages=lambda: {}, page_text=fails, _request=lambda *a, **k: {'results': []})
            with mock.patch.dict(os.environ, {'JOB_PILOTTO_PROFILE_FILE': str(Path(tmp, 'profile.md'))}), \
                    mock.patch.object(desktop.digest, 'eligible_jobs', lambda db: ([], [])), mock.patch('src.paths.load_search_config', lambda matching=True: {}):
                data = desktop.strategy(db, tracker)
            with mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop('JOB_PILOTTO_PROFILE_FILE', None)
                with mock.patch.object(desktop.digest, 'eligible_jobs', lambda db: ([], [])), mock.patch('src.paths.load_search_config', lambda matching=True: {}):
                    connected = desktop.strategy(db, tracker)
            db.close()
        self.assertEqual(data['goals'], {'work_mode': 'Hybrid', 'minimum_salary': 'CHF 48,000 a year (estimate)'})
        self.assertEqual(connected['goals'], {}, 'a connected install with no local file: nothing invented')

    def test_strategy_reads_your_details_apart_and_never_takes_a_search_value_from_them(self):
        # 3b moved the salary expectation under "💶 Availability & compensation": a heading naming "compensation" must not become the minimum
        # salary (owner, 17 Oct 2026: the two salaries stay apart); the sections come back read-only for the Strategy page.
        import os
        import tempfile
        from pathlib import Path
        from types import SimpleNamespace
        from unittest import mock
        from src import desktop, store
        profile = ('## Targets\n- **Work mode:** Hybrid\n## 💶 Availability & compensation\n- Salary expectation: CHF 140,000\n- Notice period: 2 months\n'
                   '## 🛂 Work eligibility\n- Work permit: Swiss B permit\n- **Need visa sponsorship?:** No\n## 🗣️ Languages\n- Languages I can work in: English, German (B1)\n')
        with tempfile.TemporaryDirectory() as tmp:
            db = store.connect(Path(tmp) / 'j.sqlite')
            tracker = SimpleNamespace(url_stages=lambda: {}, page_text=lambda: profile, _request=lambda *a, **k: {'results': []})
            os.environ.pop('JOB_PILOTTO_PROFILE_FILE', None)
            with mock.patch.object(desktop.digest, 'eligible_jobs', lambda db: ([], [])), mock.patch('src.paths.load_search_config', lambda matching=True: {}), \
                    mock.patch('src.paths.local_profile', lambda: ''):
                data = desktop.strategy(db, tracker)
            db.close()
        self.assertEqual(data['compensation'], '', 'the expectation is not the minimum')
        self.assertEqual(data['details']['eligibility'], [{'label': 'Work permit', 'value': 'Swiss B permit'}, {'label': 'Need visa sponsorship?', 'value': 'No'}])
        self.assertEqual(data['details']['languages'], [{'label': 'Languages I can work in', 'value': 'English, German (B1)'}])
        self.assertEqual(data['goals']['languages'], 'English, German (B1)')

    def test_your_details_titles_match_the_apps(self):
        import re
        from pathlib import Path
        from src.desktop_strategy import DETAILS_SECTIONS
        js = (Path(__file__).resolve().parent.parent / 'desktop' / 'lib' / 'profile-sections.js').read_text()
        app = dict(re.findall(r"^\s*(\w+): '[^\w']*([^']+)',", js.split('SECTIONS = {')[1].split('};')[0], re.M))
        self.assertEqual(app, dict(DETAILS_SECTIONS))

    def test_strategy_shows_the_users_own_targets_scores_and_counts(self):
        import tempfile
        from pathlib import Path
        from types import SimpleNamespace
        from unittest import mock
        from src import desktop, store
        with tempfile.TemporaryDirectory() as tmp:
            db = store.connect(Path(tmp) / 'j.sqlite')
            fits = {1: {'components': {'role_fit': 80, 'location': 60, 'compensation': 50, 'growth': 40, 'risk': 30}},
                    2: {'components': {'role_fit': 60, 'location': 40, 'compensation': 50, 'growth': 60, 'risk': 10}}}
            tracker = SimpleNamespace(url_stages=lambda: {'a': 'Applied', 'b': 'Kit ready', 'c': 'Rejected', 'd': 'Saved'},
                                      page_text=lambda: '# Compensation\n- Target: CHF 150k\n# Other\n- x',
                                      _request=lambda *a, **k: {'results': []})
            search = {'jobs_board_search_queries': ['site reliability'], 'role_keywords': ['vendeur', 'warehouse'], 'locations': {'top_tier': ['z[uü]rich'], 'country_wide': ['switzerland', 'bern'], 'abroad': ['berlin']},
                      'quality_stack_keywords': [r'\bk8s\b'], 'title_exclude_keywords': ['sales'], 'remote_excluded_regions': ['latam'],
                      'board_discovery_keywords': ['devops'], 'google_jobs': {'queries': ['sre'], 'locations': [{'location': 'Zurich,Zurich,Switzerland', 'language': 'de'}, 'bad']}}
            with mock.patch.object(desktop.digest, 'eligible_jobs', lambda db: ([{'id': 1}, {'id': 2}], [])), \
                    mock.patch.object(desktop.score, 'load', lambda db: fits), mock.patch('src.paths.load_search_config', lambda matching=True: search):
                data = desktop.strategy(db, tracker)
            db.close()
        self.assertEqual(data['roles'], ['site reliability', 'vendeur', 'warehouse'])   # one list: the searches first, the other role words after (src/target_roles.py)
        self.assertEqual(data['locations'], ['zürich', 'switzerland', 'berlin'])
        self.assertEqual(data['stack'], ['k8s'])
        self.assertEqual(data['compensation'], 'Target: CHF 150k')
        # The full lists for editing on the Strategy page: every entry, stored form (to remove it) and words, each place list on its own.
        self.assertEqual(data['lists']['places'], [{'fragment': 'z[uü]rich', 'label': 'zürich'}])
        self.assertEqual([e['label'] for e in data['lists']['country']], ['switzerland', 'bern'])
        self.assertEqual(data['lists']['stack'], [{'fragment': r'\bk8s\b', 'label': 'k8s'}])
        # Each role with its family (src/role_kinds.py), for the page's Retail / Logistics groups.
        self.assertEqual([(e['label'], e['kind']) for e in data['lists']['roles']], [('site reliability', 'software'), ('vendeur', 'sales_retail'), ('warehouse', 'logistics')])
        self.assertEqual([e['searched'] for e in data['lists']['roles']], [True, True, True])   # the first five titles are also searched on job boards
        self.assertNotIn('queries', data['texts'])   # no second list
        # What only ⚙️ Search settings showed, for the Strategy page's "More search settings" (desktop/lib/strategy-edit.js).
        self.assertEqual(data['lists']['remoteSkip'], [{'fragment': 'latam', 'label': 'latam'}])
        self.assertEqual([e['label'] for e in data['lists']['finders']], ['devops'])
        self.assertEqual([e['label'] for e in data['lists']['titleSkip']], ['sales'])
        self.assertEqual(data['texts']['gqueries'], ['sre'])
        self.assertEqual(data['texts']['gplaces'], ['Zurich,Zurich,Switzerland · de'])
        self.assertIn('skip', data['texts'])
        self.assertIn('digest_min_score', data)
        self.assertIn('Title: sales', data['avoid'])
        self.assertEqual({c['key']: c['value'] for c in data['components']},
                         {'role_fit': 70, 'location': 50, 'compensation': 50, 'growth': 50, 'risk': 80})  # risk shown as "low risk"
        self.assertEqual(data['counts'], {'matches': 2, 'kits': 1, 'sent': 2})
        self.assertFalse(data['profile_empty'])
        tracker.page_text = lambda: '# Hard constraints\nConstraint | Value\nCountries | ❓ e.g. "Switzerland (anywhere)"\nHome base | ❓ your current city'
        with mock.patch.object(desktop.digest, 'eligible_jobs', lambda db: ([], [])), mock.patch.object(desktop.score, 'load', lambda db: {}), \
                mock.patch('src.paths.load_search_config', lambda matching=True: search), mock.patch('src.paths.local_profile', lambda: ''), \
                tempfile.TemporaryDirectory() as tmp:
            db = store.connect(Path(tmp) / 'j.sqlite')
            self.assertTrue(desktop.strategy(db, tracker)['profile_empty'])   # the blank template: the Strategy page says scores are paused
            db.close()


class StrategyInsightTests(unittest.TestCase):
    def test_the_latest_insight_skips_the_interview_patterns_row_without_a_notion_filter(self):
        # A Notion filter on the "Interview patterns" option is refused (400) before the app's schema repair adds it,
        # which left the Strategy insight empty: the row is skipped here instead.
        import tempfile
        from pathlib import Path
        from types import SimpleNamespace
        from unittest import mock
        from src import desktop, store
        select = lambda name: {'type': 'select', 'select': {'name': name}}
        title = lambda value: {'type': 'title', 'title': [{'plain_text': value}]}
        bodies = []
        date = lambda day: {'type': 'date', 'date': {'start': day}}

        def query(database_id, filter_=None):
            bodies.append(filter_)
            if filter_:
                raise RuntimeError('HTTP Error 400: Bad Request')
            return [{'id': 'i-1', 'properties': {'Category': select('Interview patterns'), 'Insight': title('patterns'), 'Date': date('2026-10-02')}},
                    {'id': 'i-2', 'properties': {'Category': select('Skills'), 'Insight': title('daily'), 'Date': date('2026-10-01')}}]
        tracker = SimpleNamespace(url_stages=lambda: {}, page_text=lambda: '', query_database=query)
        with tempfile.TemporaryDirectory() as tmp:
            db = store.connect(Path(tmp) / 'j.sqlite')
            with mock.patch.object(desktop.digest, 'eligible_jobs', lambda db: ([], [])), \
                    mock.patch.object(desktop.score, 'load', lambda db: {}), mock.patch('src.paths.load_search_config', lambda matching=True: {}), \
                    mock.patch('src.ai.insights.INSIGHTS_DATABASE_ID', 'insights-db'):
                data = desktop.strategy(db, tracker)
            db.close()
        self.assertEqual(bodies, [None])
        self.assertEqual((data['insight']['headline'], data['insight']['url']), ('daily', 'https://www.notion.so/i2'))


class DeleteTests(unittest.TestCase):
    """A dismissed job deleted (7 Oct 2026: two Anthropic rows a Gmail check had made): Notion pages to the trash, a local marker, never back."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = store.connect(Path(self.tmp.name) / 'jobs.sqlite')
        self.job = {'title': 'Staff Software Engineer', 'company': 'Anthropic', 'url': 'https://x.test/a', 'location': 'Remote'}
        store.upsert_job(self.db, self.job, 'Anthropic', source_kind='employer feed')
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def stores(self, stage):
        """A store holding the job's Applications row at `stage` (none when empty) and its Job Matches record."""
        stores = memory.open_store()
        if stage:
            stores.applications.create({'url': 'https://x.test/a', 'title': 'Staff Software Engineer'}, stage)
        stores.matches.upsert({'url': 'https://x.test/a', 'title': 'Staff Software Engineer', 'status': 'Open'})
        return stores

    def test_only_a_dismissed_job_can_be_deleted(self):
        result = desktop.delete_job(self.db, 'https://x.test/a')
        self.assertFalse(result['ok'])
        self.assertIn('Dismiss it first', result['error'])
        self.assertFalse(desktop.delete_job(self.db, 'https://x.test/a', self.stores('Applied'))['ok'])

    def test_a_dismissed_job_leaves_the_store_and_no_search_brings_it_back(self):
        desktop.set_status(self.db, 'https://x.test/a', 'dismissed')
        stores = self.stores('Dismissed')
        self.assertEqual(desktop.delete_job(self.db, 'https://x.test/a', stores), {'ok': True, 'trashed': 2})
        self.assertIsNone(stores.applications.get('https://x.test/a'))
        self.assertEqual(stores.matches.list(), [])
        self.assertEqual(desktop.jobs(self.db)['jobs'], [])
        store.upsert_job(self.db, self.job, 'Anthropic', source_kind='employer feed')   # the next search sees the posting again
        self.db.commit()
        self.assertEqual(desktop.jobs(self.db)['jobs'], [], 'still deleted')

    def test_a_store_refusing_changes_nothing(self):
        desktop.set_status(self.db, 'https://x.test/a', 'dismissed')
        stores = self.stores('Dismissed')
        stores.applications.delete = lambda app_id: (_ for _ in ()).throw(RuntimeError('503'))
        result = desktop.delete_job(self.db, 'https://x.test/a', stores)
        self.assertFalse(result['ok'])
        self.assertIn('nothing was deleted', result['error'])
        self.assertEqual(len(desktop.jobs(self.db)['jobs']), 1)

    def test_a_deleted_job_stays_out_while_notion_still_lists_its_trashed_page(self):
        desktop.set_status(self.db, 'https://x.test/a', 'dismissed')
        desktop.delete_job(self.db, 'https://x.test/a', self.stores('Dismissed'))
        lagging = [{'url': 'https://x.test/a', 'stage': 'Dismissed', 'title': 'Staff Software Engineer', 'company': 'Anthropic', 'location': 'Remote'},
                   {'url': 'https://x.test/b', 'stage': 'Saved', 'title': 'Photographer', 'company': 'Studio', 'location': 'Geneva'}]
        self.assertEqual([job['url'] for job in desktop.jobs(self.db, notion_jobs=lagging)['jobs']], ['https://x.test/b'])

    def test_jobs_says_when_the_profile_is_still_blank(self):
        """Jobs carries the verdict Strategy shows ("Your Profile is empty", #2759): one test, this Mac's file first, then the store's page."""
        import os
        from types import SimpleNamespace
        from unittest import mock
        blank, filled = '# Profile\n\n- Target: \u2753\n', '# Profile\n\n' + 'I am a nurse with ten years on a surgical ward. ' * 6
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp, 'profile.md')
            for text, expected in ((blank, True), (filled, False)):
                file.write_text(text, encoding='utf-8')
                with mock.patch.dict(os.environ, {'JOB_PILOTTO_PROFILE_FILE': str(file)}):
                    self.assertEqual(desktop._profile_blank(None, None), expected, 'this Mac\'s Profile file')
            with mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop('JOB_PILOTTO_PROFILE_FILE', None)
                self.assertTrue(desktop._profile_blank(SimpleNamespace(page_text=lambda: blank), None), 'a blank Notion page')
                self.assertFalse(desktop._profile_blank(SimpleNamespace(page_text=lambda: filled), None))
                def fails():
                    raise RuntimeError('no Notion')
                self.assertFalse(desktop._profile_blank(SimpleNamespace(page_text=fails), None), 'a Profile that cannot be read says nothing')
        # the same test Strategy uses
        self.assertTrue(desktop.blank_profile(blank)); self.assertFalse(desktop.blank_profile(blank, readable=False)); self.assertFalse(desktop.blank_profile(None))
