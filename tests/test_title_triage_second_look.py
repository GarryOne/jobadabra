"""A title the AI sort rejects although it holds one of the search's own role words gets a second, narrower look before the job may leave the list
(owner, 27 Oct 2026, "Ask again before closing"; main's quality run 40508145728: Free AI said no to 'Staff Platform Engineer, Kubernetes' and 'Cloud
Infrastructure Engineer' for an SRE/platform search after both were scored and listed, so they were closed before their facts were read)."""
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from src.ai import title_triage

SEARCH = {'role_keywords': ['platform engineer', 'infrastructure engineer', r'\bsre\b'], 'title_exclude_keywords': []}
TITLES = ['Senior SRE', 'Staff Platform Engineer, Kubernetes', 'Cloud Infrastructure Engineer', 'Pastry Chef', 'Product Owner Platform']


class Client:
    """Answers the sort (the first call) with `first`, a second look (RECHECK_SYSTEM) with `second` or an error."""
    def __init__(self, first, second, fails=False):
        self.first, self.second, self.fails, self.calls = first, second, fails, []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        text = kwargs['messages'][0]['content']
        listed = text.split('The titles:\n', 1)[1].split('\n')
        again = kwargs['system'][0]['text'] == getattr(title_triage, 'RECHECK_SYSTEM', None)
        self.calls.append((again, listed))
        if again and self.fails:
            raise RuntimeError('busy')
        wanted = self.second if again else self.first
        numbers = [int(line.split('.', 1)[0]) for line in listed if any(word in line for word in wanted)]
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'fit': numbers}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class SecondLookTest(unittest.TestCase):
    def setUp(self):
        patch = mock.patch.object(title_triage, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 't.json')
        patch.start()
        self.addCleanup(patch.stop)

    def test_a_no_on_a_title_with_a_role_word_is_asked_again_alone(self):
        client = Client(first=['senior sre'], second=['staff platform', 'infrastructure'])
        got = title_triage.decide(TITLES, SEARCH, client)
        self.assertTrue(got['staff platform engineer, kubernetes'] and got['cloud infrastructure engineer'], 'the second look kept both jobs')
        self.assertFalse(got['pastry chef'], 'no role word: the first no stands, never asked twice')
        again = [listed for was_second, listed in client.calls if was_second]
        self.assertEqual(len(again), 1, 'one narrow call for the doubted titles')
        self.assertFalse(any('pastry' in line for line in again[0]), 'only titles that hold a role word are asked again')

    def test_two_nos_close_the_job(self):
        client = Client(first=['senior sre'], second=['nothing matches'])
        got = title_triage.decide(TITLES, SEARCH, client)
        self.assertFalse(got['staff platform engineer, kubernetes'])
        self.assertFalse(got['product owner platform'])

    def test_a_second_look_that_fails_leaves_those_titles_unjudged_for_the_next_refresh(self):
        client = Client(first=['senior sre'], second=[], fails=True)
        got = title_triage.decide(TITLES, SEARCH, client)
        self.assertNotIn('staff platform engineer, kubernetes', got, 'unknown, not a guessed no (a job already listed stays open until it is judged)')
        self.assertNotIn('staff platform engineer, kubernetes', title_triage.known(SEARCH), 'and it is asked again next time')
        self.assertTrue(got['senior sre'], 'the other answers are kept')
        self.assertFalse(got['pastry chef'])


if __name__ == '__main__':
    unittest.main()
