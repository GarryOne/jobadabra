"""E-mail as a channel for every Telegram message (src/notify.py, src/telegram.py): the chosen channels, one e-mail per run, urgent at once, the same card in both, and no second way to message."""
import io
import json
import os
import re
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import notify, telegram  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
EMAIL = {'JOB_PILOTTO_NOTIFY': 'email', 'JOB_PILOTTO_TRIAL_KEY': 'JPF1.install-0001.tok', 'JOB_PILOTTO_SITE_URL': 'https://site.test'}
CARD = '📬 <b>3 new matches</b>\nFrom your search\n\n<b>Top</b>\n<a href="https://x.example/1">Data Engineer</a>'


class Site:
    """A stand-in for POST /api/notify/email; records what the run sent."""

    def __init__(self, answer=None):
        self.sent, self.answer = [], answer or {'ok': True}

    def __call__(self, request, timeout=0):
        if isinstance(self.answer, Exception):
            raise self.answer
        self.sent.append({'url': request.full_url, 'key': request.get_header('X-api-key'), 'body': json.loads(request.data)})
        return io.BytesIO(json.dumps(self.answer).encode())


def run_with(env, site, work):
    for held in notify._QUEUE.values():
        held.clear()
    with mock.patch.dict(os.environ, env, clear=True), mock.patch('src.notify.urllib.request.urlopen', site), mock.patch('src.notify.atexit.register'):
        return work()


class ChannelTests(unittest.TestCase):
    def test_unset_means_telegram_only_and_the_site_is_never_called(self):
        site = Site()
        self.assertIsNone(notify.channels({}))
        self.assertTrue(notify.wants_telegram({}) and not notify.wants_email({}))

        def work():
            with mock.patch('src.telegram.urllib.request.urlopen', lambda request, timeout=0: io.BytesIO(b'{"ok": true}')):
                telegram.send(CARD, 'tok', '1')
            return notify.flush()
        run_with({'TELEGRAM_BOT_TOKEN': 't', 'TELEGRAM_CHAT_ID': '1'}, site, work)
        self.assertEqual(site.sent, [])

    def test_email_only_needs_no_telegram_credentials(self):
        self.assertEqual(run_with({**EMAIL}, Site(), telegram.credentials), (None, None))
        both_without_bot = {**EMAIL, 'JOB_PILOTTO_NOTIFY': 'email,telegram'}
        self.assertEqual(run_with(both_without_bot, Site(), telegram.credentials), (None, None))
        with_bot = {**both_without_bot, 'TELEGRAM_BOT_TOKEN': 't', 'TELEGRAM_CHAT_ID': '1'}
        self.assertEqual(run_with(with_bot, Site(), telegram.credentials), ('t', '1'))

    def test_email_only_hides_a_configured_bot(self):
        self.assertEqual(run_with({**EMAIL, 'TELEGRAM_BOT_TOKEN': 't', 'TELEGRAM_CHAT_ID': '1'}, Site(), telegram.credentials), (None, None))

    def test_telegram_chosen_without_a_bot_still_stops_with_the_old_message(self):
        with self.assertRaises(SystemExit):
            run_with({'JOB_PILOTTO_NOTIFY': 'telegram'}, Site(), telegram.credentials)


class DeliveryTests(unittest.TestCase):
    def test_new_matches_are_one_email_per_run_and_the_rest_goes_to_the_digest(self):
        site = Site()

        def work():
            telegram.send(CARD, None, None, kind='matches')
            telegram.send(CARD, None, None, kind='matches')
            telegram.send('🔔 <b>Budget</b>\n80% used', None, None)
            telegram.send('📮 <b>Rejection</b>\nAcme', None, None)
            self.assertEqual(site.sent, [])   # held until the run ends
            return notify.flush()
        self.assertTrue(run_with(EMAIL, site, work))
        self.assertEqual(len(site.sent), 2)
        matches, activity = site.sent
        self.assertEqual(matches['url'], 'https://site.test/api/notify/email')
        self.assertEqual(matches['key'], EMAIL['JOB_PILOTTO_TRIAL_KEY'])
        self.assertEqual(matches['body']['subject'], '3 new matches and 1 more')
        self.assertIn('Data Engineer', matches['body']['html'])
        self.assertNotIn('kind', matches['body'], 'new matches go at once')
        self.assertEqual(activity['body']['kind'], 'activity', 'everything else waits for the digest')
        self.assertEqual(activity['body']['subject'], 'Budget and 1 more')

    def test_flushing_the_matches_leaves_the_activity_for_the_end_of_the_run(self):
        site = Site()

        def work():
            telegram.send(CARD, None, None, kind='matches')
            telegram.send('📮 <b>Rejection</b>', None, None)
            return notify.flush('matches')
        self.assertTrue(run_with(EMAIL, site, work))
        self.assertEqual(len(site.sent), 1)
        self.assertIn('Data Engineer', site.sent[0]['body']['html'])

    def test_urgent_goes_at_once_alone(self):
        site = Site()
        run_with(EMAIL, site, lambda: (telegram.send('<b>Interview reviewed</b>', None, None, urgent=True), telegram.send(CARD, None, None)))
        self.assertEqual([m['body']['subject'] for m in site.sent], ['Interview reviewed'])

    def test_link_buttons_become_links_and_callback_buttons_are_dropped(self):
        site = Site()
        markup = {'inline_keyboard': [[{'text': '➕ Next', 'callback_data': 'more'}, {'text': '🔗 Open', 'url': 'https://x.example/app'}]]}
        run_with(EMAIL, site, lambda: (telegram.send(CARD, None, None, markup), notify.flush()))
        self.assertEqual(site.sent[0]['body']['buttons'], [{'text': '🔗 Open', 'url': 'https://x.example/app'}])

    def test_both_channels_send_to_telegram_and_queue_the_email(self):
        site, posted = Site(), []
        env = {**EMAIL, 'JOB_PILOTTO_NOTIFY': 'email,telegram'}

        def work():
            with mock.patch('src.telegram.urllib.request.urlopen', lambda request, timeout=0: (posted.append(request.full_url), io.BytesIO(b'{"ok": true}'))[1]):
                telegram.send(CARD, 'tok', '1')
            return notify.flush()
        run_with(env, site, work)
        self.assertEqual(len(posted), 1)
        self.assertIn('/bottok/sendMessage', posted[0])
        self.assertEqual(len(site.sent), 1)

    def test_nothing_held_sends_nothing(self):
        site = Site()
        self.assertTrue(run_with(EMAIL, site, notify.flush))
        self.assertEqual(site.sent, [])

    def test_a_refused_or_unreachable_site_says_so_and_does_not_crash(self):
        for answer in ({'ok': False, 'reason': 'unconfirmed'}, OSError('offline')):
            site = Site(answer)
            out = io.StringIO()
            with mock.patch('sys.stderr', out):
                ok = run_with(EMAIL, site, lambda: (telegram.send(CARD, None, None), notify.flush())[1])
            self.assertFalse(ok)
            self.assertIn('Warning: the e-mail was not sent', out.getvalue())

    def test_no_install_key_means_no_email_and_no_crash(self):
        out = io.StringIO()
        with mock.patch('sys.stderr', out):
            ok = run_with({'JOB_PILOTTO_NOTIFY': 'email', 'JOB_PILOTTO_SITE_URL': 'https://site.test'}, Site(), lambda: (telegram.send(CARD, None, None), notify.flush())[1])
        self.assertFalse(ok)

    def test_the_end_to_end_journey_never_reaches_the_real_site(self):
        site = Site()
        run_with({'JOB_PILOTTO_NOTIFY': 'email', 'JOB_PILOTTO_TRIAL_KEY': 'JPF1.a.b', 'JOB_PILOTTO_E2E': '1'}, site, lambda: (telegram.send(CARD, None, None), notify.flush()))
        self.assertEqual(site.sent, [])

    def test_the_free_ai_key_identifies_the_run_when_there_is_no_trial_key(self):
        site = Site()
        run_with({'JOB_PILOTTO_NOTIFY': 'email', 'ANTHROPIC_API_KEY': 'JPF1.i.t', 'JOB_PILOTTO_SITE_URL': 'https://site.test'}, site, lambda: (telegram.send(CARD, None, None), notify.flush()))
        self.assertEqual(site.sent[0]['key'], 'JPF1.i.t')


class OneMechanismTests(unittest.TestCase):
    """The class: every message the engine sends to a person goes through telegram.send, so each has its e-mail form."""

    def test_only_telegram_py_talks_to_the_bot_api(self):
        talkers = [str(p.relative_to(ROOT)) for p in (ROOT / 'src').rglob('*.py') if 'api.telegram.org' in p.read_text(encoding='utf-8')]
        self.assertEqual(talkers, ['src/telegram.py'])

    def test_every_send_call_passes_through_telegram_send_or_to_app(self):
        for path in (ROOT / 'src').rglob('*.py'):
            text = path.read_text(encoding='utf-8')
            for match in re.finditer(r'\burlopen\(.*sendMessage', text):
                self.fail(f'{path} posts sendMessage itself: use telegram.send')


if __name__ == '__main__':
    unittest.main()
