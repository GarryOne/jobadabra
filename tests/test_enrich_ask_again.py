"""A job fact a reader needs that the AI leaves empty is asked once more, alone (owner, 26 Oct 2026: "Ask again when empty")."""
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import cost, enrich  # noqa: E402
from tests.test_enrich import facts, full  # noqa: E402

JOB = {'title': 'Account Executive, DACH', 'company': 'Example', 'location': 'Zurich',
       'description': 'Quota carrying, 5 years of enterprise sales experience, fluent German required. Hybrid in Zurich.'}


class Answers:
    """Answers in turn, recording each request; usage says who answered and how it was paid."""
    def __init__(self, *answers):
        self.answers, self.requests, self.messages = list(answers), [], self

    def create(self, **params):
        self.requests.append(params)
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(self.answers.pop(0)))],
                               usage=SimpleNamespace(input_tokens=100, output_tokens=10, model='free-ai-model', billing='subscription'))


class AskAgainWhenEmpty(unittest.TestCase):
    # E2E quality on Free AI (#2056's run): "5 years of enterprise sales experience" came back seniority unknown, so Seniority and Growth were empty.
    def test_an_empty_fact_is_asked_again_alone_and_its_second_answer_kept(self):
        first = facts(role_family='sales_b2b', work_mode={'value': 'hybrid', 'remote_scope': '', 'evidence': 'Hybrid in Zurich'}, technologies=['Salesforce'])
        client = Answers(first, {'seniority': {'value': 'mid', 'evidence': '5 years of enterprise sales experience'}})
        data, usage = enrich.extract(client, 'free-ai-model', JOB)
        self.assertEqual(len(client.requests), 2)
        again = client.requests[1]
        self.assertEqual(again['output_config']['format']['schema']['required'], ['seniority'], 'only the empty fact')
        self.assertIn('left seniority empty', again['messages'][0]['content'])
        self.assertEqual(data['seniority']['value'], 'mid')
        self.assertEqual(data['work_mode']['value'], 'hybrid', 'the filled facts of the first answer stay')
        self.assertEqual((usage.input_tokens, usage.output_tokens, usage.model, usage.billing), (200, 20, 'free-ai-model', 'subscription'))

    def test_a_full_answer_is_asked_once(self):
        client = Answers(full())
        enrich.extract(client, 'free-ai-model', JOB)
        self.assertEqual(len(client.requests), 1)

    def test_a_second_unknown_is_kept_as_the_answer(self):
        client = Answers(facts(role_family='sales_b2b'), facts(role_family='sales_b2b'))
        data, _ = enrich.extract(client, 'free-ai-model', dict(JOB, title='Sales'))
        self.assertEqual(len(client.requests), 2, 'asked once more, never a third time')
        self.assertEqual(data['seniority']['value'], 'unknown')

    def test_an_it_role_is_asked_again_alone_and_that_answer_decides(self):
        # Free AI put a different plain SRE posting in "software" on each quality run (owner, 26 Oct 2026: "Ask role alone").
        sre = dict(JOB, title='Senior SRE', description='Senior SRE for our platform. Kubernetes, Terraform, incident response. Hybrid in Bern.')
        client = Answers(full(role_family='software'), {'role_family': 'sre'})
        data, usage = enrich.extract(client, 'free-ai-model', sre)
        self.assertEqual(len(client.requests), 2)
        role = client.requests[1]
        self.assertEqual(role['output_config']['format']['schema']['required'], ['role_family'])
        self.assertEqual(role['system'], enrich.ROLE_SYSTEM, 'its own small question, not the 16-fact prompt')
        self.assertEqual(data['role_family'], 'sre')
        self.assertEqual(usage.input_tokens, 200)

    def test_a_role_outside_it_is_asked_once(self):
        client = Answers(full(role_family='healthcare'))
        self.assertEqual(enrich.extract(client, 'free-ai-model', JOB)[0]['role_family'], 'healthcare')
        self.assertEqual(len(client.requests), 1)

    def test_combined_usage_keeps_who_answered_and_how_it_was_paid(self):
        # score.py's own sum dropped billing and model: a re-asked subscription call counted as an API call.
        one = SimpleNamespace(input_tokens=1, output_tokens=2, model='m', provider='p', billing='subscription')
        both = cost.combined(one, SimpleNamespace(input_tokens=3, output_tokens=4))
        self.assertEqual((both.input_tokens, both.output_tokens, both.model, both.provider, both.billing), (4, 6, 'm', 'p', 'subscription'))


if __name__ == '__main__':
    unittest.main()
