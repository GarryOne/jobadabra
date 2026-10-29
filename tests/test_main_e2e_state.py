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


def run(rid, title, conclusion='failure', sha='f' * 40, branch='main'):
    return {'id': rid, 'display_title': title, 'conclusion': conclusion, 'head_sha': sha, 'head_branch': branch, 'created_at': f't{rid}', 'html_url': f'u{rid}'}


JOBS = {
    # newest first: two runs that tested nothing are not runs here (G7: cancelled); a mutant is red on purpose; a by-hand re-run on main cleared settings
    5: [{'name': 'cardstates', 'conclusion': 'failure'}],                                   # RC soak: tests a release, not main
    4: [{'name': 'settings', 'conclusion': 'success'}, {'name': 'plan', 'conclusion': 'success'}],
    3: [{'name': 'cardstates', 'conclusion': 'success'}],                                   # a mutant
    2: [{'name': 'cardstates', 'conclusion': 'failure'}, {'name': 'interactions', 'conclusion': 'failure'}, {'name': 'settings', 'conclusion': 'failure'},
        {'name': 'recorded-1of5', 'conclusion': 'success'}, {'name': 'recorded-2of5', 'conclusion': 'failure'}, {'name': 'jobs', 'conclusion': 'success'},
        {'name': 'Telegram alert', 'conclusion': 'failure'}, {'name': 'HTML report', 'conclusion': 'success'}],
    1: [{'name': 'cardstates', 'conclusion': 'success'}, {'name': 'interactions', 'conclusion': 'success'}, {'name': 'foryou', 'conclusion': 'success'}],
}
RUNS = [run(6, 'E2E check · on time (Worker cron)', conclusion='cancelled'),
        run(5, 'RC soak desktop-v0.8.28'),
        run(4, 'E2E Mac + Linux · settings · main', conclusion='success'),
        run(3, 'Mutant raw-http-error', conclusion='success'),
        run(2, 'E2E check · on time (Worker cron)'),
        run(7, 'E2E Mac + Linux · all suites · some-pr', branch='some-pr'),
        run(1, 'E2E check · GitHub schedule (backup)', conclusion='success', sha='c' * 40)]


class MainE2eState(unittest.TestCase):
    def setUp(self):
        self.state = m.state(RUNS, lambda rid: JOBS.get(rid, []))

    def test_red_suites_are_the_newest_main_check_result(self):
        self.assertEqual([suite for suite, _ in m.red(self.state)], ['cardstates', 'interactions', 'recorded'])

    def test_a_by_hand_rerun_on_main_clears_only_its_suite(self):
        self.assertEqual(self.state['settings']['conclusion'], 'success')

    def test_soak_mutant_pr_and_skipped_runs_never_count(self):
        self.assertEqual(self.state['cardstates']['url'], 'u2', 'the RC soak (5) and the mutant (3) are not main checks')
        self.assertNotIn('Telegram alert', self.state)
        self.assertNotIn('HTML report', self.state)

    def test_a_shard_red_makes_its_suite_red(self):
        self.assertEqual(self.state['recorded']['conclusion'], 'failure')

    def report(self, registry):
        with tempfile.TemporaryDirectory() as tmp:
            lanes = Path(tmp) / 'lanes.json'
            if registry is not None:
                lanes.write_text(registry)
            output = io.StringIO()
            with patch.object(m, 'LANES', lanes, create=True), patch.object(m, 'live', return_value=self.state), redirect_stdout(output):
                self.assertEqual(m.main(['--json']), 0)
            return json.loads(output.getvalue())

    def test_suspended_red_is_reported_separately_while_unlisted_and_tolerant_still_block(self):
        report = self.report(json.dumps({'suites': {'cardstates': {'lane': 'suspended'}, 'interactions': {'lane': 'tolerant'}}}))
        self.assertEqual([s['suite'] for s in report['red']], ['interactions', 'recorded'])
        self.assertEqual([s['suite'] for s in report['suspended']], ['cardstates'])
        self.assertEqual(report['suspended'][0]['conclusion'], 'failure')
        self.assertEqual(report['suspended'][0]['url'], 'u2')

    def test_missing_or_invalid_registry_fails_closed(self):
        for registry in (None, '{', 'null', '[]', '{}', '{"suites": []}', '{"suites": {"cardstates": null}}'):
            with self.subTest(registry=registry):
                report = self.report(registry)
                self.assertEqual([s['suite'] for s in report['red']], ['cardstates', 'interactions', 'recorded'])
                self.assertEqual(report['suspended'], [])

    def test_retired_or_unknown_lane_does_not_exclude_a_red(self):
        for lane in ('retired', 'backbone', 'unknown'):
            report = self.report(json.dumps({'suites': {'cardstates': {'lane': lane}}}))
            self.assertEqual([s['suite'] for s in report['red']], ['cardstates', 'interactions', 'recorded'])

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
