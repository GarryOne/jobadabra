"""The employers end-to-end suite (desktop/e2e/suites/employers.mjs) expects fixed outcomes from its fixture feeds; this proves them against the real scout without the app or Notion,
so a fixture that drifts (or a scout change) fails here in seconds, not in a 10-minute e2e run."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FEEDS = ROOT / 'desktop' / 'e2e' / 'fixtures' / 'feeds'

SCRIPT = r'''
import json, sqlite3
from src import scout
class Tracker:
    def __init__(self): self.rows = []
    def query_database(self, *a, **k): return []
    def create_page(self, db, props): self.rows.append(props); return {'id': 'p'}
    def update_page(self, *a): pass
db = sqlite3.connect(':memory:'); db.row_factory = sqlite3.Row
tracker = Tracker()
from src.stores import notion
stores = notion.open_store({'NOTION_TOKEN': 't'}, tracker=tracker)   # a user on Notion: its rows are what the fake records
seeds = json.load(open('desktop/e2e/fixtures/feeds/employers/scout_seeds.json'))
starter = json.load(open('desktop/e2e/fixtures/feeds/sources.json'))
summary, results = scout.run(db, 15, stores, seeds, static=starter)
again, again_results = scout.run(db, 15, stores, seeds, static=starter)
plain = lambda p: {k: (v.get('title') or v.get('rich_text') or v.get('select') or v.get('number', v.get('checkbox', v.get('url'))) ) for k, v in p.items()}
print(json.dumps({'summary': summary, 'again': again, 'again_checked': len(again_results),
    'results': [[c['name'], o['status'], o.get('quality'), o.get('stats')] for c, o in results],
    'registered': [r[0] for r in db.execute('select company from feed_sources order by company')],
    'rows': [{'Company': p['Company']['title'][0]['text']['content'], 'status': p['Feed status']['select']['name'], 'Active': p['Active']['checkbox'],
              'Quality': p.get('Quality', {}).get('number'), 'Cities': ((p.get('Cities') or {}).get('rich_text') or [{}])[0].get('text', {}).get('content'),
              'Notes': ((p.get('Notes') or {}).get('rich_text') or [{}])[0].get('text', {}).get('content')} for p in tracker.rows]}))
'''


class EmployersFixturesTest(unittest.TestCase):
    PERSONA, PLACES = 'employers', ['Zurich']   # the SRE in Zurich; NurseEmployersFixturesTest swaps in the nurse in Manchester (EMPLOYERS_PERSONA=nurse in the e2e suite)

    @classmethod
    def setUpClass(cls):
        feeds = FEEDS
        if cls.PERSONA != 'employers':   # the persona's boards replace the SRE boards of the same names, exactly as the suite does
            cls._tmp = tempfile.mkdtemp()
            feeds = Path(cls._tmp) / 'feeds'
            shutil.copytree(FEEDS, feeds)
            for board in (FEEDS / cls.PERSONA).glob('*.json'):
                if board.name != 'person.json':
                    shutil.copy(board, feeds / 'employers' / board.name)
        # JOBADABRA_FOLLOW_APP=0: the child process is not under unittest, so on a Mac with the app set up it read the app's own scout
        # state (7 Oct 2026: E2E Ghost and Hollow went missing on the owner's Mac only, CI green).
        env = dict(os.environ, JOBADABRA_FIXTURE_DIR=str(feeds), JOBADABRA_LOCATIONS_FILE=str(FEEDS / cls.PERSONA / 'person.json'), JOBADABRA_FOLLOW_APP='0')
        out = subprocess.run([sys.executable, '-c', SCRIPT], cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
        assert out.returncode == 0, out.stderr[-2000:]
        cls.data = json.loads(out.stdout.strip().splitlines()[-1])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(getattr(cls, '_tmp', ''), ignore_errors=True)

    def test_each_candidate_ends_in_its_status(self):
        status = {name: s for name, s, _, _ in self.data['results']}
        self.assertEqual(status, {'E2E Nimbus': 'found', 'E2E Orbit': 'found', 'E2E Hollow': 'none', 'E2E Noise': 'low', 'E2E Ghost': 'none',
                                  'E2E Acme Labs': 'duplicate', 'E2E Quiet': 'manual'})   # E2E Blocked is excluded: never a candidate
        self.assertEqual(self.data['registered'], ['E2E Nimbus', 'E2E Orbit'])

    def test_quality_orders_the_two_relevant_boards(self):
        quality = {name: q for name, _, q, _ in self.data['results']}
        stats = {name: st for name, _, _, st in self.data['results']}
        self.assertGreaterEqual(quality['E2E Nimbus'] - quality['E2E Orbit'], 20)
        self.assertEqual((stats['E2E Nimbus']['jobs'], stats['E2E Nimbus']['relevant'], stats['E2E Nimbus']['preferred']), (5, 4, 4))
        self.assertEqual((stats['E2E Orbit']['jobs'], stats['E2E Orbit']['relevant'], stats['E2E Orbit']['preferred'], stats['E2E Orbit']['places']), (3, 2, 1, self.PLACES))

    def test_notion_rows_are_written_for_every_kind_but_the_duplicate(self):
        rows = {row['Company']: row for row in self.data['rows']}
        self.assertEqual(sorted(rows), ['E2E Ghost', 'E2E Hollow', 'E2E Nimbus', 'E2E Noise', 'E2E Orbit', 'E2E Quiet'])
        self.assertEqual({k: (v['status'], v['Active']) for k, v in rows.items()},
                         {'E2E Nimbus': ('Feed found', True), 'E2E Orbit': ('Feed found', True), 'E2E Noise': ('Low relevance', False),
                          'E2E Hollow': ('No public feed', False), 'E2E Ghost': ('No public feed', False), 'E2E Quiet': ('Manual watch', False)})
        self.assertIn('5 postings; 4 matching; 4 in preferred places', rows['E2E Nimbus']['Notes'])

    def test_a_second_run_checks_nothing_and_adds_nothing(self):
        self.assertEqual((self.data['again']['checked'], self.data['again_checked']), (0, 0))
        self.assertEqual(self.data['again']['total_feeds'], self.data['summary']['total_feeds'])
        self.assertEqual(len(self.data['rows']), 6)


class NurseEmployersFixturesTest(EmployersFixturesTest):
    """The same outcomes for a band 6 nurse in Manchester (fixtures/feeds/employers-nurse): the scout and its rows are not for engineers only."""
    PERSONA, PLACES = 'employers-nurse', ['Manchester']


if __name__ == '__main__':
    unittest.main()
