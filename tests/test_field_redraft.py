"""A change of field redrafts every list the strategy derived from the old roles (src/field_redraft.py). No network: the AI answer and the kinds are fed."""
import json
import unittest
from pathlib import Path
from unittest import mock

from src import field_redraft

DEVELOPER = {'role_keywords': ['developer', 'software engineer'], 'board_discovery_keywords': ['software', 'developer'],
             'quality_stack_keywords': ['python', 'react'], 'google_jobs': {'queries': ['software developer iasi'], 'country': 'ro'}}
PILOT = {**DEVELOPER, 'role_keywords': ['first officer', 'pilot']}
ANSWER = {'board_words': ['pilot', 'first officer'], 'stack_words': ['ATPL', 'A320 type rating'], 'queries': ['first officer', 'airline pilot']}
KINDS = {'developer': 'software', 'software engineer': 'software', 'first officer': 'other', 'pilot': 'other', 'chef': 'hospitality'}


def run(search, stamp, answer=ANSWER):
    saved = []
    with mock.patch.object(field_redraft.role_kinds, 'kinds_of', lambda words, **k: {w: KINDS.get(w, 'other') for w in words}):
        out = field_redraft.apply(search, stamp=stamp, asker=lambda *a: answer, save=saved.append)
    return out, saved


class FieldRedraftTest(unittest.TestCase):
    def test_a_role_in_another_field_redrafts_every_derived_list(self):
        stamp = {'kinds': ['software'], 'roles': ['developer', 'software engineer']}
        (new, changed), saved = run(PILOT, stamp)
        self.assertTrue(changed)
        self.assertEqual(saved[0]['roles'], ['first officer', 'pilot'])
        for path in field_redraft.DERIVED:   # a new derived list is covered by this loop, or the test fails
            old_words = DEVELOPER[path[0]] if len(path) == 1 else DEVELOPER[path[0]][path[1]]
            words = new[path[0]] if len(path) == 1 else new[path[0]][path[1]]
            self.assertTrue(words, path)
            self.assertFalse({w.lower() for w in words} & {w.lower() for w in old_words}, path)
        self.assertEqual(new['google_jobs']['country'], 'ro')   # what is not derived from the role stays

    def test_every_derived_list_is_one_the_example_strategy_has(self):
        example = json.loads(Path('config/search.example.json').read_text())
        for path in field_redraft.DERIVED:
            self.assertIn(path[0], example)

    def test_a_neighbouring_role_or_the_first_stamp_changes_nothing(self):
        stamp = {'kinds': ['software'], 'roles': ['developer', 'software engineer']}
        self.assertTrue(run({**DEVELOPER, 'role_keywords': ['developer', 'chef']}, stamp)[0][1])   # a new KIND is a move; the same kind with a role added is not:
        (new, changed), _ = run({**DEVELOPER, 'role_keywords': ['developer', 'software engineer']}, stamp)
        self.assertFalse(changed)
        self.assertEqual(new['board_discovery_keywords'], DEVELOPER['board_discovery_keywords'])
        self.assertFalse(run(PILOT, None)[0][1])   # no stamp: drafted for these roles

    def test_a_failed_or_empty_answer_keeps_the_lists_and_the_old_stamp(self):
        stamp = {'kinds': ['software'], 'roles': ['developer', 'software engineer']}
        for answer in ({}, {'board_words': 'x'}):
            (new, changed), saved = run(PILOT, stamp, answer)
            self.assertFalse(changed)
            self.assertEqual(saved, [])

    def test_words_are_validated(self):
        self.assertEqual(field_redraft._words(['A B', 'a b', 'x', 5, 'c++'])[:2], ['a b', 'c\\+\\+'])


if __name__ == '__main__':
    unittest.main()


class EveryRunTest(unittest.TestCase):
    """Whatever changed the roles, the next jobs check redrafts (src/__main__.py runs field_redraft.refresh_quietly before every check)."""
    OLD = {'target_roles': [{'title': 'developer'}, {'title': 'software engineer'}], 'board_discovery_keywords': ['software', 'developer'],
           'quality_stack_keywords': ['python', 'react'], 'google_jobs': {'queries': ['software developer iasi'], 'country': 'ro'},
           'locations': {'top_tier': [], 'country_wide': ['europe'], 'abroad': []}}

    def ways(self):
        from src.notion import search_settings
        roles = [{'title': 'first officer'}, {'title': 'pilot'}]
        return {
            'the Strategy page or Telegram (the settings written with new roles)': lambda files: search_settings.apply({('search', ('target_roles',)): ['first officer', 'pilot']}, files),
            'the Notion page (parsed values)': lambda files: search_settings.apply(search_settings.parse('## Target roles\n- first officer\n- pilot\n'), files),
            'setup or an import (the file written directly)': lambda files: (search_settings.CONFIG / 'search.json').write_text(json.dumps({**files['search'], 'target_roles': roles})),
        }

    def test_every_way_the_roles_change_gives_the_new_field_one_run_later(self):
        import tempfile
        from pathlib import Path
        from src.notion import search_settings
        for name, change in self.ways().items():
            with self.subTest(name), tempfile.TemporaryDirectory() as folder, mock.patch.object(search_settings, 'CONFIG', Path(folder)), \
                    mock.patch.object(field_redraft, 'STAMP', Path(folder) / 'stamp.json'), mock.patch.object(field_redraft, 'DATA', Path(folder)), \
                    mock.patch.object(field_redraft.role_kinds, 'kinds_of', lambda words, **k: {w: KINDS.get(w, 'other') for w in words}):
                (Path(folder) / 'search.json').write_text(json.dumps(self.OLD))
                self.assertFalse(field_redraft.refresh(asker=lambda *a: ANSWER, profile='', publish=lambda files: None))   # the first run stamps developer
                change(search_settings.load_cached())
                published = []
                self.assertTrue(field_redraft.refresh(asker=lambda *a: ANSWER, profile='', publish=published.append))
                search = search_settings.load_cached()['search']
                for path in field_redraft.DERIVED:
                    words = search[path[0]] if len(path) == 1 else search[path[0]][path[1]]
                    old = self.OLD[path[0]] if len(path) == 1 else self.OLD[path[0]][path[1]]
                    self.assertTrue(words and not {w.lower() for w in words} & {w.lower() for w in old}, path)
                self.assertEqual(search['google_jobs']['country'], 'ro')
                self.assertEqual(len(published), 1)
                self.assertFalse(field_redraft.refresh(asker=lambda *a: 1 / 0, profile='', publish=published.append))   # stamped: not asked again

    def test_every_jobs_check_runs_it_before_the_search(self):
        text = (Path(__file__).resolve().parent.parent / 'src' / '__main__.py').read_text()
        self.assertLess(text.index('search_settings.sync_quietly()'), text.index('field_redraft.refresh_quietly()'))
        self.assertLess(text.index('field_redraft.refresh_quietly()'), text.index('return importlib.import_module(commands[name]).main() or 0\n        except LockTimeout'))
