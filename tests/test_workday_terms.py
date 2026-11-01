"""The Workday reader (src/sources/ats.py workday): the newest jobs with no term, then the user's own phrases (6 Oct 2026: it searched only SRE and
DevOps terms, the first user's, so a photographer never saw Cartier's or Piaget's boutique jobs, and Richemont read as 70 engineering jobs)."""
import io
import json
import unittest
from pathlib import Path
import sys
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import ats  # noqa: E402

PHOTOGRAPHER = {'jobs_board_search_queries': ['photographe', 'vendeur magasin', 'vendeur  magasin'], 'role_keywords': ['photograph(e|er)?']}


class WorkdayTermsTests(unittest.TestCase):
    def test_the_users_phrases_else_their_role_words(self):
        self.assertEqual(ats.workday_terms(PHOTOGRAPHER), ['photographe', 'vendeur magasin'])
        self.assertEqual(ats.workday_terms({'role_keywords': [r'\bsre\b', 'site reliability']}), ['sre', 'site reliability'])

    def test_the_newest_jobs_first_then_each_phrase_and_a_short_page_ends_a_search(self):
        asked = []
        def urlopen(request, timeout=None):
            body = json.loads(request.data)
            asked.append((body['searchText'], body['offset']))
            count = 20 if body['searchText'] == '' and body['offset'] < 40 else 3
            postings = [{'externalPath': f"/job/{body['searchText'] or 'all'}-{body['offset'] + i}", 'title': 'Sales Associate', 'locationsText': 'Geneva'}
                        for i in range(count)]
            return mock.MagicMock(__enter__=lambda self: io.BytesIO(json.dumps({'jobPostings': postings}).encode()), __exit__=lambda *a: None)
        with mock.patch.object(ats, 'workday_terms', lambda search=None: ['photographe', 'vendeur magasin']), \
                mock.patch.object(ats.urllib.request, 'urlopen', urlopen), mock.patch.dict('os.environ', {'JOBADABRA_FIXTURE_DIR': ''}):
            jobs = ats.workday('richemont.wd3.richemont')
        self.assertEqual(asked, [('', 0), ('', 20), ('', 40), ('photographe', 0), ('vendeur magasin', 0)])
        self.assertEqual(len(jobs), 20 + 20 + 3 + 3 + 3)
        self.assertNotIn('devops', [term for term, _ in asked])


if __name__ == '__main__':
    unittest.main()
