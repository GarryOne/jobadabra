"""Notion calls take turns with the app and other runs (one shared pace file), and pages are kept between runs."""
import json
import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from src import paths
from src.notion import pace
from src.notion import client
from src.notion.client import Tracker


class Answer:
    def __init__(self, value):
        self.body = json.dumps(value).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, *_):
        return self.body


class SharedPaceTest(unittest.TestCase):
    def setUp(self):
        self.token = f'test-{time.time()}'

    def tearDown(self):
        for suffix in ('', '.lock'):
            path = pace.pace_file(self.token) + suffix
            if os.path.isdir(path):
                os.rmdir(path)
            elif os.path.exists(path):
                os.remove(path)

    def test_turns_are_spaced_and_a_429_pauses_everyone(self):
        with mock.patch.object(pace, 'clock', lambda: 1000.0):
            first, second = pace.claim(self.token), pace.claim(self.token)
        self.assertEqual(second - first, pace.GAP_MS)
        with mock.patch.object(pace, 'clock', lambda: 1000.0):
            pace.calm_until(self.token, 1_002_000)
            self.assertEqual(pace.claim(self.token), 1_002_000)

    def test_same_file_as_the_app(self):
        # desktop/lib/notion-pace.js: <tmp>/job-pilotto-notion-<sha256(token)[:12]>.pace
        self.assertRegex(os.path.basename(pace.pace_file('abc')), r'^job-pilotto-notion-ba7816bf8f01\.pace$')

    def test_a_request_waits_for_its_turn(self):
        waits = []
        # GitHub runs set JOB_PILOTTO_NOTION_GAP_MS=700 (daily.yml): this test checks the default gap.
        with mock.patch.object(pace, 'clock', lambda: 1000.0), mock.patch.object(pace, 'GAP_MS', 340):  # a fixed clock: exactly one turn to wait
            pace.claim(self.token)
            pace.wait_turn(self.token, waits.append)
        self.assertEqual(waits, [0.34])

    def test_local_e2e_requests_do_not_wait_for_real_notion_slots(self):
        """The HTTP stand-in must answer a burst without a real service's clock."""
        now = [1000.0]
        waits, requested = [], []

        def sleep(seconds):
            waits.append(seconds)
            now[0] += seconds

        def opener(request, timeout):
            requested.append(request.full_url)
            return Answer({'results': []})

        with mock.patch.dict(os.environ, {'JOB_PILOTTO_E2E': '1', 'JOB_PILOTTO_E2E_NOTION_STANDIN': '1',
                                         'JOB_PILOTTO_E2E_NOTION_BASE_URL': 'http://127.0.0.1:12345'}), \
                mock.patch.object(pace, 'clock', lambda: now[0]), \
                mock.patch.object(pace, 'GAP_MS', 340), \
                mock.patch.object(client.urllib.request, 'urlopen', opener):
            tracker = Tracker(self.token, opener=opener, sleep=sleep)
            for _ in range(20):
                self.assertEqual(tracker._request('GET', 'pages/fixture'), {'results': []})
        self.assertEqual(requested, ['http://127.0.0.1:12345/v1/pages/fixture'] * 20)
        self.assertEqual(waits, [], 'a local stand-in must not consume real Notion rate-limit slots')

    def test_only_an_explicit_local_test_standin_bypasses_pacing(self):
        """A fault proxy or an out-of-test marker still takes real service turns."""
        for e2e, standin, base, expected in [
            ('1', '', 'http://127.0.0.1:12345', 'http://127.0.0.1:12345/v1'),
            ('', '1', 'http://127.0.0.1:12345', 'https://api.notion.com/v1'),
            ('1', '1', 'https://api.notion.com', 'https://api.notion.com/v1'),
        ]:
            with self.subTest(e2e=e2e, standin=standin, base=base):
                Path(pace.pace_file(self.token)).unlink(missing_ok=True)
                now, waits, requested = [1000.0], [], []

                def sleep(seconds):
                    waits.append(seconds)
                    now[0] += seconds

                def opener(request, timeout):
                    requested.append(request.full_url)
                    return Answer({'ok': True})

                with mock.patch.dict(os.environ, {'JOB_PILOTTO_E2E': e2e, 'JOB_PILOTTO_E2E_NOTION_STANDIN': standin,
                                                 'JOB_PILOTTO_E2E_NOTION_BASE_URL': base}), \
                        mock.patch.object(pace, 'clock', lambda: now[0]), \
                        mock.patch.object(pace, 'GAP_MS', 340), \
                        mock.patch.object(client.urllib.request, 'urlopen', opener):
                    tracker = Tracker(self.token, opener=opener, sleep=sleep)
                    for _ in range(2):
                        self.assertEqual(tracker._request('GET', 'pages/fixture'), {'ok': True})
                self.assertEqual(requested, [expected + '/pages/fixture'] * 2)
                self.assertEqual(waits, [0.34])


class KeptPageTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.data = mock.patch.object(paths, 'DATA', Path(self.folder.name))
        self.data.start()
        self.requests = []
        self.edited = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat().replace('+00:00', 'Z')

    def tearDown(self):
        self.data.stop()
        self.folder.cleanup()

    def tracker(self):
        def opener(request, timeout):
            route = request.full_url.split('/v1/')[1].split('?')[0]
            self.requests.append(route)
            if route == 'pages/profile':
                return Answer({'last_edited_time': self.edited})
            return Answer({'results': [{'type': 'paragraph', 'paragraph': {'rich_text': [{'plain_text': 'Senior SRE'}]}}],
                           'has_more': False})
        tracker = Tracker(f'test-{time.time()}', 'db', opener=opener, sleep=lambda _: None)
        tracker._paced = lambda: True
        return tracker

    def test_unchanged_page_is_read_from_the_copy_on_the_next_run(self):
        self.assertIn('Senior SRE', self.tracker().page_text('profile'))
        self.assertEqual(self.requests, ['pages/profile', 'blocks/profile/children'])
        self.requests.clear()
        self.assertIn('Senior SRE', self.tracker().page_text('profile'))  # a new run
        self.assertEqual(self.requests, ['pages/profile'])

    def test_changed_or_just_edited_page_is_read_again(self):
        self.tracker().page_text('profile')
        self.requests.clear()
        self.edited = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        self.tracker().page_text('profile')
        self.assertEqual(self.requests, ['pages/profile', 'blocks/profile/children'])
        self.requests.clear()
        self.tracker().page_text('profile')  # edited under 2 minutes ago: Notion's minute rounding can't be trusted
        self.assertEqual(self.requests, ['pages/profile', 'blocks/profile/children'])


if __name__ == '__main__':
    unittest.main()
