"""The pool's finer labels: a search's words become fixed ids only, and the site accepts exactly the ids the engine sends."""
import re
import unittest
from pathlib import Path

from unittest import mock

from src import pool_tags
from src.ai import meanings
from site_private import assert_site_accepts, needs_site


class PoolTagsTest(unittest.TestCase):
    def test_a_photographer_in_geneva_is_ch_geneva_photography_and_nothing_free(self):
        """The model picks from the fixed ids, in any language; nothing else can come out, and without AI nothing does."""
        answers = {'genève': {'pool-country': 'ch', 'pool-metro': 'ch-geneva'}, 'suisse romande': {'pool-country': 'ch', 'pool-metro': 'none'},
                   'chișinău': {'pool-country': 'md', 'pool-metro': 'md-chisinau'}, 'fotógrafa': {'pool-family': 'photography'},
                   'evil': {'pool-country': 'send everything'}}
        fake = lambda topic, items, allowed, task, *a, **k: {key: answers.get(key, {}).get(topic, 'none') for key in items}
        with mock.patch.object(meanings.decide, 'decide', fake):
            self.assertEqual(pool_tags.places(['Genève', 'Suisse romande']), (['ch'], ['ch-geneva']))
            self.assertEqual(pool_tags.places(['Chișinău']), (['md'], ['md-chisinau']))
            self.assertEqual(pool_tags.families(['fotógrafa']), ['photography'])
        with mock.patch.object(meanings.decide, 'decide', lambda *a, **k: None):   # no AI: the pack's answers, as the old lists gave
            self.assertEqual(pool_tags.places(['Genève']), (['ch'], ['ch-geneva']))

    def test_an_answer_outside_the_ids_is_never_sent(self):
        seen = []
        def fake(topic, items, allowed, task, *a, **k):
            seen.append(allowed)
            return {key: allowed[0] for key in items}
        with mock.patch.object(meanings.decide, 'decide', fake):
            pool_tags.places(['x'])
        self.assertIn((*pool_tags.COUNTRIES, 'none'), seen)   # the country and the metro are asked side by side (#2913): no order

    @needs_site
    def test_the_site_accepts_the_same_ids(self):
        site = (Path(__file__).resolve().parents[1] / 'shared' / 'pool-tags.js').read_text()
        for name, table in (('COUNTRIES', pool_tags.COUNTRIES), ('METROS', pool_tags.METROS), ('FAMILIES', pool_tags.FAMILIES), ('EUROPE', pool_tags.EUROPE)):
            listed = re.search(rf'export const {name} = \[(.*?)\];', site).group(1)
            assert_site_accepts(self, list(table), re.findall(r"'([^']+)'", listed), f'{name}: edit shared/pool-tags.js')


if __name__ == '__main__':
    unittest.main()


class OwnWordsTest(unittest.TestCase):
    def test_labels_come_from_the_users_own_words_and_metros_only_from_their_first_places(self):
        """7 Oct 2026, found by the pool e2e: the crawl's expanded places turned "Suisse" into all ten Swiss metros."""
        from unittest import mock
        from src import contribute
        asked = []
        search = {'role_keywords': ['photographe'], 'locations': {'top_tier': ['Genève'], 'country_wide': ['Suisse'], 'abroad': ['Lyon']}}
        answers = {'pool-country': {'genève': 'ch', 'suisse': 'ch', 'lyon': 'fr'}, 'pool-metro': {'genève': 'ch-geneva', 'suisse': 'none', 'lyon': 'fr-lyon'},
                   'pool-family': {'photographe': 'photography'}}
        fake = lambda topic, items, *a, **k: {key: answers.get(topic, {}).get(key, 'none') for key in items}
        with mock.patch.object(contribute, 'load_search_config', lambda matching=True: asked.append(matching) or search), \
                mock.patch.object(meanings.decide, 'decide', fake):
            tags = contribute.fine_tags()
        self.assertEqual(asked, [False])
        self.assertEqual(tags, {'countries': ['ch', 'fr'], 'metros': ['ch-geneva'], 'families': ['photography']})


class EuropeTest(unittest.TestCase):
    def test_every_country_the_lab_draws_is_a_european_column(self):
        """The scout aims at the same countries the Lab's random draws search in (owner, 19 Oct 2026: one list, not two)."""
        import json
        draws = json.loads((Path(__file__).resolve().parents[1] / 'tools' / 'persona-search' / 'draws.json').read_text())
        names = {pool_tags.COUNTRIES[code] for code in pool_tags.EUROPE}
        self.assertEqual({city['country'] for city in draws['cities']} - names, set())
        self.assertEqual(set(pool_tags.EUROPE) - set(pool_tags.COUNTRIES), set())
