"""Employers with no job-system feed (src/sources/careers.py), the extra job systems, and the Swiss catalogs the scout reads."""
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import scout, scout_candidates  # noqa: E402
from src.sources import ats, careers, render  # noqa: E402

POSTING = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': 'Site Reliability Engineer', 'datePosted': '2026-10-01',
           'description': '<p>Run our <b>Kubernetes</b> platform.</p>', 'url': '/jobs/sre-1',
           'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Zürich', 'addressCountry': 'CH'}},
           'baseSalary': {'currency': 'CHF', 'value': {'minValue': 120000, 'maxValue': 150000}}}


def page(*postings, body=''):
    blocks = ''.join(f'<script type="application/ld+json">{json.dumps(p)}</script>' for p in postings)
    return f'<html><body>{body}{blocks}</body></html>'


def site(pages):
    """A fetch function over a dict of address -> html (anything else fails like an unreachable page)."""
    def fetch(url):
        if url not in pages:
            raise OSError(f'no page {url}')
        return pages[url]
    return fetch


class SlugTests(unittest.TestCase):
    def test_an_address_travels_as_a_word_character_slug_and_back(self):
        slug = careers.encode('https://www.acme.ch/en/careers?x=1')
        self.assertEqual(slug, 'www.acme.ch__en__careers')
        self.assertEqual(careers.decode(slug), 'https://www.acme.ch/en/careers')
        self.assertEqual(careers.decode(careers.encode('https://acme.ch')), 'https://acme.ch/')
        with self.assertRaises(ValueError):
            careers.encode('https://acme.ch/' + 'a' * 200)
        with self.assertRaises(ValueError):
            careers.decode('x/../etc')


class ReadingTests(unittest.TestCase):
    def test_job_data_on_a_page_becomes_jobs_with_place_salary_and_plain_text(self):
        job, = careers.jsonld_jobs(page(POSTING), 'https://acme.ch/careers')
        self.assertEqual((job['title'], job['location'], job['date_posted'], job['url']),
                         ('Site Reliability Engineer', 'Zürich, Switzerland', '2026-10-01', 'https://acme.ch/jobs/sre-1'))
        self.assertEqual((job['description'], job['salary']), ('Run our Kubernetes platform.', 'CHF 120000–150000'))

    def test_an_address_given_as_a_list_or_a_bare_place_does_not_crash(self):
        addr = {'@type': 'PostalAddress', 'addressLocality': 'Zürich', 'addressCountry': 'CH'}
        for places in ([addr], {'address': [addr]}, [{'address': [addr, addr]}], ['Zürich'], [None], [{'address': 5}]):
            jobs = careers.jsonld_jobs(page({**POSTING, 'jobLocation': places}), 'https://acme.ch/')
            self.assertEqual(len(jobs), 1)
        job, = careers.jsonld_jobs(page({**POSTING, 'jobLocation': {'address': [addr]}}), 'https://acme.ch/')
        self.assertEqual(job['location'], 'Zürich, Switzerland')
        # 7 Oct 2026: a site's addressLocality was a list, and the TypeError ended a whole Find new employers run at 90 of 91.
        listed = {'@type': 'PostalAddress', 'addressLocality': ['Bern', 'Basel'], 'addressCountry': [{'name': 'CH'}]}
        job, = careers.jsonld_jobs(page({**POSTING, 'jobLocation': {'address': listed}}), 'https://acme.ch/')
        self.assertEqual(job['location'], 'Bern, Basel, Switzerland')

    def test_postings_inside_a_graph_and_bad_json_are_handled(self):
        markup = page({'@graph': [{'@type': 'WebSite'}, POSTING]}) + '<script type="application/ld+json">{broken</script>'
        self.assertEqual(len(careers.jsonld_jobs(markup, 'https://acme.ch/')), 1)

    def test_a_listing_without_data_is_read_through_its_job_pages(self):
        listing = '<a href="/jobs/sre-1">SRE</a><a href="/about">About</a><a href="/jobs/dev-2">Dev</a>'
        pages = {'https://acme.ch/careers': listing, 'https://acme.ch/jobs/sre-1': page(POSTING),
                 'https://acme.ch/jobs/dev-2': page({**POSTING, 'title': 'Developer', 'url': '/jobs/dev-2'})}
        jobs = careers.read_page('https://acme.ch/careers', site(pages))
        self.assertEqual(sorted(j['title'] for j in jobs), ['Developer', 'Site Reliability Engineer'])

    def test_a_job_system_embedded_in_a_page_is_recognised(self):
        self.assertEqual(careers.embedded_system('<iframe src="https://boards.greenhouse.io/embed/job_board?for=acme"></iframe>'), ('greenhouse', 'acme'))
        self.assertEqual(careers.embedded_system('<a href="https://acme.teamtailor.com/jobs">Jobs</a>'), ('teamtailor', 'acme'))
        self.assertIsNone(careers.embedded_system('<a href="https://example.org">x</a>'))

    def test_only_public_addresses_are_fetched(self):
        for bad in ('http://127.0.0.1/', 'http://localhost/x', 'file:///etc/passwd', 'ftp://acme.ch/'):
            with self.assertRaises(ValueError):
                careers.get_text(bad)


MENU = (('trainee', 'Trainee Store Manager'), ('quereinstieg', 'Sales Assistant career change'), ('nachwuchs', 'Junior Department Manager'))
KINDS = ('Alimentaire', 'Produits Laitiers', 'Non alimentaire', 'Boulangerie')


class DiscoverTests(unittest.TestCase):
    def test_home_page_to_careers_page_with_job_data(self):
        pages = {'https://acme.ch': '<a href="/en/careers">Careers</a><a href="/contact">Contact</a>',
                 'https://acme.ch/en/careers': page(POSTING)}
        found = careers.discover('acme.ch', site(pages))
        self.assertEqual((found['ats'], found['slug'], len(found['jobs'])), ('careers', 'acme.ch__en__careers', 1))

    def test_a_careers_menu_is_passed_for_the_list_of_jobs_one_link_deeper(self):
        # 7 Oct 2026: jobs.migros.ch's landing page linked "trainee", "career changers"... (no job id) and was taken for the job list;
        # its jobs (Geneva saleswomen) were one link deeper, on "offene Stellen", each ending in a job id.
        menu = ''.join(f'<a href="/de/karriere/{name}">{title}</a>' for name, title in MENU)
        jobs = ''.join(f'<a href="/fr/job/migros-geneve/vendeuse-{n}/39cc4566-19a5-455a-a125-dc8a0258caa{n}">Vendeuse spécialisée {kind} (F/H/D)</a>' for n, kind in enumerate(KINDS))
        pages = {'https://jobs.migros.example': '<a href="/de">Karriere</a>',   # as on the real site: the first careers link is the menu page
                 'https://jobs.migros.example/de': menu + '<a href="/de/offene-stellen">Offene Stellen</a>',
                 'https://jobs.migros.example/de/offene-stellen': '<h1>Offene Stellen</h1>' + jobs}
        for n in range(4):
            pages[f'https://jobs.migros.example/fr/job/migros-geneve/vendeuse-{n}/39cc4566-19a5-455a-a125-dc8a0258caa{n}'] = page(
                {**POSTING, 'title': f'Vendeuse spécialisée {KINDS[n]} (F/H/D)', 'url': f'/fr/job/migros-geneve/vendeuse-{n}/39cc4566-19a5-455a-a125-dc8a0258caa{n}'})
        for name, title in MENU:   # career pages whose data reads like a job: what made the landing page look like a list
            pages[f'https://jobs.migros.example/de/karriere/{name}'] = page({**POSTING, 'title': title, 'url': f'/de/karriere/{name}'})
        found = careers.discover('https://jobs.migros.example', site(pages))
        self.assertEqual(found['slug'], 'jobs.migros.example__de__offene-stellen')

    def test_an_embedded_job_system_wins_over_reading_the_page(self):
        pages = {'https://acme.ch': '<a href="/karriere">Karriere</a>', 'https://acme.ch/karriere': '<iframe src="https://join.com/companies/acme-ag"></iframe>'}
        self.assertEqual(careers.discover('https://acme.ch', site(pages)), {'ats': 'join', 'slug': 'acme-ag'})

    def test_a_job_board_is_not_an_employer_site_and_one_job_page_is_not_a_list(self):
        pages = {'https://www.xing.com/jobs': '<a href="/jobs/x">Jobs</a>', 'https://acme.ch': '<a href="/jobs/sre-1">Jobs</a>', 'https://acme.ch/jobs/sre-1': page(POSTING)}
        self.assertIsNone(careers.discover('https://www.xing.com/jobs', site(pages)))
        self.assertIsNone(careers.discover('https://acme.ch', site(pages)))
        self.assertTrue(careers.own_site('acme.ch') and not careers.own_site('https://swissdevjobs.ch') and not careers.own_site('https://de.linkedin.com/company/x'))

    def test_a_widget_on_the_home_page_is_not_the_companys_job_system(self):
        pages = {'https://acme.ch': '<a href="https://other.recruitee.com">partner</a><a href="/karriere">Karriere</a>', 'https://acme.ch/karriere': '<p>Arbeiten bei uns</p>'}
        self.assertIsNone(careers.discover('https://acme.ch', site(pages)))

    def test_a_site_that_refuses_or_has_no_jobs_is_simply_not_found(self):
        self.assertIsNone(careers.discover('acme.ch', site({})))
        self.assertIsNone(careers.discover('acme.ch', site({'https://acme.ch': '<a href="/jobs">Jobs</a>', 'https://acme.ch/jobs': '<p>Join us</p>'})))
        self.assertIsNone(careers.discover('', site({})))


class SystemsTests(unittest.TestCase):
    def test_addresses_reveal_the_new_systems(self):
        self.assertEqual(ats.detect('https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/x'), ('workday', 'acme.wd3.Careers'))
        self.assertEqual(ats.detect('https://join.com/companies/acme-ag/123-sre'), ('join', 'acme-ag'))
        self.assertEqual(ats.detect('https://acme.teamtailor.com/jobs/1'), ('teamtailor', 'acme'))
        self.assertIsNone(ats.detect('https://career.teamtailor.com/jobs'))   # the vendor's own site, not a customer

    def test_slugs_are_guessed_from_the_web_address(self):
        self.assertEqual(ats.domain_guesses('https://www.acme-tech.ch/en'), ['acme-tech', 'acmetech', 'acme-tech-ch'])
        self.assertEqual(ats.domain_guesses('acme.co.uk'), ['acme', 'acme-uk'])
        self.assertEqual(ats.domain_guesses(''), [])

    def test_teamtailor_feed_is_read_with_places(self):
        feed = b'''<rss xmlns:tt="https://teamtailor.com/locations"><channel><item><title>SRE</title><guid>1</guid><link>https://a.teamtailor.com/jobs/1</link>
            <pubDate>Mon, 01 Oct 2026</pubDate><description>&lt;p&gt;Hi&lt;/p&gt;</description><remoteStatus>hybrid</remoteStatus>
            <tt:locations><tt:location><tt:city>Zurich</tt:city><tt:country>Switzerland</tt:country></tt:location></tt:locations></item></channel></rss>'''
        with mock.patch.object(ats, '_get', return_value=feed):
            job, = ats.teamtailor('a')
        self.assertEqual((job['title'], job['location'], job['remote'], job['description']), ('SRE', 'Zurich, Switzerland', True, 'Hi'))

    def test_workday_slug_must_be_three_safe_parts(self):
        self.assertEqual(ats._split_workday('nvidia.wd5.NVIDIAExternalCareerSite'), ('nvidia', 'wd5', 'NVIDIAExternalCareerSite'))
        for bad in ('nvidia', 'a.b.c', 'a.wd5.x/../y'):
            with self.assertRaises(ValueError):
                ats._split_workday(bad)

    def test_the_new_systems_can_be_probed_by_a_scout(self):
        for system in ('teamtailor', 'join', 'workday', 'careers'):
            self.assertIn(system, ats.FETCHERS)
            self.assertEqual(scout.board_url(system, 'acme.wd3.Careers' if system == 'workday' else 'www.acme.ch__jobs' if system == 'careers' else 'acme').split('//')[0], 'https:')


class CatalogTests(unittest.TestCase):
    def test_swissdevjobs_employers_come_with_their_website_first_in_the_queue(self):
        listing = [{'company': 'Acme AG', 'companyWebsiteLink': 'acme.ch'}, {'company': 'Acme AG', 'companyWebsiteLink': 'acme.ch'}, {'company': '', 'companyWebsiteLink': 'x.ch'}]
        found = list(scout.swissdevjobs_candidates(get=lambda url: listing))
        self.assertEqual([(c['name'], c['website'], c['priority']) for c in found], [('Acme AG', 'https://acme.ch', 88)])

    def test_wikidata_companies_are_ranked_by_size(self):
        rows = {'results': {'bindings': [{'label': {'value': 'Big AG'}, 'site': {'value': 'https://big.ch'}, 'employees': {'value': '900.0'}},
                                         {'label': {'value': 'Mid AG'}, 'site': {'value': 'https://mid.ch'}, 'employees': {'value': '45'}}]}}
        with tempfile.TemporaryDirectory() as tmp:
            found = list(scout.wikidata_candidates(get=lambda url, **_: rows, cache=Path(tmp) / 'w.json', countries=['Switzerland']))
        self.assertEqual([(c['name'], c['priority']) for c in found], [('Big AG', 60), ('Mid AG', 50)])
        self.assertIn('wd:Q39', scout.WIKIDATA_QUERY)

    def test_wikidata_looks_in_the_countries_of_your_places(self):
        """8 Oct 2026: a search in Lisbon was seeded with Swiss companies only. Wikidata has a head count for 33 Portuguese companies (live,
        8 Oct 2026), so a thin country also gets the companies without one."""
        import urllib.parse
        asked = []
        def get(url, **_):
            query = urllib.parse.unquote(url.split('query=', 1)[1])
            asked.append(query)
            staffed = 'FILTER(?staff >= 30)' in query
            site = 'https://big.pt' if staffed else 'https://small.pt'
            return {'results': {'bindings': [{'label': {'value': 'Big SA'}, 'site': {'value': 'https://big.pt'}, 'employees': {'value': '900'}}]
                                + ([] if staffed else [{'label': {'value': 'Small Lda'}, 'site': {'value': site}}])}}
        with tempfile.TemporaryDirectory() as tmp:
            found = list(scout.wikidata_candidates(get=get, cache=Path(tmp) / 'w.json', countries=['Portugal']))
            self.assertEqual([(c['name'], c['origin']) for c in found], [('Big SA', 'Wikidata: companies in Portugal'), ('Small Lda', 'Wikidata: companies in Portugal')])
            self.assertTrue(all('"Portugal"@en' in query and 'wd:Q39' not in query for query in asked))
            self.assertEqual(len(asked), 2)
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ['w-portugal-all.json', 'w-portugal.json'])   # Switzerland's file untouched
            list(scout.wikidata_candidates(get=get, cache=Path(tmp) / 'w.json', countries=['Portugal']))
            self.assertEqual(len(asked), 2, 'kept a week, per country')

    def test_a_big_country_also_gets_its_companies_without_a_head_count(self):
        """18 Oct 2026 (owner): small companies and startups in every country, behind the bigger ones."""
        import urllib.parse
        big = [{'label': {'value': f'Co {i}'}, 'site': {'value': f'https://c{i}.de'}, 'employees': {'value': '50'}} for i in range(250)]
        def get(url, **_):
            staffed = 'FILTER(?staff >= 30)' in urllib.parse.unquote(url)
            return {'results': {'bindings': big if staffed else big[:1] + [{'label': {'value': 'Zauber'}, 'site': {'value': 'https://zauber.tech'}}]}}
        with tempfile.TemporaryDirectory() as tmp:
            found = list(scout.wikidata_candidates(get=get, cache=Path(tmp) / 'w.json', countries=['Germany']))
        self.assertEqual(len(found), 251)
        self.assertEqual((found[-1]['name'], found[-1]['priority']), ('Zauber', 45))

    def test_one_country_down_leaves_the_others_and_no_country_means_switzerland(self):
        rows = {'results': {'bindings': [{'label': {'value': f'Co {i}'}, 'site': {'value': f'https://c{i}.ch'}, 'employees': {'value': '50'}} for i in range(250)]}}
        def get(url, **_):
            if 'Atlantis' in urllib.parse.unquote(url):
                raise TimeoutError('slow')
            return rows
        import urllib.parse
        with tempfile.TemporaryDirectory() as tmp:
            found = list(scout.wikidata_candidates(get=get, cache=Path(tmp) / 'w.json', countries=['Atlantis', 'Switzerland']))
        self.assertEqual(len(found), 250)
        with mock.patch.object(scout_candidates, 'load_search_config', return_value={'locations': {'top_tier': ['Planet X']}}), \
                mock.patch('src.places.load', return_value={}):
            self.assertEqual(scout.search_countries(), ['Switzerland'])

    def test_wikidata_list_is_kept_a_week_and_reused_when_the_service_fails(self):
        from datetime import datetime, timedelta, timezone
        rows = {'results': {'bindings': [{'label': {'value': 'Big AG'}, 'site': {'value': 'https://big.ch'}}]}}
        asked = []
        def get(url, timeout=30):
            asked.append(timeout)
            return rows
        def down(url, timeout=30):
            raise TimeoutError('The read operation timed out')
        start = datetime(2026, 10, 7, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / 'cache' / 'w.json'
            self.assertEqual(len(scout.wikidata_rows(get, cache, clock=lambda: start)), 1)
            self.assertGreaterEqual(asked[0], 90)                                    # the query takes ~65 s: 30 s failed every run
            scout.wikidata_rows(get, cache, clock=lambda: start + timedelta(days=3))
            self.assertEqual(len(asked), 1)                                          # within the week: no second query
            later = lambda: start + timedelta(days=8)
            self.assertEqual(scout.wikidata_rows(down, cache, clock=later), rows['results']['bindings'])   # stale, but better than none
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(TimeoutError):                                    # nothing kept yet: the source is skipped as before
                scout.wikidata_rows(down, Path(tmp) / 'w.json', clock=lambda: start)

    def test_harvest_keeps_the_website_and_upgrades_an_older_table(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        db.execute('CREATE TABLE scout_candidates (key TEXT PRIMARY KEY, name TEXT NOT NULL, origin TEXT NOT NULL, priority INTEGER NOT NULL, '
                   "tier TEXT NOT NULL DEFAULT 'Standard', ats TEXT, slug TEXT, careers TEXT, status TEXT NOT NULL DEFAULT 'pending', quality INTEGER, "
                   'stats_json TEXT, added_at TEXT NOT NULL, checked_at TEXT, next_check TEXT)')
        db.execute("INSERT INTO scout_candidates (key, name, origin, priority, added_at) VALUES ('acme', 'Acme', 'Hacker News', 60, 'x')")
        scout.harvest(db, {'excluded': []}, [lambda: [dict(name='Acme', origin='SwissDevJobs employer', priority=88, website='https://acme.ch'),
                                                       dict(name='Beta AG', origin='SwissDevJobs employer', priority=88, website='https://beta.ch')]])
        rows = {r['name']: r['website'] for r in db.execute('SELECT name, website FROM scout_candidates')}
        self.assertEqual(rows, {'Acme': 'https://acme.ch', 'Beta AG': 'https://beta.ch'})   # the known name learns its address; the new one is added


class FindFeedTests(unittest.TestCase):
    JOBS = [{'title': 'SRE'}]

    def test_a_slug_from_the_domain_is_tried_before_the_website_is_read(self):
        tried = []

        def probe(system, slug):
            tried.append((system, slug))
            return jobs if (system, slug) == ('lever', 'acme-tech') else None
        jobs = self.JOBS * scout.SMALL_GUESS   # a feed of a real size: a handful is checked against the website (find_feed)
        found = scout.find_feed({'name': 'Totally Different AG', 'website': 'https://www.acme-tech.ch'}, probe, discover=lambda site: self.fail('not needed'))
        self.assertEqual(found, ('lever', 'acme-tech', jobs))

    def test_with_a_website_the_first_word_of_the_name_is_not_guessed(self):
        tried = []
        scout.find_feed({'name': 'Data Purpose AG', 'website': 'https://dp.example'}, lambda system, slug: tried.append(slug), discover=lambda site: None)
        self.assertNotIn('data', tried)
        self.assertIn('datapurpose', tried)
        tried.clear()
        scout.find_feed({'name': 'Data Purpose AG'}, lambda system, slug: tried.append(slug), discover=lambda site: None)
        self.assertIn('data', tried)   # without an address the name is all there is

    def test_a_guessed_feed_must_belong_to_the_company(self):
        other = [{'title': 'Engineer', 'location': 'Remote', 'url': 'https://jobs.x/stellar/1', 'description': 'Stellar Development Foundation'}]
        mine = [{'title': 'Engineer', 'location': 'Zürich', 'url': 'https://jobs.x/p/1', 'description': 'Puzzle ITC builds platforms'}]
        probe = lambda feed: (lambda system, slug: feed if (system, slug) == ('lever', 'puzzle') else None)
        # first word only, and the jobs do not name the rest of the name: someone else's feed
        self.assertIsNone(scout.find_feed({'name': 'Puzzle ITC'}, probe(other), discover=lambda site: None))
        # same guess, jobs that do name it: accepted
        self.assertEqual(scout.find_feed({'name': 'Puzzle ITC'}, probe(mine), discover=lambda site: None)[:2], ('lever', 'puzzle'))
        # the whole name as the slug needs no confirmation
        self.assertEqual(scout.find_feed({'name': 'Sentry'}, lambda s, g: other if (s, g) == ('lever', 'sentry') else None, discover=lambda site: None)[:2], ('lever', 'sentry'))

    def test_the_website_is_read_when_no_guess_works(self):
        found = scout.find_feed({'name': 'Acme AG', 'website': 'https://acme.ch'}, lambda system, slug: None,
                                discover=lambda site: {'ats': 'careers', 'slug': 'acme.ch__jobs', 'jobs': self.JOBS})
        self.assertEqual(found, ('careers', 'acme.ch__jobs', self.JOBS))

    def test_an_embedded_system_found_on_the_site_is_probed_for_its_jobs(self):
        found = scout.find_feed({'name': 'Acme AG', 'website': 'https://acme.ch'},
                                lambda system, slug: self.JOBS if (system, slug) == ('join', 'acme-ag') else None,
                                discover=lambda site: {'ats': 'join', 'slug': 'acme-ag'})
        self.assertEqual(found, ('join', 'acme-ag', self.JOBS))

    def test_nothing_found_is_none_and_a_candidate_without_website_never_reads_a_site(self):
        self.assertIsNone(scout.find_feed({'name': 'Acme AG', 'website': 'https://acme.ch'}, lambda s, g: None, discover=lambda site: None))
        self.assertIsNone(scout.find_feed({'name': 'Acme AG'}, lambda s, g: None, discover=lambda site: self.fail('no website')))


if __name__ == '__main__':
    unittest.main()


class ReaderTests(unittest.TestCase):
    """The AI reader takes over only where the rules found nothing that looks like a role you look for (fake reader, no model)."""

    def setUp(self):
        self.saved = careers.READER
        self.calls = []

    def tearDown(self):
        careers.READER = self.saved

    def reader(self, answer):
        def read(url, markup):
            self.calls.append(url)
            return answer
        careers.READER = read

    PAGES = {'https://acme.ch': '<a href="/jobs">Offene Stellen</a>',
             'https://acme.ch/jobs': '<h1>Jobs</h1><a href="/jobs/about">About us</a><p>We hire a Site Reliability Engineer</p>',
             'https://acme.ch/jobs/about': '<h1>About us</h1><p>We are a company</p>'}

    def test_menu_entries_are_replaced_by_what_the_reader_finds(self):
        self.reader([ats._job('https://acme.ch/jobs#1', 'Site Reliability Engineer', 'Zürich', 'https://acme.ch/jobs')])
        found = careers.discover('acme.ch', site(self.PAGES))
        self.assertEqual([j['title'] for j in found['jobs']], ['Site Reliability Engineer'])
        self.assertEqual(self.calls, ['https://acme.ch/jobs'])

    def test_menu_entries_are_not_a_list_of_jobs_when_no_reader_answers(self):
        self.reader(None)
        self.assertIsNone(careers.discover('acme.ch', site(self.PAGES)))

    def test_a_reader_that_finds_no_jobs_means_no_feed(self):
        self.reader([])
        self.assertIsNone(careers.discover('acme.ch', site(self.PAGES)))

    def test_without_a_reader_menu_entries_are_dropped_too(self):
        careers.READER = None
        self.assertIsNone(careers.discover('acme.ch', site(self.PAGES)))

    def test_a_successfactors_site_one_link_further_is_found(self):
        careers.READER = None
        pages = {'https://acme.ch': '<a href="/careers.html">Careers</a>',
                 'https://acme.ch/careers.html': '<a href="/about">About us</a><a href="https://careers.acme.ch/">Open positions</a>',
                 'https://acme.ch/about': '<h1>About us</h1>', 'https://careers.acme.ch/': '<script src="https://rmkcdn.successfactors.com/x.js"></script>'}
        self.assertEqual(careers.discover('acme.ch', site(pages)), {'ats': 'successfactors', 'slug': 'careers.acme.ch'})


class ShellTests(unittest.TestCase):
    """A careers page that is an empty frame is read again through the browser; one that is not is never sent there."""

    def setUp(self):
        self.saved = (careers.RENDER, careers.READER)
        careers.READER = None

    def tearDown(self):
        careers.RENDER, careers.READER = self.saved

    def test_an_empty_frame_is_rendered_and_its_jobs_read(self):
        shown = []

        def show(url):
            shown.append(url)
            return page(POSTING)
        careers.RENDER = show
        pages = {'https://acme.ch': '<a href="/jobs">Jobs</a>', 'https://acme.ch/jobs': '<div id="root"></div><script src="app.js"></script>'}
        with mock.patch.object(careers, 'get_text', site(pages)):
            found = careers.discover('acme.ch', careers.get_text)
        self.assertEqual((found['ats'], len(found['jobs'])), ('careers', 1))
        self.assertEqual(shown, ['https://acme.ch/jobs'], 'only the shell page goes to the browser, not the home page')

    def test_a_page_with_text_never_goes_to_the_browser(self):
        careers.RENDER = lambda url: self.fail('not a shell')
        pages = {'https://acme.ch': '<a href="/jobs">Jobs</a>', 'https://acme.ch/jobs': '<p>' + 'Wir arbeiten gern zusammen. ' * 40 + '</p>'}
        with mock.patch.object(careers, 'get_text', site(pages)):
            self.assertIsNone(careers.discover('acme.ch', careers.get_text))

    def test_a_refusing_browser_leaves_the_page_unread(self):
        def refuse(url):
            raise render.Refused('HTTP 403')
        careers.RENDER = refuse
        pages = {'https://acme.ch': '<a href="/jobs">Jobs</a>', 'https://acme.ch/jobs': '<div id="root"></div>'}
        with mock.patch.object(careers, 'get_text', site(pages)):
            self.assertIsNone(careers.discover('acme.ch', careers.get_text))


class ReadMoreSitesTests(unittest.TestCase):
    """Batch A: a careers page found through the site map or a usual address, an empty careers page watched, Umantis read."""

    def setUp(self):
        saved = careers.READER, careers.RENDER
        careers.READER = careers.RENDER = None
        self.addCleanup(lambda: (setattr(careers, 'READER', saved[0]), setattr(careers, 'RENDER', saved[1])))

    def test_a_home_page_without_a_careers_link_is_helped_by_the_site_map(self):
        pages = {'https://acme.ch': '<p>Welcome</p>',
                 'https://acme.ch/sitemap.xml': '<urlset><url><loc>https://acme.ch/about</loc></url><url><loc>https://acme.ch/ueber-uns/offene-stellen</loc></url></urlset>',
                 'https://acme.ch/ueber-uns/offene-stellen': page(POSTING)}
        found = careers.discover('acme.ch', site(pages))
        self.assertEqual((found['ats'], found['slug']), ('careers', 'acme.ch__ueber-uns__offene-stellen'))

    def test_a_site_map_index_and_the_usual_addresses_are_tried(self):
        pages = {'https://acme.ch': '<p>Welcome</p>', 'https://acme.ch/sitemap.xml': '<sitemapindex><sitemap><loc>https://acme.ch/page-sitemap.xml</loc></sitemap></sitemapindex>',
                 'https://acme.ch/page-sitemap.xml': '<urlset><url><loc>https://acme.ch/news</loc></url></urlset>', 'https://acme.ch/jobs': page(POSTING)}
        self.assertEqual(careers.discover('acme.ch', site(pages))['slug'], 'acme.ch__jobs')
        guessed = careers.guessed_links('https://acme.ch', site({}))
        self.assertEqual(guessed[:3], ['https://jobs.acme.ch', 'https://karriere.acme.ch', 'https://careers.acme.ch'])   # a careers site on the company's own subdomain first
        self.assertEqual(guessed[6:9], ['https://acme.ch/karriere', 'https://acme.ch/jobs', 'https://acme.ch/careers'])   # then the common paths

    def test_a_careers_site_on_its_own_subdomain_is_found_when_the_home_page_links_nothing(self):
        # 5 Oct 2026: ETH's jobs live on jobs.ethz.ch and its home page links no careers page
        pages = {'https://www.ethz.ch': page(body='<p>Welcome</p>'), 'https://jobs.ethz.ch': page(POSTING)}
        found = careers.discover('https://www.ethz.ch', site(pages))
        self.assertIsNotNone(found)
        self.assertEqual(found['ats'], 'careers')
        self.assertIn('jobs.ethz.ch', careers.decode(found['slug']))

    def test_the_subdomain_guesses_stay_on_the_companys_own_domain(self):
        self.assertEqual(careers.company_domain('www.acme.ch'), 'acme.ch')
        self.assertEqual(careers.company_domain('jobs.acme.co.uk'), 'acme.co.uk')
        self.assertEqual(careers.company_domain('co.uk'), '')   # no company part: jobs.co.uk is someone else's
        self.assertEqual([url for url in careers.guessed_links('https://www.acme.co.uk', site({})) if 'co.uk' in url.split('/')[2]][:2], ['https://jobs.acme.co.uk', 'https://karriere.acme.co.uk'])
        self.assertFalse([url for url in careers.guessed_links('https://co.uk', site({})) if url.startswith('https://jobs.')])
        self.assertNotIn('https://jobs.acme.ch', careers.guessed_links('https://jobs.acme.ch', site({})))   # a site that is already the careers subdomain does not guess itself

    def test_a_careers_page_with_no_open_jobs_is_watched_in_any_language(self):
        for text in ('Zurzeit keine offenen Stellen.', 'There are no open positions at the moment.', "Aucun poste ouvert pour l'instant."):
            pages = {'https://acme.ch': '<a href="/karriere">Karriere</a>', 'https://acme.ch/karriere': f'<p>{text}</p>'}
            found = careers.discover('acme.ch', site(pages))
            self.assertEqual((found['slug'], found['jobs'], found['empty']), ('acme.ch__karriere', [], True), text)

    def test_a_watched_page_ends_as_watch_in_the_scout_and_comes_back_in_a_week(self):
        import sqlite3
        from datetime import datetime
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        with mock.patch.object(scout, 'find_feed', return_value=('careers', 'acme.ch__karriere', [])):
            summary, results = scout.run(db, batch=5, stores=None, seeds={'excluded': []}, static=[], probe=lambda s, g: None,
                                         harvest_sources=[lambda: [dict(name='Acme AG', origin='x', priority=50, website='https://acme.ch')]])
        row = db.execute('SELECT status, ats, slug, checked_at, next_check FROM scout_candidates').fetchone()
        self.assertEqual((row['status'], row['ats'], row['slug']), ('watch', 'careers', 'acme.ch__karriere'))
        days = (datetime.fromisoformat(row['next_check']) - datetime.fromisoformat(row['checked_at'])).days
        self.assertEqual(days, 7)
        self.assertIn('no open jobs today (watched weekly)', scout.telegram_summary(summary, results))

    def test_umantis_list_and_job_pages_are_read(self):
        listing = (b'<a href="/Vacancies/1092/Description/1" class="HSTableLinkSubTitle" aria-label="DevOps Engineer" id="x">DevOps Engineer</a>'
                   b'<a href="/Vacancies/1092/Description/1" aria-label="DevOps Engineer">again</a>')
        detail = '<h1>DevOps Engineer</h1><p>Arbeitsort: Zürich. Kubernetes und Terraform.</p>'.encode()
        with mock.patch.object(ats, '_get', side_effect=lambda url: listing if url.endswith('/Jobs/All') else detail):
            job, = ats.umantis('recruitingapp-2824')
        self.assertEqual((job['id'], job['title'], job['url']), ('1092', 'DevOps Engineer', 'https://recruitingapp-2824.umantis.com/Vacancies/1092/Description/1'))
        self.assertIn('Kubernetes', job['description'])
        self.assertEqual(ats.detect('https://recruitingapp-2824.umantis.com/Vacancies/1092/Description/1'), ('umantis', 'recruitingapp-2824'))
        with self.assertRaises(ValueError):
            ats.umantis('evil.example/x')

    def test_swiss_job_portals_built_by_scripts_count_as_careers_links(self):
        home = '<a href="https://app.jobportal.abaservices.ch/job-overview/x/de">Offene Stellen</a><a href="https://direktlink.prospective.ch/?view=1">Jobs</a>'
        from src.ai import decide, page_words
        named = lambda topic, items, *a, **k: {key: 'careers_page' if 'site address' in key or 'stellen' in key or 'jobs' in key else 'other' for key in items}
        with mock.patch.object(page_words, 'ai_on', return_value=True), mock.patch.object(decide, 'decide', named):
            self.assertEqual(len(careers.careers_links(home, 'https://acme.ch')), 2, 'the AI names both hosts for jobs')
        # No AI at all: the floor knows a host by its job word only, never by a list of sites (owner, 26 Oct 2026)
        self.assertEqual(careers.careers_links(home, 'https://acme.ch'), ['https://app.jobportal.abaservices.ch/job-overview/x/de'])


class HeadingTests(unittest.TestCase):
    """#110: words that mark a career page's own headings (search, Europe, graduate, talent) also occur in real job titles."""

    def test_real_titles_with_heading_words_are_jobs(self):
        for title in ['Senior Search Engineer', 'Site Reliability Engineer, Europe', 'Cloud Engineer - Asia Pacific', 'Graduate Software Engineer',
                      'Talent Acquisition Manager', 'Platform Engineer (m/w/d) EMEA']:
            self.assertFalse(careers._heading(title), title)

    def test_page_headings_and_menu_entries_are_not_jobs(self):
        for title in ['Careers', 'Search Swiss Re Careers', 'Early talent opportunities', 'Europe, Middle East & Africa', 'Life at Acme', 'Students', 'Benefits']:
            self.assertTrue(careers._heading(title), title)

    def test_asked_keeps_a_real_job_whose_title_has_a_heading_word(self):
        jobs = [{'title': 'Senior Search Engineer', 'url': 'https://acme.example/jobs/1'}, {'title': 'Careers', 'url': 'https://acme.example/careers'}]
        with mock.patch('src.ai.page_reader.plausible', return_value=True):
            kept = careers._asked('https://acme.example/careers', '<html></html>', jobs)
        self.assertEqual([job['title'] for job in kept], ['Senior Search Engineer'])
