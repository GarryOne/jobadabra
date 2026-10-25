from types import SimpleNamespace
import io
import json
import unittest
import urllib.error

from src import daily
from src.ai import cost
from src.notion import cron_runs
from src.notion.client import Tracker
from tests import zone


setUpModule, tearDownModule = zone.pinned()   # run rows show the local time; the expected times here are Zurich's


def sample_run(**extra):
    run = {'mode': 'scheduled', 'started_at': '2026-09-26T08:00:05+00:00', 'trigger': 'Schedule',
           'warnings': [], 'feeds': 40, 'feed_errors': 1, 'failing_feeds': ['Acme'], 'new': 3, 'changed': 1,
           'closed_stale': 2, 'seconds': 95, 'run_url': 'https://github.com/o/r/actions/runs/1',
           'enrich': {'model': 'claude-haiku-4-5', 'pending': 4, 'done': 4, 'failed': 0,
                      'tokens_in': 8000, 'tokens_out': 1200, 'cache_read': 0, 'usd': 0.014},
           'score': {'model': 'claude-sonnet-5-5', 'pending': 3, 'done': 2, 'failed': 1,
                     'tokens_in': 6000, 'tokens_out': 900, 'cache_read': 3000, 'usd': 0.02},
           'top_new': [('Staff SRE', 'Grafana Labs', 88), ('Platform Engineer', 'DeepL', 74)],
           'telegram': 'sent 2 message(s), 3 new'}
    run.update(extra)
    return run


class CostTest(unittest.TestCase):
    def test_usd_counts_cache_reads_and_writes(self):
        usage = SimpleNamespace(input_tokens=1000, output_tokens=100, cache_read_input_tokens=2000,
                                cache_creation_input_tokens=400)
        expected = (1000 * 2 + 400 * 2 * 1.25 + 2000 * 0.20 + 100 * 10) / 1e6
        self.assertAlmostEqual(cost.usd('claude-sonnet-5-5', usage), expected)
        self.assertEqual(cost.usd('unknown-model', usage), 0)

    def test_add_is_a_no_op_without_stats(self):
        cost.add(None, 'claude-haiku-4-5', SimpleNamespace(input_tokens=1, output_tokens=1))


class ReportTest(unittest.TestCase):
    def test_a_one_off_job_never_gets_a_crawls_summary(self):
        self.assertEqual(cron_runs.report_lines({'mode': 'add', 'warnings': []})[0], 'Logged activity done (AI cost $0.000)')
        self.assertTrue(cron_runs.report_lines({'mode': 'weekly', 'headline': '9 applications sent', 'warnings': []})[0]
                        .startswith('9 applications sent'))
        self.assertTrue(cron_runs.report_lines({'mode': 'scheduled', 'warnings': []})[0].startswith('Quiet run'))

    def test_report_headline_and_highlights(self):
        lines = cron_runs.report_lines(sample_run())
        self.assertEqual(lines[0], '3 new and 1 changed job(s) from 40 feed(s); AI cost $0.034.')
        self.assertIn('Top new match: Staff SRE at Grafana Labs (score 88).', lines)
        self.assertIn('Scored: 1 of 3 call(s) failed.', lines)
        self.assertIn('1 feed(s) failed: Acme.', lines)

    def test_failed_feeds_beyond_six_names_say_how_many_more(self):
        run = sample_run()
        run['feed_errors'] = 8
        run['failing_feeds'] = [f'Clinic {n}' for n in range(1, 9)]
        lines = cron_runs.report_lines(run)
        self.assertIn('8 feed(s) failed: Clinic 1, Clinic 2, Clinic 3, Clinic 4, Clinic 5, Clinic 6 and 2 more.', lines)

    def test_quiet_run(self):
        run = {'mode': 'scheduled', 'started_at': '2026-09-26T08:00:05+00:00', 'warnings': [], 'feeds': 40}
        self.assertTrue(cron_runs.report_lines(run)[0].startswith('Quiet run'))
        self.assertEqual(cron_runs.status(run), 'Quiet')

    def test_page_properties(self):
        props, children = cron_runs.run_page(sample_run())
        self.assertEqual(props['Run']['title'][0]['text']['content'], '2026-09-26 10:00 · Refresh jobs · 3 new jobs')  # local time, as Started shows it
        self.assertEqual(props['Status']['select']['name'], 'Warnings')  # one feed failed
        self.assertEqual(props['AI cost (USD)']['number'], 0.034)
        self.assertNotIn('Cost kits (USD)', props)  # retired: each step's cost is on the page
        self.assertEqual(props['Scored']['number'], 2)
        self.assertEqual(props['Top new score']['number'], 88)
        self.assertEqual(props['Tokens (total)']['number'], 8000 + 1200 + 6000 + 900 + 3000)
        self.assertEqual(children[0]['type'], 'heading_3')

    def test_a_one_off_run_fills_only_what_applies_to_it(self):
        run = {'mode': 'prep', 'started_at': '2026-09-29T14:02:00+00:00', 'trigger': 'Mac (you)', 'warnings': [], 'seconds': 73,
               'subject': 'Huxley — Principal SRE', 'application': 'app-page-1', 'headline': 'Huxley · Principal SRE: Prep kit ready',
               'interview': {'model': 'claude-sonnet-5-5', 'usd': 0.0475, 'tokens_in': 10486, 'tokens_out': 3148}}
        props, children = cron_runs.run_page(run)
        self.assertEqual(props['Run']['title'][0]['text']['content'], '2026-09-29 16:02 · Interview prep · Huxley — Principal SRE')
        for name in ('Feeds', 'New jobs', 'Closed stale', 'Emails', 'Updates', 'Kits', 'Scored'):
            self.assertIsNone(props[name]['number'], name)  # another kind's column: empty, not 0
        self.assertEqual(props['Application'], {'relation': [{'id': 'app-page-1'}]})
        self.assertEqual(props['AI cost (USD)']['number'], 0.0475)
        stages = [c['bulleted_list_item']['rich_text'][0]['text']['content'] for c in children if c['type'] == 'bulleted_list_item']
        self.assertTrue(any('$0.0475' in line for line in stages), stages)  # the step's cost, on the page
        self.assertFalse(any('0 of 0' in line for line in stages), stages)

    def test_a_logged_activity_run_links_the_job_it_created(self):
        from unittest import mock
        run = {'mode': 'add', 'started_at': '2026-09-30T09:00:00+00:00', 'trigger': 'Mac (you)', 'warnings': [], 'seconds': 20,
               'headline': '🤝 Tracked recruiter lead: Web3 DevOps — Acme (Screening)'}
        row = {'id': '3e5-app-1', 'url': '', 'properties': {'Job': {'title': [{'plain_text': 'Web3 DevOps'}]},
                                                            'Job URL': {'url': 'https://lead.test/1'}}}
        with mock.patch('builtins.print') as printed:
            job = cron_runs.log_job(run, row, True)
        self.assertEqual(job, {'page_id': '3e5-app-1', 'url': 'https://www.notion.so/3e5app1', 'title': 'Web3 DevOps',
                               'job_url': 'https://lead.test/1', 'created': True})
        self.assertTrue(printed.call_args.args[0].startswith('Job logged: {'))
        self.assertEqual(cron_runs.run_page(run)[0]['Application'], {'relation': [{'id': '3e5-app-1'}]})

    def test_runs_about_many_jobs_link_to_none(self):
        for mode in ('scheduled', 'run', 'mail', 'scout', 'insight', 'weekly'):
            run = dict(cron_runs.new_run(mode), seconds=5)
            self.assertNotIn('Application', cron_runs.run_page(run)[0], mode)

    def test_a_gmail_check_fills_its_own_columns(self):
        props, _ = cron_runs.run_page({'mode': 'mail', 'started_at': '2026-09-29T12:19:00+00:00', 'warnings': [],
                                       'mail': {'done': 4, 'usd': 0.0039}, 'updates': ['Reply received · Acme']})
        self.assertEqual((props['Emails']['number'], props['Updates']['number']), (4, 1))
        self.assertIsNone(props['Feeds']['number'])
        self.assertNotIn('Application', props)

    def test_a_missing_column_named_only_in_the_notion_body_is_dropped(self):
        # The real client raises HTTPError whose text is "Bad Request" until it copies Notion's message in.
        # This is the path a GitHub run hit on 1 Oct 2026: the row never opened, so the app showed no run.
        sent = []

        class Answer(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        def opener(request, timeout):
            payload = json.loads(request.data.decode())
            if 'Run id' in payload.get('properties', {}):
                body = json.dumps({'message': 'Run id is not a property that exists.'}).encode()
                raise urllib.error.HTTPError(request.full_url, 400, 'Bad Request', {}, io.BytesIO(body))
            sent.append(payload)
            return Answer(json.dumps({'url': 'https://notion.so/row', 'id': 'row'}).encode())

        url = cron_runs.log_run(Tracker('t', 'db', opener=opener, sleep=lambda _s: None),
                                {'mode': 'mail', 'started_at': '2026-10-01T13:47:00+00:00', 'warnings': [],
                                 'run_id': '36871274548', 'mail': {'done': 4}, 'updates': ['a', 'b']})
        self.assertEqual(url, 'https://notion.so/row')
        self.assertNotIn('Run id', sent[0]['properties'])
        self.assertEqual(sent[0]['properties']['Emails'], {'number': 4})

    def test_a_column_the_workspace_lacks_yet_is_dropped_not_the_row(self):
        sent = []
        class Tracker:
            def _request(self, method, path, body):
                if 'Updates' in body['properties']:
                    raise RuntimeError('Notion 400: validation_error: Updates is not a property that exists.')
                sent.append(body)
                return {'url': 'https://notion.so/row'}
        url = cron_runs.log_run(Tracker(), {'mode': 'mail', 'started_at': '2026-09-29T16:00:00+00:00', 'warnings': [],
                                            'mail': {'done': 2}, 'updates': []})
        self.assertEqual(url, 'https://notion.so/row')
        self.assertEqual(sent[0]['properties']['Emails'], {'number': 2})  # the rest of the row is written

    def test_log_run_never_raises(self):
        class Broken:
            def _request(self, *args):
                raise RuntimeError('Notion down')
        self.assertIsNone(cron_runs.log_run(Broken(), sample_run()))

    def test_log_run_posts_to_the_cron_database(self):
        calls = []
        class Tracker:
            def _request(self, method, path, body):
                calls.append(body)
                return {'url': 'https://notion.so/row'}
        self.assertEqual(cron_runs.log_run(Tracker(), sample_run()), 'https://notion.so/row')
        self.assertEqual(calls[0]['parent']['database_id'], cron_runs.CRON_RUNS_DATABASE_ID)


    def test_a_row_archived_while_the_run_ran_is_replaced_not_lost(self):
        # 5 Oct 2026 (activityfailures e2e): the row begin() opened was archived mid-run; log_run only tried to edit it, Notion answered
        # "Can't edit block that is archived", and the run never got a finished row, so the app waited for it until its 300 s timeout.
        run = sample_run()
        calls = []
        class Tracker:
            def _request(self, method, path, body):
                calls.append((method, path))
                if method == 'PATCH':
                    raise RuntimeError("HTTP Error 400: Can't edit block that is archived. You must unarchive the block before editing.")
                return {'url': 'https://notion.so/new-row'}
        cron_runs._open.update(id='old-row', url='https://notion.so/old-row', run=run)
        try:
            self.assertEqual(cron_runs.log_run(Tracker(), run), 'https://notion.so/new-row')
        finally:
            cron_runs._open.clear()
        self.assertEqual(calls[0], ('PATCH', 'pages/old-row'))
        self.assertEqual(calls[-1], ('POST', 'pages'))


def row(job, company='', via=''):
    rich = lambda value: {'rich_text': [{'plain_text': value}]}
    return {'id': 'app-1', 'properties': {'Job': {'title': [{'plain_text': job}]}, 'Company': rich(company), 'Via': rich(via)}}


class RunTitleTest(unittest.TestCase):
    """"date · Kind · subject": each row says what ran and what it was about, so the list is read without opening it."""
    AT = '2026-09-30T09:44:00+00:00'  # 11:44 in Zurich

    def title(self, mode, final=True, **extra):
        return cron_runs.title(dict({'mode': mode, 'started_at': self.AT, 'warnings': []}, **extra), final)

    def test_each_kind_names_what_it_was_about(self):
        cases = [
            (('scheduled',), {'new': 12, 'feeds': 40}, 'Refresh jobs · 12 new jobs'),
            (('run',), {'new': 1}, 'Refresh jobs · 1 new job'),
            (('today',), {'new': 0}, 'Refresh jobs · nothing new'),
            (('mail',), {'mail': {'done': 5}, 'updates': ['a']}, 'Gmail check · 1 update'),
            (('mail',), {'mail': {'done': 5}, 'updates': ['a', 'b', 'c']}, 'Gmail check · 3 updates'),
            (('mail',), {'mail': {'done': 5}, 'updates': []}, 'Gmail check · 5 emails checked'),
            (('mail',), {'mail': {'done': 0}, 'updates': []}, 'Gmail check · no updates'),
            (('scout',), {'subject': cron_runs.counted(4, 'new feed')}, 'Find new employers · 4 new feeds'),
            (('scout',), {'subject': cron_runs.counted(0, 'new feed')}, 'Find new employers · nothing new'),
            (('add',), {'subject': cron_runs.job_subject(row('SRE', 'Duvo.ai'))}, 'Log activity · Duvo.ai — SRE'),
            (('interview',), {'subject': 'Huxley · Recruiter screen'}, 'Interview review · Huxley · Recruiter screen'),
            (('prepare',), {'subject': 'Acme — Platform Engineer'}, 'Application kit · Acme — Platform Engineer'),
            (('prep',), {'subject': 'Acme — Staff SRE'}, 'Interview prep · Acme — Staff SRE'),
            (('rejection',), {'subject': 'Acme — Staff SRE'}, 'Rejection review · Acme — Staff SRE'),
            (('insight',), {'subject': 'Interview patterns'}, 'Insight · Interview patterns'),
            (('weekly',), {'headline': '9 applications sent'}, 'Search analysis'),
        ]
        for (mode,), extra, expected in cases:
            self.assertEqual(self.title(mode, **extra), f'2026-09-30 11:44 · {expected}', (mode, extra))

    def test_no_subject_leaves_date_and_kind(self):
        for mode in ('add', 'interview', 'prepare', 'insight', 'scheduled', 'mail', 'scout'):
            self.assertEqual(self.title(mode).count(' · '), 1, mode)  # no crawl/mail numbers yet: none invented

    def test_a_job_subject_never_names_the_employer_twice(self):
        self.assertEqual(cron_runs.job_subject(row('Principal SRE · via Huxley', via='Huxley')), 'via Huxley — Principal SRE')
        self.assertEqual(cron_runs.job_subject(row('Principal SRE · Acme', 'Acme', 'Huxley')), 'Acme — Principal SRE')
        self.assertEqual(cron_runs.job_subject(row('SRE', 'unknown')), 'SRE')
        self.assertEqual(cron_runs.job_subject(company='Acme', role='SRE · Acme'), 'Acme — SRE')

    def test_a_long_subject_is_shortened(self):
        long = 'Acme — ' + 'Senior Principal Site Reliability Engineer, Platform Infrastructure'
        text = self.title('prepare', subject=long).split(' · ', 2)[2]
        self.assertLessEqual(len(text), cron_runs.SUBJECT_MAX)
        self.assertTrue(text.endswith('…') and text.startswith('Acme — Senior'))

    def test_opened_and_failed_rows_keep_the_simple_title(self):
        self.assertEqual(self.title('prep', final=False, subject='Acme — SRE'), '2026-09-30 11:44 · Interview prep')
        sent = []
        class Tracker:
            def _request(self, method, path, body):
                sent.append(body)
                return {'id': 'row-1', 'url': 'https://notion.so/row'}
        run = {'mode': 'prep', 'started_at': self.AT, 'warnings': [], 'subject': 'Acme — SRE'}
        cron_runs.log_run(Tracker(), run, failed=True)
        self.assertEqual(sent[0]['properties']['Run']['title'][0]['text']['content'], '2026-09-30 11:44 · Interview prep')
        self.assertEqual(sent[0]['properties']['Status']['select']['name'], 'Failed')

    def test_a_failed_one_off_run_says_failed_not_done(self):
        # 2 Oct 2026 (the activity e2e suite): an insight that crashed before its result had a Failed row whose Summary read "Insight done (AI cost $0.000)".
        sent = []
        class Tracker:
            def _request(self, method, path, body):
                sent.append(body)
                return {'id': 'row-1', 'url': 'https://notion.so/row'}
        for mode, name in (('insight', 'Insight'), ('weekly', 'Search analysis'), ('interview', 'Interview review')):
            sent.clear()
            run = {'mode': mode, 'started_at': self.AT, 'warnings': ['ended before its report (see the technical log)']}
            cron_runs.log_run(Tracker(), run, failed=True)
            summary = sent[0]['properties']['Summary']['rich_text'][0]['text']['content']
            self.assertTrue(summary.startswith(f'{name} failed'), summary)
            self.assertNotIn('done', summary)
        self.assertEqual(cron_runs.report_lines({'mode': 'insight', 'warnings': []})[0], 'Insight done (AI cost $0.000)')  # a run that finished is unchanged

    def test_the_end_of_run_write_sets_the_title_once(self):
        from unittest import mock
        titles = []
        class Tracker:
            def _request(self, method, path, body):
                if 'Run' in (body.get('properties') or {}):
                    titles.append(body['properties']['Run']['title'][0]['text']['content'])
                return {'id': 'row-1', 'url': 'https://notion.so/row'}
        run = {'mode': 'add', 'started_at': self.AT, 'warnings': []}
        with mock.patch.object(cron_runs, 'CRON_RUNS_DATABASE_ID', 'db'), mock.patch.dict(cron_runs._open, clear=True), \
                mock.patch.object(cron_runs, 'capture'), mock.patch('builtins.print'):
            cron_runs.begin(Tracker(), run)
            cron_runs.log_job(run, row('SRE', 'Duvo.ai'), True)
            cron_runs.log_run(Tracker(), run)
        self.assertEqual(titles, ['2026-09-30 11:44 · Log activity', '2026-09-30 11:44 · Log activity · Duvo.ai — SRE'])
        self.assertEqual(cron_runs.title(run), titles[-1])  # the same run always gives the same title

    def test_an_insights_category_comes_from_its_summary(self):
        from src.ai import insights
        self.assertEqual(insights.category_of('Insight sent: Market — Fewer SRE roles (0.010 USD)'), 'Market')
        self.assertEqual(insights.category_of('Insight: nothing new today (0.010 USD)'), '')


class DailyHelpersTest(unittest.TestCase):
    def test_crawl_counts(self):
        report = {'sources': [{'company': 'A', 'ok': True}, {'company': 'B', 'ok': False}]}
        counts = daily.crawl_counts(report, ['new', 'seen', 'changed', 'new'])
        self.assertEqual((counts['feeds'], counts['feed_errors'], counts['new'], counts['changed']), (2, 1, 2, 1))
        self.assertEqual(counts['failing_feeds'], ['B'])

    def test_top_new_only_counts_jobs_first_seen_this_run(self):
        report = {'jobs': [{'url': 'u1', 'status': 'new'}, {'url': 'u2', 'status': 'seen'}]}
        scored = [{'url': 'u1', 'title': 'SRE', 'company': 'A', 'fit': {'score': 70}},
                  {'url': 'u2', 'title': 'Old', 'company': 'B', 'fit': {'score': 95}}]
        self.assertEqual(daily.top_new(report, scored), [('SRE', 'A', 70)])

    def test_trigger_from_github_event(self):
        import os
        from unittest import mock
        with mock.patch.dict(os.environ, {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_RUN_ID': '7',
                                          'GITHUB_REPOSITORY': 'o/r'}):
            run = daily.new_cron_run('run')
        self.assertEqual(run['trigger'], 'Manual')
        self.assertEqual(run['run_url'], 'https://github.com/o/r/actions/runs/7')


if __name__ == '__main__':
    unittest.main()


class PlainResultTest(unittest.TestCase):
    def test_a_link_keeps_its_address_so_the_app_can_open_the_job(self):
        from src.notion import cron_runs
        html = '1. <a href="https://jobs.ch/1?a=1&amp;b=2">DevOps Engineer</a> · 🎯 <b>80</b>'
        self.assertEqual(cron_runs.plain(html), '1. DevOps Engineer (https://jobs.ch/1?a=1&b=2) · 🎯 80')

    def test_an_empty_brand_variable_falls_back_to_the_name(self):
        import importlib, os
        from unittest import mock
        with mock.patch.dict(os.environ, {'DIGEST_BRAND_NAME': ''}):
            from src import digest
            self.assertEqual(importlib.reload(digest).BRAND_NAME, 'Jobadabra')
        importlib.reload(digest)


class EmailSectionTest(unittest.TestCase):
    """A Gmail check's run page names every email it read, its subject linking to it, and what it did about it —
    the evidence behind "N update(s) recorded", which used to be a bare number (1 Oct 2026)."""

    def sample(self):
        return {'mode': 'mail', 'started_at': '2026-10-01T01:18:00+00:00', 'trigger': 'Mac (you)', 'warnings': [],
                'mail': {'done': 2, 'usd': 0.0}, 'updates': ['📬 Application received · Canonical — Site Reliability Engineer'],
                'emails': [
                    {'subject': 'Thank you for applying to Canonical', 'from': 'no-reply@us.greenhouse-mail.io',
                     'at': '2026-10-01T02:56:00+02:00', 'action': 'recorded', 'label': 'Canonical — Site Reliability Engineer',
                     'changes': 'Stage Applied → Confirmation received; Confirmation email set',
                     'link': 'https://mail.google.com/mail/u/0/#all/1a0f4f6224933d5c'},
                    {'subject': 'A newsletter', 'from': 'news@example.test', 'at': '2026-10-01T02:40:00+02:00',
                     'action': 'skipped', 'label': 'not about your applications', 'changes': '', 'link': 'https://mail.google.com/mail/u/0/#all/m2'}]}

    def test_each_email_is_a_line_linking_to_it(self):
        props, children = cron_runs.run_page(self.sample())
        self.assertEqual(props['Updates']['number'], 1)
        self.assertEqual(props['Emails']['number'], 2)
        self.assertIn('Emails read', [block['heading_3']['rich_text'][0]['text']['content']
                                      for block in children if block['type'] == 'heading_3'])
        line = next(block for block in children if block['type'] == 'bulleted_list_item'
                    and block['bulleted_list_item']['rich_text'][0]['text'].get('link'))
        rich = line['bulleted_list_item']['rich_text'][0]
        self.assertEqual(rich['text']['content'], 'Thank you for applying to Canonical · us.greenhouse-mail.io · '
                                                  '01 Oct 02:56 — [recorded] · Canonical — Site Reliability Engineer · '
                                                  'changed Stage Applied → Confirmation received; Confirmation email set')
        self.assertEqual(rich['text']['link']['url'], 'https://mail.google.com/mail/u/0/#all/1a0f4f6224933d5c')
        self.assertFalse(any('A newsletter' in block['bulleted_list_item']['rich_text'][0]['text']['content']
                             for block in children if block['type'] == 'bulleted_list_item'),
                         'an email that is not about the applications is not listed (2 Oct 2026)')

    def test_a_check_without_details_still_logs_its_summary(self):
        run = {'mode': 'mail', 'started_at': '2026-10-01T01:18:00+00:00', 'warnings': [], 'mail': {'done': 1}, 'updates': []}
        props, children = cron_runs.run_page(run)
        self.assertNotIn('Emails read', [block.get('heading_3', {}).get('rich_text', [{}])[0].get('text', {}).get('content')
                                         for block in children])


class StageLineTest(unittest.TestCase):
    """The "Stages" line names what the step did, not the column it filled: a Gmail check reads emails."""

    def test_a_mail_check_says_it_read_emails(self):
        run = {'mode': 'mail', 'started_at': '2026-10-01T01:18:00+00:00', 'warnings': [], 'updates': [],
               'mail': {'done': 2, 'model': 'claude-haiku-4-5', 'tokens_in': 10, 'tokens_out': 2,
                        'cache_read': 0, 'usd': 0.001, 'cli_calls': 1}}
        _props, children = cron_runs.run_page(run)
        line = next(b['bulleted_list_item']['rich_text'][0]['text']['content'] for b in children
                    if b['type'] == 'bulleted_list_item' and 'claude-haiku-4-5' in str(b))
        self.assertTrue(line.startswith('Read job emails with claude-haiku-4-5;'), line)

    def test_a_queued_step_keeps_its_own_label(self):
        run = {'mode': 'scheduled', 'started_at': '2026-10-01T01:18:00+00:00', 'warnings': [],
               'enrich': {'pending': 4, 'done': 4, 'model': 'claude-haiku-4-5', 'tokens_in': 1, 'tokens_out': 1,
                          'cache_read': 0, 'usd': 0.0}}
        _props, children = cron_runs.run_page(run)
        self.assertTrue(any('Enriched with claude-haiku-4-5: 4 of 4;' in str(b) for b in children))

    def test_a_negative_note_is_not_prefixed_with_changed(self):
        run = {'mode': 'mail', 'started_at': '2026-10-01T01:18:00+00:00', 'warnings': [], 'updates': [],
               'mail': {'done': 1},
               'emails': [{'subject': 'Security code for your application to Canonical', 'from': 'Greenhouse <no-reply@us.greenhouse-mail.io>',
                           'at': '2026-10-01T03:44:00+02:00', 'action': 'reviewed', 'label': 'Canonical',
                           'changes': 'nothing to record', 'link': 'https://mail.google.com/mail/u/0/#all/x'}]}
        _props, children = cron_runs.run_page(run)
        line = next(b['bulleted_list_item']['rich_text'][0]['text']['content'] for b in children
                    if 'Security code' in str(b))
        self.assertTrue(line.endswith('[read] · Canonical · nothing to record'), line)


class NotionLimitTest(unittest.TestCase):
    """Notion refuses a text of more than 2000 UTF-16 units, and an emoji is two: a scout log of 25 lines full of 🔎 went over by 2 and the whole run row was lost (2 Oct 2026)."""

    def units(self, text):
        return len(text.encode('utf-16-le')) // 2

    def test_clip_counts_the_way_notion_does(self):
        self.assertEqual(cron_runs.clip('a' * 3000), 'a' * 2000)
        clipped = cron_runs.clip('🔎' * 1500)
        self.assertLessEqual(self.units(clipped), 2000)
        self.assertEqual(clipped, '🔎' * 1000)
        self.assertEqual(cron_runs.clip('short 🔎'), 'short 🔎')

    def test_a_long_message_keeps_its_last_lines(self):
        # #309: a 10-job digest is 49 lines; the first 40 only lost "Your pipeline" (its counts) and the card showed "– open".
        lines = [f'{n}. Job {n}' for n in range(1, 48)] + ['Your pipeline', '10 open · 9 pinned · 5 applied']
        blocks = cron_runs.extra_blocks(['\n'.join(lines)], [])
        paras = [b for b in blocks if b['type'] == 'paragraph']
        self.assertEqual(len(paras), cron_runs.RESULT_PARAS)
        read = '\n'.join(''.join(t['text']['content'] for t in b['paragraph']['rich_text']) for b in paras)
        self.assertEqual(read, '\n'.join(lines))
        short = cron_runs.extra_blocks(['one\ntwo'], [])
        self.assertEqual([b['paragraph']['rich_text'][0]['text']['content'] for b in short[1:]], ['one', 'two'])
        huge = cron_runs.extra_blocks(['\n'.join(['🔎' * 900] * 80)], [])
        for t in huge[-1]['paragraph']['rich_text']:
            self.assertLessEqual(self.units(t['text']['content']), 2000)

    def test_a_technical_log_with_emoji_fits_notion(self):
        lines = ['🔎 Source scout · checked 7 · 🆕 0 new sources ' + 'x' * 40] * 25 + ['🆕' * 50] * 25
        blocks = cron_runs.extra_blocks(['done'], lines)
        toggle = next(block for block in blocks if block['type'] == 'toggle')
        for child in toggle['toggle']['children']:
            self.assertLessEqual(self.units(child['code']['rich_text'][0]['text']['content']), 2000)
        self.assertLessEqual(self.units(cron_runs._text('🔎' * 1500)['rich_text'][0]['text']['content']), 2000)
        self.assertLessEqual(self.units(cron_runs._para('🔎' * 1500)['paragraph']['rich_text'][0]['text']['content']), 2000)
