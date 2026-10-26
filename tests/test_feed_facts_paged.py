"""Paged sites give no tag (ETag), so a re-read asks the newest page first (src/sources/ats.py first_page): sorted newest first, the same job ids
and the same total as at the last read mean no job was added or removed, and the other pages are not read. Owner, 26 Oct 2026: Oracle, Workday
and SuccessFactors held 18,067 of the 20,699 jobs a search 7 h later still read in full."""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import ats, feed_facts  # noqa: E402


def oracle_page(ids, total):
    return {'items': [{'TotalJobsCount': total, 'requisitionList': [
        {'Id': str(i), 'Title': f'First Officer {i}', 'PostedDate': '2026-10-20', 'PrimaryLocation': 'Luxembourg',
         'ShortDescriptionStr': '', 'WorkplaceType': 'On-site'} for i in ids]}]}


class Oracle:
    """Fake data: 250 jobs, newest first, 100 a page; `added` puts a new one on top."""
    def __init__(self, added=False):
        self.ids, self.asked = ([999] if added else []) + list(range(250)), []

    def __call__(self, url):
        self.asked.append(url)
        offset = int(url.split('offset=')[1].split(',')[0])
        return oracle_page(self.ids[offset:offset + 100], len(self.ids))


def read_oracle(site, ask):
    with mock.patch.object(ats, '_json', site), mock.patch.object(ats, 'workday_terms', lambda search=None: ['pilot']), \
            ats.conditional(ask) as state:
        return ats.fetch('oracle', 'cargo.ocs.Pilots'), state


class FirstPageTest(unittest.TestCase):
    def test_an_unchanged_oracle_site_is_answered_by_its_newest_page(self):
        jobs, state = read_oracle(Oracle(), None)
        tag = feed_facts.tag_of(state)
        self.assertTrue(tag and tag.startswith('head:'), 'a paged read keeps its newest-page tag')
        again = Oracle()
        with self.assertRaises(ats.Unchanged):
            read_oracle(again, tag)
        self.assertEqual(len(again.asked), 1, 'one request instead of every page and word')

    def test_a_new_job_on_top_reads_the_whole_site(self):
        _, state = read_oracle(Oracle(), None)
        changed = Oracle(added=True)
        jobs, _ = read_oracle(changed, feed_facts.tag_of(state))
        self.assertIn('999', [job['id'] for job in jobs])
        self.assertGreater(len(changed.asked), 1)

    def test_a_job_gone_changes_the_total_and_reads_the_whole_site(self):
        _, state = read_oracle(Oracle(), None)
        fewer = Oracle()
        fewer.ids.remove(240)   # an old job closed: the newest page is the same, the total is not
        jobs, _ = read_oracle(fewer, feed_facts.tag_of(state))
        self.assertNotIn('240', [job['id'] for job in jobs])
        self.assertGreater(len(fewer.asked), 1)

    def test_a_workday_site_is_answered_by_its_newest_page(self):
        sent = []

        class Response:
            def __init__(self, body):
                self.body = body

            def read(self):
                return self.body

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def opened(request, timeout):
            sent.append(json.loads(request.data))
            offset = sent[-1]['offset']
            postings = [{'externalPath': f'/job/{i}', 'title': f'Pilot {i}', 'locationsText': 'Paris'} for i in range(45)][offset:offset + 20]
            return Response(json.dumps({'total': 45, 'jobPostings': postings}).encode())
        with mock.patch.object(ats.host_pace, 'open', opened), mock.patch.object(ats, 'workday_terms', lambda search=None: []), \
                mock.patch.dict('os.environ', {'JOB_PILOTTO_FIXTURE_DIR': ''}):
            with ats.conditional(None) as state:
                ats.fetch('workday', 'air.wd3.Careers')
            first = len(sent)
            with self.assertRaises(ats.Unchanged), ats.conditional(feed_facts.tag_of(state)):
                ats.fetch('workday', 'air.wd3.Careers')
        self.assertEqual((first, len(sent) - first), (3, 1))

    def test_a_head_tag_is_never_sent_to_a_site_as_an_etag(self):
        sent = []

        class Response:
            status, headers = 200, {}

            def read(self):
                return b'{}'

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def opened(request, timeout):
            sent.append(request.get_header('If-none-match'))
            return Response()
        with mock.patch.object(ats.host_pace, 'open', opened), mock.patch.dict('os.environ', {'JOB_PILOTTO_FIXTURE_DIR': ''}), \
                ats.conditional('head:0123456789abcdef'):
            ats._get('https://x.test/list')
        self.assertEqual(sent, [None])

    def test_outside_a_conditional_read_nothing_changes(self):
        with mock.patch.object(ats, '_json', Oracle()), mock.patch.object(ats, 'workday_terms', lambda search=None: []):
            self.assertEqual(len(ats.fetch('oracle', 'cargo.ocs.Pilots')), 200, 'its newest 200, as before')


if __name__ == '__main__':
    unittest.main()
