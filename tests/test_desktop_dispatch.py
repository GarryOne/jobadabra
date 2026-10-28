# Characterize every desktop command's output, dependencies and execution order.
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import desktop


COMMANDS = ('jobs delete status unapply not-submitted posting calendar clear-jobs strategy rescore-outdated '
            'refresh-locations places-now tune explain-coverage visit-outcome visit-hide stuck-jobs stuck-dismiss '
            'set-description visit-list visit-unblock visit-filters visit-context visit-session visit-jobpages '
            'visit-jobpage visit-read refused-queue refused-judge refused-outcome visit-understand visit-recipe role-ideas coverage').split()
URL = 'https://example.test/jobs'
VALUE = {'text': 'Zürich'}
ERROR = 'Your job tracker could not be updated (OSError); nothing changed. Try again.'


class DispatchTests(unittest.TestCase):
    # Give every command disposable folders and mocked external dependencies.
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.folder = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.stack.enter_context(mock.patch.dict(os.environ, {
            'JOB_PILOTTO_DATA_DIR': str(self.folder), 'JOB_PILOTTO_CONFIG_DIR': str(self.folder),
            'JOB_PILOTTO_STORE': 'notion', 'JOB_PILOTTO_NO_DOTENV': '1', 'NOTION_TOKEN': '',
        }))
        self.patch('socket.create_connection', side_effect=AssertionError('network forbidden'))
        self.patch('urllib.request.urlopen', side_effect=AssertionError('network forbidden'))
        self.patch('src.ai.engine.client', side_effect=AssertionError('AI forbidden'))
        self.patch('src.desktop.JOBS_DB', self.folder / 'jobs.sqlite')
        self.db = mock.MagicMock(name='db')
        self.connect = self.patch('src.desktop.store.connect')
        self.connect.return_value.__enter__.return_value = self.db
        self.tracker = mock.Mock(name='tracker')
        self.tracker.notion_jobs.return_value = []
        self.from_env = self.patch('src.notion.client.Tracker.from_env', return_value=self.tracker)
        self.stores = mock.Mock(name='stores')
        self.stores.name = 'sqlite'
        self.open_stores = self.patch('src.stores.open_stores', return_value=self.stores)
        self.run_stores = self.patch('src.store_access.run_stores', return_value=(self.stores, self.tracker))
        self.search = json.loads((Path(__file__).resolve().parents[1] / 'config/search.json').read_text())
        self.search.update(role_keywords=['sre'], locations={'top_tier': ['zurich'], 'country_wide': [], 'abroad': ['bern']},
                           title_exclude_keywords=['sales'])
        self.config = self.patch('src.paths.load_search_config', return_value=self.search)
        self.patch('src.ai.providers.who', return_value='AI')
        self.page = self.folder / 'page.json'
        self.page.write_text(json.dumps({'url': URL, 'html': '<p>é</p>', 'title': 'Jobs'}))
        self.commands_seen = set()

    # -> a patched dependency at the name used by the command's imports.
    def patch(self, name, *args, **kwargs):
        return self.stack.enter_context(mock.patch(name, *args, **kwargs))

    # Reject command-only imports during startup in a fresh, isolated interpreter.
    def test_command_imports_stay_lazy(self):
        root = Path(__file__).resolve().parents[1]
        config = self.folder / 'config'
        shutil.copytree(root / 'config', config)
        env = {'PATH': os.environ.get('PATH', ''), 'SYSTEMROOT': os.environ.get('SYSTEMROOT', ''),
               'JOB_PILOTTO_DATA_DIR': str(self.folder / 'data'), 'JOB_PILOTTO_CONFIG_DIR': str(config),
               'JOB_PILOTTO_APP_DIR': str(self.folder / 'app'), 'JOB_PILOTTO_NO_DOTENV': '1',
               'JOB_PILOTTO_FOLLOW_APP': '0', 'PYTHONDONTWRITEBYTECODE': '1'}
        script = '''import importlib.abc, socket, sys
from unittest import mock
sys.path.insert(0, sys.argv[1])
socket.socket.connect = mock.Mock(side_effect=AssertionError('network forbidden'))
class CommandImports(importlib.abc.MetaPathFinder):
    # Fail before a command-only module can execute an import-time side effect.
    def find_spec(self, fullname, path=None, target=None):
        if fullname in ('src.ai.few_jobs', 'src.ai.role_ideas', 'src.ai.visit_unblock',
                        'src.ai.visit_filters', 'src.ai.visit_reader', 'src.sources.refused_reads',
                        'src.sources.refused_state', 'src.scout', 'src.tune', 'src.clear_jobs'):
            raise AssertionError('command-only import at startup: ' + fullname)
sys.meta_path.insert(0, CommandImports())
import src.desktop
'''
        run = subprocess.run([sys.executable, '-I', '-c', script, str(root)], env=env, capture_output=True, text=True)
        self.assertEqual((run.returncode, run.stdout, run.stderr), (0, '', ''))

    # -> exact output and exit status, including whether stdout precedes database exit.
    def call(self, command, expected, *args, ascii=False, err='', outside=False):
        self.commands_seen.add(command)
        out, stderr, at_exit = io.StringIO(), io.StringIO(), []
        self.connect.return_value.__exit__.side_effect = lambda *a: at_exit.append(out.getvalue()) or False
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(stderr):
            code = desktop.main([command, *args])
        written = json.dumps(expected, ensure_ascii=ascii) + '\n'
        self.assertEqual((code, out.getvalue(), stderr.getvalue()), (0, written, err))
        self.assertEqual(at_exit[-1], '' if outside else written)
        self.connect.assert_called_with(desktop.JOBS_DB)

    # Pin simple command payloads, JSON escaping and dependency arguments.
    def test_simple_commands(self):
        cases = [
            ('visit-outcome', 'src.sources.visits.outcome', (str(self.page),), ({'url': URL, 'html': '<p>é</p>', 'title': 'Jobs'},), {'ok': True}, True),
            ('visit-hide', 'src.sources.visits.hide', (URL,), (URL,), {'ok': True}, True),
            ('stuck-dismiss', 'src.sources.visits.dismiss', (URL,), (URL,), {'ok': True}, True),
            ('stuck-jobs', 'src.sources.describe.stuck', (), (self.db,), {'ok': True, 'jobs': VALUE}, False),
            ('set-description', 'src.sources.describe.save_text', (str(self.page),), (self.db, URL, ''), {'ok': True, 'saved': VALUE}, True),
            ('visit-list', 'src.desktop._visits', (), (self.search,), {'ok': True, 'visits': VALUE}, False),
            ('visit-session', 'src.sources.visits.session_result', ('session',), ('session',), {'ok': True, 'result': VALUE}, False),
            ('visit-jobpage', 'src.sources.visits.job_page', (str(self.page),), (URL, '<p>é</p>'), {'ok': True, 'url': VALUE}, True),
            ('places-now', 'src.ai.locations.fingerprint_now', (), (), {'places': VALUE}, True),
            ('strategy', 'src.desktop.strategy', (), (self.db, self.tracker), VALUE, False),
        ]
        for command, target, args, passed, result, ascii in cases:
            with self.subTest(command=command), mock.patch(target, return_value=VALUE) as called:
                self.call(command, result, *args, ascii=ascii)
                called.assert_called_once_with(*passed)
        self.assertEqual(self.commands_seen, {case[0] for case in cases})

    # Pin posting lookup order and store fallback diagnostics.
    def test_posting_cache_store_and_failure(self):
        found = self.patch('src.desktop.posting', return_value={'ok': True, **VALUE})
        fallback = self.patch('src.desktop.store_posting', return_value={'ok': True, **VALUE})
        self.call('posting', {'ok': True, **VALUE}, 'abc')
        found.assert_called_once_with(self.db, 'abc')
        fallback.assert_not_called()
        found.return_value = {'ok': False, 'error': 'job not found'}
        self.call('posting', {'ok': True, **VALUE}, 'abc')
        fallback.assert_called_once_with(self.stores, 'abc')
        self.open_stores.assert_called_once_with()
        fallback.side_effect = OSError('offline')
        self.call('posting', found.return_value, 'abc', err='Store posting not read: OSError: offline\n')
        self.from_env.assert_not_called()

    # Pin coverage inputs and explanation with or without a verdict.
    def test_coverage_and_explanation(self):
        load = self.patch('src.coverage.load', return_value={'missed_titles': ['Ops']})
        checked = self.patch('src.suggestions_search.checked', return_value=VALUE)
        self.call('coverage', VALUE)
        checked.assert_called_once_with(self.search, load.return_value, extras=True)
        verdict = self.patch('src.coverage.verdict', return_value={'narrow': True})
        drops = self.patch('src.coverage.language_drops', return_value=['German'])
        explain = self.patch('src.ai.few_jobs.explain', return_value=VALUE)
        self.patch('src.desktop._role_ideas_on', return_value=True)
        self.call('explain-coverage', VALUE)
        verdict.assert_called_once_with(load.return_value, ['sre'], ['zurich', 'bern'], ['sales'], by_ai=True)
        explain.assert_called_once_with({'narrow': True, 'languages': ['German']}, self.search)
        verdict.return_value = None
        explain.reset_mock()
        self.call('explain-coverage', VALUE)
        explain.assert_called_once_with(None, self.search)
        drops.assert_called_once_with()

    # Pin role idea gating, profile fallback and recoverable read failures.
    def test_role_ideas_paths(self):
        on = self.patch('src.desktop._role_ideas_on', return_value=False)
        self.call('role-ideas', {'ok': True, 'ideas': []}, ascii=True)
        on.return_value = True
        opened = self.patch('src.store_access.open_run', return_value=self.stores)
        local = self.patch('src.paths.local_profile', return_value='profile')
        source = self.patch('src.store_access.profile_source', return_value=mock.Mock(return_value='store profile'))
        aside = self.patch('src.suggestions.set_aside', return_value=['old'])
        self.patch('src.coverage.load', return_value={'missed_titles': ['Ops']})
        ideas = self.patch('src.ai.role_ideas.ideas', return_value=[VALUE])
        key = self.patch('src.suggestions_search.ideas_key', return_value='key')
        self.call('role-ideas', {'ok': True, 'ideas': [VALUE], 'key': 'key'})
        opened.assert_called_once_with()
        ideas.assert_called_once_with('profile', self.search, ['Ops'], ['old'])
        from src.ai.insights_data import ANSWER_CATEGORY
        self.stores.insights.list.assert_called_once_with(category=ANSWER_CATEGORY)
        aside.assert_called_once_with(self.stores.insights.list.return_value)
        key.assert_called_once_with(self.search)
        source.assert_not_called()
        local.return_value = ''
        self.stores.insights.list.side_effect = OSError('offline')
        self.call('role-ideas', {'ok': True, 'ideas': [VALUE], 'key': 'key'},
                  err='Warning: set-aside roles not read (OSError: offline)\n')
        ideas.assert_called_with('store profile', self.search, ['Ops'], [])
        source.return_value.assert_called_once_with()
        source.return_value = None
        self.stores.insights.list.side_effect = None
        self.patch('src.coverage.load', return_value=None)
        self.call('role-ideas', {'ok': True, 'ideas': [VALUE], 'key': 'key'})
        ideas.assert_called_with('', self.search, [], ['old'])
        ideas.side_effect = OSError('offline')
        self.call('role-ideas', {'ok': False, 'ideas': [], 'error': 'No role ideas this time (OSError)'}, ascii=True)

    # Pin search context words and job-page country inputs.
    def test_visit_context_and_jobpages(self):
        terms = self.patch('src.notion.search_settings.terms', side_effect=lambda values: list(values or []))
        self.call('visit-context', {'role_words': ['sre'], 'places_first': ['zurich'], 'places_also': ['bern'], 'title_words_ruled_out': ['sales']}, str(self.page))
        self.assertEqual(terms.call_args_list, [mock.call(['sre']), mock.call(['zurich']), mock.call(['bern']), mock.call(['sales'])])
        self.config.assert_called_with(matching=False)
        me = self.patch('src.employer_index.me_now', return_value={'countries': ['CH']})
        find = self.patch('src.sources.visits.find_job_pages', return_value=VALUE)
        self.call('visit-jobpages', {'ok': True, 'pages': VALUE}, str(self.page), ascii=True)
        find.assert_called_once_with(json.loads(self.page.read_text()), ['CH'])
        me.return_value = {}
        self.call('visit-jobpages', {'ok': True, 'pages': VALUE}, str(self.page), ascii=True)
        find.assert_called_with(json.loads(self.page.read_text()), [])

    # Pin both planners, their detailed diagnostics and error payloads.
    def test_visit_planners_success_and_errors(self):
        from src.digest import PREFERENCES
        for command, module, function, failure in [('visit-unblock', 'visit_unblock', 'plan_twice', 'find a way to the jobs'),
                                                    ('visit-filters', 'visit_filters', 'plan', 'choose the filters')]:
            with self.subTest(command=command):
                model = self.patch(f'src.ai.{module}.SECOND_MODEL', 'second') if command == 'visit-unblock' else None
                steps = [{'action': 'click', 'label': 'é' * 45, 'value': ''}, {'action': 'type', 'label': 'Place', 'value': 'Zürich'}]
                planned = {'steps': steps, 'needs_person': 'sign in', 'model': 'second'}
                plan = self.patch(f'src.ai.{module}.{function}', return_value=planned)
                suffix = ' (needs you: sign in) (Sonnet, after Haiku found no way)' if model else ''
                prefix = 'Visit unblock' if model else 'Visit filters'
                self.call(command, {'ok': True, **planned}, str(self.page),
                          err=f'{prefix}: 2 steps for {URL}: click {"é" * 40}; type Place = Zürich{suffix}\n')
                plan.assert_called_once_with(json.loads(self.page.read_text()), self.search, PREFERENCES)
                plan.return_value = {'steps': [], 'needs_person': '', 'model': 'first'}
                self.call(command, {'ok': True, **plan.return_value}, str(self.page), err=f'{prefix}: 0 steps for {URL}: \n')
                plan.side_effect = OSError('offline')
                self.call(command, {'ok': False, 'error': f'AI could not {failure} (OSError)'}, str(self.page), ascii=True)

    # Pin recipe invalidation, learning and reader fallback diagnostics.
    def test_recipe_and_understand(self):
        forget = self.patch('src.sources.visits.forget_recipe')
        missed = self.patch('src.sources.visits.recipe_missed', return_value=False)
        recipe = self.patch('src.sources.visits.recipe_for', return_value=VALUE)
        for page, forgotten, result in [({'url': URL}, False, VALUE), ({'url': URL, 'forget': True}, False, None),
                                         ({'url': URL, 'missed': True}, False, VALUE)]:
            self.page.write_text(json.dumps(page))
            self.call('visit-recipe', {'ok': True, 'forgot': forgotten, 'recipe': result}, str(self.page), ascii=True)
        forget.assert_called_once_with(URL)
        recipe.assert_has_calls([mock.call(URL), mock.call(URL)])
        missed.assert_called_once_with(URL)
        missed.return_value = True
        self.call('visit-recipe', {'ok': True, 'forgot': True, 'recipe': None}, str(self.page), ascii=True)
        understand = self.patch('src.ai.visit_reader.understand_twice', return_value=(VALUE, 'second'))
        self.patch('src.ai.visit_reader.SECOND_MODEL', 'second')
        save = self.patch('src.sources.visits.save_recipe')
        self.call('visit-understand', {'ok': True, 'recipe': VALUE}, str(self.page),
                  err=f'Visit: Haiku found no job list on {URL}; Sonnet did\n')
        understand.assert_called_once_with({'url': URL, 'missed': True})
        save.assert_called_once_with(URL, VALUE)
        understand.return_value = (None, 'first')
        self.call('visit-understand', {'ok': True, 'recipe': None}, str(self.page))
        self.page.write_text(json.dumps({'url': URL, 'groups': ['cards']}))
        self.call('visit-understand', {'ok': True, 'recipe': None}, str(self.page), err=f'Visit: no job list on {URL}, by Haiku nor Sonnet\n')
        understand.side_effect = OSError('offline')
        self.call('visit-understand', {'ok': False, 'error': 'AI could not read this page (OSError)'}, str(self.page), ascii=True)
        save.assert_called_once_with(URL, VALUE)

    # Pin refused-read options, page defaults and feed registration.
    def test_refused_queue_judge_and_outcome(self):
        queue = self.patch('src.sources.refused_reads.queue', return_value=[VALUE])
        self.call('refused-queue', {'ok': True, 'sites': [VALUE]})
        queue.assert_called_once_with(now_hosts=[], everything=False)
        self.call('refused-queue', {'ok': True, 'sites': [VALUE]}, '--now', URL, '--now', 'other', '--all')
        queue.assert_called_with(now_hosts=[URL, 'other'], everything=True)
        state = self.patch('src.sources.refused_state.page_state', return_value=VALUE)
        self.call('refused-judge', {'ok': True, 'state': VALUE}, str(self.page), ascii=True)
        state.assert_called_once_with(None, '<p>é</p>', 'Jobs', '')
        outcome = self.patch('src.sources.refused_reads.outcome', return_value={'ok': True, **VALUE})
        self.call('refused-outcome', {'ok': True, **VALUE}, str(self.page))
        outcome.assert_called_once_with(URL, None, '<p>é</p>', 'Jobs', '', step='download', captcha=False)
        ensure = self.patch('src.scout.ensure_tables')
        self.patch('src.desktop.datetime').now.return_value.isoformat.return_value = 'now'
        outcome.return_value = {'feed': 'feed', 'name': 'Zürich', 'ok': True}
        for step in ('engine', 'download', 'tab', 'invalid'):
            self.page.write_text(json.dumps({'url': URL, 'step': step, 'captcha': True}))
            self.call('refused-outcome', {'name': 'Zürich', 'ok': True}, str(self.page))
            outcome.assert_called_with(URL, None, '', '', '', step=step if step != 'invalid' else 'download', captcha=True)
        ensure.assert_called_with(self.db)
        self.assertEqual(self.db.commit.call_count, 4)
        self.assertEqual(self.db.execute.call_args.args[1], ('feed', 'Zürich', 'now'))

    # Pin browser-read inputs and sequential feed registration effects.
    def test_visit_read_registers_feeds_in_order(self):
        result = {'feed': 'feed', 'name': 'Zürich', 'jobs': [1, 2], 'added': 1, 'fits': 2, 'kind': 'list'}
        read = self.patch('src.sources.visits.read', return_value=result)
        ensure = self.patch('src.scout.ensure_tables')
        detect = self.patch('src.sources.ats.detect', return_value=None)
        self.patch('src.desktop.datetime').now.return_value.isoformat.return_value = 'now'
        expected = {'ok': True, 'name': 'Zürich', 'jobs': 2, 'added': 1, 'fits': 2, 'kind': 'list', 'in_places': 0, 'placed': 0}
        self.call('visit-read', expected, str(self.page))
        read.assert_called_once_with(URL, '<p>é</p>', None, 'Jobs', session='', start='', known_list=False, place='')
        ensure.assert_called_once_with(self.db)
        detect.assert_called_once_with(URL)
        self.assertEqual(self.db.execute.call_args.args[1], ('feed', 'Zürich', 'now'))
        self.patch('src.sources.ats.FETCHERS', {'system': object(), 'careers': object(), 'visit': object()})
        for system in [('missing', 'slug'), ('careers', 'slug'), ('visit', 'slug'), ('system', 'slug')]:
            detect.return_value = system
            self.db.execute.return_value.rowcount = 0
            self.call('visit-read', expected, str(self.page))
        self.db.execute.return_value.rowcount = 1
        self.page.write_text(json.dumps({'url': URL, 'site': 'Example', 'session': 's', 'start': 'a', 'known_list': 1, 'place': 7}))
        result.update(in_places=4, placed=3)
        self.call('visit-read', {**expected, 'in_places': 4, 'placed': 3}, str(self.page),
                  err='Visit: Example runs on system (slug): read by every search from now on, no browser needed\n')
        read.assert_called_with(URL, '', None, '', session='s', start='a', known_list=True, place='7')
        self.assertEqual(self.db.execute.call_args.args[1], ('system', 'slug', 'Example', 'now'))
        self.assertEqual(self.db.commit.call_count, 6)

    # Pin stage reversals, event removal and tracker error messages.
    def test_tracker_commands(self):
        revert = self.patch('src.stores.rules.revert_applying', return_value='updated')
        self.call('unapply', {'ok': True, 'notion': 'updated'}, URL, ascii=True)
        revert.assert_called_once_with(self.stores, URL)
        self.open_stores.assert_called_with(tracker=self.tracker)
        revert.side_effect = OSError()
        self.call('unapply', {'ok': False, 'error': ERROR}, URL, ascii=True)
        undo = self.patch('src.stores.rules.revert_unsubmitted')
        from src.stores import rules
        for outcome, row, dropped, error in [(rules.UPDATED, {'id': 'row'}, 2, None), (rules.UPDATED, None, 0, None),
                ('unchanged', None, 0, 'That job is not at Applied, so there is nothing to undo.'),
                ('past', None, 0, 'That job is past Applied (a confirmation or an interview is recorded), so its stage is not changed here.')]:
            undo.return_value = outcome, row
            self.stores.events.archive.return_value = 2
            self.call('not-submitted', {'ok': outcome == rules.UPDATED, 'notion': outcome, 'events': dropped,
                                       **({'error': error} if error else {})}, URL, ascii=True)
        undo.assert_called_with(self.stores, URL)
        self.stores.events.archive.assert_called_once_with('row', 'Applied')
        undo.side_effect = OSError()
        self.call('not-submitted', {'ok': False, 'error': ERROR}, URL, ascii=True)

    # Pin calendar, clearing and status command contracts.
    def test_calendar_clear_and_status(self):
        calendar = self.patch('src.desktop.calendar_jobs', return_value=VALUE)
        self.call('calendar', VALUE)
        calendar.assert_called_once_with(self.stores, self.tracker)
        plan = self.patch('src.clear_jobs.plan', return_value=VALUE)
        clear = self.patch('src.clear_jobs.clear', return_value=VALUE)
        self.call('clear-jobs', VALUE, '--dry-run')
        plan.assert_called_once_with(self.db, self.stores, True)
        self.call('clear-jobs', {'ok': True, **VALUE})
        clear.assert_called_once_with(self.db, self.stores, True)
        clear.side_effect = OSError()
        self.call('clear-jobs', {'ok': False, 'error': 'Your job list could not be cleared (OSError); nothing changed. Try again.'})
        for command, target, args in [('delete', 'delete_job', (URL,)), ('status', 'set_status', (URL, 'saved'))]:
            with mock.patch.object(desktop, target, return_value=VALUE) as change:
                self.call(command, VALUE, *args, outside=True)
                change.assert_called_once_with(self.db, *args, self.stores)

    # Pin refresh inputs, active job selection and strategy gating.
    def test_rescore_refresh_and_tune(self):
        stages = self.patch('src.store_access.url_stages', return_value={'url': 'Applied'})
        rescore = self.patch('src.desktop_strategy.rescore_outdated', return_value=2)
        self.call('rescore-outdated', {'queued': 2}, ascii=True)
        rescore.assert_called_once_with(self.db, stages.return_value)
        stages.side_effect = OSError()
        self.call('rescore-outdated', {'queued': 2}, ascii=True)
        rescore.assert_called_with(self.db, {})
        active = self.patch('src.ai.locations.active_ids', side_effect=lambda *a: {1, 2})
        ids = self.patch('src.ai.locations.id_for_url', return_value={2, 3})
        current = self.patch('src.ai.locations.current', return_value=self.search)
        refresh = self.patch('src.ai.locations.refresh', return_value=1)
        self.call('refresh-locations', {'queued': 1}, ascii=True)
        active.assert_called_once_with(self.db, {})
        refresh.assert_called_once_with(self.db, self.search, {1, 2})
        ids.assert_not_called()
        stages.side_effect = None
        self.call('refresh-locations', {'queued': 1}, '--url', URL, ascii=True)
        active.assert_called_with(self.db, stages.return_value)
        ids.assert_called_once_with(self.db, URL)
        refresh.assert_called_with(self.db, self.search, {2})
        self.assertEqual(current.call_count, 2)
        tune = self.patch('src.tune.run', return_value=VALUE)
        self.call('tune', VALUE)
        tune.assert_called_once_with(self.db, self.tracker, self.search, stages=stages.return_value)
        self.stores.name = 'notion'
        self.run_stores.return_value = self.stores, None
        self.call('tune', {'ok': False, 'error': 'Connect Notion first: your outcomes (dismissed, applied, interviews) live there.'}, ascii=True)

    # Pin job-list source selection, kit inputs and stale-cache warnings.
    def test_jobs_sources_kits_errors_and_options(self):
        ready = self.patch('src.ai.engine.ready', return_value=True)
        listed = self.patch('src.desktop.jobs', side_effect=lambda *a, **k: dict(VALUE))
        self.call('jobs', VALUE, outside=True)
        listed.assert_called_once_with(self.db, 200, notion_jobs=[], kit_inputs=None, hide_unscored=True)
        self.call('jobs', VALUE, '--limit', '7', '--first-run', outside=True)
        listed.assert_called_with(self.db, 7, notion_jobs=[], kit_inputs=None, hide_unscored=False)
        ready.return_value = False
        self.tracker.notion_jobs.side_effect = OSError('offline')
        self.call('jobs', {**VALUE, 'stale': True}, outside=True, err='Warning: Notion unavailable, showing the cached list: OSError: offline\n')
        listed.assert_called_with(self.db, 200, notion_jobs=None, kit_inputs=None, hide_unscored=False)
        self.from_env.return_value = None
        self.call('jobs', VALUE, outside=True)
        rows = [{'stage': 'Kit ready', 'next_step': 'é'}]
        self.patch('src.desktop._kit', return_value=True)
        self.tracker.notion_jobs.side_effect = None
        self.tracker.notion_jobs.return_value = rows
        self.from_env.return_value = self.tracker
        answers = self.patch('src.ai.kit.standard_answers', return_value='answers')
        inputs = self.patch('src.desktop.provenance.kit_inputs', return_value='inputs')
        self.stores.texts.plain.return_value = 'profile'
        self.call('jobs', VALUE, outside=True)
        answers.assert_called_once_with(self.stores)
        inputs.assert_called_once_with('profile', 'answers')
        listed.assert_called_with(self.db, 200, notion_jobs=rows, kit_inputs='inputs', hide_unscored=False)
        self.open_stores.assert_called_with(tracker=self.tracker)
        inputs.side_effect = OSError()
        self.call('jobs', VALUE, outside=True)
        listed.assert_called_with(self.db, 200, notion_jobs=rows, kit_inputs=None, hide_unscored=False)
        os.environ['JOB_PILOTTO_STORE'] = 'sqlite'
        local = self.patch('src.desktop_store_jobs.store_jobs', return_value=rows)
        inputs.side_effect = None
        self.call('jobs', VALUE, outside=True)
        local.assert_called_once_with(self.stores)
        self.open_stores.assert_called_with()

    # Pin the command inventory and argparse's rejection status and offending argument.
    def test_parser_failures_and_command_inventory(self):
        usage = f'usage: desktop-test [-h]\n                    {{{",".join(COMMANDS)}}}\n                    ...\n'
        for argv, message in [([], 'the following arguments are required: command'),
                              (['unknown'], "argument command: invalid choice: 'unknown'")]:
            out, err = io.StringIO(), io.StringIO()
            with mock.patch('sys.argv', ['desktop-test']), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                with self.assertRaises(SystemExit) as raised:
                    desktop.main(argv)
            self.assertEqual(raised.exception.code, 2)
            self.assertEqual(out.getvalue(), '')
            self.assertTrue(err.getvalue().startswith(usage), err.getvalue())
            self.assertIn('desktop-test: error:', err.getvalue())
            self.assertIn(message, err.getvalue())
        self.connect.assert_not_called()


if __name__ == '__main__':
    unittest.main()
