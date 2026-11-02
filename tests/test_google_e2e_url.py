"""Google's hosts are rewritten to the end-to-end fake only in a test run (src/sources/google.py e2e_url)."""
import os
import unittest
from unittest import mock

from src.sources.google import e2e_url


class E2eUrlTest(unittest.TestCase):
    def test_real_hosts_unless_a_test_run_names_the_fake(self):
        url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=a'
        with mock.patch.dict(os.environ, {'JOBADABRA_E2E_GOOGLE_BASE_URL': 'http://127.0.0.1:9/'}):
            os.environ.pop('JOBADABRA_E2E', None)
            self.assertEqual(e2e_url(url), url)
            os.environ['JOBADABRA_E2E'] = '1'
            self.assertEqual(e2e_url(url), 'http://127.0.0.1:9/gmail.googleapis.com/gmail/v1/users/me/messages?q=a')
            del os.environ['JOBADABRA_E2E']


if __name__ == '__main__':
    unittest.main()
