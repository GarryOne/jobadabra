"""The time a beta by hand takes is measured on the last finished betas, never typed (tools/beta_took.py; the start line of tools/beta-release.sh)."""
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import beta_took  # noqa: E402


def run(minutes, conclusion='success', title='Beta by hand'):
    return {'displayTitle': title, 'conclusion': conclusion, 'createdAt': '2026-11-02T02:00:00Z', 'updatedAt': f'2026-11-02T02:{minutes:02d}:00Z'}


class Took(unittest.TestCase):
    def test_the_range_of_the_last_five_finished_betas(self):
        runs = [run(17), run(19, 'failure'), run(22, 'failure'), run(16), run(17), run(27)]
        self.assertEqual(beta_took.took(runs), 'the last 5 took 16–22 min', 'the 6th (27 min) is older than the last five')

    def test_a_cancelled_run_or_another_run_says_nothing_about_the_time(self):
        runs = [run(2, 'cancelled'), run(40, title='Nightly'), run(18)]
        self.assertEqual(beta_took.took(runs), 'the last 1 took 18 min')

    def test_no_finished_beta_gives_no_line(self):
        self.assertIsNone(beta_took.took([run(3, 'cancelled')]))
    # The start line itself: tests/test_beta_pick.py BetaPickTag runs tools/beta-release.sh --no-watch and reads what it prints.


if __name__ == '__main__':
    unittest.main()
