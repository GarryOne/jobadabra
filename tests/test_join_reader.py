"""The JOIN reader (src/sources/ats.py join) reads both page shapes: the jobs under pageProps.initialState (older pages) and under
pageProps.pageData (since about Oct 2026). 26 Oct 2026: 66 of the owner's 70 JOIN employers failed with KeyError 'initialState' on every search."""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import ats  # noqa: E402


def page(where, items, page_no, page_count):
    jobs = {'items': items, 'pagination': {'page': page_no, 'pageCount': page_count, 'perPage': 5, 'total': 7}}
    props = {'initialProps': {}, 'initialState': {'jobs': jobs}} if where == 'initialState' else \
        {'locale': 'en', 'pageData': {'job': None, 'jobs': jobs, 'company': {'name': 'Acme AG'}}}
    data = {'props': {'pageProps': props}, 'page': '/companies/[companySlug]/_dynamic'}
    return f'<html><script id="__NEXT_DATA__" type="application/json">{json.dumps(data)}</script></html>'.encode()


def item(n):
    return {'idParam': f'{n}-buchhalter', 'id': n, 'remoteType': None, 'title': f'Buchhalter {n}', 'createdAt': '2026-10-20T08:00:00.000Z',
            'workplaceType': 'ONSITE', 'city': {'cityName': 'Gossau', 'countryName': 'Switzerland'}}


class JoinShapesTest(unittest.TestCase):
    def read(self, where):
        pages = {1: page(where, [item(n) for n in range(5)], 1, 2), 2: page(where, [item(n) for n in range(5, 7)], 2, 2)}
        asked = []

        def get(url, **kwargs):
            asked.append(url)
            return pages[int(url.split('page=')[1])]
        with mock.patch.object(ats, '_get', get):
            return ats.join('acme-ag'), asked

    def test_both_page_shapes_give_every_job_on_every_page(self):
        for where in ('initialState', 'pageData'):
            with self.subTest(where=where):
                jobs, asked = self.read(where)
                self.assertEqual(len(asked), 2)
                self.assertEqual([job['title'] for job in jobs], [f'Buchhalter {n}' for n in range(7)])
                self.assertEqual(jobs[0]['location'], 'Gossau, Switzerland')
                self.assertEqual(jobs[0]['url'], 'https://join.com/companies/acme-ag/0-buchhalter')

    def test_a_page_with_neither_shape_is_a_failed_read_not_an_empty_employer(self):
        """An empty list would read as "no jobs" and close the employer's open jobs; a page we cannot read must fail loudly."""
        odd = b'<script id="__NEXT_DATA__" type="application/json">{"props": {"pageProps": {"somethingElse": {}}}}</script>'
        with mock.patch.object(ats, '_get', lambda url, **kwargs: odd), self.assertRaises(Exception):
            ats.join('acme-ag')


class BrokenReaderLineTest(unittest.TestCase):
    """The central scout names a reader that broke (src/scout_index.py published_line), so a site's new page shape is fixed in a day, not found
    by chance in a user's search."""
    def test_a_system_failing_with_one_error_is_named_and_scattered_dead_feeds_are_not(self):
        from src.scout_index import published_line
        failed = [{'ats': 'join', 'slug': f'c{n}', 'error': "KeyError: 'initialState'"} for n in range(66)] + \
                 [{'ats': 'greenhouse', 'slug': f'g{n}', 'error': f'HTTPError: HTTP Error 404: Not Found {n}'} for n in range(6)]
        kept = [{'ats': 'join'}] * 70 + [{'ats': 'greenhouse'}] * 220   # carried feeds count too: a fully broken reader with carry is at 50%
        line = published_line(400, failed, kept)
        self.assertIn('(72 did not answer: join 66, greenhouse 6)', line)
        self.assertIn("::warning::Scout: the join reader looks broken: 66 of its 136 feeds failed with \"KeyError: 'initialState'\"", line)
        self.assertNotIn('greenhouse reader', line, '6 dead boards among 226 are dead feeds, not a broken reader')
        self.assertEqual(published_line(10, [], [{'ats': 'join'}]), 'Published 10 feeds to the employer index (0 did not answer)')


if __name__ == '__main__':
    unittest.main()
