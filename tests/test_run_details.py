"""What a run saves about how it ran (src/run_details.py): steps with seconds from the ⏳ lines, boards, refused reads, employers, the funnel,
AI stages and problems, fixed keys only; saved on the run record by every store adapter and read back."""
import json
import unittest

from src import run_details
from src.stores import base, memory, sqlite


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


class Details(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        run_details._clock['now'] = self.clock
        run_details.reset()
        self.addCleanup(lambda: run_details._clock.update(now=__import__('time').monotonic))

    def test_steps_have_start_and_seconds(self):
        run_details.line('⏳ Reading employer pages: 1 of 8')
        self.clock.t += 40
        run_details.line('⏳ Reading employer pages: 5 of 8')   # same step again: still one step
        self.clock.t += 20
        run_details.line('⏳ Reading new jobs with AI: 2 of 9')
        self.clock.t += 5
        steps = run_details.build({'mode': 'run'})['steps']
        self.assertEqual(steps, [{'label': 'Reading employer pages', 'at_s': 0, 'secs': 60}, {'label': 'Reading new jobs with AI', 'at_s': 60, 'secs': 5}])

    def test_boards_refused_reads_and_employers_come_from_the_output_lines(self):
        for text in ('Job boards found: TechTree 112 job(s), 41 relevant', 'Job boards found: Acme Jobs read after its scripts ran',
                     'Refused sites: a.example asked us to slow down; asked again in 1 day(s)',
                     'Refused sites: b.example shows a captcha; waiting for you to open it and solve it',
                     'Refused sites: c.example stopped (HTTP 403); not asked again for 30 days',
                     'Checked: Grafana Labs', 'Checked: DeepL', 'Visit: Moldova Tech (x.md) refused us (a bot check): offered as a site only you can open'):
            run_details.line(text)
        details = run_details.build({'mode': 'run', 'feeds': 8, 'feed_errors': 1}, employers={'pending': 371, 'batch': 61, 'read': None})
        self.assertEqual(details['boards']['list'], [{'name': 'TechTree', 'jobs': 112, 'relevant': 41}])
        self.assertEqual({k: details['boards'][k] for k in ('refused_reads', 'refused_slow_down', 'refused_captcha', 'refused_stopped', 'headless_reads', 'left_to_open')},
                         {'refused_reads': 3, 'refused_slow_down': 1, 'refused_captcha': 1, 'refused_stopped': 1, 'headless_reads': 1, 'left_to_open': 1})
        self.assertEqual(details['employers'], {'pending': 371, 'batch': 61, 'employers_checked': 2, 'feeds': 8, 'feed_errors': 1})

    def test_jobs_funnel_ai_scoring_and_problems(self):
        funnel = {'fetched': 3412, 'in_places': 388, 'matched': 41, 'title_hits': 50, 'elsewhere': 2,
                  'excluded': [{'fragment': 'senior', 'count': 14, 'examples': ['Senior SRE']}]}
        run = {'mode': 'run', 'new': 0, 'changed': 1, 'closed_stale': 2, 'warnings': ['Employer index not downloaded'],
               'score': {'done': 4, 'failed': 1, 'pending': 5, 'usd': 0.02, 'model': 'm', 'cli_calls': 3}, 'waiting': 2, 'note': 'not kept'}
        details = run_details.build(run, funnel)
        self.assertEqual(details['jobs'], {'fetched': 3412, 'in_places': 388, 'matched': 41, 'title_hits': 50, 'elsewhere': 2,
                                           'dropped': [{'filter': 'senior', 'count': 14}], 'added': 0, 'changed': 1, 'expired': 2})
        self.assertEqual(details['ai']['score'], {'model': 'm', 'done': 4, 'failed': 1, 'pending': 5, 'cli_calls': 3, 'usd': 0.02})
        self.assertEqual(details['scoring'], {'waiting': 2, 'done': 4, 'failed': 1, 'pending': 5})
        self.assertEqual(details['problems'], ['Employer index not downloaded'])
        self.assertNotIn('Senior SRE', json.dumps(details))   # no posting titles

    def test_a_run_that_measured_nothing_has_only_its_version_and_steps(self):
        self.assertEqual(run_details.build({'mode': 'mail'}), {'v': 1, 'steps': []})


class Saved(unittest.TestCase):
    def check(self, stores):
        row = stores.cron_runs.begin('run', 'mac')
        self.assertIn('details', base.CRON_RUN_FIELDS)
        stores.cron_runs.finish(row['id'], 'OK', details={'v': 1, 'steps': [], 'jobs': {'fetched': 5}})
        self.assertEqual(stores.cron_runs.get(row['id'])['details'], {'v': 1, 'steps': [], 'jobs': {'fetched': 5}})
        self.assertEqual(stores.cron_runs.list()[0]['details']['jobs'], {'fetched': 5})

    def test_memory(self):
        self.check(memory.open_store())

    def test_sqlite(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            self.check(sqlite.open_store({'JOB_PILOTTO_DATA_DIR': folder}))


if __name__ == '__main__':
    unittest.main()
