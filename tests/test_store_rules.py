"""The stage rules above the store interface (src/stores/rules.py), on every local store: the same rule everywhere."""
import os
import tempfile
import unittest
from unittest import mock

from src.stores import base, memory, rules, sqlite

JOB = {'url': 'https://jobs.example.com/sre-1', 'title': 'Senior SRE', 'company': 'Acme'}


class RulesCase:
    def make(self):
        raise NotImplementedError

    def setUp(self):
        self.s = self.make()

    def test_an_event_is_not_written_twice(self):
        app = self.s.applications.create({**JOB, 'applied_on': '2026-09-20'}, 'Applied')
        applied, existing = rules.add_event(self.s, app, 'Applied', 'Gmail')
        self.assertEqual((applied['at'], existing), ('2026-09-20', False))
        mail, _ = rules.add_event(self.s, app, 'Rejected', 'Gmail', at='2026-10-01T09:00:00+00:00', source_id='m1')
        self.assertEqual(rules.add_event(self.s, app, 'Rejected', 'Gmail', at='2026-10-03T09:00:00+00:00', source_id='m1'),
                         (mail, True), 'the same message, even days later')
        self.assertTrue(rules.add_event(self.s, app, 'Rejected', 'Telegram', at='2026-10-01T18:00:00+00:00')[1],
                        'the same outcome logged again the same day')
        self.assertFalse(rules.add_event(self.s, app, 'Rejected', 'Telegram', at='2026-10-05T09:00:00+00:00')[1],
                         'a later occurrence is a new event')

    def test_an_interview_is_known_by_its_time_and_an_impossible_one_is_not_kept(self):
        app = self.s.applications.create(JOB, 'Interview scheduled')
        first, _ = rules.add_event(self.s, app, 'Interview scheduled', 'Gmail', at='2026-10-01T09:00:00+00:00',
                                   interview_at='2026-10-08T10:00:00+00:00')
        self.assertEqual(first['changes'], {'fields': {}})
        self.assertTrue(rules.add_event(self.s, app, 'Interview scheduled', 'Calendar', at='2026-10-06T09:00:00+00:00',
                                        interview_at='2026-10-08T12:00:00+02:00')[1], 'the same interview, days later')
        self.assertFalse(rules.add_event(self.s, app, 'Interview scheduled', 'Gmail', at='2026-10-06T09:00:00+00:00',
                                         interview_at='2026-10-15T10:00:00+00:00')[1], 'another interview')
        with mock.patch('sys.stderr'):
            odd, _ = rules.add_event(self.s, app, 'Screening', 'Gmail', at='2026-10-06T09:00:00+00:00',
                                     interview_at='2024-09-26T10:00:00+00:00')
        self.assertEqual(odd['interview_at'], '', 'a misread year is never stored')

    def test_a_soft_stage_never_overwrites_a_real_one(self):
        row, outcome = rules.mark(self.s, JOB, 'Saved')
        self.assertEqual((outcome, row['stage']), (base.CREATED, 'Saved'))
        self.assertEqual(rules.mark(self.s, JOB, 'Applied', today='2026-10-09')[1], rules.UPDATED)
        for soft in ('Saved', 'Dismissed', 'Kit ready'):
            self.assertEqual(rules.mark(self.s, JOB, soft)[1], base.UNCHANGED, soft)
        self.assertEqual(self.s.applications.get(JOB['url'])['applied_on'], '2026-10-09')

    def test_a_closed_application_can_be_reopened_to_applied(self):
        for closed in ('Rejected', 'Withdrawn', 'No response'):   # the app's Reopen action (desktop/renderer/outcome-tap.js)
            self.s.applications.set_stage(JOB, closed, '2026-10-09')
            row, outcome = rules.mark(self.s, JOB, 'Applied')
            self.assertEqual((outcome, row['stage']), (rules.UPDATED, 'Applied'), closed)

    def test_kit_ready_lands_only_on_a_new_row_and_a_star_can_still_be_dismissed(self):
        rules.mark(self.s, JOB, 'Saved')
        self.assertEqual(rules.mark(self.s, JOB, 'Kit ready')[1], base.UNCHANGED)
        self.assertEqual(rules.mark(self.s, JOB, 'Dismissed')[1], rules.UPDATED)

    def test_a_new_row_says_where_it_came_from(self):
        with mock.patch.dict(os.environ, {'JOBADABRA_SOURCE': 'Desktop App'}):
            row, _ = rules.mark(self.s, JOB, 'Kit ready')
        self.assertEqual((row['source'], row['origin'], row['company']), ('Desktop App', 'Outbound', 'Acme'))
        greenhouse, _ = rules.mark(self.s, {'url': 'https://boards.greenhouse.io/acme/jobs/1', 'title': 'SRE', 'posted': '2026-10-01'}, 'Saved')
        self.assertEqual((greenhouse['ats'], greenhouse['posted']), ('Greenhouse', '2026-10-01'))

    def test_a_scored_job_keeps_only_the_numeric_fit_on_an_application(self):
        cases = (({'score': 74, 'tier': 'B', 'components': {'role_fit': 80}}, 74),
                 ({'score': 0}, 0), (77, 77), ({}, None), (None, None))
        for index, (fit, expected) in enumerate(cases):
            with self.subTest(fit=fit):
                job = {**JOB, 'url': JOB['url'] + str(index), 'fit': fit}
                row, _ = rules.mark(self.s, job, 'Kit ready')
                self.assertEqual(None if row.get('fit') == '' else row.get('fit'), expected)
                self.assertEqual(job['fit'], fit, 'the kit still reads the full score report')

    def test_applying_goes_back_to_kit_ready_only_from_applying(self):
        self.assertEqual(rules.revert_applying(self.s, JOB['url']), base.UNCHANGED)
        rules.mark(self.s, JOB, 'Applying')
        self.assertEqual(rules.revert_applying(self.s, JOB['url']), rules.UPDATED)
        self.assertEqual(self.s.applications.get(JOB['url'])['stage'], 'Kit ready')

    def test_a_wrong_applied_goes_back_but_the_employers_stages_stay(self):
        rules.mark(self.s, JOB, 'Applied', today='2026-10-09')
        outcome, row = rules.revert_unsubmitted(self.s, JOB['url'])
        self.assertEqual((outcome, row['stage'], row['applied_on']), (rules.UPDATED, 'Applying', ''))
        self.s.applications.set_stage(JOB, 'Interviewing')
        self.assertEqual(rules.revert_unsubmitted(self.s, JOB['url'])[0], rules.PAST)
        self.assertEqual(rules.revert_unsubmitted(self.s, 'https://jobs.example.com/none'), (base.UNCHANGED, None))


class MemoryRulesTests(RulesCase, unittest.TestCase):
    def make(self):
        return memory.open_store()


class SqliteRulesTests(RulesCase, unittest.TestCase):
    def make(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        return sqlite.open_store({'JOBADABRA_DATA_DIR': folder.name})


if __name__ == '__main__':
    unittest.main()
