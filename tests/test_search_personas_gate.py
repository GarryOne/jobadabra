"""The search PR check (search-personas.yml, tools/persona-search/gate.py): red when a persona finds fewer right jobs than main's lowest of its last 3
runs or a press runs past 3 minutes, on recorded numbers; every AI step on Haiku 5.5 on the plan, never an API key (owner, 27 Oct 2026)."""
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


# Recorded on CI (GarryOne/jobadabra-benchmarks "search ours", first press, Haiku 5.5; judged by the blind judge on the plan):
BEFORE = run([0, 0, 0, 11, 0, 0], [179, 202, 299, 268, 210, 207])      # 40436945285: before the 3-minute changes (scout past its share)
DROP = run([0, 0, 0, 1, 0, 0], [181, 180, 246, 228, 251, 210])         # 40446066828: the drop the owner saw (p4's jobup.ch jobs lost)
FIRST_PRESS = run([0, 0, 0, 1, 0, 0], [143, 143, 158, 164, 132, 149])  # 40450152414: #2218 on main


class TheRecordedRunsDecideAsTheOwnerAsked(unittest.TestCase):
    def test_the_recorded_drop_is_red(self):
        verdict = gate.compare(DROP, [BEFORE])
        self.assertEqual(verdict['state'], 'failure')
        p4 = verdict['rows'][3]
        self.assertIn("1 right jobs, below main's lowest (11)", p4['reasons'])
        self.assertTrue(any('press took 251 s' in r for r in verdict['rows'][4]['reasons']), 'p5 ran past 3 minutes')

    def test_main_runs_within_mains_range_are_green(self):
        self.assertEqual(gate.compare(FIRST_PRESS, [DROP, BEFORE])['state'], 'success', "p4's 1 is inside main's range (1, 11)")
        self.assertEqual(gate.compare(FIRST_PRESS, [FIRST_PRESS])['state'], 'success', 'the same numbers again')

    def test_only_mains_newest_three_runs_set_the_floor(self):
        high = run([0, 0, 0, 5, 0, 0], [150] * 6)
        self.assertEqual(gate.compare(high, [high, high, high, FIRST_PRESS])['state'], 'success')
        self.assertEqual(gate.compare(FIRST_PRESS, [high, high, high, FIRST_PRESS])['state'], 'failure', 'the 4th run is older than the floor')

    def test_no_main_run_yet_is_green_on_the_3_minutes_alone(self):
        verdict = gate.compare(FIRST_PRESS, [])
        self.assertEqual(verdict['state'], 'success')
        self.assertIn('no main run to compare yet', verdict['head'])
        self.assertEqual(gate.compare(DROP, [])['state'], 'failure', 'presses over 180 s are red with or without main')


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
        pr = {n: {'persona': n, 'not_measured': 'CLAUDE_CODE_OAUTH_TOKEN is not set'} for n in range(1, 7)}
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
                (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'code': 0, 'crashes': [], 'seconds': 150}) + '\n')
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


class TheJudgeIsBlindAndOnThePlan(unittest.TestCase):
    def test_no_api_key_reaches_the_judge(self):
        env = gate_judge.plan_env({'ANTHROPIC_API_KEY': 'x', 'ANTHROPIC_BASE_URL': 'y', 'OPENAI_API_KEY': 'z', 'CLAUDE_CODE_OAUTH_TOKEN': 't', 'PATH': '/bin'})
        self.assertEqual(sorted(env), ['CLAUDE_CODE_OAUTH_TOKEN', 'PATH'])

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


class TheWorkflowRunsOnHaikuOnThePlan(unittest.TestCase):
    def test_every_step_on_haiku_5_5_and_no_api_key(self):
        self.assertRegex(WORKFLOW, r'(?m)^  JOB_PILOTTO_MODEL_OVERRIDE: claude-haiku-5-5\b')
        self.assertIn('CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}', WORKFLOW)
        self.assertNotIn('secrets.ANTHROPIC', WORKFLOW)
        self.assertNotRegex(WORKFLOW, r'ANTHROPIC_API_KEY:', 'no job is given an API key')
        for program in ('tools/persona-search/run.mjs', 'tools/persona-search/gate_judge.py'):
            line = next(line for line in WORKFLOW.splitlines() if program in line)
            self.assertIn('env -u ANTHROPIC_API_KEY', line, program)

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
        self.assertIn('--limit 10', WORKFLOW)
        self.assertEqual(gate.MAIN_RUNS, 3)
        self.assertEqual(gate.PRESS_LIMIT, 180)


if __name__ == '__main__':
    unittest.main()
