"""A Google part the user left unticked never kills a check: the other part keeps its results, the gap is named, and an unknown grant learns from the first 403
(src/sources/google.py learn_missing, src/ai/mail.py run, src/daily_search.py)."""
import io
import json
import unittest
import urllib.error
from unittest import mock

from src.ai import mail
from src.sources import google, google_scopes as scopes

URLS = {'gmail': 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
        'calendar': 'https://www.googleapis.com/calendar/v3/calendars/primary/events'}


def refusing(part):
    """A token from before the granted parts were kept (scopes unknown): Google answers 403 for `part` only."""
    def opener(request, timeout=None):
        if scopes.part_of_refusal(request.full_url, 403, 'insufficient scope') != part:
            return io.BytesIO(json.dumps({'emailAddress': 'a@b.c', 'id': 'a@b.c'}).encode())
        raise urllib.error.HTTPError(request.full_url, 403, 'Forbidden', {}, io.BytesIO(b'{"error": {"message": "insufficient authentication scopes"}}'))
    client = google.Google('id', 'secret', 'refresh', opener=opener)
    client._token = 'access'
    return client


def run_check(client, **passes):
    """mail.run with fake passes; returns (result, printed text, stats)."""
    stats = {}
    with mock.patch.object(mail, 'open_stores'), mock.patch.object(mail, 'load_state', return_value={'notified': []}), \
            mock.patch.object(mail, 'applications', return_value=[]), mock.patch.object(mail, '_events_index', return_value={}), \
            mock.patch.object(mail, 'sent_pass'), mock.patch.object(mail, 'save_state'), \
            mock.patch.object(mail, 'review_rejections', return_value=[]), \
            mock.patch.object(mail, 'mail_pass', **passes['mail']) as read, \
            mock.patch.object(mail, 'calendar_pass', **passes['calendar']) as calendar, \
            mock.patch('sys.stdout', io.StringIO()) as out:
        result = mail.run(None, client, client=object(), stats=stats)
    return result, out.getvalue(), stats, read, calendar


class UnknownGrantLearnsTest(unittest.TestCase):
    def test_the_first_403_is_remembered_and_the_next_read_makes_no_request(self):
        for part, other in (('gmail', 'calendar'), ('calendar', 'gmail')):
            client = refusing(part)
            with mock.patch.object(google.secret_store, 'put') as put, self.assertRaises(scopes.MissingScope):
                client.get(URLS[part])
            self.assertEqual(client.scopes, (other,), part)
            put.assert_called_once_with(scopes.SCOPES_SERVICE, other)
            client.opener = mock.Mock(side_effect=AssertionError('no request for a part known to be missing'))
            with self.assertRaises(scopes.MissingScope):
                client.need(part)

    def test_the_account_is_named_from_the_part_that_works(self):
        client = refusing('gmail')
        with mock.patch.object(google.secret_store, 'put'):
            self.assertEqual(client.account_email(), 'a@b.c')
        self.assertEqual(client.scopes, ('calendar',))


class CheckKeepsTheAllowedPartTest(unittest.TestCase):
    def test_a_missing_calendar_keeps_the_mail_results(self):
        # The owner's crash (24 Oct 2026): "8 of 22 emails", then the calendar pass died with a raw traceback.
        result, out, stats, read, _ = run_check(refusing('calendar'), mail={'return_value': (['line'], 8)},
                                                calendar={'side_effect': scopes.MissingScope('calendar')})
        self.assertIn('1 update', result)
        self.assertIn('Calendar was not allowed', out)
        self.assertIn('Reconnect', out)
        self.assertEqual(len(stats['gaps']), 1)
        self.assertIn('Calendar', stats['gaps'][0])

    def test_a_missing_gmail_still_reads_the_calendar(self):
        result, out, stats, _, calendar = run_check(refusing('gmail'), mail={'side_effect': scopes.MissingScope('gmail')},
                                                    calendar={'return_value': (['event line'], [])})
        calendar.assert_called_once()
        self.assertIn('1 update', result)
        self.assertIn('Gmail was not allowed', out)
        self.assertIn('Gmail', stats['gaps'][0])

    def test_each_part_known_missing_is_skipped_without_a_request(self):
        for granted, skipped in ((('gmail',), 'calendar'), (('calendar',), 'gmail')):
            client = google.Google('id', 'secret', 'refresh', opener=mock.Mock(), scopes=granted)
            *_, read, calendar = run_check(client, mail={'return_value': ([], 0)}, calendar={'return_value': ([], [])})
            (calendar if skipped == 'calendar' else read).assert_not_called()


if __name__ == '__main__':
    unittest.main()
