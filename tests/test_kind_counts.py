"""An employer is read only when its jobs in the person's countries are their kind of work (owner, 26 Oct 2026, audit PR 4: "Not read" for an
employer not judged yet; old mostly-"other" mixes the same; the countries of job places judged by every install's AI and by the central scout).
The scout counts each feed's jobs by country and kind (`kind_counts`); a job whose title or place is not judged is left out, never guessed."""
import unittest
from unittest import mock

from src import employer_index, geo, role_kinds, scout_kind_counts
from src.ai import decide

KIND = {'First Officer': 'aviation_transport', 'Cabin Crew': 'aviation_transport', 'Backend Engineer': 'software', 'Accountant': 'finance_admin'}
PLACE = {'zurich': {'kind': 'city', 'cc': 'CH', 'lat': 47.37, 'lon': 8.54, 'r': 20}, 'frankfurt': {'kind': 'city', 'cc': 'DE', 'lat': 50.1, 'lon': 8.68, 'r': 20},
         'remote': {'kind': 'remote'}, 'somewhere': {'kind': 'unknown'}}


def judged(titles, topic='role-kind'):
    return {t: KIND[t] for t in titles if t in KIND}


class ScoutCountsTest(unittest.TestCase):
    def setUp(self):
        self.asked = []

        def resolve(strings, client=None, ask=True, share=False):
            keys = [geo.norm(s) for s in strings if s]
            if ask:
                self.asked.append(list(keys))
            return {k: PLACE[k] for k in keys if k in PLACE and (ask or k != 'frankfurt')}   # Frankfurt: only the AI knows it

        decide._calls['n'] = 0
        for patch in (mock.patch.object(role_kinds, 'judged', judged), mock.patch.object(geo, 'resolve', resolve),
                      mock.patch('src.ai.engine.ready', lambda *a, **k: True)):
            patch.start()
            self.addCleanup(patch.stop)

    def test_jobs_are_counted_by_their_country_and_kind(self):
        jobs = [{'title': 'First Officer', 'location': 'Zurich'}, {'title': 'Cabin Crew', 'location': 'Zurich'},
                {'title': 'Backend Engineer', 'location': 'Frankfurt'}, {'title': 'Accountant', 'location': 'Remote'},
                {'title': 'Backend Engineer', 'location': 'Somewhere'}]
        self.assertEqual(scout_kind_counts.kind_counts(jobs), {'ch': {'aviation_transport': 2}, 'de': {'software': 1}},
                         'remote and unknown places count nowhere (local jobs only)')
        self.assertEqual(self.asked, [['frankfurt']], 'the AI is asked only for places the cache and the shared pack do not know')
        self.assertEqual(decide._calls['n'], 1, 'its calls come out of the same per-run cap as every other AI answer')

    def test_past_the_cap_an_unplaced_job_is_left_out_never_guessed(self):
        decide._calls['n'] = decide.MAX_CALLS_PER_RUN
        jobs = [{'title': 'First Officer', 'location': 'Zurich'}] * 6 + [{'title': 'Backend Engineer', 'location': 'Frankfurt'}]
        self.assertEqual(scout_kind_counts.kind_counts(jobs), {'ch': {'aviation_transport': 6}})
        self.assertEqual(self.asked, [])

    def test_too_few_jobs_judged_publish_no_counts(self):
        decide._calls['n'] = decide.MAX_CALLS_PER_RUN
        jobs = [{'title': 'First Officer', 'location': 'Zurich'}] + [{'title': 'Backend Engineer', 'location': 'Frankfurt'}] * 4
        self.assertIsNone(scout_kind_counts.kind_counts(jobs), '1 of 5 jobs judged on both says little about the employer')

    def test_the_scout_keeps_its_places_between_runs(self):
        from pathlib import Path
        workflow = (Path(__file__).resolve().parents[1] / '.github' / 'workflows' / 'central-scout.yml').read_text()
        self.assertEqual(workflow.count('data/geo.json'), workflow.count('data/jobs.sqlite') - workflow.count('--db data/jobs.sqlite'),
                         'every cache restore and save keeps the places the AI judged (asked once, ever)')


class ScoutKeepsClaudeTest(unittest.TestCase):
    def test_the_central_scout_judges_with_claude_never_free_ai(self):
        """Owner, 26 Oct 2026: "keep claude for the scout": its kinds and places decide which employers every install reads (~$11 a month)."""
        from pathlib import Path
        workflow = (Path(__file__).resolve().parents[1] / '.github' / 'workflows' / 'central-scout.yml').read_text()
        self.assertIn('ANTHROPIC_API_KEY: ${{ secrets.CENTRAL_SCOUT_ANTHROPIC_KEY }}', workflow)
        self.assertNotRegex(workflow, r'(?i)free_ai|JOB_PILOTTO_AI_ENGINE', 'the scout never switches to Free AI or another engine')


class LocatedFitTest(unittest.TestCase):
    PILOT = {'aviation_transport'}

    def test_an_employer_is_judged_by_its_jobs_in_your_countries(self):
        airline = {'company': 'Airline', 'places': ['Zurich'], 'kinds': {'software': 0.8, 'aviation_transport': 0.2},
                   'kind_counts': {'ch': {'aviation_transport': 9}, 'de': {'software': 60}}}
        tech = {'company': 'Tech with a hangar abroad', 'places': ['Zurich'], 'kinds': {'aviation_transport': 0.6, 'software': 0.4},
                'kind_counts': {'ch': {'software': 30}, 'de': {'aviation_transport': 45}}}
        kept = employer_index.relevant([airline, tech], lambda job: True, self.PILOT, countries=['ch'])
        self.assertEqual([f['company'] for f in kept], ['Airline'])

    def test_with_none_of_your_countries_counted_its_whole_mix_decides(self):
        airline = {'company': 'Airline', 'places': ['Zurich'], 'kinds': {'aviation_transport': 0.7, 'other': 0.3}, 'kind_counts': {'de': {'software': 3}}}
        self.assertEqual(len(employer_index.relevant([airline], lambda job: True, self.PILOT, countries=['ch'])), 1)

    def test_not_judged_or_an_old_mostly_other_mix_is_not_read(self):
        index = [{'company': 'Not counted yet', 'places': ['Zurich']},
                 {'company': 'Old mix, other unjudged', 'places': ['Zurich'], 'kinds': {'other': 0.9, 'legal': 0.1}, 'checked': '2026-10-25'}]
        self.assertEqual(employer_index.relevant(index, lambda job: True, self.PILOT, countries=['ch']), [])
        self.assertEqual(len(employer_index.relevant(index, lambda job: True, None)), 2, 'the search\'s kinds not known (no AI): nothing skipped by kind')

    def test_the_downloaded_index_keeps_only_fixed_counts(self):
        feed = {'company': 'Airline', 'ats': 'lever', 'slug': 'airline',
                'kind_counts': {'ch': {'aviation_transport': 9, 'hacking': 2, 'legal': 0, 'trades': True}, 'xx': {'software': 4}}}
        self.assertEqual(employer_index.clean([feed])[0]['kind_counts'], {'ch': {'aviation_transport': 9}})
        self.assertNotIn('kind_counts', employer_index.clean([{**feed, 'kind_counts': [['ch', 3]]}])[0])


if __name__ == '__main__':
    unittest.main()
