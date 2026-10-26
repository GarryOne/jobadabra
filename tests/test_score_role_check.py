"""A career change's lift to SEARCH_ROLE_FIT needs the AI's yes on the posting's title AND first lines, not the title alone (src/ai/score_search.py
_role_check). His 04:21 digest (26 Oct 2026, Free AI, pilot search) showed 8 pilot jobs and 2 wrong ones the title-only check let through:
"Spécialiste Support Pilotage et Comptabilité" (accounting: "pilotage" is managing) and "Flight Physics & Flight Controls Engineer". Jobs tied
at a score rank by the AI's own fit to the search (own_fit). Fake model and fake role check: the role check stands in for the AI."""
import unittest
from unittest import mock

from src import digest, store as job_store
from src.ai import score, score_search
from tests import test_score_career_change as career   # the module, so its own tests are not loaded twice
from tests.test_digest_counts import header

GAP, FakeModel = career.GAP, career.FakeModel
POSTINGS = [
    ('Spécialiste Support Pilotage et Comptabilité', 'Vous assurez le pilotage des clôtures comptables et le support aux cabinets '
     "d'expertise comptable : rapprochements bancaires, TVA, liasses fiscales."),
    ('Flight Physics & Flight Controls Engineer', 'You design flight control laws and simulate flight physics for our drone fleet; '
     'MSc in aerospace engineering, MATLAB/Simulink.'),
    ('First Officer A320', 'First Officer on the A320 fleet: valid EASA ATPL, type rating, 500 hours.'),
]
PILOT = 'First Officer A320'


def seed(db):
    job_store.import_watch_report(db, {'jobs': [
        {'company': f'Example {i}', 'id': str(i), 'title': title, 'location': 'Vienna, Austria', 'url': f'https://jobs.test/{i}',
         'description': text} for i, (title, text) in enumerate(POSTINGS)]})


class RoleCheck(unittest.TestCase):
    def setUp(self):
        career.CareerChange.setUp(self)   # the pilot search, a software CV, 13 pilot jobs: replaced by the three postings
        self.db.execute('DELETE FROM jobs')
        self.db.commit()
        seed(self.db)
        self.asked = []
        for patch in (mock.patch('src.sources.feeds.judged_title', return_value=True),   # the title-only check: yes to all three (his run)
                      mock.patch('src.ai.decide.one', side_effect=self.role_check)):
            patch.start()
            self.addCleanup(patch.stop)

    def role_check(self, topic, key, text, answers, instructions):
        self.asked.append((topic, key, text, answers))
        return 'yes' if f'Posting: {PILOT}\n' in text else 'no'   # what the AI answers, reading the first lines

    def fits(self):
        return {job['title']: data for job in digest.eligible_jobs(self.db)[0] if (data := score.load(self.db).get(job['id']))}

    def test_only_the_pilot_job_is_lifted_and_the_two_wrong_ones_keep_their_fit(self):
        """Fails on the old code: the title check alone lifted all three to SEARCH_ROLE_FIT, so the digest showed 3 jobs, 2 of them wrong."""
        score.run(self.db, digest.eligible_jobs(self.db)[0], career.CV, 'm', 20, client=FakeModel(search_fit=0, cv_fit=20))
        fits = self.fits()
        self.assertEqual({title: data['score'] for title, data in fits.items()},
                         {POSTINGS[0][0]: 20, POSTINGS[1][0]: 20, PILOT: score_search.SEARCH_ROLE_FIT})
        self.assertEqual(header(self.db, hide_unscored=True)[1], 1, 'the digest lists the pilot job only')
        self.assertEqual(fits[PILOT]['search']['asked'], 0, "the AI's own fit is kept")
        text = next(text for _, _, text, _ in self.asked if PILOT in text)
        self.assertIn('Roles searched: pilot first officer', text)
        self.assertIn('valid EASA ATPL', text, "the posting's first lines go with its title")
        self.assertEqual({(topic, tuple(answers)) for topic, _, _, answers in self.asked}, {(score_search.ROLE_TOPIC, ('yes', 'no'))})

    def test_no_answer_from_the_role_check_lifts_nothing(self):
        with mock.patch('src.ai.decide.one', return_value=None):
            data = score_search.apply({'score': 20, 'tier': 'C', 'search': {'fit': 0, 'career_change': True, 'cv_gap': GAP}},
                                      {'title': PILOT, 'description': POSTINGS[2][1]})
        self.assertEqual(data['score'], 20, 'no AI, a failed or busy call: not a yes')

    def test_his_title_only_lifts_are_scored_once_more_and_the_wrong_ones_fall(self):
        """His 04:21 rows: stored at SEARCH_ROLE_FIT by the title-only check, without 'asked'. Each is scored once more with the role check."""
        jobs = digest.eligible_jobs(self.db)[0]
        lifted = {'score': 70, 'tier': 'B', 'reason': f'Fits your search · Your CV: {GAP}', 'components': {}, 'strengths': [], 'gaps': [GAP],
                  'confidence': 'high', 'cv_fit': 20, 'search': {'fit': 70, 'career_change': True, 'cv_gap': GAP}}
        for job in jobs:
            score.save(self.db, job, 'm', lifted, career.CV)
        with mock.patch('src.sources.feeds.wanted_title', return_value=True), mock.patch('src.sources.feeds.triage'):
            self.assertEqual(len(score.pending_jobs(self.db, jobs, career.CV, 50)), 3)
            score.run(self.db, jobs, career.CV, 'm', 50, client=FakeModel(search_fit=0, cv_fit=20))
            self.assertEqual(score.pending_jobs(self.db, jobs, career.CV, 50), [], 'once only, whatever the check answered')
        self.assertEqual(header(self.db, hide_unscored=True)[1], 1)

    def test_jobs_tied_at_a_score_rank_by_the_ai_s_own_fit(self):
        jobs = digest.eligible_jobs(self.db)[0]
        base = {'tier': 'B', 'reason': 'Fits your search', 'components': {}, 'strengths': [], 'gaps': [], 'confidence': 'high'}
        own = {POSTINGS[0][0]: 10, POSTINGS[1][0]: 40, PILOT: 70}   # all shown at 70; the AI's own fit before the lift differs
        for job in jobs:
            score.save(self.db, job, 'm', {**base, 'score': 70, 'search': {'fit': 70, 'asked': own[job['title']], 'career_change': True,
                                                                           'cv_gap': ''}}, career.CV)
        for seed_ in range(1, 9):
            with self.subTest(seed=seed_):
                card = digest.build_digest(self.db, seed=seed_, hide_unscored=True)[0][0]
                at = [card.index(title.replace('&', '&amp;')) for title in (PILOT, POSTINGS[1][0], POSTINGS[0][0])]
                self.assertEqual(at, sorted(at), 'highest own fit first, whatever the shuffle')
        self.assertEqual(score_search.own_fit({'score': 55}), 55, 'without the part: the score')


if __name__ == '__main__':
    unittest.main()
