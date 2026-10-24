"""The central scout's own numbers (src/scout.py central_stats, market_coverage) sent with the index. No network."""
import json
import sqlite3
import sys
import os
import unittest
from unittest import mock
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import scout  # noqa: E402


class StatsTests(unittest.TestCase):
    def test_market_coverage_counts_our_swiss_titles_against_jobsch_totals(self):
        pages = {'devops': '<h1>305 jobs</h1>', 'kubernetes': "<span>1'204 jobs</span>"}
        get = lambda url: next((page for term, page in pages.items() if f'term={term}' in url), '<p>nothing</p>')
        got = scout.market_coverage(['Senior DevOps Engineer', 'DevOps Lead', 'Kubernetes Admin', 'Chef'], get, ('devops', 'kubernetes', 'backend'), pause=0)
        self.assertEqual(got, [{'term': 'devops', 'ours': 2, 'jobsch': 305}, {'term': 'kubernetes', 'ours': 1, 'jobsch': 1204},
                               {'term': 'backend', 'ours': 0, 'jobsch': None}])

    def test_central_stats_hold_counts_and_the_scouts_own_source_names(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        scout.harvest(db, {'excluded': []}, [lambda: [dict(name='Acme', origin='Common Crawl CC-MAIN-2026-39', priority=70)]])
        db.execute("UPDATE scout_candidates SET status = 'found'")
        feeds_out = [{'ats': 'lever', 'jobs': 12, 'relevant': 3, 'regions': ['europe']}, {'ats': 'careers', 'jobs': 2, 'relevant': 1, 'regions': ['europe', 'remote']}]
        stats = scout.central_stats(db, feeds_out, [{'term': 'devops', 'ours': 2, 'jobsch': 305}])
        self.assertEqual((stats['feeds'], stats['jobs'], stats['relevant']), (2, 14, 4))
        self.assertEqual(stats['by_region'], {'europe': 2, 'remote': 1})
        self.assertEqual(stats['queue'], {'found': 1})
        self.assertEqual(stats['sources'], [{'origin': 'Common Crawl', 'probed': 1, 'found': 1}])
        self.assertEqual((stats['recipes'], stats['page_reads']), (0, 0), 'tables this scout never made count as 0')

    def test_each_source_counts_the_employers_it_found_by_their_main_kind(self):
        """Owner, 19 Oct 2026: /admin/scouting must show where we are strong or weak, so which source fills which kind of role."""
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        scout.harvest(db, {'excluded': []}, [lambda: [dict(name='Care', origin='Wikidata healthcare: PL', priority=55),
                                                      dict(name='Code', origin='Common Crawl CC-MAIN-2026-39', priority=70)]])
        db.execute("UPDATE scout_candidates SET ats = 'personio', slug = 'Care' WHERE name = 'Care'")
        db.execute("UPDATE scout_candidates SET ats = 'lever', slug = 'code' WHERE name = 'Code'")
        feeds_out = [{'ats': 'personio', 'slug': 'care', 'kinds': {'healthcare': 0.8}}, {'ats': 'lever', 'slug': 'code', 'kinds': {'software': 1}},
                     {'ats': 'lever', 'slug': 'starter', 'kinds': {'software': 1}}, {'ats': 'lever', 'slug': 'mixless'}]
        self.assertEqual(scout.central_stats(db, feeds_out)['source_kinds'],
                         {'starter or installs': {'software': 1, 'unknown': 1}, 'Wikidata healthcare': {'healthcare': 1}, 'Common Crawl': {'software': 1}})

    def test_a_run_record_says_what_the_run_did_and_where_its_ideas_aimed(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        scout.harvest(db, {'excluded': []}, [])
        db.execute('CREATE TABLE scout_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        db.execute("INSERT INTO scout_meta VALUES ('ideas_cell', 'logistics|pl')")
        from datetime import datetime
        run = scout.run_record({'harvested': 7, 'checked': 40}, [({}, {'status': 'found'}), ({}, {'status': 'none'})], at=datetime(2026, 10, 19, 22, 20))
        shown = scout.central_stats(db, [], run=run)['run']
        self.assertEqual(set(shown.pop('reads')), {'feed_api', 'plain_page', 'ai_board', 'browser', 'extension_tab'}, 'how the run read its employers (src/read_methods.py)')
        self.assertEqual(shown, {'at': '2026-10-19T22:20', 'added': 7, 'checked': 40, 'found': 1, 'cell': 'logistics|pl'})
        self.assertIsNone(scout.central_stats(db, [])['run'], 'no run record: the site keeps its log as it is')

    def test_the_numbers_travel_with_the_index(self):
        sent = []
        scout.publish_index([{'company': 'A', 'ats': 'lever', 'slug': 'a'}], 'https://x.test/api/index', 'k',
                            send=lambda request: sent.append(json.loads(request.data)) or 200, stats={'feeds': 1})
        self.assertEqual(sent[0]['stats'], {'feeds': 1})


class HealthTests(unittest.TestCase):
    def test_a_feed_with_no_open_job_for_90_days_leaves_the_index_and_returns_with_jobs(self):
        """Any open job keeps a feed, whatever the trade (6 Oct 2026: before, only jobs in the central scout's IT scope did)."""
        db = sqlite3.connect(':memory:')
        busy, idle = {'ats': 'lever', 'slug': 'busy', 'jobs': 3, 'relevant': 0}, {'ats': 'lever', 'slug': 'idle', 'jobs': 0}
        self.assertEqual(scout.health(db, [busy, idle], '2026-06-01')[0], set())
        self.assertEqual(scout.health(db, [busy, idle], '2026-08-01')[0], set())          # 61 days: still in
        self.assertEqual(scout.health(db, [busy, idle], '2026-09-05')[0], {('lever', 'idle')})
        self.assertEqual(scout.health(db, [busy, {**idle, 'jobs': 1}], '2026-09-06')[0], set())   # jobs again: back in

    def test_a_recipe_that_reads_nothing_is_flagged_and_not_used_until_relearned(self):
        from src.sources import page_recipes
        db = sqlite3.connect(':memory:')
        page_recipes.save('https://a.ch/jobs', {'kind': 'links', 'prefix': '/jobs'}, db=db)
        page_recipes.mark_broken('https://a.ch/jobs', db)
        self.assertIsNone(page_recipes.load('https://a.ch/jobs', db))
        page_recipes.save('https://a.ch/jobs', {'kind': 'links', 'prefix': '/de/jobs'}, db=db)
        self.assertEqual(page_recipes.load('https://a.ch/jobs', db), {'kind': 'links', 'prefix': '/de/jobs'})


class AiCostReportTests(unittest.TestCase):
    def test_the_run_prints_its_ai_cost_and_writes_the_file_even_at_zero(self):
        import os
        import tempfile
        from contextlib import redirect_stdout
        from io import StringIO
        with tempfile.TemporaryDirectory() as tmp, unittest.mock.patch.dict(os.environ, {'JOB_PILOTTO_AI_COST_FILE': f'{tmp}/c.json'}):
            out = StringIO()
            with redirect_stdout(out):
                scout.report_ai_cost({'usd': 0.12345678, 'done': 7})
            self.assertIn('$0.123 in 7 call(s)', out.getvalue())
            self.assertEqual(json.loads(Path(f'{tmp}/c.json').read_text()), {'usd': 0.123457, 'calls': 7})
            with redirect_stdout(StringIO()):
                scout.report_ai_cost({})
            self.assertEqual(json.loads(Path(f'{tmp}/c.json').read_text()), {'usd': 0.0, 'calls': 0})


if __name__ == '__main__':
    unittest.main()


class AiCostLineTests(unittest.TestCase):
    def test_dollars_only_for_api_calls(self):
        """6 Oct 2026: "$0.000 in 21 call(s)" read as broken to a Claude Code user, whose calls are on their Claude plan."""
        from src import scout
        self.assertEqual(scout.ai_cost_line('scout run', 0.0, 0, 21, 21), 'AI of this scout run: 21 call(s) on your Claude plan (Claude Code: no cost per call)')
        self.assertIn('$0.012 for 3 call(s) on your API key, plus 2 on your Claude plan', scout.ai_cost_line('scout run', 0.012, 3, 2, 5))
        self.assertEqual(scout.ai_cost_line('scout run', 0.012, 3, 0, 3), 'AI cost of this scout run: $0.012 in 3 call(s)')


class DoctorPlanTests(unittest.TestCase):
    def test_no_budget_to_watch_on_claude_code(self):
        from src import doctor
        with mock.patch.dict(os.environ, {'JOB_PILOTTO_AI_ENGINE': 'cli'}):
            check = doctor.check_budget(None)
        self.assertEqual((check.state, check.name), ('ok', 'AI budget'))
        self.assertIn('Claude plan', check.detail)
