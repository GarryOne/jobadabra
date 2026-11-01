"""Hosted Always on, the engine's side (src/hosted_run.py): state round-trips through the Worker, the environment holds only the run token, only new matches are posted."""
import http.server
import io
import json
import tarfile
import urllib.error
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from src import hosted_run


class FakeWorker(http.server.BaseHTTPRequestHandler):
    state = None
    posted = []
    seen_auth = []

    def log_message(self, *args):
        pass

    config = {'search': {'role_keywords': ['sre']}, 'profile': 'P', 'cv': 'C'}

    def do_GET(self):
        FakeWorker.seen_auth.append(self.headers['Authorization'])
        if self.path.endswith('/config'):
            if FakeWorker.config is None:
                self.send_response(404); self.end_headers(); return
            self.send_response(200); self.end_headers(); self.wfile.write(json.dumps(FakeWorker.config).encode()); return
        if FakeWorker.state is None:
            self.send_response(404); self.end_headers(); return
        self.send_response(200); self.end_headers(); self.wfile.write(FakeWorker.state)

    def do_PUT(self):
        FakeWorker.state = self.rfile.read(int(self.headers['Content-Length']))
        self.send_response(200); self.end_headers()

    def do_POST(self):
        FakeWorker.posted.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
        self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok": true}')


def tar_of(files):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
        for name, text in files.items():
            data = text.encode(); info = tarfile.TarInfo(name); info.size = len(data); tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


class HostedRun(unittest.TestCase):
    def setUp(self):
        FakeWorker.state, FakeWorker.posted, FakeWorker.seen_auth = None, [], []
        FakeWorker.config = {'search': {'role_keywords': ['sre']}, 'profile': 'P', 'cv': 'C'}
        self.server = http.server.HTTPServer(('127.0.0.1', 0), FakeWorker)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.site = f'http://127.0.0.1:{self.server.server_port}'
        self.folder = Path(tempfile.mkdtemp())

    def tearDown(self):
        self.server.shutdown()

    def test_environment_holds_the_run_token_and_no_other_credential(self):
        base = {'NOTION_TOKEN': 'n', 'TELEGRAM_BOT_TOKEN': 't', 'ANTHROPIC_API_KEY': 'sk-mine', 'OPENAI_API_KEY': 'o', 'JOBADABRA_TRIAL_KEY': 'JPF1.x.y', 'PATH': '/bin'}
        env = hosted_run.environment(self.folder, self.site, 'HR1.run.tok', base)
        self.assertEqual(env['ANTHROPIC_API_KEY'], 'HR1.run.tok')
        self.assertEqual(env['JOBADABRA_AI_BASE_URL'], f'{self.site}/api/ai')
        self.assertEqual(env['JOBADABRA_STORE'], 'sqlite')
        for name in ('NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'OPENAI_API_KEY', 'JOBADABRA_TRIAL_KEY'):
            self.assertNotIn(name, env)

    def test_new_matches_are_only_the_ones_the_run_added_best_first(self):
        before = [{'url': 'https://a/1', 'title': 'Old', 'fit': 9}]
        after = before + [{'url': 'https://a/2', 'title': 'Two', 'company': 'C', 'fit': 5, 'reason': 'ok'}, {'url': 'https://a/3', 'title': 'Three', 'fit': 8}]
        self.assertEqual([m['title'] for m in hosted_run.new_matches(before, after)], ['Three', 'Two'])

    def test_the_pushed_config_sits_on_the_engines_own_config_files(self):
        # 17 Oct 2026 (hosted e2e): the folder held only search/profile/cv, and `daily` died on a missing config/preferences.json
        self.assertTrue(hosted_run.pull_config(self.site, 'HR1.r.t', self.folder))
        for name in ('preferences.json', 'meanings_schema.json'):
            self.assertTrue((self.folder / 'config' / name).exists(), name)
        self.assertEqual(json.loads((self.folder / 'config' / 'search.json').read_text()), {'role_keywords': ['sre']})

    def test_state_round_trips_and_the_token_is_the_only_credential(self):
        FakeWorker.state = tar_of({'data/jobs.sqlite': 'x'})
        self.assertTrue(hosted_run.pull_state(self.site, 'HR1.r.t', self.folder))
        self.assertTrue(hosted_run.pull_config(self.site, 'HR1.r.t', self.folder))
        self.assertEqual(json.loads((self.folder / 'config' / 'search.json').read_text()), {'role_keywords': ['sre']})
        self.assertEqual((self.folder / 'config' / 'profile.md').read_text(), 'P')
        (self.folder / 'data').mkdir(exist_ok=True)
        (self.folder / 'data' / 'new.txt').write_text('later')
        hosted_run.push_state(self.site, 'HR1.r.t', self.folder)
        names = tarfile.open(fileobj=io.BytesIO(FakeWorker.state), mode='r:gz').getnames()
        self.assertIn('data/new.txt', names)
        self.assertEqual(set(FakeWorker.seen_auth), {'Bearer HR1.r.t'})

    def test_a_good_run_posts_its_new_matches_and_pushes_state(self):
        FakeWorker.state = tar_of({'data/x': '1'})
        lists = [[{'url': 'https://a/1', 'title': 'Old', 'fit': 1}], [{'url': 'https://a/1', 'title': 'Old', 'fit': 1}, {'url': 'https://a/2', 'title': 'New', 'fit': 7}]]
        with mock.patch.object(hosted_run, 'read_matches', side_effect=lists):
            body = hosted_run.run(self.site, 'HR1.r.t', self.folder, search=lambda env: 0)
        self.assertEqual(body['status'], 'ok')
        self.assertEqual(FakeWorker.posted, [body])
        self.assertEqual([m['title'] for m in body['matches']], ['New'])

    def test_a_failed_search_or_missing_state_posts_failed_and_keeps_old_state(self):
        old = FakeWorker.state = tar_of({'data/x': '1'})
        with mock.patch.object(hosted_run, 'read_matches', return_value=[]):
            body = hosted_run.run(self.site, 'HR1.r.t', self.folder, search=lambda env: 3)
        self.assertEqual((body['status'], FakeWorker.state), ('failed', old))
        FakeWorker.config = None   # no config pushed yet: nothing to search for
        body = hosted_run.run(self.site, 'HR1.r.t', Path(tempfile.mkdtemp()), search=lambda env: 0)
        self.assertEqual(body['status'], 'failed')

    def test_the_sqlite_store_is_read_back_in_a_fresh_process(self):
        env = hosted_run.environment(self.folder, self.site, 'HR1.r.t')
        (self.folder / 'config').mkdir(); (self.folder / 'data').mkdir()
        code = ('from src import store_access; s = store_access.open_run(); '
                's.matches.upsert({"url": "https://a/9", "title": "Nine", "company": "Co", "fit": 6, "status": "Open"})')
        import subprocess, sys
        subprocess.run([sys.executable, '-c', code], env=env, check=True, capture_output=True)
        self.assertEqual([m['title'] for m in hosted_run.read_matches(env)], ['Nine'])

    def test_merge_adds_new_matches_to_the_local_store_once(self):
        import os, subprocess, sys
        (self.folder / 'config').mkdir(); (self.folder / 'data').mkdir()
        inbox = self.folder / 'inbox.json'
        inbox.write_text(json.dumps([{'url': 'https://a/1', 'title': 'One', 'company': 'Co', 'fit': 7, 'line': 'good'}, {'url': '', 'title': 'no url'}]))
        env = {**os.environ, 'JOBADABRA_STORE': 'sqlite', 'JOBADABRA_DISABLE': 'notion', 'JOBADABRA_CONFIG_DIR': str(self.folder / 'config'), 'JOBADABRA_DATA_DIR': str(self.folder / 'data')}
        run = lambda: subprocess.run([sys.executable, '-m', 'src', 'hosted', '--merge', str(inbox)], env=env, capture_output=True, text=True, check=True).stdout
        self.assertIn('1 new matches added', run())
        self.assertIn('0 new matches added', run())   # the second time the job is already there
        self.assertEqual([m['title'] for m in hosted_run.read_matches(env)], ['One'])
        # the run card: one row of this Mac's run history for the one time something arrived, on our servers, in Always on's words
        code = 'import json; from src import store_access; print(json.dumps(store_access.open_run().cron_runs.list(), default=str))'
        rows = json.loads(subprocess.run([sys.executable, '-c', code], env=env, capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1])
        self.assertEqual([(r['kind'], r['where'], r['trigger'], r['summary']) for r in rows], [('scheduled', 'cloud', 'Always on', '1 new job while you were away')])
        self.assertIn('Always on', rows[0]['title'])
        self.assertIn('New job: One | Co | https://a/1 | 7', rows[0]['log'].split('\n'))   # the run card's item, with its fit (renderer/new-jobs-card.js)

    def test_the_server_runs_one_run_per_post_and_refuses_a_bad_token(self):
        import urllib.request
        from http.server import HTTPServer
        calls = []
        patcher = mock.patch.object(hosted_run, 'run', side_effect=lambda site, token, folder: calls.append((site, token)) or {'status': 'ok', 'matches': [1, 2]})
        patcher.start(); self.addCleanup(patcher.stop)
        with mock.patch('http.server.ThreadingHTTPServer', lambda addr, handler: HTTPServer(('127.0.0.1', 0), handler)), \
                mock.patch.object(HTTPServer, 'serve_forever', lambda server: setattr(self, 'handler', server.RequestHandlerClass)):
            hosted_run.serve()
        server = HTTPServer(('127.0.0.1', 0), self.handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        post = lambda body: urllib.request.Request(f'http://127.0.0.1:{server.server_port}/run', data=json.dumps(body).encode(), method='POST')
        with urllib.request.urlopen(post({'site': 'https://s.test', 'token': 'HR1.r.t'})) as reply:
            self.assertEqual(json.loads(reply.read()), {'ok': True, 'status': 'ok', 'matches': 2})
        with self.assertRaises(urllib.error.HTTPError) as bad:
            urllib.request.urlopen(post({'site': 'https://s.test', 'token': 'JPF1.x.y'}))
        self.assertEqual(bad.exception.code, 400)
        self.assertEqual(calls, [('https://s.test', 'HR1.r.t')])
        server.shutdown(); server.server_close()


if __name__ == '__main__':
    unittest.main()
