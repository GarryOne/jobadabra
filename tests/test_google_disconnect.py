"""Owner, 7 Oct 2026: "there is no way for me to disconnect from Gmail". Disconnect revokes the sign-in at Google and forgets it here,
even when Google cannot be reached."""
import unittest
from unittest import mock

from src.sources import google

STORE = {'jobadabra.google.client-id': 'id', 'jobadabra.google.client-secret': 'secret',
         'jobadabra.google.refresh-token': 'refresh', 'jobadabra.google.auth-at': '2026-10-07'}


class DisconnectTest(unittest.TestCase):
    def setUp(self):
        self.store = dict(STORE)
        patches = [mock.patch.object(google.secret_store, 'get', side_effect=self.store.get),
                   mock.patch.object(google.secret_store, 'delete', side_effect=lambda service, user=None: self.store.pop(service, None)),
                   mock.patch.dict('os.environ', {}, clear=False)]
        for name in google.KEYCHAIN:
            patches.append(mock.patch.dict('os.environ', {name: ''}))
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_revokes_at_google_and_forgets_every_entry(self):
        asked = []

        class Answer:
            def __enter__(self): return self
            def __exit__(self, *args): return False
        got = google.disconnect(opener=lambda request, timeout: asked.append((request.full_url, request.data)) or Answer())
        self.assertEqual(got, {'ok': True, 'revoked': True, 'was_connected': True})
        self.assertEqual(asked, [(google.REVOKE_URL, b'token=refresh')])
        self.assertEqual(self.store, {})

    def test_google_unreachable_still_forgets_it_here(self):
        def offline(request, timeout):
            raise OSError('offline')
        self.assertEqual(google.disconnect(opener=offline), {'ok': True, 'revoked': False, 'was_connected': True})
        self.assertEqual(self.store, {})
        self.assertEqual(google.disconnect(opener=offline)['was_connected'], False)   # twice: nothing left, nothing asked


if __name__ == '__main__':
    unittest.main()
