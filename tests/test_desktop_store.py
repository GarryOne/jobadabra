"""The desktop's engine commands on this Mac's store (JOB_PILOTTO_STORE=sqlite, no Notion at all): Strategy, Calendar and
Tune answer from the store's own applications and Profile, and the Notion messages stay for a Notion store that can't be read.
Guards src/desktop.py, src/desktop_strategy.py, src/store_access.py and tune.run's stages."""
import contextlib
import io
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock

from src import desktop, store_access
from src.stores import sqlite as sqlite_store


class DesktopOnThisMacsStoreTests(unittest.TestCase):
    def setUp(self):
        folder = pathlib.Path(tempfile.mkdtemp())
        env = {'JOB_PILOTTO_STORE': 'sqlite', 'JOB_PILOTTO_DATA_DIR': str(folder), 'NOTION_TOKEN': '',
               'JOB_PILOTTO_PROFILE_FILE': str(folder / 'no-profile.md')}
        patches = [mock.patch.dict(os.environ, env), mock.patch.object(desktop, 'JOBS_DB', folder / 'jobs.sqlite'),
                   mock.patch('src.notion.client.Tracker.from_env', return_value=None)]   # no Notion at all
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.stores = sqlite_store.open_store(env)
        sre, _ = self.stores.applications.set_stage({'url': 'https://jobs.example/sre', 'title': 'SRE', 'company': 'Acme'}, 'Interviewing')
        self.stores.applications.update(sre['id'], {'next_interview': '2026-10-20T10:00:00+02:00'})
        self.stores.applications.set_stage({'url': 'https://jobs.example/ops', 'title': 'Ops', 'company': 'Beta'}, 'Kit ready')
        self.stores.texts.set('profile', '# Me\n- **Work mode:** Hybrid\n- **Minimum acceptable:** CHF 120,000\n')

    def command(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(desktop.main(list(argv)), 0)
        return json.loads(out.getvalue().strip().splitlines()[-1])

    def test_strategy_counts_and_goals_come_from_the_store(self):
        with mock.patch('src.paths.load_search_config', lambda matching=True: {}):
            data = self.command('strategy')
        self.assertEqual(data['counts']['kits'], 1)
        self.assertEqual(data['counts']['sent'], 1)                    # Interviewing counts as sent
        self.assertEqual(data['goals'], {'work_mode': 'Hybrid', 'minimum_salary': 'CHF 120,000'})

    def test_strategy_averages_only_the_known_parts_of_a_fit(self):
        # 17 Oct 2026: a fit with compensation None (no salary stated) broke the whole Search strategy page ("Could not read your strategy").
        from src import desktop_strategy
        jobs = [{'id': 'a'}, {'id': 'b'}]
        fits = {'a': {'components': {'role_fit': 80, 'compensation': None}}, 'b': {'components': {'role_fit': 60, 'compensation': 70}}}
        with mock.patch('src.paths.load_search_config', lambda matching=True: {}), \
                mock.patch.object(desktop_strategy.digest, 'eligible_jobs', lambda db: (jobs, None)), \
                mock.patch.object(desktop_strategy.score, 'load', lambda db: fits):
            parts = {part['key']: part['value'] for part in self.command('strategy')['components']}
        self.assertEqual(parts['role_fit'], 70)
        self.assertEqual(parts['compensation'], 70, 'the None part is left out, not counted as 0')

    def test_the_calendar_lists_the_stores_applications(self):
        jobs = self.command('calendar')['jobs']
        self.assertEqual([(j['title'], j['next_interview']) for j in jobs if j['next_interview']], [('SRE', '2026-10-20T10:00:00+02:00')])

    def test_tune_reads_the_stores_outcomes_instead_of_asking_for_notion(self):
        seen = {}
        with mock.patch('src.paths.load_search_config', lambda matching=True: {}), \
                mock.patch('src.tune.acted_jobs', lambda db, stages: seen.update(stages) or []):
            data = self.command('tune')
        self.assertTrue(data['ok'], data)
        self.assertEqual(seen, {'https://jobs.example/sre': 'Interviewing', 'https://jobs.example/ops': 'Kit ready'})

    def test_a_notion_store_that_cannot_be_read_keeps_todays_message(self):
        notion_named = mock.Mock()
        notion_named.name = 'notion'
        with mock.patch.object(store_access, 'open_stores', lambda tracker=None: notion_named):
            self.assertIn('Connect Notion first', self.command('tune')['error'])
            self.assertEqual(self.command('calendar'), {'jobs': [], 'error': 'Notion is not connected.'})


    def role_ideas(self):
        """The role-ideas command on this store: the words it hands the ideas as set aside, and what it prints."""
        sent = []
        def ideas(profile, search, titles, set_aside=()):
            sent.append(list(set_aside))
            return [{'role': 'Seller', 'word': 'vendeur', 'why': 'Shop', 'count': 3}]
        with mock.patch.object(desktop, '_role_ideas_on', return_value=True), mock.patch('src.ai.role_ideas.ideas', ideas), \
                mock.patch('src.coverage.load', return_value={}), mock.patch('src.paths.load_search_config', lambda matching=True: {'role_keywords': ['sre']}):
            return self.command('role-ideas'), sent

    def test_role_ideas_leave_out_the_words_a_not_true_kept_in_the_store(self):
        """#2350 (Gitar): the words live on the answer row in the store, so every Mac of it reads the same; nothing else sends them."""
        self.stores.insights.add({'day': '2026-10-28', 'category': 'Suggestion', 'title': 'Add Cashier',
                                  'fields': {'state': 'Not true', 'data': json.dumps({'aside': ['Caissier']}), 'input_hash': 'ideas:old'}})
        said, sent = self.role_ideas()
        self.assertEqual(sent, [['caissier']])
        self.assertTrue(said['ok'] and said['key'].startswith('ideas:'))

    def test_role_ideas_still_come_when_the_store_cannot_list_the_answers(self):
        """#2350 (Gitar): a failed read of the answers costs only their filter this time, never the whole row."""
        err = io.StringIO()
        with mock.patch.object(type(self.stores.insights), 'list', side_effect=OSError('offline')), contextlib.redirect_stderr(err):
            said, sent = self.role_ideas()
        self.assertEqual((said['ok'], [i['word'] for i in said['ideas']], sent), (True, ['vendeur'], [[]]))
        self.assertIn('set-aside roles not read', err.getvalue())

if __name__ == '__main__':
    unittest.main()
