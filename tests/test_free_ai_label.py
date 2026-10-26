"""A call answered by Free AI's open model is labelled with that model and costs the person's AI budget nothing (26 Oct 2026: a Free AI run said
"Scored 21 of 21 job(s) with claude-sonnet-5-5", saved it as scores.model and priced it at Sonnet's rate, $0.30)."""
import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from src.ai import cost  # noqa: E402
from src.ai.providers.anthropic_api import AnthropicApi  # noqa: E402
from src.notion import cron_report  # noqa: E402

OPEN = '@cf/qwen/qwen3-30b-a3b-fp8'


def answer(model):
    """What the SDK hands back: the Message names the model that answered; its usage never does."""
    usage = SimpleNamespace(input_tokens=1_000_000, output_tokens=100_000, cache_read_input_tokens=0, cache_creation_input_tokens=0)
    return SimpleNamespace(model=model, usage=usage)


def ask(model):
    client = SimpleNamespace(messages=SimpleNamespace(create=lambda **p: answer(model)))
    return AnthropicApi(client=client).messages.create(model='claude-sonnet-5-5', messages=[])


class FreeAiLabelTests(unittest.TestCase):
    def test_every_place_that_names_or_prices_the_answering_model_follows_free_ai(self):
        usage = ask(OPEN).usage
        stats = {}
        cost.add(stats, 'claude-sonnet-5-5', usage)
        side_before = dict(cost.SIDE)
        try:
            cost.side('claude-sonnet-5-5', usage)
            side_model, side_usd = cost.SIDE['model'], cost.SIDE['usd'] - side_before.get('usd', 0.0)
        finally:
            cost.SIDE.clear()
            cost.SIDE.update(side_before)
        places = {'answered': cost.answered('claude-sonnet-5-5', usage), 'add': stats['model'], 'side': side_model}
        for place, said in places.items():
            with self.subTest(place=place):
                self.assertEqual(said, OPEN)
        for place, usd in {'usd': cost.usd('claude-sonnet-5-5', usage), 'add': stats['usd'], 'side': side_usd}.items():
            with self.subTest(place=place):
                self.assertEqual(usd, 0.0)

    def test_the_anthropic_api_keeps_its_own_name_and_price(self):
        usage = ask('claude-sonnet-5-5').usage
        self.assertEqual(cost.answered('claude-sonnet-5-5', usage), 'claude-sonnet-5-5')
        self.assertAlmostEqual(cost.usd('claude-sonnet-5-5', usage), 3.0)

    def test_billed_to_names_free_ai_and_every_provider_has_every_label(self):
        # A Free AI run said "Anthropic API credits" (26 Oct 2026): the provider a stage records picks the label, in all three words tables.
        stats = {}
        cost.add(stats, 'claude-sonnet-5-5', ask(OPEN).usage)
        self.assertEqual(cron_report.billed_to({'score': stats}), 'Free AI')
        self.assertEqual(cron_report.cost_text({'score': stats}).startswith('AI cost $0.000'), True)
        for family in ('claude', 'openai', 'free'):
            for calls in ('api_calls',) if family == 'free' else ('api_calls', 'cli_calls'):   # Free AI has no plan path
                with self.subTest(family=family, calls=calls):
                    self.assertTrue(cron_report.billed_to({'score': {calls: 1, 'provider': family}}))
                    self.assertIn(family, cron_report.PLAN_WORDS)
        claude = {}
        cost.add(claude, 'claude-sonnet-5-5', ask('claude-sonnet-5-5').usage)
        self.assertEqual(cron_report.billed_to({'score': claude}), 'Anthropic API credits')


if __name__ == '__main__':
    unittest.main()
