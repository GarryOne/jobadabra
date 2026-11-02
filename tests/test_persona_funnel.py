"""The search robot's funnel (tools/persona-search/funnel.py): each count read from a press's log, None when its line never came, and every line it
reads still printed by the engine in those words (a reworded print would make the funnel silently blind). Also run.mjs's paths: --note, --change-field."""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import funnel  # noqa: E402

# Shaped like the pilot check of 25 Oct 2026 (First Officer, Europe): many employers read, few boards, one web search, nothing relevant.
LOG = """[153s] Employers: 832 of 2,335 in your places hire for your kind of role; the others are left out.
[154s] ⏳ Reading employer job sites: 15 of 15 · 659 jobs listed
[186s] Job boards found: jobup.ch 0 job(s), 0 relevant
[254s] Job boards found: ch.talent.com 20 job(s), 1 relevant
[293s] Job boards: a web search found aeroTELEGRAPH job board, FlightDeckFriend
[398s] Claude Code haiku: answered in 8 s⏳ Reading employer job sites: 379 of 832 · 14,042 jobs listed · taking longer than expected
[885s] Job boards found: ch.talent.com 34 job(s), 0 relevant
[885s] Run counts: looked=89379 matches=3 scored=0 good=0
"""


class FunnelTest(unittest.TestCase):
    def test_counts_from_the_log(self):
        out = funnel.funnel(LOG.splitlines())
        self.assertEqual((out['employers_picked'], out['employers_in_places'], out['employer_sites_read']), (832, 2335, 379))
        self.assertEqual((out['boards_read'], out['board_jobs'], out['board_relevant']), (2, 34, 1))   # a board read twice keeps its best read
        self.assertEqual((out['web_searches'], out['web_found'], out['scout_web']), (1, 2, False))
        self.assertEqual((out['looked'], out['matches'], out['good']), (89379, 3, 0))

    def test_a_missing_line_is_none_not_zero(self):
        out = funnel.funnel(['[1s] Searching job boards…'])
        for key in ('employers_picked', 'employer_sites_read', 'looked', 'good'):
            self.assertIsNone(out[key], key)
        self.assertEqual(out['boards_read'], 0)

    def test_a_web_search_that_found_nothing_counts_as_a_search(self):
        out = funnel.funnel(['[5s] Job boards: a web search found no trade or local board',
                             '[6s] Job boards: the web search for trade and local boards did not answer (TimeoutError)'])
        self.assertEqual((out['web_searches'], out['web_found']), (2, 0))

    def test_where_the_time_went_and_whether_the_web_search_started(self):
        """Run 41376694937 (2 Nov 2026): p2-p4 found 0 although their web search started, because the time budget ended before any employer site or
        board was read; p1/p5 never started the web search. The funnel says which, so nobody has to read the log."""
        out = funnel.funnel(['[10s] Places: worked out 1 place word with AI: cluj',
                             '[10s] Job boards: searching the web for trade and local boards (your API key)',
                             '[43s] Employers: 109 of 1,372 in your places hire for your kind of role; the others are left out.',
                             '[89s] ⏱ Time is up (1 min 29 s) for job boards: 4 boards wait for the next search',
                             '[89s] ⏱ Time is up (1 min 29 s) for employer sites: 108 sites wait for the next search',
                             '[90s] ⏱ Time is up (1 min 30 s) for job boards: 4 boards wait for the next search'])
        self.assertEqual((out['places_worked_out_s'], out['web_search_started_s'], out['employers_named_s']), (10, 10, 43))
        self.assertEqual(out['time_up'], ['job boards', 'employer sites'])   # each phase once, in the order it ran out
        self.assertFalse(out['web_search_skipped'])
        skipped = funnel.funnel(['[59s] Job boards: no web search: this search names no places or roles'])
        self.assertTrue(skipped['web_search_skipped'])
        self.assertIsNone(skipped['web_search_started_s'])
        self.assertEqual(funnel.funnel([])['time_up'], [])

    def test_the_engine_still_prints_each_line_the_funnel_reads(self):
        printed = {   # file -> the literal text of the print each funnel pattern reads
            'src/daily_helpers.py': ["print(f'Employers: {len(for_kind)} of {len(in_places)} in your places hire for your kind of role"],
            'src/sources/found_boards.py': ['print(f"Job boards found: {board[\'name\']} {len(found)} job(s), {len(relevant)} relevant'],
            'src/sources/board_web.py': ['print(f"Job boards: a web search found ', 'Job boards: the web search for trade and local boards did not answer',
                                         'Job boards: no web search: this search names no places or roles'],
            'src/time_budget.py': ["print(f'⏱ Time is up ({spent // 60} min {spent % 60:02d} s) for {stage}: "],
            'src/places.py': ['print(f"Places: worked out {len(words)} place word'],
            'src/scout_run.py': ["print(f'Scout: employers with no job site found are looked up with a web search"],
            'src/run_counts.py': ["PREFIX = 'Run counts: '", 'f"{PREFIX}looked={'],
            'src/sources/feed_scan.py': ["Ticker('Reading employer job sites'"],
        }
        for file, texts in printed.items():
            source = (ROOT / file).read_text(encoding='utf-8')
            for text in texts:
                self.assertIn(text, source, f'{file} no longer prints what tools/persona-search/funnel.py reads')


class CostTest(unittest.TestCase):
    def test_the_press_cost_sums_its_runs_ai_dollars_only(self):
        import json
        import os
        import sqlite3
        import subprocess
        import tempfile
        folder = tempfile.mkdtemp()
        db = sqlite3.connect(os.path.join(folder, 'tracker.sqlite'))
        db.execute('CREATE TABLE cron_runs (started_at TEXT, data TEXT)')
        db.execute('INSERT INTO cron_runs VALUES (?, ?)', ('2026-10-25T16:02:46+00:00', json.dumps({'details': {'ai': {'score': {'usd': 0.41}, 'enrich': {'usd': 0.12}}}})))
        db.execute('INSERT INTO cron_runs VALUES (?, ?)', ('2026-10-25T15:00:00+00:00', json.dumps({'details': {'ai': {'score': {'usd': 9}}}})))   # an earlier press
        db.commit()
        log = os.path.join(folder, 'run-1.log')
        Path(log).write_text(LOG, encoding='utf-8')
        env = {**os.environ, 'PYTHONPATH': str(ROOT), 'JOBADABRA_DATA_DIR': folder, 'JOBADABRA_CONFIG_DIR': folder, 'JOBADABRA_NO_DOTENV': '1'}
        out = json.loads(subprocess.run([sys.executable, str(ROOT / 'tools' / 'persona-search' / 'funnel.py'), log, '--since', '2026-10-25T16:02:46'],
                                        env=env, capture_output=True, text=True, check=True).stdout)
        self.assertEqual(out['ai_usd'], 0.53)
        self.assertEqual(out['looked'], 89379)


class RunPathsTest(unittest.TestCase):
    RUN = (ROOT / 'tools' / 'persona-search' / 'run.mjs').read_text(encoding='utf-8')

    def test_the_note_goes_to_the_draft_as_the_wizard_sends_it(self):
        self.assertRegex(self.RUN, r"strategy\.draft\(storage, note \? \{anything_else: note\} : \{\}")

    def test_a_field_change_goes_through_the_strategy_pages_edit(self):
        self.assertIn('strategy.editLists(storage, {roles: {add: titles, remove: before}}', self.RUN)
        self.assertIn('searchChangedAt', self.RUN)
        self.assertTrue(re.search(r"press === 2 && fieldFile", self.RUN))

    def test_each_press_row_has_its_funnel(self):
        self.assertIn("funnel: metrics('funnel.py'", self.RUN)

    def test_each_press_row_has_the_search_it_ran_with_and_the_log_says_it_first(self):
        """Run 41376694937: nobody could tell why p1/p5 never started their web search, because the artifact held no search.json or places.json."""
        self.assertIn("search: searchSummary()", self.RUN)
        self.assertIn("console.log(`Search: ${", self.RUN)

    def test_a_search_that_never_started_its_web_search_shows_what_it_ran_with(self):
        import json
        import tempfile
        import gate
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'draw').mkdir()
            funnel_row = {'web_search_skipped': True, 'employers_named_s': 45, 'time_up': []}
            search = {'roles': 6, 'places': ['sofia', 'bulgaria'], 'countries': []}
            (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'code': 0, 'crashes': [], 'seconds': 126, 'search': search, 'funnel': funnel_row}) + '\n')
            note = gate.result(1, out)['funnel_note']
        self.assertIn('web search never started (no places or roles known)', note)
        self.assertIn('searched with 6 roles; places sofia, bulgaria; countries none known', note)


if __name__ == '__main__':
    unittest.main()
