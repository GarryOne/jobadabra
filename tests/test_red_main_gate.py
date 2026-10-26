"""No beta while main's e2e is red (tools/red-main-gate.sh, gate G2, 26 Oct 2026: beta 2 started 1.5 h after main went red on the same suites)."""
import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATE = ROOT / 'tools/red-main-gate.sh'
RED_SHA, NEW_SHA = 'f' * 40, 'e' * 40

FAKE_GH = r'''#!/usr/bin/env python3
# a fake gh: main's e2e runs and their jobs, main's head, a dispatch of the re-check and its result
import json, os, sys
state = os.environ['FAKE_GH']
data = json.load(open(os.path.join(state, 'data.json')))
args = sys.argv[1:]
log = open(os.path.join(state, 'calls'), 'a'); log.write(' '.join(args) + '\n'); log.close()
dispatched = os.path.exists(os.path.join(state, 'dispatched'))
if args[:2] == ['workflow', 'run']:
    open(os.path.join(state, 'dispatched'), 'w').write(' '.join(args)); sys.exit(0)
endpoint = args[1]
if 'workflows/e2e.yml/runs?branch=main&status=completed' in endpoint:
    runs = list(data['runs'])
    if dispatched and data.get('recheck') == 'success': runs.insert(0, {'id': 99, 'display_title': 'E2E Mac + Linux · x · main', 'conclusion': 'success', 'head_sha': data['head'], 'head_branch': 'main'})
    print(json.dumps(runs))
elif endpoint.endswith('/jobs?per_page=100'):
    rid = endpoint.split('/runs/')[1].split('/')[0]
    print(json.dumps(data['jobs'].get(rid, data['recheck_jobs'] if rid == '99' else [])))
elif endpoint.endswith('commits/main'):
    print(data['head'])
elif 'event=workflow_dispatch' in endpoint:
    if dispatched: print(99)
elif endpoint.endswith('/actions/runs/99'):
    print('completed ' + data['recheck'])
else:
    sys.exit(2)
'''

RED_RUN = {'id': 2, 'display_title': 'E2E check · on time (Worker cron)', 'conclusion': 'failure', 'head_sha': RED_SHA, 'head_branch': 'main', 'html_url': 'u2', 'created_at': 't2'}
RED_JOBS = {'2': [{'name': 'cardstates', 'conclusion': 'failure'}, {'name': 'settings', 'conclusion': 'failure'}, {'name': 'jobs', 'conclusion': 'success'}]}


def gate(data, *extra):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / 'bin').mkdir()
        gh = tmp / 'bin/gh'
        gh.write_text(FAKE_GH)
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        (tmp / 'data.json').write_text(json.dumps({'recheck_jobs': [{'name': 'cardstates', 'conclusion': 'success'}, {'name': 'settings', 'conclusion': 'success'}], **data}))
        env = {**os.environ, 'PATH': f"{tmp / 'bin'}{os.pathsep}{os.environ['PATH']}", 'FAKE_GH': str(tmp), 'RED_MAIN_POLL': '0', 'RED_MAIN_FIND_S': '2', 'RED_MAIN_WAIT_S': '2'}
        proc = subprocess.run(['bash', str(GATE), 'o/r', *extra], env=env, capture_output=True, text=True, timeout=120)
        dispatch = (tmp / 'dispatched').read_text() if (tmp / 'dispatched').exists() else ''
        return proc.returncode, proc.stdout + proc.stderr, dispatch


class RedMainGate(unittest.TestCase):
    def test_green_main_lets_the_beta_go(self):
        code, out, dispatch = gate({'runs': [{**RED_RUN, 'conclusion': 'success'}], 'jobs': {'2': [{'name': 'cardstates', 'conclusion': 'success'}]}, 'head': RED_SHA})
        self.assertEqual(code, 0, out)
        self.assertEqual(dispatch, '')

    def test_red_with_no_commit_since_refuses_without_a_rerun(self):
        code, out, dispatch = gate({'runs': [RED_RUN], 'jobs': RED_JOBS, 'head': RED_SHA})
        self.assertEqual(code, 1, out)
        self.assertIn('cardstates', out)
        self.assertIn('No commit on main since', out)
        self.assertEqual(dispatch, '', 'nothing changed: a re-run would show the same reds')

    def test_red_with_fixes_since_reruns_only_the_red_suites_and_goes_on_green(self):
        code, out, dispatch = gate({'runs': [RED_RUN], 'jobs': RED_JOBS, 'head': NEW_SHA, 'recheck': 'success'})
        self.assertEqual(code, 0, out)
        self.assertIn('suite=cardstates,settings', dispatch)
        self.assertNotIn('jobs', dispatch.split('suite=')[1])

    def test_red_rerun_still_red_refuses(self):
        code, out, _ = gate({'runs': [RED_RUN], 'jobs': RED_JOBS, 'head': NEW_SHA, 'recheck': 'failure'})
        self.assertEqual(code, 1, out)
        self.assertIn('still red', out)

    def test_force_goes_on_and_names_the_reds(self):
        code, out, dispatch = gate({'runs': [RED_RUN], 'jobs': RED_JOBS, 'head': RED_SHA}, '--force', 'hotfix for testers')
        self.assertEqual(code, 0, out)
        self.assertIn('settings', out)
        self.assertIn('hotfix for testers', out)
        self.assertEqual(dispatch, '')


class BetaRelease(unittest.TestCase):
    def test_beta_release_runs_the_gate_first_and_passes_a_force_reason_on(self):
        text = (ROOT / 'tools/beta-release.sh').read_text()
        self.assertLess(text.index('red-main-gate.sh'), text.index('gh workflow run desktop.yml'), 'the gate decides before the beta is dispatched')
        self.assertIn('-f over_red_main="$force"', text)
        workflow = (ROOT / '.github/workflows/desktop.yml').read_text()
        self.assertIn('over_red_main:', workflow)
        self.assertIn('WHY: ${{ inputs.over_red_main }}', workflow, 'free text reaches the script through env, never inline')


if __name__ == '__main__':
    unittest.main()
