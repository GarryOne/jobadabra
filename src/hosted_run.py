"""Hosted Always on, the container's side: `python -m src hosted --site URL --token HR1...` (or `--serve` in the container) pulls the person's state from our Worker, runs one SQLite-store search with AI through our route, and posts the new matches back.
Spec private spec jobadabra-lab:docs/specs/2026-10-16-hosted-always-on.md §1-2. The run token is the only credential: it asks the Worker for the state (GET /api/hosted/state), is the AI key
(x-api-key on /api/ai), and posts the one result (POST /api/hosted/result). No Notion, Gmail, Telegram or user key is ever here. Guard: tests/test_hosted_run.py.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

SEARCH_ARGS = ['--mode', 'scheduled', '--enrich-max', '100', '--score-max', '60', '--auto-kit-max', '0', '--budget', '600']
MAX_MATCHES = 200
DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / 'config'


def _call(url, token, method='GET', data=None):
    request = urllib.request.Request(url, data=data, method=method, headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=120) as reply:
        return reply.read()


def pull_state(site, token, folder):
    """The person's state (a tar of config/, data/) from the Worker into `folder`; an empty folder when there is none yet. -> True when state arrived."""
    try:
        blob = _call(f'{site}/api/hosted/state', token)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return False
        raise
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:gz') as tar:
        tar.extractall(folder, filter='data')   # 'data': no absolute paths, no links out of the folder
    return True


def pull_config(site, token, folder):
    """What the app pushed ({search, profile, cv}) into config/search.json, profile.md, cv.md. -> True when there was a config."""
    try:
        given = json.loads(_call(f'{site}/api/hosted/config', token))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return False
        raise
    shutil.copytree(DEFAULT_CONFIG, folder / 'config', dirs_exist_ok=True)   # the engine's own files (preferences, schemas) under what the app pushed: a run never starts on a bare folder
    (folder / 'config' / 'search.json').write_text(json.dumps(given.get('search') or {}))
    (folder / 'config' / 'profile.md').write_text(given.get('profile') or '')
    (folder / 'config' / 'cv.md').write_text(given.get('cv') or '')
    return bool(given.get('search'))


def push_state(site, token, folder):
    """Our copy of the state back to the Worker (which encrypts it at rest in R2): data/ (the stores), without the crawl's reports.
    The config is the app's to change (PUT /api/hosted/config), never ours."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
        if (folder / 'data').exists():
            tar.add(folder / 'data', arcname='data', filter=lambda info: None if '/reports' in info.name else info)
    _call(f'{site}/api/hosted/state', token, 'PUT', buffer.getvalue())


def environment(folder, site, token, base=None):
    """The engine's environment for a hosted run: the SQLite store in `folder`, AI through the site with the run token, nothing else."""
    env = dict(base if base is not None else os.environ)
    for name in [key for key in env if key.startswith(('NOTION_', 'TELEGRAM_', 'ANTHROPIC_', 'OPENAI_', 'JOBADABRA_TRIAL', 'JOBADABRA_AI'))]:
        del env[name]   # a hosted run holds no other credential, whatever the image or the host sets
    env.update({'JOBADABRA_STORE': 'sqlite', 'JOBADABRA_DISABLE': 'notion', 'JOBADABRA_CONFIG_DIR': str(folder / 'config'),
                'JOBADABRA_DATA_DIR': str(folder / 'data'), 'JOBADABRA_PROFILE_FILE': str(folder / 'config' / 'profile.md'),
                'JOBADABRA_AI_BASE_URL': f'{site}/api/ai', 'ANTHROPIC_API_KEY': token, 'JOBADABRA_TRIGGER': 'hosted'})
    return env


def new_matches(before, after):
    """The matches the run added (by url), best fit first, as the result post carries them."""
    known = {m.get('url') for m in before}
    fresh = [m for m in after if m.get('url') not in known and m.get('url')]
    fresh.sort(key=lambda m: -(m.get('fit') or 0))
    return [{'job': m['url'], 'title': m.get('title') or '', 'company': m.get('company') or '', 'url': m['url'], 'fit': m.get('fit') or 0,
             'line': (m.get('reason') or '')[:300]} for m in fresh[:MAX_MATCHES] if m.get('title')]


def read_matches(env):
    """The store's matches (a list of records) as the engine would read them with `env`."""
    code = 'import json; from src import store_access; s = store_access.open_run(); print(json.dumps(s.matches.list(), default=str))'
    out = subprocess.run([sys.executable, '-c', code], env=env, capture_output=True, text=True, check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


def run(site, token, folder, search=None):
    """One hosted run in `folder`. -> the result body that was posted. `search` is the engine process (a test swaps it)."""
    site = site.rstrip('/')
    pull_state(site, token, folder)   # none yet on the first run: the stores start empty
    configured = pull_config(site, token, folder)
    env = environment(folder, site, token)
    status, matches = 'failed', []
    if configured:
        try:
            before = read_matches(env)
            done = (search or (lambda e: subprocess.run([sys.executable, '-m', 'src', 'daily', *SEARCH_ARGS], env=e, timeout=14 * 60).returncode))(env)
            if done == 0:
                matches = new_matches(before, read_matches(env))
                status = 'ok'
                push_state(site, token, folder)
        except (subprocess.SubprocessError, OSError, ValueError) as error:
            print(f'hosted run failed: {type(error).__name__}: {error}', file=sys.stderr)
    body = {'status': status, 'matches': matches}
    _call(f'{site}/api/hosted/result', token, 'POST', json.dumps(body).encode())
    return body


def serve(port=8080):
    """The container's mode (`--serve`): the Worker starts the container and POSTs /run {site, token}; the reply comes when the run is done, so the Worker's
    Queue consumer can wait for it (Cloudflare Containers are driven by requests, as tools/hosted-probe). One run at a time; GET / answers ok for the start check."""
    import http.server
    lock = threading.Lock()

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(data)

        def do_GET(self):
            self.reply(200, {'ok': True})

        def do_POST(self):
            try:
                given = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
            except ValueError:
                return self.reply(400, {'ok': False})
            token, site = str(given.get('token', '')), str(given.get('site', ''))
            if self.path != '/run' or not token.startswith('HR1.') or not (site.startswith('https://') or site.startswith('http://127.0.0.1:')):   # loopback http only for the e2e (tools/hosted-e2e)
                return self.reply(400, {'ok': False})
            if not lock.acquire(blocking=False):
                return self.reply(409, {'ok': False, 'error': 'a run is in progress'})
            try:
                with tempfile.TemporaryDirectory(prefix='jp-hosted-') as folder:
                    body = run(site, token, Path(folder))
                self.reply(200, {'ok': True, 'status': body['status'], 'matches': len(body['matches'])})
            except Exception as error:   # the Worker sees a failed run; the run token expires by itself
                print(f'hosted run crashed: {type(error).__name__}: {error}', file=sys.stderr)
                self.reply(500, {'ok': False})
            finally:
                lock.release()

    http.server.ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()


def merge(path):
    """The app's side (`--merge inbox.json`): matches that arrived while the Mac was off go into this Mac's own store as Open rows, unless the search already has the job.
    -> how many were added. The Mac's store stays the primary copy; the hosted copy is a cache (spec §2)."""
    from . import store_access
    stores = store_access.open_run()
    added, lines = 0, []
    for match in json.loads(Path(path).read_text()):
        url = match.get('url') or ''
        if not url or not match.get('title') or stores.matches.get(url):
            continue
        stores.matches.upsert({'url': url, 'title': match['title'], 'company': match.get('company') or '', 'fit': match.get('fit') or 0,
                               'reason': match.get('line') or '', 'status': 'Open'})
        added += 1
        clean = lambda text: str(text or '').replace('|', '/').replace('\n', ' ').strip()   # the log line's own separator
        lines.append(f"New job: {clean(match['title'])} | {clean(match.get('company'))} | {url} | {int(match.get('fit') or 0)}")
    if added:
        # The run card in Recent activity (spec §4b): what arrived while this Mac was off, one row of this Mac's own run history. Written directly: the AI ran on our
        # servers, so none of the run log's own words (cost, warnings) apply here.
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        stores.cron_runs.put({'kind': 'scheduled', 'where': 'cloud', 'status': 'OK', 'started_at': now.isoformat(timespec='seconds'), 'finished_at': now.isoformat(timespec='seconds'),
                              'progress': [], 'trigger': 'Always on', 'mode': 'scheduled', 'title': f"{now.astimezone().strftime('%Y-%m-%d %H:%M')} · Always on",
                              'summary': f"{added} new {'job' if added == 1 else 'jobs'} while you were away", 'report': '', 'result': '',
                              'log': '\n'.join(['Ran on our servers: no technical log is kept.', *lines]), 'stats': {'new_jobs': added}})   # the New job lines are the run card's items (renderer/new-jobs-card.js)
    return added


def main():
    args = sys.argv[1:]
    if '--merge' in args:
        print(f"hosted merge: {merge(args[args.index('--merge') + 1])} new matches added")
        return 0
    if '--serve' in args:
        serve()
        return 0
    site = args[args.index('--site') + 1] if '--site' in args else os.environ.get('HOSTED_SITE', 'https://www.jobpilotto.top')
    token = args[args.index('--token') + 1] if '--token' in args else os.environ.get('HOSTED_RUN_TOKEN', '')
    if not token.startswith('HR1.'):
        print('hosted: a run token (HR1...) is needed: --token or HOSTED_RUN_TOKEN', file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix='jp-hosted-') as folder:
        body = run(site, token, Path(folder))
    print(f"hosted run {body['status']}: {len(body['matches'])} new matches")
    return 0 if body['status'] == 'ok' else 1


if __name__ == '__main__':
    sys.exit(main())
