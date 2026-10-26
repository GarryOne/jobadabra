"""The central scout's board pass (src/scout_boards.py): per thin country, the boards that give jobs located there, kept as facts the index publish sends.
24 Oct 2026, owner: "A. Central scout measures boards" (a first search in Moldova depended on which boards the AI happened to name)."""
import sqlite3
import unittest
from datetime import date
from unittest import mock

from src import scout_boards, scout_cells
from src.sources import careers


def board(host):
    return {'name': host, 'host': host, 'search_url': f'https://{host}/search?q={{role}}', 'countries': ['Moldova'], 'kinds': ['any'], 'source_kind': 'general'}


def job(place, title='Developer'):
    return {'title': title, 'location': place, 'url': f'https://x/{place}/{title}'}


class BoardPassTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        scout_cells.keep(self.db, [{'countries': [c]} for c in scout_cells.EUROPE if c != 'md' for _ in range(5)])   # Moldova has none: the thinnest
        patches = [mock.patch.object(scout_boards.pool_tags, 'countries', lambda texts: ['md'] if any('Chi' in t for t in texts) else []),
                   mock.patch.object(scout_boards.pool_tags, 'families', lambda titles: ['software_dev'] if titles else [])]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def run_pass(self, reads, ideas=None):
        out = []
        seen = {}

        def read_board(item, search, fetch):
            seen['reader'] = careers.READER
            return reads[item['host']]
        got = scout_boards.run(self.db, ideas=ideas or (lambda search: [board(host) for host in reads]), read_board=read_board, out=out.append,
                               google=lambda db, country, kinds, out: [])   # Google's results: tests/test_scout_google_boards.py
        return got, out, seen

    def test_a_board_with_enough_jobs_located_in_the_country_becomes_a_fact(self):
        got, out, _ = self.run_pass({'a.md': ([job('Chisinau')] * 3 + [job('Berlin')], 'ok', None), 'b.md': ([job('Berlin')] * 9, 'ok', None)})
        self.assertEqual([(f['host'], f['country'], f['local_jobs'], f['families']) for f in got], [('a.md', 'md', 3, ['software_dev'])])
        self.assertIn('Moldova: 2 boards proposed, 1 with 3+ local jobs', out[0])

    def test_worldwide_remote_and_other_countries_do_not_count(self):
        got, _, _ = self.run_pass({'a.md': ([job('Remote')] * 10 + [job('Chisinau')] * 2, 'ok', None)})
        self.assertEqual(got, [], '2 local jobs are under the floor however many remote ones there are')

    def test_the_ai_page_reader_is_off_while_the_boards_are_read_and_back_after(self):
        before = careers.READER
        _, _, seen = self.run_pass({'a.md': ([job('Chisinau')] * 3, 'ok', None)})
        self.assertIsNone(seen['reader'])
        self.assertEqual(careers.READER, before)

    def test_boards_the_rules_could_not_read_are_named_in_the_log(self):
        _, out, _ = self.run_pass({'a.md': ([], 'empty', None), 'b.md': ([], 'browser', None)})
        self.assertIn('not measured (rules could not read the page): a.md, b.md', out[0])

    def test_facts_are_kept_for_the_publish_and_expire_after_thirty_days(self):
        self.run_pass({'a.md': ([job('Chisinau')] * 3, 'ok', None)})
        self.assertEqual([f['host'] for f in scout_boards.facts(self.db)], ['a.md'])
        self.assertEqual(scout_boards.facts(self.db, today=date(2099, 1, 1)), [])

    def test_one_thin_country_a_run_then_the_next(self):
        first = scout_boards.next_country(self.db)
        self.assertEqual(first, 'md', 'the country with no employers at all')
        self.assertNotEqual(scout_boards.next_country(self.db), first)

    def test_a_pass_with_no_time_left_says_so_and_reads_nothing(self):
        out, read = [], []
        got = scout_boards.run(self.db, ideas=lambda search: read.append(1) or [], clock=lambda: 100.0, until=99.0, out=out.append)
        self.assertEqual((got, read), ([], []))
        self.assertTrue(out and out[0].startswith('Board pass skipped: no time left'), out)

    def test_the_feed_checks_stop_early_enough_to_leave_the_pass_its_time(self):
        # 24 Oct 2026: the checks ran to the publish deadline, so the pass (needs RESERVE_S before it) never ran and said nothing.
        from pathlib import Path
        source = (Path(__file__).resolve().parent.parent / 'src' / 'scout.py').read_text()
        self.assertIn('publish_deadline(started) - scout_boards.RESERVE_S', source)
        self.assertIn('until=scout_overrun.publish_deadline(started)', source)

    def test_a_failure_is_said_and_never_raised(self):
        out = []

        def broken(search):
            raise RuntimeError('no AI')
        self.assertEqual(scout_boards.run(self.db, ideas=broken, out=out.append), [])
        self.assertIn('board pass skipped: RuntimeError: no AI', out[0])

    def test_the_index_publish_sends_the_facts_only_when_there_are_some(self):
        import json
        from src.scout_index import publish_index
        sent = []
        feeds = [{'ats': 'ashby', 'slug': 'a'}]
        publish_index(feeds, 'https://x/api/index', 'k', send=lambda request: sent.append(json.loads(request.data)) or 200)
        publish_index(feeds, 'https://x/api/index', 'k', send=lambda request: sent.append(json.loads(request.data)) or 200,
                      board_facts=[{'host': 'a.md', 'url': 'https://a.md/?q={role}', 'country': 'md', 'families': ['software_dev'], 'local_jobs': 4}])
        self.assertNotIn('board_facts', sent[0])
        self.assertEqual(sent[1]['board_facts'][0]['host'], 'a.md')

    def test_a_country_named_by_hand_is_read_and_each_board_says_listed_and_local(self):
        """24 Oct 2026, owner: "Small step + Moldova run": the by-hand scout run picks the country; the line shows listed/local per board."""
        self.assertEqual([scout_boards.named_country(x) for x in ('md', 'Moldova', ' moldova ', 'Narnia', '', None)], ['md', 'md', 'md', None, None, None])
        out = []
        reads = {'a.md': [job('Chisinau')] * 4 + [job('Paris')], 'b.md': []}
        scout_boards.run(self.db, ideas=lambda search: [board(h) for h in reads], read_board=lambda item, *a: (reads[item['host']], 'ok', None),
                         out=out.append, named='md')
        self.assertIn('Board pass: Moldova: 2 boards proposed, 1 with 3+ local jobs; listed/local: a.md 5/4, b.md 0/0', out[-1])
        self.assertIn('md', scout_cells._meta(self.db, 'boards_aimed', []))   # it counts as done: the rotation moves on

    def test_the_workflow_passes_the_country_input_to_the_scout(self):
        from pathlib import Path
        flow = (Path(__file__).resolve().parents[1] / '.github/workflows/central-scout.yml').read_text()
        self.assertIn('country: {description', flow)
        self.assertIn('SCOUT_BOARD_COUNTRY: ${{ inputs.country }}', flow)


class RealBoardIdeasTest(unittest.TestCase):
    def test_the_scouts_country_search_reaches_the_ai_with_an_empty_places_cache(self):
        """24 Oct 2026, scout run 40115771200: "0 boards proposed, took 0 s": country_wide ['Moldova'] resolved to no country in CI (empty places
        cache), so board_ideas.asked_for returned None before any AI call. The earlier tests passed a fake `ideas` and never saw it."""
        import json
        import tempfile
        from pathlib import Path
        from types import SimpleNamespace
        from src.ai import board_ideas
        db = sqlite3.connect(':memory:')
        scout_cells.keep(db, [{'countries': [c]} for c in scout_cells.EUROPE if c != 'md' for _ in range(5)])
        answer = {'boards': [{'name': 'Local', 'search_url': 'https://jobs.example.md/?q={role}', 'countries': ['Moldova'], 'kinds': ['any']}]}
        asked = []

        def create(**kwargs):
            asked.append(json.loads(kwargs['messages'][0]['content']))
            return SimpleNamespace(stop_reason='end_turn', usage=None, content=[SimpleNamespace(type='text', text=json.dumps(answer))])
        client = SimpleNamespace(messages=SimpleNamespace(create=create))
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        out = []
        with mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}), \
                mock.patch('src.ai.engine.ready', return_value=True), mock.patch('src.ai.engine.client', return_value=client), \
                mock.patch.object(board_ideas, 'served', return_value=[]):
            scout_boards.run(db, read_board=lambda *a: ([], 'empty', None), out=out.append)
        self.assertEqual([a['countries'] for a in asked], [['Moldova']], out)
