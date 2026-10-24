import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.notion import search_settings as s

FILES = {
    'search': {'role_keywords': ['site reliability', r'\bsre\b', 'platform engineer'],
               'title_exclude_keywords': [r'\bjunior\b', 'intern(ship)?', r'\bhr\b business partner'],
               'quality_stack_keywords': ['kubernetes', r'slo\b'],
               'locations': {'top_tier': ['z[uü]rich', r'\bzug\b'], 'country_wide': ['switzerland', r'st\.? ?gallen'], 'abroad': []},
               'remote_excluded_regions': [r'\busa?\b', 'canada'],
               'jobs_board_search_queries': ['site reliability engineer'], 'board_discovery_keywords': ['devops'],
               'google_jobs': {'queries': ['sre'], 'country': 'ch', 'searches_per_run': 1,
                               'locations': [{'location': 'Zurich,Zurich,Switzerland', 'language': 'de'}]}},
    'preferences': {'excluded_companies': ['Acme Corp'], 'disqualifying_languages': ['French', 'German'], 'digest_min_score': 50},
}


# The roles and the searches as the one list (src/target_roles.py): the searches first, the other role words after, every old keyword still there.
WITH_ROLES = json.loads(json.dumps(FILES))
WITH_ROLES['search'].update({
    'target_roles': [{'title': 'site reliability engineer', 'also': []}, {'title': 'site reliability', 'also': []},
                     {'title': 'sre', 'also': [], 'fragment': r'\bsre\b'}, {'title': 'platform engineer', 'also': []}],
    'role_keywords': ['site reliability engineer', 'site reliability', r'\bsre\b', 'platform engineer'],
    'jobs_board_search_queries': ['site reliability engineer', 'site reliability', 'sre', 'platform engineer']})


def page(markdown):  # how Tracker.page_text returns a page: headings as "## …", bullets as "- …"
    return markdown


class SearchSettingsTests(unittest.TestCase):
    def test_the_page_shows_plain_words_quotes_for_whole_words_and_regex_only_when_needed(self):
        self.assertEqual([s.readable(f) for f in ('site reliability', r'\bsre\b', 'z[uü]rich', 'on-call', 'intern(ship)?', 'développeur')],
                         ['site reliability', '"sre"', 'zürich', 'on-call', '/intern(ship)?/', 'développeur'])

    def test_entries_match_like_the_fragments_did(self):
        find = lambda entry, text: bool(re.search(s.fragment(entry), text, re.I))
        self.assertTrue(find('entwickler', 'Softwareentwickler (m/w/d)'))  # anywhere, as before
        self.assertTrue(find('zürich', 'Zurich, Switzerland') and find('zürich', 'ZÜRICH'))
        self.assertTrue(find('"sre"', 'Senior SRE (m/f)'))
        self.assertFalse(find('"sre"', 'Srebrenica office'))  # quotes: whole word
        self.assertEqual(s.fragment('/intern(ship)?/'), 'intern(ship)?')

    def test_the_page_round_trips_every_setting_exactly(self):
        values = s.parse(s.render(json.loads(json.dumps(FILES))))
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(s, 'CONFIG', Path(tmp)):
            (Path(tmp) / 'search.json').write_text(json.dumps(FILES['search']))
            (Path(tmp) / 'preferences.json').write_text(json.dumps(FILES['preferences']))
            files = s.apply(values)
        self.assertEqual(files, WITH_ROLES)  # the page never changes what a search matches: the same keywords, now also the one list of titles

    def test_the_locations_kinds_and_the_search_only_override_survive_the_page(self):
        # Locations, one source (17 Oct 2026): relocation yes / no / unspecified and a search-only list are settings too, on every store.
        files = json.loads(json.dumps(FILES))
        files['search']['locations'].update({'relocation': ['no'], 'search_override': ['netherlands', r'\bgermany\b']})
        text = s.render(files)
        self.assertIn('## Relocation\n- no', text)
        self.assertIn('## Places to search instead\n- netherlands\n- "germany"', text)
        values = s.parse(text)
        self.assertEqual(values[('search', ('locations', 'relocation'))], ['no'])
        self.assertEqual(values[('search', ('locations', 'search_override'))], ['netherlands', r'\bgermany\b'])

    def test_the_sync_writes_no_note_of_the_example_files(self):
        # A "_" key is a note of the repo's example settings, never a setting (desktop/lib/config-text.js): a cache that kept one must not keep it (11 Oct 2026).
        values = s.parse(s.render(json.loads(json.dumps(FILES))))
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(s, 'CONFIG', Path(tmp)):
            for name in ('search', 'preferences'):
                (Path(tmp) / f'{name}.json').write_text(json.dumps({'_comment': 'Example settings, not anyone\'s real search', **FILES[name]}))
            files = s.apply(values)
            written = {name: json.loads((Path(tmp) / f'{name}.json').read_text()) for name in ('search', 'preferences')}
        self.assertEqual(files, WITH_ROLES)
        self.assertEqual(written, WITH_ROLES)

    def test_a_first_format_page_is_upgraded_without_changing_meaning_or_losing_edits(self):
        class Page:
            def __init__(self, text):
                self.text = text

            def page_text(self, page_id):
                return self.text
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(s, 'CONFIG', Path(tmp)):
            for name in ('search', 'preferences'):
                (Path(tmp) / f'{name}.json').write_text(json.dumps(FILES[name]))
            old = s.render(s.load_cached(), show=s.readable_v1, intro='What Jobadabra looks for.')
            # Untouched: rebuilt from the cache, so "site reliability" still matches anywhere.
            new = s.upgrade(Page(old), 'p')
            self.assertIn('- site reliability', new)
            self.assertIn('- sre', new)
            self.assertEqual(s.parse(new), s.parse(s.render(FILES)))
            # Edited (a company added): the edit is kept.
            new = s.upgrade(Page(old.replace('- Acme Corp', '- Acme Corp\n- Initech')), 'p')
            self.assertIn('- Initech', new)
            self.assertEqual(json.loads((Path(tmp) / 'preferences.json').read_text())['excluded_companies'], ['Acme Corp', 'Initech'])
            self.assertIsNone(s.upgrade(Page(new), 'p'))  # current format: nothing to do

    def test_a_missing_heading_keeps_the_cache_and_an_empty_one_means_none(self):
        values = s.parse('## Companies to skip\n## Target roles\n- sre\n## Something else\n- ignored')
        self.assertEqual(values, {('preferences', ('excluded_companies',)): [], ('search', ('target_roles',)): ['sre']})


if __name__ == '__main__':
    unittest.main()


class DoubledPageTests(unittest.TestCase):
    """1 Oct 2026: two writers published at once, the page showed every section twice, and every list in the config doubled."""

    def test_a_page_that_shows_a_section_twice_gives_each_entry_once(self):
        text = '## Target roles\n- sre\n- Platform Engineer\n## Companies to skip\n- Sonar\n## Target roles\n- sre\n- platform engineer\n## Companies to skip\n- Sonar\n- sonar\n'
        values = s.parse(text + s.FORMAT)
        self.assertEqual(values[('preferences', ('excluded_companies',))], ['Sonar'])
        self.assertEqual(len(values[('search', ('target_roles',))]), 2)

    def test_rendering_a_parsed_doubled_page_is_the_single_page(self):
        single = s.render(FILES, show=s.readable)
        doubled = single + '\n' + single
        again = {}
        for (name, path), value in s.parse(doubled).items():
            again.setdefault(name, {})[path] = value
        self.assertEqual(again['search'][('target_roles',)], s.parse(single)[('search', ('target_roles',))])

    def test_the_repos_example_config_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            fake_root = Path(directory)
            (fake_root / 'config').mkdir()
            with mock.patch.object(s, 'CONFIG', fake_root / 'config'), mock.patch('src.paths.ROOT', fake_root), \
                    mock.patch.dict('os.environ', {}, clear=False), mock.patch.object(s.sys, 'modules', {}):
                for name in ('JOB_PILOTTO_CONFIG_DIR', 'GITHUB_ACTIONS', 'JOB_PILOTTO_ALLOW_REPO_CONFIG'):
                    s.os.environ.pop(name, None)
                s.apply({('preferences', ('daily_applications_target',)): 20}, json.loads(json.dumps(FILES)))
                self.assertEqual(list((fake_root / 'config').iterdir()), [])   # nothing written
                s.os.environ['GITHUB_ACTIONS'] = 'true'
                s.apply({('preferences', ('daily_applications_target',)): 20}, json.loads(json.dumps(FILES)))   # a scheduled run does write
                self.assertEqual(json.loads((fake_root / 'config' / 'preferences.json').read_text())['daily_applications_target'], 20)
