# Exercise beta rate decisions with hand-made nights and an offline GitHub transport.
import copy
import importlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from tests.test_pr_ai_number import Github, RATES, archive
from tools import pr_ai_number as ai


def counts(exact=90):
    """Synthetic night: 100 observations per metric, never a live measurement."""
    return {**copy.deepcopy(RATES), 'facts': {'exact': exact, 'total': 100},
            'flags': {'flagged': 10, 'judged': 100},
            'cv': {'found': 90, 'expected': 100, 'corrected': 0},
            'steady': {'within8': 90, 'pairs': 100}}


class Bands(unittest.TestCase):
    def test_fixture_night_clearly_below_blocks_but_inside_passes(self):
        self.assertTrue(callable(getattr(ai, 'band', None)), 'shared Wilson band is missing')
        baseline = ai.band([counts()] * 7)
        self.assertAlmostEqual(baseline['facts']['lower'], 0.8755463, places=6)
        self.assertAlmostEqual(baseline['facts']['upper'], 0.9200874, places=6)
        self.assertTrue(ai.verdict(counts(40), baseline)['facts']['blocked'])
        self.assertFalse(any(m['blocked'] for m in ai.verdict(counts(89), baseline).values()))

    def test_pool_counts_instead_of_averaging_nightly_percentages(self):
        small = counts(1)
        small['facts']['total'] = 1
        self.assertTrue(callable(getattr(ai, 'band', None)))
        self.assertAlmostEqual(ai.band([small, counts(50), counts(50)])['facts']['rate'], 101 / 201)

    def test_missing_metric_and_zero_denominator_are_unavailable_never_zero(self):
        self.assertTrue(callable(getattr(ai, 'band', None)))
        current = counts()
        current['facts'] = None
        current['steady'] = {'within8': 0, 'pairs': 0}
        result = ai.verdict(current, ai.band([counts()] * 7))
        self.assertIsNone(result['facts'])
        self.assertIsNone(result['steady'])
        self.assertIsNone(ai.band([current] * 7)['facts'])
        self.assertFalse(any(m and m['blocked'] for m in result.values()))

    def test_three_measured_nights_per_metric_and_shared_validation(self):
        self.assertTrue(callable(getattr(ai, 'band', None)))
        self.assertEqual(ai.band([counts()] * 2), {})
        with patch.object(ai, 'valid_rates', wraps=ai.valid_rates) as parser:
            ai.band([counts()] * 7)
            ai.verdict(counts(), ai.band([counts()] * 3))
            self.assertGreaterEqual(parser.call_count, 11)
        invalid = {**counts(), 'v': 2}
        self.assertEqual(ai.band([invalid] * 7), {})
        partial = counts()
        partial['cv'] = None
        self.assertIsNone(ai.band([partial, partial, counts()])['cv'])

    def test_flags_use_unflagged_successes_and_steady_is_compared(self):
        self.assertTrue(callable(getattr(ai, 'band', None)))
        current = counts()
        current['flags']['flagged'] = 60
        current['steady']['within8'] = 40
        result = ai.verdict(current, ai.band([counts()] * 7))
        self.assertTrue(result['flags']['blocked'])
        self.assertTrue(result['steady']['blocked'])


class Gate(unittest.TestCase):
    def gate(self):
        return importlib.import_module('tools.beta_rate_gate')

    def fixture(self, current=None, nights=7, suite='qualityai', platform='mac'):
        runs = [{'id': rid, 'head_branch': 'main', 'status': 'completed', 'event': 'schedule',
                 'conclusion': 'success', 'display_title': 'E2E check · nightly backup'} for rid in range(20, 20 - nights, -1)]
        prefix = 'e2e-artifacts-windows-' if platform == 'windows' else 'e2e-artifacts-'
        artifacts = {rid: [{'id': rid, 'name': f'{prefix}{suite}'}] for rid in [99, *range(20, 20 - nights, -1)]}
        gh = Github(runs, artifacts, {rid: archive(current if rid == 99 and current is not None else counts()) for rid in artifacts})
        transport = gh.__call__
        def call(*args, **kwargs):
            url = next(a for a in args if a.startswith('repos/'))
            if '/workflows/desktop.yml/runs?' in url:
                gh.calls.append((args, False))
                return json.dumps({'workflow_runs': gh.runs})
            if '/workflows/e2e.yml/runs?' in url:
                gh.calls.append((args, False))
                return json.dumps({'workflow_runs': []})  # These scheduled runs do not run qualityai.
            if '/jobs?' in url:
                gh.calls.append((args, False))
                label = 'Windows' if platform == 'windows' else 'Mac + Linux'
                return json.dumps([{'jobs': [{'name': f'E2E · {label} · {suite}', 'status': 'completed', 'conclusion': 'success'}]}])
            return transport(*args, **kwargs)
        return gh, call

    def test_only_desktop_nights_carry_rates_for_each_platform_and_current_run_is_excluded(self):
        for platform in ('mac', 'windows'):
            with self.subTest(platform=platform):
                store, gh = self.fixture(counts(40), nights=3, platform=platform)
                store.runs[1].update(event='workflow_dispatch', display_title='Nightly beta')
                store.runs[:0] = [dict(store.runs[1], id=99)]
                status, lines = self.gate().check('o/r', '99', {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}, gh, platform=platform)
                self.assertEqual(status, 0)
                self.assertIn('main runs 20,19,18', '\n'.join(lines))
                self.assertNotIn('main runs 99', '\n'.join(lines))
                self.assertNotIn('/runs/99/jobs?', str(store.calls))

    def test_first_only_stops_at_first_eligible_night_even_when_artifact_is_broken(self):
        for broken in (False, True):
            with self.subTest(broken=broken):
                store, gh = self.fixture(nights=2)
                store.runs[:0] = [dict(store.runs[0], id=24, head_branch='topic'),
                                  dict(store.runs[0], id=23, status='in_progress'),
                                  dict(store.runs[0], id=22, event='workflow_dispatch'),
                                  dict(store.runs[0], id=21)]
                if broken:
                    store.blobs[20] = b'broken ZIP'
                def transport(*args, **kwargs):
                    if any('/runs/21/jobs?' in arg for arg in args):
                        store.calls.append((args, False))
                        return json.dumps([{'jobs': [{'name': 'E2E · Mac + Linux · qualityai', 'status': 'in_progress'}]}])
                    return gh(*args, **kwargs)
                self.assertEqual(self.gate().main_nights('o/r', 'qualityai', transport, first_only=True),
                                 [(20, None if broken else counts())])
                downloads = [args[-1] for args, binary in store.calls if binary]
                self.assertEqual(downloads, ['repos/o/r/actions/artifacts/20/zip'])
                self.assertNotIn('/runs/19/', str(store.calls))

    def test_below_band_reports_without_blocking_and_names_numbers(self):
        _, gh = self.fixture(counts(40))
        status, lines = self.gate().check('o/r', 99, {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}, gh)
        self.assertEqual(status, 0)
        text = '\n'.join(lines)
        for token in ('facts', '40/100', '87.55%', '92.01%', '20,19,18,17,16,15,14'):
            self.assertIn(token, text)

    def test_inside_band_and_short_history_pass_with_visible_health(self):
        for nights, phrase in ((7, 'within band'), (2, 'no band yet: not blocking')):
            _, gh = self.fixture(counts(89), nights)
            status, lines = self.gate().check('o/r', 99, {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}, gh)
            self.assertEqual(status, 0)
            self.assertIn(phrase, '\n'.join(lines))

    def test_missing_artifact_and_metric_are_grey(self):
        store, gh = self.fixture()
        store.artifacts[99] = []
        status, lines = self.gate().check('o/r', 99, {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}, gh)
        self.assertEqual(status, 0)
        self.assertIn('no band yet: not blocking', '\n'.join(lines))
        current = counts()
        current['facts'] = None
        _, gh = self.fixture(current)
        status, lines = self.gate().check('o/r', 99, {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}, gh)
        self.assertEqual(status, 0)
        self.assertIn('facts unavailable', '\n'.join(lines))

    def test_registry_discovers_future_ai_suite_but_not_outside_or_suspended(self):
        _, gh = self.fixture(counts(40), suite='future')
        registry = {'future': {'lane': 'tolerant', 'input': 'ai'},
                    'outside': {'lane': 'tolerant', 'input': 'outside'}, 'gone': {'lane': 'suspended', 'input': 'ai'}}
        status, lines = self.gate().check('o/r', 99, registry, gh)
        self.assertEqual(status, 0)
        self.assertTrue(all(line.startswith('future:') for line in lines))

    def test_only_last_seven_completed_nights_on_main_supply_band(self):
        store, gh = self.fixture(counts(89), nights=10)
        store.runs[:0] = [dict(store.runs[0], id=31, event='workflow_dispatch'),
                          dict(store.runs[0], id=32, head_branch='topic')]
        status, lines = self.gate().check('o/r', 99, {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}, gh)
        self.assertEqual(status, 0)
        self.assertIn('20,19,18,17,16,15,14', '\n'.join(lines))
        asked = str(store.calls)
        self.assertNotIn('/runs/13/', asked)
        self.assertNotIn('/runs/31/', asked)

    def test_red_tolerant_job_alone_does_not_block_backbone_still_does(self):
        registry = {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}
        jobs = [{'name': 'E2E · Mac + Linux · qualityai', 'conclusion': 'failure'}]
        self.assertFalse(self.gate().blocking_jobs(jobs, registry, 'mac'))
        jobs.append({'name': 'E2E · Mac + Linux · settings', 'conclusion': 'failure'})
        self.assertEqual(self.gate().blocking_jobs(jobs, registry, 'mac'), ['settings'])
        self.assertEqual(self.gate().blocking_jobs(jobs, registry, 'windows'), ['lane jobs unavailable'])


    def test_notion_real_and_every_tolerant_input_are_health_not_beta_blockers(self):
        registry = {'qualityai': {'lane': 'tolerant', 'input': 'ai'},
                    'notion-real': {'lane': 'tolerant', 'input': 'outside'},
                    'latency': {'lane': 'tolerant', 'input': 'clock'},
                    'flipped': {'lane': 'suspended'}}
        for platform, label in (('mac', 'Mac + Linux'), ('windows', 'Windows')):
            with self.subTest(platform=platform):
                jobs = [{'name': f'E2E · {label} · {suite}', 'status': 'completed', 'conclusion': 'failure'}
                        for suite in registry]
                self.assertFalse(self.gate().blocking_jobs(jobs, registry, platform))
                jobs.append({'name': f'E2E · {label} · settings', 'status': 'completed', 'conclusion': 'failure'})
                self.assertEqual(self.gate().blocking_jobs(jobs, registry, platform), ['settings'])

    def test_both_lanes_hold_each_release_and_name_the_lane(self):
        # Beta 41090972183 (30 Oct 2026): Mac + Linux applyflows red, Windows green, and Windows 0.8.53 shipped; the owner: neither platform then.
        registry = {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}
        jobs = [{'name': 'E2E · Mac + Linux · applyflows-2of2', 'conclusion': 'failure'},
                {'name': 'E2E · Mac + Linux · qualityai', 'conclusion': 'failure'},
                {'name': 'E2E · Windows · apply', 'conclusion': 'success'}]
        self.assertFalse(self.gate().blocking_jobs(jobs, registry, 'windows'), 'the control: the Windows lane alone is green')
        self.assertEqual(self.gate().blocking_lanes(jobs, registry), ['Mac + Linux: applyflows'])
        self.assertEqual(self.gate().blocking_lanes(jobs[1:], registry), [])
        self.assertEqual(self.gate().blocking_lanes(jobs[:2], registry), ['Mac + Linux: applyflows', 'Windows: lane jobs unavailable'])

    def test_grey_annotation_holds_beta_and_writes_current_attempt_evidence(self):
        gate = self.gate()
        jobs = [{'id': 21, 'name': 'E2E · Mac + Linux · apply-1of2', 'conclusion': 'failure'},
                {'id': 22, 'name': 'E2E · Windows · apply', 'conclusion': 'success'}]
        calls = []
        def github(*args, **kwargs):
            calls.append(args)
            return json.dumps([[{'title': 'Grey: the runner, not the app'}], []]) if '/21/' in str(args) else '[[]]'
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'beta-held.json'
            status, lines = gate.backbone_check('o/r', jobs, {}, github, attempt=1, output=target)
            self.assertEqual(status, 1)
            self.assertIn('Held: grey (runner, not the app): Mac + Linux: apply', '\n'.join(lines))
            self.assertEqual(json.loads(target.read_text()), {'attempt': 1, 'grey': ['Mac + Linux: apply'], 'red': []})
            self.assertIn('repos/o/r/check-runs/21/annotations?per_page=100', str(calls))
            jobs.insert(1, {'id': 23, 'name': 'E2E · Mac + Linux · apply-2of2', 'conclusion': 'failure'})
            def mixed(*args, **kwargs):
                return '[]' if '/23/' in str(args) else github(*args, **kwargs)
            status, lines = gate.backbone_check('o/r', jobs, {}, mixed, attempt=2, output=target)
            self.assertEqual(status, 1)
            self.assertIn('Not released: red: Mac + Linux: apply', '\n'.join(lines))
            self.assertEqual(json.loads(target.read_text()), {'attempt': 2, 'grey': ['Mac + Linux: apply'], 'red': ['Mac + Linux: apply']})

    def test_non_grey_or_unreadable_annotations_stay_red(self):
        gate = self.gate()
        jobs = [{'id': 21, 'name': 'E2E · Mac + Linux · apply', 'conclusion': 'failure'},
                {'id': 22, 'name': 'E2E · Windows · settings', 'conclusion': 'success'}]
        def unreadable(*args, **kwargs):
            raise OSError('offline')
        for github in (lambda *args: '[]', lambda *args: '[[{"title":"First try failed"}]]', unreadable):
            with tempfile.TemporaryDirectory() as folder:
                status, lines = gate.backbone_check('o/r', jobs, {}, github, attempt=1, output=Path(folder) / 'hold.json')
                self.assertEqual(status, 1)
                self.assertIn('Not released: red: Mac + Linux: apply', '\n'.join(lines))
                self.assertNotIn('Held: grey', '\n'.join(lines))

    def test_rate_only_standalone_import_needs_no_annotation_companion(self):
        # The PR verdict downloads each companion separately, before main_e2e_state may be loaded.
        import importlib.util
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as folder:
            copied = Path(folder) / 'beta_rate_gate.py'
            copied.write_text((root / 'tools/beta_rate_gate.py').read_text())
            with patch.dict(sys.modules, {'pr_ai_number': ai}):
                spec = importlib.util.spec_from_file_location('standalone_beta_rate_gate', copied)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                self.assertEqual(module.check('o/r', 99, {}, lambda *args: self.fail('no GitHub call')), (0, []))

    def test_e2e_only_cli_exits_one_and_persists_grey_attempt_without_network(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as folder:
            tmp = Path(folder)
            fake = tmp / 'gh'
            fake.write_text(f'#!{sys.executable}\n' + r"""import json, sys
url = next(a for a in sys.argv if a.startswith('repos/'))
if '/jobs?' in url:
    print(json.dumps([{'jobs': [{'id': 21, 'name': 'E2E · Mac + Linux · apply', 'conclusion': 'failure'},
                              {'id': 22, 'name': 'E2E · Windows · apply', 'conclusion': 'success'}]}]))
elif '/check-runs/21/annotations?' in url:
    print(json.dumps([[{'title': 'Grey: the runner, not the app'}]]))
else:
    sys.exit('No network: unexpected call ' + repr(sys.argv))
""")
            fake.chmod(0o755)
            result = subprocess.run([sys.executable, str(root / 'tools/beta_rate_gate.py'), '--repo', 'o/r', '--run', '99', '--e2e-only'],
                                    cwd=tmp, env={**os.environ, 'PATH': folder + os.pathsep + os.environ['PATH'], 'GITHUB_RUN_ATTEMPT': '2'},
                                    capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn('Held: grey', result.stdout)
            self.assertEqual(json.loads((tmp / 'beta-held.json').read_text()), {'attempt': 2, 'grey': ['Mac + Linux: apply'], 'red': []})

    def test_empty_lane_jobs_cannot_clear_a_failed_matrix(self):
        self.assertEqual(self.gate().blocking_jobs([], {}, 'mac'), ['lane jobs unavailable'])

    def test_windows_uses_its_finished_lane_artifact_not_a_still_running_mac(self):
        _, gh = self.fixture(counts(40), platform='windows')
        status, lines = self.gate().check('o/r', 99, {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}, gh, platform='windows')
        self.assertEqual(status, 0)
        self.assertIn('below band (report only)', '\n'.join(lines))

    def test_missing_or_invalid_main_artifacts_are_skipped_without_zero_scores(self):
        for missing in (True, False):
            with self.subTest(missing=missing):
                store, gh = self.fixture(counts(40), nights=10)
                if missing:
                    store.artifacts[20] = []
                else:
                    store.blobs[20] = archive({**counts(), 'v': 2})
                status, lines = self.gate().check('o/r', 99, {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}, gh)
                self.assertEqual(status, 0)
                self.assertIn('main runs 19,18,17,16,15,14,13', '\n'.join(lines))
                self.assertIn('main band 87.55%–92.01%', '\n'.join(lines))
                self.assertNotIn('/runs/12/', str(store.calls))

    def test_fewer_than_three_readable_main_nights_are_grey(self):
        store, gh = self.fixture(counts(40), nights=3)
        store.artifacts[20] = []
        status, lines = self.gate().check('o/r', 99, {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}, gh)
        self.assertEqual(status, 0)
        self.assertIn('no band yet: not blocking', '\n'.join(lines))
        self.assertIn('main runs 19,18', '\n'.join(lines))

    def test_red_qualityai_night_contributes_its_dipped_rate_to_the_band(self):
        store, gh = self.fixture(counts(40), nights=8)
        dipped = counts(0)
        dipped['facts']['total'] = 480
        store.blobs[20] = archive(dipped)
        store.runs[0]['conclusion'] = 'failure'
        def red_night(*args, **kwargs):
            url = next(a for a in args if a.startswith('repos/'))
            if '/runs/20/jobs?' in url:
                return json.dumps([{'jobs': [{'name': 'E2E · Mac + Linux · qualityai', 'status': 'completed', 'conclusion': 'failure'}]}])
            return gh(*args, **kwargs)
        status, lines = self.gate().check('o/r', 99, {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}, red_night)
        self.assertEqual(status, 0, 'excluding the dipped night incorrectly blocks this beta')
        self.assertIn('main runs 20,19,18,17,16,15,14', '\n'.join(lines))
        self.assertIn('main band 47.02%–52.98%', '\n'.join(lines))

    def test_green_suite_in_red_nightly_counts_worker_nights_count_manual_runs_do_not(self):
        store, gh = self.fixture(counts(40), nights=3)
        store.runs[0].update(conclusion='failure')
        store.runs[1].update(event='workflow_dispatch', display_title='Nightly beta')
        store.runs[2].update(event='workflow_dispatch', display_title='E2E Mac + Linux · qualityai · main')
        status, lines = self.gate().check('o/r', 99, {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}, gh)
        self.assertEqual(status, 0)
        self.assertIn('main runs 20,19', '\n'.join(lines))

    def test_history_scan_stops_after_three_weeks_of_nights_without_artifacts(self):
        # Gitar on #2504: a new tolerant suite has no nights yet; the scan must not walk all of desktop.yml's history.
        store, gh = self.fixture(counts(40), nights=0)
        jobs_calls, pages = [], []
        def endless(*args, **kwargs):
            url = next(a for a in args if a.startswith('repos/'))
            if '/workflows/desktop.yml/runs?' in url:
                page = int(url.split('&page=')[1])
                pages.append(page)
                return json.dumps({'workflow_runs': [{'id': page * 1000 + n, 'head_branch': 'main', 'event': 'schedule', 'status': 'completed',
                                                     'display_title': 'E2E check · nightly backup'} for n in range(100)]})
            if '/jobs?' in url:
                jobs_calls.append(url)
                return json.dumps([{'jobs': [{'name': 'E2E · Mac + Linux · settings', 'status': 'completed', 'conclusion': 'success'}]}])
            return gh(*args, **kwargs)
        status, lines = self.gate().check('o/r', 99, {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}, endless)
        self.assertEqual(status, 0)
        self.assertIn('no band yet', '\n'.join(lines))
        self.assertEqual(len(jobs_calls), 21)
        self.assertLessEqual(max(pages), 2)

    def test_history_pages_past_manual_runs_and_keeps_completed_red_nights(self):
        store, gh = self.fixture(counts(40), nights=8)
        def paged(*args, **kwargs):
            url = next(a for a in args if a.startswith('repos/'))
            if '/workflows/desktop.yml/runs?' in url and '&page=2' not in url:
                return json.dumps({'workflow_runs': [{'id': n, 'head_branch': 'main', 'event': 'workflow_dispatch',
                                                     'status': 'completed'} for n in range(1000, 1100)]})
            if '/runs/20/jobs?' in url:
                return json.dumps([{'jobs': [{'name': 'E2E · Mac + Linux · qualityai', 'status': 'completed', 'conclusion': 'failure'}]}])
            return gh(*args, **kwargs)
        status, lines = self.gate().check('o/r', 99, {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}, paged)
        self.assertEqual(status, 0)
        self.assertIn('main runs 20,19,18,17,16,15,14', '\n'.join(lines))

    def test_workflow_cli_reports_dip_and_exits_zero_without_network(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as folder:
            tmp = Path(folder)
            (tmp / 'rates.zip').write_bytes(archive(counts()))
            (tmp / 'beta.zip').write_bytes(archive(counts(40)))
            fake = tmp / 'gh'
            fake.write_text(f'#!{sys.executable}\n' + r"""import json, sys
from pathlib import Path
root = Path(__file__).parent
args = sys.argv[1:]
url = next(a for a in args if a.startswith('repos/'))
if '/workflows/desktop.yml/runs?' in url:
    print(json.dumps({'workflow_runs': [{'id': n, 'head_branch': 'main', 'status': 'completed', 'event': 'schedule', 'display_title': 'E2E check · nightly backup'} for n in range(7, 0, -1)]}))
elif '/workflows/e2e.yml/runs?' in url:
    print(json.dumps({'workflow_runs': []}))
elif '/jobs?' in url:
    print(json.dumps([{'jobs': [{'name': 'E2E · Mac + Linux · qualityai', 'status': 'completed', 'conclusion': 'success'}]}]))
elif '/artifacts?' in url:
    rid = int(url.split('/runs/')[1].split('/')[0])
    print(json.dumps([{'artifacts': [{'id': rid, 'name': 'e2e-artifacts-qualityai'}]}]))
elif url.endswith('/zip'):
    sys.stdout.buffer.write((root / ('beta.zip' if '/99/' in url else 'rates.zip')).read_bytes())
else:
    sys.exit('No network: unexpected call ' + repr(args))
""")
            fake.chmod(0o755)
            result = subprocess.run([sys.executable, str(root / 'tools/beta_rate_gate.py'), '--repo', 'o/r', '--run', '99'],
                                    env={**os.environ, 'PATH': folder + os.pathsep + os.environ['PATH'], 'PYTHONDONTWRITEBYTECODE': '1'},
                                    capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('::warning::qualityai: facts 40/100', result.stdout)


if __name__ == '__main__':
    unittest.main()
