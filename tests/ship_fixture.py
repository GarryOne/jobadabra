"""The fixture of tools/ship.sh's tests: a throwaway origin with a stub push hook, a worktree, and the helpers both test files share (setUp, change, ship).
Tests: test_ship.py (the landing steps: rebase, refusal, checkout update, markers) and test_ship_background.py (--background, kills, the extension version at ship time). Not a test module (no test_ prefix)."""
import os
import re
import signal
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def git(cwd, *args, check=True):
    return subprocess.run(['git', *args], cwd=cwd, check=check, capture_output=True, text=True).stdout.strip()


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class ShipFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.origin, self.main, self.other = self.tmp / 'origin.git', self.tmp / 'main', self.tmp / 'other'
        subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', str(self.origin)], check=True)
        (self.main / 'tools').mkdir(parents=True)
        for name in ('ship.sh', 'worktree.sh', 'recheck-needed.py', 'affected-tests.py', 'wait-build-tag.sh', 'ship-timeline.sh', 'session-name.sh', 'red-main.sh', 'ship-red.sh', 'ship-pr.sh', 'pr-body.sh', 'pr-title.sh', 'pr-body-format.py', 'pr-body-check.py', 'pr-screens.py', 'ship-watch.sh', 'pr-conflict-fix.sh', 'pr-rest-lib.sh', 'pr-comments-lib.sh'):
            shutil.copy(ROOT / 'tools' / name, self.main / 'tools' / name)
        self.hook = self.main / 'tools' / 'pre-push-check.sh'
        self.hook.write_text('#!/bin/sh\ncat > /dev/null\n')   # the real hook has its own tests; here it only has to be asked
        (self.main / 'a.txt').write_text('a\n')
        git(self.main, 'init', '-q', '-b', 'main')
        for key, value in (('user.email', 't@example.com'), ('user.name', 'Test')):
            git(self.main, 'config', key, value)
        git(self.main, 'add', '-A')
        git(self.main, 'commit', '-qm', 'Start')
        git(self.main, 'remote', 'add', 'origin', str(self.origin))
        git(self.main, 'push', '-q', 'origin', 'main')
        subprocess.run(['git', 'clone', '-q', self.origin.as_uri(), str(self.other)], check=True)   # file:// (the pack protocol): a plain-path clone copies origin's pack folder while the push's background gc writes in it (CI, 12 Oct 2026)
        for key, value in (('user.email', 't@example.com'), ('user.name', 'Test')):
            git(self.other, 'config', key, value)
        self.tree = Path(git(self.main, 'rev-parse', '--show-toplevel')) / '.claude' / 'worktrees' / 'topic'
        subprocess.run(['sh', str(self.main / 'tools' / 'worktree.sh'), 'topic'], cwd=self.main, check=True, capture_output=True)

    def change(self, where, name, text, subject):
        (where / name).write_text(text)
        git(where, 'add', name)
        git(where, 'commit', '-qm', subject)

    def ship(self, *flags):
        return subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh'), *flags], cwd=self.tree, capture_output=True, text=True, timeout=60)
