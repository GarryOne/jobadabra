"""Sites only you can open (7 Oct 2026): refusals and portals offered for a visit, a page a person sent read without fetching anything,
the pages of one paging session added up, portal jobs keeping their own employer, and the visit served as a feed."""
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from src.sources import ats, visits

SEARCH = {'role_keywords': ['photographe', '\\bretouche\\b'], 'locations': {'top_tier': ['Genève'], 'country_wide': ['Suisse']}}
NOW = datetime(2026, 10, 7, 9, 0, tzinfo=timezone.utc)
CARDS = [{'title': 'Photographe de mode', 'url': '/jobs/view/111', 'lines': ['Photographe de mode', 'Studio Lumière', 'Genève, Suisse', 'il y a 2 jours']},
         {'title': 'Retoucheur photo', 'url': '/jobs/view/222', 'lines': ['Retoucheur photo', 'Atelier Blanc', 'Lausanne, Vaud, Suisse']}]


class _Both:
    """Two patches started and stopped as one."""
    def __init__(self, *patches): self.patches = patches
    def start(self): [p.start() for p in self.patches]
    def stop(self): [p.stop() for p in reversed(self.patches)]


class VisitsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patch = mock.patch.object(visits, 'STORE', Path(self.tmp.name) / 'visits.json')
        self.patch = _Both(self.patch, mock.patch.object(visits, 'left_to_hand', lambda item, data: True))   # these tests are about the list's other rules; the leftover rule has its own test below
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_portal_searches_use_real_words_for_the_place_and_role(self):
        # 7 Oct 2026: gen[èe]ve became "gen ve", so LinkedIn ignored the place and showed the signed-in account's own job suggestions.
        self.assertEqual(visits._plain_words(['gen[èe]ve', 'z[uü]rich', 'vendeu(r|se)', 'photograph(e|er)?', '\\bsales associate\\b']),
                         ['genève', 'zürich', 'vendeur', 'photograph', 'sales associate'])
        urls = {p['key']: p['url'] for p in visits.portals({'role_keywords': ['photographe'], 'locations': {'top_tier': ['gen[èe]ve']}})}
        self.assertEqual(urls['linkedin'], 'https://www.linkedin.com/jobs/search/?keywords=photographe&location=gen%C3%A8ve')

    def test_a_refusing_site_and_the_portals_are_offered_least_recently_read_first(self):
        self.assertFalse(visits.refused('Down Co', 'https://down.example', 'URLError: timed out'), 'down is not a refusal')
        self.assertTrue(visits.refused('Coop', 'https://jobs.coop.ch', 'HTTP 403', now=NOW))
        listed = visits.visit_list(SEARCH, {'creative_media'}, now=NOW, picks=[])
        self.assertEqual([item['name'] for item in listed][:4], ['Coop', 'LinkedIn', 'Indeed', 'Glassdoor'])
        self.assertNotIn('levels.fyi', [item['name'] for item in listed], 'levels.fyi lists tech jobs: not for a photographer')
        self.assertIn('keywords=photographe&location=Gen%C3%A8ve', listed[1]['url'], 'the user\'s own words, not a regex')
        self.assertTrue(listed[2]['url'].startswith('https://ch.indeed.com/jobs?'), f"a Swiss search opens Switzerland's Indeed, not the US one: {listed[2]['url']}")
        self.assertTrue(listed[1]['note'].startswith('LinkedIn forbids'))
        self.assertTrue(visits.listed('https://www.linkedin.com/jobs/search/?x=1') and visits.listed('https://jobs.coop.ch/offres'))
        self.assertFalse(visits.listed('https://example.org/jobs'))

    def test_a_portal_page_is_read_from_its_cards_pages_add_up_and_a_read_site_waits_a_week(self):
        first = visits.read('https://www.linkedin.com/jobs/search/?keywords=photographe', '<html></html>', CARDS[:1], now=NOW, session='s1')
        second = visits.read('https://www.linkedin.com/jobs/search/?keywords=photographe&start=25', '<html></html>', CARDS, now=NOW, session='s1')
        self.assertEqual((first['added'], second['added'], len(second['jobs'])), (1, 1, 2))
        self.assertEqual(second['feed'], 'https://www.linkedin.com/jobs/search/?keywords=photographe', 'one feed for the whole paging session')
        # Why (28 Oct 2026): the feed ages out after KEEP_DAYS against the real clock; with NOW fixed at 7 Oct this test went empty on 28 Oct.
        with mock.patch.object(visits, '_now', lambda: NOW):
            jobs = {job['title']: job for job in ats.FETCHERS['visit'](second['feed'])}
        self.assertEqual((jobs['Photographe de mode']['employer'], jobs['Photographe de mode']['location']), ('Studio Lumière', 'Genève, Suisse'))
        self.assertEqual(jobs['Retoucheur photo']['url'], 'https://www.linkedin.com/jobs/view/222')
        names = [item['name'] for item in visits.visit_list(SEARCH, {'creative_media'}, now=NOW + timedelta(days=1), picks=[])]
        self.assertNotIn('LinkedIn', names, 'read yesterday: not offered again yet')
        self.assertIn('LinkedIn', [item['name'] for item in visits.visit_list(SEARCH, {'creative_media'}, now=NOW + timedelta(days=8), picks=[])])
        with mock.patch.object(visits, '_now', lambda: NOW + timedelta(days=30)):
            self.assertEqual(visits.fetch(second['feed']), [], 'an old visit stops serving its jobs')

    def test_the_scouts_unread_picks_for_this_search_come_before_the_portals(self):
        picks = [{'name': 'H&M Switzerland', 'url': 'https://www.hm.com'}, {'name': 'Manor', 'url': 'https://careers.manor.ch'}]
        names = [item['name'] for item in visits.visit_list(SEARCH, {'sales_retail'}, now=NOW, picks=picks)]
        self.assertEqual(names[:3], ['H&M Switzerland', 'Manor', 'LinkedIn'])

    def test_a_home_page_leads_to_its_job_list_and_the_list_then_opens_there(self):
        home = '<nav><a href="/watches">Watches</a> <a href="/joboffers/en">Careers</a></nav><h1>Time</h1>'
        self.assertEqual(visits.job_page('https://www.hublot.com/en-ch', home), 'https://www.hublot.com/joboffers/en')
        listed = visits.visit_list(SEARCH, {'sales_retail'}, now=NOW, picks=[{'name': 'Hublot', 'url': 'https://www.hublot.com'}])
        self.assertEqual(listed[0]['url'], 'https://www.hublot.com/joboffers/en', 'Open goes to the job list once found')

    def test_menu_cards_are_dropped_and_a_read_says_how_many_fit_the_search(self):
        # 7 Oct 2026: Glassdoor's menu ("Zum Inhalt springen", "Jobs", "Für dich") was read as jobs, and "Read 5 jobs from Indeed" grew nothing:
        # one of the five fit the search. Cards with a job id are the jobs; a read counts the ones the jobs check would keep.
        cards = [{'title': 'Zum Inhalt springen', 'url': '#main'}, {'title': 'Für dich', 'url': '/member/home'},
                 {'title': 'Photographer', 'url': '/rc/clk?jk=4a1b2c3d4e5f', 'lines': ['Studio AB', '1211 Geneva, GE']},
                 {'title': 'Solutions Engineer', 'url': '/rc/clk?jk=5a1b2c3d4e5f', 'lines': ['LHH', 'Geneva, GE']},
                 {'title': 'Photo assistant', 'url': '/rc/clk?jk=6a1b2c3d4e5f', 'lines': ['Studio C', 'Zürich']}]
        from src.sources import feeds
        with mock.patch.object(feeds, 'wanted_title', lambda title: 'photo' in title.lower()), mock.patch.object(feeds, 'triage_places', lambda jobs: None), \
                mock.patch.object(feeds, 'wanted_location', lambda job: 'geneva' in (job.get('location') or '').lower()):
            result = visits.read('https://ch.indeed.com/jobs?q=photographe', '<html></html>', cards, now=NOW)
        self.assertEqual([job['title'] for job in result['jobs']], ['Photographer', 'Solutions Engineer', 'Photo assistant'])
        self.assertEqual(result['fits'], 1, 'a photo job in Geneva: the one a jobs check keeps')
        self.assertEqual((result['in_places'], result['placed']), (2, 3), "this page: 2 of its 3 placed jobs in your places (the extension's early stop)")

    def test_a_read_with_no_jobs_does_not_hide_the_site(self):
        # 7 Oct 2026: home pages read as 0 jobs hid Hublot and IWC from the list for a week.
        visits.read('https://www.hublot.com/en-ch', '<html></html>', [], now=NOW)
        listed = visits.visit_list(SEARCH, {'sales_retail'}, now=NOW + timedelta(hours=1), picks=[{'name': 'Hublot', 'url': 'https://www.hublot.com'}])
        self.assertEqual(listed[0]['name'], 'Hublot')

    def test_job_pages_are_found_before_the_tabs_open_for_your_country_and_kept(self):
        asked = []
        def search(name):
            asked.append(name)
            return {'Hublot': ['https://www.hublot.com/en-cy/job-offers', 'https://www.hublot.com/en-ch/job-offers'], 'Nobody': []}[name]
        sites = [{'name': 'Hublot', 'url': 'https://www.hublot.com', 'kind': 'employer'}, {'name': 'Nobody', 'url': 'https://nobody.example', 'kind': 'employer'},
                 {'name': 'Indeed', 'url': 'https://ch.indeed.com/jobs?q=x', 'kind': 'portal'}]
        with mock.patch('src.sources.web_search.provider', lambda: 'claude'):
            found = visits.find_job_pages(sites, ['ch'], search=search, now=NOW)
            self.assertEqual(found, {'https://www.hublot.com': 'https://www.hublot.com/en-ch/job-offers'}, 'the Swiss page, not the Cyprus one')
            visits.find_job_pages(sites, ['ch'], search=search, now=NOW + timedelta(days=1))
        self.assertEqual(asked, ['Hublot', 'Nobody'], 'a portal is never searched; a find and a miss are kept')
        listed = visits.visit_list(SEARCH, {'sales_retail'}, now=NOW, picks=[{'name': 'Hublot', 'url': 'https://www.hublot.com'}])
        self.assertEqual(listed[0]['url'], 'https://www.hublot.com/en-ch/job-offers')

    def test_a_job_list_read_by_a_claude_session_becomes_the_sites_job_page(self):
        cards = [{'title': f'Client Advisor {n}', 'url': f'/en/jobs/iwc/{n}23456', 'lines': ['IWC', 'Genève']} for n in range(3)]
        visits.read('https://careers.richemont.com/en/jobs/iwc?country=Switzerland', '<html></html>', cards, now=NOW, start='https://www.iwc.com')
        listed = visits.visit_list(SEARCH, {'sales_retail'}, now=NOW + timedelta(days=8), picks=[{'name': 'IWC', 'url': 'https://www.iwc.com'}])
        self.assertEqual(listed[0]['url'], 'https://careers.richemont.com/en/jobs/iwc?country=Switzerland')

    def test_a_job_page_that_shows_no_jobs_is_forgotten_and_not_chosen_again(self):
        # 7 Oct 2026: "a wrong job page sticks forever" (Jaeger-LeCoultre's was a US page).
        search = lambda name: ['https://www.maison.example/us-en/careers', 'https://www.maison.example/ch-fr/careers']
        site = [{'name': 'Maison', 'url': 'https://www.maison.example', 'kind': 'employer'}]
        with mock.patch('src.sources.web_search.provider', lambda: 'claude'):
            self.assertEqual(visits.find_job_pages(site, [], search=search, now=NOW), {'https://www.maison.example': 'https://www.maison.example/us-en/careers'})
            visits.read('https://www.maison.example/us-en/careers', '<html></html>', [], now=NOW)
            self.assertIn('maison.example', visits._load().get('jobpages'), 'one empty read may be a reading that failed: kept')
            visits.read('https://www.maison.example/us-en/careers', '<html></html>', [], now=NOW)
            self.assertNotIn('maison.example', visits._load().get('jobpages') or {}, 'forgotten after two reads with no jobs')
            again = visits.find_job_pages(site, [], search=search, now=NOW)
        self.assertEqual(again, {'https://www.maison.example': 'https://www.maison.example/ch-fr/careers'}, 'the next lookup skips the page that showed nothing')

    def test_what_a_read_with_claude_session_saved_is_totalled_for_its_report(self):
        cards = [{'title': 'Client Advisor', 'url': '/jobs/1234567', 'lines': ['IWC', 'Genève']}, {'title': 'Logistician', 'url': '/jobs/2234567', 'lines': ['IWC', 'Schaffhausen']}]
        from src.sources import feeds
        with mock.patch.object(feeds, 'wanted_title', lambda title: 'advisor' in title.lower()), mock.patch.object(feeds, 'wanted_location', lambda job: True):
            visits.read('https://careers.richemont.com/en/jobs/iwc', '<html></html>', cards[:1], now=NOW, session='read_ab12cd34.json')
            visits.read('https://careers.richemont.com/en/jobs/iwc?page=2', '<html></html>', cards, now=NOW, session='read_ab12cd34.json')
            result = visits.session_result('read_ab12cd34.json')
        self.assertEqual((result['jobs'], result['fits']), (2, 1))
        self.assertIsNone(visits.session_result('read_none.json'), 'a session that saved nothing')
        visits.read('https://www.hublot.com/en-ch/job-offers', '<html></html>', [{'title': 'Client Advisor Genève', 'url': '/job/5234567', 'lines': ['Genève']}], now=NOW, session='read_ff00ff00_1.json')
        visits.read('https://careers.richemont.com/en/jobs/iwc', '<html></html>', cards, now=NOW, session='read_ff00ff00_2.json')
        with mock.patch.object(feeds, 'wanted_title', lambda title: 'advisor' in title.lower()), mock.patch.object(feeds, 'wanted_location', lambda job: True):
            many = visits.session_result('read_ff00ff00.json')
        self.assertEqual((many['sites'], many['jobs'], many['fits']), (2, 3, 2), 'a session that read two sites: both, never merged into one feed')
        self.assertEqual(len(set(many['feeds'])), 2)

    def test_job_page_candidates_are_ranked_and_bad_ones_dropped(self):
        # 7 Oct 2026, the owner's run: DHL's template code, Baume & Mercier's Workday jobAlerts sign-in, Rolex's 2024 article, Franck Muller's /ar/.
        found = visits._best(['https://careers.dhl.com/global/${getUrl(linkEle,', 'https://richemont.wd3.myworkdayjobs.com/en-US/richemont/jobAlerts',
                              'https://www.carrieres-rolex.com/content/Zoom-metiers-maintenance-2024/', 'https://www.franckmuller.com/ar/careers',
                              'https://www.franckmuller.com/careers', 'http://www.hublot.com/joboffers/en', 'https://www.chopard.com/fr-ch/careers.html'], ['ch'])
        self.assertEqual(found, ['https://www.chopard.com/fr-ch/careers.html', 'https://www.franckmuller.com/careers', 'https://www.hublot.com/joboffers/en',
                                 'https://www.franckmuller.com/ar/careers'])

    def test_a_recipe_that_finds_no_jobs_is_kept_until_it_misses_twice_in_a_row(self):
        # 7 Oct 2026: Richemont's recipe was forgotten on a brand page with no jobs (filtered to your place) and learned again on the next brand.
        recipe = {'selector': 'div.card-job', 'title': 0, 'company': -1, 'place': 4, 'link': 0, 'next': 'Next page', 'why': 'cards'}
        visits.save_recipe('https://careers.richemont.com/en/jobs/van-cleef-arpels/', recipe, now=NOW)
        self.assertFalse(visits.recipe_missed('https://careers.richemont.com/en/jobs/jaeger-lecoultre/'))
        self.assertEqual(visits.recipe_for('https://careers.richemont.com/en/jobs/iwc/'), recipe, 'one miss: kept')
        visits.read('https://careers.richemont.com/en/jobs/iwc/', '<html></html>', [{'title': 'Client Advisor', 'url': '/en/jobs/iwc/1234567', 'lines': ['IWC', 'Genève']}], now=NOW)
        self.assertFalse(visits.recipe_missed('https://careers.richemont.com/en/jobs/piaget/'), 'a page read with jobs started the count over')
        self.assertTrue(visits.recipe_missed('https://careers.richemont.com/en/jobs/cartier/'), 'two misses in a row: learned again')
        self.assertIsNone(visits.recipe_for('https://careers.richemont.com/en/jobs/iwc/'))
        self.assertFalse(visits.recipe_missed('https://careers.richemont.com/en/jobs/iwc/'), 'no recipe: nothing to forget')

    def test_a_known_job_list_with_no_jobs_today_is_not_taken_for_a_wrong_page(self):
        # A list filtered to your places, read by the site's learned layout, can have none: it keeps its place as the site's job page.
        search = lambda name: ['https://careers.maison.example/en/jobs/maison/']
        site = [{'name': 'Maison', 'url': 'https://www.maison.example', 'kind': 'employer'}]
        with mock.patch('src.sources.web_search.provider', lambda: 'claude'):
            visits.find_job_pages(site, [], search=search, now=NOW)
        for _ in range(3):
            visits.read('https://careers.maison.example/en/jobs/maison/', '<html></html>', [], now=NOW, known_list=True)
        self.assertIn('maison.example', visits._load().get('jobpages') or {}, 'kept: it is the list, with nothing in your places today')
        for _ in range(2):
            visits.read('https://careers.maison.example/en/jobs/maison/', '<html></html>', [], now=NOW)
        self.assertNotIn('maison.example', visits._load().get('jobpages') or {}, 'an empty page with no known list still counts')

    def test_jobs_with_no_place_on_a_list_filtered_to_your_place_are_in_that_place(self):
        # 8 Oct 2026: Fust's list filtered to Genf had cards with no place line: none could ever match your places.
        cards = [{'title': 'Verkäufer Elektronik', 'url': '/jobs/1234567', 'lines': ['Fust']}, {'title': 'Filialleiter', 'url': '/jobs/2234567', 'lines': ['Fust', 'Lausanne']}]
        result = visits.read('https://jobs.coop.example/?theme=fust', '<html></html>', cards, now=NOW, place='Genf')
        places = {job['title']: job['location'] for job in result['jobs']}
        self.assertEqual(places['Verkäufer Elektronik'], 'Genf', 'no place of its own: the filtered place')
        self.assertEqual(places['Filialleiter'], 'Lausanne', 'its own place stays')
        unfiltered = visits.read('https://other.example/jobs', '<html></html>', [{'title': 'Verkäufer', 'url': '/jobs/3234567', 'lines': []}], now=NOW)
        self.assertEqual(unfiltered['jobs'][0]['location'], '', 'not filtered: unknown stays unknown')

    def test_a_job_page_that_is_a_404_is_forgotten_at_once(self):
        with mock.patch('src.sources.web_search.provider', lambda: 'claude'):
            visits.find_job_pages([{'name': 'FM', 'url': 'https://www.fm.example', 'kind': 'employer'}], [], search=lambda name: ['https://www.fm.example/careers'], now=NOW)
        visits.read('https://www.fm.example/careers', '<html></html>', [], title='Error 404', now=NOW)
        self.assertNotIn('fm.example', visits._load().get('jobpages') or {})

    def test_a_card_whose_place_is_only_in_its_title_keeps_it(self):
        # 7 Oct 2026: Dior's "Conseiller de vente - Genève (F/H)" had no place line and was dropped from the search as placeless.
        with mock.patch.object(visits.careers, '_places', lambda: __import__('re').compile(r'gen[eè]v[ea]?|zurich', __import__('re').I)):
            result = visits.read('https://www.dior.com/carrieres/list.html', '<html></html>',
                                 [{'title': 'Conseiller de vente - Genève (F/H)', 'url': '/carrieres/offre/1234567', 'lines': ['Conseiller de vente - Genève (F/H)']}], now=NOW)
        self.assertEqual(result['jobs'][0]['location'], 'Genève')

    def test_an_employer_page_with_job_data_is_read_and_nothing_is_fetched(self):
        markup = '<script type="application/ld+json">' + json.dumps({'@type': 'JobPosting', 'title': 'Photographe', 'url': 'https://jobs.coop.ch/1',
                                                                      'jobLocation': {'address': {'addressLocality': 'Genève'}}}) + '</script>'
        with mock.patch.object(visits.careers, 'get_text', side_effect=AssertionError('fetched')):
            result = visits.read('https://jobs.coop.ch/offres', markup, now=NOW)
        self.assertEqual([job['title'] for job in result['jobs']], ['Photographe'])
        self.assertEqual(result['kind'], 'employer')


if __name__ == '__main__':
    unittest.main()


class FoundSiteTest(unittest.TestCase):
    """7 Oct 2026: the web search found Hublot's job page, which refuses the scout (403): the address is kept for the person to open."""
    def test_the_searchs_find_is_kept_when_it_cannot_be_read(self):
        from src import scout
        candidate = {'name': 'Hublot', 'website': 'https://www.hublot.com', 'status': 'pending'}
        found = scout.find_feed(candidate, probe=lambda system, slug: None, discover=lambda url: None,
                                search=lambda name: ['https://www.hublot.com/en-ch/job-offers'], jobsch_lookup=lambda name: None)
        self.assertIsNone(found)
        self.assertEqual(candidate['found_site'], 'https://www.hublot.com/en-ch/job-offers')


class OnlyVisitsTest(unittest.TestCase):
    """Always on (7 Oct 2026): a run on the Mac reads only the pages read in Chrome; a full search with it would close every job it did not read."""
    def test_only_visits_is_refused_outside_mode_today(self):
        import subprocess
        import sys
        done = subprocess.run([sys.executable, '-m', 'src', 'daily', '--mode', 'run', '--only-visits'], capture_output=True, text=True,
                              env={**__import__('os').environ, 'JOB_PILOTTO_FOLLOW_APP': '0', 'JOB_PILOTTO_DISABLE': 'mail,notion,telegram,google_jobs'})
        self.assertEqual(done.returncode, 2)
        self.assertIn('--only-visits needs --mode today', done.stderr)


class VisitListCareTests(unittest.TestCase):
    """The browser's site list (7 Oct 2026): one entry a company, failures said, removed sites gone, and only employers likely to hire your
    kinds of role (Cornèr Bank and levels.fyi were read for a photographer and shop seller)."""
    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.patch = mock.patch.object(visits, 'STORE', Path(self.tmp.name) / 'visits.json')
        self.patch = _Both(self.patch, mock.patch.object(visits, 'left_to_hand', lambda item, data: True))   # these tests are about the list's other rules; the leftover rule has its own test below
        self.patch.start()
        self.search = {'role_keywords': ['vendeur', 'photographe'], 'locations': {'top_tier': ['geneva'], 'country_wide': [], 'abroad': []}}
        self.picks = [{'name': 'Rolex', 'url': 'https://www.rolex.com'}, {'name': 'Rolex', 'url': 'https://www.carrieres-rolex.com'},
                      {'name': 'Tiffany & Co.', 'url': 'https://www.tiffany.com'}, {'name': 'Tiffany', 'url': 'https://www.tiffanycareers.com'},
                      {'name': 'Cornèr Bank', 'url': 'https://jobs.corner.ch'}, {'name': 'Manor', 'url': 'https://www.manor.ch/jobs'}]

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def names(self, listed):
        return [item['name'] for item in listed if item['kind'] == 'employer']

    def test_one_entry_a_company_failures_said_and_removed_sites_gone(self):
        visits._save({'jobpages': {'www.tiffany.com': 'https://www.tiffanycareers.com', 'tiffany.com': 'https://www.tiffanycareers.com'}})
        with mock.patch.object(visits, 'relevant', lambda items, search: items):
            listed = visits.visit_list(self.search, set(), now=NOW, picks=self.picks)
            self.assertEqual(self.names(listed), ['Rolex', 'Tiffany & Co.', 'Cornèr Bank', 'Manor'], 'one Rolex, one Tiffany')
            visits.outcome([{'url': 'https://www.manor.ch/jobs', 'ok': False, 'why': 'no job list found'}], now=NOW)
            visits.outcome([{'url': 'https://www.manor.ch/jobs', 'ok': False, 'why': 'no job list found'}], now=NOW)
            manor = next(i for i in visits.visit_list(self.search, set(), now=NOW, picks=self.picks) if i['name'] == 'Manor')
            self.assertTrue(manor['failing'])
            self.assertIn('Failed 2 times in a row: no job list found', manor['note'])
            visits.outcome([{'url': 'https://www.manor.ch/jobs', 'ok': True}], now=NOW)
            self.assertNotIn('failing', next(i for i in visits.visit_list(self.search, set(), now=NOW, picks=self.picks) if i['name'] == 'Manor'))
            data = visits._load(); data['jobpages']['chanel.com'] = 'https://cc.wd3.myworkdayjobs.com/en-US/ChanelCareers'; visits._save(data)
            chanel = visits.visit_list(self.search, set(), now=NOW, picks=self.picks + [{'name': 'Chanel', 'url': 'https://www.chanel.com'}])
            self.assertNotIn('Chanel', self.names(chanel), 'its job page is a Workday the engine reads at every refresh: not a browser job')
            visits.hide('https://jobs.corner.ch')
            self.assertNotIn('Cornèr Bank', self.names(visits.visit_list(self.search, set(), now=NOW, picks=self.picks)))

    def test_claude_leaves_out_sites_unlikely_for_your_roles_once_per_list(self):
        import json
        from types import SimpleNamespace
        asked = []

        class Client:
            def __init__(self):
                self.messages = SimpleNamespace(create=self.create)

            def create(self, **kwargs):
                asked.append(kwargs)
                lines = kwargs['messages'][0]['content'].split('The sites:\n', 1)[1].split('\n')
                keep = [int(line.split('.', 1)[0]) for line in lines if 'Bank' not in line and 'levels.fyi' not in line]
                return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'keep': keep}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))
        items = [{'name': 'Manor', 'url': 'https://www.manor.ch/jobs', 'kind': 'employer'}, {'name': 'Cornèr Bank', 'url': 'https://jobs.corner.ch', 'kind': 'employer'},
                 {'name': 'levels.fyi', 'url': 'https://www.levels.fyi', 'kind': 'portal'}]
        with mock.patch('src.ai.engine.ready', lambda *a: True):
            kept = visits.relevant(items, self.search, Client())
            visits.relevant(items, self.search, Client())
        self.assertEqual([i['name'] for i in kept], ['Manor'])
        self.assertEqual(len(asked), 1, 'asked once for the same list, roles and places')
        self.assertIn('photographe', asked[0]['messages'][0]['content'])
        with mock.patch('src.ai.engine.ready', lambda *a: False):
            self.assertEqual(len(visits.relevant(items + [{'name': 'X', 'url': 'https://x.test', 'kind': 'employer'}], self.search)), 4, 'no AI: every site')


class PoolFactsTests(unittest.TestCase):
    """Facts other installs agreed on (the central pool, k >= 3): a known job page needs no web search or AI, a dead page is not offered."""
    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [mock.patch.object(visits, 'STORE', Path(self.tmp.name) / 'visits.json'), mock.patch.object(visits, 'left_to_hand', lambda item, data: True)]
        for patch in self.patches:
            patch.start()
        self.index = Path(self.tmp.name) / 'employer_index.json'
        self.index.write_text(json.dumps({'sites': [
            {'host': 'vancleefarpels.com', 'kind': 'jobpage', 'url': 'https://careers.richemont.com/en/jobs/van-cleef-arpels/', 'installs': 3},
            {'host': 'franckmuller.com', 'kind': 'dead', 'url': 'https://www.franckmuller.com/careers', 'installs': 4}]}))
        self.patches.append(mock.patch('src.employer_index.CACHE', self.index))
        self.patches[-1].start()

    def tearDown(self):
        for patch in reversed(self.patches):
            patch.stop()
        self.tmp.cleanup()

    def test_a_pooled_job_page_is_used_and_a_dead_one_is_not_offered(self):
        from src.sources import web_search
        asked = []
        with mock.patch.object(web_search, 'provider', lambda: True):
            found = visits.find_job_pages([{'name': 'Van Cleef & Arpels', 'url': 'https://www.vancleefarpels.com'}], search=lambda name: asked.append(name) or [])
        self.assertEqual(found, {'https://www.vancleefarpels.com': 'https://careers.richemont.com/en/jobs/van-cleef-arpels/'})
        self.assertEqual(asked, [], 'no web search: the pool knew it')
        visits._save({'jobpages': {'franckmuller.com': 'https://www.franckmuller.com/careers'}})
        with mock.patch.object(visits, 'relevant', lambda items, search: items):
            listed = visits.visit_list({'role_keywords': ['vendeur'], 'locations': {'top_tier': ['geneva']}}, set(), now=NOW,
                                       picks=[{'name': 'Franck Muller', 'url': 'https://www.franckmuller.com'}, {'name': 'Manor', 'url': 'https://www.manor.ch'}])
        self.assertEqual([i['name'] for i in listed if i['kind'] == 'employer'], ['Manor'], 'its job page is dead for 4 installs')


class PoolLayoutTests(unittest.TestCase):
    """Page layouts other installs learned (k >= 3): checked again here, used for a host with none, kept like a learned one (8 Oct 2026)."""
    RECIPE = {'selector': 'main > div.jobs > div.card', 'title': 0, 'company': -1, 'place': 4, 'link': 0, 'next': 'Next page'}

    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.index = Path(self.tmp.name) / 'employer_index.json'
        self.patches = [mock.patch.object(visits, 'STORE', Path(self.tmp.name) / 'visits.json'), mock.patch('src.employer_index.CACHE', self.index)]
        for patch in self.patches:
            patch.start()

    def tearDown(self):
        for patch in reversed(self.patches):
            patch.stop()
        self.tmp.cleanup()

    def test_the_check_keeps_a_layout_and_refuses_anything_else(self):
        self.assertEqual(visits.layout_ok({**self.RECIPE, 'why': 'Claude said so'}), self.RECIPE, 'only the layout fields')
        for bad in ({**self.RECIPE, 'selector': 'div<script>'}, {**self.RECIPE, 'selector': 'a[href^="javascript:x"]'}, {**self.RECIPE, 'title': -1},
                    {**self.RECIPE, 'place': 99}, {**self.RECIPE, 'next': '{{x}}'}, {**self.RECIPE, 'title': True}, 'div'):
            self.assertIsNone(visits.layout_ok(bad), bad)

    def test_a_served_layout_is_used_once_then_kept_and_can_be_turned_off(self):
        self.index.write_text(json.dumps({'sites': [{'host': 'careers.richemont.com', 'kind': 'layout', 'recipe': self.RECIPE, 'installs': 3},
                                                    {'host': 'evil.test', 'kind': 'layout', 'recipe': {**self.RECIPE, 'selector': 'x<y'}, 'installs': 5}]}))
        with mock.patch.dict('os.environ', {'JOB_PILOTTO_DISABLE': 'pool_layouts'}):
            self.assertIsNone(visits.recipe_for('https://careers.richemont.com/en/jobs/iwc'), 'switched off')
        self.assertEqual(visits.recipe_for('https://careers.richemont.com/en/jobs/iwc'), self.RECIPE)
        self.assertTrue(visits._load()['recipes']['careers.richemont.com']['pooled'], 'kept like a learned one, marked as from the pool')
        self.assertIsNone(visits.recipe_for('https://evil.test/jobs'), 'a served layout that fails the check is not used')


class JobPageLinksTests(unittest.TestCase):
    """A page's own careers links go through the same AI check as a search's (8 Oct 2026: Fust's link led to its application-process page)."""
    def test_the_pages_own_links_are_checked(self):
        import tempfile
        from src.sources import careers, web_search
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(visits, 'STORE', Path(tmp) / 'visits.json'), \
                mock.patch.object(careers, 'careers_links', lambda markup, url: ['https://www.fust.ch/footer/offene-stellen/bewerbungs-prozess', 'https://www.fust.ch/footer/offene-stellen']), \
                mock.patch.object(web_search, 'only_job_lists', lambda company, site, urls, client=None: [u for u in urls if 'bewerbungs' not in u]):
            answer = visits.job_page('https://www.fust.ch', '<html><title>Fust | Home</title></html>')
        self.assertEqual(answer, 'https://www.fust.ch/footer/offene-stellen')


class LeftToHandTests(unittest.TestCase):
    """Browse sites manually lists only true leftovers (owner, 24 Oct 2026: 12 Moldovan sites listed, none tried by the automatic Chrome read)."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patch = mock.patch.object(visits, 'STORE', Path(self.tmp.name) / 'visits.json')
        self.patch.start()
        self.picks = [{'name': name, 'url': f'https://{host}'} for name, host in [('Stopped', 'a.example'), ('Opened', 'b.example'), ('Not tried', 'c.example'),
                                                                                  ('Empty', 'd.example'), ('Slow down', 'e.example')]]

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def names(self):
        with mock.patch.object(visits, 'relevant', lambda items, search: items):
            return [i['name'] for i in visits.visit_list(SEARCH, set(), now=NOW, picks=self.picks) if i['kind'] == 'employer']

    def test_a_site_is_left_only_when_the_automatic_read_stopped_there(self):
        states = {'a.example': 'stopped', 'b.example': 'read', 'd.example': 'empty', 'e.example': 'waiting'}
        visits._save({'refused_reads': {host: {'at': NOW.isoformat(), 'state': state} for host, state in states.items()}})
        self.assertEqual(self.names(), ['Stopped'], 'opened, empty, slow-down and not-yet-tried sites are not left to the person')

    def test_the_scouts_picks_are_asked_by_the_automatic_read_first(self):
        from src.sources import refused_reads
        with mock.patch.object(visits, 'unread_picks', lambda: self.picks), mock.patch.object(visits, 'pool_facts', lambda: {}), \
                mock.patch.object(refused_reads.board_ideas, 'load', lambda: {'boards': {}}):
            self.assertEqual([i['name'] for i in refused_reads.queue(now=NOW)], [p['name'] for p in self.picks])

    def test_a_site_the_automatic_read_may_not_open_stays_for_the_person(self):
        with mock.patch.object(visits, 'relevant', lambda items, search: items):
            listed = visits.visit_list(SEARCH, {'creative_media'}, now=NOW, picks=[])
        self.assertIn('LinkedIn', [i['name'] for i in listed], 'a login wall is only ever the person\'s own visit')
