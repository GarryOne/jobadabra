"""A slow job-boards step never holds the first jobs (#2913, 2 Nov 2026: on the Codex relay the boards' proposal took 73 s, the employer sites were
read, and nothing was imported or scored until it ended). The employer sites' jobs are imported and scored while the boards are still running;
the boards' jobs join when they finish. Tests: this file, tests/test_first_jobs.py."""
import threading
import unittest
from unittest import mock

from src import first_jobs
from src.sources import careers

_READER = careers.READER
WAIT = 10   # a hang guard only: the test releases the boards itself


def setUpModule():   # the guard in tests/test_found_boards_ai.py: no page read reaches a real model from this file
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


JOBS = [{'id': str(i), 'title': 'Engineer', 'company': 'A', 'location': 'Zurich', 'url': f'https://x/{i}'} for i in range(3)]
BOARD_JOB = {'id': 'b1', 'title': 'Engineer', 'company': 'B', 'location': 'Zurich', 'url': 'https://b/1'}


class TheBoardsJoinWhenTheyFinish(unittest.TestCase):
    def run_slice(self, boards):
        events, imported = [], []

        def scorer(db, candidates, profile, model, max_jobs, workers=5, stats=None, on_scored=None, every=10, only_ids=None, **kw):
            events.append('scored')
            stats.update(done=len(only_ids))
            on_scored()

        def import_jobs(report):
            events.append(f'import {len(report["jobs"])}')
            imported.append([job['id'] for job in report['jobs']])
        with mock.patch.object(first_jobs.score, 'queue', return_value=JOBS), mock.patch.object(first_jobs, 'to_score', return_value=JOBS), \
                mock.patch.object(first_jobs, 'aggregators_kept', side_effect=lambda feed_db, name, found: list(found)):
            first_jobs.run(mock.MagicMock(), mock.MagicMock(), [{'company': 'A', 'ats': 'greenhouse', 'slug': 'a'}], profile='p', hidden=frozenset(),
                           sync=lambda: None, say=lambda line: None, scan=lambda sources, feed_db: {'jobs': [dict(j) for j in JOBS], 'sources': []},
                           scorer=scorer, fits=lambda db: {}, boards=boards, import_jobs=import_jobs)
        return events, imported

    def test_the_employer_jobs_are_scored_before_a_slow_boards_step_ends(self):
        release, scored_first = threading.Event(), []

        def boards(say):
            scored_first.append(release.wait(WAIT))   # True only when the slice scored while this step still ran
            return [BOARD_JOB]
        original = first_jobs._score_first

        def score_then_release(*args, **kwargs):
            try:
                return original(*args, **kwargs)
            finally:
                release.set()
        with mock.patch.object(first_jobs, '_score_first', side_effect=score_then_release):
            events, imported = self.run_slice(boards)
        self.assertEqual(scored_first, [True], 'the boards step was still running when the employer jobs were scored')
        self.assertEqual(events[:2], ['import 3', 'scored'], events)
        self.assertEqual(imported[-1], ['b1'], 'the boards joined after, when they finished')

    def test_a_late_board_job_is_scored_when_the_employer_sites_gave_nothing(self):
        """Gitar on #2928: the late join imported the board jobs but nothing scored them, and the slice said 'none to score yet' (the card's end)."""
        release, queue, scored, said = threading.Event(), [], [], []

        def boards(say):
            release.wait(WAIT)
            return [BOARD_JOB]

        def scorer(db, candidates, profile, model, max_jobs, workers=5, stats=None, on_scored=None, every=10, only_ids=None, **kw):
            scored.append(sorted(only_ids))
            stats.update(done=len(only_ids))

        def import_jobs(report):
            queue.extend(job['id'] for job in report['jobs'])   # the store gains the jobs the slice imports
        original = first_jobs._score_first

        def score_then_release(*args, **kwargs):
            try:
                return original(*args, **kwargs)
            finally:
                release.set()   # the employer batch is over (nothing to score): the boards end now
        with mock.patch.object(first_jobs, '_score_first', side_effect=score_then_release), \
                mock.patch.object(first_jobs.score, 'queue', side_effect=lambda *a: [{'id': i} for i in queue]), \
                mock.patch.object(first_jobs, 'to_score', return_value=[]), \
                mock.patch.object(first_jobs, 'aggregators_kept', side_effect=lambda feed_db, name, found: list(found)):
            first_jobs.run(mock.MagicMock(), mock.MagicMock(), [{'company': 'A', 'ats': 'greenhouse', 'slug': 'a'}], profile='p', hidden=frozenset(),
                           sync=lambda: None, say=said.append, scan=lambda sources, feed_db: {'jobs': [], 'sources': []}, scorer=scorer,
                           fits=lambda db: {}, boards=boards, import_jobs=import_jobs)
        self.assertEqual(scored, [['b1']], 'the board job was scored in the slice')
        self.assertFalse([line for line in said if 'none to score yet' in line], said)

    def test_boards_that_finish_at_once_are_imported_once_whichever_side_of_the_scan_they_end(self):
        events, imported = self.run_slice(lambda say: [BOARD_JOB])
        self.assertEqual(sorted(job for batch in imported for job in batch), ['0', '1', '2', 'b1'], 'every job once, none twice')


if __name__ == '__main__':
    unittest.main()
