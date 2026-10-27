"""The search PR check (search-personas.yml, tools/persona-search/gate.py): red when a press runs past 3 minutes; right jobs are shown, and red only from
10 measured main runs, below main's average minus twice its spread (owner, 27 Oct 2026, "Time only, until 10 runs"), on recorded numbers; every AI step on Haiku 5.5 on PR_PROOF_ANTHROPIC_KEY with a $ cap (owner, 27 Oct 2026, "Haiku on an API key")."""
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import gate  # noqa: E402
import gate_judge  # noqa: E402

WORKFLOW = (ROOT / '.github' / 'workflows' / 'search-personas.yml').read_text()


def run(local, seconds, found=None):
    """One recorded run as {persona n: result}: right jobs (blind judge) and press seconds per persona p1..p6."""
    return {n: {'persona': n, 'local': loc, 'seconds': sec, 'code': 0, 'crashes': 0, 'found': (found or [None] * 6)[n - 1]}
            for n, (loc, sec) in enumerate(zip(local, seconds), 1)}


# Recorded on CI (GarryOne/jobadabra-benchmarks "search ours", first press, Haiku 5.5; judged by the blind judge on the plan, before 27 Oct's switch to the key):
BEFORE = run([0, 0, 0, 11, 0, 0], [179, 202, 299, 268, 210, 207])      # 40436945285: before the 3-minute changes (scout past its share)
DROP = run([0, 0, 0, 1, 0, 0], [181, 180, 246, 228, 251, 210])         # 40446066828: the drop the owner saw (p4's jobup.ch jobs lost)
FIRST_PRESS = run([0, 0, 0, 1, 0, 0], [143, 143, 158, 164, 132, 149])  # 40450152414: #2218 on main


class TheRecordedRunsDecideAsTheOwnerAsked(unittest.TestCase):
    def test_the_recorded_drop_is_red(self):
        verdict = gate.compare(DROP, [BEFORE])
        self.assertEqual(verdict['state'], 'failure')
        self.assertFalse(any('right jobs' in r for r in verdict['rows'][3]['reasons']), "p4's 11 -> 1 is shown, not red: quality is not gated before 10 measured main runs")
        self.assertTrue(any('press took 251 s' in r for r in verdict['rows'][4]['reasons']), 'p5 ran past 3 minutes')

    def test_main_runs_within_mains_range_are_green(self):
        self.assertEqual(gate.compare(FIRST_PRESS, [DROP, BEFORE])['state'], 'success')
        self.assertEqual(gate.compare(FIRST_PRESS, [FIRST_PRESS])['state'], 'success', 'the same numbers again')

    def test_the_main_column_shows_the_newest_three_measured_runs(self):
        high = run([0, 0, 0, 5, 0, 0], [150] * 6)
        self.assertEqual(gate.compare(FIRST_PRESS, [high, high, high, FIRST_PRESS])['rows'][3]['main'], [5, 5, 5])

    def test_no_main_run_yet_is_green_on_the_3_minutes_alone(self):
        verdict = gate.compare(FIRST_PRESS, [])
        self.assertEqual(verdict['state'], 'success')
        self.assertIn('quality: shown, gate starts at 10 measured main runs, 0 so far', verdict['head'])
        self.assertEqual(gate.compare(DROP, [])['state'], 'failure', 'presses over 180 s are red with or without main')


# #2289 (27 Oct 2026) changed no search code: p1 1->0, p4 10->9, p5 1->0, and went red. Main's two measured runs then: totals 13 and 16 (40522092534, 40528942517).
MAIN_13 = run([1, 0, 0, 10, 1, 1], [145, 151, 152, 181, 145, 149])
MAIN_16 = run([0, 0, 0, 11, 4, 1], [144, 144, 134, 178, 149, 152])
PR_2289 = run([0, 0, 0, 9, 0, 1], [143, 143, 148, 178, 147, 147])


class QualityIsPooledAndGatedByMainsOwnSpread(unittest.TestCase):
    def test_2289s_numbers_are_green(self):
        verdict = gate.compare(PR_2289, [MAIN_16, MAIN_13])
        self.assertEqual(verdict['state'], 'success', 'one job less on three personas is noise, not red')
        self.assertIn('quality: shown, gate starts at 10 measured main runs, 2 so far', verdict['head'])
        self.assertEqual(verdict['quality']['mode'], 'shown')

    def test_a_press_over_180_seconds_is_red(self):
        slow = run([0, 0, 0, 9, 0, 1], [143, 143, 148, 181, 147, 147])
        self.assertEqual(gate.compare(slow, [MAIN_16, MAIN_13])['state'], 'failure')

    def test_below_ten_measured_main_runs_quality_is_never_red(self):
        nine = [run([4, 4, 4, 4, 4, 4], [150] * 6)] * 9
        verdict = gate.compare(run([0] * 6, [150] * 6), nine)
        self.assertEqual((verdict['state'], verdict['quality']['mode'], verdict['quality']['measured']), ('success', 'shown', 9))

    def test_with_ten_measured_runs_below_average_minus_two_spreads_is_red_above_is_green(self):
        totals = [14, 16, 13, 18, 15, 17, 14, 16, 15, 17]   # mean 15.5, sample spread 1.6 -> floor 12.3
        mains = [run([t, 0, 0, 0, 0, 0], [150] * 6) for t in totals]
        floor = gate.compare(run([12, 0, 0, 0, 0, 0], [150] * 6), mains)['quality']['floor']
        self.assertAlmostEqual(floor, 12.3, places=1)
        self.assertEqual(gate.compare(run([12, 0, 0, 0, 0, 0], [150] * 6), mains)['state'], 'failure', '12 < 12.3')
        self.assertEqual(gate.compare(run([13, 0, 0, 0, 0, 0], [150] * 6), mains)['state'], 'success', '13 > 12.3')
        red = gate.compare(run([1, 1, 1, 1, 1, 1], [150] * 6), mains)
        self.assertIn('below main\'s floor', red['head'])
        self.assertEqual(red['quality']['mode'], 'gated')

    def test_failed_main_presses_do_not_supply_quality_measurements(self):
        for failure in ({'code': 1}, {'crashes': 1}):
            with self.subTest(failure=failure):
                failed = run([0] * 6, [150] * 6)
                failed[3].update(failure)
                self.assertEqual(gate.quality(PR_2289, [failed] * 10)['measured'], 0)

    def test_a_main_run_that_did_not_measure_every_persona_is_not_one_of_the_ten(self):
        errored = {**run([1] * 6, [150] * 6), 3: {'persona': 3, 'error': 'the judge wrote no verdicts'}}
        self.assertEqual(gate.quality(run([1] * 6, [150] * 6), [errored] * 10)['measured'], 0)


class SilenceIsNeverGreen(unittest.TestCase):
    def test_a_persona_without_a_result_is_red(self):
        pr = dict(FIRST_PRESS); pr.pop(3)
        verdict = gate.compare(pr, [FIRST_PRESS])
        self.assertEqual(verdict['state'], 'failure')
        self.assertIn('no result', verdict['rows'][2]['reasons'][0])

    def test_a_failed_press_or_a_step_off_haiku_is_red(self):
        for change in ({'code': 1}, {'crashes': 2}, {'non_haiku': 1}, {'error': 'the judge wrote no verdicts (see judge.log)'}):
            pr = {**FIRST_PRESS, 2: {**FIRST_PRESS[2], **change}}
            self.assertEqual(gate.compare(pr, [FIRST_PRESS])['state'], 'failure', change)

    def test_no_token_says_not_measured_never_a_measured_green(self):
        pr = {n: {'persona': n, 'not_measured': 'PR_PROOF_ANTHROPIC_KEY is not set'} for n in range(1, 7)}
        verdict = gate.compare(pr, [FIRST_PRESS])
        self.assertEqual(verdict['state'], 'neutral')
        self.assertIn('not measured', gate.table(verdict))

    def test_missing_files_give_an_error_not_zero(self):
        with tempfile.TemporaryDirectory() as out:
            row = gate.result(4, out)
        self.assertIn('error', row)
        self.assertNotIn('local', row)


class GitarsEdgeCases(unittest.TestCase):
    """gitar on #2243 (27 Oct 2026), and the red table a cancelled run posted on it."""
    def test_a_main_run_with_an_errored_persona_does_not_take_a_place_in_the_floor(self):
        errored = {**FIRST_PRESS, 4: {'persona': 4, 'error': 'the judge wrote no verdicts (see judge.log)'}}
        high = run([0, 0, 0, 9, 0, 0], [150] * 6)
        verdict = gate.compare(FIRST_PRESS, [errored, errored, high, high, FIRST_PRESS])
        self.assertEqual(verdict['rows'][3]['main'], [9, 9, 1], "p4's floor: the newest 3 measured runs, the errored ones skipped")
        self.assertEqual(verdict['state'], 'success')
        self.assertNotIn('ls main | wc -l', WORKFLOW, 'every listed main run is read, not the first 3 folders')

    def test_a_reply_that_leaves_jobs_out_fails_the_judge(self):
        jobs = [{'n': 1}, {'n': 2}, {'n': 3}]
        with self.assertRaisesRegex(ValueError, 'left out 1 of 3'):
            gate_judge.complete({1: {}, 2: {}}, jobs)
        self.assertEqual(len(gate_judge.complete({1: {}, 2: {}, 3: {}}, jobs)), 3)

    def test_a_cancelled_run_posts_no_table(self):
        compare = WORKFLOW.split('\n  compare:\n', 1)[1]
        self.assertIn("if: ${{ !cancelled() }}", compare.split('steps:')[0])
        self.assertNotRegex(compare.split('steps:')[0], r'(?m)^    if: always\(\)')


class TheFilesRoundTrip(unittest.TestCase):
    def test_result_and_compare_read_what_the_jobs_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            for n in range(1, 7):
                out = tmp / 'results' / f'search-personas-p{n}'
                (out / 'draw').mkdir(parents=True)
                (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'code': 0, 'crashes': [], 'seconds': 150, 'funnel': {'ai_usd': 0.02}}) + '\n')
                (out / 'judged.json').write_text(json.dumps({'persona': gate.PERSONAS[n - 1], 'rows': [{'role': 'yes', 'place': 'yes'}, {'role': 'yes', 'place': 'no'}]}))
                (out / 'non-haiku-steps.txt').write_text('0\n')
                self.assertEqual(gate.result(n, out)['local'], 1)
            code = gate.main(['compare', str(tmp / 'results'), str(tmp / 'main-run')])
            self.assertEqual(code, 0)
            saved = json.loads((tmp / 'main-run' / 'verdict.json').read_text())
            self.assertEqual(gate.load_results(tmp / 'main-run')[4]['local'], 1, "a main run's verdict.json is the next floor")
            self.assertEqual(len(saved['personas']), 6)
            table = (tmp / 'main-run' / 'table.md').read_text()
            self.assertIn(gate.COST, table)
            self.assertIn('p4 Warehouse Operator, Zurich', table)


class TheJudgeIsBlindAndOnTheProofKey(unittest.TestCase):
    def test_only_the_proof_key_reaches_the_judge(self):
        env = gate_judge.judge_env({'ANTHROPIC_API_KEY': 'other', 'ANTHROPIC_BASE_URL': 'y', 'ANTHROPIC_AUTH_TOKEN': 'a', 'OPENAI_API_KEY': 'z', 'CLAUDE_CODE_OAUTH_TOKEN': 't',
                                    'LAB_HEAL_ANTHROPIC_KEY': 'h', 'GITHUB_TOKEN': 'g', 'PR_PROOF_ANTHROPIC_KEY': 'proof', 'PATH': '/bin'})
        self.assertEqual(env['ANTHROPIC_API_KEY'], 'proof', 'the proof key is the one key, handed over as the CLI reads it')
        self.assertEqual(sorted(env), ['ANTHROPIC_API_KEY', 'MAX_THINKING_TOKENS', 'PATH'])
        self.assertNotIn('other', env.values())

    def test_without_the_proof_key_no_key_reaches_the_judge(self):
        env = gate_judge.judge_env({'ANTHROPIC_API_KEY': 'other', 'CLAUDE_CODE_OAUTH_TOKEN': 't', 'PATH': '/bin'})
        self.assertNotIn('ANTHROPIC_API_KEY', env)
        self.assertNotIn('CLAUDE_CODE_OAUTH_TOKEN', env)

    def test_the_judge_asks_haiku_and_stops_past_its_cost_cap(self):
        self.assertEqual(gate_judge.MODEL, 'claude-haiku-5-5')
        gate_judge.SPENT[:] = [gate_judge.JUDGE_CAP_USD + 0.01]
        try:
            with self.assertRaisesRegex(ValueError, 'judge over its cost cap'):
                gate_judge.judge(4, [{'title': 'Lagerist', 'company': 'A', 'location': 'Zurich'}], asker=lambda profile, jobs: {})
        finally:
            gate_judge.SPENT[:] = []

    def test_each_calls_cost_is_added_up(self):
        class Out:
            stdout = json.dumps({'result': '{"jobs":[{"n":1,"role":"yes","place":"yes"}]}', 'total_cost_usd': 0.0123})
        gate_judge.SPENT[:] = []
        got = gate_judge.ask('Profile', [{'n': 1, 'title': 't', 'company': 'c', 'location': 'l'}], run=lambda *a, **k: Out(), env={'PATH': '/bin'})
        self.assertEqual(got[1]['role'], 'yes')
        self.assertEqual(gate_judge.SPENT, [0.0123])
        gate_judge.SPENT[:] = []

    def test_one_verdict_per_distinct_job_from_title_employer_and_place_only(self):
        asked, profiles = [], []

        def asker(profile, jobs):
            asked.append(jobs); profiles.append(profile)
            return {j['n']: {'n': j['n'], 'role': 'yes', 'place': 'yes' if 'Zurich' in j['location'] else 'no'} for j in jobs}
        pool = [{'title': 'Lagerist', 'company': 'A', 'location': 'Zurich', 'provider': 'jobup.ch', 'url': 'https://a.test/1'},
                {'title': 'Lagerist ', 'company': 'a', 'location': 'zurich', 'provider': 'other'},
                {'title': 'Lagerist', 'company': 'B', 'location': 'Bern'}]
        verdict = gate_judge.judge(4, pool, asker=asker)
        self.assertEqual(len(asked[0]), 2, 'the duplicate is judged once')
        self.assertEqual(set(asked[0][0]), {'n', 'title', 'company', 'location'}, 'no source, URL or score reaches the judge')
        self.assertEqual([r['place'] for r in verdict['rows']], ['yes', 'yes', 'no'])
        self.assertIn('Warehouse Operator, 6 years of experience, living in Zurich, Switzerland', profiles[0])


class TheWorkflowRunsOnHaikuOnTheProofKey(unittest.TestCase):
    def test_every_step_on_haiku_5_5_on_the_proof_key_only(self):
        self.assertRegex(WORKFLOW, r'(?m)^  JOB_PILOTTO_MODEL_OVERRIDE: claude-haiku-5-5\b')
        self.assertIn('PR_PROOF_ANTHROPIC_KEY: ${{ secrets.PR_PROOF_ANTHROPIC_KEY }}', WORKFLOW)
        self.assertNotIn('CLAUDE_CODE_OAUTH_TOKEN', WORKFLOW, 'the subscription token is no longer used (owner, 27 Oct 2026)')
        self.assertEqual(re.findall(r'secrets\.(\w+)', WORKFLOW), ['PR_PROOF_ANTHROPIC_KEY'] * 3, 'no other secret; only the three steps that ask Claude get the key')
        self.assertNotRegex(WORKFLOW, r'(?m)^\s+ANTHROPIC_API_KEY:', 'no job is given a second key')
        self.assertIn('--engine api', next(line for line in WORKFLOW.splitlines() if 'tools/persona-search/run.mjs' in line))
        self.assertIn('is not set: the search check is not measured', WORKFLOW)

    def test_a_persona_over_its_cost_cap_is_red_and_the_cost_is_in_the_table(self):
        row = {'persona': 1, 'local': 5, 'seconds': 100, 'code': 0, 'crashes': 0, 'usd': gate.PERSONA_CAP_USD + 0.01}
        reasons, _ = gate.judge_one(row, [])
        self.assertTrue(any('over the' in r and 'cap' in r for r in reasons))
        table = gate.table(gate.compare({1: row}, []))
        self.assertIn('| Cost |', table)
        self.assertIn('cost $', table)

    def test_an_unmeasured_press_cost_is_red_and_never_shown_as_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'draw').mkdir()
            (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'code': 0, 'crashes': [], 'seconds': 150, 'funnel': {'ai_usd': None}}) + '\n')
            (out / 'judged.json').write_text(json.dumps({'usd': 0.009, 'rows': [{'role': 'yes', 'place': 'yes'}]}))
            row = gate.result(1, out)
            self.assertIsNone(row['usd'])
            self.assertIn('the press cost was not measured', gate.judge_one(row, [])[0])

    def test_result_adds_the_press_and_the_judge_cost(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'draw').mkdir()
            (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'code': 0, 'crashes': [], 'seconds': 150, 'funnel': {'ai_usd': 0.031}}) + '\n')
            (out / 'judged.json').write_text(json.dumps({'usd': 0.009, 'rows': [{'role': 'yes', 'place': 'yes'}]}))
            self.assertEqual(gate.result(1, out)['usd'], 0.04)

    def test_all_six_personas_in_parallel_and_the_same_paths_on_prs_and_main(self):
        self.assertIn('persona: [1, 2, 3, 4, 5, 6]', WORKFLOW)
        self.assertEqual(len(gate.PERSONAS), 6)
        on = WORKFLOW.split('\njobs:')[0]
        pr = re.search(r'(?ms)^  pull_request:.*?(?=^  push:)', on).group(0)
        push = re.search(r'(?ms)^  push:.*?(?=^  workflow_dispatch:)', on).group(0)
        listed = lambda block: re.findall(r"(?m)^      - '([^']+)'", block)   # noqa: E731
        self.assertEqual(listed(pr), listed(push), "main runs on the same files, so its numbers are the floor for each merge")
        for path in ('src/first_jobs.py', 'src/daily_search.py', 'src/sources/**', 'src/ai/providers/**', 'tools/persona-search/**'):
            self.assertIn(path, listed(pr))

    def test_mains_numbers_are_what_the_compare_reads_back(self):
        self.assertIn('name: search-personas-result', WORKFLOW)
        self.assertIn('-n search-personas-result', WORKFLOW)
        self.assertGreater(int(re.search(r'--limit (\d+)', WORKFLOW).group(1)), gate.QUALITY_MIN_RUNS)   # the gate needs room for gate.QUALITY_MIN_RUNS measured runs
        self.assertEqual(gate.MAIN_RUNS, 3)
        self.assertEqual(gate.PRESS_LIMIT, 180)


if __name__ == '__main__':
    unittest.main()
