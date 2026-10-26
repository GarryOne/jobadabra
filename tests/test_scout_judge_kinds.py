"""An install's own scout judges an employer by the AI's kind of each job title, not by the search's role words (owner, 26 Oct 2026: "The AI
decides"; audit PR 5). A pilot search's role words missed "Erster Offizier" and counted "Pilot Project Manager" as a pilot; the AI's kinds
(job-title-kind: shared, kept, mostly answered already) count "Erster Offizier" and "Copilote", not the project manager. Past the AI's cap a title counts
for nothing, never a word's guess; with no AI at all the role words are the floor. The central scout counts every job, as before."""
import unittest
from unittest import mock

from src import role_kinds, scout_core, scout_probe
from src.sources import feeds

KINDS = {'Erster Offizier A320': 'aviation_transport', 'Copilote ATR 72': 'aviation_transport', 'Pilot Project Manager': 'business_ops'}
JOBS = [{'title': t, 'location': 'Zurich', 'description': ''} for t in KINDS] + [{'title': 'Accountant', 'location': 'Zurich', 'description': ''}]


class ScoutJudgeKindsTest(unittest.TestCase):
    def setUp(self):
        self.capped = False
        judged = lambda titles, topic='role-kind': {} if self.capped else {t: KINDS[t] for t in titles if t in KINDS}
        for patch in (mock.patch.object(scout_core, 'CENTRAL', False),
                      mock.patch.object(role_kinds, 'judged', judged),
                      mock.patch.object(role_kinds, 'of_search', lambda search: {'aviation_transport'}),
                      mock.patch.object(feeds, 'TITLES', feeds.keyword_regex(['First Officer', 'pilot'])),
                      mock.patch.object(feeds, 'wanted_location', lambda job: True),
                      mock.patch('src.ai.engine.ready', lambda *a, **k: True)):
            patch.start()
            self.addCleanup(patch.stop)

    def test_the_ais_kind_of_each_title_decides_what_counts(self):
        self.assertEqual([j['title'] for j in scout_probe.counted_jobs(JOBS)], ['Erster Offizier A320', 'Copilote ATR 72'])
        _, stats = scout_probe.quality(JOBS)
        self.assertEqual(stats['relevant'], 2)
        self.assertEqual(scout_probe.relevant_roles(JOBS), 2)
        self.assertEqual(scout_probe.job_places(JOBS), ['Zurich'])

    def test_past_the_cap_no_title_counts_never_a_words_guess(self):
        self.capped = True
        self.assertEqual(scout_probe.counted_jobs(JOBS), [], '"Pilot Project Manager" is not counted on its role word')

    def test_with_no_ai_at_all_the_role_words_are_the_floor(self):
        with mock.patch('src.ai.engine.ready', lambda *a, **k: False):
            self.assertEqual([j['title'] for j in scout_probe.counted_jobs(JOBS)], ['Copilote ATR 72', 'Pilot Project Manager'])

    def test_a_search_no_kind_fits_is_judged_by_the_ai_title_sort(self):
        with mock.patch.object(role_kinds, 'of_search', lambda search: {role_kinds.UNKNOWN}), \
             mock.patch.object(feeds, 'triage', lambda jobs: None), \
             mock.patch.object(feeds, 'judged_title', lambda title: title == 'Copilote ATR 72'):
            self.assertEqual([j['title'] for j in scout_probe.counted_jobs(JOBS)], ['Copilote ATR 72'])

    def test_the_central_scout_counts_every_job(self):
        with mock.patch.object(scout_core, 'CENTRAL', True):
            self.assertEqual(len(scout_probe.counted_jobs(JOBS)), 4)


if __name__ == '__main__':
    unittest.main()
