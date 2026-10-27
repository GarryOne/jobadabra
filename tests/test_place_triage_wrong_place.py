"""The place question names the wrong-place shapes the 10-persona round found (27 Oct 2026, 4e's judged rows: 13 of 113 jobs local): a list of cities without the
person's, and remote limited to another region, are out even when they accept remote. The AI's answer is the model's; this keeps the prompt's cases and
the version that makes old answers asked again. No network."""
import sys
import unittest
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


if __name__ == '__main__':
    unittest.main()
