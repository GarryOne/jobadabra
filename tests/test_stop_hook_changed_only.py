"""The Stop hook tests only a worktree this session changed (11 Oct 2026, the owner: "this shouldn't happen by default, on local"): the folder the session runs in counts only when the transcript shows a change there; a failure names the failing tests and keeps the logs."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK = ROOT / 'tools' / 'stop-test-check.sh'


@unittest.skipUnless(shutil.which('bash') and shutil.which('jq') and shutil.which('git'), 'needs bash, jq and git')
class StopHookChangedOnlyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.repo = self.tmp / 'jobadabra'   # the hook only follows paths of this project (a folder named like it)
        for d in ('src', 'app-core', 'tools', 'tests', 'desktop'):
            (self.repo / d).mkdir(parents=True)
        (self.repo / 'src' / 'daily.py').write_text('x = 1\n')
        for name in ('stop-test-check.sh', 'gate-cache.sh', 'check-slot.sh', 'test-log-failures.sh'):
            shutil.copy(ROOT / 'tools' / name, self.repo / 'tools' / name)
        self.marker = self.tmp / 'ran'
        (self.repo / 'tools' / 'check.sh').write_text(f'#!/bin/bash\necho "$@" >> {self.marker.as_posix()}\nif [ -n "$STOP_FAIL" ]; then echo "# fail 1"; echo "  ✖ the broken test (4.2ms)"; exit 1; fi\n')
        git = lambda *a: subprocess.run(['git', '-C', str(self.repo), '-c', 'user.email=t@t', '-c', 'user.name=t', *a], check=True, capture_output=True, text=True)
        git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-qm', 'start'); git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        (self.repo / 'desktop' / 'node_modules').mkdir(parents=True)
        (self.repo / 'desktop' / 'lib.js').write_text('1\n')
        (self.repo / 'src' / 'daily.py').write_text('x = 2\n')   # an uncommitted change: the hook would test it if the session had made it
        self.env = {**os.environ, 'TMPDIR': str(self.tmp), 'JOBADABRA_CHECK_SLOTS': '0', 'STOP_CHECK_SUITES': '1'}   # the suites (off by default since 13 Oct 2026)
        self.env.pop('JOBADABRA_SESSION', None)

    def stop(self, transcript_lines, **env):
        transcript = self.tmp / 'transcript.jsonl'
        transcript.write_text('\n'.join(json.dumps(line) for line in transcript_lines) + '\n')
        payload = json.dumps({'cwd': str(self.repo), 'transcript_path': str(transcript)})
        return subprocess.run(['bash', str(self.repo / 'tools' / 'stop-test-check.sh')], input=payload, capture_output=True, text=True, timeout=120, env={**self.env, **env})

    @staticmethod
    def edit(path):
        return {'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'name': 'Edit', 'input': {'file_path': str(path)}}]}}

    def test_a_session_that_changed_nothing_in_its_folder_gets_no_test_run(self):
        result = self.stop([{'type': 'user', 'message': 'ran a pool run'}])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.marker.exists(), 'nothing was run for a folder this session did not change')

    def test_a_session_that_edited_a_file_in_it_gets_its_tests_run(self):
        result = self.stop([self.edit(self.repo / 'src' / 'daily.py')])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.marker.exists(), 'its own change is tested')

    def test_the_old_cwd_always_rule_is_one_switch_away(self):
        self.stop([{'type': 'user', 'message': 'x'}], STOP_CHECK_CWD='1')
        self.assertTrue(self.marker.exists())

    def test_a_failure_names_the_failing_tests_and_keeps_the_logs(self):
        result = self.stop([self.edit(self.repo / 'desktop' / 'lib.js')], STOP_FAIL='1')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('Failing tests:', result.stderr)
        self.assertIn('the broken test', result.stderr)
        kept = [l for l in result.stderr.splitlines() if l.startswith('Full logs kept in ') and l.endswith('-desktop')]
        self.assertEqual(len(kept), 1, result.stderr)
        self.assertTrue(Path(kept[0].split(' in ', 1)[1]).is_dir(), 'the path in the message exists')

    def test_a_change_that_already_landed_on_main_is_not_tested_again(self):
        git = lambda *a: subprocess.run(['git', '-C', str(self.repo), '-c', 'user.email=t@t', '-c', 'user.name=t', *a], check=True, capture_output=True, text=True).stdout.strip()
        git('checkout', '-q', '.'); (self.repo / 'desktop' / 'lib.js').unlink(); git('checkout', '-q', '-b', 'work')
        (self.repo / 'src' / 'daily.py').write_text('x = 3\n'); git('add', '-A'); git('commit', '-qm', 'own work')
        git('checkout', '-q', '-b', 'main2', 'main'); (self.repo / 'src' / 'daily.py').write_text('x = 3\n'); git('add', '-A'); git('commit', '-qm', 'the same change, landed')
        git('update-ref', 'refs/remotes/origin/main', 'main2'); git('checkout', '-q', 'work')   # this tree is behind main and its change is already there
        result = self.stop([self.edit(self.repo / 'src' / 'daily.py')])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.marker.exists(), 'landed work is not a change')
        self.stop([self.edit(self.repo / 'src' / 'daily.py')], STOP_CHECK_LANDED='1')
        self.assertTrue(self.marker.exists(), 'the old rule is one switch away')

    def test_text_only_paths_run_nothing(self):
        git = lambda *a: subprocess.run(['git', '-C', str(self.repo), *a], check=True, capture_output=True, text=True)
        git('checkout', '-q', '.')
        (self.repo / 'desktop' / 'lib.js').unlink()
        for rel in ('README.md', 'docs/notes.txt', '.claude/skills/x/SKILL.md'):
            (self.repo / rel).parent.mkdir(parents=True, exist_ok=True); (self.repo / rel).write_text('text\n')
        result = self.stop([self.edit(self.repo / 'README.md'), self.edit(self.repo / '.claude' / 'skills' / 'x' / 'SKILL.md')])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.marker.exists(), 'text only: no test run')


    def test_by_default_a_stop_runs_no_suite(self):
        # Owner, 13 Oct 2026: CI runs every suite on the PR; the hook re-ran them at each stop on a loaded Mac. Default: no suite; STOP_CHECK_SUITES=1 brings them back.
        hook = (Path(__file__).resolve().parent.parent / 'tools' / 'stop-test-check.sh').read_text()
        self.assertIn('[ "${STOP_CHECK_SUITES:-0}" = 1 ] || exit 0', hook)
        payload = json.dumps({'cwd': str(self.repo), 'transcript_path': ''})
        env = {k: v for k, v in self.env.items() if k != 'STOP_CHECK_SUITES'}
        result = subprocess.run(['bash', str(self.repo / 'tools' / 'stop-test-check.sh')], input=payload, capture_output=True, text=True, timeout=30, env=env)
        self.assertEqual((result.returncode, result.stderr.strip()), (0, ''))


if __name__ == '__main__':
    unittest.main()
