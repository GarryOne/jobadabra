"""tools/stop-test-check.sh (11 Oct 2026): the Stop hook runs the push gate's affected tests, not whole suites, and only in worktrees this session CHANGED."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK = ROOT / 'tools' / 'stop-test-check.sh'
# The stubs: check.sh logs how it was called (and what the changed-file list was); the picker answers a fixed pick.
CHECK = '''#!/usr/bin/env bash
echo "$PWD|$*|$(printf '%s' "$JOB_PILOTTO_AFFECTED_FILES" | tr '\\n' ',')" >> "$CHECK_LOG"
[ -n "${CHECK_OUT:-}" ] && printf '%s\\n' "$CHECK_OUT"
exit "${CHECK_EXIT:-0}"
'''
PICK = '#!/usr/bin/env python3\nprint(\'{"python": ["test_x"], "desktop": ["test/x.test.js"], "worker": [], "site": []}\')\n'


def git(cwd, *args):
    return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash') and shutil.which('git'), 'needs jq, bash and git')
class StopCheckAffected(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.repo, origin = self.tmp / 'jobadabra', self.tmp / 'origin.git'   # (the hook follows paths of a folder named like the project)
        self.log = self.tmp / 'check.log'
        for folder in ('src', 'app-core', 'tools', 'tests', 'desktop/node_modules', 'desktop/test'):
            (self.repo / folder).mkdir(parents=True)
        (self.repo / 'src' / 'daily.py').write_text('')
        (self.repo / 'app-core' / 'package.json').write_text('{}')
        (self.repo / 'desktop' / 'test' / 'codemap.test.js').write_text("import {test} from 'node:test';\ntest('a new file has a header', () => {});\n")   # an added file runs this one test
        (self.repo / '.gitignore').write_text('node_modules/\n.claude/\n')
        shutil.copy(HOOK, self.repo / 'tools' / 'stop-test-check.sh')
        (self.repo / 'tools' / 'check.sh').write_text(CHECK)
        (self.repo / 'tools' / 'affected-tests.py').write_text(PICK)
        git(self.tmp, 'init', '-q', '--bare', str(origin))
        git(self.repo, 'init', '-q', '-b', 'main')
        git(self.repo, 'config', 'user.email', 't@example.com')
        git(self.repo, 'config', 'user.name', 't')
        git(self.repo, 'add', '-A')
        git(self.repo, 'commit', '-q', '-m', 'base')
        git(self.repo, 'remote', 'add', 'origin', str(origin))
        git(self.repo, 'push', '-q', 'origin', 'main')
        git(self.repo, 'fetch', '-q', 'origin')
        self.base = git(self.repo, 'rev-parse', 'HEAD')

    def worktree(self, name):
        path = self.repo / '.claude' / 'worktrees' / name
        git(self.repo, 'worktree', 'add', '-q', '-b', name, str(path), 'origin/main')
        (path / 'desktop' / 'node_modules').mkdir(parents=True, exist_ok=True)
        return path

    def transcript(self, *calls):
        file = self.tmp / 'transcript.jsonl'
        file.write_text('\n'.join(json.dumps({'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'name': name, 'input': data}]}}) for name, data in calls) + '\n')
        return file

    def stop(self, cwd, transcript=None, **env):
        # a session that did not change anything in its folder gets no test run (11 Oct 2026): these tests are about a session that did
        transcript = transcript or self.transcript(('Edit', {'file_path': str(Path(cwd) / 'tests' / 'test_x.py')}))
        payload = {'cwd': str(cwd), 'transcript_path': str(transcript or ''), 'stop_hook_active': False}
        done = subprocess.run(['bash', str(HOOK)], input=json.dumps(payload), capture_output=True, text=True, cwd=cwd,
                              env={**{k: v for k, v in os.environ.items() if k != 'JOB_PILOTTO_SESSION'}, 'TMPDIR': str(self.tmp), 'STOP_CHECK_SUITES': '1', 'CHECK_LOG': str(self.log), 'CLAUDE_PROJECT_DIR': str(self.repo), **env})
        return done.returncode, done.stdout + done.stderr

    def calls(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def change(self, tree, rel, text='x'):
        (tree / rel).parent.mkdir(parents=True, exist_ok=True)
        (tree / rel).write_text(text)

    def test_a_change_runs_the_affected_pick_with_the_files_including_uncommitted_ones(self):
        self.change(self.repo, 'tests/test_x.py')   # uncommitted: a commit-only diff would miss it
        code, out = self.stop(self.repo)
        self.assertEqual(code, 0, out)
        calls = self.calls()
        self.assertEqual(len(calls), 1, calls)
        self.assertIn(f'--area python --affected-from {self.base}', calls[0])
        self.assertTrue(calls[0].endswith('|tests/test_x.py'), calls[0])

    def test_the_old_whole_suite_run_comes_back_with_stop_check_full(self):
        self.change(self.repo, 'tests/test_x.py')
        self.assertEqual(self.stop(self.repo, STOP_CHECK_FULL='1')[0], 0)
        self.assertNotIn('--affected-from', self.calls()[0])

    def test_a_worktree_the_session_only_read_is_not_tested_but_one_it_edited_is(self):
        other = self.worktree('other')
        self.change(other, 'tests/test_y.py')
        read = self.transcript(('Read', {'file_path': str(other / 'tests' / 'test_y.py')}), ('Bash', {'command': f'cd {other} && npm test'}))
        self.assertEqual(self.stop(self.repo, read)[0], 0)
        self.assertEqual(self.calls(), [], 'read and test runs are not changes')
        edited = self.transcript(('Edit', {'file_path': str(other / 'tests' / 'test_y.py')}))
        self.assertEqual(self.stop(self.repo, edited)[0], 0)
        self.assertEqual(len(self.calls()), 1)
        self.assertIn(str(other.resolve()) if str(other.resolve()) in self.calls()[0] else str(other), self.calls()[0])


if __name__ == '__main__':
    unittest.main()
