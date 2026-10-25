"""Long steps say where they are (src/progress.py): at the start, at most every few seconds, and at the end."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import json  # noqa: E402
from src.progress import Eta, SLOW, Ticker  # noqa: E402


class TickerTest(unittest.TestCase):
    def test_start_then_paced_then_end(self):
        said, now = [], [0.0]
        ticker = Ticker('Reading new jobs with AI', 26, every=8, clock=lambda: now[0], out=said.append)
        for done, at in ((1, 1), (2, 5), (3, 9), (4, 12), (26, 13)):
            now[0] = at
            ticker.tick(done)
        self.assertEqual(said, ['⏳ Reading new jobs with AI: 0 of 26', '⏳ Reading new jobs with AI: 3 of 26 · about 1 min left', '⏳ Reading new jobs with AI: 26 of 26'])

    def test_extra_words_and_nothing_for_an_empty_step(self):
        said = []
        Ticker('Reading employer job sites', 202, out=said.append).tick(202, ' · 3,412 jobs listed')
        self.assertEqual(said[-1], '⏳ Reading employer job sites: 202 of 202 · 3,412 jobs listed')
        quiet = []
        Ticker('Scoring jobs against your Profile', 0, out=quiet.append).tick(0)
        self.assertEqual(quiet, [])

    def test_time_left_from_the_pace_so_far(self):
        eta = Eta(0)
        self.assertEqual(eta.text(120, 1, 6), ' · about 10 min left')    # 2 min a batch, 5 to go
        self.assertEqual(Eta(0).text(150, 5, 6), ' · under a minute left')
        self.assertEqual(Eta(0).text(5, 5, 6), '')                        # a few seconds: not worth saying
        self.assertEqual((Eta(0).text(0, 0, 6), Eta(0).text(300, 6, 6)), ('', ''))  # nothing done yet, and the end


def minutes(text):
    """The number of seconds a line promises: minutes as said, 'under a minute' as 59, nothing/the end as 0, SLOW as None (no number)."""
    if text == SLOW:
        return None
    return int(text.split('about ')[1].split()[0]) * 60 if 'about' in text else 59 if text else 0


class EtaNeverGoesUpTest(unittest.TestCase):
    """Owner, 25 Oct 2026: "it was saying before 1 min left, now it says 2 min left"; later sites were slower than the first ones."""

    def run_eta(self, gaps, total):
        eta, now, out = Eta(0.0), 0.0, []
        for done, gap in enumerate(gaps, 1):
            now += gap
            out.append(eta.text(now, done, total))
        return out

    def test_slower_later_items_never_raise_the_number(self):
        for gaps in ([0.5] * 100 + [2.0] * 90 + [40.0] * 10, [0.2] * 30 + [3.0] * 170, [1.0, 9.0] * 100):
            shown = [minutes(t) for t in self.run_eta(gaps, 240) if t != SLOW]
            self.assertEqual(shown, sorted(shown, reverse=True), gaps[:3])

    def test_the_old_whole_run_average_did_go_up(self):
        """The check above must fail on the old rule (elapsed / done x remaining, rounded)."""
        now, old = 0.0, []
        for done, gap in enumerate([0.5] * 100 + [2.0] * 90, 1):
            now += gap
            old.append(round(now / done * (240 - done) / 60))
        self.assertNotEqual(old, sorted(old, reverse=True))

    def test_a_stall_says_so_instead_of_a_bigger_number(self):
        eta = Eta(0.0)
        for done in range(1, 21):
            eta.text(done * 0.5, done, 100)
        self.assertEqual(eta.text(10 + 300, 21, 100), SLOW)    # one item took five minutes

    def test_every_estimate_comes_from_this_one_rule(self):
        """Ticker (every engine step) and the app's download (desktop/renderer/eta.js) share Eta; the fixture is run by both."""
        data = json.loads((Path(__file__).parent / 'fixtures' / 'eta-sequence.json').read_text(encoding='utf-8'))
        eta = Eta(data['started'])
        self.assertEqual([eta.text(t, done, data['total']) for t, done, _ in data['calls']], [text for *_, text in data['calls']])


if __name__ == '__main__':
    unittest.main()
