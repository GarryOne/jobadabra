"""No beta while main's e2e is red (tools/red-main-gate.sh, gate G2, 26 Oct 2026: beta 2 started 1.5 h after main went red on the same suites)."""
import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RED_SHA, NEW_SHA = 'f' * 40, 'e' * 40

FAKE_GH = r'''#!/usr/bin/env python3
# a fake gh: main's e2e runs and their jobs, main's head, a dispatch of the re-check and its result
import json, os, sys
state = os.environ['FAKE_GH']
data = json.load(open(os.path.join(state, 'data.json')))
args = sys.argv[1:]
log = open(os.path.join(state, 'calls'), 'a'); log.write(' '.join(args) + '\n'); log.close()
dispatched = os.path.exists(os.path.join(state, 'dispatched'))
if args[:2] == ['run', 'download']:   # gh run download <id> -R repo -n <artifact> -D <dir>: the recorded steps.json of that artifact
    table = data.get('artifacts', {}).get(args[2], {}).get(args[args.index('-n') + 1])
    if table is None: sys.exit(1)
    json.dump(table, open(os.path.join(args[args.index('-D') + 1], 'steps.json'), 'w')); sys.exit(0)
if args[:2] == ['workflow', 'run']:
    open(os.path.join(state, 'dispatched'), 'w').write(' '.join(args)); sys.exit(0)
endpoint = next(a for a in args if a.startswith('repos/'))
if 'workflows/e2e.yml/runs?branch=main&status=completed' in endpoint and data.get('unreadable'):
    sys.exit(1)
elif 'workflows/e2e.yml/runs?branch=main&status=completed' in endpoint:
    runs = list(data['runs'])
    if dispatched and data.get('recheck') == 'success': runs.insert(0, {'id': 99, 'display_title': 'E2E Mac + Linux · x · main', 'conclusion': 'success', 'head_sha': data['head'], 'head_branch': 'main'})
    print(json.dumps(runs))
elif '/artifacts?per_page=100' in endpoint:
    rid = endpoint.split('/runs/')[1].split('/')[0]
    if data.get('artifacts_unreadable'): sys.exit(1)
    print('\n'.join(data.get('artifacts', {}).get(rid, {})))
elif endpoint.endswith('/jobs?per_page=100'):
    rid = endpoint.split('/runs/')[1].split('/')[0]
    print(json.dumps(data['jobs'].get(rid, data['recheck_jobs'] if rid == '99' else [])))
elif '/check-runs/' in endpoint:
    jid = endpoint.split('/check-runs/')[1].split('/')[0]
    print(json.dumps([data.get('annotations', {}).get(jid, [])]))
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


def gate(data, *extra, lanes=None, verdict_tool=None):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / 'bin').mkdir()
        (tmp / 'tools').mkdir()
        for script in ('red-main-gate.sh', 'main_e2e_state.py', 'red-main-verdict.mjs'):
            shutil.copyfile(ROOT / 'tools' / script, tmp / 'tools' / script)
        (tmp / 'desktop/e2e').mkdir(parents=True)
        (tmp / 'desktop/e2e/lib').symlink_to(ROOT / 'desktop/e2e/lib')   # the verdict tool's imports (suite-shards.mjs reads a chain of siblings)
        # The bisect's issue lifecycle is outside this gate test; never reach the real checkout or accounts.
        (tmp / 'tools/e2e_bisect.py').write_text('# Fake issue lifecycle boundary for gate tests.\n')
        if lanes is not None:
            (tmp / 'desktop/e2e').mkdir(parents=True, exist_ok=True)
            (tmp / 'desktop/e2e/lanes.json').write_text(lanes)
        if verdict_tool is not None:   # tools/flaky-verdict.mjs, faked: the real one reads GitHub and git
            (tmp / 'tools/flaky-verdict.mjs').write_text(verdict_tool)
        gh = tmp / 'bin/gh'
        gh.write_text(FAKE_GH)
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        (tmp / 'data.json').write_text(json.dumps({'recheck_jobs': [{'name': 'cardstates', 'conclusion': 'success'}, {'name': 'settings', 'conclusion': 'success'}], **data}))
        env = {**os.environ, 'PATH': f"{tmp / 'bin'}{os.pathsep}{os.environ['PATH']}", 'FAKE_GH': str(tmp), 'RED_MAIN_POLL': '0', 'RED_MAIN_FIND_S': '2', 'RED_MAIN_WAIT_S': '2'}
        proc = subprocess.run(['bash', str(tmp / 'tools/red-main-gate.sh'), 'o/r', *extra], env=env, capture_output=True, text=True, timeout=120)
        dispatch = (tmp / 'dispatched').read_text() if (tmp / 'dispatched').exists() else ''
        return proc.returncode, proc.stdout + proc.stderr, dispatch


class RedMainGate(unittest.TestCase):
    def test_only_suspended_reds_allow_beta_and_are_visible(self):
        lanes = json.dumps({'suites': {suite: {'lane': 'suspended'} for suite in ('cardstates', 'settings')}})
        code, out, dispatch = gate({'runs': [RED_RUN], 'jobs': RED_JOBS, 'head': RED_SHA}, lanes=lanes)
        self.assertEqual(code, 0, out)
        for suite in ('cardstates', 'settings'):
            self.assertIn(f'suspended (owner issue, not blocking): {suite}', out)
        self.assertEqual(dispatch, '')

    def test_a_runner_timeout_is_red_whatever_its_annotations_say(self):
        # Why (31 Oct 2026, owner: a suite past its budget is our bug): no "Grey: the runner, not the app" annotation lets a failed suite pass the gate.
        jobs = {'2': [{'id': 21, 'name': 'apply', 'conclusion': 'failure'}]}
        code, out, dispatch = gate({'runs': [RED_RUN], 'jobs': jobs, 'head': RED_SHA,
                                    'annotations': {'21': [{'title': 'Grey: the runner, not the app'}]}})
        self.assertNotEqual(code, 0, out)
        self.assertNotIn('grey', out)

    def test_suspended_and_tolerant_reds_are_neither_dispatched_nor_blocking(self):
        lanes = json.dumps({'suites': {'cardstates': {'lane': 'suspended'}, 'settings': {'lane': 'tolerant'}}})
        code, out, dispatch = gate({'runs': [RED_RUN], 'jobs': RED_JOBS, 'head': NEW_SHA, 'recheck': 'success'}, lanes=lanes)
        self.assertEqual(code, 0, out)
        self.assertIn('suspended (owner issue, not blocking): cardstates', out)
        self.assertEqual(dispatch, '')
        self.assertNotIn('main is red', out)

    def test_invalid_registry_and_unlisted_reds_still_block(self):
        for lanes in ('{', '{"suites": {"cardstates": {"lane": "suspended"}}}'):
            code, out, dispatch = gate({'runs': [RED_RUN], 'jobs': RED_JOBS, 'head': RED_SHA}, '--status', lanes=lanes)
            self.assertEqual(code, 1, out)
            self.assertIn('settings', out)
            self.assertEqual(dispatch, '')

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

    def test_a_red_recheck_says_flaky_or_changed_for_each_red_step_after_the_failure_line(self):
        # Why (31 Oct 2026, owner: "why I need to flag this personally"): the tools say "flaky" on the red, with the green run it compared to; the run read is the re-check (99).
        tool = "console.log(`Flaky: “a step” passed on the same commit (run ${process.argv[process.argv.indexOf('--run') + 1]})`); console.log('Changed: “b step” differs in src/x.py');\n"
        code, out, _ = gate({'runs': [RED_RUN], 'jobs': RED_JOBS, 'head': NEW_SHA, 'recheck': 'failure'}, verdict_tool=tool)
        self.assertEqual(code, 1, out)
        lines = out.splitlines()
        failure = next(i for i, line in enumerate(lines) if line.startswith('Re-check failure: main is still red'))
        self.assertEqual(lines[failure + 1:failure + 3], ['  Flaky: “a step” passed on the same commit (run 99)', '  Changed: “b step” differs in src/x.py'])

    def test_a_verdict_tool_that_breaks_never_changes_the_gate(self):
        code, out, _ = gate({'runs': [RED_RUN], 'jobs': RED_JOBS, 'head': NEW_SHA, 'recheck': 'failure'}, verdict_tool="throw new Error('no network');\n")
        self.assertEqual(code, 1, out)
        self.assertIn('still red', out)

    def test_suspended_steps_are_listed_with_their_issue_and_never_block(self):
        lanes = json.dumps({'suites': {}, 'steps': {'apply': {'a flaky step': {'lane': 'suspended', 'issue': 'https://github.com/o/r/issues/7'}, 'tolerant one': {'lane': 'tolerant'}}}})
        code, out, _ = gate({'runs': [{**RED_RUN, 'conclusion': 'success'}], 'jobs': {'2': [{'name': 'apply', 'conclusion': 'success'}]}, 'head': RED_SHA}, lanes=lanes)
        self.assertEqual(code, 0, out)
        self.assertIn('suspended step (owner issue, not blocking): apply · a flaky step (https://github.com/o/r/issues/7)', out)
        self.assertNotIn('tolerant one', out)

    def test_force_goes_on_and_names_the_reds(self):
        code, out, dispatch = gate({'runs': [RED_RUN], 'jobs': RED_JOBS, 'head': RED_SHA}, '--force', 'hotfix for testers')
        self.assertEqual(code, 0, out)
        self.assertIn('settings', out)
        self.assertIn('hotfix for testers', out)
        self.assertEqual(dispatch, '')


    def test_an_unknown_flag_starts_nothing(self):
        # 26 Oct 2026: the coordinator ran it with --dry-run to read the state; the flag was ignored and main's red suites were re-run on CI
        code, out, dispatch = gate({'runs': [RED_RUN], 'jobs': RED_JOBS, 'head': NEW_SHA, 'recheck': 'success'}, '--dry-run')
        self.assertEqual(code, 2, out)
        self.assertIn('--dry-run', out)
        self.assertEqual(dispatch, '')

    def test_an_unreadable_main_is_not_green(self):
        # 26 Oct 2026: gh failed, the state helper printed nothing and the gate said "no suite red", exit 0
        for extra in ((), ('--status',)):
            code, out, dispatch = gate({'unreadable': True, 'runs': [], 'jobs': {}, 'head': NEW_SHA}, *extra)
            self.assertEqual(code, 1, out)
            self.assertIn('unknown, not green', out)
            self.assertNotIn('no suite red', out)
            self.assertEqual(dispatch, '')
        code, out, _ = gate({'unreadable': True, 'runs': [], 'jobs': {}, 'head': NEW_SHA}, '--force', 'owner said go')
        self.assertEqual(code, 0, out)

    def test_status_only_reads(self):
        code, out, dispatch = gate({'runs': [RED_RUN], 'jobs': RED_JOBS, 'head': NEW_SHA, 'recheck': 'success'}, '--status')
        self.assertEqual(code, 1, out)
        self.assertIn('cardstates', out)
        self.assertEqual(dispatch, '', '--status never starts a re-check')


def table(*results):
    return {'v': 1, 'suite': 'x', 'results': list(results)}


def failed(name, **extra):
    return {'name': name, 'status': 'failed', 'note': 'waitForFunction timed out (30000 ms)', **extra}


SIGN_UP = 'a sign-up page before the form: the account step is kept apart from the application form'
APPLYFLOWS_RED = {**RED_RUN, 'id': 2, 'html_url': 'https://github.com/o/r/actions/runs/2'}
APPLYFLOWS_JOBS = {'2': [{'name': 'applyflows-1of2', 'conclusion': 'success'}, {'name': 'applyflows-2of2', 'conclusion': 'failure'}]}


@unittest.skipUnless(shutil.which('node'), 'node runs the verdict tool')
class RedStepsJudged(unittest.TestCase):
    """Owner, 1 Nov 2026: "Safety strict, rest tolerant", a8's option "Same rule as the beta". Tonight's nightly (run 41267448030) built nothing over one flaky step (re-check run 41267492981).
    The gate reads each red suite's steps.json (recorded here, no network); only a failed safety or data step, or results it cannot read, stops the beta."""

    def red_main(self, results, *, rerun=False, extra=None):
        """applyflows red on main with these step results; rerun: commits landed since, so the re-check (run 99) is red and holds them."""
        run = '99' if rerun else '2'
        data = {'runs': [APPLYFLOWS_RED], 'jobs': APPLYFLOWS_JOBS, 'recheck_jobs': APPLYFLOWS_JOBS['2'], 'head': NEW_SHA if rerun else RED_SHA, 'recheck': 'failure',
                'artifacts': {run: {'e2e-view-applyflows-1of2': table({'name': 'a step', 'status': 'passed'}), 'e2e-view-applyflows-2of2': table(*results), 'e2e-coverage-applyflows-1of2': {}}}}
        return gate({**data, **(extra or {})})

    def test_a_red_step_that_is_not_safety_or_data_lets_tonights_beta_go_on_and_lists_it(self):
        for rerun in (False, True):   # (a)/(e): nothing changed since the red run, and the re-check red again
            code, out, dispatch = self.red_main([failed(SIGN_UP)], rerun=rerun)
            self.assertEqual(code, 0, out)
            self.assertIn(f'Red on main, not safety or data: applyflows · {SIGN_UP}', out)
            self.assertEqual(bool(dispatch), rerun, 'the re-check itself is kept: it re-runs only when commits landed since')

    def test_a_suite_green_in_the_recheck_is_not_judged(self):
        # Gitar on #2786: main red on two suites, the re-check passes one and fails the other on an ordinary step: the beta goes on and lists only the still-red step.
        runs = [{**APPLYFLOWS_RED, 'display_title': 'E2E check · on time (Worker cron)'}]
        jobs = {'2': [{'name': 'apply', 'conclusion': 'failure'}, {'name': 'employers', 'conclusion': 'failure'}]}
        recheck_jobs = [{'name': 'apply', 'conclusion': 'success'}, {'name': 'employers', 'conclusion': 'failure'}]
        artifacts = {'99': {'e2e-view-apply': table({'name': 'ok', 'status': 'passed'}), 'e2e-view-employers': table(failed('an ordinary step'))}}
        code, out, dispatch = gate({'runs': runs, 'jobs': jobs, 'head': NEW_SHA, 'recheck': 'failure', 'recheck_jobs': recheck_jobs, 'artifacts': artifacts})
        self.assertEqual(code, 0, out)
        self.assertIn('Red on main, not safety or data: employers · an ordinary step', out)
        self.assertNotIn('apply ·', out.split('Red on main, not safety or data')[1])
        self.assertIn('suite=apply,employers', dispatch)

    def test_a_red_safety_step_stops_the_beta(self):
        for rerun in (False, True):   # (b)
            code, out, _ = self.red_main([failed(SIGN_UP), failed('Stop halts the fill', safety=True)], rerun=rerun)
            self.assertEqual(code, 1, out)
            self.assertIn('Stops the beta: applyflows · Stop halts the fill: a safety step failed', out)

    def test_a_red_data_step_stops_the_beta(self):
        for rerun in (False, True):   # (c)
            code, out, _ = self.red_main([failed('a store move keeps the data', data=True)], rerun=rerun)
            self.assertEqual(code, 1, out)
            self.assertIn('a data step failed', out)

    def test_results_that_cannot_be_read_stop_the_beta_and_say_why(self):
        for rerun in (False, True):   # (d): the red run has no artifacts, or the artifact list cannot be fetched
            for extra, why in (({'artifacts': {}}, 'no steps.json among the run'), ({'artifacts_unreadable': True}, 'could not be read')):
                code, out, _ = self.red_main([failed(SIGN_UP)], rerun=rerun, extra=extra)
                self.assertEqual(code, 1, out)
                self.assertIn('Stops the beta: applyflows (run', out)
                self.assertIn(why, out)
                self.assertNotIn('Red on main, not safety or data', out)

    def test_the_tool_runs_through_a_symlinked_path_and_never_exits_0_silently(self):
        # 1 Nov 2026: on macOS the temp dir is /var → /private/var; the "am I the entry script" compare was false, main() never ran and the tool printed nothing and exited 0.
        with tempfile.TemporaryDirectory() as tmp:
            real, link = Path(tmp) / 'real', Path(tmp) / 'link'
            (real / 'tools').mkdir(parents=True)
            (real / 'desktop/e2e').mkdir(parents=True)
            (real / 'desktop/e2e/lib').symlink_to(ROOT / 'desktop/e2e/lib')
            shutil.copyfile(ROOT / 'tools/red-main-verdict.mjs', real / 'tools/red-main-verdict.mjs')
            link.symlink_to(real)
            done = subprocess.run(['node', str(link / 'tools/red-main-verdict.mjs')], capture_output=True, text=True)
            self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
            self.assertIn('usage:', done.stderr)

    def test_the_suite_names_the_nightly_reads_are_not_the_reasons(self):
        # desktop.yml's nightly takes the indented lines after "Main's e2e is red:" as suite names: the verdict's lines must not start with spaces.
        _, out, _ = self.red_main([failed('x', safety=True)])
        self.assertTrue(all(not line.startswith('  ') or 'since' in line for line in out.splitlines() if 'Stops the beta' in line or 'Red on main' in line), out)


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
