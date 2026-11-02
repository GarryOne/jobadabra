"""Always on and the free trial (src/trial.py): after the wall a run starts no new work and says so; Pro continues; tracking modes go on; the AI goes through the install's lane."""
import io
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import daily, trial  # noqa: E402
from src.ai.providers import anthropic_api  # noqa: E402

ENV = {'JOBADABRA_TRIAL_KEY': 'JPF1.install-0001.tok', 'JOBADABRA_FIRST_RUN': '2026-08-01T00:00:00Z'}


def site(body, asked=None):
    def urlopen(request, timeout=0):
        if asked is not None:
            asked.append((request.full_url, dict(request.header_items())))
        if isinstance(body, Exception):
            raise body
        return io.BytesIO(json.dumps(body).encode())
    return urlopen


class TrialTests(unittest.TestCase):
    def test_applications_counted_from_applied_on(self):
        stages = {'a': 'Applied', 'b': 'Screening', 'c': 'Rejected', 'd': 'Saved', 'e': 'Kit ready', 'f': 'Dismissed'}
        self.assertEqual(trial.applied_count(stages), 3)

    def test_asks_the_website_with_the_install_key_and_the_count(self):
        asked = []
        trial.status(20, urlopen=site({'ok': True, 'ended': True}, asked), env=ENV)
        url, headers = asked[0]
        self.assertIn('/api/trial/status?applied=20&first=2026-08-01T00%3A00%3A00Z', url)
        self.assertEqual(headers['X-api-key'], ENV['JOBADABRA_TRIAL_KEY'])

    def test_new_work_modes_pause_after_the_wall_and_tracking_modes_do_not(self):
        over = site({'ok': True, 'ended': True, 'pro': False})
        for mode in ('scheduled', 'run', 'today', 'kits', 'prepare'):
            self.assertTrue(trial.paused(mode, {}, urlopen=over, env=ENV), mode)
        for mode in ('apply', 'add', 'more', 'interview', 'insight', 'weekly', 'import'):
            self.assertIsNone(trial.paused(mode, {}, urlopen=over, env=ENV), mode)

    def test_pro_inside_the_trial_no_key_or_a_site_outage_never_pause(self):
        self.assertIsNone(trial.paused('scheduled', {}, urlopen=site({'ok': True, 'ended': False, 'pro': True}), env=ENV))
        self.assertIsNone(trial.paused('scheduled', {}, urlopen=site({'ok': True, 'ended': True}), env={}))           # no install key: not asked
        self.assertIsNone(trial.paused('scheduled', {}, urlopen=site(OSError('down')), env=ENV))                      # site down: runs on
        self.assertIsNone(trial.paused('scheduled', {}, urlopen=site({'ok': False, 'error': 'unauthorized'}), env=ENV))

    def test_the_license_key_is_sent_so_a_founder_key_lifts_the_wall(self):
        asked = []
        trial.status(0, urlopen=site({'ok': True}, asked), env={**ENV, 'JOBADABRA_LICENSE_KEY': 'JP1.a.b'})
        self.assertEqual(asked[0][1]['X-jp-license'], 'JP1.a.b')


class DailyRunTests(unittest.TestCase):
    def run_main(self, argv, answer):
        with mock.patch.dict(os.environ, ENV), mock.patch.object(sys, 'argv', ['daily', *argv]), \
                mock.patch.object(daily, 'open_run', return_value=object()), \
                mock.patch('src.daily_helpers.url_stages', return_value={}), \
                mock.patch.object(trial, 'status', return_value=answer), \
                mock.patch.object(daily, 'search') as search, mock.patch.object(daily, 'kits_mode') as kits, \
                mock.patch.object(daily, 'apply_mode') as apply, mock.patch.object(daily.run_log, 'auto_begin'), \
                mock.patch.object(daily, 'apply_switches'), mock.patch('src.telegram.send') as send, \
                mock.patch('src.telegram.credentials', return_value=('t', 'c')), mock.patch('builtins.print') as shown:
            daily.main()
        return search, kits, apply, send, shown

    def test_after_the_wall_a_scheduled_run_searches_nothing_and_sends_the_line(self):
        search, kits, _apply, send, _ = self.run_main(['--mode', 'scheduled', '--send'], {'ok': True, 'ended': True, 'notify': True})
        search.assert_not_called()
        send.assert_called_once_with(trial.OVER_LINE, 't', 'c')
        _s, _k, _a, send, _ = self.run_main(['--mode', 'scheduled', '--send'], {'ok': True, 'ended': True, 'notify': False})
        send.assert_not_called()   # the website already had it today
        self.assertIn('Get Pro to continue', trial.OVER_LINE)

    def test_after_the_wall_kits_pause_but_marking_applied_goes_on(self):
        _s, kits, apply, send, _ = self.run_main(['--mode', 'kits'], {'ok': True, 'ended': True})
        kits.assert_not_called()
        send.assert_not_called()   # no --send: only the run's log says it
        _s, _k, apply, _send, _ = self.run_main(['--mode', 'apply', '--job', 'x'], {'ok': True, 'ended': True})
        apply.assert_called_once()

    def test_a_pro_install_continues(self):
        search, *_ = self.run_main(['--mode', 'scheduled'], {'ok': True, 'ended': False, 'pro': True})
        search.assert_called_once()


import importlib.util  # noqa: E402


@unittest.skipUnless(importlib.util.find_spec('anthropic'), 'the anthropic SDK is not installed here')
class AiLaneTests(unittest.TestCase):
    def test_the_sdk_follows_the_repo_variable_to_free_ai_and_stays_default_without_it(self):
        with mock.patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'JPF1.i.t', 'JOBADABRA_AI_BASE_URL': 'https://www.jobadabra.top/api/ai'}):
            self.assertEqual(str(anthropic_api.sdk('score').base_url).rstrip('/'), 'https://www.jobadabra.top/api/ai')
        env = {k: v for k, v in os.environ.items() if k not in ('JOBADABRA_AI_BASE_URL', 'ANTHROPIC_BASE_URL')}
        with mock.patch.dict(os.environ, {**env, 'ANTHROPIC_API_KEY': 'k'}, clear=True):
            self.assertIn('api.anthropic.com', str(anthropic_api.sdk('score').base_url))


if __name__ == '__main__':
    unittest.main()
