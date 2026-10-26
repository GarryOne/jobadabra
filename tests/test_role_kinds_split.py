"""The kinds of role split out of 'other' (owner, 26 Oct 2026: "where is the plane pilot jobs fitting here?"): every copy of the list in step,
a title nobody judged never counted as 'other', and a search whose kind the AI is unsure of reads no employer list (a pilot search was put
under finance_admin and read 1,025 office employers for 0 matches).
Measured first: https://claude.ai/artifact/Vv1PUQgHeBs5Lxkjmg4tT6 (an employer's 'other' share matched its never-judged titles at 0.9)."""
import json
import re
import sqlite3
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src import contribute, employer_index, role_kinds, scout_hiring_cells  # noqa: E402
from src.ai import board_ideas, decide, enrich  # noqa: E402

NEW = ('engineering', 'business_ops', 'manufacturing', 'science', 'customer_service', 'legal', 'aviation_transport', 'public_security')


def js_list(path, name):
    found = re.search(rf'export const {name} = \[([^\]]+)\]', (ROOT / path).read_text(encoding='utf-8'))
    return [m for m in re.findall(r"'(\w+)'", found.group(1))]


def js_keys(path, name):
    found = re.search(rf'export const {name} = \{{(.+?)\}};', (ROOT / path).read_text(encoding='utf-8'), re.S)
    return re.findall(r'(\w+):', found.group(1))


class CopiesTests(unittest.TestCase):
    def test_the_split_fields_are_kinds(self):
        self.assertTrue(set(NEW) <= set(role_kinds.KINDS))
        self.assertEqual(role_kinds.KINDS[-1], 'other')
        self.assertEqual(set(role_kinds.WORK), set(role_kinds.KINDS))
        self.assertIn('pilot', role_kinds.WORK['aviation_transport'])
        self.assertIn('banking', role_kinds.WORK['finance_admin'])

    def test_every_copy_of_the_kinds_is_the_one_list(self):
        """One loop over every place the kinds live: a kind added to role_kinds.KINDS and missed anywhere fails here."""
        kinds, trades = list(role_kinds.KINDS), set(role_kinds.KINDS) - {'software', 'other'}
        schema = json.loads((ROOT / 'config' / 'meanings_schema.json').read_text(encoding='utf-8'))
        notion = json.loads((ROOT / 'config' / 'notion_schema.json').read_text(encoding='utf-8'))
        role_family = next(iter(re.findall(r'"Role family": \{\s*"type": "select",\s*"options": (\[.*?\])', json.dumps(notion, indent=2), re.S)))
        copies = {
            'src/ai/board_ideas.py KINDS': (list(board_ideas.KINDS[:-1]), kinds),
            'src/ai/board_ideas.py SYSTEM words': (re.search(r'kinds: from (.+?), any\.', board_ideas.SYSTEM, re.S).group(1).replace('\\', '').split(', '), kinds),
            'src/contribute.py TRADE_ROLES': (set(contribute.TRADE_ROLES), trades),
            'src/ai/enrich.py role_family (the kinds)': (set(enrich.SCHEMA['properties']['role_family']['enum']) >= set(kinds), True),
            'config/notion_schema.json Role family': ({o['name'] for o in json.loads(role_family)} >= set(kinds), True),
            'config/meanings_schema.json job-title-kind': (schema['job-title-kind']['answers'], kinds),
            'config/meanings_schema.json role-kind': (schema['role-kind']['answers'], [*kinds, role_kinds.UNSURE]),
            'src/scout_hiring_cells.py FAMILIES keys': (set(scout_hiring_cells.FAMILIES) <= trades, True),
            'desktop/lib/search-report.js FAMILIES': (js_list('desktop/lib/search-report.js', 'FAMILIES'), kinds),
            'desktop/renderer/strategy-parts.js KIND_LABELS': (js_keys('desktop/renderer/strategy-parts.js', 'KIND_LABELS'), kinds),
        }
        for where, (got, want) in copies.items():
            with self.subTest(where):
                self.assertEqual(got, want)


    def test_the_job_facts_ai_is_told_what_each_family_means(self):
        """The role family names each kind's work, so a new kind is chosen for what it means (e2e golden 3006: a helpdesk job is customer_service)."""
        family = enrich.SCHEMA['properties']['role_family']
        self.assertIn("not the team, product or customers it serves", family['description'])
        for kind in set(role_kinds.KINDS) - {'software'}:
            self.assertIn(f'{kind} = {role_kinds.WORK[kind]}', family['description'])


class JudgedTests(unittest.TestCase):
    def test_a_title_nobody_judged_is_left_out_of_the_mix(self):
        """26 Oct 2026: past the scout's 60 AI calls a run, every other title counted as 'other'; Other held 42% of the index."""
        with mock.patch.object(decide, 'decide', lambda topic, items, *a, **k: {key: 'software' for key, text in items.items() if 'engineer' in key}):
            self.assertEqual(role_kinds.mix(['Backend Engineer'] * 12 + [f'Unjudged title {n}' for n in range(8)]), {'software': 1.0})
            self.assertIsNone(role_kinds.mix(['Backend Engineer'] * 6 + [f'Unjudged title {n}' for n in range(14)]), 'under half judged: no mix yet')
            self.assertIsNone(role_kinds.mix([f'Unjudged title {n}' for n in range(20)]), 'nothing judged: no mix ("Not counted yet")')
            self.assertEqual(role_kinds.mix(['Backend Engineer', 'Staff engineer']), {'software': 1.0}, 'a small feed, all judged, is known')
            self.assertIsNone(role_kinds.mix(['Backend Engineer', 'Unjudged title']), 'a small feed needs all its titles judged')
        with mock.patch.object(decide, 'decide', lambda topic, items, *a, **k: {key: 'other' for key in items}):
            self.assertEqual(role_kinds.mix([f'Title {n}' for n in range(10)]), {'other': 1.0}, 'judged other is other')

    def test_titles_past_the_cap_wait_and_the_next_run_judges_them(self):
        """The scout's AI calls a run are capped: titles past the cap are not counted (never 'other'), and the next run asks only those."""
        import tempfile
        from types import SimpleNamespace
        from src.ai import cost, engine, meanings_pack
        asked = []

        class Client:
            class messages:   # noqa: N801 — the SDK's shape
                @staticmethod
                def create(**kwargs):
                    items = re.findall(r'### Item (\d+)\n', kwargs['messages'][0]['content'])
                    asked.append(len(items))
                    text = json.dumps({'results': [{'index': int(i), 'answer': 'engineering'} for i in items]})
                    return SimpleNamespace(content=[SimpleNamespace(type='text', text=text)], stop_reason='end_turn', usage=None)
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / 'jobs.sqlite'
        titles = [f'Process engineer {n}' for n in range(decide.BATCH + 10)]
        with mock.patch.object(decide, '_db', lambda: sqlite3.connect(path)), mock.patch.object(decide, 'MAX_CALLS_PER_RUN', 1), \
                mock.patch.object(engine, 'ready', lambda: True), mock.patch.object(engine, 'client', lambda **k: Client()), \
                mock.patch.object(cost, 'side', lambda *a: None), mock.patch.object(meanings_pack, 'queue', lambda *a: None), \
                mock.patch.object(meanings_pack, 'first', lambda *a, **k: None):
            decide._calls['n'] = 0
            first = role_kinds.judged(titles, 'job-title-kind')
            decide._calls['n'] = 0   # the next run
            second = role_kinds.judged(titles, 'job-title-kind')
        decide._calls['n'] = 0
        self.assertEqual((len(first), len(second)), (decide.BATCH, len(titles)), 'run 1: one batch; run 2: the rest')
        self.assertEqual(asked, [decide.BATCH, 10], 'run 2 asks only the titles run 1 did not reach')

    def test_kept_answers_from_before_the_list_grew_are_asked_again(self):
        db = sqlite3.connect(':memory:')
        decide._table(db)
        db.execute("INSERT INTO decisions VALUES ('role-kind', 'first officer', 'finance_admin', '2026-10-20T10:00:00+00:00')")
        db.execute("INSERT INTO decisions VALUES ('role-kind', 'nurse', 'healthcare', '2026-10-27T10:00:00+00:00')")
        self.assertEqual(decide.kept('role-kind', ['first officer', 'nurse'], db, since=role_kinds.SINCE), {'nurse': 'healthcare'})
        self.assertEqual(decide.kept('role-kind', ['first officer'], db), {'first officer': 'finance_admin'}, 'without since: as before')


class UnsureTests(unittest.TestCase):
    def test_a_search_word_may_be_unsure_and_a_title_may_not(self):
        asked = {}

        def fake(topic, items, answers, instructions, *a, **k):
            asked[topic] = (answers, k.get('since'))
            return {}
        with mock.patch.object(decide, 'decide', fake):
            role_kinds.kinds_of(['First Officer'])
            role_kinds.mix([f'Title {n}' for n in range(6)])
        self.assertEqual(asked['role-kind'], ((*role_kinds.KINDS, role_kinds.UNSURE), role_kinds.SINCE))
        self.assertEqual(asked['job-title-kind'], (role_kinds.KINDS, role_kinds.SINCE))

    def test_an_unsure_search_is_unknown_and_reads_no_employer_list(self):
        with mock.patch.object(decide, 'decide', lambda topic, items, *a, **k: {key: role_kinds.UNSURE for key in items}):
            wanted = role_kinds.of_search({'role_keywords': ['first officer', 'pilote de ligne']})
        self.assertEqual(wanted, {role_kinds.UNKNOWN})
        index = [{'company': 'Office firm', 'places': ['Zurich'], 'kinds': {'finance_admin': 0.9}},
                 {'company': 'No mix yet', 'places': ['Zurich']},
                 {'company': 'Mostly other', 'places': ['Zurich'], 'kinds': {'other': 0.9}},
                 {'company': 'Where I have a scored job', 'places': ['Zurich'], 'kinds': {'logistics': 1.0}}]
        zurich = lambda job: 'zurich' in job['location'].lower()
        kept = [f['company'] for f in employer_index.relevant(index, zurich, wanted, keep={'Where I have a scored job'})]
        self.assertEqual(kept, ['Where I have a scored job'], 'no bulk read: the web search and learned sources lead')

    def test_an_employer_known_to_hire_none_of_the_kind_is_not_read(self):
        """Owner, 26 Oct 2026: "it shouldn't check 1200 employers if we know about them they don't have jobs for aviation"."""
        wanted = {'aviation_transport'}
        index = [{'company': 'Airline', 'places': ['Zurich'], 'kinds': {'aviation_transport': 0.4, 'other': 0.6}, 'checked': '2026-10-27'},
                 {'company': 'Judged other', 'places': ['Zurich'], 'kinds': {'other': 0.9, 'legal': 0.1}, 'checked': '2026-10-27'},
                 {'company': 'Old mix, other unjudged', 'places': ['Zurich'], 'kinds': {'other': 0.9, 'legal': 0.1}, 'checked': '2026-10-25'},
                 {'company': 'Office firm', 'places': ['Zurich'], 'kinds': {'finance_admin': 1.0}, 'checked': '2026-10-27'},
                 {'company': 'Not counted yet', 'places': ['Zurich']}]
        zurich = lambda job: 'zurich' in job['location'].lower()
        self.assertEqual([f['company'] for f in employer_index.relevant(index, zurich, wanted)], ['Airline', 'Old mix, other unjudged', 'Not counted yet'])

    def test_some_words_placed_keep_their_kinds(self):
        answers = {'first officer': role_kinds.UNSURE, 'flight dispatcher': 'aviation_transport'}
        with mock.patch.object(decide, 'decide', lambda topic, items, *a, **k: {key: answers[key] for key in items}):
            self.assertEqual(role_kinds.of_search({'role_keywords': ['first officer', 'flight dispatcher']}), {'aviation_transport'})

    def test_without_ai_a_search_stays_not_known_and_nothing_is_skipped(self):
        with mock.patch.object(decide, 'decide', lambda *a, **k: None):
            self.assertIsNone(role_kinds.of_search({'role_keywords': ['first officer']}))

    def test_the_unknown_kind_is_never_shared_as_a_role_tag(self):
        with mock.patch.object(role_kinds, 'of_search', lambda search: {role_kinds.UNKNOWN}), \
                mock.patch('src.ai.meanings.labels', lambda *a, **k: []):
            roles, _ = contribute.tags({'role_keywords': ['first officer'], 'locations': {'top_tier': []}})
        self.assertNotIn(role_kinds.UNKNOWN, roles)


if __name__ == '__main__':
    unittest.main()
