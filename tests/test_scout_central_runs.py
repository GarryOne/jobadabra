"""The central scout's runs after the Europe scouting steps (20 Oct 2026): 2 of 4 runs were cancelled at the job's 75 minutes and published
nothing; the AI ideas failed with "database is locked"; /admin/job-search/scouting's run log stayed empty. One test per cause. No network."""
import os
import re
import sys
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from src import scout, scout_cells, scout_core, scout_hiring
sys.path.insert(0, str(Path(__file__).resolve().parent))
from site_private import needs_site  # noqa: E402

WORKFLOW_MINUTES, PUBLISH_MINUTES = 75, 15   # .github/workflows/central-scout.yml timeout-minutes; the 20 Oct 01:06 run published in 15 min


class CentralRunsTest(unittest.TestCase):
    @needs_site   # reads shared/scouting.js, which lives in jobadabra-web
    def test_the_site_keeps_the_run_time_shape_the_engine_sends(self):
        """The engine sent '2026-10-20T01:06+00:00'; shared/scouting.js keeps only 'YYYY-MM-DDTHH:MM', so every run was dropped."""
        site = (Path(__file__).resolve().parents[1] / 'shared' / 'scouting.js').read_text()
        self.assertIn(r"/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(stats.run.at || '')", site)

    def test_the_run_time_has_the_shape_the_site_keeps(self):
        at = scout.run_record({}, [], at=datetime(2026, 10, 20, 1, 6, 28, tzinfo=timezone.utc))['at']
        self.assertEqual(at, '2026-10-20T01:06')

    def test_another_connection_can_write_while_the_ideas_and_hiring_search_ask_the_ai(self):
        """The AI's answers are cached in the same database through another connection: an uncommitted write before the call locked it."""
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'jobs.sqlite')
            db = sqlite3.connect(path)
            db.row_factory = sqlite3.Row
            scout_core.ensure_tables(db)
            scout_cells.keep(db, [])
            def other_connection_writes(*_):
                other = sqlite3.connect(path, timeout=0)
                other.execute('CREATE TABLE IF NOT EXISTS cache (k TEXT)')
                other.execute("INSERT INTO cache VALUES ('x')")
                other.commit()
                other.close()
                return []
            scout_cells.aim(db, {'role_keywords': ['x']})
            other_connection_writes()
            with mock.patch.object(scout_core, 'CENTRAL', True):
                scout_hiring.run(db, {'role_keywords': ['chef']}, asker=other_connection_writes)
            db.close()

    def test_the_job_limit_covers_setup_both_budgets_and_the_publish_reserve(self):
        import re
        workflow = (Path(__file__).resolve().parents[1] / '.github' / 'workflows' / 'central-scout.yml').read_text()
        limit = int(re.search(r'timeout-minutes: (\d+)', workflow).group(1))
        setup, reserve = 6, 3   # minutes: checkout, installs, Common Crawl (3 min cap) before the scout; upload and cost report after
        self.assertLessEqual(setup + (scout_core.CENTRAL_BUDGET_S + scout_core.VERIFY_BUDGET_S) / 60 + reserve, limit)

    def test_the_central_run_leaves_time_to_publish_inside_its_job(self):
        self.assertLessEqual(scout_core.CENTRAL_BUDGET_S / 60 + PUBLISH_MINUTES + 5, WORKFLOW_MINUTES)
        source = (Path(__file__).resolve().parents[1] / 'src' / 'scout.py').read_text()
        self.assertIn('budget=args.budget or (scout_core.CENTRAL_BUDGET_S if scout_core.CENTRAL else 0)', source,
                      'the central run (no --budget) gets the budget; an install keeps the one the app passes')


if __name__ == '__main__':
    unittest.main()
