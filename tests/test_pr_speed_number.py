# Exercises informational PR speed numbers with injected GitHub artifacts and no network.
# Job: report health
import copy
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from contextlib import redirect_stdout, redirect_stderr
from unittest import mock

from tools import pr_speed_number as speed

ROOT = Path(__file__).resolve().parents[1]
SLOW_JOBS = 'a slow Jobs check keeps showing that it is working, and ends cleanly'
FOCUS = 'Focus finishes loading within 20 seconds, with no error text'


def step(seconds, name=SLOW_JOBS, status='passed'):
    return {'name': name, 'status': status, 'seconds': seconds}


def archive(results):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as zipped:
        zipped.writestr('steps.json', json.dumps({'v': 1, 'suite': 'jobs', 'results': results}))
    return data.getvalue()


class Github:
    """Only the artifact and main-run requests used by the real reader are allowed."""
    def __init__(self, seconds=160, baseline=(120, 130, 170), suite='jobs', name=SLOW_JOBS):
        self.calls = []
        self.runs = [{'databaseId': 99, 'displayTitle': f'E2E for PR · {suite},settings · topic'}]
        self.main = [{'databaseId': rid, 'displayTitle': 'E2E check · on time'} for rid in range(10, 10 + len(baseline))]
        self.artifacts = {rid: [{'id': rid, 'name': f'e2e-artifacts-{suite}', 'expired': False}]
                          for rid in (99, *range(10, 10 + len(baseline)))}
        self.blobs = {99: archive([step(seconds, name)])}
        self.blobs.update({rid: archive([step(value, name)]) for rid, value in zip(range(10, 10 + len(baseline)), baseline)})

    def __call__(self, *args, binary=False):
        self.calls.append(args)
        if args[:2] == ('run', 'list'):
            assert args[args.index('--branch') + 1] == 'main'
            assert args[args.index('--status') + 1] == 'completed'
            assert args[args.index('--workflow') + 1] == 'e2e.yml'
            return json.dumps(self.main[:int(args[args.index('--limit') + 1])])
        url = next(a for a in args if a.startswith('repos/'))
        if '/runs/' in url:
            rid = int(url.split('/runs/')[1].split('/')[0])
            return json.dumps([{'artifacts': self.artifacts.get(rid, [])}])
        if url.endswith('/zip'):
            assert binary
            return self.blobs[int(url.split('/artifacts/')[1].split('/')[0])]
        raise AssertionError(f'no network: unexpected request {args}')


class SpeedNumbers(unittest.TestCase):
    def line(self, github, why='checks green'):
        before = copy.deepcopy(github.runs)
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            result = speed.summary('o/r', github.runs, github, why)
        self.assertEqual(github.runs, before)
        self.assertLessEqual(len(result), 140)
        return result

    def test_slow_ai_jobs_check_uses_main_median_and_stays_inside_main_spread(self):
        self.assertEqual(self.line(Github()), 'checks green · Jobs check with slow AI 2m40, main median 2m10')

    def test_slow_pr_names_range_in_text_only(self):
        self.assertEqual(self.line(Github(200)),
                         "checks green · Jobs check with slow AI 3m20, main median 2m10 · SLOWER than main's range")
        self.assertNotIn('SLOWER', self.line(Github(180, baseline=(180, 180, 180))))
        self.assertNotIn('over the', self.line(Github(180, baseline=(180, 180, 180))))

    def test_jobs_line_never_mentions_three_minute_promise_even_at_four_minutes(self):
        line = self.line(Github(240))
        self.assertIn('Jobs check with slow AI 4m00, main median 2m10', line)
        self.assertIn("SLOWER than main's range", line)
        self.assertNotIn('3 min', line)
        self.assertNotIn('promise', line)

    def test_focus_and_dismissal_use_their_own_baselines_and_twenty_second_promise(self):
        for suite in ('focus', 'focusdismiss'):
            with self.subTest(suite=suite):
                self.assertIn('Focus 21s, main median 10s', self.line(Github(21, (9, 10, 11), suite, FOCUS)))
                self.assertIn('over the 20 s promise', self.line(Github(21, (9, 10, 11), suite, FOCUS)))

    def test_missing_or_unreadable_current_artifacts_do_not_add_a_line(self):
        for broken in ('missing', 'zip', 'json', 'steps', 'expired'):
            with self.subTest(broken=broken):
                gh = Github()
                if broken == 'missing': gh.artifacts[99] = []
                elif broken == 'zip': gh.blobs[99] = b'broken'
                elif broken == 'json': gh.blobs[99] = archive(None)
                elif broken == 'steps': gh.blobs[99] = archive([step(2, 'unrelated')])
                else: gh.artifacts[99][0]['expired'] = True
                self.assertEqual(self.line(gh), 'checks green')
                self.assertFalse(any(args[:2] == ('run', 'list') for args in gh.calls))

    def test_unreadable_main_or_no_main_samples_does_not_invent_a_comparison(self):
        for baseline in ((), (130,)):
            gh = Github(baseline=baseline)
            if baseline: gh.blobs[10] = b'broken'
            self.assertEqual(self.line(gh), 'checks green')

    def test_no_timed_suite_makes_no_artifact_requests(self):
        gh = Github()
        gh.runs[0]['displayTitle'] = 'E2E for PR · settings · topic'
        self.assertEqual(self.line(gh), 'checks green')
        self.assertEqual(gh.calls, [])

    def test_newest_pr_run_wins_and_missing_newest_never_uses_stale_number(self):
        gh = Github()
        gh.runs.append({'databaseId': 100, 'displayTitle': 'E2E for PR · jobs · topic'})
        self.assertEqual(self.line(gh), 'checks green')

    def test_numeric_strings_work_and_invalid_or_failed_durations_are_unavailable(self):
        self.assertIn('2m40', self.line(Github('160.0')))
        for value in (None, True, '', ' ', -1, 'NaN', 'Infinity', [], {}):
            with self.subTest(value=value):
                self.assertEqual(self.line(Github(value)), 'checks green')
        gh = Github()
        gh.blobs[99] = archive([step(160, status='failed')])
        self.assertEqual(self.line(gh), 'checks green')

    def test_main_calm_filter_uses_total_per_shard_not_target_step(self):
        gh = Github(baseline=(130, 130, 10))
        gh.blobs[12] = archive([step(10), step(1000, 'other step')])
        self.assertIn('main median 2m10', self.line(gh))
        self.assertNotIn('SLOWER', self.line(gh), 'fewer than three calm observations cannot establish a range')

    def test_title_filter_matches_the_timing_tools_filter(self):
        source = (ROOT / 'tools/e2e-step-timings.mjs').read_text()
        excluded = re.search(r'const comparable = .*?!/\^\(([^)]+)\) /', source)[1].split('|')
        titles = [None, '', 1, *[f'{kind} abc' for kind in excluded], 'E2E check · on time', 'E2E Mac + Linux · jobs · main']
        js = 'const comparable = ' + re.search(r'const comparable = (.*);', source)[1] + ';'
        result = subprocess.run(['node', '--input-type=module', '-e', js + 'console.log(JSON.stringify(' + json.dumps(titles) + '.map(comparable)))'],
                                capture_output=True, text=True, check=True)
        self.assertEqual([speed.comparable(title) for title in titles], json.loads(result.stdout))

    def test_comparable_history_expands_past_partial_runs_and_ignores_alternate_stores(self):
        gh = Github()
        gh.main[:0] = [{'databaseId': rid, 'displayTitle': 'E2E after merge · sha · jobs'} for rid in range(30, 50)]
        gh.artifacts[10].append({'id': 1000, 'name': 'e2e-artifacts-jobs-sqlite', 'expired': False})
        self.assertIn('main median 2m10', self.line(gh))
        self.assertFalse(any('/runs/30/' in ' '.join(args) for args in gh.calls))
        self.assertFalse(any('/artifacts/1000/' in ' '.join(args) for args in gh.calls))

    def test_summary_keeps_complete_ai_counts_and_speed_warning_inside_status_limit(self):
        line = self.line(Github(200), 'grey: settings · AI: facts 63/63 (main 63/63) · flags 1/9 (main 1/9) · same as main')
        self.assertIn('Jobs check with slow AI 3m20, main median 2m10', line)
        self.assertIn("SLOWER than main's range", line)
        self.assertNotIn('promise', line)
        self.assertTrue(line.startswith('grey: settings'), line)
        self.assertIn('AI: facts 63/63 (main 63/63)', line)

    def test_calm_sample_median_and_p95_match_the_timing_tools_measurement(self):
        gh = Github(baseline=(10, 10, 10, 10, 15, 30))
        with tempfile.TemporaryDirectory() as folder:
            for rid in range(10, 16):
                target = Path(folder) / str(rid) / 'e2e-artifacts-jobs-1of2'
                target.mkdir(parents=True)
                # The same ZIP payload goes through both readers; the final 3x-slow run is dropped.
                with zipfile.ZipFile(io.BytesIO(gh.blobs[rid])) as zipped:
                    (target / 'steps.json').write_bytes(zipped.read('steps.json'))
                gh.artifacts[rid][0]['name'] = 'e2e-artifacts-jobs-1of2'
            tool = subprocess.run(['node', 'tools/e2e-step-timings.mjs', '--suite', 'jobs', '--dir', folder, '--json'],
                                  cwd=ROOT, capture_output=True, text=True, check=True)
            measured = json.loads(tool.stdout)['steps'][0]
        samples = speed.main_samples('o/r', 'jobs', SLOW_JOBS, gh, lambda rid: speed.artifact_list('o/r', rid, gh))
        self.assertEqual(samples, [10, 10, 10, 10, 15])
        self.assertEqual((measured['medianSeconds'], measured['p95Seconds'], measured['n']), (10, 15, len(samples)))
        self.assertNotIn('SLOWER', speed.description('Jobs check with slow AI', 15, samples, None, None))
        self.assertIn('SLOWER', speed.description('Jobs check with slow AI', 15.1, samples, None, None))

    def test_ai_and_speed_numbers_share_the_description_without_changing_counts(self):
        line = self.line(Github(), 'AI: facts 63/63 (main 63/63) · flags 1/9 (main 1/9) · same as main')
        self.assertIn('AI: facts 63/63 (main 63/63)', line)
        self.assertIn('Jobs check with slow AI 2m40, main median 2m10', line)

    def test_real_verdict_writer_posts_success_even_when_speed_is_slow(self):
        spec = importlib.util.spec_from_file_location('speed_verdict_test', ROOT / 'tools/pr-verdict.py')
        pv = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(pv)
        gh = Github(200)
        gh.runs[0].update(workflowName='E2E', event='workflow_dispatch', status='completed', conclusion='success',
                          createdAt='2026-10-30T12:00:00Z', updatedAt='2026-10-30T12:03:00Z')
        posts = []
        real_load = pv.main_state_module
        with mock.patch.dict(os.environ, {'GITHUB_RUN_ID': '88'}), \
             mock.patch.object(sys, 'argv', ['pr-verdict.py', '--repo', 'o/r', '--sha', 'head']), \
             mock.patch.object(sys, 'stdout'), mock.patch.object(pv, 'pr_meta', return_value=([{'number': 1, 'state': 'open'}], [], [])), \
             mock.patch.object(pv, 'read', return_value=(gh.runs, {})), mock.patch.object(pv, 'quota_line', return_value=''), \
             mock.patch.object(pv, 'main_state_module', side_effect=lambda repo, ref, name='main_e2e_state':
                               mock.Mock(prepare=lambda *a: (set(), str)) if name == 'pr_ai_number' else real_load(repo, ref, name)), \
             mock.patch.object(pv, 'gh', side_effect=lambda *a, **kw: posts.append(a) if '/statuses/' in ' '.join(a) else gh(*a, **kw)):
            self.assertEqual(pv.main(), 0)
        self.assertEqual(len(posts), 1)
        self.assertIn('state=success', posts[0])
        self.assertTrue(any('SLOWER' in arg and 'Jobs check with slow AI' in arg for arg in posts[0]), posts)
        self.assertFalse(any('promise' in arg for arg in posts[0]), posts)


if __name__ == '__main__':
    unittest.main()
