"""SmartRecruiters lists postings without a description: the scan fetches it for the jobs it keeps, so they get
stage 1 facts and a fit score (Canva's and Delivery Hero's jobs had stayed unscored)."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.sources import feeds, host_pace, visits


def own_pace(test):
    """Point the learned pace of sites at a temp file for one test.
    Why (31 Oct 2026, a8): the 403 from shop.test taught host_pace a pause and wrote it to the real data/host_pace.json; a later run (or a parallel one) read that
    pause as if its own 403 had just happened and listed or skipped jobs by it. Measured: the file survived runs and flipped test_stuck_jobs when the clock was set earlier."""
    tmp = tempfile.TemporaryDirectory()
    test.addCleanup(tmp.cleanup)
    patch = mock.patch.object(host_pace, 'FILE', Path(tmp.name) / 'host_pace.json')
    patch.start()
    test.addCleanup(patch.stop)
    host_pace.reset()
    test.addCleanup(host_pace.reset)


class FeedDetailsTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))')

    def test_description_fetched_for_kept_jobs_only(self):
        jobs = [{'id': '1', 'title': 'Site Reliability Engineer', 'location': 'Zurich, ch', 'url': 'https://x/1', 'description': '', 'remote': False},
                {'id': '2', 'title': 'Pastry Chef', 'location': 'Zurich, ch', 'url': 'https://x/2', 'description': '', 'remote': False},
                {'id': '3', 'title': 'Platform Engineer', 'location': 'Zurich, ch', 'url': 'https://x/3', 'description': '', 'remote': False}]
        asked = []

        def detail(slug, job_id):
            asked.append((slug, job_id))
            if job_id == '3':
                raise TimeoutError('slow')
            return f'The {job_id} job: Kubernetes, on-call.'

        source = {'company': 'Canva', 'ats': 'smartrecruiters', 'slug': 'canva'}
        report = feeds.scan([source], self.db, fetcher=lambda s: jobs, details={'smartrecruiters': detail})
        kept = {job['id']: job['description'] for job in report['jobs']}
        self.assertNotIn('2', kept)  # filtered out: no detail fetched for it
        self.assertEqual(kept['1'], 'The 1 job: Kubernetes, on-call.')
        self.assertEqual(kept['3'], '')  # its fetch failed; the job is still kept
        self.assertEqual(sorted(asked), [('canva', '1'), ('canva', '3')])


if __name__ == '__main__':
    unittest.main()


class DescriptionBackfillTest(unittest.TestCase):
    def test_missing_descriptions_are_fetched_again_each_run(self):
        from datetime import datetime, timedelta, timezone
        from src.sources import describe
        db = sqlite3.connect(':memory:')
        db.execute("CREATE TABLE jobs (id INTEGER PRIMARY KEY, url TEXT, state TEXT, description TEXT, first_seen_at TEXT)")
        now = datetime.now(timezone.utc)   # clock: relative: the rows and the call under test share this one `now`
        recent, old = now.isoformat(timespec='seconds'), (now - timedelta(days=30)).isoformat(timespec='seconds')
        db.executemany('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)', [
            (1, 'https://jobs.smartrecruiters.com/canva/1', 'open', '', recent),
            (2, 'https://www.jobs.ch/en/vacancies/detail/2/', 'open', None, recent),
            (3, 'https://x/3', 'open', 'Already here', recent),
            (4, 'https://x/4', 'closed', '', recent),
            (5, 'https://x/5', 'open', '', old)])
        import urllib.error
        gone = urllib.error.HTTPError('https://x', 404, 'Not Found', {}, None)
        db.execute("INSERT INTO jobs VALUES (6, 'https://www.jobs.ch/en/vacancies/detail/6/', 'open', '', ?)", (recent,))
        pages = {'https://jobs.smartrecruiters.com/canva/1': 'Run Kubernetes.', 'https://www.jobs.ch/en/vacancies/detail/2/': TimeoutError('slow'),
                 'https://www.jobs.ch/en/vacancies/detail/6/': gone}

        def fetcher(url):
            answer = pages[url]
            if isinstance(answer, Exception):
                raise answer
            return answer

        self.assertEqual(describe.backfill(db, fetcher=fetcher), 'Descriptions: read 1 of 3 missing job texts, 1 posting(s) taken down (closed), 1 failed (tried again next time)')
        self.assertEqual(db.execute('SELECT state FROM jobs WHERE id=6').fetchone()[0], 'expired')
        self.assertEqual(db.execute('SELECT description FROM jobs WHERE id=1').fetchone()[0], 'Run Kubernetes.')
        self.assertEqual(describe.SMARTRECRUITERS.search('https://jobs.smartrecruiters.com/canva/6000000001379105').groups(),
                         ('canva', '6000000001379105'))


class TechTreeDescriptionTest(unittest.TestCase):
    """TechTree's list page has no posting text, so every TechTree job came without one and stayed unscored ("–", 6 Oct 2026)."""

    PAGE = ('<html><nav class="menu">All jobs About us</nav><div class="mt-3"><div class="mt-12 prose prose-base max-w-none">'
            '<h2>About the company</h2><p>We run <b>warehouses</b> &amp; retail.</p><div><ul><li>Lead sales</li><li>Travel<br>often</li></ul></div>'
            '</div><footer>© TechTree</footer></div></html>')

    def test_the_posting_text_is_read_from_its_page(self):
        from src.sources import describe
        self.assertEqual(describe.techtree_text(self.PAGE), 'About the company We run warehouses & retail. Lead sales Travel often')
        self.assertEqual(describe.techtree_text('<p>no prose block</p>'), '')

        class Pages:
            def get(self, url):
                return {'html': TechTreeDescriptionTest.PAGE}
        self.assertTrue(describe.fetch('https://jobs.techtree.dev/job/c5ee88e9', client=Pages()).startswith('About the company'))

    def test_any_site_is_read_and_a_refusal_or_sign_in_site_is_left_for_your_browser(self):
        """7 Oct 2026: only three kinds of sites had a reader, so "can't be read" named sites that were never even asked."""
        from datetime import datetime, timezone
        from unittest import mock
        import tempfile, pathlib
        from src.sources import describe
        db = sqlite3.connect(':memory:')
        db.execute("CREATE TABLE jobs (id INTEGER PRIMARY KEY, url TEXT, state TEXT, description TEXT, first_seen_at TEXT)")
        now = datetime.now(timezone.utc)   # clock: relative: the rows and the call under test share this one `now`
        rows = [(1, 'https://jobs.techtree.dev/job/1'), (2, 'https://careers.example.com/job/2'), (3, 'https://ch.linkedin.com/jobs/view/3'),
                (4, 'https://career.hm.com/job/4')]
        db.executemany('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)', [(i, url, 'open', '', now.isoformat(timespec='seconds')) for i, url in rows])

        def page_text(url, opener=None):
            if 'hm.com' in url:
                raise describe.Refused('HTTP 403')
            return 'A posting about selling watches in Geneva. ' * 20
        with mock.patch.object(describe.boards, 'Client') as client, mock.patch.object(describe, 'page_text', page_text), \
                mock.patch('src.paths.DATA', pathlib.Path(tempfile.mkdtemp())), mock.patch.object(visits, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 'visits.json'):
            client.return_value.get.return_value = {'html': self.PAGE}
            line = describe.backfill(db, now=now)
            self.assertEqual(line, 'Descriptions: read 2 of 4 missing job texts, 1 refused by career.hm.com, 1 on sign-in sites (ch.linkedin.com)'
                                   ' → readable in your browser (Actions, Find jobs using your browser)')
            db.execute("UPDATE jobs SET description='' WHERE id IN (1, 2)")
            calls = []
            with mock.patch.object(describe, 'page_text', lambda url, opener=None: calls.append(url) or 'x' * 500):
                describe.backfill(db, now=now)
            self.assertNotIn('https://career.hm.com/job/4', calls, 'a site that refused is not asked again for a week')
            self.assertNotIn('https://ch.linkedin.com/jobs/view/3', calls, 'a sign-in site is never fetched')


class AnyPostingPageTest(unittest.TestCase):
    """The posting text from any page: Workday's JSON, a page's schema.org JobPosting, else its main text; a refusal is respected."""

    def setUp(self):
        own_pace(self)

    class Opener:
        def __init__(self, pages):
            self.pages, self.asked = pages, []

        def __call__(self, request, timeout=0):
            import io, urllib.error
            self.asked.append(request.full_url)
            answer = self.pages[request.full_url]
            if isinstance(answer, int):
                raise urllib.error.HTTPError(request.full_url, answer, 'no', {}, None)
            body = io.BytesIO(answer.encode())
            body.__enter__, body.__exit__ = lambda: body, lambda *a: False
            return body

    def test_each_kind_of_page(self):
        import json
        from src.sources import describe
        long = 'You advise customers in our Geneva boutique and keep the shelves tidy. ' * 10
        workday = 'https://richemont.wd3.myworkdayjobs.com/en-US/Richemont/job/Geneva/Sales-Associate_R123'
        pages = {'https://richemont.wd3.myworkdayjobs.com/wday/cxs/richemont/Richemont/job/Geneva/Sales-Associate_R123':
                 json.dumps({'jobPostingInfo': {'jobDescription': f'<p>{long}</p>'}}),
                 'https://shop.test/schema': '<script type="application/ld+json">' + json.dumps({'@type': 'JobPosting', 'title': 'Seller',
                                                                                                  'description': f'<p>{long}</p>'}) + '</script>',
                 'https://shop.test/plain': f'<html><header>Menu Jobs About</header><main><h1>Seller</h1><p>{long}</p></main><footer>© Shop</footer></html>',
                 'https://shop.test/cookies': '<html><body><p>We use cookies.</p></body></html>',
                 'https://shop.test/forbidden': 403,
                 'https://shop.test/check': '<html><body><h1>Just a moment...</h1><p>Verify you are human</p></body></html>'}
        opener = self.Opener(pages)
        self.assertTrue(describe.page_text(workday, opener).startswith('You advise customers'), 'Workday: its own JSON')
        self.assertTrue(describe.page_text('https://shop.test/schema', opener).startswith('You advise customers'), 'schema.org JobPosting')
        plain = describe.page_text('https://shop.test/plain', opener)
        self.assertTrue(plain.startswith('Seller You advise'), 'the main text')
        self.assertNotIn('Menu Jobs About', plain)
        self.assertEqual(describe.page_text('https://shop.test/cookies', opener), '', 'too short to be a posting')
        for url in ('https://shop.test/forbidden', 'https://shop.test/check'):
            with self.assertRaises(describe.Refused, msg=url):
                describe.page_text(url, opener)
        self.assertFalse(describe.readable('https://www.glassdoor.ch/job/1'))
        self.assertTrue(describe.readable('https://bulgari.recruitmentplatform.com/job/1'))


class BrowserJobsTests(unittest.TestCase):
    """Jobs whose text only a browser can read (8 Oct 2026): listed for the extension, and its text saved for the job."""
    def setUp(self):
        own_pace(self)

    def test_stuck_jobs_and_a_saved_text(self):
        from datetime import datetime, timedelta, timezone
        from unittest import mock
        from src.sources import describe, feeds
        db = sqlite3.connect(':memory:')
        db.execute("CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT)")
        db.execute("CREATE TABLE jobs (id INTEGER PRIMARY KEY, url TEXT, title TEXT, location TEXT, company_id INTEGER, state TEXT, description TEXT, first_seen_at TEXT)")
        now = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)
        old, fresh = (now - timedelta(hours=8)).isoformat(), (now - timedelta(hours=1)).isoformat()
        db.executemany('INSERT INTO jobs (url, title, location, company_id, state, description, first_seen_at) VALUES (?, ?, ?, NULL, ?, ?, ?)', [
            ('https://ch.indeed.com/viewjob?jk=1', 'Vendeur', 'Genève', 'open', '', fresh),        # a sign-in site: at once
            ('https://bulgari.recruitmentplatform.com/job/2', 'Sales', 'Genève', 'open', '', old),  # tried for 8 h, no text
            ('https://shop.test/job/3', 'Vendeur', 'Genève', 'open', '', fresh),                   # tried 1 h ago: the reader goes on
            ('https://shop.test/job/4', 'Vendeur', 'Zürich', 'open', '', old),                     # outside your places
            ('https://shop.test/job/5', 'Vendeur', 'Genève', 'open', 'text', old)])
        from src.sources import visits
        with mock.patch.object(feeds, 'wanted_location', lambda job: job['location'] == 'Genève'), mock.patch.object(describe, '_refused_hosts', lambda now: {}):
            with mock.patch.object(visits, 'dismissed', lambda: set()):
                urls = [job['url'] for job in describe.stuck(db, now=now)]
            with mock.patch.object(visits, 'dismissed', lambda: {'https://ch.indeed.com/viewjob?jk=1'}):
                kept = [job['url'] for job in describe.stuck(db, now=now)]
        self.assertEqual(sorted(urls), ['https://bulgari.recruitmentplatform.com/job/2', 'https://ch.indeed.com/viewjob?jk=1'])
        self.assertEqual(kept, ['https://bulgari.recruitmentplatform.com/job/2'], 'a job you dismissed is not offered again')
        self.assertFalse(describe.save_text(db, 'https://ch.indeed.com/viewjob?jk=1', 'Sign in to continue'), 'too short: not a posting')
        self.assertTrue(describe.save_text(db, 'https://ch.indeed.com/viewjob?jk=1', 'You advise customers in our Geneva shop. ' * 10))
        self.assertTrue(db.execute("SELECT description FROM jobs WHERE id = 1").fetchone()[0].startswith('You advise'))

    def test_one_posting_under_two_addresses_is_one_row_and_its_text_fills_both(self):
        # 8 Oct 2026: Bulgari's ?jobId=1091811 and ?jobId=1091811&jobTitle=CLIENT%20ADVISOR were two rows of "Jobs we couldn't read".
        from datetime import datetime, timedelta, timezone
        from unittest import mock
        from src.sources import describe, feeds, visits
        self.assertTrue(describe.same_posting('https://x.test/details.html?jobId=1', 'https://x.test/details.html?jobId=1&jobTitle=A'))
        self.assertFalse(describe.same_posting('https://x.test/details.html?jobId=1', 'https://x.test/details.html?jobId=2'), 'another posting')
        self.assertFalse(describe.same_posting('https://x.test/a?jobId=1', 'https://y.test/a?jobId=1'), 'another site')
        db = sqlite3.connect(':memory:')
        db.execute("CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT)")
        db.execute("CREATE TABLE jobs (id INTEGER PRIMARY KEY, url TEXT, title TEXT, location TEXT, company_id INTEGER, state TEXT, description TEXT, first_seen_at TEXT)")
        now = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)
        old = (now - timedelta(hours=8)).isoformat()
        db.executemany('INSERT INTO jobs (url, title, location, company_id, state, description, first_seen_at) VALUES (?, ?, ?, NULL, ?, ?, ?)', [
            ('https://x.test/details.html?jobId=1&jobTitle=CLIENT%20ADVISOR', 'CLIENT ADVISOR', 'Genève', 'open', '', old),
            ('https://x.test/details.html?jobId=1', 'CLIENT ADVISOR', 'Genève', 'open', '', old),
            ('https://x.test/details.html?jobId=2', 'Store Manager', 'Genève', 'open', '', old)])
        with mock.patch.object(feeds, 'wanted_location', lambda job: True), mock.patch.object(describe, '_refused_hosts', lambda now: {}), \
                mock.patch.object(visits, 'dismissed', lambda: set()):
            self.assertEqual(len(describe.stuck(db, now=now)), 2, 'one row per posting')
            self.assertTrue(describe.save_text(db, 'https://x.test/details.html?jobId=1', 'You advise clients in our Geneva boutique. ' * 10))
            self.assertEqual([job['title'] for job in describe.stuck(db, now=now)], ['Store Manager'], 'both addresses of the posting got its text')
