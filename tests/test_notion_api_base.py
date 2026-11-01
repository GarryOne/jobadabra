"""The Notion stand-in of the end-to-end tests is used only in a test run (src/notion/client.py api_base)."""
import os
import unittest
from unittest import mock

from src.notion.client import api_base


class ApiBaseTest(unittest.TestCase):
    def test_real_api_unless_a_test_run_names_the_stand_in(self):
        with mock.patch.dict(os.environ, {'JOBADABRA_E2E_NOTION_BASE_URL': 'http://127.0.0.1:9/'}, clear=False):
            os.environ.pop('JOBADABRA_E2E', None)
            self.assertEqual(api_base(), 'https://api.notion.com/v1')
            os.environ['JOBADABRA_E2E'] = '1'
            self.assertEqual(api_base(), 'http://127.0.0.1:9/v1')
            del os.environ['JOBADABRA_E2E']


if __name__ == '__main__':
    unittest.main()
