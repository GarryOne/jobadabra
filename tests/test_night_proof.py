"""A beta by hand starts only on a commit the night proved (tools/night_proof.py, tools/beta-release.sh; owner, 1 Nov 2026: "Only on a proved commit").

Why (1 Nov 2026, a8): 68 of 90 betas by hand ended red in 24 days; the night burn-in runs the same suites on the same commit five times over, on Mac + Linux and Windows.
The cases: 5/5 green on both sides starts; 4/5, a red Windows pass, a re-run that hides a red one, another commit, no build, a red build.yml and a red unit result each
refuse and name what is missing. The shapes of the runs are the ones GitHub returned for the first night (tests/fixtures/night-proof/recorded-*.json)."""
import json
import os
import re
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

from tools import night_proof as n

ROOT = Path(__file__).resolve().parent.parent
RECORDED = Path(__file__).resolve().parent / 'fixtures' / 'night-proof'
SHA = 'a' * 40
OTHER = 'b' * 40


def stamp(number, minute=0):
    """Pass n of the night of 1 Nov: 21:00, 23:30, 01:30, 03:30, 05:30 UTC (worker/src/scheduler.js NIGHT_SLOTS)."""
    hours = [(31, 21, 0), (31, 23, 30), (1, 1, 30), (1, 3, 30), (1, 5, 30)][number - 1]
    day = '2026-10-31' if hours[0] == 31 else '2026-11-01'
    return f'{day}T{hours[1]:02d}:{hours[2] + minute:02d}:39Z'


def mac(number, conclusion='success', head=SHA, run_id=None, status='completed'):
    return {'id': run_id or 1000 + number, 'display_title': f'Night burn-in {number}/5 · main', 'head_sha': head, 'head_branch': 'main', 'conclusion': conclusion, 'status': status, 'created_at': stamp(number)}


def windows(number, conclusion='success', sha=SHA, run_id=None):
    return {'id': run_id or 2000 + number, 'display_title': f'Night burn-in Windows {number}/5 · {sha}', 'head_sha': 'c' * 40, 'conclusion': conclusion, 'status': 'completed', 'created_at': stamp(number, 18)}


def night(sha=SHA):
    """A fully green night on `sha`: pass 1 started on it, passes 2 to 5 tested its commit while main's head moved on."""
    return {
        'e2e_runs': [mac(1, head=sha)] + [mac(number, head=('d' * 40)) for number in range(2, 6)],
        'windows_runs': [windows(number, sha=sha) for number in range(1, 6)],
        'build_runs': {sha: [{'conclusion': 'success'}]},
        'builds': [{'tag': 'desktop-v0.8.70', 'sha': sha, 'unit': {'mac': 'success', 'windows': 'success'}}],
    }


class TheCases(unittest.TestCase):
    def test_five_green_passes_on_both_sides_prove_the_commit(self):
        self.assertEqual(n.proof(SHA, night()), [])

    def test_a_missing_pass_is_named_on_each_side(self):
        data = night()
        data['e2e_runs'] = [run for run in data['e2e_runs'] if 'Windows' in run['display_title'] or not run['display_title'].startswith('Night burn-in 5/5')]
        data['windows_runs'] = [run for run in data['windows_runs'] if '4/5' not in run['display_title'] and '5/5' not in run['display_title']]
        self.assertEqual(n.proof(SHA, data), ['not proved: no Mac + Linux burn-in pass 5/5 on aaaaaaa', 'not proved: no Windows burn-in pass 4/5 on aaaaaaa', 'not proved: no Windows burn-in pass 5/5 on aaaaaaa'])

    def test_a_red_windows_pass_is_named_with_its_run(self):
        data = night()
        data['windows_runs'][2] = windows(3, 'failure', run_id=77)
        self.assertEqual(n.proof(SHA, data), ['not proved: Windows burn-in pass 3/5 red (run 77)'])

    def test_a_pass_still_running_or_cancelled_is_not_a_pass(self):
        data = night()
        data['e2e_runs'][3] = mac(4, None, head='d' * 40, status='in_progress')
        data['windows_runs'][4] = windows(5, 'cancelled')
        self.assertEqual(n.proof(SHA, data), ['not proved: Mac + Linux burn-in pass 4/5 still running (run 1004)', 'not proved: Windows burn-in pass 5/5 cancelled (run 2005)'])

    def test_a_green_re_run_does_not_hide_a_red_first_try(self):
        data = night()
        data['windows_runs'].append(windows(2, 'failure', run_id=88))
        self.assertEqual(n.proof(SHA, data), ['not proved: Windows burn-in pass 2/5 red (run 88)'])

    def test_another_commit_has_no_burn_in(self):
        self.assertEqual(n.proof(OTHER, night()), [f'not proved: no burn-in on {OTHER[:7]}'] + [f'not proved: build.yml on {OTHER[:7]} is missing'] + [f'not proved: no pre-release build of {OTHER[:7]} with its unit results (builds before 1 Nov 2026 carry none)'])

    def test_no_build_means_no_unit_results(self):
        data = night()
        data['builds'] = [{'tag': 'desktop-v0.8.69', 'sha': OTHER, 'unit': {'mac': 'success', 'windows': 'success'}}]
        self.assertEqual(n.proof(SHA, data), ['not proved: no pre-release build of aaaaaaa with its unit results (builds before 1 Nov 2026 carry none)'])

    def test_a_red_unit_result_names_its_lane_and_build(self):
        data = night()
        data['builds'][0]['unit'] = {'mac': 'failure', 'windows': None}
        self.assertEqual(n.proof(SHA, data), ['not proved: unit tests on Mac failure in desktop-v0.8.70', 'not proved: unit tests on Windows have no result in desktop-v0.8.70'])

    def test_a_red_build_yml_is_named(self):
        data = night()
        data['build_runs'][SHA] = [{'conclusion': 'failure'}]
        self.assertEqual(n.proof(SHA, data), [f'not proved: build.yml on {SHA[:7]} is red'])

    def test_main_e2e_red_on_the_commit_is_named(self):
        data = night()
        data['e2e_runs'].append({'id': 55, 'display_title': 'E2E Mac + Linux · all suites · main', 'head_sha': SHA, 'head_branch': 'main', 'conclusion': 'failure', 'status': 'completed', 'created_at': stamp(3)})
        self.assertEqual(n.proof(SHA, data), [f"not proved: main's e2e is red on {SHA[:7]} (run 55)"])

    def test_a_missing_list_is_not_proved(self):
        self.assertTrue(n.proof(SHA, {'e2e_runs': [], 'windows_runs': [], 'build_runs': {}, 'builds': []}))


class WhichCommitAPassTested(unittest.TestCase):
    """Pass 1 tests the head it started on; passes 2 to 5 test pass 1's commit when it started within the night (night-pass.mjs nightRef), else their own head."""

    def test_a_later_pass_tests_the_commit_of_pass_one(self):
        passes = {number: tested for number, tested, _ in n.mac_passes([mac(1, head=SHA), mac(3, head=OTHER)])}
        self.assertEqual(passes, {1: SHA, 3: SHA})

    def test_a_pass_one_of_the_night_before_is_not_used(self):
        old = dict(mac(1, head=SHA), created_at='2026-10-30T21:00:39Z')
        passes = {number: tested for number, tested, _ in n.mac_passes([old, mac(3, head=OTHER)])}
        self.assertEqual(passes, {1: SHA, 3: OTHER})

    def test_the_numbers_are_those_of_night_pass_mjs(self):
        source = (ROOT / 'desktop' / 'e2e' / 'lib' / 'night-pass.mjs').read_text()
        self.assertEqual(int(re.search(r'NIGHT_PASSES = (\d+)', source).group(1)), n.PASSES)
        self.assertEqual(int(re.search(r'SPAN_MS = (\d+) \* 3600', source).group(1)), n.SPAN.total_seconds() // 3600)


class TheRecordedFirstNight(unittest.TestCase):
    """The runs GitHub listed on 1 Nov 2026 (pass 2 red on Mac + Linux, pass 3 still running, Windows pass 2 green): no commit is proved today."""

    def data(self):
        return {'e2e_runs': json.loads((RECORDED / 'recorded-e2e.json').read_text()), 'windows_runs': json.loads((RECORDED / 'recorded-windows.json').read_text()), 'build_runs': {}, 'builds': []}

    def test_the_commit_of_pass_two_is_not_proved_and_the_red_pass_is_named(self):
        lines = n.proof('894a706c81c501a5f1b0746cbd8db5d65c8be86d', self.data())
        self.assertIn('not proved: Mac + Linux burn-in pass 2/5 red (run 41252826403)', lines)
        self.assertIn('not proved: no Windows burn-in pass 3/5 on 894a706', lines)

    def test_no_commit_is_proved_yet(self):
        self.assertEqual(n.newest_proved(self.data()), '')


class TheNewestProvedCommit(unittest.TestCase):
    def test_it_is_the_newest_night_that_is_proved(self):
        data = night(SHA)
        older = night(OTHER)
        for run in older['e2e_runs'] + older['windows_runs']:
            run['created_at'] = run['created_at'].replace('2026-10-31', '2026-10-30').replace('2026-11-01', '2026-10-31')
        data['e2e_runs'] += older['e2e_runs']
        data['windows_runs'] += older['windows_runs']
        data['build_runs'].update(older['build_runs'])
        data['builds'] += older['builds']
        self.assertEqual(n.newest_proved(data), SHA)
        data['build_runs'][SHA] = [{'conclusion': 'failure'}]
        self.assertEqual(n.newest_proved(data), OTHER)


FAKE_GH = '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FAKE_GH_CALLS"\nexit 1\n'


class BetaReleaseRefuses(unittest.TestCase):
    """tools/beta-release.sh asks first and starts nothing on "not proved": no gate, no dispatch, and --force does not go past it."""

    def run_script(self, data, *args):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / 'data.json').write_text(json.dumps(dict(data, head=SHA)))
            (folder / 'bin').mkdir()
            gh = folder / 'bin' / 'gh'
            gh.write_text(FAKE_GH)
            gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
            env = dict(os.environ, PATH=f"{folder / 'bin'}:{os.environ['PATH']}", FAKE_GH_CALLS=str(folder / 'calls'), NIGHT_PROOF_DATA=str(folder / 'data.json'))
            result = subprocess.run(['bash', str(ROOT / 'tools' / 'beta-release.sh'), '--no-watch', *args], capture_output=True, text=True, env=env)
            calls = (folder / 'calls').read_text() if (folder / 'calls').exists() else ''
            return result, calls

    def test_not_proved_names_what_is_missing_and_starts_nothing(self):
        data = night()
        data['windows_runs'][2] = windows(3, 'failure', run_id=77)
        result, calls = self.run_script(data)
        self.assertEqual(result.returncode, 1)
        self.assertIn('not proved: Windows burn-in pass 3/5 red (run 77)', result.stdout)
        self.assertIn('no commit on main is proved yet', result.stdout)
        self.assertNotIn('workflow run', calls)

    def test_force_does_not_go_past_it(self):
        result, calls = self.run_script(dict(night(), builds=[]), '--force', 'urgent')
        self.assertEqual(result.returncode, 1)
        self.assertIn('not proved', result.stdout)
        self.assertNotIn('workflow run', calls)

    def test_a_proved_commit_goes_on_to_the_red_main_gate(self):
        result, _ = self.run_script(night())
        self.assertIn(f'proved: {SHA[:7]}', result.stdout)
        self.assertIn('Could not read main', result.stdout + result.stderr)   # the fake gh reads nothing: the next gate, the red-main one, is the one that stops it


class TheBuildJobsWriteWhatTheProofReads(unittest.TestCase):
    """desktop.yml's two Build jobs upload unit-<lane>.json (the unit step's outcome) into the release: the file names night_proof.fetch() downloads."""

    def test_each_build_job_uploads_its_unit_outcome_inside_its_box(self):
        text = (ROOT / '.github' / 'workflows' / 'desktop.yml').read_text()
        jobs = re.split(r'\n(?=  [a-z0-9-]+:\n)', text)
        for job, lane in (('build', 'mac'), ('windows', 'windows')):
            body = next(block for block in jobs if block.startswith(f'  {job}:'))
            self.assertIn(f'unit-{lane}.json', body, f'Build · {lane} does not upload unit-{lane}.json')
            self.assertIn('UNIT: ${{ steps.unit.outcome }}', body)
            self.assertIn(f'"lane":"{lane}"', body)
            self.assertIn(f'unit-{lane}.json', Path(n.__file__).read_text())   # the file the proof downloads


if __name__ == '__main__':
    unittest.main()
