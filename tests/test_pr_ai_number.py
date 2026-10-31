# Tests the PR's informational AI number with in-memory GitHub artifacts, never live services.
# Job: report health
import copy
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from fractions import Fraction
from pathlib import Path

from tools import main_e2e_state
from tools import pr_ai_number as ai


RATES = {'v': 1, 'facts': {'exact': 63, 'total': 63}, 'flags': {'judged': 9, 'flagged': 1},
         'cv': {'found': 6, 'expected': 6, 'corrected': 0}, 'steady': None, 'ranking': 'ok', 'caps': 'ok'}
SAME = 'AI: facts 63/63 (main 63/63) · flags 1/9 (main 1/9) · CV 6/6 (main 6/6) · same as main'


def archive(value=RATES, raw=None):
    """A real artifact ZIP containing the producer's JSON contract."""
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as z:
        z.writestr('quality-rates.json', raw if raw is not None else json.dumps(value))
    return data.getvalue()


def run(rid, title='E2E check · on time', **extra):
    """Main-state API run fixture; not a recorded live measurement."""
    return {'id': rid, 'head_branch': 'main', 'status': 'completed', 'conclusion': 'success', 'display_title': title, **extra}


class Github:
    """Injected GitHub transport: any unplanned API call fails without network access."""
    def __init__(self, runs=(), artifacts=None, blobs=None, nights=()):
        self.runs, self.artifacts, self.blobs, self.calls = list(runs), artifacts or {}, blobs or {}, []
        self.nights = list(nights)

    def __call__(self, *args, binary=False):
        self.calls.append((args, binary))
        url = next(a for a in args if a.startswith('repos/'))
        if '/workflows/e2e.yml/runs?' in url:
            return json.dumps({'workflow_runs': self.runs})
        if '/workflows/desktop.yml/runs?' in url:
            return json.dumps({'workflow_runs': self.nights})
        if '/contents/desktop/e2e/lanes.json' in url:
            return json.dumps({'suites': {'qualityai': {'lane': 'tolerant', 'pr': 'number'}}})
        if '/jobs?' in url:
            return json.dumps([{'jobs': [{'name': 'E2E · Mac + Linux · qualityai', 'status': 'completed', 'conclusion': 'success'}]}])
        if '/artifacts?' in url:
            rid = int(url.split('/runs/')[1].split('/')[0])
            return json.dumps([{'artifacts': self.artifacts.get(rid, [])}])
        if url.endswith('/zip'):
            assert binary
            return self.blobs[int(url.split('/artifacts/')[1].split('/')[0])]
        raise AssertionError(f'unplanned call: {args}')


class Formatting(unittest.TestCase):
    def test_exact_status_and_missing_baseline(self):
        self.assertEqual(ai.description('3 workflow(s) green in 2.0 min', RATES, RATES), SAME)
        self.assertEqual(ai.description('', RATES, None),
                         'AI: facts 63/63 (main n/a) · flags 1/9 (main n/a) · CV 6/6 (main n/a) · main unavailable')

    def test_exact_lower_and_better_statuses(self):
        current = copy.deepcopy(RATES)
        current['facts']['exact'] = 61
        self.assertEqual(ai.description('', current, RATES),
                         'AI: facts 61/63 (main 63/63) · flags 1/9 (main 1/9) · CV 6/6 (main 6/6) · lower than main')
        base = copy.deepcopy(RATES)
        base['facts']['exact'] = 60
        self.assertEqual(ai.description('', RATES, base),
                         'AI: facts 63/63 (main 60/63) · flags 1/9 (main 1/9) · CV 6/6 (main 6/6) · better than main')

    def test_one_item_boundary_is_same_and_two_items_are_directional(self):
        for metric, numerator, total, worse in [('facts', 'exact', 'total', -1), ('flags', 'flagged', 'judged', 1), ('cv', 'found', 'expected', -1)]:
            base = copy.deepcopy(RATES)
            base[metric] = {**base[metric], numerator: 5, total: 10}
            current = copy.deepcopy(base)
            current[metric][numerator] += worse
            self.assertEqual(ai.comparison(current, base), 'same as main')
            current[metric][numerator] += worse
            self.assertEqual(ai.comparison(current, base), 'lower than main')
            current[metric][numerator] = 5 - 2 * worse
            self.assertEqual(ai.comparison(current, base), 'better than main')

    def test_shares_use_both_denominators_and_exact_arithmetic(self):
        current, base = copy.deepcopy(RATES), copy.deepcopy(RATES)
        current['flags'] = {'judged': 18, 'flagged': 2}
        self.assertEqual(ai.comparison(current, base), 'same as main')
        self.assertEqual(ai.item_difference(3, 10, 2, 20), Fraction(1, 5))
        base['facts'], current['facts'] = {'exact': 6, 'total': 10}, {'exact': 16, 'total': 20}
        self.assertEqual(ai.comparison(current, base), 'better than main')

    def test_a_mixed_result_names_the_degradation(self):
        base = copy.deepcopy(RATES)
        base['flags']['flagged'] = 3
        current = copy.deepcopy(base)
        current['facts']['exact'] -= 2
        current['flags']['flagged'] = 1
        self.assertEqual(ai.comparison(current, base), 'lower than main')

    def test_nulls_zero_denominators_and_missing_pr_are_not_zero_scores(self):
        current = copy.deepcopy(RATES)
        current['cv'] = None
        self.assertIn('CV n/a (main 6/6) · n/a', ai.description('', current, RATES))
        current['flags'] = {'judged': 0, 'flagged': 0}
        self.assertIn('flags n/a', ai.description('', current, RATES))
        self.assertEqual(ai.description('', None, RATES),
                         'AI: facts n/a (main 63/63) · flags n/a (main 1/9) · CV n/a (main 6/6) · n/a')

    def test_drop_cv_first_and_keep_grey_or_red_context_without_splitting_counts(self):
        why = 'tolerant: quality (AI, clock or outside: not a PR red); 3 workflow(s) green in 2.0 min'
        line = ai.description(why, RATES, RATES)
        self.assertLessEqual(len(line), 140)
        self.assertTrue(line.startswith('tolerant: quality'), line)
        self.assertNotIn(' · CV ', line)
        self.assertIn('flags 1/9 (main 1/9)', line)
        self.assertTrue(ai.description('red: e2e settings', RATES, RATES).startswith('red: e2e settings · AI:'))
        huge = copy.deepcopy(RATES)
        huge['facts'] = {'exact': 10**100, 'total': 10**100}
        self.assertLessEqual(len(ai.description('red: ' + 'settings ' * 30, huge, huge)), 140)

    def test_contract_validation_rejects_impossible_or_nonintegral_counts(self):
        self.assertEqual(ai.valid_rates(RATES), RATES)
        for invalid in ({**RATES, 'v': 2}, {**RATES, 'v': True}, {**RATES, 'facts': {'exact': 64, 'total': 63}},
                        {**RATES, 'flags': {'judged': 9, 'flagged': -1}}, {**RATES, 'cv': {'found': True, 'expected': 6, 'corrected': 0}},
                        {**RATES, 'ranking': []}, {**RATES, 'caps': 0}):
            self.assertIsNone(ai.valid_rates(invalid))


class UsualRange(unittest.TestCase):
    def fixture(self, exact=40, nights=3):
        """Use independent 100-item observations with main at 90%, served only by the GitHub fake."""
        baseline = {**copy.deepcopy(RATES), 'facts': {'exact': 90, 'total': 100},
                    'flags': {'judged': 100, 'flagged': 10}, 'cv': {'found': 90, 'expected': 100, 'corrected': 0},
                    'steady': {'pairs': 100, 'within8': 90}}
        current = {**copy.deepcopy(baseline), 'facts': {'exact': exact, 'total': 100}}
        history = [run(rid, 'E2E check · nightly backup', event='schedule') for rid in range(20, 20 - nights, -1)]
        ids = [99, 30, *[night['id'] for night in history]]
        gh = Github([run(30, 'E2E after merge · sha · qualityai')],
                    {rid: [{'id': rid, 'name': ai.ARTIFACT}] for rid in ids},
                    {rid: archive(current if rid == 99 else baseline) for rid in ids}, nights=history)
        return gh, current, baseline

    def pr_line(self, github, why='success: checks green'):
        """Exercise preparation without allowing the description to mutate the verdict inputs."""
        runs = [{'databaseId': 99, 'displayTitle': 'E2E for PR · qualityai · topic'}]
        jobs = {99: [{'name': 'qualityai', 'status': 'completed', 'conclusion': 'success'}]}
        before = copy.deepcopy((runs, jobs))
        reports, line = ai.prepare('o/r', runs, jobs, github,
                                   lambda name='main_e2e_state': __import__('tools.' + name, fromlist=[name]))
        self.assertEqual(reports, {'qualityai'})
        result = line(why)
        self.assertEqual((runs, jobs), before)
        self.assertLessEqual(len(result), 140)
        return result

    def test_clearly_below_pr_names_the_range_and_preserves_success_context(self):
        for part, observation in [('facts', {'exact': 40, 'total': 100}),
                                  ('flags', {'flagged': 60, 'judged': 100}),
                                  ('cv', {'found': 40, 'expected': 100, 'corrected': 0}),
                                  ('steady', {'within8': 40, 'pairs': 100})]:
            with self.subTest(metric=part):
                gh, current, _ = self.fixture(exact=90)
                current[part] = observation
                gh.blobs[99] = archive(current)
                line = self.pr_line(gh)
                self.assertIn("BELOW main's range", line)
                self.assertTrue(line.startswith('success:'), line)

    def test_inside_band_and_fewer_than_three_nights_keep_existing_wording(self):
        for exact, nights, ending in [(89, 3, 'same as main'), (40, 0, 'lower than main'),
                                      (40, 1, 'lower than main'), (40, 2, 'lower than main')]:
            with self.subTest(exact=exact, nights=nights):
                gh, _, _ = self.fixture(exact, nights)
                line = self.pr_line(gh)
                self.assertNotIn('BELOW', line)
                self.assertTrue(line.endswith(ending), line)

    def test_missing_observations_do_not_become_a_below_result(self):
        for missing in ('current', 'history'):
            with self.subTest(missing=missing):
                gh, current, baseline = self.fixture()
                if missing == 'current':
                    current['facts'] = None
                    gh.blobs[99] = archive(current)
                else:
                    baseline['facts'] = None
                    for rid in (20, 19, 18):
                        gh.blobs[rid] = archive(baseline)
                self.assertNotIn('BELOW', self.pr_line(gh))

    def test_below_survives_description_truncation(self):
        _, current, baseline = self.fixture()
        huge = copy.deepcopy(current)
        huge['facts'] = {'exact': 10**100, 'total': 10**100}
        for counts in (current, huge):
            for why in ('', 'success: checks green', 'success: ' + 'checks ' * 100):
                with self.subTest(why=why, counts=counts):
                    line = ai.description(why, counts, baseline, True)
                    self.assertIn('BELOW', line)
                    self.assertLessEqual(len(line), 140)

    def test_beta_gate_and_pr_text_agree_on_the_same_observations(self):
        from tools import beta_rate_gate
        for exact, blocked in ((40, True), (89, False)):
            with self.subTest(exact=exact):
                gh, _, _ = self.fixture(exact)
                status, lines = beta_rate_gate.check('o/r', 99, {'qualityai': {'lane': 'tolerant', 'input': 'ai'}}, gh)
                self.assertEqual(status, int(blocked))
                self.assertEqual(any('BLOCKED' in line for line in lines), blocked)
                self.assertEqual('BELOW' in self.pr_line(gh), blocked)


class Artifacts(unittest.TestCase):
    def pr_line(self, github):
        """Run the PR preparation and formatter with only GitHub responses replaced."""
        runs = [{'databaseId': 99, 'displayTitle': 'E2E for PR · qualityai · topic'}]
        jobs = {99: [{'name': 'qualityai', 'status': 'completed', 'conclusion': 'success'}]}
        _, line = ai.prepare('o/r', runs, jobs, github, lambda name='main_e2e_state': __import__('tools.' + name, fromlist=[name]))
        return line('3 workflow(s) green in 2.0 min')

    def test_failed_qualityai_requires_number_evidence_for_all_conclusions_and_job_shapes(self):
        # A produced zero score is informational even without BASE exemptions; absent/empty counts prove no number.
        low = {**RATES, 'facts': {'exact': 0, 'total': 63}}
        empty = {**RATES, 'facts': None, 'flags': None, 'cv': None}
        for conclusion in ('failure', 'timed_out', 'cancelled', 'startup_failure', 'neutral'):
            for name in ('qualityai', 'E2E · Mac + Linux · qualityai-1of2'):
                for counts, expected in ((None, 'failure'), (empty, 'failure'), (low, 'success')):
                    for registry in (True, False):
                        with self.subTest(conclusion=conclusion, name=name, counts=counts, registry=registry):
                            post = self.qualityai_post(conclusion, name, counts, registry)
                            self.assertIn('state=' + expected, post)
                            if counts == low:
                                self.assertTrue(any('facts 0/63' in arg for arg in post), post)

    def test_artifact_read_errors_stay_pending_instead_of_becoming_a_lasting_red(self):
        for stage in ('/artifacts?', '/zip'):
            with self.subTest(stage=stage):
                post = self.qualityai_post('timed_out', 'E2E · qualityai', RATES, False, stage)
                self.assertIn('state=pending', post)

    def qualityai_post(self, conclusion, name, counts, registry, fail_at='', attempt=1, previous=False, peer=False, age_min=0):
        """Run the real status writer/number reader; replace only GitHub and external evidence reads."""
        from unittest import mock
        from tests.test_pr_verdict import pv, run as pr_run
        from datetime import datetime, timedelta, timezone
        end = datetime.now(timezone.utc) - timedelta(minutes=age_min)
        stamp = lambda value: value.isoformat().replace('+00:00', 'Z')
        key = 'qualityai-1of2' if name.endswith('-1of2') else 'qualityai'
        artifact = {'id': 7, 'name': 'e2e-artifacts-' + ('qualityai' if peer else key),
                    'created_at': stamp(end - timedelta(minutes=20 if previous else 1))}
        github = Github([], {7: [artifact]} if counts else {}, {7: archive(counts)} if counts else {})
        r = pr_run('E2E', conclusion=conclusion, event='workflow_dispatch', title='E2E for PR · qualityai · topic', id=7,
                   end=stamp(end)); r['attempt'] = attempt
        fields = {'run_id': 7, 'run_attempt': attempt, 'started_at': stamp(end - timedelta(minutes=5)), 'completed_at': stamp(end)}
        jobs = {7: [dict(fields, id=71, name=name, status='completed', conclusion=conclusion)]}
        if peer:
            jobs[7].append(dict(fields, id=72, name='qualityai', status='completed', conclusion='success'))
        sent = []
        def gh(*args, **kwargs):
            if fail_at and fail_at in ' '.join(args):
                if fail_at == '/zip': raise subprocess.CalledProcessError(1, ['gh'], stderr='gh: Not Found (HTTP 404)')
                raise OSError('transient artifact transport failure')
            if not registry and '/contents/desktop/e2e/lanes.json' in ' '.join(args): return '{"suites": {}}'
            if '/statuses/' in ' '.join(args): sent.append(args); return '{}'
            return github(*args, **kwargs)
        with mock.patch.object(sys, 'argv', ['pr-verdict.py', '--repo', 'o/r', '--sha', 'head']), \
             mock.patch.object(sys, 'stdout'), mock.patch.object(pv, 'read', return_value=([r], jobs)), \
             mock.patch.object(pv, 'pr_meta', return_value=([{'number': 1, 'state': 'open'}], [], [])), \
             mock.patch.object(pv, 'gh', side_effect=gh), mock.patch.object(pv, 'quota_line', return_value=''), \
             mock.patch.object(pv, 'main_red_greys', return_value={71}), \
             mock.patch.object(pv, 'lane_greys', return_value={71: 'tolerant'}), \
             mock.patch.object(pv, 'health_greys', return_value={71: 'ai-credit'}):
            self.assertEqual(pv.main(), 0)
        self.assertEqual(len(sent), 1)
        return sent[0]

    def test_pr_compares_with_after_merge_main_artifact(self):
        # Hand-made API responses use the supervisor's run/title shapes and reported counts; no live service is reached.
        rates = {**RATES, 'facts': {'exact': 68, 'total': 69}, 'flags': {'judged': 20, 'flagged': 1},
                 'cv': {'found': 8, 'expected': 9, 'corrected': 1}, 'steady': {'pairs': 10, 'within8': 10}}
        runs = [run(rid, f'E2E after merge · {sha} · quality,qualityai,settings')
                for rid, sha in [(40970607939, '3adb386'), (40967443209, 'e238a08'), (40963836597, 'f58e901')]]
        gh = Github(runs, {40970607939: [{'id': 12940402913, 'name': ai.ARTIFACT}],
                           99: [{'id': 99, 'name': ai.ARTIFACT}]}, {12940402913: archive(rates), 99: archive(rates)})
        line = self.pr_line(gh)
        self.assertIn('facts 68/69 (main 68/69)', line)
        self.assertIn('same as main', line)
        self.assertLessEqual(len(line), 140)

    def test_completed_failed_or_cancelled_main_run_still_supplies_its_measurement(self):
        for conclusion in ('failure', 'cancelled'):
            with self.subTest(conclusion=conclusion):
                gh = Github([run(30, 'E2E after merge · sha · qualityai', conclusion=conclusion)],
                            {rid: [{'id': rid, 'name': ai.ARTIFACT}] for rid in (99, 30)},
                            {99: archive(), 30: archive()})
                self.assertIn('same as main', self.pr_line(gh))

    def test_pr_uses_newest_desktop_night_when_main_e2e_has_no_artifact(self):
        older = {**RATES, 'facts': {'exact': 60, 'total': 63}}
        nights = [run(20, 'E2E check · nightly backup', event='schedule'),
                  run(19, 'Nightly beta', event='workflow_dispatch')]
        gh = Github([run(30, 'E2E after merge · sha · settings')],
                    {rid: [{'id': rid, 'name': ai.ARTIFACT}] for rid in (99, 20, 19)},
                    {99: archive(), 20: archive(), 19: archive(older)}, nights=nights)
        line = self.pr_line(gh)
        self.assertIn('facts 63/63 (main 63/63)', line)
        self.assertIn('same as main', line)

    def test_broken_newest_main_artifact_does_not_use_older_main_or_nightly(self):
        gh = Github([run(30, 'E2E after merge · sha · qualityai'), run(29)],
                    {rid: [{'id': rid, 'name': ai.ARTIFACT}] for rid in (99, 30, 29, 20)},
                    {99: archive(), 30: b'broken ZIP', 29: archive(), 20: archive()},
                    nights=[run(20, 'E2E check · nightly backup', event='schedule')])
        self.assertIn('main unavailable', self.pr_line(gh))
        self.assertFalse(any('/workflows/desktop.yml/' in ' '.join(args) for args, _ in gh.calls))

    def test_broken_newest_night_is_unavailable_and_downloads_no_older_night(self):
        gh = Github([], {rid: [{'id': rid, 'name': ai.ARTIFACT}] for rid in (99, 20, 19)},
                    {99: archive(), 20: b'broken ZIP', 19: archive()},
                    nights=[run(20, 'E2E check · nightly backup', event='schedule'),
                            run(19, 'E2E check · nightly backup', event='schedule')])
        self.assertIn('main unavailable', self.pr_line(gh))
        nightly_downloads = [args[-1] for args, binary in gh.calls if binary and '/artifacts/99/' not in args[-1]]
        self.assertEqual(nightly_downloads, ['repos/o/r/actions/artifacts/20/zip'])

    def test_pr_mutant_bisect_branch_and_unfinished_runs_cannot_supply_main_number(self):
        for rejected in (run(30, 'E2E for PR · qualityai · main'), run(30, 'Mutant qualityai'),
                         run(30, 'Bisect qualityai sha'), run(30, head_branch='topic'), run(30, status='in_progress')):
            with self.subTest(run=rejected):
                gh = Github([rejected, run(29)], {rid: [{'id': rid, 'name': ai.ARTIFACT}] for rid in (99, 30, 29)},
                            {99: archive(), 30: archive({**RATES, 'facts': {'exact': 0, 'total': 63}}), 29: archive()})
                self.assertIn('same as main', self.pr_line(gh))

    def test_main_uses_comparable_runs_only_and_searches_at_most_ten(self):
        runs = [run(20, 'Bisect qualityai abc'), run(19, 'Beta E2E tests desktop-v1'),
                run(18, 'Mutant ai'), run(17, 'RC soak v1'), run(16, 'Stable canary v1'),
                run(15, head_branch='topic'), run(14, 'E2E after merge · sha · qualityai'), run(13), run(12), run(11), run(10)]
        gh = Github(runs, {12: [{'id': 112, 'name': ai.ARTIFACT, 'expired': False}],
                           10: [{'id': 110, 'name': ai.ARTIFACT}]}, {112: archive()})
        self.assertEqual(ai.main_rates('o/r', gh, main_e2e_state.is_main_check), RATES)
        asked = ' '.join(' '.join(a) for a, _ in gh.calls)
        self.assertIn('/runs/14/', asked)
        self.assertNotIn('/runs/10/', asked)
        self.assertIn('per_page=10', asked)

    def test_missing_expired_broken_and_wrong_version_baselines_are_unavailable(self):
        for artifacts, blobs in [({}, {}), ({1: [{'id': 1, 'name': ai.ARTIFACT, 'expired': True}]}, {}),
                                 ({1: [{'id': 1, 'name': ai.ARTIFACT}]}, {1: b'broken ZIP'}),
                                 ({1: [{'id': 1, 'name': ai.ARTIFACT}]}, {1: archive(raw='{bad')}),
                                 ({1: [{'id': 1, 'name': ai.ARTIFACT}]}, {1: archive({**RATES, 'v': 2})})]:
            with self.subTest(artifacts=artifacts, blobs=blobs):
                self.assertIsNone(ai.main_rates('o/r', Github([run(1)], artifacts, blobs), main_e2e_state.is_main_check))

    def test_newest_artifact_wins_and_an_invalid_newest_never_reverts_to_an_old_number(self):
        gh = Github([run(2), run(1)], {2: [{'id': 22, 'name': ai.ARTIFACT}, {'id': 21, 'name': ai.ARTIFACT}],
                                    1: [{'id': 10, 'name': ai.ARTIFACT}]}, {22: archive({**RATES, 'v': 3})})
        self.assertIsNone(ai.main_rates('o/r', gh, main_e2e_state.is_main_check))
        self.assertEqual(sum(binary for _, binary in gh.calls), 1)

    def test_pr_uses_newest_counted_run_and_never_invents_a_missing_measurement(self):
        runs = [{'databaseId': rid, 'createdAt': f'2026-10-29T12:0{rid}:00Z',
                 'displayTitle': 'E2E for PR · qualityai,settings · topic'} for rid in (1, 2)]
        jobs = {rid: [{'name': 'qualityai', 'status': 'completed', 'conclusion': 'success'}] for rid in (1, 2)}
        gh = Github([], {2: [{'id': 22, 'name': ai.ARTIFACT}]}, {22: archive()})
        self.assertEqual(ai.numbers('o/r', runs, jobs, gh, main_e2e_state.is_main_check), (RATES, None, False))
        for conclusion in ('failure', 'cancelled', 'timed_out', None):
            jobs[2][0].update(status='in_progress' if conclusion is None else 'completed', conclusion=conclusion)
            self.assertEqual(ai.numbers('o/r', runs, jobs, Github(), main_e2e_state.is_main_check), (None, None, False))

    def test_lane_lookup_is_base_scoped_and_only_tolerant_number_entries_count(self):
        calls = []
        def gh(*args):
            calls.append(args)
            return json.dumps({'suites': {'qualityai': {'lane': 'tolerant', 'pr': 'number'},
                                         'notion-real': {'lane': 'tolerant'}, 'settings': {'lane': 'backbone', 'pr': 'number'}}})
        self.assertEqual(ai.report_suites('o/r', gh, 'release'), {'qualityai'})
        self.assertTrue(calls[0][-1].endswith('lanes.json?ref=release'))

    def test_absent_qualityai_or_failed_api_never_produces_a_fake_measurement(self):
        self.assertIsNone(ai.numbers('o/r', [], {}, Github(), main_e2e_state.is_main_check))
        def broken(*args, **kwargs):
            raise OSError('unavailable')
        self.assertIsNone(ai.main_rates('o/r', broken, main_e2e_state.is_main_check))
        self.assertEqual(ai.report_suites('o/r', broken), set())

    def test_main_classifier_failure_preserves_the_pr_number_and_says_main_unavailable(self):
        def broken(_):
            raise OSError('main state helper unavailable')
        runs = [{'databaseId': 2, 'displayTitle': 'E2E for PR · qualityai · topic'}]
        jobs = {2: [{'name': 'qualityai', 'status': 'completed', 'conclusion': 'success'}]}
        gh = Github([run(1)], {2: [{'id': 22, 'name': ai.ARTIFACT}]}, {22: archive()})
        self.assertEqual(ai.numbers('o/r', runs, jobs, gh, broken), (RATES, None, False))

    def test_the_suites_own_ending_writer_can_read_its_uploaded_success(self):
        runs = [{'databaseId': 2, 'displayTitle': 'E2E for PR · qualityai · topic'}]
        jobs = {2: [{'name': 'qualityai', 'status': 'in_progress', 'runner_name': 'ours'}]}
        gh = Github([], {2: [{'id': 22, 'name': ai.ARTIFACT}]}, {22: archive()})
        self.assertEqual(ai.numbers('o/r', runs, jobs, gh, main_e2e_state.is_main_check, '2', 'success', 'ours'), (RATES, None, False))

    def test_a_finished_failure_cannot_be_reinterpreted_by_a_stale_own_status(self):
        runs = [{'databaseId': 2, 'displayTitle': 'E2E for PR · qualityai · topic'}]
        jobs = {2: [{'name': 'qualityai', 'status': 'completed', 'conclusion': 'failure', 'runner_name': 'ours'}]}
        gh = Github()
        self.assertEqual(ai.numbers('o/r', runs, jobs, gh, main_e2e_state.is_main_check, '2', 'success', 'ours'), (None, None, False))
        self.assertTrue(any('/artifacts?' in ' '.join(args) for args, _ in gh.calls), 'finished failures need artifact evidence, never the stale own-status')


FAKE_GH = r'''import json, os, sys
from pathlib import Path
root = Path(os.environ['FAKE_DIR'])
a = sys.argv[1:]
with (root / 'calls').open('a') as f: f.write(json.dumps(a) + '\n')
if a[:2] == ['run', 'list']:
    sys.stdout.write((root / 'runs.json').read_text()); sys.exit()
if a[:2] == ['api', 'graphql']:
    sys.stdout.write((root / 'meta.json').read_text()); sys.exit()
url = next(x for x in a if x.startswith('repos/') or x == 'rate_limit')
if '/statuses/' in url:
    (root / 'written.json').write_text(json.dumps(a)); sys.exit()
if '/contents/tools/' in url:
    sys.stdout.write((root / url.split('/contents/tools/')[1].split('?')[0]).read_text())
elif '/contents/desktop/e2e/lanes.json' in url:
    print(json.dumps({'suites': {'qualityai': {'lane': 'tolerant', 'pr': 'number'}, 'notion-real': {'lane': 'tolerant'}}}))
elif '/workflows/e2e.yml/runs?' in url:
    print(json.dumps({'workflow_runs': [] if os.environ.get('FAKE_NIGHTLY') else [{'id': 10, 'head_branch': 'main', 'status': 'completed', 'conclusion': 'success', 'display_title': 'E2E check · on time'}]}))
elif '/workflows/desktop.yml/runs?' in url:
    print(json.dumps({'workflow_runs': [{'id': 20, 'head_branch': 'main', 'status': 'completed', 'event': 'schedule', 'display_title': 'E2E check · nightly backup'}]}))
elif '/jobs?' in url:
    jobs = [{'id': 71, 'name': 'E2E · Mac + Linux · qualityai' if '/runs/20/' in url else 'qualityai', 'status': 'completed', 'conclusion': 'success'}]
    print(json.dumps([{'jobs': jobs}] if '--slurp' in a else jobs))
elif '/artifacts?' in url:
    print(json.dumps([{'artifacts': [{'id': 22, 'name': 'e2e-artifacts-qualityai'}]}]))
elif url.endswith('/zip'):
    sys.stdout.buffer.write((root / 'rates.zip').read_bytes())
elif url == 'rate_limit':
    print(json.dumps({'resources': {'core': {'remaining': 10, 'limit': 1000}, 'graphql': {'remaining': 100, 'limit': 5000}}}))
else:
    sys.exit('No network: unexpected gh call ' + repr(a))
'''


class StandaloneWriter(unittest.TestCase):
    def test_copied_script_loads_its_helpers_and_posts_the_number(self):
        self.copied_writer()

    def test_copied_script_loads_the_shared_nightly_reader_and_posts_the_number(self):
        self.copied_writer(nightly=True)

    def copied_writer(self, nightly=False):
        """Run the copied CI writer with fetched companion files and an offline gh executable."""
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as folder:
            tmp = Path(folder)
            copied = tmp / 'standalone'
            copied.mkdir()
            (copied / 'pr-verdict.py').write_text((root / 'tools/pr-verdict.py').read_text())
            for name in ('pr_ai_number.py', 'main_e2e_state.py', 'beta_rate_gate.py', 'pr_speed_number.py', 'pr_verdict_runs.py'):
                (tmp / name).write_text((root / 'tools' / name).read_text())
            gh = tmp / 'gh'
            gh.write_text(f'#!{sys.executable}\n' + FAKE_GH)
            gh.chmod(0o755)
            (tmp / 'rates.zip').write_bytes(archive())
            (tmp / 'runs.json').write_text(json.dumps([{'databaseId': 7, 'workflowName': 'E2E', 'event': 'workflow_dispatch',
                'status': 'completed', 'conclusion': 'success', 'createdAt': '2026-10-29T12:00:00Z',
                'updatedAt': '2026-10-29T12:01:00Z', 'displayTitle': 'E2E for PR · qualityai · topic'}]))
            (tmp / 'meta.json').write_text(json.dumps({'data': {'repository': {'object': {'associatedPullRequests': {'nodes': [
                {'number': 1, 'state': 'OPEN', 'mergedAt': None, 'files': {'pageInfo': {'hasNextPage': False}, 'nodes': []}, 'commits': {'nodes': []}}]}}}}}))
            env = {**os.environ, 'PATH': folder + os.pathsep + os.environ['PATH'], 'FAKE_DIR': folder,
                   'GITHUB_RUN_ID': '99', 'GITHUB_SHA': 'head', 'GITHUB_BASE_REF': 'release', 'PYTHONDONTWRITEBYTECODE': '1'}
            if nightly:
                env['FAKE_NIGHTLY'] = '1'
            command = [sys.executable, str(copied / 'pr-verdict.py'), '--repo', 'o/r']
            done = subprocess.run([*command, '--sha', 'head'], env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(done.returncode, 0, done.stderr)
            posted = json.loads((tmp / 'written.json').read_text())
            self.assertIn('description=' + SAME, posted)
            self.assertIn('state=success', posted)
            calls = (tmp / 'calls').read_text()
            self.assertIn('lanes.json?ref=release', calls)
