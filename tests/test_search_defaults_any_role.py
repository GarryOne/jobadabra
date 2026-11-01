"""A search with no strategy yet steers no one to tech roles: the shipped defaults carry no role, an unknown search is not an IT search,
and coverage offers a nurse in Lyon or a truck driver in Cluj no engineering terms (owner, 19 Oct 2026: a global search, not a tech one)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src import coverage  # noqa: E402
from src.paths import keyword_regex  # noqa: E402

# Settings that name a kind of work: none of them may come filled in by default (everything else, e.g. the regions remote jobs exclude, is generic).
ROLE_LISTS = ('role_keywords', 'board_discovery_keywords', 'jobs_board_search_queries', 'quality_stack_keywords', 'title_exclude_keywords')
TECH_TITLES = ('Senior Backend Engineer', 'Data Analyst', 'Site Reliability Engineer', 'Software Developer (m/f/d)', 'Analytics Engineer')
CANDIDATES = {'a nurse in Lyon': ['infirmière', 'infirmier'], 'a truck driver in Cluj': ['șofer', 'truck driver']}
NEAR_MISSES = [{'term': term, 'count': 40, 'examples': [term.title()]} for term in ('backend', 'software engineer', 'developer', 'sviluppatore', 'informatiker')]
SUMMARY = {'in_places': 3000, 'matched': 20, 'fetched': 9000, 'feeds': 60, 'places': [], 'suggestions': NEAR_MISSES}

RUN = '''
import sys, json
sys.path.insert(0, sys.argv[1])
from src import coverage
from src.sources import feeds
print(json.dumps({"wanted": [feeds.wanted_title(t) for t in json.loads(sys.argv[2])], "technical": coverage.technical_search(feeds._SEARCH)}))
'''


class ShippedDefaultsTest(unittest.TestCase):
    def test_the_defaults_name_no_role_stack_or_board_search(self):
        search = json.loads((ROOT / 'config' / 'search.json').read_text())
        for key in ROLE_LISTS:
            self.assertEqual(search.get(key) or [], [], f'config/search.json {key} is filled in for everyone before their strategy exists')
        self.assertEqual((search.get('google_jobs') or {}).get('queries') or [], [])

    def test_the_defaults_name_no_place(self):
        search = json.loads((ROOT / 'config' / 'search.json').read_text())
        for tier, places in (search.get('locations') or {}).items():
            self.assertEqual(places, [], f'a default {tier} place would send a candidate elsewhere')
        self.assertEqual((search.get('google_jobs') or {}).get('locations') or [], [])

    def test_the_run_on_the_defaults_wants_no_title_and_is_not_an_it_search(self):
        with tempfile.TemporaryDirectory() as data:
            env = {k: v for k, v in os.environ.items() if k != 'JOBADABRA_LOCATIONS_FILE'}
            done = subprocess.run([sys.executable, '-c', RUN, str(ROOT), json.dumps(list(TECH_TITLES))], capture_output=True, text=True, timeout=60,
                                  env={**env, 'JOBADABRA_CONFIG_DIR': str(ROOT / 'config'), 'JOBADABRA_DATA_DIR': data})
        self.assertEqual(done.returncode, 0, done.stderr)
        got = json.loads(done.stdout.strip().splitlines()[-1])
        self.assertEqual(got['wanted'], [False] * len(TECH_TITLES), 'no role words: no title is a sure match')
        self.assertFalse(got['technical'], 'no role words: not an IT search (no SwissDevJobs, no IT prompts)')

    def test_no_role_words_match_nothing_not_everything(self):
        self.assertIsNone(keyword_regex([]).search('Registered Nurse'))
        self.assertIsNone(keyword_regex([]).search(''))


class UnknownSearchTest(unittest.TestCase):
    def test_a_search_with_no_known_role_is_not_technical(self):
        for search in ({}, {'role_keywords': []}, {'role_keywords': ['zzz']}):
            self.assertFalse(coverage.technical_search(search), search)
        self.assertFalse(coverage.looks_technical([]))
        self.assertTrue(coverage.looks_technical(['site reliability']))

    def test_coverage_offers_no_engineering_terms_before_or_without_a_strategy(self):
        said = coverage.verdict(SUMMARY, keywords=[])
        self.assertEqual(said['suggestions'], [])
        self.assertFalse(said['narrow'])

    def test_coverage_judges_a_non_tech_candidates_cv_fairly(self):
        for who, keywords in CANDIDATES.items():
            said = coverage.verdict(SUMMARY, keywords=keywords)
            self.assertEqual(said['suggestions'], [], who)
            self.assertFalse(said['narrow'], who)


if __name__ == '__main__':
    unittest.main()
