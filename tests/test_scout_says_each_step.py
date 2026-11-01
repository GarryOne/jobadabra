"""Find new employers says each step as it starts, so the app's live log is never empty for minutes (5 Oct 2026, the owner's find: "Nothing to show
yet" for four minutes). A planted code bug (desktop/e2e/mutants.json scout-silent) silences the module's print; this test turns red then."""
import contextlib
import io
import unittest
from unittest import mock

from src import scout_run


class FakeScout:
    """The scout module's parts read_lists touches: no tables, no config, no skipped list origins (or some, for the second wording)."""
    def __init__(self, skip=()):
        self.skip, self.tables = list(skip), 0

    def skipped_origins(self, seeds, technical):
        return self.skip

    def load_search_config(self):
        return {}

    def ensure_tables(self, db):
        self.tables += 1


class ScoutSaysEachStep(unittest.TestCase):
    def said(self, scout):
        out = io.StringIO()
        with mock.patch('src.ai.scout_ideas.technical', return_value=True), contextlib.redirect_stdout(out):
            scout_run.read_lists(scout, db=None, seeds=[])
        return out.getvalue()

    def test_reading_the_lists_is_said_before_it_starts(self):
        scout = FakeScout()
        self.assertIn('Scout: reading the employer lists', self.said(scout))
        self.assertEqual(scout.tables, 1)

    def test_lists_left_out_for_a_search_outside_it_are_said_too(self):
        self.assertIn('the tech company lists are left out', self.said(FakeScout(skip=['tech lists'])))


if __name__ == '__main__':
    unittest.main()
