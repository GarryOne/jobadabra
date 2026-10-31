"""LinkedIn jobs on every Find jobs, PR 2/3 (31 Oct 2026, spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the app reads at most
3 LinkedIn searches per Find jobs, built from the strategy's own role and place words (never a second list of its own)."""
import unittest
from unittest import mock

from src import desktop
from src.sources import visits_portals

ROLES = ['photographe', '\\bretouche\\b', 'directeur artistique', 'styliste']
PLACES = {'top_tier': ['gen[èe]ve', 'lausanne', 'zürich'], 'country_wide': ['Suisse']}
BASE = 'https://www.linkedin.com/jobs/search/?keywords={role}&location={place}'


def url(role, place):
    return BASE.format(role=role, place=place)


class LinkedinSearchesTest(unittest.TestCase):
    def test_up_to_three_searches_one_per_role_in_the_first_place(self):
        found = visits_portals.linkedin_searches({'role_keywords': ROLES, 'locations': PLACES})
        self.assertEqual([item['url'] for item in found],
                         [url('photographe', 'gen%C3%A8ve'), url('retouche', 'gen%C3%A8ve'), url('directeur%20artistique', 'gen%C3%A8ve')])
        self.assertEqual([item['name'] for item in found], ['LinkedIn: photographe in genève', 'LinkedIn: retouche in genève', 'LinkedIn: directeur artistique in genève'])

    def test_one_role_goes_through_the_places_instead(self):
        found = visits_portals.linkedin_searches({'role_keywords': ['photographe'], 'locations': PLACES})
        self.assertEqual([item['url'] for item in found], [url('photographe', 'gen%C3%A8ve'), url('photographe', 'lausanne'), url('photographe', 'z%C3%BCrich')])

    def test_the_limit_and_the_place_less_search(self):
        self.assertEqual(len(visits_portals.linkedin_searches({'role_keywords': ROLES, 'locations': PLACES}, limit=2)), 2)
        found = visits_portals.linkedin_searches({'role_keywords': ['photographe'], 'locations': {}})
        self.assertEqual([item['url'] for item in found], [url('photographe', '')])

    def test_no_role_words_means_no_search(self):
        self.assertEqual(visits_portals.linkedin_searches({'role_keywords': [], 'locations': PLACES}), [])
        self.assertEqual(visits_portals.linkedin_searches({}), [])

    def test_a_search_is_listed_once_and_the_portal_list_is_unchanged(self):
        found = visits_portals.linkedin_searches({'role_keywords': ['photographe', 'photographe'], 'locations': {'top_tier': ['genève']}})
        self.assertEqual(len(found), 1)
        listed = {p['key']: p['url'] for p in visits_portals.portals({'role_keywords': ROLES, 'locations': PLACES})}
        self.assertEqual(listed['linkedin'], url('photographe', 'gen%C3%A8ve'), 'the "Find jobs using your browser" list still offers the one search')

    def test_the_desktop_command_answers_with_the_searches(self):
        with mock.patch.object(visits_portals, 'load_search_config', return_value={'role_keywords': ROLES, 'locations': PLACES}):
            payload, _ = desktop._linkedin_searches(None, None)
        self.assertTrue(payload['ok'])
        self.assertEqual(len(payload['searches']), 3)
        self.assertIn('linkedin-searches', desktop._COMMANDS)


if __name__ == '__main__':
    unittest.main()
