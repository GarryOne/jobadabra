"""Strategy's search rows as Focus Suggestions (src/suggestions_search.py; spec docs/superpowers/specs/2026-10-28-insights-with-actions-design.md,
PR 1b): each row's top option in one press and "See all N", Not now / Not true kept against the row's top option (role ideas: the search's
role words), Strategy and Focus reading the same keys, the demo drawn from the engine's own words, and no AI call."""
import copy
import json
import pathlib
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from src import suggestions, suggestions_search as search

NOW = datetime(2026, 10, 28, 9, 0, tzinfo=timezone.utc)
DEMO = pathlib.Path(__file__).resolve().parent.parent / 'desktop' / 'demo'
VERDICT = {
    'narrow': True, 'local': False, 'tight': True, 'share': 0.01, 'matched': 2, 'in_places': 6477, 'at': '2026-10-28T07:00:00+00:00',
    'suggestions': [{'term': 'platform engineer', 'count': 40, 'examples': ['Platform Engineer, Zurich']}, {'term': 'sre', 'count': 12, 'examples': []}],
    'places': {'title_hits': 9, 'matched': 2, 'elsewhere': 0, 'options': [
        {'place': 'Zurich', 'count': 5, 'examples': ['SRE, Zurich'], 'fragment': 'zurich'},
        {'place': 'France', 'count': 3, 'examples': ['DevOps, Annemasse'], 'fragment': 'france'},
        {'place': 'Basel', 'count': 2, 'examples': [], 'fragment': 'basel'}]},
    'excluded': [{'fragment': '\\blead\\b', 'count': 4, 'examples': ['Lead SRE']}],
    'languages': [{'language': 'german', 'count': 9, 'examples': ['DevOps Engineer']}],
    'visits': [{'name': 'Helvetia Studios', 'url': 'https://jobs.helvetia.example/list', 'kind': 'employer', 'why': 'refuses automated visitors'},
               {'name': 'Helvetia Studios', 'url': 'https://careers.helvetia.example', 'kind': 'employer', 'why': 'refuses automated visitors'},
               {'name': 'Manor', 'url': 'https://jobs.manor.example', 'kind': 'portal', 'why': 'no way in but your own visit'}],
    'sources': [{'id': 'brave', 'name': 'Web search (Brave)', 'effort': 'A free key', 'gain': 'more employers'}],
    'for_you': [{'company': 'Studio Geneva', 'interview': 1, 'applied': 3, 'why': 'kind of work'}]}
IDEAS = [{'role': 'Cashier', 'word': 'caissier', 'why': 'Retail sales', 'count': 6}, {'role': 'Retoucher', 'word': 'retouche', 'why': 'Photoshop', 'count': 0}]


def by_kind(verdict=VERDICT, ideas=IDEAS):
    return {entry['kind']: entry for entry in search.entries(verdict, ideas, 'ideas:abc')}


def answer(state, key, until=''):
    return {'id': 'a', 'day': NOW.date().isoformat(), 'category': suggestions.ANSWER_CATEGORY, 'title': 'x', 'body': '', 'link': '',
            'created_at': NOW.isoformat(), 'fields': {'state': state, 'input_hash': key, **({'hidden_until': until} if until else {})}}


class RowsTests(unittest.TestCase):
    def test_each_row_offers_its_top_option_in_one_press_and_see_all(self):
        found = by_kind()
        self.assertEqual(list(found), list(search.KINDS), "Strategy's order; employers and sources stay on Strategy")
        self.assertEqual(found['places']['title'], 'Add Zurich to your places')
        self.assertEqual(found['places']['detail'], '5 matching roles outside your places · and 2 more places')
        self.assertEqual(found['places']['actions'], [{'label': 'Add Zurich', 'do': 'change_search', 'kind': 'place', 'value': 'Zurich'},
                                                      {'label': 'See all 3', 'do': 'see_all', 'row': 'places'}])
        self.assertEqual(found['coverage']['actions'][0], {'label': 'Add role word', 'do': 'change_search', 'kind': 'role', 'value': 'platform engineer'})
        self.assertEqual(found['coverage']['title'], 'Add "platform engineer" to your role words')
        self.assertEqual(found['filters']['title'], '2 of your filters hide 13 matching jobs')
        self.assertEqual(found['filters']['detail'], 'Titles with "lead" · jobs requiring German')
        self.assertEqual(found['filters']['actions'], [{'label': 'Remove "lead"', 'do': 'change_search', 'kind': 'exclude', 'value': '\\blead\\b'},
                                                       {'label': 'See both', 'do': 'see_all', 'row': 'filters'}])
        self.assertEqual(found['visits']['title'], '2 sites only you can open', 'one per company, as Strategy lists them')
        self.assertEqual(found['visits']['actions'][0], {'label': 'Read Helvetia Studios', 'do': 'change_search', 'kind': 'visit',
                                                         'value': 'https://jobs.helvetia.example/list'})
        self.assertEqual(found['ideas']['actions'][0], {'label': 'Add role', 'do': 'change_search', 'kind': 'role', 'value': 'caissier'})
        self.assertEqual(found['ideas']['aside'], ['caissier', 'retouche'], 'a Not true sets them aside for the AI')
        for entry in found.values():
            self.assertEqual((entry['home'], entry['topic'], entry['source']), ('strategy', 'search', 'Search strategy'), entry['kind'])

    def test_a_language_filter_first_says_allow_and_one_option_has_no_see_all(self):
        verdict = {**VERDICT, 'excluded': [], 'places': {**VERDICT['places'], 'options': VERDICT['places']['options'][:1]}}
        found = by_kind(verdict)
        self.assertEqual(found['filters']['title'], 'One of your filters hides 9 matching jobs')
        self.assertEqual([a['label'] for a in found['filters']['actions']], ['Allow jobs requiring German'])
        self.assertEqual([a['label'] for a in found['places']['actions']], ['Add Zurich'])

    def test_a_site_with_a_caution_note_is_never_read_in_one_press(self):
        noted = {'name': 'LinkedIn', 'url': 'https://www.linkedin.example/jobs', 'kind': 'portal', 'why': 'no way in but your own visit',
                 'note': 'may restrict accounts that do'}
        verdict = {**VERDICT, 'visits': [noted, *VERDICT['visits']]}
        self.assertEqual(by_kind(verdict)['visits']['actions'][0]['label'], 'Read Helvetia Studios')
        self.assertEqual(search.keys(verdict)['visits'], by_kind(verdict)['visits']['key'])
        self.assertNotIn('visits', by_kind({**VERDICT, 'visits': [noted]}), 'its note is read on Strategy first')

    def test_nothing_to_offer_is_no_entry(self):
        self.assertEqual(search.entries(None), [])
        quiet = {**VERDICT, 'narrow': False, 'places': None, 'excluded': [], 'languages': [], 'visits': []}
        self.assertEqual(search.entries(quiet, [{**IDEAS[1]}], 'ideas:abc'), [], 'not narrow; ideas with no openings bring nothing in one press')


class KeysTests(unittest.TestCase):
    def test_the_key_is_the_top_option_so_new_counts_keep_an_answer(self):
        keys = search.keys(VERDICT)
        self.assertEqual(keys, {'places': 'places:zurich', 'coverage': 'coverage:platform engineer', 'filters': 'filters:\\blead\\b',
                                'visits': 'visits:https://jobs.helvetia.example/list', 'foryou': 'foryou:studio geneva'},
                         'every Strategy row the check fills; sources only while key sources are offered')
        recount = copy.deepcopy(VERDICT)
        recount['places']['options'][0]['count'] = 50
        self.assertEqual(search.keys(recount), keys)
        moved = copy.deepcopy(VERDICT)
        moved['places']['options'].reverse()
        self.assertEqual(search.keys(moved)['places'], 'places:basel', 'a new top option is new evidence')
        for entry in search.entries(VERDICT):
            self.assertEqual(entry['key'], keys[entry['kind']], 'Focus and Strategy keep an answer against the same key')

    def test_an_answer_on_focus_hides_the_row_on_strategy_too(self):
        until = suggestions.hidden_until(NOW)
        answers = [answer('Not now', 'places:zurich', until), answer('Not true', 'ideas:abc')]
        pool = suggestions.pool(insights=answers, tune=None, events=[], now=NOW, doors=set(), search=search.entries(VERDICT, IDEAS, 'ideas:abc'))
        self.assertEqual([entry['kind'] for entry in pool], ['coverage', 'filters', 'visits'])
        self.assertEqual(suggestions.hidden(answers, NOW), {'places:zurich', 'ideas:abc'}, "what Strategy's rows read")
        self.assertEqual(suggestions.hidden(answers, NOW + timedelta(days=15)), {'ideas:abc'}, 'Not now ends after 14 days')


class FocusTests(unittest.TestCase):
    def test_focus_reads_the_last_check_and_kept_ideas_without_an_ai_call(self):
        with mock.patch('src.ai.engine.client', side_effect=AssertionError('no AI call in Suggestions')), \
                mock.patch('src.paths.load_search_config', return_value={'role_keywords': ['sre'], 'locations': {}}), \
                mock.patch('src.coverage.load', return_value={'missed_titles': []}), \
                mock.patch.object(search, 'checked', return_value=VERDICT), mock.patch.object(search, 'ideas_on', return_value=True), \
                mock.patch('src.ai.role_ideas.kept', return_value=IDEAS) as kept:
            found = search.now()
        self.assertEqual([entry['kind'] for entry in found], list(search.KINDS))
        self.assertTrue(found[1]['key'].startswith('ideas:') and kept.called)

    def test_focus_says_which_strategy_rows_are_answered(self):
        from src import focus
        answers = [answer('Not true', 'places:zurich'), answer('Not true', 'tune:x')]
        out = focus.build([], [], now=NOW, insights=answers, gmail=False, search=search.entries(VERDICT))
        self.assertNotIn('places', [entry['kind'] for entry in out['suggestions']])
        self.assertEqual(out['suggestions_hidden'], ['places:zurich'], "only Strategy's rows: the rest never grows Focus's answer")


    def test_a_role_set_aside_on_focus_stays_aside_after_a_new_role_word_on_every_mac(self):
        """Gitar on #2350: Not true on role ideas, then a role word added (a new key): the kept answer offered the role again. The answer row
        keeps the words in the store (its Data, desktop/lib/suggestion-answers.js), and Focus reads them from there, not from one Mac."""
        import json as _json
        import tempfile
        from src import focus
        from src.ai import role_ideas
        from src.sources import feeds  # noqa: F401 - read the search settings at import, before the patched ones below
        from src.stores import open_stores
        with tempfile.TemporaryDirectory() as tmp:
            stores = open_stores({'JOB_PILOTTO_STORE': 'sqlite', 'JOB_PILOTTO_DATA_DIR': tmp})
            stores.insights.add({'day': NOW.date().isoformat(), 'category': suggestions.ANSWER_CATEGORY, 'title': 'Add Cashier to your roles',
                                 'fields': {'state': 'Not true', 'hidden_until': '', 'data': _json.dumps({'aside': ['caissier', 'retouche']}), 'input_hash': 'ideas:old'}})
            kept = pathlib.Path(tmp) / 'role_ideas.json'
            ideas = [{'role': 'Cashier', 'word': 'caissier', 'why': 'Retail'}, {'role': 'Seller', 'word': 'vendeur', 'why': 'Shop'}]
            kept.write_text(_json.dumps({'old': {'day': '2026-10-27', 'roles': ['sre'], 'ideas': ideas, 'counted': {'counts': {'caissier': 6, 'vendeur': 3}}}}))
            with mock.patch.object(role_ideas, 'STORE', kept), mock.patch.object(search, 'ideas_on', return_value=True), \
                    mock.patch.object(search, 'checked', return_value={}), mock.patch('src.coverage.load', return_value={'missed_titles': []}), \
                    mock.patch('src.paths.load_search_config', return_value={'role_keywords': ['sre', 'devops'], 'locations': {}}):
                found = focus.load(stores, target=5, now=NOW, gmail=False)['suggestions']
        entry, = [e for e in found if e['kind'] == 'ideas']
        self.assertEqual(entry['aside'], ['vendeur'], 'Cashier was set aside before the new role word')


class DemoTests(unittest.TestCase):
    def test_the_demo_is_drawn_from_the_engines_own_words(self):
        """The demo's Strategy keys and Focus rows are what this engine makes of the demo's check, so a screenshot shows real wording."""
        verdict = json.loads((DEMO / 'coverage.json').read_text())
        ideas = json.loads((DEMO / 'role-ideas.json').read_text())
        self.assertEqual(verdict['keys'], search.keys(verdict))
        demo = [entry for entry in json.loads((DEMO / 'focus.json').read_text())['suggestions'] if entry['kind'] in search.KINDS]
        self.assertEqual(demo, search.entries(verdict, ideas['ideas'], ideas['key']))
        self.assertGreaterEqual(len(demo), 4)


if __name__ == '__main__':
    unittest.main()
