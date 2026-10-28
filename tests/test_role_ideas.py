"""Roles suggested from the Profile (owner, 7 Oct 2026): asked of Claude at most once a day, counted in the places' titles, set-aside roles never back."""
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from src.ai import role_ideas

SEARCH = {'role_keywords': ['vendeur', 'photographe'], 'locations': {'top_tier': ['gen[eè]ve']}}
ANSWER = {'ideas': [{'role': 'Cashier', 'word': 'caissier', 'why': 'shop'}, {'role': 'Seller', 'word': 'vendeur', 'why': 'already searched'},
                    {'role': 'Retoucher', 'word': 'retouche', 'why': 'Photoshop'}]}


class Client:
    def __init__(self):
        self.calls, self.counted = [], []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        content = kwargs['messages'][0]['content']
        if content.startswith('Roles:'):   # the counting question: a title fits a role when it has the role word's stem ("caiss")
            self.counted.append(content)
            roles = [line.split('title word: ')[1].rstrip(')') for line in content.split('\n\n')[0].split('\n')[1:]]
            titles = content.split('Job titles:\n', 1)[1].split('\n')
            answer = {'roles': [{'n': n, 'titles': [m for m, title in enumerate(titles, 1) if word[:5] in title.lower()]} for n, word in enumerate(roles, 1)]}
        else:
            self.calls.append(json.loads(content.split('\n', 1)[1]))
            answer = ANSWER
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class RoleIdeasTest(unittest.TestCase):
    def setUp(self):
        self.store = mock.patch.object(role_ideas, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 'r.json')
        self.store.start()

    def tearDown(self):
        self.store.stop()

    def test_ideas_are_counted_once_a_day_and_never_a_searched_or_set_aside_role(self):
        client = Client()
        titles = ['caissier 50%', 'caissière auxiliaire', 'retouche photo e-commerce', 'vendeur fnac']
        got = role_ideas.ideas('Photographer and shop seller', SEARCH, titles, client=client, today='2026-10-07')
        self.assertEqual([(i['word'], i['count']) for i in got], [('caissier', 2), ('retouche', 1)],
                         'counted by Claude: "caissière" is a cashier job too (7 Oct 2026: the exact word counted 0); sorted by count')
        again = role_ideas.ideas('Photographer and shop seller', SEARCH, titles, set_aside=['retouche'], client=client, today='2026-10-07')
        self.assertEqual([i['word'] for i in again], ['caissier'], 'set aside: not shown')
        self.assertEqual(len(client.calls), 1, 'asked once a day')
        role_ideas.ideas('x', SEARCH, titles, set_aside=['retouche'], client=client, today='2026-10-08')
        self.assertEqual(client.calls[1]['set_aside'], ['retouche'], 'the set-aside roles are told to Claude the next day')
        self.assertNotIn('cv', ' '.join(client.calls[0]).lower().replace('profile', ''), 'only the named fields are sent')

    def test_kept_ideas_are_read_without_asking_claude(self):
        """Focus's Suggestions read the day's answer as it was kept (insights PR 1b): no AI call, counted as Strategy counts them, a role
        already searched left out; nothing before the first answer."""
        titles = ['caissier 50%', 'caissière auxiliaire', 'retouche photo e-commerce', 'vendeur fnac']
        self.assertEqual(role_ideas.kept(SEARCH, titles), [])
        role_ideas.ideas('Photographer and shop seller', SEARCH, titles, client=Client(), today='2026-10-07')
        with mock.patch.object(role_ideas, 'ai_counts', side_effect=AssertionError('no AI call')):
            got = role_ideas.kept(SEARCH, titles)
            grown = role_ideas.kept({**SEARCH, 'role_keywords': SEARCH['role_keywords'] + ['caissier']}, titles)
        self.assertEqual([(i['word'], i['count']) for i in got], [('caissier', 2), ('retouche', 1)])
        self.assertEqual([i['word'] for i in grown], ['retouche'], 'an idea added as a role is not offered again; the others stay')
        self.assertNotEqual(role_ideas.search_key(SEARCH), role_ideas.search_key({**SEARCH, 'role_keywords': ['x']}))

    def test_adding_a_suggested_role_keeps_todays_ideas_without_asking_again(self):
        client = Client()
        titles = ['caissier 50%', 'retouche photo']
        role_ideas.ideas('Photographer and shop seller', SEARCH, titles, client=client, today='2026-10-07')
        grown = {**SEARCH, 'role_keywords': SEARCH['role_keywords'] + ['caissier']}
        got = role_ideas.ideas('Photographer and shop seller', grown, titles, client=client, today='2026-10-07')
        self.assertEqual([i['word'] for i in got], ['retouche'], 'the added role leaves the list; the others stay')
        self.assertEqual(len(client.calls), 1, 'no second call for a role added from the list')
        other = {**SEARCH, 'role_keywords': ['comptable']}
        role_ideas.ideas('Accountant', other, titles, client=client, today='2026-10-07')
        self.assertEqual(len(client.calls), 2, 'a different search (roles removed or replaced) is asked anew')

    def test_no_profile_no_call(self):
        self.assertEqual(role_ideas.ideas('', SEARCH, [], client=Client(), today='2026-10-09'), [])


    def test_counted_by_claude_once_for_the_same_titles_and_by_word_without_it(self):
        client = Client()
        titles = ['Vendeuse Caisses 50%', 'Caissière auxiliaire', 'Gérant de magasin']
        got = role_ideas.ideas('Shop seller', SEARCH, titles, client=client, today='2026-10-07')
        self.assertEqual(dict((i['word'], i['count']) for i in got)['caissier'], 2, '"caissier" is in neither title, Claude counts both')
        role_ideas.ideas('Shop seller', SEARCH, titles, client=client, today='2026-10-07')
        self.assertEqual(len(client.counted), 1, 'the same titles: counted once')
        role_ideas.ideas('Shop seller', SEARCH, titles + ['Caissier 100%'], client=client, today='2026-10-07')
        self.assertEqual(len(client.counted), 2, 'new titles: counted again')
        with mock.patch.object(role_ideas, 'ai_counts', side_effect=RuntimeError('no AI')):
            got = role_ideas.ideas('Shop seller', SEARCH, titles + ['Caissier 100%', 'caissier'], client=client, today='2026-10-07')
        self.assertEqual(dict((i['word'], i['count']) for i in got)['caissier'], 2, 'without Claude: the title word, as before')


if __name__ == '__main__':
    unittest.main()
