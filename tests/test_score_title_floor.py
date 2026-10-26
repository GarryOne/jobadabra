"""On a career change, a posting whose title the AI's title check says is a role of the search is shown at SEARCH_ROLE_FIT at least, even when
the scorer's own fit to the search is low (owner's pick, 26 Oct 2026: "Use the title check"). His app scores on Free AI: its open model
gave the 13 First Officer jobs fit 0-30 for his pilot search (career change true), so none was shown; Claude gave 55-95 on the same jobs
and Profile. The title check is one small yes/no question open models answer well (src/sources/feeds.py judged_title). Fake model."""
import unittest
from unittest import mock

from src import digest
from src.ai import score, score_search
from tests import test_score_career_change as career   # the module, so its own tests are not loaded twice
from tests.test_digest_counts import header

GAP, FakeModel = career.GAP, career.FakeModel


class TitleCheck(unittest.TestCase):
    setUp, scored = career.CareerChange.setUp, career.CareerChange.scored

    def test_free_ai_s_low_fit_to_the_search_is_lifted_by_the_title_check(self):
        """Fails on the old code: fit 0 is not above the CV's 20, so every job keeps 20, under the digest's bar: 0 shown."""
        with mock.patch('src.sources.feeds.judged_title', return_value=True):
            fits = self.scored(FakeModel(search_fit=0, cv_fit=20))
        self.assertEqual(header(self.db, hide_unscored=True)[1], 13)
        one = next(iter(fits.values()))
        self.assertEqual((one['score'], one['cv_fit'], one['tier']), (score_search.SEARCH_ROLE_FIT, 20, score_search.tier(score_search.SEARCH_ROLE_FIT)))
        self.assertEqual(one['reason'], f'Fits your search · Your CV: {GAP}')
        self.assertIn(f'{score_search.SEARCH_ROLE_FIT}/100 · Fits your search', digest.build_digest(self.db, seed=1, hide_unscored=True)[0][0])

    def test_his_low_career_change_scores_made_before_the_title_check_are_scored_once_more(self):
        """His 03:15 re-score (26 Oct 2026) stored the search part with fit 0-30: the again rule (no search part yet) would never pick
        them, so they would stay under the digest's bar. A career change under SEARCH_ROLE_FIT whose title the check wants: once more."""
        jobs = digest.eligible_jobs(self.db)[0]
        low = {'score': 20, 'tier': 'C', 'reason': 'Unrelated', 'components': {}, 'strengths': [], 'gaps': [], 'confidence': 'high',
               'search': {'fit': 0, 'career_change': True, 'cv_gap': GAP}}
        for job in jobs:
            score.save(self.db, job, 'm', {**low, 'search': {**low['search'], 'career_change': False}} if job['title'].endswith(' 2') else low, career.CV)
        wanted = lambda title: not str(title).endswith(' 1')
        with mock.patch('src.sources.feeds.wanted_title', side_effect=wanted), mock.patch('src.sources.feeds.triage'), \
                mock.patch('src.sources.feeds.judged_title', return_value=True):
            again = {job['title'] for job in score.pending_jobs(self.db, jobs, career.CV, 50)}
            self.assertEqual(len(again), 11, 'not job 1 (title not wanted), not job 2 (the same field)')
            score.run(self.db, jobs, career.CV, 'm', 50, client=FakeModel(search_fit=0, cv_fit=20))
            self.assertEqual(score.pending_jobs(self.db, jobs, career.CV, 50), [], 'once only: now at the title check\'s fit')
        self.assertEqual(header(self.db, hide_unscored=True)[1], 11)

    def test_a_title_the_check_rejects_or_has_not_judged_keeps_its_fit(self):
        for answer in (False, None):
            with self.subTest(answer=answer), mock.patch('src.sources.feeds.judged_title', return_value=answer):
                data = score_search.apply({'score': 20, 'tier': 'C', 'reason': 'Unrelated',
                                           'search': {'fit': 0, 'career_change': True, 'cv_gap': GAP}}, {'title': 'Ramp Agent'})
                self.assertEqual(data['score'], 20, 'only the AI\'s yes lifts it, never a word guess')

    def test_the_title_check_never_lowers_a_higher_fit_nor_touches_the_same_field(self):
        with mock.patch('src.sources.feeds.judged_title', return_value=True):
            high = score_search.apply({'score': 15, 'tier': 'C', 'search': {'fit': 92, 'career_change': True, 'cv_gap': GAP}}, {'title': 'First Officer'})
            same = score_search.apply({'score': 40, 'tier': 'C', 'search': {'fit': 0, 'career_change': False, 'cv_gap': ''}}, {'title': 'First Officer'})
        self.assertEqual((high['score'], same['score']), (92, 40))


if __name__ == '__main__':
    unittest.main()
