"""Product brain plumbing (tools/product_brain.py): the lens of the day, Markdown to Notion blocks, and a posted
brief (a Notion row + a Telegram card whose buttons carry the page id). Claude decides; the script only records."""
import datetime as dt
import importlib.util
import json
import tempfile
import unittest
import unittest.mock
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'tools' / 'product_brain.py'
SPEC = importlib.util.spec_from_file_location('product_brain', SCRIPT)
brain = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(brain)


class LensTest(unittest.TestCase):
    def test_weekdays_rotate_and_the_weekend_picks_by_evidence(self):
        monday = dt.date(2026, 9, 28)
        self.assertEqual([brain.lens_of_the_day(monday + dt.timedelta(days=i)) for i in range(5)],
                         ['Growth', 'Product', 'Quality', 'UX', 'Business'])
        self.assertIn('evidence', brain.lens_of_the_day(dt.date(2026, 10, 3)))


class RankTest(unittest.TestCase):
    def test_the_compass_and_strategy_come_before_guides_and_templates(self):
        titles = ['User Guide — Daily Use', 'Profile — CV and Preferences', '✨ Feature catalog',
                  'Marketing Strategy — Free vs Premium', '📍 Product Compass']
        self.assertEqual(sorted(titles, key=brain.rank)[:3],
                         ['📍 Product Compass', 'Marketing Strategy — Free vs Premium', '✨ Feature catalog'])


class BlocksTest(unittest.TestCase):
    def test_headings_lists_todos_and_paragraphs(self):
        kinds = [b['type'] for b in brain.blocks('## Options\n- one\n1. first\n- [ ] do it\n- [x] done\n\nPlain text')]
        self.assertEqual(kinds, ['heading_2', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'to_do', 'paragraph'])

    def test_long_lines_fit_notion(self):
        self.assertLessEqual(len(brain.blocks('x' * 5000)[0]['paragraph']['rich_text'][0]['text']['content']), 2000)


class PostTest(unittest.TestCase):
    def test_a_brief_becomes_a_proposed_row_and_a_card_with_three_buttons(self):
        calls, sent = [], []
        brain.DATABASE = 'db'
        brain.notion = lambda path, method='GET', body=None: (calls.append((path, method, body)),
                                                               {'id': 'abcd-ef', 'url': 'https://notion.so/x'})[1]
        brain.telegram = lambda text, buttons=None: sent.append((text, buttons))
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as file:
            json.dump({'action': 'Post a 3-part LinkedIn launch series', 'lens': 'Growth', 'why': '0 visits from LinkedIn',
                       'effort': '2h', 'expected': '+20 visits', 'check_in_days': 7, 'details': '## Evidence\n- 3 downloads'}, file)
        brain.post(file.name, dt.date(2026, 9, 30))
        created = calls[0][2]['properties']
        self.assertEqual(created['Status']['select']['name'], 'Proposed')
        self.assertEqual(created['Lens']['select']['name'], 'Growth')
        self.assertEqual(created['Check on']['date']['start'], '2026-10-07')
        text, buttons = sent[0]
        self.assertIn('Post a 3-part LinkedIn launch series', text)
        self.assertEqual([b['callback_data'] for b in buttons[0]], ['pb:x:abcdef', 'pb:n:abcdef', 'pb:a:abcdef'])

    def test_unknown_lens_falls_back_and_missing_action_stops(self):
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as file:
            json.dump({'lens': 'Growth'}, file)
        with self.assertRaises(SystemExit):
            brain.post(file.name, dt.date(2026, 9, 30))


class RequestTest(unittest.TestCase):
    def test_a_reset_connection_is_retried_once_then_reported(self):
        calls = []
        def boom(req, timeout):
            calls.append(1)
            raise ConnectionResetError(104, 'Connection reset by peer')
        real = brain.urllib.request.urlopen
        brain.urllib.request.urlopen = boom
        try:
            with self.assertRaises(SystemExit):
                brain._request('https://example.test/x')
        finally:
            brain.urllib.request.urlopen = real
        self.assertEqual(len(calls), 2)


class StatusTest(unittest.TestCase):
    def test_only_known_statuses(self):
        with self.assertRaises(SystemExit):
            brain.status('abc', 'Shipped')


if __name__ == '__main__':
    unittest.main()


class SiteLogTest(unittest.TestCase):
    """Every brain message also goes to the site's log (POST /api/brain/log -> D1 brain_messages, /admin/intelligence/brain)."""

    def setUp(self):
        self.logged, self.saved = [], {k: getattr(brain, k) for k in ('notion', 'telegram', 'site_log', 'DATABASE')}
        brain.DATABASE = 'db'
        brain.site_log = lambda messages: self.logged.extend(messages) or len(messages)

    def tearDown(self):
        for name, value in self.saved.items():
            setattr(brain, name, value)

    def test_post_logs_the_recommendation_with_its_telegram_id_and_full_text(self):
        brain.notion = lambda path, method='GET', body=None: {'id': 'abcd-ef', 'url': 'https://www.notion.so/x'}
        brain.telegram = lambda text, buttons=None: 812
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as file:
            json.dump({'action': 'Ship the page', 'lens': 'Product', 'why': 'taps are lost', 'details': '## Evidence\n- 3 taps'}, file)
        brain.post(file.name, dt.date(2026, 10, 7))
        [row] = self.logged
        self.assertEqual((row['decision'], row['kind'], row['status'], row['telegram_id'], row['notion_url']),
                         ('abcdef', 'recommendation', 'Proposed', 812, 'https://www.notion.so/x'))
        self.assertIn('Why: taps are lost', row['text'])
        self.assertIn('- 3 taps', row['text'])

    def test_plan_and_status_are_logged(self):
        row = {'url': 'https://www.notion.so/x', 'properties': {'Action': {'type': 'title', 'title': [{'plain_text': 'Ship'}]}}}
        brain.notion = lambda path, method='GET', body=None: row
        brain.telegram = lambda text, buttons=None: 9
        with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False) as file:
            file.write('# Build a D1 table\n1. migrate')
        brain.plan('ab-cd', file.name)
        brain.status('ab-cd', 'Approved', 'go')
        self.assertEqual([(m['kind'], m['status'], m['decision'], m.get('telegram_id')) for m in self.logged],
                         [('plan', 'Plan ready', 'abcd', 9), ('status', 'Approved', 'abcd', None)])
        self.assertEqual(self.logged[0]['title'], 'Build a D1 table')
        self.assertEqual(self.logged[1]['text'], 'go')

    def test_a_log_write_never_fails_the_step(self):
        brain.site_log = self.saved['site_log']
        with unittest.mock.patch.dict('os.environ', {'JOB_PILOTTO_TELEMETRY_KEY': 'k'}), \
             unittest.mock.patch.object(brain, '_request', side_effect=SystemExit('POST failed: 500')):
            self.assertEqual(brain.site_log([{'decision': 'a', 'kind': 'status'}]), 0)

    def test_sync_turns_a_decisions_row_into_its_messages(self):
        def prop(kind, value):
            return {'type': kind, kind: {'name': value} if kind == 'select' else [{'plain_text': value}]}
        row = {'id': 'ab-cd', 'url': 'https://www.notion.so/r', 'created_time': '2026-10-01T05:00:00.000Z',
               'last_edited_time': '2026-10-02T09:00:00.000Z',
               'properties': {'Action': prop('title', 'Ship'), 'Status': prop('select', 'Approved'), 'Lens': prop('select', 'UX'),
                              'Result': prop('rich_text', 'built')}}
        lines = [('2026-10-01T05:00:00.000Z', 'Evidence'), ('2026-10-01T06:00:00.000Z', 'Explored plan'), ('2026-10-01T06:00:00.000Z', '1. table')]
        messages = brain.row_messages(row, lines)
        self.assertEqual([(m['kind'], m['status'], m['at']) for m in messages],
                         [('recommendation', 'Proposed', '2026-10-01T05:00:00.000Z'), ('plan', 'Plan ready', '2026-10-01T06:00:00.000Z'),
                          ('status', 'Approved', '2026-10-02T09:00:00.000Z')])
        self.assertIn('Lens: UX', messages[0]['text'])
        self.assertIn('Evidence', messages[0]['text'])
        self.assertEqual(messages[1]['text'], '1. table')
        self.assertTrue(all(m['source'] == 'backfill' and m['decision'] == 'abcd' for m in messages))
        proposed = {**row, 'properties': {**row['properties'], 'Status': prop('select', 'Proposed')}}
        self.assertEqual([m['kind'] for m in brain.row_messages(proposed, lines[:1])], ['recommendation'])
