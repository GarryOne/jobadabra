"""The store contract's runs: form fills and Apply sessions (agent_runs), every run's row (cron_runs) and a record's link or ref.
Split out of tests/store_contract.py as a pure move (file size); StoreContract inherits it, so every adapter runs it.
Not a test file itself (no test_ prefix)."""
from src.stores import base

JOB = {'url': 'https://jobs.example.com/sre-1', 'title': 'Senior SRE', 'company': 'Acme', 'location': 'Zurich'}   # as store_contract.JOB


class RunsContract:
    def test_an_agent_run_is_added_updated_and_listed_newest_first(self):
        first = self.s.agent_runs.add({'url': JOB['url'], 'ats': 'workday', 'outcome': 'filled'})
        self.assertRecord(first, base.AGENT_RUN_FIELDS)
        self.s.agent_runs.add({'url': JOB['url'], 'ats': 'greenhouse', 'outcome': 'partial'})
        self.s.agent_runs.update(first['id'], {'transcript': 'talk'})
        self.assertEqual([r['ats'] for r in self.s.agent_runs.list()], ['greenhouse', 'workday'])
        self.assertEqual(self.s.agent_runs.list(ats='workday')[0]['transcript'], 'talk')

    def test_an_agent_run_list_can_leave_the_conversation_out_and_get_brings_it_back(self):
        run = self.s.agent_runs.add({'url': JOB['url'], 'ats': 'Claude', 'learnings': 'kept', 'transcript': 'talk'})
        light = self.s.agent_runs.list(transcript=False)
        self.assertEqual([(r['id'], r['learnings'], r['transcript']) for r in light], [(run['id'], 'kept', '')])
        self.assertEqual(self.s.agent_runs.get(run['id'])['transcript'], 'talk')

    def test_an_agent_runs_fields_are_known_columns_and_it_is_found_by_id(self):
        run = self.s.agent_runs.add({'url': JOB['url'], 'ats': 'Claude', 'fields': {'turns': 12, 'model': 'opus'}})
        self.s.agent_runs.update(run['id'], {'outcome': 'submitted', 'fields': {'turns': 14, 'times_asked': 2}})
        got = self.s.agent_runs.get(run['id'])
        self.assertEqual((got['outcome'], got['fields']['turns']), ('submitted', 14))
        self.assertIsNone(self.s.agent_runs.get('missing'))
        with self.assertRaises(KeyError):
            self.s.agent_runs.add({'url': JOB['url'], 'fields': {'not a column': 1}})
        with self.assertRaises(KeyError):
            self.s.agent_runs.update(run['id'], {'fields': {'not a column': 1}})

    def test_an_extension_run_is_corrected_in_place_and_never_added_twice(self):
        # extension/ladder/record-update.js: a box the page emptied after the fill's record was sent and typed again corrects THAT row (agent_runs.update with the whole `fields`
        # column: the row's own job and start are kept by the caller), in every adapter.
        record = {'job': 'SRE', 'agent': 'Extension', 'status': 'Needs input', 'started': '2026-10-13T00:00:00.000Z', 'field_count': 3, 'unfilled_required': 2}
        run = self.s.agent_runs.add({'url': JOB['url'], 'ats': 'greenhouse', 'outcome': 'Needs input', 'fields': record})
        self.s.agent_runs.add({'url': JOB['url'], 'ats': 'workday', 'outcome': 'Ready'})
        self.s.agent_runs.update(run['id'], {'outcome': 'Ready', 'learnings': '', 'fields': {**record, 'status': 'Ready', 'field_count': 5, 'unfilled_required': 0}})
        rows = self.s.agent_runs.list(ats='greenhouse')
        self.assertEqual(len(rows), 1, 'one row, corrected: never a second one')
        got = self.s.agent_runs.get(run['id'])
        self.assertEqual((got['outcome'], got['fields']['status'], got['fields']['field_count'], got['fields']['unfilled_required']), ('Ready', 'Ready', 5, 0))
        self.assertEqual((got['fields']['job'], got['fields']['started']), ('SRE', '2026-10-13T00:00:00.000Z'))
        self.assertEqual(len(self.s.agent_runs.list()), 2)

    def test_a_cron_run_begins_reports_progress_and_finishes(self):
        run = self.s.cron_runs.begin('search', 'mac')
        self.assertRecord(run, base.CRON_RUN_FIELDS)
        self.assertEqual(run['status'], 'Running')
        self.s.cron_runs.progress(run['id'], 'Reading 12 feeds')
        done = self.s.cron_runs.finish(run['id'], 'Done', summary='3 new jobs', report='- a', result='msg')
        self.assertEqual((done['status'], done['summary'], done['progress']), ('Done', '3 new jobs', ['Reading 12 feeds']))
        self.assertTrue(done['finished_at'])
        self.assertEqual([r['id'] for r in self.s.cron_runs.list(kind='search')], [run['id']])
        self.assertEqual(self.s.cron_runs.list(kind='mail'), [])

    def test_a_run_keeps_its_trigger_and_numbers_and_refuses_an_unknown_number(self):
        run = self.s.cron_runs.begin('search', 'mac', {'trigger': 'button', 'mode': 'check'})
        self.assertEqual((run['trigger'], run['mode'], run['stats']), ('button', 'check', {}))
        done = self.s.cron_runs.finish(run['id'], 'Done', summary='3 new jobs', stats={'new_jobs': 3, 'ai_cost_usd': 0.12})
        self.assertEqual(done['stats'], {'new_jobs': 3, 'ai_cost_usd': 0.12})
        self.assertEqual(self.s.cron_runs.get(run['id'])['stats']['new_jobs'], 3)
        other = self.s.cron_runs.begin('mail', 'github')
        with self.assertRaises(KeyError):
            self.s.cron_runs.finish(other['id'], 'Done', stats={'not a stat': 1})

    def test_a_run_keeps_the_engines_title_and_log_id_and_a_heartbeat_touches_only_its_numbers(self):
        run = self.s.cron_runs.begin('insight', 'mac', {'title': '2026-10-09 09:00 · Insight', 'log_id': 'r-42'})
        self.assertEqual((run['title'], run['log_id']), ('2026-10-09 09:00 · Insight', 'r-42'))
        self.s.cron_runs.touch(run['id'], {'duration_s': 300})
        self.s.cron_runs.touch(run['id'], {'duration_s': 600})
        busy = self.s.cron_runs.get(run['id'])
        self.assertEqual((busy['status'], busy['stats'].get('duration_s'), busy['title']), ('Running', 600, '2026-10-09 09:00 · Insight'))
        with self.assertRaises(KeyError):
            self.s.cron_runs.touch(run['id'], {'not a stat': 1})
        done = self.s.cron_runs.finish(run['id'], 'Done', summary='Skills', title='2026-10-09 09:00 · Insight · Skills')
        self.assertEqual(self.s.cron_runs.get(run['id'])['title'], '2026-10-09 09:00 · Insight · Skills')
        self.assertEqual(done['stats'].get('duration_s'), 600)

    def test_a_record_is_named_by_its_link_or_a_store_ref(self):
        run = self.s.cron_runs.begin('search', 'mac')
        named = self.s.link_or_ref('cron_runs', run['id'])
        if base.LINKS in self.s.caps:
            self.assertTrue(named.startswith('http'))
        else:
            self.assertEqual(base.parse_ref(named), ('cron_runs', run['id']))
        self.assertIsNone(base.parse_ref('https://www.notion.so/abc'))
