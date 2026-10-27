"""The place question names the wrong-place shapes the 10-persona round found (27 Oct 2026, 4e's judged rows: 13 of 113 jobs local): a list of cities without the
person's, and remote limited to another region, are out even when they accept remote. The AI's answer is the model's; this keeps the prompt's cases and
the version that makes old answers asked again. No network."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import place_triage  # noqa: E402

SHAPES = ('Vienna; London; Munich', 'Remote (South Africa)', 'Ukraine, Remote', 'Remote: UK', 'Toronto - Remote', 'Paris - Full Remote')


class WrongPlaceShapes(unittest.TestCase):
    def test_every_wrong_place_shape_is_named_in_the_question(self):
        for shape in SHAPES:
            self.assertIn(shape, place_triage.SYSTEM)

    def test_old_answers_are_asked_again(self):
        self.assertGreaterEqual(place_triage.VERSION, 4)


if __name__ == '__main__':
    unittest.main()
