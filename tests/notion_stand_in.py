"""Starts the in-memory Notion stand-in (desktop/e2e/lib/notion-fake.mjs) for a Python test class: one place, so every class
uses it the same way. The stand-in has its own Notion-shaped token per run and answers any other token with Notion's 401
(9ab5620), so the tests take the token it prints. Used by tests/test_store_notion.py, test_kit_store.py, test_prep_store.py
(test_ledger_store.py and test_matches_store.py borrow test_store_notion's setUpClass)."""
import json
import os
import subprocess
from pathlib import Path
from unittest import mock

FAKE = Path(__file__).resolve().parent.parent / 'desktop' / 'e2e' / 'lib' / 'notion-fake.mjs'


def start(cls):
    """Start the stand-in for a test class: sets cls.server, cls.url, cls.token, and cls.env (the variables that point the Notion
    client at it, started). stop(cls) ends both."""
    script = (f"import {{startNotionFake}} from {json.dumps(FAKE.as_uri())}; const f = await startNotionFake();"
              " console.log(JSON.stringify({url: f.url, token: f.token}));")
    cls.server = subprocess.Popen(['node', '--input-type=module', '-e', script], stdout=subprocess.PIPE, text=True)
    try:
        found = json.loads(cls.server.stdout.readline().strip() or '{}')
    except ValueError:
        found = {}
    if not str(found.get('url', '')).startswith('http') or not found.get('token'):
        cls.server.kill()
        raise RuntimeError('the Notion stand-in did not start')
    cls.url, cls.token = found['url'], found['token']
    cls.env = mock.patch.dict(os.environ, {'JOBADABRA_E2E': '1', 'JOBADABRA_E2E_NOTION_BASE_URL': cls.url})
    cls.env.start()


def stop(cls):
    cls.env.stop()
    cls.server.kill()
    cls.server.wait()
