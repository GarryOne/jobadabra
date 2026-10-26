"""Checks that every workflow opening a PR by itself commits with the trailers the Fast checks need and pushes with the App token (19 Oct 2026, #1578)."""
import glob
import os
import re
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BARE_COMMIT = 'git ' + 'commit -q'
BARE_PUSH = 'git push -q ' + 'origin'


def pr_opening_workflows():
    found = {}
    for path in sorted(glob.glob(os.path.join(ROOT, '.github', 'workflows', '*.yml'))):
        text = open(path, encoding='utf-8').read()
        if re.search(r'gh pr create', text):
            found[os.path.basename(path)] = text
    return found


class BotPrChecks(unittest.TestCase):
    def test_the_class_is_not_empty(self):
        self.assertGreaterEqual(len(pr_opening_workflows()), 4)

    def test_each_commits_with_the_trailer_helper(self):
        for name, text in pr_opening_workflows().items():
            with self.subTest(workflow=name):
                self.assertNotIn(BARE_COMMIT, text, f'{name}: commit through tools/bot-commit.sh (the Fast checks need Recorded-unneeded)')
                self.assertIn('tools/bot-commit.sh', text)

    def test_each_pushes_and_opens_with_the_app_token(self):
        for name, text in pr_opening_workflows().items():
            with self.subTest(workflow=name):
                self.assertIn('actions/create-github-app-token@', text)
                self.assertNotIn(BARE_PUSH, text, f'{name}: a GITHUB_TOKEN push starts no checks')
                self.assertRegex(text, r'GH_TOKEN="\$\{PR_TOKEN:-\$GH_TOKEN\}" gh pr create')

    def test_helper_message_passes_the_trailer_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t')
            subprocess.run(['git', 'init', '-q', tmp], check=True)
            with open(os.path.join(tmp, 'f'), 'w') as handle:
                handle.write('x')
            subprocess.run(['git', '-C', tmp, 'add', 'f'], check=True)
            subprocess.run([os.path.join(ROOT, 'tools', 'bot-commit.sh'), 'Fix a thing', 'a unit test proves it'], cwd=tmp, env=env, check=True)
            message = subprocess.run(['git', '-C', tmp, 'log', '-1', '--format=%B'], capture_output=True, text=True, check=True).stdout
            self.assertRegex(message, r'(?m)^Recorded-unneeded: a unit test proves it$')
            self.assertRegex(message, r'(?m)^Pool-row: none \S')
            self.assertRegex(message, r'(?m)^Co-Authored-By: ')
            msg_file = os.path.join(tmp, 'msg')
            with open(msg_file, 'w') as handle:
                handle.write(message)
            self.assertEqual(subprocess.run(['node', os.path.join(ROOT, 'tools', 'commit-trailers.mjs'), msg_file]).returncode, 0)


if __name__ == '__main__':
    unittest.main()
