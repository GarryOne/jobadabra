"""The install's index cache keeps every part of the index the site serves that some reader reads (src/employer_index.py load/_read).
24 Oct 2026, Moldova check #12: the scout measured jobber.md (67 local jobs) and the site served it in the index's `sites`, but load() wrote only
feeds, nofeed and boards, so pool_facts() (src/sources/visits_jobpages.py) was {} on every install: the served boards and the older pooled
job-page, browser, dead, route and layout facts never arrived. The class: a key the site serves or a reader reads that the cache drops."""
import json
import re
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tests'))
from src import employer_index  # noqa: E402
from src.ai import board_ideas  # noqa: E402
from src.sources import visits_jobpages  # noqa: E402
from site_private import SITE, needs_site  # noqa: E402

NOW = datetime(2026, 10, 24, 19, 3, tzinfo=timezone.utc)
FEED = {'company': 'Bigco', 'ats': 'lever', 'slug': 'bigco', 'quality': 80, 'checked': '2026-10-24'}
BOARD_FACT = {'kind': 'board', 'host': 'jobber.md', 'url': 'https://jobber.md/jobs', 'recipe': {'countries': ['md']},
              'relevant': [{'country': 'md', 'family': 'software_dev', 'installs': 1, 'in_places': 67, 'fit70': 0}]}
FULL_ANSWER = {'version': 2, 'generated': '2026-10-24T19:02:06.717Z', 'regions': ['europe'], 'feeds': [FEED], 'nofeed': [],
               'boards': [], 'sites': [BOARD_FACT, {'kind': 'jobpage', 'host': 'bigco.com', 'url': 'https://bigco.com/careers'}]}
NOT_KEPT = {'version'}   # the answer's own format number; the cache keeps what a reader needs


def served_by(answer, status=200):
    def get(url, headers):
        return (304, '', None) if status == 304 else (200, json.dumps(answer), '"v1"')
    return get


class CacheKeepsServedKeysTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.cache = Path(tmp.name) / 'index.json'

    def load(self, status=200, now=NOW):
        return employer_index.load(self.cache, 'https://x.test/api/index', served_by(FULL_ANSWER, status), now, install_id='abcdefgh12')

    def test_every_key_a_full_answer_has_reaches_the_cache(self):
        self.load()
        kept = set(json.loads(self.cache.read_text()))
        self.assertEqual(sorted(set(FULL_ANSWER) - NOT_KEPT - kept), [], 'the site serves these and the install cache drops them')

    def test_the_site_serves_no_key_this_test_does_not_know(self):
        """Read from the site's own index builder when its folders are laid over this repo (jobadabra-web CI); else skipped."""
        employers = SITE.parent / 'api' / 'employers.js'
        if not employers.exists():
            self.skipTest('the site folders are in the private repo jobadabra-web: this guard runs in its CI')
        line = next(text for text in employers.read_text().splitlines() if 'JSON.stringify({version' in text)
        body, depth, parts, part = line.split('JSON.stringify({', 1)[1], 0, [], ''
        for char in body:
            depth += char in '({[' or -(char in ')}]')
            if depth < 0:
                break
            if char == ',' and depth == 0:
                parts.append(part)
                part = ''
            else:
                part += char
        parts.append(part)
        served = {re.match(r'\s*(?:\.\.\.\(.*\{)?\s*(\w+)', text).group(1) for text in parts}
        self.assertEqual(sorted(served - set(FULL_ANSWER)), [], 'the site serves a new key: add it to FULL_ANSWER and make sure the cache keeps it')

    def test_every_key_a_reader_takes_from_the_cache_file_is_one_load_writes(self):
        written = set()
        self.load()
        written = set(json.loads(self.cache.read_text()))
        for path in (ROOT / 'src').rglob('*.py'):
            for key in re.findall(r"CACHE\.read_text\(\)\)\.get\('(\w+)'\)", path.read_text(encoding='utf-8')):
                self.assertIn(key, written, f'{path.relative_to(ROOT)} reads {key!r} from the index cache and load() never writes it')

    def test_a_still_current_answer_keeps_every_key_too(self):
        self.load()
        first = json.loads(self.cache.read_text())
        self.load(status=304, now=NOW.replace(hour=20))   # older than MAX_AGE: asks, the site says 304
        self.assertEqual(json.loads(self.cache.read_text())['sites'], first['sites'])
        self.assertTrue(first['sites'])

    def test_a_served_board_reaches_the_pool_facts_and_the_board_proposal(self):
        """Before: pool_facts() == {} after a download. After: jobber.md is a served board for Moldova."""
        self.load()
        with mock.patch('src.employer_index.CACHE', self.cache):
            facts = visits_jobpages.pool_facts()
            self.assertEqual(facts['board']['jobber.md']['countries'], ['md'])
            self.assertEqual(facts['jobpage']['bigco.com'], 'https://bigco.com/careers')
            served = board_ideas.served(['Moldova'])
        self.assertEqual([b['host'] for b in served], ['jobber.md'])

    def test_a_malformed_sites_list_is_dropped_not_kept(self):
        answer = {**FULL_ANSWER, 'sites': ['junk', {'kind': 'board'}, {'host': 3, 'kind': 'dead'}, BOARD_FACT]}
        employer_index.load(self.cache, 'https://x.test/api/index', served_by(answer), NOW, install_id='abcdefgh12')
        self.assertEqual(json.loads(self.cache.read_text())['sites'], [BOARD_FACT])


if __name__ == '__main__':
    unittest.main()
