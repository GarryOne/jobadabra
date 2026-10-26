"""On Free AI a job that can show (first score 50+) is scored twice (src/ai/score_agree.py): two scores within 8 points keep their mean,
two further apart get a third ask and keep the middle answer whole. Claude, a low first score and a non-job are asked once.
Measured 26 Oct 2026 (690 draws, CI's quality fixtures): Free AI's same request moved > 8 points on 17 of 23 asks; asking twice, 3 of 23."""
import json
import os
import unittest
from types import SimpleNamespace
from unittest import mock

from src.ai import score

FREE_AI = {'JOB_PILOTTO_AI_ENGINE': 'api', 'ANTHROPIC_API_KEY': 'JPF1.test-install'}
CLAUDE = {'JOB_PILOTTO_AI_ENGINE': 'api', 'ANTHROPIC_API_KEY': 'sk-ant-test'}
JOB = {'id': 1, 'title': 'Platform Engineer', 'company': 'Acme', 'location': 'Zurich', 'description': 'Kubernetes, Terraform.',
       'ai': {'salary': {'stated': False}, 'seniority': {'value': 'unknown'}}}


def answer(value, reason='', one_job=True):
    return {'score': value, 'tier': 'B', 'reason': reason or f'draw {value}', 'confidence': 'medium',
            'basis': {'salary_stated': False, 'level_stated': False, 'one_job': one_job},
            'components': {'role_fit': value, 'location': 80, 'compensation': None, 'growth': None, 'risk': 20},
            'strengths': ['Kubernetes'], 'gaps': ['salary not stated']}


def client(*answers):
    queue, asked = list(answers), []
    def create(**params):
        asked.append(params)
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(queue.pop(0)))],
                               usage=SimpleNamespace(input_tokens=10, output_tokens=5, cache_read_input_tokens=0))
    return SimpleNamespace(messages=SimpleNamespace(create=create), asked=asked)


def scored(env, *answers):
    fake = client(*answers)
    with mock.patch.dict(os.environ, env), mock.patch('src.ai.score.score_search.block', return_value=''), \
            mock.patch('src.ai.score.locations.block_now', return_value=''), mock.patch('src.ai.score.hints.load', return_value=None):
        data, usage = score.score_one(fake, 'claude-sonnet-5-5', dict(JOB), 'Profile: SRE in Zurich')
    return data, usage, len(fake.asked)


class AskTwiceOnFreeAi(unittest.TestCase):
    def test_two_close_scores_keep_their_mean(self):
        data, usage, asks = scored(FREE_AI, answer(70), answer(76))
        self.assertEqual((data['score'], asks), (73, 2))
        self.assertEqual(usage.input_tokens, 20)   # both asks are counted in the run's cost

    def test_two_far_scores_get_a_third_and_keep_the_middle_answer_whole(self):
        data, _, asks = scored(FREE_AI, answer(55, 'low'), answer(85, 'high'), answer(70, 'middle'))
        self.assertEqual((data['score'], data['reason'], asks), (70, 'middle', 3))

    def test_a_low_first_score_is_asked_once(self):
        data, _, asks = scored(FREE_AI, answer(35))
        self.assertEqual((data['score'], asks), (35, 1))

    def test_a_non_job_is_not_asked_for_agreement(self):
        # the not-a-job recheck still asks once more (score_not_a_job); agreement adds nothing on top
        _, _, asks = scored(FREE_AI, answer(80, one_job=False), answer(80, one_job=False))
        self.assertEqual(asks, 2)

    def test_claude_is_asked_once(self):
        data, _, asks = scored(CLAUDE, answer(70))
        self.assertEqual((data['score'], asks), (70, 1))


if __name__ == '__main__':
    unittest.main()
