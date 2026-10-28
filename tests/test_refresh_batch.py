"""A refresh takes one batch end to end (owner, 7 Oct 2026: "a batch should handle it from start to finish"): the jobs it reads are the ones it
scores, the rest waits for the next refresh, and jobs not scored yet are counted as waiting, not listed as matches."""
import sqlite3
import unittest
from unittest import mock

from src import desktop


def row(i, **kw):
    return {'id': i, 'url': f'https://x/{i}', 'title': 'Vendeur', 'company': 'Coop', 'location': 'Lausanne', 'work_mode': '', 'notes': '',
            'application_status': 'unreviewed', 'first_seen_at': '2026-10-07', **kw}


class WaitingTests(unittest.TestCase):
    def listed(self, hide):
        local = [row(1), row(2), row(3, notes='imported'), row(4, application_status='saved')]
        with mock.patch.object(desktop.digest, 'eligible_jobs', return_value=(local, [])), \
                mock.patch.object(desktop.score, 'load', return_value={1: {'score': 70, 'summary': 'ok'}}):
            return desktop.jobs(sqlite3.connect(':memory:'), notion_jobs=[], hide_unscored=hide)

    def test_unscored_jobs_wait_counted_but_yours_stay(self):
        result = self.listed(True)
        self.assertEqual({r['url'] for r in result['jobs']}, {'https://x/1', 'https://x/3', 'https://x/4'})
        self.assertEqual(result['waiting'], 1, 'job 2: found, not scored, not touched by you')

    def test_without_an_ai_everything_found_is_listed(self):
        result = self.listed(False)
        self.assertEqual(len(result['jobs']), 4)
        self.assertEqual(result['waiting'], 0)


class BatchTests(unittest.TestCase):
    def test_a_refresh_scores_its_batch_first_and_reads_with_the_time_left(self):
        # 7 Oct 2026: reading each job with AI first took the whole 3 minutes, twice, and scored nothing.
        import inspect
        from src.ai import score
        self.assertIn('only_ids', inspect.signature(score.run).parameters)
        source = open('src/daily_search_scoring.py').read()
        self.assertIn("if args.enrich_max and batch is None:", source, 'with a batch, no reading before scoring')
        self.assertLess(source.index('score_candidates(args, stores, db, run, read_profile, hidden, dismissed, batch, batch_started, time_budget)'), source.index('if args.enrich_max and batch is not None:'),
                        'reading comes after scoring')
        self.assertIn("time_budget.batch('score', len(waiting))", source, 'the batch is sized at the scoring pace')

if __name__ == '__main__':
    unittest.main()


class ClosedHereTests(unittest.TestCase):
    def test_a_job_closed_on_this_mac_leaves_the_list_before_notion_hears_of_it(self):
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE jobs (url TEXT, state TEXT)')
        db.executemany('INSERT INTO jobs VALUES (?, ?)', [('https://x/vevey', 'closed'), ('https://x/applied', 'closed')])
        rows = [{'url': 'https://x/vevey', 'title': 'Vendeur', 'company': 'Fnac', 'location': 'Vevey', 'work_mode': '', 'fit': 66,
                 'reason': '', 'match_status': 'Open', 'first_seen': '2026-10-07'},
                {'url': 'https://x/applied', 'title': 'Vendeur', 'company': 'Fnac', 'location': 'Vevey', 'work_mode': '', 'fit': 60,
                 'reason': '', 'match_status': 'Open', 'first_seen': '2026-10-07', 'stage': 'Applied', 'notion_url': 'n'}]
        with mock.patch.object(desktop.digest, 'eligible_jobs', return_value=([], [])), mock.patch.object(desktop.score, 'load', return_value={}):
            listed = {row['url'] for row in desktop.jobs(db, notion_jobs=rows)['jobs']}
        self.assertEqual(listed, {'https://x/applied'}, 'closed and not acted on: gone now; applied: stays')
