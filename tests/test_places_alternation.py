"""A place written as an alternation of plain spellings ("sofia|софия") is the places they name, so its country is known and the board web search starts.
Origin (owner, 2 Nov 2026: the Search check is "still showing 0"): #2974's p1 (Truck Driver, Sofia) printed "web search never started (no places or roles known) ...
places sofia|софия, bulgaria|българия; countries none known". The strategy draft wrote the two spellings as ONE fragment; places.readable() shows any "|" as a regex
(/sofia|софия/), places.words_of() skips every regex, so the words were never asked, places.countries() was [] and src/ai/board_ideas._parts() returned None.
The run before had plain separate words and worked ("Places: worked out 4 place words with AI: sofia, софия, bulgaria, българия"). Strings below are #2974's own
(run 41387013715, artifact search-personas-p1); the loop plays every city and country the persona draw can pick (tools/persona-search/draws.json)."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src import places  # noqa: E402
from src.ai import board_ideas  # noqa: E402

DRAWS = json.loads((ROOT / 'tools' / 'persona-search' / 'draws.json').read_text(encoding='utf-8'))


def search(top=(), country=(), roles=('truck driver',)):
    return {'role_keywords': list(roles), 'locations': {'top_tier': list(top), 'country_wide': list(country), 'abroad': []}}


class Answers:
    """A stand-in for the places AI: every asked word is the city (or country) of `where`, as the model answers for a real one."""
    def __init__(self, where):
        self.where, self.asked = where, []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        words = json.loads(kwargs['messages'][0]['content'].split('Place words (JSON): ')[1])
        self.asked += words
        items = [{'word': w, 'kind': 'city', 'names': [], 'countries': [self.where(w)]} for w in words]
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps({'places': items}))],
                               usage=SimpleNamespace(input_tokens=1, output_tokens=1))


def known(find, where):
    """The countries places.countries() gives after one places refresh on `find`, with the AI answering `where`."""
    with tempfile.TemporaryDirectory() as tmp:
        file = Path(tmp) / 'places.json'
        client = Answers(where)
        places.refresh(find, client, file)
        return places.countries(find, places.load(file), limit=None), client.asked


class AnAlternationOfSpellingsIsItsPlaces(unittest.TestCase):
    def test_p1s_places_from_2974_are_asked_and_give_bulgaria(self):
        find = search(top=['sofia|софия'], country=['bulgaria|българия'])
        found, asked = known(find, lambda word: 'Bulgaria')
        self.assertEqual(asked, ['sofia', 'софия', 'bulgaria', 'българия'], 'the four words the run before #2974 asked')
        self.assertEqual(found, ['Bulgaria'])

    def test_a_country_spelled_in_two_languages_is_known_without_any_AI(self):
        self.assertEqual(places.countries(search(country=['bulgaria|българия']), {}, limit=None), ['Bulgaria'])

    def test_p1s_search_gets_its_board_web_search(self):
        """The line that said "no web search: this search names no places or roles": board_ideas._parts is None without countries."""
        find = search(top=['sofia|софия'], country=['bulgaria|българия'])
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'places.json'
            places.refresh(find, Answers(lambda word: 'Bulgaria'), file)
            cache = places.load(file)
            from unittest import mock
            with mock.patch.object(places, 'load', return_value=cache):
                self.assertIsNotNone(board_ideas.asked_for(find))
                self.assertEqual(board_ideas.asked_for(find)[1], ['Bulgaria'])

    def test_every_city_and_country_the_draw_can_pick_in_every_alternation_shape(self):
        """The class, not Sofia: any city, any country, the two shapes a fragment takes (plain "a|b", whole-word "\\ba\\b|\\bb\\b")."""
        for entry in DRAWS['cities']:
            city, country = entry['city'].lower(), entry['country']
            for shape in ('{a}|{b}', r'\b{a}\b|\b{b}\b'):
                with self.subTest(city=city, shape=shape):
                    fragment = shape.format(a=city, b=city + 'x')
                    found, asked = known(search(top=[fragment]), lambda word, country=country: country)
                    self.assertEqual(found, [country])
                    self.assertEqual(asked, [city, city + 'x'])
                with self.subTest(country=country, shape=shape):
                    fragment = shape.format(a=country.lower(), b=country.lower() + 'x')
                    self.assertEqual(places.countries(search(country=[fragment]), {}, limit=None), [country], 'a country named by its English name needs no AI')

    def test_accented_and_capitalised_spellings_are_words_too(self):
        """Fresh-subagent review of this PR: the draft's second spelling is often accented or capitalised ("zürich|zurich")."""
        for fragment, words in (('zürich|zurich', ['zürich', 'zurich']), ('Zürich|Zurich', ['Zürich', 'Zurich']), ('münchen|munich', ['münchen', 'munich']),
                                ('st. gallen|saint-gall', ['st. gallen', 'saint-gall']), (r'\bwien\b|\bvienna\b', ['wien', 'vienna']), ('z[uü]rich|zurich', ['zürich', 'zurich'])):
            with self.subTest(fragment=fragment):
                self.assertEqual(places.words_of(search(top=[fragment])), words)
        found, _ = known(search(top=['münchen|munich']), lambda word: 'Germany')
        self.assertEqual(found, ['Germany'])

    def test_a_swiss_region_word_in_an_alternation_uses_the_fixed_table_not_the_AI(self):
        self.assertEqual(places.countries(search(top=['romandie|suisse romande']), {}, limit=None), ['Switzerland'])
        self.assertNotIn('romandie', places.words_of(search(top=['romandie|suisse romande'])))

    def test_a_real_regex_is_still_not_a_place_word(self):
        self.assertEqual(places.words_of(search(top=['/regex-like/', 'z(?:ü|ue)rich', 'a|(b)', '(sofia|софия)', 'sofia|', '|sofia', 'sofia|софия|(?:x)'])), [])


if __name__ == '__main__':
    unittest.main()
