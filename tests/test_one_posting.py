"""A listing's linked pages become jobs only when the AI judges each one posting (src/sources/one_posting.py, careers.read_page_from).
26 Oct 2026: a proof run stored a board's "About Us", "Contact Us", "Privacy Policy" and a "3,531 Assistant Psychology jobs" category as jobs."""
import functools
import json
import sqlite3
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import decide  # noqa: E402
from src.sources import careers, found_boards, one_posting  # noqa: E402

BASE = 'https://jobs.example.org'
POSTING = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': 'Assistant Psychologist', 'url': f'{BASE}/job/77001',
           'jobLocation': {'address': {'addressLocality': 'Dublin', 'addressCountry': 'IE'}}}


def doc(heading, text):
    return f'<html><head><title>{heading} | Example Jobs</title></head><body><nav><a href="/">Home</a></nav><h1>{heading}</h1><p>{text}</p></body></html>'


# The shapes (irishjobs.ie and itjobswatch.co.uk, 26 Oct 2026): a site-nav page and a footer page under the board's job paths, a category
# with a count, a salary-filter page of the same search, a market-statistics page; a real posting with no job data (must stay) and one with
# job data (stays, not asked).
PAGES = {
    f'{BASE}/jobs/about': doc('About Us', 'Example Jobs has helped people find work in Ireland since 1999. Our team, our story.'),
    f'{BASE}/jobs/privacy-policy': doc('Privacy Policy', 'How we use your personal data, cookies and your rights.'),
    f'{BASE}/jobs/assistant-psychology': doc('3,531 Assistant Psychology jobs', 'Sort by relevance. Assistant Psychologist, Cork. Psychology '
                                             'Assistant, Galway. Trainee Assistant Psychologist, Dublin. Next page.'),
    f'{BASE}/jobs/assistant-psychologist?salary=30000': doc('212 Assistant Psychologist jobs', 'Salary from 30,000. Assistant Psychologist, '
                                                            'Limerick. Senior Assistant Psychologist, Dublin.'),
    f'{BASE}/jobs/uk/psychology.do': doc('Psychology Jobs, Average Salaries and Trends', 'Median annual salary 38,000. Demand trend '
                                         'over 6 months. Rank change.'),
    f'{BASE}/job/77002-assistant-psychologist-cork': doc('Assistant Psychologist', 'Cork. Full time, permanent. The HSE seeks an assistant '
                                                         'psychologist for its primary care team. Apply now with your CV.'),
    f'{BASE}/job/77001': f'<html><body><script type="application/ld+json">{json.dumps(POSTING)}</script></body></html>',
}
REAL = {f'{BASE}/job/77002-assistant-psychologist-cork', f'{BASE}/job/77001'}
JUNK = set(PAGES) - REAL
LISTING = ('<html><body><header><a href="/jobs/about">About Us</a></header><ul>'
           '<li><a href="/jobs/assistant-psychology">3,531 Assistant Psychology jobs</a></li>'
           '<li><a href="/jobs/assistant-psychologist?salary=30000">30,000+</a></li>'
           '<li><a href="/jobs/uk/psychology.do">Psychology salary trends</a></li>'
           '<li><a href="/job/77002-assistant-psychologist-cork">Assistant Psychologist</a></li>'
           '<li><a href="/job/77001">Assistant Psychologist</a></li></ul>'
           '<footer><a href="/jobs/privacy-policy">Privacy Policy</a></footer></body></html>')
PAGES[f'{BASE}/search?q=assistant+psychologist'] = LISTING


def fetch(url):
    if url not in PAGES:
        raise OSError(f'no page {url}')
    return PAGES[url]


class FakeModel:
    """The model's stand-in: answers each item by its address, as a model reading the page would; counts what it was asked."""
    def __init__(self, fail=False):
        self.asked, self.fail = [], fail
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        if self.fail:
            raise RuntimeError('busy')
        items = kwargs['messages'][0]['content'].split('### Item ')[1:]
        addresses = [item.split('Address: ', 1)[1].split('\n', 1)[0] for item in items]
        self.asked += addresses
        results = [{'index': i, 'answer': 'one_posting' if a in REAL else 'other'} for i, a in enumerate(addresses)]
        return SimpleNamespace(stop_reason='end_turn', usage=None, content=[SimpleNamespace(type='text', text=json.dumps({'results': results}))])


class OnePostingTests(unittest.TestCase):
    def setUp(self):
        decide._calls['n'] = one_posting._asks['n'] = 0
        self.reader = careers.READER
        careers.READER = lambda url, markup, **kw: None   # an AI page reader is there (it reads nothing): the AI judges
        self.addCleanup(setattr, careers, 'READER', self.reader)

    def judged_by(self, model):
        return mock.patch.object(decide, 'decide', functools.partial(decide.decide, client=model, db=sqlite3.connect(':memory:')))

    def test_the_listings_links_must_find_every_shape_first(self):
        # positive control: the rules pick all four pages, so the judgment below is what drops the junk
        self.assertEqual(set(careers.job_links(LISTING, f'{BASE}/search')) & set(PAGES), JUNK | REAL)

    def test_every_reader_of_a_listing_keeps_only_postings(self):
        board = {'name': 'Example Jobs', 'host': 'jobs.example.org', 'search_url': f'{BASE}/search?q={{role}}'}
        readers = {
            'read_page_from': lambda: careers.read_page_from(LISTING, f'{BASE}/search?q=assistant+psychologist', fetch),
            'read_page': lambda: careers.read_page(f'{BASE}/search?q=assistant+psychologist', fetch),
            'board read': lambda: found_boards._read(board, {}, fetch, None, True)[0],
        }
        for name, read in readers.items():
            with self.subTest(name), mock.patch.object(found_boards, '_terms', return_value=['assistant psychologist']), \
                    mock.patch.object(found_boards, '_places', return_value=['']), self.judged_by(model := FakeModel()):
                self.assertEqual({job['url'] for job in read()}, REAL)
                self.assertNotIn(f'{BASE}/job/77001', model.asked)   # declared JobPosting data is not asked

    def test_a_failed_ai_leaves_pages_unjudged_never_kept_on_a_guess(self):
        with self.judged_by(FakeModel(fail=True)):
            found = careers.read_page_from(LISTING, f'{BASE}/search', fetch)
        self.assertEqual({job['url'] for job in found}, {f'{BASE}/job/77001'})

    def test_with_the_page_reader_off_nothing_is_asked_and_pages_stand(self):
        careers.READER = None   # no AI page reader (none, or switched off): the pages stand, as before
        with self.judged_by(model := FakeModel()):
            found = careers.read_page_from(LISTING, f'{BASE}/search', fetch)
        self.assertEqual(model.asked, [])
        self.assertEqual({job['url'] for job in found}, JUNK | REAL)

    def test_past_its_cap_only_answers_kept_earlier_count_and_the_model_is_not_asked(self):
        db = sqlite3.connect(':memory:')
        with mock.patch.object(decide, 'decide', functools.partial(decide.decide, client=FakeModel(), db=db)):
            careers.read_page_from(LISTING, f'{BASE}/search', fetch)   # judged once, kept per address
        self.assertEqual(one_posting._asks['n'], 1)
        one_posting._asks['n'] = one_posting.MAX_ASKS
        PAGES[f'{BASE}/job/77003-trainee-assistant-psychologist'] = doc('Trainee Assistant Psychologist', 'Galway. Apply by 1 December.')
        self.addCleanup(PAGES.pop, f'{BASE}/job/77003-trainee-assistant-psychologist')
        listing = LISTING.replace('</ul>', '<li><a href="/job/77003-trainee-assistant-psychologist">Trainee</a></li></ul>')
        with mock.patch.object(decide, 'decide', functools.partial(decide.decide, client=(model := FakeModel()), db=db)):
            found = careers.read_page_from(listing, f'{BASE}/search', fetch)
        self.assertEqual(model.asked, [])
        self.assertEqual({job['url'] for job in found}, REAL)   # the new page is unjudged: not kept this run

    def test_the_question_carries_heading_address_and_text_with_fixed_answers(self):
        seen = {}
        one_posting.kept([{'title': 'About Us', 'url': f'{BASE}/about', 'description': 'Our story'}], True,
                         judge=lambda topic, items, answers, task, ask: seen.update(topic=topic, items=items, answers=answers) or {})
        self.assertEqual((seen['topic'], seen['answers']), ('one-posting', ('one_posting', 'other')))
        self.assertIn('Heading: About Us', seen['items'][f'{BASE}/about'])
        self.assertIn('Text: Our story', seen['items'][f'{BASE}/about'])


if __name__ == '__main__':
    unittest.main()
