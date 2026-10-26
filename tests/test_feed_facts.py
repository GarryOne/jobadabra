"""A search reads an employer again only when its job list can have changed (src/sources/feed_facts.py; owner, 26 Oct 2026: "we recheck the
same employers over and over again"): judged for this search under FRESH_HOURS ago → not read; older → the site is asked "changed since?" with
the tag it gave (ETag), and a 304 skips it; a title still waiting for the AI, a changed search or new readers read it again."""
import io
import sqlite3
import sys
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import store  # noqa: E402
from src.sources import ats, feed_facts, feeds  # noqa: E402


def job(i, title='Site Reliability Engineer'):
    return {'id': str(i), 'title': title, 'location': 'Zurich, Switzerland', 'url': f'https://x.test/{i}',
            'date_posted': '', 'description': 'd', 'remote': False, 'salary': ''}


SOURCES = [{'company': f'Co{i}', 'ats': 'lever', 'slug': f's{i}'} for i in range(3)]


class Feeds:
    """A fetcher that counts reads and plays a site's tag: answers Unchanged to its own tag unless the list changed."""
    def __init__(self, lists):
        self.lists, self.reads, self.asked = lists, [], {}

    def __call__(self, source):
        ask = ats.conditional_state()
        self.asked[source['slug']] = ask.ask if ask else None
        tag = 'tag-' + '-'.join(j['id'] for j in self.lists[source['slug']])
        if ask and ask.ask == tag:
            raise ats.Unchanged(source['slug'])
        self.reads.append(source['slug'])
        if ask:
            ask.etag, ask.pages = tag, 1
        return list(self.lists[source['slug']])


def scan(db, fetcher, now, search=None):
    with mock.patch.object(feed_facts, '_now', lambda: now), mock.patch.object(feed_facts, 'search_digest', lambda: search or 'search-a'), \
            redirect_stdout(io.StringIO()) as out:
        report = feeds.scan(SOURCES, db, fetcher=fetcher, details={})
    report['said'] = out.getvalue()
    return report


class FeedFactsTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        feeds_db = self.db
        feeds_db.execute('CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))')
        self.t0 = datetime(2026, 10, 26, 1, 0, tzinfo=timezone.utc)
        self.lists = {f's{i}': [job(i * 10 + 1)] for i in range(3)}

    def test_a_second_search_within_the_fresh_hours_reads_no_judged_employer(self):
        first = Feeds(self.lists)
        scan(self.db, first, self.t0)
        self.assertEqual(sorted(first.reads), ['s0', 's1', 's2'])
        again = Feeds(self.lists)
        report = scan(self.db, again, self.t0 + timedelta(minutes=11))
        self.assertEqual(again.reads, [], 'his 01:11 run re-read 981 employers read minutes before')
        self.assertEqual(report['funnel']['employers']['unchanged'], 3)
        self.assertIn('not read again', report['said'])

    def test_an_employer_with_a_title_still_waiting_for_the_ai_is_read_again(self):
        self.lists['s1'] = [job(11, 'Kapitän der Lüfte')]   # the AI has not judged it yet; it judged the others (word hits wait for it too)
        judge = lambda jobs: feeds._triaged().update({feeds.title_key(j['title']): True for j in jobs if 'Kapit' not in j['title']})
        with mock.patch.object(feeds, 'TRIAGED', {}), mock.patch.object(feeds, 'triage', judge), mock.patch.object(feed_facts, '_triage_on', lambda: True):
            scan(self.db, Feeds(self.lists), self.t0)
            again = Feeds(self.lists)
            scan(self.db, again, self.t0 + timedelta(minutes=11))
        self.assertEqual(again.reads, ['s1'])

    def test_a_changed_search_reads_every_employer_again(self):
        scan(self.db, Feeds(self.lists), self.t0)
        again = Feeds(self.lists)
        scan(self.db, again, self.t0 + timedelta(minutes=11), search='search-b')
        self.assertEqual(sorted(again.reads), ['s0', 's1', 's2'])

    def test_after_the_fresh_hours_the_site_is_asked_and_a_304_skips_it_without_a_miss(self):
        scan(self.db, Feeds(self.lists), self.t0)
        self.lists['s2'] = [job(21), job(22)]   # one employer posted a job since
        later = Feeds(self.lists)
        report = scan(self.db, later, self.t0 + timedelta(hours=feed_facts.FRESH_HOURS, minutes=1))
        self.assertEqual(later.asked['s0'], 'tag-1')
        self.assertEqual(later.reads, ['s2'], 'only the changed list is read')
        self.assertEqual(report['funnel']['employers']['unchanged'], 2)
        self.assertEqual(sorted(j['id'] for j in report['jobs']), ['21', '22'], 'only s2 read, its whole list')
        misses = dict(self.db.execute('SELECT board, misses FROM feed_rest').fetchall())
        self.assertEqual(misses, {}, 'every employer matched: no misses, and an unchanged one never adds one')

    def test_no_tag_kept_when_a_read_took_more_than_one_page(self):
        scan(self.db, Feeds(self.lists), self.t0)
        self.db.execute("UPDATE feed_facts SET etag = NULL WHERE board = 'lever:s0'")
        later = Feeds(self.lists)
        scan(self.db, later, self.t0 + timedelta(hours=7))
        self.assertIsNone(later.asked['s0'])
        self.assertIn('s0', later.reads)

    def test_the_skipped_employers_jobs_stay_open_past_the_expiry(self):
        folder = tempfile.mkdtemp()
        canonical = store.connect(Path(folder) / 'store.sqlite')
        report = scan(self.db, Feeds(self.lists), self.t0)
        old = (self.t0 - timedelta(days=8)).isoformat(timespec='seconds')
        store.import_watch_report(canonical, report)
        canonical.execute('UPDATE jobs SET last_seen_at = ?', (old,))
        later = scan(self.db, Feeds(self.lists), self.t0 + timedelta(hours=7))
        feed_facts.keep_seen(canonical, later, now=self.t0 + timedelta(hours=7))
        self.assertEqual(store.close_stale(canonical, 7, now=self.t0 + timedelta(hours=7)), 0, 'unchanged lists still list these jobs')


class StrategyTest(unittest.TestCase):
    def test_any_change_of_the_strategy_wakes_rested_employers_and_drops_kept_facts(self):
        # Owner, 26 Oct 2026: "the websites being read should be relevant and in sync with my current strategy". The rest was keyed by
        # role words and places only: a new exclusion or remote choice kept employers resting that were judged under the old one.
        same_words = {'role_keywords': ['pilot'], 'locations': {'top_tier': ['europe']}}
        for change in ({'title_exclude_keywords': ['contract']}, {'remote_jobs': ['No']}, {'target_roles': [{'title': 'first officer'}]}):
            with self.subTest(change=change):
                self.assertNotEqual(feeds._search_digest(same_words), feeds._search_digest({**same_words, **change}))
        with mock.patch.object(feeds, '_SEARCH', same_words):
            self.assertEqual(feed_facts.search_digest(), feeds._search_digest(), 'one key: the rest and the unchanged facts')


class ConditionalGetTest(unittest.TestCase):
    def test_a_304_raises_unchanged_and_a_single_page_keeps_its_tag(self):
        class Response:
            status, headers = 200, {'ETag': 'W/"abc"'}

            def read(self):
                return b'{"jobs": []}'

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False
        sent = []

        def opened(request, timeout):
            sent.append(request.get_header('If-none-match'))
            if request.get_header('If-none-match') == 'W/"abc"':
                raise urllib.error.HTTPError(request.full_url, 304, 'Not Modified', {}, None)
            return Response()
        with mock.patch.object(ats.host_pace, 'open', opened), mock.patch.dict('os.environ', {'JOB_PILOTTO_FIXTURE_DIR': ''}):
            with ats.conditional(None) as state:
                ats._get('https://boards-api.greenhouse.io/v1/boards/x/jobs')
            self.assertEqual((state.etag, state.pages), ('W/"abc"', 1))
            with self.assertRaises(ats.Unchanged), ats.conditional('W/"abc"'):
                ats._get('https://boards-api.greenhouse.io/v1/boards/x/jobs')
            with ats.conditional(None) as state:
                ats._get('https://x.test/page1')
                ats._get('https://x.test/page2')
            self.assertEqual(state.pages, 2)
            self.assertIsNone(feed_facts.tag_of(state), 'a paged read keeps no tag: its first page says nothing about the others')
        self.assertEqual(sent, [None, 'W/"abc"', None, None])


if __name__ == '__main__':
    unittest.main()
