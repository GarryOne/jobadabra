"""Canary auto-promote decision (tools/canary_promote.py): age, CI state, reported problems, already stable, and
positive usage evidence from app reports (silence is not health)."""
import importlib.util
import json
import subprocess
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'tools' / 'canary_promote.py'
FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'canary_builds.json'
SPEC = importlib.util.spec_from_file_location('canary_promote', SCRIPT)
canary = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(canary)

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)


def release(n, hours_ago, pre=True, latest=False, draft=False):
    at = datetime.fromtimestamp(NOW.timestamp() - hours_ago * 3600, timezone.utc).isoformat().replace('+00:00', 'Z')
    return {'tagName': f'desktop-v0.5.{n}', 'isPrerelease': pre, 'isLatest': latest, 'isDraft': draft,
            'publishedAt': at, 'createdAt': at}


GREEN = [{'status': 'completed', 'conclusion': 'success'}]


def ago(hours):
    return datetime.fromtimestamp(NOW.timestamp() - hours * 3600, timezone.utc).isoformat().replace('+00:00', 'Z')


def evidence(installs=3, days=3, first=60, last=6, ok=40, failed=0, crash=0, run_failed=0):
    """One GET /telemetry/version entry: health lines from `first` to `last` hours ago."""
    return {'installs': installs, 'healthInstalls': installs, 'healthDays': days,
            'firstSeen': ago(first) if installs else None, 'lastSeen': ago(last) if installs else None,
            'healthFirst': ago(first) if installs else None, 'healthLast': ago(last) if installs else None,
            'runs': {'ok': ok, 'failed': failed, 'reports': days},
            'events': {'crash': crash, 'run_failed': run_failed, 'stuck': 0, 'form_issue': 0, 'health': days}}


HEALTHY = evidence()
STABLE_USAGE = evidence(installs=4, days=30, first=900, last=2, ok=200, failed=4)


def e2e(*hours_ago, result='success'):
    """Completed end-to-end runs on the candidate's commit, newest first."""
    return [{'conclusion': result, 'createdAt': ago(h)} for h in sorted(hours_ago)]


E2E_GREEN = e2e(2, 14, 30)   # three green runs over 28 h
SHA = 'abc1234def'


class Facts:
    def __init__(self, ci=GREEN, telemetry=(), fill=(), ext=None, usage=HEALTHY, stable_usage=STABLE_USAGE, unavailable=None, runs=E2E_GREEN, blockers=()):
        self.ci, self.tel, self.fill, self.ext = ci, list(telemetry), list(fill), ext or {}
        self.usage_, self.stable_usage, self.unavailable = usage, stable_usage, unavailable
        self.runs, self.blockers = list(runs), list(blockers)

    def sha(self, tag):
        return SHA

    def e2e_runs(self, tag):
        return self.runs

    def blocking_issues(self):
        return self.blockers

    def usage(self, version, stable_version):
        if self.unavailable:
            raise canary.EvidenceUnavailable(self.unavailable)
        return {version: self.usage_, **({stable_version: self.stable_usage} if self.stable_usage else {})}

    def ci_runs(self, tag):
        return self.ci

    def telemetry(self):
        return self.tel

    def fill_failures(self):
        return self.fill

    def extension_version(self, tag):
        return self.ext.get(tag, '0.8.15')


STABLE = release(60, 100, pre=False, latest=True)


class CanaryPromoteTests(unittest.TestCase):
    def test_promotes_a_clean_build_older_than_48_hours(self):
        result = canary.decide([release(66, 2), release(65, 50), STABLE], NOW, Facts())
        self.assertTrue(result['promote'])
        self.assertEqual(result['tag'], 'desktop-v0.5.65')

    def test_waits_while_every_newer_build_is_under_48_hours(self):
        result = canary.decide([release(66, 2), release(65, 47), STABLE], NOW, Facts())
        self.assertFalse(result['promote'])
        self.assertIn('47 h', result['reasons'][0])

    def test_nothing_when_newest_is_already_stable(self):
        result = canary.decide([release(66, 60, pre=False, latest=True), release(65, 70)], NOW, Facts())
        self.assertFalse(result['promote'])
        self.assertIsNone(result['tag'])
        self.assertIn('nothing newer than stable', result['reasons'][0])

    def test_drafts_are_still_building(self):
        result = canary.decide([release(66, 60, draft=True), STABLE], NOW, Facts())
        self.assertFalse(result['promote'])

    def test_red_or_missing_ci_blocks(self):
        for ci in ([{'status': 'completed', 'conclusion': 'failure'}], [{'status': 'in_progress', 'conclusion': None}], []):
            result = canary.decide([release(65, 50), STABLE], NOW, Facts(ci=ci))
            self.assertFalse(result['promote'], ci)

    def test_a_telemetry_problem_in_the_candidate_blocks(self):
        issue = {'number': 7, 'title': 'App report: crash [t:abc]', 'state': 'CLOSED',
                 'body': 'versions 0.5.64', 'comments': [{'body': 'Back in a newer version. versions 0.5.65'}]}
        result = canary.decide([release(65, 50), STABLE], NOW, Facts(telemetry=[issue]))
        self.assertFalse(result['promote'])
        self.assertTrue(any('#7' in reason for reason in result['reasons']))

    def test_a_problem_stable_already_has_is_not_new(self):
        issue = {'number': 8, 'title': 'App report: x', 'state': 'OPEN', 'body': 'Versions seen: 0.5.60,0.5.65'}
        self.assertTrue(canary.decide([release(65, 50), STABLE], NOW, Facts(telemetry=[issue]))['promote'])

    def test_versions_match_whole(self):
        self.assertFalse(canary.mentions('versions 0.5.650', '0.5.65'))
        self.assertFalse(canary.mentions('0.5.6', '0.5.65'))
        self.assertTrue(canary.mentions('versions 0.5.64,0.5.65.', '0.5.65'))

    def test_fill_failures_count_only_when_the_extension_changed(self):
        issue = {'number': 9, 'title': 'Fill failure: acme · Name', 'state': 'OPEN', 'body': 'Extension version: `0.8.16`'}
        changed = {'desktop-v0.5.65': '0.8.16', 'desktop-v0.5.60': '0.8.15'}
        self.assertFalse(canary.decide([release(65, 50), STABLE], NOW, Facts(fill=[issue], ext=changed))['promote'])
        same = {'desktop-v0.5.65': '0.8.16', 'desktop-v0.5.60': '0.8.16'}
        self.assertTrue(canary.decide([release(65, 50), STABLE], NOW, Facts(fill=[issue], ext=same))['promote'])

    def wait_with(self, text, **facts):
        result = canary.decide([release(65, 50), STABLE], NOW, Facts(**facts))
        self.assertFalse(result['promote'], result['reasons'])
        self.assertTrue(any(text in reason for reason in result['reasons']), result['reasons'])
        return result

    def test_healthy_usage_promotes_and_shows_the_numbers(self):
        result = canary.decide([release(65, 50), STABLE], NOW, Facts())
        self.assertTrue(result['promote'], result['reasons'])
        self.assertTrue(any('runs 40 ok / 0 failed' in reason for reason in result['reasons']), result['reasons'])

    def test_an_unused_build_waits(self):
        self.wait_with('not used enough', usage=evidence(installs=0, days=0, ok=0))

    def test_reports_on_one_day_only_wait(self):
        self.wait_with('not used enough', usage=evidence(days=1, first=20, last=6))

    def test_two_days_but_under_48_hours_wait(self):
        self.wait_with('not used enough', usage=evidence(days=2, first=30, last=6))

    def test_too_few_successful_runs_wait(self):
        self.wait_with('too few successful runs', usage=evidence(ok=4))

    def test_a_crash_or_failed_run_waits(self):
        self.wait_with('1 crash', usage=evidence(crash=1))
        self.wait_with('1 run_failed', usage=evidence(run_failed=1))

    def test_a_worse_failure_rate_than_stable_waits(self):
        # stable 2 %, candidate 3 of 20 = 15 % > 7 %
        self.wait_with('failure rate 15%', usage=evidence(ok=34, failed=6))
        self.assertTrue(canary.decide([release(65, 50), STABLE], NOW, Facts(usage=evidence(ok=57, failed=3)))['promote'])

    def test_stable_without_data_uses_an_absolute_ceiling(self):
        self.assertTrue(canary.decide([release(65, 50), STABLE], NOW, Facts(usage=evidence(ok=57, failed=3), stable_usage=None))['promote'])
        self.wait_with('no stable baseline', usage=evidence(ok=34, failed=6), stable_usage=None)

    def test_stale_reports_wait(self):
        self.wait_with('not fresh', usage=evidence(first=90, last=30))

    def test_missing_key_or_unreachable_site_waits(self):
        self.wait_with('JOB_PILOTTO_TELEMETRY_KEY is not set', unavailable='JOB_PILOTTO_TELEMETRY_KEY is not set')
        with self.assertRaises(canary.EvidenceUnavailable):
            canary.GitHub(key=None).usage('0.5.65', '0.5.60')

    def test_the_canary_rule_matches_the_shared_fixture(self):
        # tests/fixtures/canary_builds.json is read by desktop/test/canary.test.js too: one rule, three users
        # (this script, tools/prune-releases.sh and the owner's app).
        for case in json.loads(FIXTURE.read_text())['cases']:
            found = canary.canary_of(case['releases'], canary.parse_time(case['now']), floor=case.get('floor', ''))
            self.assertEqual(found and found['tagName'], case['canary'], case['name'])

    def test_the_candidate_is_the_canary_not_the_newest_aged_build(self):
        result = canary.decide([release(67, 60), release(66, 70), STABLE], NOW, Facts())
        self.assertEqual(result['tag'], 'desktop-v0.5.66')

    def test_a_canary_that_failed_for_sure_is_dropped(self):
        red = [{'status': 'completed', 'conclusion': 'failure'}]
        self.assertTrue(canary.decide([release(65, 50), STABLE], NOW, Facts(ci=red))['blocked'])
        self.assertTrue(canary.decide([release(65, 50), STABLE], NOW, Facts(usage=evidence(crash=1)))['blocked'])
        waiting = canary.decide([release(65, 50), STABLE], NOW, Facts(usage=evidence(days=1, first=20, last=6)))
        self.assertFalse(waiting['blocked'])  # not proven yet is not failed: keep trialling it
        running = [{'status': 'in_progress', 'conclusion': None}]
        self.assertFalse(canary.decide([release(65, 50), STABLE], NOW, Facts(ci=running))['blocked'])

    def test_canary_flag_prints_the_tag_for_prune_releases(self):
        case = json.loads(FIXTURE.read_text())['cases'][0]
        releases = [dict(r, createdAt=datetime.now(timezone.utc).isoformat()) for r in case['releases']]
        out = subprocess.run([sys.executable, str(SCRIPT), '--canary'], input=json.dumps(releases),
                             capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(out, 'desktop-v0.5.65')

    def test_prune_keeps_the_newest_beta_of_each_platform(self):
        # 7 Oct 2026: the pruner kept only the newest 3 test builds, so four failed builds deleted desktop-v0.5.16, the only build ever
        # approved for Windows beta testers. The newest approved build of each platform stays (the marks the app reads, desktop/lib/updater.js).
        def api(tag, created, body='', pre=True):
            return {'tag_name': tag, 'created_at': created, 'prerelease': pre, 'draft': False, 'body': body}
        mac = 'Beta-approved: unit suites and every end-to-end suite passed on commit abc (2026-10-07)'
        win = 'Beta-approved (Windows): unit suites and every Windows end-to-end suite passed on commit abc (2026-10-06)'
        releases = [api('desktop-v0.5.23', '2026-10-07T03:10:00Z', mac), api('desktop-v0.5.22', '2026-10-07T02:10:00Z'),
                    api('desktop-v0.5.17', '2026-10-06T16:04:00Z', mac, pre=False), api('desktop-v0.5.16', '2026-10-06T14:00:00Z', 'notes\n' + win),
                    api('desktop-v0.5.15', '2026-10-06T13:00:00Z', win + '\n' + mac)]
        self.assertEqual(canary.beta_kept(releases), {'desktop-v0.5.23', 'desktop-v0.5.16'})
        # a stable release that is the newest approved one needs nothing kept: stable is never pruned
        self.assertEqual(canary.beta_kept([api('desktop-v0.5.17', '2026-10-06T16:04:00Z', mac, pre=False), api('desktop-v0.5.14', '2026-10-06T10:00:00Z', mac)]), set())
        self.assertEqual(canary.beta_kept([api('desktop-v0.5.22', '2026-10-07T02:10:00Z', 'Beta-approved (Windows) maybe')]), set())   # the mark only at a line start, with its colon
        out = subprocess.run([sys.executable, str(SCRIPT), '--beta-kept'], input=json.dumps(releases), capture_output=True, text=True, check=True).stdout.split()
        self.assertEqual(sorted(out), ['desktop-v0.5.16', 'desktop-v0.5.23'])

    def test_version_order(self):
        key = canary.version_key
        self.assertGreater(key('0.5.10'), key('0.5.9'))
        self.assertGreater(key('0.4.0'), key('0.4.0-alpha.99'))
        self.assertGreater(key('0.5.1'), key('0.4.0'))
        self.assertGreater(key('0.5.0'), key('0.4.0-alpha.254'), 'the first plain build is newer than the last alpha one')


class GateFourAndFiveTests(unittest.TestCase):
    def decide(self, **facts):
        return canary.decide([release(65, 50), STABLE], NOW, Facts(**facts))

    def reasons(self, result):
        return ' | '.join(result['reasons'])

    def test_three_green_runs_over_a_day_pass_gate_four(self):
        self.assertTrue(self.decide()['promote'])

    def test_fewer_than_three_green_runs_wait(self):
        result = self.decide(runs=e2e(2, 14))
        self.assertFalse(result['promote'])
        self.assertIn('ran green 2 time(s)', self.reasons(result))
        self.assertFalse(result['blocked'], 'waiting for more runs never drops the build')

    def test_runs_squeezed_into_a_few_hours_wait(self):
        result = self.decide(runs=e2e(1, 2, 3))
        self.assertIn('span under 24 h', self.reasons(result))

    def test_a_red_run_among_the_last_three_waits_even_with_enough_green_ones(self):
        runs = e2e(1, 14, 30, 40)
        runs[0] = {'conclusion': 'failure', 'createdAt': runs[0]['createdAt']}
        result = self.decide(runs=runs)
        self.assertFalse(result['promote'])
        self.assertIn('end-to-end red', self.reasons(result))

    def test_cancelled_and_skipped_runs_say_nothing(self):
        noise = [{'conclusion': 'cancelled', 'createdAt': ago(1)}, {'conclusion': 'skipped', 'createdAt': ago(3)}]
        self.assertTrue(self.decide(runs=noise + E2E_GREEN)['promote'])

    def test_an_open_high_severity_finding_on_this_build_blocks(self):
        issue = {'number': 70, 'title': 'apply: step failed', 'state': 'OPEN', 'labels': [{'name': 'severity:high'}, {'name': 'kind:test-failure'}, {'name': 'auto-ui'}],
                 'body': 'x', 'comments': [{'body': f'Seen again. Build tested: desktop-v0.5.65 @ {SHA[:7]} (workflow_dispatch run)'}]}
        result = self.decide(blockers=[issue])
        self.assertFalse(result['promote'])
        self.assertIn('#70', self.reasons(result))

    def test_a_finding_on_another_commit_or_of_medium_severity_does_not_block(self):
        other = {'number': 71, 'title': 'x', 'state': 'OPEN', 'labels': [{'name': 'severity:high'}], 'body': 'Build tested: main @ 9999999', 'comments': []}
        medium = {'number': 72, 'title': 'x', 'state': 'OPEN', 'labels': [{'name': 'severity:medium'}], 'body': f'@ {SHA[:7]}', 'comments': []}
        self.assertTrue(self.decide(blockers=[other, medium])['promote'])

    def test_a_windows_finding_never_blocks_a_release(self):
        win = {'number': 74, 'title': 'apply: step failed', 'state': 'OPEN', 'labels': [{'name': 'severity:high'}, {'name': 'kind:test-failure'}, {'name': 'platform:windows'}],
               'body': f'Build tested: main @ {SHA[:7]}', 'comments': []}
        self.assertTrue(self.decide(blockers=[win])['promote'])

    def test_a_cosmetic_high_finding_does_not_block(self):
        clipped = {'number': 73, 'title': 'Brand name clipped', 'state': 'OPEN', 'labels': [{'name': 'severity:high'}, {'name': 'kind:text'}], 'body': f'@ {SHA[:7]}', 'comments': []}
        self.assertTrue(self.decide(blockers=[clipped])['promote'])
        wrong = {**clipped, 'number': 74, 'title': 'Status contradicts', 'labels': [{'name': 'severity:high'}, {'name': 'kind:functionality'}]}
        self.assertFalse(self.decide(blockers=[wrong])['promote'])

    def test_two_installs_are_not_enough(self):
        result = self.decide(usage=evidence(installs=2))
        self.assertFalse(result['promote'])
        self.assertIn('>= 3 installs', self.reasons(result))

    def test_thirty_runs_are_needed(self):
        self.assertFalse(self.decide(usage=evidence(ok=29))['promote'])
        self.assertTrue(self.decide(usage=evidence(ok=30))['promote'])

    def test_without_beta_testers_thin_evidence_is_noted_not_blocking(self):
        thin = canary.decide([release(65, 50), STABLE], NOW, Facts(usage=evidence(installs=1, ok=4)), require_beta=False)
        self.assertTrue(thin['promote'])
        self.assertIn('not required while there are no beta testers', self.reasons(thin))
        silent = canary.decide([release(65, 50), STABLE], NOW, Facts(unavailable='no key'), require_beta=False)
        self.assertTrue(silent['promote'])

    def test_without_beta_testers_bad_evidence_still_blocks(self):
        crash = canary.decide([release(65, 50), STABLE], NOW, Facts(usage=evidence(installs=1, ok=4, crash=1)), require_beta=False)
        self.assertFalse(crash['promote'])
        self.assertTrue(crash['blocked'])

    def test_without_beta_testers_gate_four_still_holds(self):
        self.assertFalse(canary.decide([release(65, 50), STABLE], NOW, Facts(runs=e2e(2)), require_beta=False)['promote'])


class RunsForTests(unittest.TestCase):
    def test_counts_runs_on_its_commit_and_its_named_top_ups_only(self):
        runs = [
            {'head_sha': 'mainsha', 'display_title': 'RC soak desktop-v0.5.65', 'conclusion': 'success', 'created_at': 'a'},   # a top-up
            {'head_sha': 'mainsha', 'display_title': 'RC soak desktop-v0.5.64', 'conclusion': 'success', 'created_at': 'b'},   # another release's top-up
            {'head_sha': 'mainsha', 'display_title': 'Stable canary desktop-v0.5.60', 'conclusion': 'success', 'created_at': 'c'},
            {'head_sha': 'abc1234def', 'display_title': 'CI · End-to-end journey', 'conclusion': 'success', 'created_at': 'd'},        # the gate's own run
            {'head_sha': 'mainsha', 'display_title': 'CI · End-to-end journey', 'conclusion': 'failure', 'created_at': 'e'},          # a run of main
            {'head_sha': 'mainsha', 'display_title': 'Gate abc1234def', 'conclusion': 'success', 'created_at': 'f'},                  # the gate: its own commit is main's, the tested one is in the name
            {'head_sha': 'mainsha', 'display_title': 'Gate 999999', 'conclusion': 'success', 'created_at': 'g'},
            {'head_sha': 'mainsha', 'display_title': 'Gate desktop-v0.5.65', 'conclusion': 'success', 'created_at': 'h'},     # the gate run by hand for this tag
            {'head_sha': 'mainsha', 'display_title': 'Beta E2E tests abc1234def', 'conclusion': 'success', 'created_at': 'j'},  # the gate's new name (6 Oct 2026)
            {'head_sha': 'abc1234def', 'display_title': 'Mutant failed-run-ticked', 'conclusion': 'failure', 'created_at': 'i'},   # a mutation test on that commit: red on purpose
        ]
        got = canary.runs_for(runs, 'abc1234def', 'desktop-v0.5.65')
        self.assertEqual([r['createdAt'] for r in got], ['a', 'd', 'f', 'h', 'j'])


class ReleaseRunGate(unittest.TestCase):
    # 7 Oct 2026: the gate runs inside the release run (desktop.yml); gate 4 counts its Mac + Linux gate, never the whole run's colour.
    def test_the_mac_gate_decides_not_the_windows_one(self):
        run = {'created_at': '2026-10-07T10:00:00Z'}
        job = lambda name, conclusion: {'name': name, 'conclusion': conclusion}
        green = [job('Build · Mac', 'success'), job('E2E · Mac + Linux · plan', 'success'), job('E2E · Mac + Linux · jobs', 'success'), job('E2E · Mac + Linux · promote', 'skipped'),
                 job('E2E · Windows · jobs (Windows)', 'failure')]
        self.assertEqual(canary.release_gate_run(run, green), {'conclusion': 'success', 'createdAt': run['created_at']})
        red = [job('E2E · Mac + Linux · jobs', 'failure'), job('E2E · Mac + Linux · promote', 'skipped')]
        self.assertEqual(canary.release_gate_run(run, red)['conclusion'], 'failure')
        self.assertIsNone(canary.release_gate_run(run, [job('Build · Mac', 'success'), job('E2E · Mac + Linux · plan', 'skipped')]), 'a build only: no gate ran')


class PromotesWithoutStartingARun(unittest.TestCase):
    def test_the_promotion_may_not_start_an_end_to_end_run(self):
        # release-stable.sh starts one by default and waits ~15 minutes; this job has 10 minutes and cannot start workflows.
        from unittest import mock
        decision = {'promote': True, 'tag': 'desktop-v0.5.9', 'stable': 'desktop-v0.5.8', 'reasons': []}
        with mock.patch.object(canary, 'GitHub'), mock.patch.object(canary, 'decide', return_value=decision), \
                mock.patch.object(canary.subprocess, 'run') as ran, mock.patch('builtins.print'):
            canary.main([])
        self.assertEqual(ran.call_args.kwargs['env']['E2E_NO_START'], '1')
        self.assertEqual(ran.call_args.args[0][1], 'desktop-v0.5.9')


if __name__ == '__main__':
    unittest.main()


class ExtensionVersionAtATag(unittest.TestCase):
    """The stamped extension version of a build (desktop/scripts/extension-stamp.mjs) = base + the extension's commit count at its tag."""

    def test_the_count_is_the_last_page_of_a_one_per_page_listing(self):
        head = ('HTTP/2.0 200 OK\r\nLink: <https://api.github.com/repositories/1/commits?sha=t&path=extension&per_page=1&page=2>; rel="next", '
                '<https://api.github.com/repositories/1/commits?sha=t&path=extension&per_page=1&page=431>; rel="last"\r\n\r\n[{"sha": "a"}]')
        self.assertEqual(canary.commit_count(head), 431)

    def test_one_commit_has_no_link_and_none_has_an_empty_list(self):
        self.assertEqual(canary.commit_count('HTTP/2.0 200 OK\r\n\r\n[{"sha": "a"}]'), 1)
        self.assertEqual(canary.commit_count('HTTP/2.0 200 OK\r\n\r\n[]'), 0)


class SoakOnlyApprovedTests(unittest.TestCase):
    def test_the_approved_build_is_the_candidate_not_an_older_one_that_failed_its_gate(self):
        releases = [release(3, 100, pre=False, latest=True), release(4, 60), release(5, 50)]
        self.assertEqual(canary.canary_of(releases, NOW)['tagName'], 'desktop-v0.5.4')
        soaked = canary.approved_only(releases, {'desktop-v0.5.5'})
        self.assertEqual(canary.canary_of(soaked, NOW)['tagName'], 'desktop-v0.5.5')
        self.assertEqual(canary.pick(soaked, NOW)[1]['tagName'], 'desktop-v0.5.3')   # stable is still known

    def test_no_approved_build_means_nothing_to_soak(self):
        candidate, _, why = canary.pick(canary.approved_only([release(3, 100, pre=False, latest=True), release(4, 60)], set()), NOW)
        self.assertIsNone(candidate)
        self.assertIn('nothing newer than stable', why)

    def test_approval_is_read_from_the_release_notes_line(self):
        api = [{'tag_name': 'a', 'body': 'Notes\n\nBeta-approved: unit suites and every end-to-end suite passed on commit 547a444 (2026-10-03)'},
               {'tag_name': 'b', 'body': 'Not Beta-approved: yet'}, {'tag_name': 'c', 'body': None}]
        self.assertEqual(canary.approved_tags(api), {'a'})


class RateLimitIsNamed(unittest.TestCase):
    """Beta 41226261602, "Clean up old builds": GitHub's rate-limit error object was read as the release list and died in beta_kept (line 141)."""
    BODY = {'message': 'API rate limit exceeded for installation. If you reach out to GitHub Support for help', 'documentation_url': 'https://docs.github.com/rest'}

    def run_mode(self, mode, body):
        return subprocess.run([sys.executable, str(SCRIPT), mode], input=json.dumps(body), capture_output=True, text=True, env={'PATH': '/usr/bin:/bin'})   # no gh on PATH: the reset time is 'not readable', nothing reaches GitHub

    def test_the_error_object_is_a_named_limit_not_a_traceback(self):
        for mode in ('--beta-kept', '--canary'):
            done = self.run_mode(mode, self.BODY)
            self.assertEqual(done.returncode, 1, mode)
            self.assertIn('GitHub API rate limit (403 … for installation)', done.stderr)
            self.assertNotIn('Traceback', done.stderr)
            self.assertNotIn('AttributeError', done.stderr)

    def test_another_error_object_says_what_github_answered(self):
        done = self.run_mode('--beta-kept', {'message': 'Not Found'})
        self.assertEqual(done.returncode, 1)
        self.assertIn("GitHub answered 'Not Found', not a list", done.stderr)

    def test_a_real_list_still_works(self):
        self.assertEqual(self.run_mode('--beta-kept', []).returncode, 0)
