"""A search press that the 3-minute budget stopped before it scored one job is a measured result ("cut by the cap"), never a crash and never silence.
Why (2 Nov 2026, #2947 / run 41373710207): with 12 personas on the Claude broker (3 answers at a time) 4 of 6 presses waited in the queue until the cap,
so the job cache had no `scores` table; tools/persona-search/ttfr.py selected from it, run.mjs died before writing the press row, and the check read
"the press wrote no numbers (see run.log)". tools/persona-search/metrics.py already guards the missing table; ttfr.py did not."""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import gate  # noqa: E402


def cut_press_data(folder):
    """The folder of a press stopped at the cap: jobs listed, no scores table, one cron run."""
    data = Path(folder)
    tracker = sqlite3.connect(data / 'tracker.sqlite')
    tracker.execute('CREATE TABLE cron_runs (started_at TEXT)')
    tracker.execute("INSERT INTO cron_runs VALUES ('2026-11-02T01:28:00+00:00')")
    tracker.commit()
    jobs = sqlite3.connect(data / 'jobs.sqlite')
    jobs.execute('CREATE TABLE jobs (id INTEGER, title TEXT, location TEXT, first_seen_at TEXT, state TEXT)')
    jobs.execute("INSERT INTO jobs VALUES (1, 'Warehouse Operator', 'Zurich', '2026-11-02T01:29:00+00:00', 'open')")
    jobs.commit()
    (data / 'search.json').write_text('{}')   # the engine's place check reads the search settings


class AStopBeforeAnyScoreIsANumber(unittest.TestCase):
    def test_ttfr_reads_a_cache_with_no_scores_table_as_no_fit_jobs(self):
        with tempfile.TemporaryDirectory() as tmp:
            cut_press_data(tmp)
            env = {**os.environ, 'PYTHONPATH': str(ROOT), 'JOBADABRA_NO_DOTENV': '1', 'JOBADABRA_FOLLOW_APP': '0', 'JOBADABRA_DATA_DIR': tmp, 'JOBADABRA_CONFIG_DIR': tmp}
            # the engine's place check needs a whole search config; the table is what is under test, so every job counts as in the places
            stub = ("import sys, types, runpy; sys.path.insert(0, 'tools/persona-search'); import src.sources as s; f = types.ModuleType('src.sources.feeds'); f.wanted_location = lambda job: True; "
                    "s.feeds = f; sys.modules['src.sources.feeds'] = f; sys.argv = ['ttfr.py']; runpy.run_path('tools/persona-search/ttfr.py', run_name='__main__')")
            done = subprocess.run([sys.executable, '-c', stub], cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stderr[-400:])
            self.assertEqual(json.loads(done.stdout.strip().splitlines()[-1])['fit70'], 0)

    def press_folder(self, tmp, seconds, scored, relay_waits):
        out = Path(tmp)
        (out / 'draw').mkdir()
        (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'code': 0, 'crashes': [], 'seconds': seconds, 'scored_in_places': scored, 'funnel': {'ai_usd': 0}}) + '\n')
        (out / 'run.log').write_text(''.join(
            f'2026-11-02T01:29:08Z relay: small total {w + 4000} broker 4000 waited {w} in-flight 4 prompt-chars 1050 kind decide start 1 status 200 sent yes tools 0 out-tokens 90\n' for w in relay_waits))
        (out / 'judged.json').write_text(json.dumps({'usd': 0, 'rows': []}))
        return out

    def test_a_press_at_the_cap_with_nothing_scored_says_so_with_its_longest_wait(self):
        with tempfile.TemporaryDirectory() as tmp:
            row = gate.result(4, self.press_folder(tmp, 178, 0, [500, 30000, 9786]))   # waited 30 s at most: slow, not starved
            self.assertEqual(row['cut'], 'cut by the cap after 178 s with no job scored; longest wait for the AI 30 s')
            self.assertNotIn('error', row)
            self.assertNotIn('not_measured', row)
            table = gate.table(gate.compare({4: row}, []))
            self.assertIn('cut by the cap after 178 s', table)
            self.assertNotIn('no such table', table)

    def test_a_press_starved_by_the_ai_queue_is_grey_with_the_wait_never_red(self):
        with tempfile.TemporaryDirectory() as tmp:
            starved = gate.result(4, self.press_folder(tmp, 178, 0, [500, 117451, 9786]))
        self.assertEqual(starved['not_measured'], 'AI queue full (waited 117 s)')
        self.assertEqual(gate.judge_one(starved, [])[0], [])
        verdict = gate.compare({n: starved for n in range(1, 7)}, [])
        self.assertEqual(verdict['state'], 'neutral', 'every press starved: grey, never green')
        self.assertIn('not measured (6 of 6): AI queue full (waited 117 s)', verdict['head'])

    def test_one_starved_press_next_to_a_healthy_one_is_grey_and_a_slow_press_without_a_wait_is_still_red(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b, tempfile.TemporaryDirectory() as c:
            starved = gate.result(4, self.press_folder(a, 178, 0, [117451]))
            healthy = gate.result(1, self.press_folder(b, 150, 9, [3000]))
            slow = gate.result(2, self.press_folder(c, 200, 0, [3000]))   # over 180 s, nobody kept it waiting
        rest = {n: {**healthy, 'persona': n} for n in (1, 2, 3, 5, 6)}   # the other personas are healthy
        mixed = gate.compare({**rest, 4: starved}, [])
        self.assertEqual(mixed['state'], 'neutral')
        self.assertIn('AI queue full', mixed['head'])
        red = gate.compare({**rest, 2: slow, 4: starved}, [])
        self.assertEqual(red['state'], 'failure')
        self.assertTrue(any('press took 200 s' in r for r in red['rows'][1]['reasons']))
        self.assertEqual(red['rows'][3]['reasons'], [])

    def test_a_long_wait_never_greys_a_press_that_crashed_exited_badly_or_ran_past_its_budget(self):
        """Gitar on #2955: the grey grade skipped the exit-code, crash and 180 s checks; a wait of 117 s must not hide any of them."""
        waits = [500, 117451]
        for label, seconds, code, crashes in (('exit code', 178, 1, []), ('crash', 178, 0, [{'step': 'Scout', 'error': 'x'}]), ('over 180 s', 240, 0, [])):
            with self.subTest(label), tempfile.TemporaryDirectory() as tmp:
                folder = self.press_folder(tmp, seconds, 0, waits)
                (folder / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'code': code, 'crashes': crashes, 'seconds': seconds, 'scored_in_places': 0, 'funnel': {'ai_usd': 0}}) + '\n')
                row = gate.result(4, folder)
                self.assertNotIn('not_measured', row)
                self.assertTrue(gate.judge_one(row, [])[0], f'{label} must stay red')

    def test_a_press_that_scored_or_finished_early_has_no_cut_note(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertNotIn('cut', gate.result(4, self.press_folder(tmp, 178, 12, [117451])))
        with tempfile.TemporaryDirectory() as tmp:
            self.assertNotIn('cut', gate.result(4, self.press_folder(tmp, 120, 0, [117451])))


if __name__ == '__main__':
    unittest.main()
