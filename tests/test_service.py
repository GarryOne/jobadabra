"""The engine's view of the service: a stable random install id and the private playbook, failing soft."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import service  # noqa: E402


class InstallIdTest(unittest.TestCase):
    def test_the_shared_id_wins_and_a_random_one_is_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'install_id'
            self.assertEqual(service.install_id(path, {'JOBADABRA_INSTALL_ID': 'shared-install-1'}), 'shared-install-1')
            self.assertFalse(path.exists())
            first = service.install_id(path, {})
            self.assertRegex(first, r'^[0-9a-f]{24}$')
            self.assertEqual(service.install_id(path, {}), first)            # kept for the next run
            self.assertNotEqual(service.install_id(Path(tmp) / 'other', {'JOBADABRA_INSTALL_ID': 'bad id'}), 'bad id')


class PlaybookTest(unittest.TestCase):
    def test_it_asks_with_the_token_for_one_board(self):
        seen = {}
        def post(url, body):
            seen['post'] = (url, body)
            return {'token': 'tok'}
        def get(url, headers):
            seen['get'] = (url, headers)
            return {'ok': True, 'board': 'ashby', 'text': 'ashby notes'}
        text = service.playbook('Ashby', base='https://x.test/', install='install-12345', post=post, get=get)
        self.assertEqual(text, 'ashby notes')
        self.assertEqual(seen['post'], ('https://x.test/api/install-token', {'install': 'install-12345'}))
        self.assertEqual(seen['get'], ('https://x.test/api/playbook?board=ashby', {'Authorization': 'Bearer tok', 'X-Install-Id': 'install-12345'}))

    def test_any_trouble_means_no_notes(self):
        def broken(url, *args):
            raise OSError('offline')
        self.assertEqual(service.playbook('lever', base='https://x.test', install='install-12345', post=broken), '')
        self.assertEqual(service.playbook('lever', base='https://x.test', install='install-12345', post=lambda u, b: {}), '')
        self.assertEqual(service.playbook('lever', base='https://x.test', install='install-12345', post=lambda u, b: {'token': 't'}, get=broken), '')


class SiteTokenTest(unittest.TestCase):
    """site_token: asked once and kept; after a 429 not asked again the same UTC day; offline is asked again (17-18 Oct 2026: the day's tokens ran out)."""

    def test_kept_refused_and_offline(self):
        import urllib.error
        with tempfile.TemporaryDirectory() as tmp:
            path, asks = Path(tmp) / 'tokens.json', []
            def given():
                asks.append(1)
                return 'tok'
            self.assertEqual(service.site_token('install-1', 'index', given, path=path, today='2026-10-17'), 'tok')
            self.assertEqual(service.site_token('install-1', 'index', given, path=path, today='2026-10-18'), 'tok')
            self.assertEqual(len(asks), 1)
            def refused():
                asks.append(1)
                raise urllib.error.HTTPError('u', 429, 'limit', {}, None)
            for _ in range(5):
                self.assertEqual(service.site_token('install-1', 'recipes', refused, path=path, today='2026-10-17'), '')
            self.assertEqual(len(asks), 2, 'one refusal, then quiet for the day')
            service.site_token('install-1', 'recipes', refused, path=path, today='2026-10-18')
            self.assertEqual(len(asks), 3, 'asked again the next day')
            def offline():
                asks.append(1)
                raise OSError('offline')
            service.site_token('install-2', 'report', offline, path=path, today='2026-10-18')
            service.site_token('install-2', 'report', offline, path=path, today='2026-10-18')
            self.assertEqual(len(asks), 5, 'offline is not a refusal')
            self.assertEqual(service.site_token('install-1', 'index', given, path=path, today='2026-10-19'), 'tok', 'the other purposes are kept')


if __name__ == '__main__':
    unittest.main()


class SiteOffTest(unittest.TestCase):
    def test_every_test_smoke_or_ci_flag_keeps_the_live_site_untouched(self):
        for flag in service.OFF_FLAGS:
            calls = []
            result = service.playbook('lever', install='install-12345', env={flag: '1'},
                                      post=lambda u, b: calls.append(u) or {'token': 't'}, get=lambda u, h: calls.append(u) or {'text': 'x'})
            self.assertEqual((result, calls), ('', []), flag)

    def test_a_normal_run_and_an_explicit_test_site_still_ask(self):
        post, get = (lambda u, b: {'token': 't'}), (lambda u, h: {'text': 'notes'})
        self.assertEqual(service.playbook('lever', install='install-12345', env={}, post=post, get=get), 'notes')
        self.assertEqual(service.playbook('lever', base='https://x.test', install='install-12345', env={'CI': '1'}, post=post, get=get), 'notes')
