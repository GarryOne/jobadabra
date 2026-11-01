"""Main's e2e state per suite (tools/main_e2e_state.py, gate G2): the 25 Oct 21:47 reds stay red until a main-check run passes them; other runs never count."""
import sys
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools import main_e2e_state as m  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def run(rid, title, conclusion='failure', sha='f' * 40, branch='main'):
    return {'id': rid, 'display_title': title, 'conclusion': conclusion, 'head_sha': sha, 'head_branch': branch, 'created_at': f't{rid}', 'html_url': f'u{rid}'}


JOBS = {
    # newest first: two runs that tested nothing are not runs here (G7: cancelled); a mutant is red on purpose; a by-hand re-run on main cleared settings
    8: [{'name': 'jobs', 'conclusion': 'failure'}, {'name': 'cardstates', 'conclusion': 'failure'}],   # a night burn-in pass: a look at a step's record, not main's state
    5: [{'name': 'cardstates', 'conclusion': 'failure'}],                                   # RC soak: tests a release, not main
    4: [{'name': 'settings', 'conclusion': 'success'}, {'name': 'plan', 'conclusion': 'success'}],
    3: [{'name': 'cardstates', 'conclusion': 'success'}],                                   # a mutant
    2: [{'name': 'cardstates', 'conclusion': 'failure'}, {'name': 'interactions', 'conclusion': 'failure'}, {'name': 'settings', 'conclusion': 'failure'},
        {'name': 'recorded-1of5', 'conclusion': 'success'}, {'name': 'recorded-2of5', 'conclusion': 'failure'}, {'name': 'jobs', 'conclusion': 'success'},
        {'name': 'Telegram alert', 'conclusion': 'failure'}, {'name': 'HTML report', 'conclusion': 'success'}],
    1: [{'name': 'cardstates', 'conclusion': 'success'}, {'name': 'interactions', 'conclusion': 'success'}, {'name': 'foryou', 'conclusion': 'success'}],
}
RUNS = [run(8, 'Night burn-in 3/5 · aaaaaaaa'),
        run(6, 'E2E check · on time (Worker cron)', conclusion='cancelled'),
        run(5, 'RC soak desktop-v0.8.28'),
        run(4, 'E2E Mac + Linux · settings · main', conclusion='success'),
        run(3, 'Mutant raw-http-error', conclusion='success'),
        run(2, 'E2E check · on time (Worker cron)'),
        run(7, 'E2E Mac + Linux · all suites · some-pr', branch='some-pr'),
        run(1, 'E2E check · GitHub schedule (backup)', conclusion='success', sha='c' * 40)]


class MainE2eState(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        registry = patch.object(m, 'LANES', Path(tmp.name) / 'lanes.json')
        registry.start()
        self.addCleanup(registry.stop)
        self.present = None   # main's suite list unread: no red is dropped (the fictional suites below are kept)
        self.state = m.state(RUNS, lambda rid: JOBS.get(rid, []))

    def test_red_suites_are_the_newest_main_check_result(self):
        self.assertEqual([suite for suite, _ in m.red(self.state)], ['cardstates', 'interactions', 'recorded'])

    def test_real_job_name_shapes_resolve_to_the_suite(self):
        for name in ('quality', 'quality-1of2', 'quality-1of2-standin', 'quality-1of2-sqlite',
                     'quality · burn-in 2/5', 'quality-1of2-standin · burn-in 2/5',
                     'E2E · Mac + Linux · quality-1of2-sqlite'):
            with self.subTest(name=name):
                self.assertEqual(m.suite_of(name), 'quality')

    def test_a_by_hand_rerun_on_main_clears_only_its_suite(self):
        self.assertEqual(self.state['settings']['conclusion'], 'success')

    def test_soak_mutant_pr_and_skipped_runs_never_count(self):
        self.assertEqual(self.state['cardstates']['url'], 'u2', 'the RC soak (5) and the mutant (3) are not main checks')
        self.assertNotIn('Telegram alert', self.state)
        self.assertNotIn('HTML report', self.state)

    def test_a_night_burn_in_pass_never_counts_as_main_red(self):
        self.assertEqual(self.state['jobs']['conclusion'], 'success', 'the red pass (8) did not turn a green suite red')
        self.assertEqual(self.state['cardstates']['url'], 'u2')

    def test_a_shard_red_makes_its_suite_red(self):
        self.assertEqual(self.state['recorded']['conclusion'], 'failure')

    def report(self, registry):
        with tempfile.TemporaryDirectory() as tmp:
            lanes = Path(tmp) / 'lanes.json'
            if registry is not None:
                lanes.write_text(registry)
            output = io.StringIO()
            with patch.object(m, 'LANES', lanes, create=True), patch.object(m, 'live', return_value=self.state), \
                    patch.object(m, 'suites_on_main', return_value=self.present), redirect_stdout(output):
                self.assertEqual(m.main(['--json']), 0)
            return json.loads(output.getvalue())

    def test_suspended_red_is_separate_and_tolerant_never_blocks(self):
        report = self.report(json.dumps({'suites': {'cardstates': {'lane': 'suspended'}, 'interactions': {'lane': 'tolerant'}}}))
        self.assertEqual([s['suite'] for s in report['red']], ['recorded'])
        self.assertEqual([s['suite'] for s in report['suspended']], ['cardstates'])
        self.assertEqual(report['suspended'][0]['conclusion'], 'failure')
        self.assertEqual(report['suspended'][0]['url'], 'u2')

    def test_a_suite_is_red_when_any_shard_fails_and_no_annotation_makes_it_health(self):
        # Why (31 Oct 2026, owner: a suite past its budget is our bug): the job conclusion is the verdict; there is no "grey" state or annotation read.
        jobs = [{'id': 21, 'name': 'apply-1of2', 'conclusion': 'success'},
                {'id': 22, 'name': 'applyflows', 'conclusion': 'failure'}]
        self.state = m.state([run(9, 'E2E check · on time (Worker cron)')], lambda _: jobs)
        self.assertEqual(self.state['apply']['conclusion'], 'success')
        report = self.report(None)
        self.assertNotIn('grey', report)
        self.assertEqual([entry['suite'] for entry in report['red']], ['applyflows'])
        jobs.append({'id': 23, 'name': 'apply-2of2', 'conclusion': 'failure'})
        st = m.state([run(9, 'E2E check · on time (Worker cron)')], lambda _: jobs)
        self.assertEqual(st['apply']['conclusion'], 'failure')

    def test_missing_or_invalid_registry_fails_closed(self):
        for registry in (None, '{', 'null', '[]', '{}', '{"suites": []}', '{"suites": {"cardstates": null}}'):
            with self.subTest(registry=registry):
                report = self.report(registry)
                self.assertEqual([s['suite'] for s in report['red']], ['cardstates', 'interactions', 'recorded'])
                self.assertEqual(report['suspended'], [])

    def test_unknown_or_backbone_lane_does_not_exclude_a_red(self):
        for lane in ('backbone', 'unknown'):
            report = self.report(json.dumps({'suites': {'cardstates': {'lane': lane}}}))
            self.assertEqual([s['suite'] for s in report['red']], ['cardstates', 'interactions', 'recorded'])

    def test_owner_tolerant_reds_never_make_main_red(self):
        self.state = m.state([run(9, 'E2E after merge · ed2f834 · quality,qualityai,apply')],
                             lambda rid: [{'name': name, 'conclusion': 'failure'} for name in ('quality-1of2-standin · burn-in 2/5', 'qualityai-standin', 'apply')])
        report = self.report(json.dumps({'suites': {'quality': {'lane': 'tolerant'}, 'qualityai': {'lane': 'tolerant'}, 'apply': {'lane': 'backbone'}}}))
        self.assertEqual([s['suite'] for s in report['red']], ['apply'])
        report = self.report(json.dumps({'suites': {'quality': {'lane': 'tolerant'}, 'qualityai': {'lane': 'tolerant'}, 'apply': {'lane': 'retired'}}}))
        self.assertEqual(report['red'], [])

    def test_a_suite_no_longer_on_main_is_never_red(self):
        # Why (1 Nov 2026, the owner's beta by hand refused): #2808 deleted focusdismiss; its last main run (8fc460d) stayed red and the gate re-checked a suite
        # the plan no longer knows ("unknown suite", run 41308204982). A job that is no suite file ("AI review of the screenshots") is the same shape.
        self.state = m.state([run(9, 'E2E check · GitHub schedule (backup)')],
                             lambda _: [{'name': name, 'conclusion': 'failure'} for name in ('focusdismiss', 'apply-3of3', 'AI review of the screenshots')]
                             + [{'name': 'wizard', 'conclusion': 'success'}])
        self.assertEqual([suite for suite, _ in m.red(self.state, present={'apply', 'wizard'})], ['apply'])
        self.present = {'apply', 'wizard'}
        self.assertEqual([s['suite'] for s in self.report(None)['red']], ['apply'])
        self.present = None   # main's list unread: unknown, every red stays (never a silent green)
        self.assertEqual([s['suite'] for s in self.report(None)['red']], ['AI review of the screenshots', 'apply', 'focusdismiss'])

    def test_main_s_suite_list_is_read_on_main_not_from_this_checkout(self):
        # Why (Gitar on #2820): the gate runs from any checkout; a local folder behind main would drop the red of a suite added on main since.
        calls = []
        def gh(args):
            calls.append(args)
            return ['apply.mjs', 'wizard.mjs', 'README.md']
        with patch.object(m, 'gh_json', side_effect=gh):
            self.assertEqual(m.suites_on_main('o/r'), {'apply', 'wizard'})
        self.assertIn('repos/o/r/contents/desktop/e2e/suites?ref=main', calls[0])
        self.assertIn("SUITES = readdirSync(path.join(E2E, 'suites'))", (ROOT / 'desktop/e2e/lib/context.mjs').read_text(), 'the folder the plan lists')
        for broken in (m.subprocess.CalledProcessError(1, 'gh'), json.JSONDecodeError('x', '', 0), OSError('no gh')):
            with self.subTest(broken=type(broken).__name__), patch.object(m, 'gh_json', side_effect=broken):
                self.assertIsNone(m.suites_on_main('o/r'))
        for empty in ([], None, ['README.md']):
            with self.subTest(empty=empty), patch.object(m, 'gh_json', return_value=empty):
                self.assertIsNone(m.suites_on_main('o/r'), 'an empty list is unknown, never "every red is gone"')

    def test_an_older_green_does_not_hide_a_newer_red(self):
        self.assertEqual(self.state['interactions']['sha'], 'f' * 40)
        self.assertEqual(self.state['foryou']['conclusion'], 'success')

    def test_a_run_after_a_merge_can_make_a_suite_red_but_never_green(self):
        # PR 4 of the PR-checks plan (owner's yes, 26 Oct 2026): after each merge main runs only the steps it touched. Its red names that commit;
        # its green says nothing about the suite's other steps, so it never clears a red the nightly found.
        after = [run(9, 'E2E after merge · 1234567 · cardstates', conclusion='success', sha='9' * 40),
                 run(8, 'E2E after merge · 7654321 · foryou', sha='8' * 40)]
        jobs = {**JOBS, 9: [{'name': 'cardstates', 'conclusion': 'success'}], 8: [{'name': 'foryou', 'conclusion': 'failure'}]}
        st = m.state(after + RUNS, lambda rid: jobs.get(rid, []))
        self.assertEqual(st['cardstates']['url'], 'u2', 'the green after a merge does not hide the scheduled red')
        self.assertEqual((st['foryou']['conclusion'], st['foryou']['sha']), ('failure', '8' * 40), 'its red names the merged commit')
        self.assertFalse(m.counts_green(after[0]))
        self.assertTrue(m.is_main_check(after[1]))


if __name__ == '__main__':
    unittest.main()
