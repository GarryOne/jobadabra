"""The cloud contract: every setting the app stores for GitHub runs reaches the engine in each workflow that needs it.

2 Oct 2026: the app stored NOTION_SEARCH_SETTINGS_PAGE as a repo variable, but daily.yml and scout.yml never passed it to the
engine, so a strategy change in Notion never reached a scheduled run (fixed in 9a07604). Two layers:
  1. static: every NOTION_* id the app stores and the engine reads is in the env of every workflow that runs the engine;
  2. behavioural: the engine started with only the env the workflow gives it (no app folder) takes the Notion page over the
     "Your settings" copy of config/search.json.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / '.github' / 'workflows'
ENGINE_RUNS = re.compile(r'python -m src (daily|check|scout|discover|feeds)\b')
SEARCH_PAGE = 'NOTION_SEARCH_SETTINGS_PAGE'


def workflow_text(name, ref=None):
    """The workflow file; `ref` reads an older commit (to prove a test fails against the broken workflow)."""
    if ref:
        # CI checks out one commit (actions/checkout, depth 1): the older workflow is not there, so these proofs are skipped, not failed.
        if subprocess.run(['git', 'cat-file', '-e', f'{ref}:.github/workflows/{name}'], cwd=ROOT, capture_output=True).returncode:
            raise unittest.SkipTest(f'{ref} is not in this clone (shallow checkout)')
        return subprocess.run(['git', 'show', f'{ref}:.github/workflows/{name}'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return (WORKFLOWS / name).read_text()


def passed_names(text):
    """NAME: ${{ vars.NAME }} (or secrets.NAME) lines: the settings a workflow hands to the engine."""
    return {m.group(1): m.group(2) for m in re.finditer(r'^\s+([A-Z][A-Z0-9_]+): \$\{\{ (?:vars|secrets)\.([A-Z0-9_]+) \}\}', text, re.M)}


def app_stores():
    """Notion ids the app keeps in settings.notionIds (and sends as repo variables): the template's, plus the ones it adds itself."""
    names = set(re.findall(r'"(NOTION_[A-Z_]+)"', (ROOT / 'config' / 'notion_template.json').read_text()))
    for path in (ROOT / 'desktop' / 'lib').glob('*.js'):
        text = path.read_text()
        names |= set(re.findall(r'\bids\.(NOTION_[A-Z_]+)', text)) | set(re.findall(r'\b(NOTION_[A-Z_]+): (?:page|id)\b', text))
    return names


def engine_reads():
    names = set()
    for path in (ROOT / 'src').rglob('*.py'):
        names |= set(re.findall(r'os\.(?:getenv|environ\.get)\(\s*[\'"](NOTION_[A-Z_]+)', path.read_text()))
        names |= set(re.findall(r'os\.environ\[\s*[\'"](NOTION_[A-Z_]+)', path.read_text()))
    return names


def missing(text):
    """What the app stores and the engine reads but this workflow does not pass, for a workflow that runs the engine."""
    if not ENGINE_RUNS.search(text) and 'python -m src' not in text:
        return set()
    need = app_stores() & engine_reads()
    if not ENGINE_RUNS.search(text):
        need.discard(SEARCH_PAGE)  # only the crawls refresh the cache from the page (src/__main__.py)
    return need - set(passed_names(text))


class StaticContractTests(unittest.TestCase):
    def test_the_contract_sees_the_search_settings_page(self):
        self.assertIn(SEARCH_PAGE, app_stores())
        self.assertIn(SEARCH_PAGE, engine_reads())

    def test_every_workflow_passes_what_the_app_stores_and_the_engine_reads(self):
        for name in ('daily.yml', 'scout.yml', 'mail.yml'):
            with self.subTest(workflow=name):
                self.assertEqual(missing(workflow_text(name)), set(), f'{name} does not pass these settings to the engine')

    def test_the_check_fails_against_the_workflows_before_the_fix(self):
        for name in ('daily.yml', 'scout.yml'):
            with self.subTest(workflow=name):
                self.assertIn(SEARCH_PAGE, missing(workflow_text(name, '9a07604^')))


class HeadlessBrowserTests(unittest.TestCase):
    """Every workflow a user's repo calls that reads web pages (a search, the scout, employer discovery) installs the headless browser in
    the run (owner, 19 Oct 2026: script-built job boards are read headlessly wherever the search runs; never in the app's installer)."""
    def test_every_users_workflow_that_reads_pages_installs_the_browser(self):
        reading = [path for path in sorted(WORKFLOWS.glob('*.yml')) if 'workflow_call' in path.read_text()
                   and re.search(r'python -m src (daily|scout|discover)\b', path.read_text())]
        self.assertGreaterEqual({path.name for path in reading}, {'daily.yml', 'scout.yml'})
        for path in reading:
            with self.subTest(workflow=path.name):
                text = path.read_text()
                self.assertIn('pip install --quiet -r requirements-render.txt', text)
                self.assertIn('./.github/actions/playwright-browser', text)   # the shared cached install (tests/test_playwright_install_action.py)



FAKE_NOTION = r'''
import json, sys, urllib.request
PAGE = "## Roles to look for\n- zebra wrangler\n## Companies to skip\n- Initech\n"
class Resp:
    def __init__(self, body): self.body = json.dumps(body).encode()
    def read(self): return self.body
    def __enter__(self): return self
    def __exit__(self, *a): return False
import src.notion.client as client
client.Tracker.page_text = lambda self, page_id=None: ("Format 2\n" + PAGE) if page_id == "SETTINGS-PAGE" else ""
from src.notion import search_settings
search_settings.sync_quietly()
print(json.dumps({"page_id": search_settings.PAGE_ID}))
'''


class EngineAsTheWorkflowRunsItTests(unittest.TestCase):
    """Only the env the workflow provides, no app folder, the "Your settings" copy simulated."""

    def run_engine(self, text):
        repo_vars = {SEARCH_PAGE: 'SETTINGS-PAGE', 'NOTION_PROFILE_PAGE_ID': 'PROFILE', 'NOTION_APPLICATIONS_DB': 'APPS'}
        env = {k: v for k, v in os.environ.items() if k in ('PATH', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'SYSTEMROOT', 'TMPDIR', 'PYTHONUTF8')}   # Path.home() on Windows reads USERPROFILE
        env.update({'GITHUB_ACTIONS': 'true', 'NOTION_TOKEN': 'secret-for-test'})
        for name, source in passed_names(text).items():
            if source in repo_vars and name not in env:
                env[name] = repo_vars[source]
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / 'config'
            config.mkdir()
            user = json.loads((ROOT / 'tests' / 'fixtures' / 'config' / 'search.json').read_text())
            user['role_keywords'] = ['copied from your settings repo']
            (config / 'search.json').write_text(json.dumps(user))  # the "Your settings" copy step
            (config / 'preferences.json').write_text(json.dumps({'excluded_companies': ['Copied Corp']}))
            env['JOBADABRA_CONFIG_DIR'] = str(config)
            done = subprocess.run([sys.executable, '-c', FAKE_NOTION], cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stderr)
            return (json.loads(done.stdout.strip().splitlines()[-1]), json.loads((config / 'search.json').read_text()),
                    json.loads((config / 'preferences.json').read_text()))

    def test_the_notion_page_overrides_the_copied_config(self):
        for name in ('daily.yml', 'scout.yml'):
            with self.subTest(workflow=name):
                seen, search, prefs = self.run_engine(workflow_text(name))
                self.assertEqual(seen['page_id'], 'SETTINGS-PAGE')
                self.assertEqual(search['role_keywords'], ['zebra wrangler'])
                self.assertEqual(prefs['excluded_companies'], ['Initech'])

    def test_without_the_variable_the_copied_config_wins_which_was_the_bug(self):
        for name in ('daily.yml', 'scout.yml'):
            with self.subTest(workflow=name):
                seen, search, _ = self.run_engine(workflow_text(name, '9a07604^'))
                self.assertEqual(seen['page_id'], '')
                self.assertEqual(search['role_keywords'], ['copied from your settings repo'])


if __name__ == '__main__':
    unittest.main()
