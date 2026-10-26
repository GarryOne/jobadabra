"""Owner, 7 Oct 2026: "Only the location should be strict": titles the role words miss are sorted by Claude, once per title and search."""
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from src.ai import title_triage
from src.sources import feeds

SEARCH = {'role_keywords': ['vendeur', 'photographe'], 'title_exclude_keywords': [r'\bintern\b']}


class Client:
    def __init__(self, fit):
        self.fit, self.calls = fit, []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(kwargs['messages'][0]['content'])
        listed = kwargs['messages'][0]['content'].split('The titles:\n', 1)[1].split('\n')
        numbers = [int(line.split('.', 1)[0]) for line in listed if any(word in line for word in self.fit)]
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'fit': numbers}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class TriageTest(unittest.TestCase):
    def setUp(self):
        self.store = mock.patch.object(title_triage, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 't.json')
        self.store.start()

    def tearDown(self):
        self.store.stop()

    def test_each_title_is_asked_about_once_per_search_and_kept(self):
        client = Client(['client advisor', 'magasin'])
        got = title_triage.decide(['Client Advisor', 'Head of Growth', 'Collaborateur Magasin (H/F)'], SEARCH, client)
        self.assertEqual(got, {'client advisor': True, 'head of growth': False, 'collaborateur magasin (h/f)': True})
        title_triage.decide(['Client Advisor', 'Boutique Manager'], SEARCH, client)
        self.assertEqual(len(client.calls), 2)
        self.assertNotIn('client advisor', client.calls[1], 'a title decided before is not asked again')
        self.assertIn('vendeur', client.calls[0], 'the search words are sent')
        other = title_triage.known({'role_keywords': ['engineer']})
        self.assertEqual(other, {}, 'another search decides afresh')

    def test_the_gate_passes_what_claude_kept_and_the_words_decide_only_what_it_did_not_judge(self):
        # owner, 26 Oct 2026 ("The AI decides"): the AI's answer wins over the role and excluded words; they decide a title it has not judged
        with mock.patch.object(feeds, 'TRIAGED', {'client advisor': True, 'head of growth': False, 'marketing intern': True}), \
                mock.patch.object(feeds, 'EXCLUDED_TITLES', feeds.keyword_regex([r'\bintern\b'])), mock.patch.object(feeds, 'TITLES', feeds.keyword_regex(['vendeur'])):
            self.assertEqual([feeds.wanted_title(t) for t in ('Client Advisor', 'Head of Growth', 'Marketing Intern', 'Vendeur 80%', 'Unknown title', 'Vendeur intern')],
                             [True, False, True, True, False, False])

    def test_says_how_many_batches_and_each_one_done(self):
        client = Client(['advisor'])
        with mock.patch.object(title_triage, 'BATCH', 2), mock.patch('builtins.print') as said:
            title_triage.decide([f'Advisor {n}' for n in range(5)], SEARCH, client)
        lines = [call.args[0] for call in said.call_args_list]
        self.assertIn('in 3 batch(es) of up to 2', lines[0])
        # Two batches run at once, so the last (smaller) one can finish first: 0, 2, 3 or 4, 5 of 5 (7 Oct 2026: this failed CI on a JS-only push)
        done = [int(line.split(':')[1].split('·')[0].split(' of ')[0]) for line in lines if line.startswith('⏳')]
        self.assertEqual((len(done), done[0], done[-1]), (4, 0, 5))
        self.assertEqual(done, sorted(done))
        self.assertIn(done[2], (3, 4))
        self.assertEqual(len(client.calls), 3)

    def test_a_timed_search_asks_whole_rounds_of_calls(self):
        """18 Oct 2026, persona runs: paced per title (0.5 s at least), a refresh planned "28 of 600 titles" for its 3 minutes, sorted them
        in one 7 s call and left 572 waiting; sorted without a clock, the same 600 gave a finance search 41 titles that could fit instead of 1."""
        from src import time_budget as budget
        from src.ai import engine
        client = Client(['analyst'])
        with tempfile.TemporaryDirectory() as tmp, mock.patch('src.paths.DATA', pathlib.Path(tmp)), mock.patch.object(engine, 'PARALLEL', 2), \
                mock.patch.object(title_triage, 'BATCH', 30), mock.patch('builtins.print'):
            budget.start(180)
            try:
                title_triage.decide([f'Analyst {n}' for n in range(600)], SEARCH, client)
            finally:
                budget.start(0)
        self.assertEqual(len(client.calls), 6, '20% of 180 s at 10 s a round: 3 rounds of 2 calls of 30 titles, not 20 titles at 1.8 s each')


if __name__ == '__main__':
    unittest.main()
