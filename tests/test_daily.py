import tempfile
from datetime import datetime, timezone
import unittest
from pathlib import Path
import re
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import daily, daily_modes, digest
from src import store as job_store


class DigestFormatTests(unittest.TestCase):
    def test_digest_is_escaped_telegram_html(self):
        report = {'jobs': [{'company': 'A&B <Labs>', 'id': '1', 'title': 'SRE <Platform> & Ops',
                            'location': 'Zurich', 'work_mode': 'Hybrid (stated)',
                            'url': 'https://example.test/jobs?id=1&x="y"'}]}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, report)
                message = digest.format_digest(db)
        self.assertIn('1 new', message)
        self.assertIn('Tap a job number', message)
        self.assertIn('>SRE &lt;Platform&gt; &amp; Ops</a></b>', message)
        self.assertIn('href="https://example.test/jobs?id=1&amp;x=&quot;y&quot;"', message)
        self.assertIn('A&amp;B &lt;Labs&gt; · Zurich', message)
        self.assertNotIn('<blockquote>', message)
        self.assertIn('Hybrid', message)
        self.assertNotIn('<Labs>', message)

    def test_each_group_heading_appears_once_with_its_jobs_listed_under_it(self):
        # 5 Oct 2026: "In your preferred locations" and "Outside..." were printed again every time the ranking switched between them.
        jobs = [{'id': str(i), 'title': f'Site Reliability Engineer {i}', 'company': f'Acme {i}', 'location': place, 'url': f'https://example.test/{i}'}
                for i, place in enumerate(['Zurich', 'London, UK', 'Zurich', 'Berlin', 'Zurich', 'Toronto'], 1)]
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, {'jobs': jobs})
                message = digest.format_digest(db)
        for heading in ('In your preferred locations', 'Outside your preferred locations'):
            self.assertLessEqual(message.count(heading), 1, heading)
        self.assertIn('📍 <b>In your preferred locations</b>', message)
        self.assertIn('🌍 <b>Outside your preferred locations</b>', message)
        # the numbers run 1..n in the order shown, and each job sits under the heading that names its place
        numbers = [int(n) for n in re.findall(r'(?m)^(\d+)\. ', message)]
        self.assertEqual(numbers, list(range(1, len(numbers) + 1)))
        inside = message.split('In your preferred locations')[1].split('Outside your preferred locations')[0] if 'Outside your preferred locations' in message else message
        for city in ('Zurich',):
            self.assertIn(city, inside)

    def test_ranking_prefers_zurich_then_switzerland_then_berlin_london_dubai_remote(self):
        jobs = [{'title': 'Accountant', 'location': 'Toronto'},
                {'title': 'Site Reliability Engineer', 'location': 'London, UK'},
                {'title': 'Site Reliability Engineer', 'location': 'Geneva'},
                {'title': 'Site Reliability Engineer', 'location': 'Zürich', 'city': 'Zurich'},
                {'title': 'Site Reliability Engineer', 'location': 'Toronto'}]
        ranked = digest.rank_jobs(jobs, digest.random.Random(1))
        self.assertEqual([j['location'] for j in ranked], ['Zürich', 'Geneva', 'London, UK', 'Toronto', 'Toronto'])
        self.assertEqual(ranked[-1]['title'], 'Accountant')

    def test_pages_of_ten_continue_with_the_same_seed(self):
        report = {'jobs': [{'company': f'Company {i}', 'id': str(i), 'title': 'Site Reliability Engineer',
                            'location': 'Zurich', 'url': f'https://example.test/{i}'} for i in range(25)]}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, report)
                pages = [digest.build_digest(db, page=p, seed=7) for p in (1, 2, 3, 4)]
        urls = []
        for messages, _, keyboards in pages[:3]:
            self.assertEqual(len(messages), 1)
            self.assertLessEqual(digest.visible_length(messages[0]), digest.TELEGRAM_LIMIT)
            urls += [u for u in digest.re.findall(r'href="([^"]+)"', messages[0])]
        self.assertEqual(len(urls), 25)
        self.assertEqual(len(set(urls)), 25)  # no job repeated across pages
        next_buttons = [row[0]['callback_data'] for _, _, kb in pages[:3] for row in kb[0]['inline_keyboard']
                        if row[0]['callback_data'].startswith('more:')]
        self.assertEqual(next_buttons, ['more:7:2', 'more:7:3'])
        self.assertIn('Jobs 11–20 of 25', pages[1][0][0])
        self.assertIn('No more jobs', pages[3][0][0])

    def test_consecutive_digests_rotate_older_jobs(self):
        report = {'jobs': [{'company': f'Company {i}', 'id': str(i), 'title': 'Site Reliability Engineer',
                            'location': 'Zurich', 'url': f'https://example.test/{i}'} for i in range(25)]}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, report)
                db.execute("UPDATE jobs SET last_seen_at = '2099-01-01T00:00:00+00:00'")  # none are new any more
                db.execute("UPDATE jobs SET first_seen_at = '1999-01-01T00:00:00+00:00'"); digest.mark_shown(db, [row[0] for row in db.execute('SELECT id FROM jobs')], seed=0, now=datetime(2000, 1, 1, tzinfo=timezone.utc))  # sent long ago: older jobs
                first_ids, second_ids, page2_ids = [], [], []
                digest.build_digest(db, seed=1, shown_ids=first_ids)
                digest.mark_shown(db, first_ids, seed=1)
                # Page 2 of the same digest ignores its own marks and continues the list.
                digest.build_digest(db, seed=1, page=2, shown_ids=page2_ids)
                digest.build_digest(db, seed=2, shown_ids=second_ids)
        self.assertEqual(len(first_ids), 10)
        self.assertFalse(set(first_ids) & set(second_ids))
        self.assertFalse(set(first_ids) & set(page2_ids))

    def test_company_and_title_are_shortened(self):
        self.assertEqual(digest.short_company('Zürich Versicherungs-Gesellschaft AG / Zurich Insurance Company Ltd'),
                         'Zürich Versicherungs-Gesellschaft')
        self.assertEqual(digest.short_company('Consult & Pepper AG'), 'Consult & Pepper')
        self.assertEqual(digest.short_title('Senior Platform Engineer - Identity & Security (m/f/d) 80-100%'),
                         'Senior Platform Engineer - Identity & Security 80-100%')
        self.assertEqual(digest.short_title('Site Reliability Engineer (a)'), 'Site Reliability Engineer')
        self.assertEqual(digest.short_title('Software Development Engineer (all genders)'), 'Software Development Engineer')

    def test_unknown_work_mode_is_omitted(self):
        self.assertIsNone(digest._work_mode_badge('Not stated'))
        self.assertEqual(digest._work_mode_badge('Remote mentioned; verify conditions'), '🌍 Remote?')


class DigestNoteTests(unittest.TestCase):
    def test_the_app_is_not_told_to_use_a_terminal(self):
        # 2 Oct 2026 (activity e2e suite): "Send today's matches" without Telegram showed "(terminal: set TELEGRAM_BOT_TOKEN…" in the app's Recent activity.
        app = daily.digest_note(3, 1, terminal=False)
        self.assertEqual(app, "Digest ready: 3 jobs, 1 new. Telegram isn't connected, so nothing was sent.")
        self.assertNotIn('terminal', app)
        self.assertIn('--send', daily.digest_note(3, 1, terminal=True))


class InsightLimitTests(unittest.TestCase):
    def test_an_insight_paused_by_the_spend_limit_is_a_run_with_a_warning_not_a_failure(self):
        # 2 Oct 2026 (activity e2e suite): the run exited 0 without closing its row; the end-of-process guard then wrote it as Failed ("Insight failed") under a
        # Completed pill. It is closed here, as a warning that names the limit.
        import contextlib
        import io
        from unittest import mock
        logged = []
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(daily.notion.Tracker, 'from_env', return_value=object()), \
                mock.patch.object(daily.insights, 'run', side_effect=RuntimeError('Your credit balance is too low to access the Anthropic API.')), \
                mock.patch.dict(daily.run_log._auto, {}), mock.patch.dict(daily.run_log._open, {}), \
                mock.patch.object(daily.run_log, 'log_run', side_effect=lambda stores, run, failed=False: logged.append((dict(run), failed)) or 'https://notion.so/row'), \
                mock.patch.object(daily.telegram, 'to_app'), mock.patch.object(sys, 'argv', ['daily', '--mode', 'insight', '--log-run', '--db', str(Path(tmp) / 'jobs.sqlite')]), \
                contextlib.redirect_stdout(out):
            code = daily.main()
        self.assertEqual(code, 0)
        self.assertEqual(len(logged), 1, out.getvalue())
        run, failed = logged[0]
        self.assertFalse(failed)
        self.assertTrue(any('AI limit reached' in warning for warning in run['warnings']), run['warnings'])
        self.assertTrue(any(line.startswith('AI limit reached') for line in out.getvalue().splitlines()))


class PrepareTopMatchesTests(unittest.TestCase):
    def test_kits_mode_drafts_for_the_best_matches_without_a_kit_and_logs_a_run(self):
        # The Actions page's "Prepare top matches": no crawl, the stored scores; a job already at Kit ready is left out.
        import contextlib
        import io
        from unittest import mock
        tracker = mock.Mock()
        tracker.url_stages.return_value = {'https://a/1': 'Kit ready', 'https://a/9': 'Applied'}
        matches = [{'id': 1, 'url': 'https://a/1', 'title': 'SRE', 'company': 'A', 'fit': {'score': 90}},
                   {'id': 2, 'url': 'https://a/2', 'title': 'Platform', 'company': 'B', 'fit': {'score': 80}}]
        seen, logged, shown = [], [], []
        def auto_run(db, candidates, stores, model, max_jobs, min_score, stats=None):
            seen.append(([c['id'] for c in candidates], max_jobs))
            return 'Auto-drafted 1 of 1 kit(s); 0 failed', [(candidates[0], {'url': 'https://notion.so/p'})]
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(daily.notion.Tracker, 'from_env', return_value=tracker), \
                mock.patch.object(daily_modes, 'for_job_matches', return_value=matches) as found, \
                mock.patch.object(daily.kit, 'auto_run', side_effect=auto_run), \
                mock.patch.object(daily_modes, 'url_stages', lambda stores: tracker.url_stages()), \
                mock.patch.dict(daily.run_log._auto, {}), mock.patch.dict(daily.run_log._open, {}), \
                mock.patch.object(daily.run_log, 'log_run', side_effect=lambda stores, run, failed=False: logged.append(dict(run)) or ''), \
                mock.patch.object(daily.feeds, 'scan', side_effect=AssertionError('no crawl')), \
                mock.patch.object(daily.telegram, 'to_app', side_effect=shown.append), \
                mock.patch.object(sys, 'argv', ['daily', '--mode', 'kits', '--log-run', '--db', str(Path(tmp) / 'jobs.sqlite')]), \
                contextlib.redirect_stdout(out):
            code = daily.main()
        self.assertEqual(code, 0, out.getvalue())
        self.assertEqual(seen, [([2], daily.KITS_DEFAULT)])
        self.assertIn('https://a/9', found.call_args[0][1])          # an applied job is not a match to prepare
        self.assertEqual(logged[0]['headline'], 'Kits ready: 1')
        self.assertIn('Kits ready: 1', out.getvalue().splitlines())   # the Actions page's result line (pipeline.js TASKS.kits)
        self.assertIn('Platform', shown[0])


if __name__ == '__main__':
    unittest.main()
