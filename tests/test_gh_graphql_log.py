"""tools/bin/gh (owner, 27 Oct 2026, try 3 on "GraphQL runs out": "No GraphQL in our tools"): our tools' gh logs every call GitHub answers through GraphQL
with its session and runs the real gh unchanged; REST calls are not logged. tools/gh-graphql-report.sh counts them. Also: no tool on this Mac still asks GraphQL
for what REST does (tools/pr-rest-lib.sh). A fake real gh answers; no network."""
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHIM = ROOT / 'tools' / 'bin' / 'gh'


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class GhGraphqlLogTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        real = self.tmp / 'real'
        real.mkdir()
        (real / 'gh').write_text('#!/bin/sh\necho "real gh: $*"\n')
        (real / 'gh').chmod(0o755 | stat.S_IEXEC)
        self.log = self.tmp / 'gh-graphql.log'
        self.env = {**os.environ, 'PATH': f'{SHIM.parent}{os.pathsep}{real}{os.pathsep}/usr/bin{os.pathsep}/bin', 'GH_GRAPHQL_LOG': str(self.log), 'JP_SESSION': 'jobadabra-32'}

    def gh(self, *args):
        return subprocess.run(['gh', *args], capture_output=True, text=True, env=self.env, timeout=30)

    def test_a_graphql_call_is_logged_with_its_session_and_still_runs(self):
        done = self.gh('pr', 'view', '5', '--json', 'title')
        self.assertEqual(done.stdout.strip(), 'real gh: pr view 5 --json title', 'the real gh runs with the same arguments')
        time, session, caller, folder, command = self.log.read_text().rstrip('\n').split('\t')
        self.assertRegex(time, r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')
        self.assertEqual((session, command.strip()), ('jobadabra-32', 'pr view'))

    def test_logs_command_identity_without_body_or_token_values(self):
        self.gh('pr', 'edit', '5', '--body', 'PRIVATE-BODY', '--token', 'PRIVATE-TOKEN')
        logged = self.log.read_text()
        self.assertNotIn('PRIVATE-BODY', logged)
        self.assertNotIn('PRIVATE-TOKEN', logged)
        self.assertEqual(logged.rstrip('\n').split('\t')[-1], 'pr edit')

    def test_two_worktree_shims_reach_real_gh_once(self):
        other = self.tmp / 'other-worktree' / 'tools' / 'bin'
        other.mkdir(parents=True)
        shutil.copy2(SHIM, other / 'gh')
        self.env['PATH'] = f'{SHIM.parent}{os.pathsep}{other}{os.pathsep}' + self.env['PATH'].split(os.pathsep, 1)[1]
        self.env['GH_GRAPHQL_LOG'] = 'off'
        done = subprocess.run(['gh', 'api', 'repos/o/r'], capture_output=True, text=True, env=self.env, timeout=2)
        self.assertEqual(done.stdout.strip(), 'real gh: api repos/o/r')

    def test_rest_calls_are_not_logged_and_api_graphql_is(self):
        for args in (('api', 'repos/o/r/pulls/1'), ('run', 'list'), ('api', '-X', 'POST', 'repos/o/r/pulls')):
            self.assertEqual(self.gh(*args).returncode, 0)
        self.assertFalse(self.log.exists(), 'REST is not the GraphQL budget')
        self.gh('api', 'graphql', '-f', 'query=x')
        self.gh('issue', 'list')
        self.assertEqual([line.split('\t')[4].split()[:2] for line in self.log.read_text().splitlines()], [['api', 'graphql'], ['issue', 'list']])

    def test_off_logs_nothing_and_the_report_counts_by_session(self):
        self.env['GH_GRAPHQL_LOG'] = 'off'
        self.gh('pr', 'list')
        self.assertFalse(self.log.exists())
        self.env['GH_GRAPHQL_LOG'] = str(self.log)
        self.gh('pr', 'list')
        self.gh('pr', 'checks', '1')
        report = subprocess.run(['bash', str(ROOT / 'tools' / 'gh-graphql-report.sh'), '1'], capture_output=True, text=True, env=self.env, timeout=30).stdout
        self.assertIn('2 GraphQL calls since', report)
        self.assertRegex(report, r'session jobadabra-32 +2')

    def test_no_tool_asks_graphql_for_what_rest_does(self):
        """Left on purpose: a draft made ready and auto-merge (GraphQL only), the one-off starter publish, and comments or docs that name gh's words."""
        allowed = re.compile(r'gh pr (ready|merge)\b|gh repo (view|create|edit) "\$repo"')
        found = []
        for path in sorted((ROOT / 'tools').rglob('*')):
            if path.suffix not in ('.sh', '.py', '.mjs', '') or not path.is_file() or path.name.endswith('.cases.sh') or path.name in ('pr-body-check.py', 'replay-accept-guard.py'):
                continue
            for n, line in enumerate(path.read_text(errors='replace').splitlines(), 1):
                code = line.split(' # ')[0] if path.suffix != '.mjs' else line
                if line.lstrip().startswith(('#', '//')) or not re.search(r'\bgh (pr|issue|label) |gh repo view|gh api graphql', code) or allowed.search(code):
                    continue
                found.append(f'{path.relative_to(ROOT)}:{n}')
        self.assertEqual(found, [], 'read and write PRs over REST (tools/pr-rest-lib.sh)')


if __name__ == '__main__':
    unittest.main()
