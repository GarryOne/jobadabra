"""The central scout's Google results for job boards (src/scout_google_boards.py; owner, 26 Oct 2026, "Yes, free plan only"): hard stops under
SerpApi's free 250 searches a month, only result addresses kept, each new site judged by the AI before the board pass reads it, each kind of work
and country searched once. Fake SerpApi and a fake judge only: no network, no AI."""
import sqlite3
import unittest
from datetime import datetime, timezone
from pathlib import Path

from src import scout_boards, scout_cells, scout_google_boards as google

NOW = datetime(2026, 10, 26, 8, tzinfo=timezone.utc)
RESULTS = [{'title': 'Pilot Jobs Today', 'link': 'https://pilot-board.example/jobs/category/pilot_jobs.html', 'snippet': 'x'},
           {'title': 'An Airline careers', 'link': 'https://an-airline.example/careers'},
           {'title': 'People hiring', 'link': 'https://www.linkedin.com/jobs/pilot'},
           {'title': 'A wiki', 'link': 'http://plain.example/pilot'}]
JUDGED = {'pilot-board.example': 'field board', 'an-airline.example': 'one employer'}


class Fake:
    def __init__(self, left=240):
        self.left, self.asked = left, []

    def get(self, url, params):
        if url.endswith('account.json'):
            return {'plan_name': 'Free Plan', 'total_searches_left': self.left}
        self.asked.append(params['q'])
        return {'organic_results': RESULTS, 'search_metadata': {'id': 'x'}}


class GoogleBoards(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.out, self.judged = [], []

    def judge(self, board, roles):
        self.judged.append((board['host'], roles))
        return JUDGED.get(board['host'])

    def boards(self, fake, kinds=('aviation_transport',), country='at', key='k', now=NOW):
        return google.boards(self.db, country, list(kinds), self.judge, key=key, get=fake.get, now=now, out=self.out.append)

    def test_only_field_boards_join_with_the_result_address_and_the_ai_judges_each_new_site(self):
        fake = Fake()
        kept = self.boards(fake)
        self.assertEqual(fake.asked, ['pilots jobs Austria', 'pilots job board Austria', 'cabin crew jobs Austria', 'cabin crew job board Austria',
                                      'air traffic jobs Austria', 'air traffic job board Austria'])
        self.assertEqual([(b['host'], b['search_url'], b['source_kind'], b['kinds']) for b in kept],
                         [('pilot-board.example', 'https://pilot-board.example/jobs/category/pilot_jobs.html', 'sector', ['aviation_transport'])],
                         "only the address Google gave, of a site the AI judged a board of this field")
        self.assertEqual(set(kept[0]) - {'name', 'host', 'search_url', 'countries', 'kinds', 'source_kind'}, set(), 'nothing else of the result is kept')
        self.assertEqual([host for host, _ in self.judged], ['pilot-board.example', 'an-airline.example'],
                         'each new site judged once; a portal and a plain-http page never reach the judge')
        self.assertIn('pilots, cabin crew', self.judged[0][1][0], 'judged for the kind of work searched')
        self.assertIn('Board pass, Google results: Austria: 6 searches (6 of 200 this month), 2 sites, 1 field boards: pilot-board.example', self.out)

    def test_a_kind_and_country_is_searched_once(self):
        fake = Fake()
        self.boards(fake)
        self.assertEqual(self.boards(fake), [])
        self.assertEqual(len(fake.asked), google.PER_PAIR, 'the same pair is never searched again')
        self.boards(fake, kinds=('healthcare',))
        self.assertEqual(len(fake.asked), 2 * google.PER_PAIR, 'a new kind of work is')

    def test_the_month_cap_is_a_hard_stop_and_counts_every_search(self):
        scout_cells._set(self.db, 'serp_month', {'month': '2026-10', 'used': google.MONTH_CAP})
        fake = Fake()
        self.assertEqual(self.boards(fake), [])
        self.assertEqual(fake.asked, [], f'{google.MONTH_CAP} used this month: no search at all')
        self.assertTrue(any('stopped: 200 of 200 searches used in 2026-10' in line for line in self.out))
        scout_cells._set(self.db, 'serp_month', {'month': '2026-10', 'used': google.MONTH_CAP - 4})
        self.boards(fake)
        self.assertEqual(fake.asked, [], 'fewer left this month than one pair needs: the pair waits, never a part over the cap')
        self.boards(fake, now=datetime(2026, 11, 1, tzinfo=timezone.utc))
        self.assertEqual(len(fake.asked), google.PER_PAIR, 'a new month starts again from 0')
        self.assertEqual(scout_cells._meta(self.db, 'serp_month', {}), {'month': '2026-11', 'used': google.PER_PAIR})

    def test_never_past_the_account_s_reserve_or_the_run_s_cap(self):
        fake = Fake(left=google.RESERVE)
        self.assertEqual(self.boards(fake), [])
        self.assertEqual(fake.asked, [], 'the account has its reserve or less: no search')
        fake = Fake(left=10_000)
        self.boards(fake, kinds=('aviation_transport', 'healthcare', 'logistics'))
        self.assertLessEqual(len(fake.asked), google.PER_RUN)
        self.assertLessEqual(google.MONTH_CAP + google.RESERVE, 250, "ours and the reserve stay inside the free plan's 250")

    def test_off_without_a_key_or_an_account_answer(self):
        fake = Fake()
        self.assertEqual(self.boards(fake, key=''), [])
        self.assertIn('Board pass, Google results: off (no SCOUT_SERPAPI_KEY)', self.out)

        def broken(url, params):
            raise OSError('down')
        self.assertEqual(google.boards(self.db, 'at', ['aviation_transport'], self.judge, key='k', get=broken, now=NOW, out=self.out.append), [])
        self.assertEqual(fake.asked, [])

    def test_the_board_pass_reads_google_s_field_boards_first(self):
        read = []
        found = [{'name': 'pilot-board.example', 'host': 'pilot-board.example', 'search_url': 'https://pilot-board.example/jobs', 'countries': ['Austria'],
                  'kinds': ['aviation_transport'], 'source_kind': 'sector'}]
        proposed = [{'name': f'B{n}', 'host': f'b{n}.example', 'search_url': f'https://b{n}.example/?q={{role}}', 'countries': ['Austria'],
                     'kinds': ['any'], 'source_kind': 'general'} for n in range(20)]
        scout_boards.run(self.db, ideas=lambda search: proposed, read_board=lambda board, *a: read.append(board['host']) or ([], 'empty', None),
                         out=self.out.append, named='at', google=lambda db, country, kinds, out: found)
        self.assertEqual(read[0], 'pilot-board.example')
        self.assertEqual(len(read), scout_boards.MAX_BOARDS)


    def test_the_scout_workflow_gives_the_key_only_under_its_own_name(self):
        workflow = (Path(__file__).resolve().parent.parent / '.github/workflows/central-scout.yml').read_text()
        self.assertIn(f'{google.KEY_ENV}: ${{{{ secrets.CENTRAL_SCOUT_SERPAPI_KEY }}}}', workflow)
        self.assertNotIn('SERPAPI_API_KEY:', workflow, "that name turns on the role searches' SerpApi lane, outside the month cap")


if __name__ == '__main__':
    unittest.main()
