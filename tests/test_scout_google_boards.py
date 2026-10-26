"""The central scout's Google results for job boards (src/scout_google_boards.py; owner, 26 Oct 2026, "Yes, free plan only"): hard stops under
SerpApi's free 250 searches a month, only result addresses kept, each new site judged by the AI before the board pass reads it, each kind of work
and country searched once. Fake SerpApi and a fake judge only: no network, no AI."""
import sqlite3
import unittest
import json
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import scout_boards, scout_cells, scout_google_boards as google
from src.ai import decide

NOW = datetime(2026, 10, 26, 8, tzinfo=timezone.utc)
RESULTS = [{'title': 'Pilot Jobs Today', 'link': 'https://pilot-board.example/jobs/category/pilot_jobs.html', 'snippet': 'x'},
           {'title': 'An Airline careers', 'link': 'https://an-airline.example/careers'},
           {'title': 'People hiring', 'link': 'https://www.linkedin.com/jobs/pilot'},
           {'title': 'A wiki', 'link': 'http://plain.example/pilot'}]
RESULTS_AS_BOARDS = [{'name': 'Pilot Jobs Today', 'host': 'pilot-board.example', 'search_url': 'https://pilot-board.example/jobs', 'countries': ['Austria'],
                      'kinds': ['aviation_transport'], 'source_kind': 'sector'}]
JUDGED = {'pilot-board.example': 'field board', 'an-airline.example': 'one employer'}


class Fake:
    def __init__(self, left=240):
        self.left, self.asked = left, []

    def get(self, url, params):
        if url.endswith('account.json'):
            return {'plan_name': 'Free Plan', 'total_searches_left': self.left}
        self.asked.append(params['q'])
        self.params = params
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
        self.assertEqual(fake.params['gl'], 'at', "Google as seen from the country (run 40384536845: Croatia's searches gave US sites)")
        self.assertEqual(fake.asked, ['pilots jobs Austria', 'pilots job board Austria', 'cabin crew jobs Austria', 'cabin crew job board Austria',
                                      'air traffic jobs Austria', 'air traffic job board Austria'])
        self.assertEqual([(b['host'], b['search_url'], b['source_kind'], b['kinds']) for b in kept],
                         [('pilot-board.example', 'https://pilot-board.example/jobs/category/pilot_jobs.html', 'sector', ['aviation_transport'])],
                         "only the address Google gave, of a site the AI judged a board of this field")
        self.assertEqual(set(kept[0]) - {'name', 'host', 'search_url', 'countries', 'kinds', 'source_kind'}, set(), 'nothing else of the result is kept')
        self.assertEqual([host for host, _ in self.judged], ['pilot-board.example', 'an-airline.example'],
                         'each new site judged once; a portal and a plain-http page never reach the judge')
        self.assertIn('pilots, cabin crew', self.judged[0][1][0], 'judged for the kind of work searched')
        self.assertIn('Board pass, Google results: Austria: 6 searches (6 of 200 this month), 2 sites, 1 field boards; '
                      'judged field board: pilot-board.example; one employer: an-airline.example', self.out,
                      "every site's answer is said (26 Oct 2026: the first live run said only '32 sites, 0 field boards')")

    def test_a_site_without_an_answer_and_the_ones_past_the_judge_cap_are_said(self):
        many = [{'title': f'Site {n}', 'link': f'https://site{n}.example/jobs'} for n in range(google.MAX_JUDGED + 3)]
        fake = Fake()
        fake.get = lambda url, params: ({'total_searches_left': 240} if url.endswith('account.json') else {'organic_results': many})
        self.boards(fake)
        line = self.out[-1]
        self.assertIn('judged no answer: site0.example, site1.example', line)
        self.assertIn(f'not judged (over {google.MAX_JUDGED}): 3', line)

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
        asked = []
        scout_boards.run(self.db, ideas=lambda search: proposed, read_board=lambda board, *a: read.append(board['host']) or ([], 'empty', None),
                         out=self.out.append, named='at', google=lambda db, country, kinds, out: asked.append(kinds) or found)
        self.assertEqual(read[0], 'pilot-board.example')
        self.assertEqual(len(read), scout_boards.MAX_BOARDS)
        self.assertEqual(asked, [[kind for kind in scout_boards.kinds_for(self.db, 'at') if kind != 'software']],
                         "Google's few free searches go to the country's thinnest kinds of work, never software (owner, 19 Oct 2026: global, not tech)")


    def test_the_scout_workflow_gives_the_key_only_under_its_own_name(self):
        workflow = (Path(__file__).resolve().parent.parent / '.github/workflows/central-scout.yml').read_text()
        self.assertIn(f'{google.KEY_ENV}: ${{{{ secrets.CENTRAL_SCOUT_SERPAPI_KEY }}}}', workflow)
        self.assertNotIn('SERPAPI_API_KEY:', workflow, "that name turns on the role searches' SerpApi lane, outside the month cap")


    def test_a_site_not_judged_waits_for_the_next_run_and_is_never_searched_again(self):
        fake, answers = Fake(), {}
        self.judge = lambda board, roles: self.judged.append((board['host'], roles)) or answers.get(board['host'])
        self.assertEqual(self.boards(fake), [], '26 Oct 2026, Finland: the AI was not asked; nothing is lost')
        self.assertIn('2 wait for the next run', self.out[-1])
        answers['pilot-board.example'] = 'field board'
        self.judged.clear()
        kept = self.boards(fake)
        self.assertEqual(len(fake.asked), google.PER_PAIR, 'the next run judges what is waiting, without a new search')
        self.assertEqual([board['host'] for board in kept], ['pilot-board.example'])
        self.assertNotIn('tries', kept[0])
        self.assertIn('0 searches (6 of 200 this month), 2 sites (2 from earlier runs), 1 field boards', self.out[-1])
        for _ in range(google.TRIES):
            self.boards(fake)
        self.assertEqual(scout_cells._meta(self.db, 'serp_waiting', {}).get('at'), [], f'a site with no answer in {google.TRIES} runs is let go')

    def test_the_board_check_has_its_own_ai_allowance_past_the_scout_s_cap(self):
        decide.reset_run()
        self.addCleanup(decide.reset_run)
        decide._calls['n'] = decide.CENTRAL_MAX_CALLS   # 26 Oct 2026, run 40345621178: title sorting spent the 600 before the board pass
        db, calls = sqlite3.connect(':memory:'), []

        class Client:
            messages = SimpleNamespace(create=lambda **kw: calls.append(kw) or SimpleNamespace(
                stop_reason='end_turn', usage=None, content=[SimpleNamespace(type='text', text=json.dumps({'results': [{'index': 0, 'answer': 'yes'}]}))]))
        with mock.patch('src.ai.cost.side'), mock.patch('src.ai.meanings_pack.queue'):
            self.assertIsNone(decide.one('t', 'a', 'x', ('yes', 'no'), 'task', Client(), db), 'the shared cap is spent')
            self.assertEqual([decide.one('t', key, 'x', ('yes', 'no'), 'task', Client(), db, allowance=2) for key in 'bcd'], ['yes', 'yes', None])
        self.assertEqual(len(calls), 2)
        self.assertEqual(decide._calls['n'], decide.CENTRAL_MAX_CALLS, "the allowance's calls are not the shared cap's")

    def test_the_scout_s_board_check_asks_with_that_allowance(self):
        asked = []
        with mock.patch('src.ai.decide.one', lambda *question, **options: asked.append(options) or 'field board'), \
                mock.patch('src.sources.careers.get_text', lambda url: '<title>Pilot Jobs</title>'), \
                mock.patch.object(google, 'boards', lambda db, country, kinds, judge, out: [judge(board, ['pilots']) for board in RESULTS_AS_BOARDS]):
            self.assertEqual(scout_boards._google(self.db, 'at', ['aviation_transport'], self.out.append), ['field board'])
        self.assertEqual(asked, [{'allowance': google.MAX_JUDGED}])


if __name__ == '__main__':
    unittest.main()
