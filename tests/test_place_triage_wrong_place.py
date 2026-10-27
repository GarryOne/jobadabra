"""The place question names the wrong-place shapes the 10-persona round found (27 Oct 2026, 4e's judged rows: 13 of 113 jobs local): a list of cities without the
person's, and remote limited to another region, are out even when they accept remote. The AI's answer is the model's; this keeps the prompt's cases and
the version that makes old answers asked again. No network."""
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import place_triage  # noqa: E402

RULES = ('only when one listed place is theirs', 'remote limits to other regions or countries', 'even when they accept remote work')
BENCHMARK_WORDS = ('South Africa', 'Ukraine', 'Vienna', 'Toronto', 'Paris')   # owner, 27 Oct 2026: a prompt rule stays general


class WrongPlaceShapes(unittest.TestCase):
    def test_the_rule_for_lists_and_limited_remote_is_in_the_question_without_the_rounds_words(self):
        for rule in RULES:
            self.assertIn(rule, place_triage.SYSTEM)
        for word in BENCHMARK_WORDS:
            self.assertNotIn(word, place_triage.SYSTEM)

    def test_remote_from_anywhere_in_an_anywhere_place_is_inside_when_reading_the_posting(self):
        self.assertIn('open as remote from anywhere inside a place where anywhere is fine', place_triage.READ_SYSTEM)

    def test_old_answers_are_asked_again(self):
        self.assertGreaterEqual(place_triage.VERSION, 4)


# The place prompts' fixed case set (27 Oct 2026): both sides of the rule, so a fix for one cannot silently break the other. `want` is what a
# correct answer is; PLACE_PROMPT_LIVE=1 replays them on the configured AI (the subscription, Haiku). Quality golden 3003/3010 = desktop/e2e/fixtures/golden/board.json.
SWISS = {'best_places': ['Zurich'], 'anywhere_in': ['Switzerland'], 'cities_abroad': [], 'remote_jobs': 'yes'}
CASES = [
    {'where': 'Vienna; London; Munich; Barcelona', 'places': {'best_places': ['Zagreb'], 'anywhere_in': ['Croatia']}, 'want': 'out'},
    {'where': 'Remote; New York City - Hybrid; Poland; London', 'places': {'best_places': ['Helsinki'], 'anywhere_in': ['Finland']}, 'want': 'out'},
    {'where': 'Switzerland (remote)', 'places': SWISS, 'want': 'in', 'text': 'Fully remote from anywhere in Switzerland, no office. Run CI/CD, Kubernetes and AWS infrastructure.'},
    {'where': 'Remote - Switzerland', 'places': SWISS, 'want': 'in', 'text': 'Work remotely from anywhere in Switzerland. English working language.'},
]


class TheFixedCases(unittest.TestCase):
    def test_both_sides_are_in_the_set(self):
        self.assertEqual({c['want'] for c in CASES}, {'in', 'out'})

    def test_a_posting_read_sends_its_places_and_words_to_the_reader(self):
        import json
        from types import SimpleNamespace
        sent = []

        def create(**kwargs):
            sent.append(kwargs['messages'][0]['content'])
            body = {'jobs': [{'n': 1, 'where': 'Switzerland', 'nearest': 'Switzerland', 'km': 0, 'answer': 'inside'}]}
            return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(body))], usage=SimpleNamespace(input_tokens=0, output_tokens=0))
        case = CASES[2]
        job = {'url': 'https://x.test/3003', 'title': 'Senior DevOps Engineer', 'location': case['where'], 'description': case['text']}
        with tempfile.TemporaryDirectory() as tmp, \
                unittest.mock.patch.object(place_triage, 'places_words', lambda search, prefs=None: case['places']), \
                unittest.mock.patch.object(place_triage, '_load_read', lambda: {}), unittest.mock.patch.object(place_triage, 'LOCK'), \
                unittest.mock.patch.object(place_triage, 'READ_STORE', Path(tmp) / 'place_reading.json'), unittest.mock.patch('builtins.print'):
            found = place_triage.read([job], {}, SimpleNamespace(messages=SimpleNamespace(create=create)))
        self.assertTrue(sent and 'anywhere_in' in sent[0] and 'Switzerland' in sent[0] and 'anywhere in Switzerland' in sent[0])
        self.assertEqual(next(iter(found.values()))['place'], 'in')   # gitar-bot, #2242: a real temp store and an answer that is always checked


if __name__ == '__main__':
    unittest.main()
