"""The Search check has ONE verdict function for a persona's row (gate.row_verdict) and the overall line is built from the rows (owner, 2 Nov 2026).
Origin: the comment on #2969 said "⚪ not measured (1 of 6)" while p2-p6 showed 🟢 with 0 right jobs: the row and the overall line used two rules
(6 PRs in 2 days: #2917 #2934 #2943 #2955 #2961 and this one). Rows are replayed from the real run 41384367956.

Design: ONE function decides a row; the overall line is only the rows added up.
  🔴 a fault: press failed, over 180 s, cost over the cap, a step off the small tier, no result.
  ⚪ no right job: AI queue full / cut by the cap / no job scored / jobs scored but none right role and place. The row says which.
  🟢 at least one right job (the blind judge's role AND place), no fault.
Overall: any 🔴 row (or the pooled total below main's range) is red; no 🟢 row is grey; otherwise green "measured k of 6". Only red blocks a PR."""
import itertools
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools' / 'persona-search'))
import gate  # noqa: E402

CUT = 'cut by the cap after 171 s with no job scored; longest wait for the AI 45 s'


def row(n, seconds, scored, found, local=0, **more):
    return {'persona': n, 'local': local, 'found': found, 'scored': scored, 'seconds': seconds, 'code': 0, 'crashes': 0, 'usd': 0, 'billing': 'subscription', 'non_haiku': 0, **more}


# #2969's table (run 41384367956): found 0·5·0·0·2·0, right jobs 0 everywhere, presses 155-171 s, p1 waited 45 s for the AI. p2 scored 3 jobs and p5 scored 2, none right.
PR_2969 = {1: row(1, 171, 0, 0, cut=CUT, not_measured='AI queue full (waited 45 s)'), 2: row(2, 166, 3, 5), 3: row(3, 164, 0, 0),
           4: row(4, 155, 0, 0), 5: row(5, 155, 2, 2), 6: row(6, 163, 0, 0)}
MAIN_0_0_0 = {n: row(n, 150, 0, 0) for n in range(1, 7)}


def marks(verdict):
    return [r['mark'] for r in verdict['rows']]


class TheRowsAndTheOverallLineAgree(unittest.TestCase):
    def test_2969s_table_is_grey_on_every_row_and_overall(self):
        verdict = gate.compare(PR_2969, [MAIN_0_0_0] * 3)
        self.assertEqual(marks(verdict), ['⚪'] * 6, 'was 🟢 on p2-p6 under a grey overall line')
        self.assertEqual(verdict['state'], 'neutral')
        self.assertNotIn('🟢', gate.table(verdict).replace('🟢 measured', ''), 'no green row under a grey line')
        self.assertIn('AI queue full', verdict['rows'][0]['why'])
        self.assertIn('scored 3', verdict['rows'][1]['why'])
        self.assertIn('no job scored', verdict['rows'][2]['why'])

    def test_one_row_with_a_right_job_is_green_and_the_line_says_measured_one_of_six(self):
        verdict = gate.compare({**PR_2969, 4: row(4, 155, 4, 6, local=2)}, [MAIN_0_0_0] * 3)
        self.assertEqual(marks(verdict), ['⚪', '⚪', '⚪', '🟢', '⚪', '⚪'])
        self.assertEqual(verdict['state'], 'success')
        self.assertIn('measured 1 of 6', verdict['head'])

    def test_a_press_over_180_seconds_is_red_row_and_red_line_even_with_a_right_job(self):
        verdict = gate.compare({**PR_2969, 3: row(3, 190, 5, 7, local=1)}, [MAIN_0_0_0] * 3)
        self.assertEqual(marks(verdict)[2], '🔴')
        self.assertEqual(verdict['state'], 'failure')

    def test_a_total_below_mains_range_is_red(self):
        mains = [{n: row(n, 150, 5, 9, local=t if n == 1 else 0) for n in range(1, 7)} for t in [7, 5, 6, 8, 9, 5, 6, 7, 8, 5]]
        verdict = gate.compare({n: row(n, 150, 3, 5) for n in range(1, 7)}, mains)   # all six measured, none right: total 0 against main's lowest 5
        self.assertEqual((verdict['state'], verdict['quality']['mode'], verdict['quality']['red']), ('failure', 'gated', True))

    def test_a_red_from_the_pooled_total_names_the_personas_that_dropped(self):
        """mac-07, 2 Nov 2026: no row is red then, so the line itself says where to look."""
        mains = [{n: row(n, 150, 5, 9, local=(3 if n == 2 else 1) if n in (1, 2) else 0) for n in range(1, 7)} for _ in range(10)]
        mains[0][2]['local'] = 4   # spread, so the floor is a real number
        verdict = gate.compare({n: row(n, 150, 3, 5) for n in range(1, 7)}, mains)
        self.assertEqual(verdict['state'], 'failure')
        self.assertEqual(marks(verdict).count('🔴'), 0, 'a red line without a red row')
        self.assertIn('p2 4→0 right', verdict['head'])
        self.assertIn('p1 1→0 right', verdict['head'])
        self.assertNotIn('p3', verdict['head'].split('·')[0], 'p3 was 0 on main: it did not drop')

    def test_every_mix_of_row_kinds_gives_the_overall_line_the_rows_say(self):
        """One loop over the class: the overall state is a function of the six marks and nothing else (no quality gate: no main runs)."""
        kinds = {'fault': lambda n: row(n, 200, 3, 3, local=1), 'right': lambda n: row(n, 150, 3, 3, local=1), 'none right': lambda n: row(n, 150, 3, 5),
                 'nothing scored': lambda n: row(n, 150, 0, 0), 'queue full': lambda n: row(n, 171, 0, 0, not_measured='AI queue full (waited 50 s)')}
        for combo in itertools.product(kinds, repeat=3):
            with self.subTest(combo=combo):
                pr = {n: kinds[combo[(n - 1) % 3]](n) for n in range(1, 7)}
                verdict = gate.compare(pr, [])
                shown = marks(verdict)
                want = 'failure' if '🔴' in shown else ('success' if '🟢' in shown else 'neutral')
                self.assertEqual(verdict['state'], want, shown)
                if want == 'success':
                    self.assertIn(f"measured {shown.count('🟢')} of 6", verdict['head'])


if __name__ == '__main__':
    unittest.main()
