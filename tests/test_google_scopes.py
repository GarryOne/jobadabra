"""The Google sign-in checks what the user ticked: none, Gmail only, Calendar only, both (src/sources/google_scopes.py, google_auth.py)."""
import io
import json
import unittest
from unittest import mock

from src.sources import google, google_auth, google_scopes as scopes

GMAIL_URL, CAL_URL = scopes.SCOPE_URLS['gmail'], scopes.SCOPE_URLS['calendar']
CASES = {'none': '', 'gmail only': GMAIL_URL, 'calendar only': CAL_URL, 'both': f'{GMAIL_URL} {CAL_URL}'}
WANT = {'none': (), 'gmail only': ('gmail',), 'calendar only': ('calendar',), 'both': ('gmail', 'calendar')}


class GrantedPartsTest(unittest.TestCase):
    def test_parts_follow_the_token_answer(self):
        for name, text in CASES.items():
            self.assertEqual(scopes.parts_in(text), WANT[name], name)

    def test_what_the_app_says_for_each_case(self):
        self.assertEqual(scopes.say(WANT['both']), '')
        self.assertIn('Calendar was not allowed', scopes.say(WANT['gmail only']))
        self.assertIn('Gmail was not allowed', scopes.say(WANT['calendar only']))
        self.assertIn('Nothing was allowed', scopes.say(WANT['none']))
        self.assertEqual(scopes.say(None), '')   # a sign-in made before this check: assumed complete

    def test_saved_value_round_trips_and_unknown_is_none(self):
        self.assertIsNone(scopes.saved(''))
        self.assertEqual(scopes.saved('calendar'), ('calendar',))
        self.assertEqual(scopes.status(('gmail',))['missing'], ['calendar'])

    def test_a_reconnect_asks_only_for_the_missing_part(self):
        self.assertEqual(scopes.request_scopes(('calendar',)), (CAL_URL,))
        self.assertEqual(len(scopes.request_scopes()), 2)


class FakeGoogle(google.Google):
    def __init__(self, parts):
        super().__init__('id', 'secret', 'refresh', scopes=parts)
        self.called = []

    def get(self, url, params=None):
        self.called.append(url)
        return {'items': [], 'messages': [], 'emailAddress': 'a@b.c'}


class MissingScopeTest(unittest.TestCase):
    def test_every_read_of_a_missing_part_raises_the_named_error_and_makes_no_request(self):
        for name, parts in WANT.items():
            client = FakeGoogle(parts)
            reads = {'gmail': [client.profile, lambda: client.search('x'), lambda: client.snippet('1'), lambda: client.message('1')],
                     'calendar': [lambda: client.events(google.datetime.now(), google.datetime.now())]}
            for part, calls in reads.items():
                for call in calls:
                    if part in parts:
                        continue
                    with self.assertRaises(scopes.MissingScope, msg=f'{name}/{part}') as caught:
                        call()
                    self.assertEqual(caught.exception.part, part)
                    self.assertNotIn('403', str(caught.exception))
            self.assertEqual(client.called, [], name)

    def test_status_names_the_email_for_each_case(self):
        for parts in (('gmail',), ('calendar',), ('gmail', 'calendar'), None):
            self.assertTrue(FakeGoogle(parts).account_email() is not None, parts)

    def test_an_unknown_grant_keeps_working(self):
        self.assertEqual(FakeGoogle(None).profile()['emailAddress'], 'a@b.c')


def answer(server, respond):
    """Google's redirect arriving: the page is drawn inside the request."""
    answer.page = respond({'code': 'c', 'state': 'S'})


class RefusalTest(unittest.TestCase):
    def setUp(self):   # a refusal is remembered in the secret store: never this computer's real one
        patch = mock.patch.object(google.secret_store, 'put')
        patch.start()
        self.addCleanup(patch.stop)

    def refuse(self, url, call):
        import urllib.error
        body = io.BytesIO(json.dumps({'error': {'status': 'PERMISSION_DENIED', 'message': 'Request had insufficient authentication scopes.'}}).encode())
        error = urllib.error.HTTPError(url, 403, 'Forbidden', {}, body)
        client = google.Google('id', 'secret', 'refresh', opener=mock.Mock(side_effect=error))
        client._token = 'access'
        return call(client)

    def test_a_403_for_a_part_not_allowed_becomes_the_named_error(self):
        with self.assertRaises(scopes.MissingScope) as caught:
            self.refuse('https://gmail.googleapis.com/gmail/v1/users/me/profile', lambda c: c.profile())
        self.assertEqual(caught.exception.part, 'gmail')
        with self.assertRaises(scopes.MissingScope) as caught:
            self.refuse('https://www.googleapis.com/calendar/v3/calendars/primary/events', lambda c: c.get('https://www.googleapis.com/calendar/v3/calendars/primary/events'))
        self.assertEqual(caught.exception.part, 'calendar')

    def test_the_run_row_names_the_part_never_a_raw_403(self):
        from src.ai import mail_failure
        said = mail_failure.failure_warning(scopes.MissingScope('calendar'))
        self.assertIn('Calendar was not allowed', said)
        self.assertNotRegex(said, r'403|HTTPError')


class AuthorizeReadsTheGrantTest(unittest.TestCase):
    def sign_in(self, scope_text):
        tokens = {'refresh_token': 'r', 'scope': scope_text}
        with mock.patch.object(google_auth, 'exchange', return_value=tokens), \
                mock.patch.object(google_auth, 'wait_for_redirect', side_effect=answer), \
                mock.patch.object(google_auth.secrets, 'token_urlsafe', return_value='S'):
            return google_auth.authorize('id', 'secret', open_browser=lambda url: None)

    def test_each_case(self):
        for name in ('gmail only', 'calendar only', 'both'):
            result = self.sign_in(CASES[name])
            self.assertEqual(result.scopes, WANT[name], name)
            self.assertEqual(result.refresh_token, 'r')

    def test_nothing_allowed_stores_nothing(self):
        with self.assertRaises(SystemExit) as caught:
            self.sign_in(CASES['none'])
        self.assertIn('Nothing was allowed', str(caught.exception))

    def test_the_consent_url_for_a_reconnect_keeps_earlier_grants(self):
        seen = []
        with mock.patch.object(google_auth, 'exchange', return_value={'refresh_token': 'r', 'scope': CAL_URL}), \
                mock.patch.object(google_auth, 'wait_for_redirect', side_effect=answer), \
                mock.patch.object(google_auth.secrets, 'token_urlsafe', return_value='S'):
            google_auth.authorize('id', 'secret', open_browser=seen.append, only=('calendar',))
        self.assertIn('include_granted_scopes=true', seen[0])
        self.assertIn('calendar.readonly', seen[0])
        self.assertNotIn('gmail.readonly', seen[0])


class EveryReaderHandlesAMissingPartTest(unittest.TestCase):
    """The class: everything that reads Google or shows its state names a missing part, never a raw 403 or "unreachable"."""

    def test_doctor_names_it(self):
        from src import doctor
        for parts, text in ((('gmail',), 'Calendar was not allowed'), (('calendar',), 'Gmail was not allowed')):
            with mock.patch.object(google.Google, 'from_env', return_value=FakeGoogle(parts)):
                check = doctor.check_google()
            self.assertEqual(check.state, doctor.WARN, parts)
            self.assertIn(text, check.detail)
            self.assertNotRegex(check.detail, r'403|unreachable')

    def test_focus_counts_gmail_only_when_gmail_was_allowed(self):
        from src import focus
        for parts, want in ((('gmail',), True), (('calendar',), False), (None, True)):
            with mock.patch.object(google.Google, 'from_env', return_value=FakeGoogle(parts)):
                self.assertEqual(focus.gmail_connected(), want, parts)

    def test_the_mail_check_skips_calendar_but_still_reads_mail(self):
        from src.ai import mail
        client = FakeGoogle(('gmail',))
        with mock.patch.object(mail, 'open_stores'), mock.patch.object(mail, 'load_state', return_value={'notified': []}), \
                mock.patch.object(mail, 'applications', return_value=[]), mock.patch.object(mail, '_events_index', return_value={}), \
                mock.patch.object(mail, 'mail_pass', return_value=([], 0)) as read, mock.patch.object(mail, 'sent_pass'), \
                mock.patch.object(mail, 'calendar_pass') as calendar, mock.patch.object(mail, 'save_state'), \
                mock.patch.object(mail, 'review_rejections', return_value=[]), mock.patch('sys.stdout', io.StringIO()) as out:
            mail.run(None, client, client=object(), dry_run=False)
        read.assert_called_once()
        calendar.assert_not_called()
        self.assertIn('Calendar was not allowed', out.getvalue())


if __name__ == '__main__':
    unittest.main()
