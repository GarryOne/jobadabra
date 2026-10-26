"""The scorer's prompt keeps its texts to what the posting says: no cross-currency comparison, no judgment of what the posting leaves out."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from src.ai import score  # noqa: E402


class ScoreTextsGrounded(unittest.TestCase):
    # E2E quality on Free AI (26 Oct 2026, #2052's run): the Sonnet judge flagged "Salary EUR 95k-120k below CHF 140k minimum" (the prompt
    # itself said to write "below your minimum" for another currency) and "Growth opportunities limited" (the posting says nothing on growth).
    # The postings are the quality fixtures 3003 and 3004 (desktop/e2e/fixtures/golden/board.json).
    def test_another_currency_is_quoted_never_compared(self):
        self.assertIn('another currency than the profile', score.SYSTEM)
        self.assertIn('never say it is below or above your figures', score.SYSTEM)

    def test_what_the_posting_leaves_out_is_an_unknown_not_a_judgment(self):
        self.assertIn('never a judgment of it', score.SYSTEM)


if __name__ == '__main__':
    unittest.main()
