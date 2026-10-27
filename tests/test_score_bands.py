"""The scorer's bands: what an overall score means, including a stated requirement the profile shows is unmet (src/ai/score_bands.py).
Why: golden job 3005 (German C1 required, the profile has B1 and lists fluent German as disqualifying) scored 70, 45 and 35 on the same input
(27 Oct 2026, 29 quality runs: 17 of 29 second scorings within 8 points); the bands named no place for it, so the AI picked one each time."""
import unittest

from src.ai import score, score_bands


class ScoreBands(unittest.TestCase):
    def test_the_prompt_carries_the_bands(self):
        self.assertIn(score_bands.TEXT, score.SYSTEM)
        for band in ('85-100', '70-84', '50-69', '30-49', '0-29'):
            self.assertIn(band, score_bands.TEXT)

    def test_an_unmet_stated_requirement_has_its_band(self):
        rule = score_bands.UNMET
        self.assertIn(rule, score_bands.TEXT)
        for words in ('requirement the posting states', 'the profile shows', 'at most 49', 'Tier C', 'not mentioned'):
            self.assertIn(words, rule)


if __name__ == '__main__':
    unittest.main()
