"""The Search check is never green when the search is broken (owner, 2 Nov 2026: "still, everything is 0", while the check read 🟢): six presses that
found no right job, and a quality gate that is "not gated while main's lowest is 0", made it blind exactly when search found nothing. Run 41376694937:
local 0 · 0 · 0 · 0 · 0 · 0 (found 0, 0, 0, 0, 1, 28), header 🟢 "Codex subscription" while Claude answered."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import gate  # noqa: E402


def row(n, local=0, found=0, **more):
    return {'persona': n, 'local': local, 'found': found, 'seconds': 150, 'code': 0, 'crashes': 0, 'usd': 0, 'billing': 'subscription', **more}


def six(by_persona=None):
    by_persona = by_persona or {}
    return {n: row(n, **by_persona.get(n, {})) for n in range(1, 7)}


class ZeroRightJobsIsNeverGreen(unittest.TestCase):
    def test_six_presses_with_no_right_job_are_grey_not_green(self):
        verdict = gate.compare(six({5: {'found': 1}, 6: {'found': 28}}), [])
        self.assertEqual(verdict['state'], 'neutral')
        self.assertIn('found 0 right jobs on all six', verdict['head'])
        self.assertNotIn('🟢', verdict['head'])
        self.assertEqual({r['mark'] for r in verdict['rows']}, {'⚪'}, 'no green row in a run that is not a pass')

    def test_one_right_job_anywhere_keeps_the_check_as_it_was(self):
        self.assertEqual(gate.compare(six({4: {'local': 1, 'found': 3}}), [])['state'], 'success')

    def test_a_red_press_stays_red_whatever_the_jobs(self):
        runs = six({2: {'seconds': 200}})
        self.assertEqual(gate.compare(runs, [])['state'], 'failure')

    def test_the_header_names_the_engine_the_presses_logged_not_a_fixed_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'draw').mkdir()
            (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'code': 0, 'crashes': [], 'seconds': 150, 'scored_in_places': 3, 'funnel': {'ai_usd': 0}}) + '\n')
            (out / 'judged.json').write_text(json.dumps({'usd': 0, 'rows': [{'role': 'yes', 'place': 'yes'}]}))
            (out / 'run.log').write_text('AI: claude / claude-haiku-5-5 (codex ran-out)\nrelay: small total 10 broker 9 waited 1 in-flight 1\n')
            result = gate.result(3, out)
        self.assertEqual(result['engine'], 'claude (claude-haiku-5-5; codex ran-out)')
        verdict = gate.compare({**six(), 3: row(3, local=2, found=2, engine=result['engine'])}, [])
        table = gate.table(verdict)
        self.assertIn('claude (claude-haiku-5-5; codex ran-out)', table)
        self.assertNotIn('Codex subscription', table)

    def test_an_ai_line_with_only_an_engine_or_only_a_model_still_names_it(self):
        """Gitar on #2961: aiLine prints `AI: gpt-6-luna` when an answer names only one of the two."""
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / 'run.log'
            log.write_text('AI: gpt-6-luna\nAI: claude / claude-haiku-5-5\nAI: free-ai / llama (codex ran-out; claude ran-out)\n')
            self.assertEqual(gate.engines_of(log), 'gpt-6-luna + claude (claude-haiku-5-5) + free-ai (llama; codex ran-out; claude ran-out)')

    def test_without_an_engine_line_the_header_says_it_was_not_reported(self):
        table = gate.table(gate.compare(six({4: {'local': 1, 'found': 3}}), []))
        self.assertIn('AI engine not reported', table)

    def test_a_press_cut_by_the_cap_is_not_red_for_a_cost_it_never_reached(self):
        """Run 41379413905 (PR #2961): three presses were cut at 178 s with no job scored and were red only for "the press cost was not measured", which
        the cut itself explains (the cost step comes after the scoring). A cut press with a measured cost stays as it was; any other red reason stays."""
        cut = row(1, cost_unmeasured=True, usd=None, cut='cut by the cap after 178 s with no job scored; longest wait for the AI 36 s', seconds=178)
        self.assertEqual(gate.judge_one(cut, [])[0], [])
        self.assertTrue(gate.judge_one({**cut, 'cut': ''}, [])[0], 'an unmeasured cost without a cut is still red')
        self.assertTrue(gate.judge_one({**cut, 'seconds': 200}, [])[0], 'a press over 180 s is still red')

    def test_a_press_that_found_nothing_says_where_the_time_went(self):
        funnel = {'places_worked_out_s': 10, 'web_search_started_s': 10, 'employers_named_s': 43, 'time_up': ['job boards', 'employer sites'], 'web_search_skipped': False}
        skipped = {'places_worked_out_s': None, 'web_search_started_s': None, 'employers_named_s': 45, 'time_up': [], 'web_search_skipped': True}
        runs = six({2: {'funnel_note': gate.funnel_note(funnel)}, 1: {'funnel_note': gate.funnel_note(skipped)}})
        table = gate.table(gate.compare(runs, []))
        self.assertIn('p2', table)
        self.assertIn('places worked out at 10 s; web search started at 10 s; employers named at 43 s; time ran out for: job boards, employer sites', table)
        self.assertIn('web search never started (no places or roles known)', table)


if __name__ == '__main__':
    unittest.main()
