"""A careers page's numbered pages, and its job links over its menu links (src/sources/careers.py; 6 Oct 2026: Migros, 1,335 jobs over 67 pages,
read as 36 menu links: "Trainee", "Nachwuchsprogramme")."""
import unittest
from pathlib import Path
import sys
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import careers  # noqa: E402

BASE = 'https://jobs.example.ch/de/offene-stellen'


def listing(page, count=5, pages=4):
    menu = ''.join(f'<a href="/de/karriere/{word}">{word}</a>' for word in ('trainee', 'lehre', 'nachwuchs', 'kultur'))
    jobs = ''.join(f'<a href="/de/job/acme/vendeur/{page:04d}{i:04d}-aaaa-bbbb-cccc-dddddddddddd">Vendeur {page}.{i}</a>' for i in range(count))
    numbers = ''.join(f'<a href="{BASE}?page={n}">{n}</a>' for n in range(2, pages + 1))
    return f'<html><body><nav>{menu}</nav>{jobs}{numbers}</body></html>'


class PagingTests(unittest.TestCase):
    def test_job_links_ending_in_an_id_win_over_the_menu(self):
        links = careers.job_links(listing(1), BASE)
        self.assertEqual(len(links), 5)
        self.assertTrue(all('/job/' in link for link in links))

    def test_numbered_pages_are_read_in_order_until_one_brings_nothing_new(self):
        pages = {BASE: listing(1), f'{BASE}?page=2': listing(2), f'{BASE}?page=3': listing(2), f'{BASE}?page=4': listing(4)}
        def get(url):
            if url in pages:
                return pages[url]
            title = url.rsplit('/', 1)[1]
            return f'<html><head><title>Vendeur {title}</title></head><body><h1>Vendeur {title}</h1></body></html>'
        with mock.patch.object(careers, 'get_text', get), mock.patch.object(careers, 'renderer', lambda: None), \
                mock.patch.object(careers, '_asked', lambda url, markup, jobs, fetch: jobs):
            self.assertEqual(careers.page_links(BASE, listing(1)), [f'{BASE}?page={n}' for n in (2, 3, 4)])
            jobs = careers.fetch(careers.encode(BASE), sleep=lambda s: None)
        self.assertEqual(len(jobs), 10, 'page 1 and 2; page 3 repeats page 2, so page 4 is never asked')

    def test_at_most_max_list_pages(self):
        self.assertEqual(len(careers.page_links(BASE, listing(1, pages=200))), careers.MAX_LIST_PAGES - 1)

    def test_pages_named_by_an_offset_or_a_path_word_are_found_by_their_numbers(self):
        """24 Oct 2026: a Tallinn accountant's finance section (cv.ee, ?offset=20,40,...) and a Zagreb nurse's health section (posao.hr, /stranica/1,2,3...)
        gave their first page only: no name of ours matched the paging link. A run of numbers in one step, from one or two steps off zero, is paging."""
        offset = ''.join(f'<a href="{BASE}?offset={n}">{n}</a>' for n in (20, 40, 60, 80))
        self.assertEqual(careers.page_links(BASE, f'<html>{offset}</html>'), [f'{BASE}?offset={n}' for n in (20, 40, 60, 80)])
        words = ''.join(f'<a href="{BASE}/stranica/{n}">{n}</a>' for n in (1, 2, 3, 34))
        self.assertEqual(careers.page_links(BASE, f'<html>{words}</html>'), [f'{BASE}/stranica/{n}' for n in (2, 3)])

    def test_filters_and_categories_are_not_pages(self):
        menu = ''.join(f'<a href="{BASE}?category={n}">c{n}</a>' for n in (7, 12, 31)) + f'<a href="{BASE}/stranica/9">x</a>'
        self.assertEqual(careers.page_links(BASE, f'<html>{menu}</html>'), [])


if __name__ == '__main__':
    unittest.main()
