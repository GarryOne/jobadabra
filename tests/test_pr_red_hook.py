"""tools/pr-red-check.sh + tools/pr-red-ack.sh (18 Oct 2026, #1321 sat red for hours): a session whose open PR has a red check is told at every prompt and blocked once at Stop,
unless it said it is blocked; green, running, merged, no gh, a slow gh and the branch main are silent. A fake `gh` answers from files; the hook is registered in .claude/settings.json."""
import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK, ACK = ROOT / 'tools' / 'pr-red-check.sh', ROOT / 'tools' / 'pr-red-ack.sh'
FAKE = """#!/bin/sh
d="$FAKE_GH_DIR"; first="$1"; echo "$@" >> "$d/calls"; [ ! -f "$d/slow" ] || sleep 5
expr=""; while [ $# -gt 0 ]; do [ "$1" = --jq ] && expr="$2"; shift; done
if [ "$first" = issue ]; then [ -f "$d/issues.json" ] && jq -r "$expr" "$d/issues.json"; exit 0; fi
if [ "$first" = api ]; then [ -f "$d/api.json" ] && jq -r "$expr" "$d/api.json"; exit 0; fi
case "$FAKE_GH_VERB" in list) jq -r "$expr" "$d/list.json" ;; view) jq -r "$expr" "$d/view.json" ;; esac
"""
FAKE_BIN = """#!/bin/sh
export FAKE_GH_VERB="$2"; exec "$FAKE_GH_REAL" "$@"
"""


def pr(*checks, mergeable='MERGEABLE'):  # (name, conclusion) -> a `gh pr list` answer for PR #5
    return [{'number': 5, 'mergeable': mergeable, 'statusCheckRollup': [{'name': n, 'conclusion': c, 'status': 'COMPLETED', 'detailsUrl': f'https://ci.test/{n}'} for n, c in checks]}]


@unittest.skipUnless(shutil.which('jq') and shutil.which('git') and shutil.which('bash'), 'needs jq, git and bash')
class PrRedHookTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.repo = self.tmp / 'repo'
        subprocess.run(['git', 'init', '-q', '-b', 'feature', str(self.repo)], check=True)
        (self.tmp / 'bin').mkdir()
        (self.tmp / 'real-gh').write_text(FAKE)
        gh = self.tmp / 'bin' / 'gh'
        gh.write_text(FAKE_BIN)
        for f in (gh, self.tmp / 'real-gh'): f.chmod(f.stat().st_mode | stat.S_IEXEC)
        self.state = self.tmp / 'state'; self.state.mkdir()
        self.env = {**os.environ, 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.state), 'FAKE_GH_REAL': str(self.tmp / 'real-gh'),
                    'PR_RED_DIR': str(self.tmp / 'cache'), 'PR_RED_TTL': '0', 'PR_RED_WAIT': '10'}
        self.env.pop('JOB_PILOTTO_SESSION', None)
        red_main = self.tmp / 'red-main.sh'   # main's verdict (tools/red-main.sh) from a file: unknown unless a test writes one
        red_main.write_text('#!/bin/sh\n[ "$RED_MAIN_NO_RERUN" = 1 ] || echo "rerun allowed" >> "$FAKE_GH_DIR/calls"\ncat "$FAKE_GH_DIR/red-main" 2>/dev/null || echo unknown\n')
        self.env['PR_RED_MAIN_SCRIPT'] = str(red_main)

    def answer(self, prs, view=None):
        (self.state / 'list.json').write_text(json.dumps(prs))
        (self.state / 'view.json').write_text(json.dumps(view if view is not None else (prs[0] if prs else {})))

    def run_hook(self, event='UserPromptSubmit', again=False, env=None, cwd=None, extra=None):
        payload = {'cwd': str(cwd or self.repo), 'hook_event_name': event, 'stop_hook_active': again, **(extra or {})}
        return subprocess.run(['bash', str(HOOK)], input=json.dumps(payload), capture_output=True, text=True, env={**self.env, **(env or {})}, timeout=30)

    # Gate G2b (26 Oct 2026): a red-main issue names the breaking PR's branch; the session on that branch is told, others are not.
    def test_red_main_issue_tells_the_session_whose_branch_broke_it(self):
        self.answer([])
        body = 'Main\'s `cardstates` e2e suite is red since fdc31ca.\nBreaking PR: #1914 (branch `feature`)\nBisect: ...'
        (self.state / 'issues.json').write_text(json.dumps([{'number': 1970, 'title': 'Red main: cardstates', 'body': body},
                                                           {'number': 1971, 'title': 'Red main: settings', 'body': 'Breaking PR: #1900 (branch `other-branch`)'},
                                                           {'number': 1972, 'title': 'Red main: foryou', 'body': 'no PR found: the range is in the issue'}]))
        out = self.run_hook()
        self.assertIn("Main's e2e suite cardstates went red with your PR #1914 (issue #1970)", out.stdout)
        self.assertNotIn('settings', out.stdout)
        self.assertNotIn('foryou', out.stdout)
        stop = self.run_hook(event='Stop')
        self.assertEqual(stop.returncode, 2, 'blocks the stop once, like a red PR')
        self.assertIn('cardstates', stop.stderr)

    # 26 Oct 2026: build.yml's call asked for a permission it did not grant; GitHub refused "CI · Tests" on every push for an hour (startup_failure) and no session
    # heard of it. The session whose PR broke it is told and stopped once; every other session is told at its prompts that main runs no tests.
    REFUSED = 'red|771c9fe|CI · Tests did not start (startup_failure)|https://github.com/o/r/actions/runs/9|2026-10-26T04:59:26Z|9'

    def test_a_refused_main_tells_the_session_whose_pr_broke_it_and_stops_it_once(self):
        self.answer([])
        (self.state / 'red-main').write_text(self.REFUSED + '\n')
        (self.state / 'api.json').write_text(json.dumps([{'number': 2051, 'head': {'ref': 'feature'}}]))
        out = self.run_hook()
        self.assertIn("Main's CI · Tests did not start (startup_failure) since your PR #2051 (771c9fe)", out.stdout)
        self.assertIn('https://github.com/o/r/actions/runs/9', out.stdout)
        self.assertEqual(self.run_hook(event='Stop').returncode, 2)
        self.assertNotIn('rerun allowed', (self.state / 'calls').read_text() if (self.state / 'calls').exists() else '', 'a hook never re-runs a CI run')

    def test_a_refused_main_tells_every_other_session_at_its_prompt_only(self):
        self.answer([])
        (self.state / 'red-main').write_text(self.REFUSED + '\n')
        (self.state / 'api.json').write_text(json.dumps([{'number': 2051, 'head': {'ref': 'other-branch'}}]))
        out = self.run_hook()
        self.assertIn("Main's CI · Tests did not start (startup_failure) since 771c9fe (PR #2051, branch other-branch): main runs no tests", out.stdout)
        self.assertIn('tools/revert-red.sh 771c9fe', out.stdout)
        self.assertEqual(self.run_hook(event='Stop').returncode, 0, 'not this session\'s to fix: its stop is not blocked')

    def test_an_ordinary_red_main_is_left_to_ship_and_the_issues(self):
        self.answer([])
        (self.state / 'red-main').write_text('red|abc1234|CI · Tests|https://x/runs/1|2026-10-26T04:59:26Z|1\n')
        self.assertEqual(self.run_hook().stdout, '')

    def test_no_red_main_issue_is_silent(self):
        self.answer([])
        (self.state / 'issues.json').write_text('[]')
        self.assertEqual(self.run_hook().stdout, '')

    # --- the case table: (name, PR answer, expected text in the message or None for silence)
    def test_cases(self):
        cases = [
            ('green', pr(('python', 'SUCCESS'), ('desktop', 'SUCCESS')), None),
            ('running', pr(('python', 'SUCCESS'), ('desktop', None)), None),
            ('cancelled by a newer push is no red', pr(('desktop', 'CANCELLED')), None),
            ('no open PR', [], None),
            ('red', pr(('python', 'SUCCESS'), ('desktop (windows-latest)', 'FAILURE'), ('desktop (ubuntu-24.04)', 'FAILURE')), 'PR #5 is red: desktop (ubuntu-24.04), desktop (windows-latest) https://ci.test/desktop (windows-latest); fix it now'),
            ('timed out is red', pr(('e2e', 'TIMED_OUT')), 'PR #5 is red: e2e'),
        ]
        for event in ('UserPromptSubmit', 'Stop'):
            for name, prs, expect in cases:
                with self.subTest(event=event, case=name):
                    shutil.rmtree(self.tmp / 'cache', True)
                    self.answer(prs)
                    done = self.run_hook(event)
                    text = done.stdout if event == 'UserPromptSubmit' else done.stderr
                    if expect is None:
                        self.assertEqual((done.returncode, done.stdout, done.stderr), (0, '', ''))
                    else:
                        self.assertEqual(done.returncode, 0 if event == 'UserPromptSubmit' else 2, done.stderr)
                        self.assertIn(expect, text)
                        self.assertIn('tools/pr-red-ack.sh 5', text)

    def test_conflict_cases(self):
        cases = [
            ('conflicting, checks green', pr(('python', 'SUCCESS'), mergeable='CONFLICTING'), ['PR #5 conflicts with main: rebase now'], ['is red']),
            ('conflicting, no checks yet', pr(mergeable='CONFLICTING'), ['PR #5 conflicts with main: rebase now'], ['is red']),
            ('conflicting and red', pr(('python', 'FAILURE'), mergeable='CONFLICTING'), ['PR #5 is red: python', 'PR #5 conflicts with main'], []),
            ('unknown is silent', pr(('python', 'SUCCESS'), mergeable='UNKNOWN'), None, None),
            ('mergeable is silent', pr(('python', 'SUCCESS'), mergeable='MERGEABLE'), None, None),
        ]
        for event in ('UserPromptSubmit', 'Stop'):
            for name, prs, expect, absent in cases:
                with self.subTest(event=event, case=name):
                    shutil.rmtree(self.tmp / 'cache', True)
                    self.answer(prs)
                    done = self.run_hook(event)
                    text = done.stdout if event == 'UserPromptSubmit' else done.stderr
                    if expect is None:
                        self.assertEqual((done.returncode, done.stdout, done.stderr), (0, '', ''))
                        continue
                    self.assertEqual(done.returncode, 0 if event == 'UserPromptSubmit' else 2, done.stderr)
                    for want in expect: self.assertIn(want, text)
                    for no in absent: self.assertNotIn(no, text)
                    self.assertIn('tools/pr-red-ack.sh 5', text)

    def test_a_conflict_blocks_one_stop_and_an_ack_holds_until_it_changes(self):
        self.answer(pr(('python', 'SUCCESS'), mergeable='CONFLICTING'))
        self.assertEqual(self.run_hook('Stop').returncode, 2)
        self.assertEqual(self.run_hook('Stop', again=True).returncode, 0, 'a second stop in the same chain goes through')
        ack = subprocess.run(['bash', str(ACK), '5', 'parent not merged yet'], cwd=self.repo, capture_output=True, text=True, env=self.env)
        self.assertIn('acknowledged', ack.stdout, ack.stderr)
        self.assertEqual((self.run_hook('Stop').returncode, self.run_hook().stdout), (0, ''))
        self.answer(pr(('python', 'FAILURE'), mergeable='CONFLICTING'))
        self.assertEqual(self.run_hook('Stop').returncode, 2, 'a red check on top of the acknowledged conflict is a new problem')

    def test_stop_blocks_once_per_chain(self):
        self.answer(pr(('python', 'FAILURE')))
        self.assertEqual(self.run_hook('Stop').returncode, 2)
        self.assertEqual(self.run_hook('Stop', again=True).returncode, 0, 'a second stop in the same chain goes through: never a loop')

    def test_merged_pr_is_not_listed_so_it_is_silent(self):
        self.answer([])   # `--state open` returns nothing for a merged or closed PR
        self.assertEqual(self.run_hook('Stop').returncode, 0)
        self.assertIn('--state open', (self.state / 'calls').read_text())

    def test_acknowledged_red_is_silent_until_the_red_set_changes(self):
        self.answer(pr(('python', 'FAILURE')))
        ack = subprocess.run(['bash', str(ACK), '5', 'needs the owner'], cwd=self.repo, capture_output=True, text=True, env=self.env)
        self.assertEqual(ack.returncode, 0, ack.stderr)
        self.assertEqual((self.run_hook('Stop').returncode, self.run_hook().stdout), (0, ''))
        self.answer(pr(('python', 'FAILURE'), ('desktop', 'FAILURE')))
        self.assertEqual(self.run_hook('Stop').returncode, 2, 'another red check is a new problem')

    def test_ack_without_a_red_check_writes_nothing(self):
        self.answer(pr(('python', 'SUCCESS')))
        ack = subprocess.run(['bash', str(ACK), '5', 'x'], cwd=self.repo, capture_output=True, text=True, env=self.env)
        self.assertIn('nothing to acknowledge', ack.stdout)
        self.assertFalse((self.tmp / 'cache' / 'ack-5').exists())

    def test_the_branch_main_is_not_looked_up(self):
        subprocess.run(['git', '-C', str(self.repo), 'checkout', '-q', '-b', 'main'], check=True)
        self.answer(pr(('python', 'FAILURE')))
        self.assertEqual(self.run_hook('Stop').returncode, 0)
        self.assertFalse((self.state / 'calls').exists())

    def test_gh_missing_is_silent(self):
        nogh = self.tmp / 'nogh'; nogh.mkdir()   # every tool on PATH except gh (bash itself may live next to gh)
        for folder in self.env['PATH'].split(os.pathsep):
            if folder == str(self.tmp / 'bin') or not os.path.isdir(folder): continue
            for entry in os.scandir(folder):
                if entry.name != 'gh' and not (nogh / entry.name).exists() and os.access(entry.path, os.X_OK):
                    try: (nogh / entry.name).symlink_to(entry.path)
                    except OSError: pass
        done = self.run_hook('Stop', env={'PATH': str(nogh)})
        self.assertEqual((done.returncode, done.stdout, done.stderr), (0, '', ''))

    def test_a_slow_gh_is_skipped_within_about_two_seconds(self):
        (self.state / 'slow').write_text('x')
        self.answer(pr(('python', 'FAILURE')))
        done = self.run_hook('Stop', env={'PR_RED_WAIT': '5'})
        self.assertEqual((done.returncode, done.stderr), (0, ''))

    def test_the_answer_is_cached_between_prompt_and_stop(self):
        self.answer(pr(('python', 'FAILURE')))
        self.run_hook(env={'PR_RED_TTL': '60'}); self.run_hook('Stop', env={'PR_RED_TTL': '60'})
        self.assertEqual((self.state / 'calls').read_text().count('pr list'), 1)

    def test_the_worktree_it_shipped_from_is_checked_too(self):
        work = self.repo / '.claude' / 'worktrees' / 'topic'
        subprocess.run(['git', '-C', str(self.repo), '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x'], check=True)
        subprocess.run(['git', '-C', str(self.repo), 'worktree', 'add', '-q', '-b', 'topic', str(work)], check=True)
        transcript = self.tmp / 't.jsonl'
        transcript.write_text(json.dumps({'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'name': 'Bash', 'input': {'command': f'cd {work} && tools/ship.sh --background'}}]}}) + '\n')
        (self.state / 'list.json').write_text(json.dumps(pr(('python', 'FAILURE')))); (self.state / 'view.json').write_text('{}')
        done = self.run_hook('Stop', extra={'transcript_path': str(transcript)}, cwd=self.repo)
        self.assertEqual(done.returncode, 2)
        self.assertIn('--head topic', (self.state / 'calls').read_text())


class PrRedHookRegistered(unittest.TestCase):
    def test_it_is_registered_for_prompt_and_stop(self):
        hooks = json.loads((ROOT / '.claude/settings.json').read_text())['hooks']
        for event in ('UserPromptSubmit', 'Stop'):
            commands = [h['command'] for entry in hooks[event] for h in entry['hooks']]
            self.assertTrue(any(c.endswith('tools/pr-red-check.sh') for c in commands), (event, commands))

    def test_the_rule_is_written_where_sessions_read_it(self):
        for path in ('AGENTS.md', 'CLAUDE.md'):
            text = (ROOT / path).read_text()
            self.assertIn('tools/pr-red-check.sh', text, path)
            self.assertIn('tools/pr-red-ack.sh', text, path)
        self.assertIn('pr-red-check', (ROOT / 'docs/rules/change-loop.md').read_text())

    def test_the_scripts_are_executable_and_say_what_they_are_for(self):
        for script in (HOOK, ACK):
            self.assertTrue(os.access(script, os.X_OK), script)


if __name__ == '__main__':
    unittest.main()
