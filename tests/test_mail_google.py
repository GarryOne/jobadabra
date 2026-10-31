"""Google API sign-in and message-body helpers used by the Gmail check (src/sources/google.py).
See also test_mail.py."""
import base64
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import mail
from src.sources import google as google_api
from tests import zone
from tests.mail_fakes import app, text

setUpModule, tearDownModule = zone.pinned()


class GoogleApiTests(unittest.TestCase):
    def test_expired_sign_in_is_reported_clearly(self):
        import io, urllib.error
        def opener(request, timeout=None):
            raise urllib.error.HTTPError(google_api.TOKEN_URL, 400, 'Bad Request', {},
                                         io.BytesIO(b'{"error": "invalid_grant", "error_description": "Token has been expired or revoked."}'))
        client = google_api.Google('id', 'secret', 'refresh', opener=opener)
        with self.assertRaises(RuntimeError) as caught:
            client.profile()
        self.assertIn('invalid_grant', str(caught.exception))

    def test_a_failed_check_names_a_known_cause_in_words(self):
        # #314: the run row's warning carried Google's raw answer; the app lists it under "View details".
        revoked = RuntimeError('Google token refresh failed: {"error": "invalid_grant", "error_description": "Token has been expired or revoked."}')
        said = mail.failure_warning(revoked)
        self.assertEqual(said, mail.NOT_CHECKED['google'])
        self.assertNotRegex(said, r'invalid_grant|error_description|Token has been|[{}]')
        self.assertEqual(mail.failure_warning(ValueError('odd')), 'check failed: ValueError: odd')

    def test_auth_without_a_client_uses_the_shared_published_app(self):
        shared = {'client_id': 'shared-id.apps.googleusercontent.com', 'client_secret': 'shared-secret'}
        with tempfile.TemporaryDirectory() as tmp:
            client_file = Path(tmp) / 'google_oauth_client.json'
            client_file.write_text(json.dumps({'installed': shared}))
            with mock.patch.object(google_api, 'SHARED_CLIENT', client_file), \
                    mock.patch.object(google_api, 'authorize', return_value=google_api.SignIn('refresh', ('gmail', 'calendar'))) as authorize, \
                    mock.patch.object(google_api, 'store') as store, mock.patch.object(google_api, 'report'):
                google_api.main(['auth', '--github'])
        authorize.assert_called_once_with(shared['client_id'], shared['client_secret'])
        store.assert_called_once_with(shared['client_id'], shared['client_secret'], 'refresh', True, True, ('gmail', 'calendar'))  # published

    def test_auth_without_the_bundled_shared_client_points_to_setup(self):
        with mock.patch.object(google_api, 'SHARED_CLIENT', Path('/nonexistent/google_oauth_client.json')), \
                mock.patch('sys.stderr', io.StringIO()) as stderr, self.assertRaises(SystemExit):
            google_api.main(['auth'])
        self.assertIn('setup', stderr.getvalue())

    def test_guided_setup_finds_the_newly_downloaded_client_file(self):
        from src.sources import google_setup
        import os
        # Why (31 Oct 2026, a8): the files' written-at times and `start` are fixed numbers; "time.time() - 1" against real file mtimes read the clock and broke when the clock was not the machine's.
        start = 1_800_000_000
        with tempfile.TemporaryDirectory() as tmp:
            old_file = Path(tmp) / 'client_secret_old.json'
            old_file.write_text('{}')
            os.utime(old_file, (start - 3600, start - 3600))
            self.assertIsNone(google_setup.newest_client_file(start, tmp))
            new_file = Path(tmp) / 'client_secret_new.json'
            new_file.write_text('{}')
            os.utime(new_file, (start + 5, start + 5))
            self.assertEqual(google_setup.newest_client_file(start, tmp), str(new_file))

    def test_auth_reads_the_downloaded_client_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'client_secret.json'
            path.write_text(json.dumps({'installed': {'client_id': 'cid', 'client_secret': 'sec'}}))
            with mock.patch.object(google_api, 'authorize', side_effect=SystemExit('stop')) as authorize:
                with self.assertRaises(SystemExit):
                    google_api.main(['auth', '--client-json', str(path)])
            authorize.assert_called_once_with('cid', 'sec')

    def test_body_text_prefers_plain_and_strips_html(self):
        enc = lambda s: base64.urlsafe_b64encode(s.encode()).decode().rstrip('=')
        html_only = {'mimeType': 'multipart/alternative', 'parts': [
            {'mimeType': 'text/html', 'body': {'data': enc('<p>Thank you&nbsp;for <b>applying</b></p><style>x{}</style>')}}]}
        self.assertEqual(google_api.body_text(html_only), 'Thank you for applying')
        both = {'mimeType': 'multipart/alternative', 'parts': [
            {'mimeType': 'text/plain', 'body': {'data': enc('Plain wins')}},
            {'mimeType': 'text/html', 'body': {'data': enc('<p>HTML</p>')}}]}
        self.assertEqual(google_api.body_text(both), 'Plain wins')


if __name__ == '__main__':
    unittest.main()
