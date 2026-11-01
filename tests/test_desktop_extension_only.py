"""jobadabra is the desktop app and the extension, nothing else (owner, 1 Nov 2026: "jobadabra should have no web, no worker" ... "it should be strictly
desktop and extension"). No server folder and no server-only workflow may appear in this repo. What is still here is in the two allowlists below; they only
shrink: each move PR (spec docs/superpowers/specs/2026-11-01-desktop-extension-only.md) deletes its entries, and an entry that matches nothing fails too."""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = '.github/workflows/'

# Top-level folders that hold server code. A folder here may exist only while ALLOWED_FOLDERS names it.
SERVER_FOLDERS = ('worker', 'workers', 'hosted', 'site', 'site-next', 'api', 'server', 'functions')
# Workflows that deploy or run a server by name (the content check below catches a new deploy by itself).
SERVER_WORKFLOWS = ('worker.yml', 'ready-fill-image.yml', 'central-scout.yml', 'product-brain.yml', 'ai-cost-billed.yml')
DEPLOY_MARK = re.compile(r'wrangler|docker (build|buildx)|docker/build-push|CLOUDFLARE_API_TOKEN')

# Left to move, with the PR that removes the entry (spec "Plan").
ALLOWED_FOLDERS = {
    'worker': 'PR 2 renames worker/src + worker/test to app-core; PR 4 removes the deploy shell (wrangler.toml, scripts, package.json)',
    'hosted': 'PR 5 moves the shared ready-fill to desktop/ready-fill and the Dockerfiles + main.mjs + image-check.mjs to jobadabra-web',
}
ALLOWED_WORKFLOWS = {
    'worker.yml': 'PR 4: the bot Worker deploys from jobadabra-web',
    'ready-fill-image.yml': 'PR 5: the image builds in jobadabra-web',
    'central-scout.yml': 'PR 6: jobadabra-lab',
    'product-brain.yml': 'PR 6: jobadabra-lab',
    'ai-cost-billed.yml': 'PR 6: jobadabra-web',
}


def tracked():
    out = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [line for line in out.splitlines() if (ROOT / line).exists()]


def server_workflows(files):
    found = set()
    for path in files:
        if path.startswith(WORKFLOWS) and path.endswith(('.yml', '.yaml')) and '/' not in path[len(WORKFLOWS):]:
            name = path[len(WORKFLOWS):]
            if name in SERVER_WORKFLOWS or DEPLOY_MARK.search((ROOT / path).read_text(errors='ignore')):
                found.add(name)
    return found


class DesktopExtensionOnlyTests(unittest.TestCase):
    def test_no_server_folder_beyond_the_allowlist(self):
        folders = {path.split('/')[0] for path in tracked() if '/' in path}
        new = sorted(f for f in folders if f in SERVER_FOLDERS and f not in ALLOWED_FOLDERS)
        self.assertEqual(new, [], 'jobadabra is desktop + extension only: a server folder belongs in jobadabra-web (private) or jobadabra-lab')

    def test_no_server_workflow_beyond_the_allowlist(self):
        new = sorted(server_workflows(tracked()) - set(ALLOWED_WORKFLOWS))
        self.assertEqual(new, [], 'a workflow that deploys or runs a server belongs in jobadabra-web or jobadabra-lab, not here')

    def test_the_allowlists_only_shrink(self):
        files = tracked()
        folders = {path.split('/')[0] for path in files if '/' in path}
        stale = sorted(f for f in ALLOWED_FOLDERS if f not in folders) + sorted(w for w in ALLOWED_WORKFLOWS if w not in server_workflows(files))
        self.assertEqual(stale, [], 'moved already: delete these entries from the allowlists in tests/test_desktop_extension_only.py')


if __name__ == '__main__':
    unittest.main()
