"""Each site is read at the pace it allows (src/sources/host_pace.py): 429 (and 503 with Retry-After) is "slow down", never a refusal; 401/403
stay refusals; the pace is learned per domain and kept. Every reader of a public site goes through it (the class test fails on a new one)."""
import io
import sqlite3
import sys
import tempfile
import threading
import tokenize
import unittest
import urllib.error
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src import scout_core  # noqa: E402
from src.sources import aggregators, ats, boards, careers, describe, host_pace  # noqa: E402

PAGE = '<html><body><main>' + 'A posting about driving trucks. ' * 30 + '</main></body></html>'


class Site(BaseHTTPRequestHandler):
    """/ok: 200. /slow: 429 without Retry-After. /slow-then-ok: 429 Retry-After 2 once, then 200. /busy-503: 503 Retry-After 1 once.
    /down-503: 503 without Retry-After. /refuse: 403."""
    hits = {}

    def do_GET(self):
        path = self.path.split('?')[0]
        count = Site.hits[path] = Site.hits.get(path, 0) + 1
        if path == '/refuse':
            return self._send(403)
        if path == '/slow' or (path == '/slow-then-ok' and count == 1):
            return self._send(429, {'Retry-After': '2'} if path == '/slow-then-ok' else {})
        if path == '/busy-503' and count == 1:
            return self._send(503, {'Retry-After': '1'})
        if path == '/down-503':
            return self._send(503)
        body = (b'{"jobs": []}' if path.endswith('.json') else PAGE.encode())
        self._send(200, {'Content-Type': 'application/json' if path.endswith('.json') else 'text/html; charset=utf-8'}, body)

    def _send(self, code, headers=None, body=b''):
        self.send_response(code)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


class Clock:
    def __init__(self):
        self.now, self.slept = 1_800_000_000.0, []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.now += seconds


class PaceCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Site)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        Site.hits = {}
        self.dir = tempfile.TemporaryDirectory()
        self.clock = Clock()
        for patch in (mock.patch.object(host_pace, 'FILE', Path(self.dir.name) / 'host_pace.json'), mock.patch.object(host_pace, 'clock', self.clock),
                      mock.patch.object(host_pace, 'sleep', self.clock.sleep)):
            patch.start()
            self.addCleanup(patch.stop)
        host_pace.reset()
        self.addCleanup(host_pace.reset)
        self.addCleanup(self.dir.cleanup)


class PaceTest(PaceCase):
    def read(self, path):
        with host_pace.open(urllib.request.Request(self.base + path), timeout=5) as response:
            return response.read()

    def test_429_with_retry_after_waits_and_reads_it(self):
        self.assertIn(b'driving', self.read('/slow-then-ok'))
        self.assertEqual(Site.hits['/slow-then-ok'], 2)
        self.assertGreaterEqual(max(self.clock.slept), 2)   # honoured Retry-After
        self.assertIn('127.0.0.1', host_pace.FILE.read_text())   # the learned gap is kept for the next run

    def test_429_without_retry_after_backs_off_then_says_busy_never_refused(self):
        with self.assertRaises(host_pace.Busy) as caught:
            self.read('/slow')
        self.assertNotIsInstance(caught.exception, urllib.error.HTTPError)
        self.assertIsInstance(caught.exception, OSError)   # a reader's "failed, try again later" path takes it
        self.assertEqual(Site.hits['/slow'], host_pace.RETRIES + 1)
        self.assertEqual(self.clock.slept, sorted(self.clock.slept))   # each wait longer than the last
        self.assertGreater(host_pace.waiting(self.base), 0)

    def test_403_is_still_a_refusal_asked_once(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.read('/refuse')
        self.assertEqual((caught.exception.code, Site.hits['/refuse']), (403, 1))
        self.assertFalse(host_pace.FILE.exists())

    def test_a_403_right_after_a_fast_burst_slows_down_once_then_counts(self):
        for _ in range(host_pace.BURST_MIN):
            self.read('/ok')   # a fast burst: no gap, no waiting
        self.assertEqual(self.clock.slept, [])
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.read('/refuse')   # still refused after the one slow-down: it is a refusal
        self.assertEqual(caught.exception.code, 403)
        self.assertEqual(Site.hits['/refuse'], 2)   # asked again exactly once
        self.assertGreaterEqual(max(self.clock.slept), host_pace.BURST_GAP)
        self.assertGreater(host_pace._load()[host_pace.domain(self.base)]['gap'], 0)   # the site's pace stays slower

    def test_a_401_after_a_fast_burst_is_never_retried(self):
        for _ in range(host_pace.BURST_MIN):
            self.read('/ok')
        self.assertFalse(host_pace.answer(self.base, 401))   # a sign-in is an immediate no, burst or not
        self.assertEqual(self.clock.slept, [])

    def test_a_403_from_a_site_not_hit_in_a_burst_is_asked_once(self):
        self.read('/ok')
        self.clock.now += 60
        with self.assertRaises(urllib.error.HTTPError):
            self.read('/refuse')
        self.assertEqual(Site.hits['/refuse'], 1)

    def test_503_only_slows_down_with_retry_after(self):
        self.assertIn(b'driving', self.read('/busy-503'))
        with self.assertRaises(urllib.error.HTTPError):
            self.read('/down-503')
        self.assertEqual(Site.hits['/down-503'], 1)

    def test_a_long_slow_down_waits_for_the_next_run_without_asking(self):
        host_pace.answer(self.base, 429, wait=3600)
        with self.assertRaises(host_pace.Busy):
            self.read('/ok')
        self.assertNotIn('/ok', Site.hits)

    def test_many_workers_queued_on_one_slow_site_never_wait_more_than_max_wait_in_total(self):
        # 23 Oct 2026: a gap of 120 s after a 429 and 6 workers on one job-system host left a check asleep for minutes (the central scout ran 75 min)
        host_pace.answer(self.base, 429, wait=1)
        for _ in range(3):
            host_pace.answer(self.base, 429, wait=1)   # the gap doubles each time
        self.clock.now += 5   # the site's own calm-until is over; only the queue of slots is left
        gap = host_pace._load()['127.0.0.1']['gap']
        self.assertGreaterEqual(gap, 8)
        busy = 0
        waits = []
        with mock.patch.object(host_pace, 'sleep', waits.append):   # workers asleep in parallel: the clock does not move between their reservations
          for _ in range(40):   # fictional 40 checks of other employers on the same host
            try:
                host_pace.turn(self.base + '/ok')
            except host_pace.Busy:
                busy += 1
        self.assertGreater(busy, 0)
        self.assertLessEqual(max(waits or [0]), host_pace.MAX_WAIT)

    def test_speeds_up_after_a_run_of_good_answers_and_remembers(self):
        host_pace.answer(self.base, 429, wait=8)
        slow = host_pace._load()['127.0.0.1']['gap']
        self.clock.now += 60
        for _ in range(host_pace.SPEEDUP_AFTER):
            self.read('/ok')
        fast = host_pace._load()['127.0.0.1']['gap']
        self.assertLess(fast, slow)
        host_pace.reset()   # a new run starts at the learned pace
        self.assertAlmostEqual(host_pace._load()['127.0.0.1']['gap'], fast, places=1)

    def test_one_pace_per_domain_shared_by_its_employers(self):
        self.assertEqual(host_pace.domain('https://acme.jobsystem.example/j/1'), host_pace.domain('https://other.jobsystem.example/j/2'))
        host_pace.answer('https://acme.jobsystem.example/j/1', 429, wait=600)
        self.assertGreater(host_pace.waiting('https://other.jobsystem.example/j/2'), 0)
        self.assertEqual(host_pace.waiting('https://elsewhere.example/'), 0)

    def test_a_domain_is_not_waited_for_until_it_asks_then_its_requests_are_spaced(self):
        for _ in range(3):
            self.read('/ok')
        self.assertEqual(self.clock.slept, [])   # never slowed us: today's speed (a search crawls hundreds of feeds on one job system)
        host_pace.answer(self.base, 429)
        self.clock.now = host_pace.waiting(self.base)
        for _ in range(3):
            self.read('/ok')
        self.assertEqual(len(self.clock.slept), 2)   # the 2nd and 3rd waited their turn
        self.assertTrue(all(wait >= 1 for wait in self.clock.slept))


# Every engine reader of a public site, called on an address that answers 429 without end: each must end as "try later" (Busy, or its own
# empty/kept result), never a refusal. A new reader goes in this list.
def _describe(url):
    return describe._get(url)


def _careers(url):
    with mock.patch.object(careers, '_public', return_value=True):
        return careers.get_text(url)


READERS = {
    'describe._get': _describe,
    'careers.get_text': _careers,
    'ats._get': lambda url: ats._get(url),
    'aggregators._get': lambda url: aggregators._get(url),
    'scout_core._get_json': lambda url: scout_core._get_json(url),
    'scout_core._get_text': lambda url: scout_core._get_text(url),
    'boards.Client.get': lambda url: boards.Client(refresh=True).get(url),
}


class EveryReaderTest(PaceCase):
    def test_every_reader_takes_429_as_slow_down(self):
        for name, read in READERS.items():
            with self.subTest(reader=name):
                host_pace.FILE.unlink(missing_ok=True)
                host_pace.reset()
                Site.hits = {}
                careers.REFUSALS.clear()
                with self.assertRaises(host_pace.Busy):
                    read(self.base + '/slow')
                self.assertEqual(Site.hits['/slow'], host_pace.RETRIES + 1)
                careers.note_refusal(self.base + '/slow', host_pace.Busy(self.base, 0))
                self.assertEqual(careers.REFUSALS, {})

    def test_every_reader_still_refuses_on_403(self):
        for name, read in READERS.items():
            with self.subTest(reader=name):
                host_pace.FILE.unlink(missing_ok=True)
                host_pace.reset()
                with self.assertRaises((urllib.error.HTTPError, describe.Refused)):
                    read(self.base + '/refuse')

    def test_no_reader_names_429_or_opens_a_site_past_the_pace(self):
        """A source file under src/sources (or the scout) that has 429 as a number in its code, or calls urlopen itself, fails here.
        The exceptions are not sites we read: the user's own Google account, paid search APIs, and the app's local page renderer."""
        not_sites = {'google.py', 'google_auth.py', 'google_jobs.py', 'web_search.py', 'render.py:_through_app'}
        files = sorted((ROOT / 'src' / 'sources').glob('*.py')) + [ROOT / 'src' / 'scout_core.py', ROOT / 'src' / 'scout.py', ROOT / 'src' / 'scout_run.py']
        found = []
        for path in files:
            if path.name == 'host_pace.py':
                continue
            source = path.read_text()
            tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
            function = ''
            for index, token in enumerate(tokens):
                if token.type == tokenize.NAME and token.string == 'def' and index + 1 < len(tokens):
                    function = tokens[index + 1].string
                if token.type == tokenize.NUMBER and token.string == '429':
                    found.append(f'{path.name}:{token.start[0]} names 429 (use host_pace)')
                if (token.type == tokenize.NAME and token.string == 'urlopen' and index + 1 < len(tokens) and tokens[index + 1].string == '('
                        and path.name not in not_sites and f'{path.name}:{function}' not in not_sites):
                    found.append(f'{path.name}:{token.start[0]} calls urlopen (use host_pace.open)')
        self.assertEqual(found, [])


class BackfillTest(PaceCase):
    def db(self):
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT)')
        db.execute('CREATE TABLE jobs (id INTEGER PRIMARY KEY, url TEXT, title TEXT, location TEXT, company_id INTEGER, state TEXT, '
                   'description TEXT, first_seen_at TEXT)')
        return db

    def test_a_busy_site_waits_and_is_not_refused(self):
        db, now = self.db(), datetime.now(timezone.utc)
        db.execute("INSERT INTO jobs (url, state, first_seen_at) VALUES ('https://jobs.busy.example/1', 'open', ?)", (now.isoformat(),))
        busy = host_pace.Busy('https://jobs.busy.example/1', self.clock() + 600)

        def fetcher(url):
            raise busy
        line = describe.backfill(db, fetcher=fetcher, now=now)
        self.assertIn('waiting', line)
        self.assertNotIn('refused', line)
        self.assertNotIn('failed', line)

    def test_a_waiting_site_is_listed_with_its_next_try(self):
        db = self.db()
        now = datetime.now(timezone.utc)
        db.execute("INSERT INTO jobs (url, title, location, state, first_seen_at) VALUES ('https://jobs.busy.example/1', 'Driver', '', 'open', ?)",
                   ((now - timedelta(hours=1)).isoformat(),))
        host_pace.answer('https://jobs.busy.example/1', 429, wait=3600)
        with mock.patch('src.sources.feeds.wanted_location', return_value=True), mock.patch('src.sources.visits.dismissed', return_value=set()), \
                mock.patch.object(describe, '_refused_hosts', return_value={}):
            jobs = describe.stuck(db, now=now)
        self.assertEqual([job['url'] for job in jobs], ['https://jobs.busy.example/1'])
        self.assertGreater(jobs[0]['waiting_until'], 0)


if __name__ == '__main__':
    unittest.main()
