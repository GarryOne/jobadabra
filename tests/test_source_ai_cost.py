"""The AI that helps find sources counts in the run's AI cost and the monthly budget, and pauses with the other optional AI at 90%."""
import argparse
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import budget, cost  # noqa: E402
from src.notion import cron_runs  # noqa: E402


class SourceCostTests(unittest.TestCase):
    def setUp(self):
        cost.SIDE.clear()
        self.addCleanup(cost.SIDE.clear)

    def test_source_calls_add_up_and_count_in_the_runs_total(self):
        usage = SimpleNamespace(input_tokens=1_000_000, output_tokens=0, cache_read_input_tokens=0, cache_creation_input_tokens=0)
        cost.side('claude-haiku-4-5', usage)
        cost.side('claude-haiku-4-5', usage)
        cost.side('claude-haiku-4-5', None)   # a fake model in tests: nothing counted
        self.assertEqual((cost.SIDE['done'], round(cost.SIDE['usd'], 2)), (2, 2.0))
        run = {'score': {'usd': 0.5}, 'sources': dict(cost.SIDE)}
        self.assertEqual(round(cron_runs.total_usd(run), 2), 2.5)

    def test_a_web_search_s_fee_counts_with_its_tokens(self):
        """Anthropic charges $10 per 1,000 web searches on top of the tokens (19 Oct 2026: the board web search's $0.03 was missing from
        the run's cost); a call on a plan stays $0."""
        searched = SimpleNamespace(input_tokens=0, output_tokens=0, cache_read_input_tokens=0, cache_creation_input_tokens=0,
                                   server_tool_use=SimpleNamespace(web_search_requests=3))
        self.assertAlmostEqual(cost.usd('claude-haiku-5-5', searched), 0.03)
        self.assertEqual(cost.usd('claude-haiku-5-5', SimpleNamespace(**{**vars(searched), 'billing': 'subscription'})), 0.0)
        self.assertEqual(cost.usd('claude-haiku-5-5', SimpleNamespace(**{**vars(searched), 'server_tool_use': None})), 0.0)

    def test_every_web_search_caller_reports_its_cost(self):
        root = Path(__file__).resolve().parents[1] / 'src'
        callers = [path for path in root.rglob('*.py') if 'web_search_20250305' in path.read_text()]
        self.assertGreaterEqual(len(callers), 3)
        for path in callers:
            with self.subTest(path=path.name):
                self.assertIn('cost.side(', path.read_text(), 'its fee and tokens must reach the run cost')

    def test_at_the_monthly_pause_source_reading_is_switched_off_too(self):
        args = argparse.Namespace(auto_kit_max=3, score_max=60, enrich_max=200)
        warnings = []
        with mock.patch.dict(os.environ, {'JOBADABRA_DISABLE': 'google_jobs'}):
            budget.apply_caps(args, {'level': 'pause', 'pct': 0.93}, warnings)
            off = os.environ['JOBADABRA_DISABLE'].split(',')
        self.assertEqual(off, ['google_jobs', 'page_reader', 'job_alerts', 'scout_ai'])
        self.assertIn('AI source reading off', warnings[0])
        with mock.patch.dict(os.environ, {'JOBADABRA_DISABLE': ''}):
            self.assertFalse(budget.apply_caps(args, {'level': 'warn', 'pct': 0.75}, []))
            self.assertEqual(os.environ['JOBADABRA_DISABLE'], '')


if __name__ == '__main__':
    unittest.main()
