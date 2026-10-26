"""The one-way contract helpers (tests/site_private.py): the site may run ahead of public, never behind. Owner, 21 Oct 2026: reds only because a repo pair was landing."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from site_private import assert_site_accepts, site_missing  # noqa: E402


class OneWayContractTests(unittest.TestCase):
    def test_the_site_ahead_of_public_is_green(self):
        assert_site_accepts(self, ['a', 'b'], ['b', 'a', 'c_new_on_site'], 'feed types')

    def test_public_ahead_of_the_site_is_red(self):
        self.assertEqual(site_missing(['a', 'b', 'new_in_public'], ['a', 'b']), ['new_in_public'])
        with self.assertRaises(AssertionError) as caught:
            assert_site_accepts(self, ['a', 'new_in_public'], ['a'], 'feed types')
        self.assertIn('new_in_public', str(caught.exception))

    def test_an_equal_list_is_green_whatever_the_order(self):
        assert_site_accepts(self, ('a', 'b'), ['b', 'a'], 'x')


if __name__ == '__main__':
    unittest.main()
