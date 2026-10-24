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
        got = scout_boards.run(self.db, ideas=ideas or (lambda search: [board(host) for host in reads]), read_board=read_board, out=out.append)
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
