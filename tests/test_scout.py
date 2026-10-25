import json
import tempfile
import unittest
from unittest import mock
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import ats
from src import store as job_store
from src import pool_served, scout, scout_candidates, scout_core, scout_probe
from src.stores import memory, notion

SEEDS = {'excluded': ['Acme'], 'tier1_known': [{'name': 'Bigco', 'ats': 'lever', 'slug': 'bigco'}],
         'tier1': ['Farco'], 'manual_watch': [{'name': 'Walledco', 'careers': 'https://walled.test/jobs'}],
         'regional': {'Zurich': ['Smallco', 'Acme', 'Nofeed']}}


def posting(i, title='Site Reliability Engineer', location='Zurich, Switzerland', **extra):
    return dict({'id': str(i), 'title': title, 'location': location, 'url': f'https://x.test/{i}',
                 'date_posted': '2099-01-01', 'description': 'Kubernetes and Terraform', 'remote': False,
                 'salary': ''}, **extra)


FEEDS = {
    ('lever', 'bigco'): [posting(1), posting(2, location='London'), posting(3, title='Sales')],
    ('greenhouse', 'farco'): [posting(i, location='Seattle') for i in range(4)],   # Tier 1, none in our places
    ('ashby', 'smallco'): [posting(9, title='Accountant')],                         # feed, nothing relevant
}


def fake_probe(system, slug):
    return FEEDS.get((system, slug))


class FakeTracker:
    def __init__(self):
        self.created, self.updated = [], []

    def query_database(self, database_id, filter_=None):
        return []

    def create_page(self, database_id, properties):
        self.created.append((database_id, properties))
        return {'id': 'p'}

    def update_page(self, page_id, properties):
        self.updated.append(properties)


def on_notion(tracker):
    """The notion store over this fake client: what a user on Notion has (Employers & Sources rows are what it records)."""
    return notion.open_store({'NOTION_TOKEN': 't', 'NOTION_EMPLOYERS_DB': scout_core.EMPLOYERS_DB}, tracker=tracker)


class ScoutTests(unittest.TestCase):
    def run_scout(self, db, tracker=None, batch=10):
        return scout.run(db, batch, tracker and on_notion(tracker), SEEDS, fake_probe, harvest_sources=[lambda: scout.seed_candidates(SEEDS)])

    def test_every_tech_only_list_is_marked_and_the_trade_agnostic_ones_are_not(self):
        """The class, not one case: each source of software employers yields origins a non-IT search skips, so a new one cannot slip past."""
        skip = scout.skipped_origins(SEEDS, technical=False)
        import re
        hn = {'hits': [{'title': 'Ask HN: Who is hiring? (October 2026)', 'objectID': '1'}]}
        get_hn = lambda url: hn if 'search_by_date' in url else {'children': [{'text': 'Acme | Engineer | Geneva'}]}
        readme = '- [Acme](https://acme.test/jobs) | Geneva | x'
        with mock.patch.object(scout_candidates, 'LOCATION_WORDS', re.compile('.')), mock.patch.object(scout_candidates, 'ROLE_WORDS', re.compile('.')):
            tech = {'seeds': list(scout.seed_candidates(SEEDS)), 'hacker news': list(scout.hacker_news_candidates(get=get_hn)),
                    'whiteboards': list(scout.whiteboards_candidates(get=lambda url: readme)),
                    'swissdevjobs': list(scout.swissdevjobs_candidates(get=lambda url: [{'company': 'Acme', 'companyWebsiteLink': 'acme.test'}]))}
        wikidata = {'results': {'bindings': [{'label': {'value': 'Hotelco'}, 'site': {'value': 'https://hotel.test'}}]}}
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            db.execute("INSERT INTO companies (name, careers_url, website, updated_at) VALUES ('Shopco', '', 'https://shop.test', '2026-10-06')")
            general = list(scout.local_company_candidates(db)) + list(scout.wikidata_candidates(get=lambda url, **_: wikidata, cache=Path(tmp) / 'w.json', countries=['Switzerland']))
        for source, found in tech.items():
            self.assertTrue(found, source)
            self.assertTrue(all(c['origin'].startswith(skip) for c in found), source)
        self.assertTrue(general)
        self.assertFalse(any(c['origin'].startswith(skip) for c in general))
        self.assertFalse('AI idea 2026-10-06'.startswith(skip) or 'AI list: gva.ch'.startswith(skip))
        self.assertEqual(scout.skipped_origins(SEEDS, technical=True), (), 'an IT search skips nothing')
        own = scout.skipped_origins(dict(SEEDS, tech_only=False), technical=False)
        self.assertFalse(any(c['origin'].startswith(own) for c in tech['seeds']), 'a seed list of your own trade is kept')

    def test_a_search_outside_it_never_harvests_nor_probes_the_tech_lists(self):
        """6 Oct 2026: a photographer's scout checked Netflix and Stripe while the AI's Geneva retail ideas waited."""
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            # A queue left from before (roles changed, or an older version): tech seeds rank highest.
            scout.harvest(db, SEEDS, sources=[lambda: scout.seed_candidates(SEEDS)])
            ideas = [dict(name='Manor', origin='AI idea 2026-10-06', priority=92), dict(name='Fnac', origin='AI list: gva.ch', priority=90),
                     dict(name='Stack Co', origin='SwissDevJobs employer', priority=88)]
            skip = scout.skipped_origins(SEEDS, technical=False)
            scout.harvest(db, SEEDS, sources=[lambda: ideas], skip=skip)
            names = {row['name'] for row in db.execute('SELECT name FROM scout_candidates')}
            self.assertNotIn('Stack Co', names, 'a tech list is not harvested for a non-tech search')
            self.assertEqual([c['name'] for c in scout.next_batch(db, 10, skip)], ['Manor', 'Fnac'])
            self.assertEqual(scout.next_batch(db, 1)[0]['name'], 'Bigco', 'an IT search keeps its Tier 1 seeds first')

    def test_the_summary_says_how_many_were_new_to_the_search(self):
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            summary, _ = self.run_scout(db, batch=10)
            self.assertEqual(summary['first_time'], summary['checked'], 'a first run checks only names never checked')
            again, _ = self.run_scout(db, batch=10)
            self.assertEqual(again['first_time'], 0, 'nothing new left: whatever is checked is a re-check after its wait')
            card = scout.telegram_summary(summary, [])
            self.assertIn(f"{summary['checked']} new to the search", card)

    def test_a_known_job_site_is_read_before_any_guess(self):
        jobs = [{'title': f'Horloger {i}', 'location': 'Genève'} for i in range(9)]
        guessed = []
        found = scout.find_feed({'name': 'Rolex', 'website': 'https://www.rolex.com', 'careers': 'https://www.carrieres-rolex.com/'},
                                lambda system, slug: guessed.append(slug) or (jobs if (system, slug) == ('successfactors', 'www.carrieres-rolex.com') else None),
                                lambda url: {'ats': 'successfactors', 'slug': 'www.carrieres-rolex.com'} if 'carrieres-rolex' in url else None)
        self.assertEqual(found[:2], ('successfactors', 'www.carrieres-rolex.com'))
        self.assertEqual(guessed, ['www.carrieres-rolex.com'], 'no name guessed: the job site answered')

    def test_a_brand_word_in_the_name_is_tried_with_and_without(self):
        """18 Oct 2026, Startup Employer Discovery rerun: pasted "Wynd Labs" ended with no feed; its Ashby board is wynd-labs (7 jobs) and the
        guesses dropped "Labs" (only `wynd`). A legal form stays dropped: no board is called digitecgalaxusag."""
        jobs = [{'title': 'Research Crawling Engineer', 'location': 'Remote'}]
        for name, board in [('Wynd Labs', 'wynd-labs'), ('Acme Technologies', 'acmetechnologies'), ('Nova Group', 'nova-group')]:
            found = scout.find_feed({'name': name}, lambda system, slug: jobs if (system, slug) == ('ashby', board) else None, lambda url: None)
            self.assertEqual(found[:2], ('ashby', board), f'{name}: the whole name is a slug of its own and counts as exact')
        self.assertEqual(ats.slug_guesses('Digitec Galaxus AG'), ['digitecgalaxus', 'digitec-galaxus', 'digitec'])
        self.assertEqual(ats.slug_guesses('Wynd Labs'), ['wynd', 'wyndlabs', 'wynd-labs'])

    def test_a_small_name_guess_loses_to_the_companys_own_job_site(self):
        """6 Oct 2026: Coop Suisse Romande took JOIN's "coop" (1 job, another company); its own job site jobs.coop.ch runs SuccessFactors."""
        own = [{'title': f'Vendeur {i}', 'location': 'Genève'} for i in range(40)]
        probe = lambda system, slug: [{'title': 'Koch', 'location': 'Berlin'}] if (system, slug) == ('join', 'coop') else \
            own if (system, slug) == ('successfactors', 'jobs.coop.ch') else None
        tried = []
        discover = lambda url: tried.append(url) or ({'ats': 'successfactors', 'slug': 'jobs.coop.ch'} if url == 'https://jobs.coop.ch' else None)
        system, slug, jobs = scout.find_feed({'name': 'Coop Suisse Romande', 'website': 'https://www.coop.ch'}, probe, discover)
        self.assertEqual((system, slug, len(jobs)), ('successfactors', 'jobs.coop.ch', 40))
        self.assertEqual(tried[:2], ['https://www.coop.ch', 'https://jobs.coop.ch'], 'the home page first, then the usual job site')
        big = lambda system, slug: own if (system, slug) == ('join', 'coop') else None
        self.assertEqual(scout.find_feed({'name': 'Coop', 'website': 'https://www.coop.ch'}, big, lambda url: None)[:2], ('join', 'coop'),
                         'a guess with many jobs is kept without asking the website')
        self.assertEqual(scout.job_hosts('https://jobs.coop.ch'), [], 'already a job site')
        self.assertEqual(scout.job_hosts('manor.ch')[1], 'https://careers.manor.ch')

    def test_employers_judged_by_older_readers_are_checked_again(self):
        """6 Oct 2026: employers probed while the readers were wrong stayed 'no feed' for 90 days; a reader change brings them back."""
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            scout.harvest(db, SEEDS, sources=[lambda: [dict(name=n, origin='AI idea', priority=92) for n in ('Old', 'Current', 'New')]])
            later = '2099-01-01T00:00:00+00:00'
            db.execute("UPDATE scout_candidates SET status='none', checked_at='2026-10-06', next_check=?, checked_with='0123456789ab' WHERE name='Old'", (later,))
            db.execute("UPDATE scout_candidates SET status='none', checked_at='2026-10-06', next_check=?, checked_with=? WHERE name='Current'", (later, scout.READERS))
            names = [c['name'] for c in scout.next_batch(db, 50) if c['name'] in ('Old', 'Current', 'New')]
            # Owner, 7 Oct 2026 (later the same day): every name never checked first; an employer checked before waits at the end.
            self.assertEqual(names, ['New', 'Old'], 'never-checked names first, then the judgement by older readers; the current one waits its 90 days')
            db.execute("UPDATE scout_candidates SET next_check='2000-01-01T00:00:00+00:00' WHERE name='Current'")   # due by date, same readers
            names = [c['name'] for c in scout.next_batch(db, 50) if c['name'] in ('Old', 'Current', 'New')]
            self.assertEqual(names, ['New', 'Old', 'Current'], 'a re-check due by date comes after the new names and the older-reader ones')

    def test_names_left_out_for_other_installs_are_replaced(self):
        """7 Oct 2026: 52 of a batch of 92 were left out (no job site other installs could read) and the run checked 40: the next names fill in."""
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, \
                mock.patch.object(scout_core, 'CENTRAL', False), \
                mock.patch.object(scout.employer_index, 'central_nofeed', return_value={'dead0', 'dead1', 'dead2'}):
            names = [f'Dead{i}' for i in range(3)] + [f'Live{i}' for i in range(5)]
            scout.harvest(db, SEEDS, sources=[lambda: [dict(name=n, origin='AI idea', priority=99 - i) for i, n in enumerate(names)]])
            with mock.patch.object(pool_served, 'STORE', Path(tmp) / 'pool_served.json'):
                summary, results = scout.run(db, batch=4, harvest_sources=[], probe=lambda system, slug: [])
                self.assertEqual(pool_served.load().get('names_tried'), 3, 'the three skipped probes are counted as served by the pool')
            self.assertEqual(sorted(c['name'] for c, _ in results), ['Live0', 'Live1', 'Live2', 'Live3'], 'four checked, none of them left out')
            self.assertEqual({r[0] for r in db.execute("SELECT name FROM scout_candidates WHERE status='none' AND name LIKE 'Dead%'")},
                             {'Dead0', 'Dead1', 'Dead2'}, 'the left-out names wait their 30 days')

    def test_central_scout_leaves_names_installs_already_tried(self):
        """20 Oct 2026: the central scout trusted only its own table, so names installs had found dead were probed again there."""
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, \
                mock.patch.object(scout_core, 'CENTRAL', True), mock.patch.object(scout_core, 'SHARED_DEAD', {'dead0', 'dead1'}):
            names = ['Dead0', 'Dead1', 'Live0', 'Live1']
            scout.harvest(db, SEEDS, sources=[lambda: [dict(name=n, origin='AI idea', priority=99 - i) for i, n in enumerate(names)]])
            summary, results = scout.run(db, batch=2, harvest_sources=[], probe=lambda system, slug: [])
            self.assertEqual(sorted(c['name'] for c, _ in results), ['Live0', 'Live1'], 'two checked, none of the shared dead ends')

    def test_each_no_feed_name_says_why_it_has_none(self):
        """20 Oct 2026: shared outcomes are fixed words: no_feed, refused (site turned the engine away), unreachable (the check failed)."""
        from src.sources import careers
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, \
                mock.patch.object(scout_core, 'CENTRAL', True), mock.patch.dict(careers.REFUSALS, {'refused.example': 'bot check'}, clear=False), \
                mock.patch('src.sources.visits.refused'):   # the real one writes data/visits.json
            scout.harvest(db, SEEDS, sources=[lambda: [dict(name='Plain', origin='AI idea', priority=90),
                                                       dict(name='Broken', origin='AI idea', priority=89),
                                                       dict(name='Shut', origin='AI idea', priority=88, website='https://refused.example')]])
            def probe(system, slug):
                if slug.startswith('broken'):
                    raise TypeError('odd site')
                return []
            scout.run(db, batch=3, harvest_sources=[], probe=probe, workers=1)
            got = dict(db.execute("SELECT name, outcome FROM scout_candidates WHERE status = 'none'").fetchall())
            self.assertEqual(got, {'Plain': 'no_feed', 'Broken': 'unreachable', 'Shut': 'refused'})

    def test_a_time_budget_ends_the_run_and_keeps_the_rest_for_later(self):
        """7 Oct 2026: 91 checks took over half an hour. With a budget, no check starts after it; the rest stay untried for the next run."""
        import time as clock
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, mock.patch.object(scout_core, 'CENTRAL', True):
            names = [f'Co{i}' for i in range(10)]
            scout.harvest(db, SEEDS, sources=[lambda: [dict(name=n, origin='AI idea', priority=99 - i) for i, n in enumerate(names)]])
            slow = lambda system, slug: clock.sleep(0.05) or []   # noqa: E731
            started = clock.monotonic()
            summary, results = scout.run(db, batch=10, harvest_sources=[], probe=slow, workers=1, budget=1)
            self.assertLess(clock.monotonic() - started, 5)
            self.assertTrue(0 < len(results) < 10, f'some checked, not all: {len(results)}')
            self.assertEqual(summary['checked'], len(results))
            untried = {r[0] for r in db.execute("SELECT name FROM scout_candidates WHERE status = 'pending' AND name LIKE 'Co%'")}
            self.assertEqual(len(untried), 10 - len(results), 'the rest wait for the next run')

    def test_a_check_that_hangs_is_given_up_on_so_the_run_still_ends(self):
        """21 Oct 2026: checks of Swiss mountain huts took up to 30 minutes each; all six workers stuck, the central run was cancelled at 75 minutes."""
        import threading
        release = threading.Event()
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, mock.patch.object(scout_core, 'CENTRAL', True), \
                mock.patch.object(scout_core, 'CHECK_LIMIT_S', 0.3):
            scout.harvest(db, SEEDS, sources=[lambda: [dict(name=n, origin='AI idea', priority=90 - i) for i, n in enumerate(['Stuck', 'Fine', 'Also fine'])]])
            probe = lambda system, slug: release.wait(30) and [] if slug.startswith('stuck') else []   # noqa: E731
            import time as clock
            started = clock.monotonic()
            try:
                summary, results = scout.run(db, batch=3, harvest_sources=[], probe=probe, workers=2)
                took = clock.monotonic() - started
            finally:
                release.set()
            self.assertLess(took, 10, 'the run does not wait for the hung check')
            self.assertEqual(sorted((c['name'], o.get('outcome')) for c, o in results), [('Also fine', 'no_feed'), ('Fine', 'no_feed'), ('Stuck', 'unreachable')])

    def test_one_employer_that_fails_does_not_end_the_run(self):
        """7 Oct 2026: a TypeError reading one site's job data ended the run at 90 of 91. Now that one counts as no readable job site."""
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, mock.patch.object(scout_core, 'CENTRAL', True):
            scout.harvest(db, SEEDS, sources=[lambda: [dict(name=n, origin='AI idea', priority=90 - i) for i, n in enumerate(['Good', 'Broken'])]])
            def probe(system, slug):
                if slug.startswith('broken'):
                    raise TypeError('sequence item 0: expected str instance, list found')
                return []
            summary, results = scout.run(db, batch=2, harvest_sources=[], probe=probe, workers=1)
            self.assertEqual(sorted((c['name'], o['status']) for c, o in results), [('Broken', 'none'), ('Good', 'none')])
            self.assertEqual(db.execute("SELECT COUNT(*) FROM scout_candidates WHERE checked_at IS NOT NULL").fetchone()[0], 2, 'both saved')

    def test_reader_fingerprint_ignores_wording(self):
        """A comment, docstring or printed line changed in the reader code must not send every judged employer back to the queue."""
        from src.sources import readers
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(readers, 'SRC', Path(tmp)):
            code = Path(tmp) / 'r.py'
            code.write_text('def judge(x):\n    """Old words."""\n    print("checking")\n    return x > 1  # note\n\ndef other():\n    return 1\n')
            before = readers.code_fingerprint(['r.py'], only={'r.py': ('judge',)})
            code.write_text('def judge(x):\n    """New words."""\n    print("looking")\n    return x > 1  # other note\n\ndef other():\n    return 2\n')
            self.assertEqual(readers.code_fingerprint(['r.py'], only={'r.py': ('judge',)}), before, 'wording, and functions that do not judge')
            code.write_text('def judge(x):\n    return x > 2\n')
            self.assertNotEqual(readers.code_fingerprint(['r.py'], only={'r.py': ('judge',)}), before, 'a change in how it judges')

    def test_companies_excluded_from_the_environment_are_never_harvested(self):
        seeds = dict(SEEDS, excluded=[])
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict('os.environ', {'JOB_PILOTTO_EXCLUDED_COMPANIES': ' Acme , Other'}):
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                scout.harvest(db, seeds, sources=[lambda: scout.seed_candidates(seeds)])
                names = {row['name'] for row in db.execute('SELECT name FROM scout_candidates')}
        self.assertIn('Smallco', names)
        self.assertNotIn('Acme', names)

    def test_a_candidate_on_a_board_already_in_the_starter_list_is_a_duplicate(self):
        """E2E Acme Labs on the board of the starter source E2E Acme was registered as a new source and written to Employers & Sources again (found by the employers e2e suite, 2 Oct 2026)."""
        seeds = {'excluded': [], 'tier1_known': [{'name': 'Bigco Labs', 'ats': 'lever', 'slug': 'bigco'}], 'tier1': [], 'manual_watch': [], 'regional': {}}
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'sources.json').write_text(json.dumps([{'company': 'Bigco', 'ats': 'lever', 'slug': 'bigco'}]))
            with mock.patch.object(scout_candidates, 'CONFIG', Path(tmp)), job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                tracker = FakeTracker()
                summary, results = scout.run(db, 10, on_notion(tracker), seeds, fake_probe, harvest_sources=[lambda: scout.seed_candidates(seeds)])
                self.assertEqual([o['status'] for _, o in results], ['duplicate'])
                self.assertEqual(summary['total_feeds'], 0)
                self.assertEqual(tracker.created, [])
                self.assertEqual(db.execute('SELECT COUNT(*) FROM feed_sources').fetchone()[0], 0)

    def test_tier1_first_found_low_none_and_exclusions(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                tracker = FakeTracker()
                summary, results = self.run_scout(db, tracker)
                outcome = {c['name']: o['status'] for c, o in results}
                self.assertEqual([c['name'] for c, _ in results][:3], ['Bigco', 'Farco', 'Walledco'])
                self.assertEqual(outcome, {'Bigco': 'found', 'Farco': 'found', 'Walledco': 'manual',
                                           'Smallco': 'low', 'Nofeed': 'none'})
                self.assertNotIn('Acme', outcome)
                self.assertEqual(summary['total_feeds'], 2)
                sources = {(s['ats'], s['slug']) for s in scout.active_sources(db)}
                self.assertEqual(sources, {('lever', 'bigco'), ('greenhouse', 'farco')})
                rows = {p['Company']['title'][0]['text']['content']: p for db_id, p in tracker.created
                        if db_id == scout_core.EMPLOYERS_DB}
                self.assertEqual(sorted(rows), ['Bigco', 'Farco', 'Smallco', 'Walledco'])  # 'Nofeed' skipped
                self.assertTrue(rows['Bigco']['Active']['checkbox'])
                self.assertEqual(rows['Bigco']['ATS'], {'select': {'name': 'lever'}})
                self.assertFalse(rows['Smallco']['Active']['checkbox'])
                self.assertEqual(rows['Walledco']['Feed status'], {'select': {'name': 'Manual watch'}})
                research = list(rows.values())
                self.assertTrue(research[0]['Glassdoor']['url'].startswith('https://www.glassdoor.com/'))
                # Next run continues: nothing pending, nothing re-probed until its recheck date.
                summary, results = self.run_scout(db)
                self.assertEqual(results, [])

    def test_quality_rewards_relevant_roles_in_preferred_places(self):
        high, stats = scout.quality([posting(i) for i in range(5)] + [posting(9, salary='CHF 150k')])
        low, _ = scout.quality([posting(i, location='Seattle') for i in range(5)])
        self.assertGreater(high, 80)
        self.assertLess(low, 45)
        self.assertEqual(stats['swiss'], 6)

    def test_quality_place_bonus_uses_only_the_users_places(self):
        # The +10 place bonus once also matched a hard-coded "CH", so a user searching elsewhere got it for any Swiss posting (25 Oct 2026).
        import importlib
        own = {**scout_core._SEARCH, 'locations': {'top_tier': ['berlin'], 'country_wide': [], 'abroad': []}}
        try:
            with mock.patch.object(scout_core, '_SEARCH', own):
                reloaded = importlib.reload(scout_probe)
                self.assertIsNone(reloaded.SWISS_OR_ZURICH.search('Bern, CH'))
                self.assertTrue(reloaded.SWISS_OR_ZURICH.search('Berlin, Germany'))
        finally:
            importlib.reload(scout_probe)

    def test_central_judges_count_every_kind_of_job(self):
        # Owner, 19 Oct 2026: a job search across Europe for every role. The central scout read a care home's feed through the example
        # search's data-analyst titles, judged it "low" and published no places for it.
        care = [posting(i, title=title) for i, title in enumerate(('Registered Nurse', 'Warehouse Operative', 'Chef de partie', 'Care Assistant'))]
        with mock.patch.object(scout_core, 'CENTRAL', True):
            _, stats = scout.quality(care)
            self.assertEqual((stats['relevant'], stats['preferred']), (4, 4))
            self.assertEqual(scout.job_places(care), ['Zurich, Switzerland'])
        with mock.patch.object(scout_core, 'CENTRAL', False):   # an install's own scout still judges by its own roles
            _, stats = scout.quality(care)
            self.assertEqual(stats['relevant'], 0)
            self.assertEqual(scout.job_places(care), [])

    def test_detects_ats_in_links(self):
        self.assertEqual(ats.detect('https://job-boards.greenhouse.io/datadog/jobs/123'), ('greenhouse', 'datadog'))
        self.assertEqual(ats.detect('https://job-boards.greenhouse.io/embed/job_app?for=n26&token=7768035'),
                         ('greenhouse', 'n26'))
        self.assertEqual(ats.detect('https://boards.greenhouse.io/embed/job_board?for=acme'), ('greenhouse', 'acme'))
        from src.daily import _url_key
        embed = 'https://job-boards.greenhouse.io/embed/job_app?for=n26&token=7768035'
        careers = 'https://n26.com/en-eu/careers/positions/7768035?gh_jid=7768035'
        self.assertEqual(_url_key(embed), _url_key(careers))
        self.assertEqual(_url_key(embed), 'greenhouse:7768035')

    def test_an_embed_application_link_reads_the_same_board_posting(self):
        job = ats._job('7768035', 'Senior Site Reliability Engineer', 'Berlin',
                       'https://n26.com/en-eu/careers/positions/7768035?gh_jid=7768035', '',
                       'Own the platform and the access path. ' * 4)
        with mock.patch.object(ats, '_board', return_value=(job,)):
            found = ats.posting('https://job-boards.greenhouse.io/embed/job_app?for=n26&token=7768035')
        self.assertEqual(found['id'], '7768035')
        self.assertIn('Own the platform', found['description'])
        self.assertEqual(ats.detect('https://jobs.lever.co/palantir/abc'), ('lever', 'palantir'))
        self.assertEqual(ats.detect('https://jobs.ashbyhq.com/posthog'), ('ashby', 'posthog'))
        self.assertEqual(ats.detect('https://acme.jobs.personio.de/job/1'), ('personio', 'acme'))
        self.assertIsNone(ats.detect('https://example.com/careers'))
        self.assertEqual(ats.slug_guesses('Digitec Galaxus AG'), ['digitecgalaxus', 'digitec-galaxus', 'digitec'])

    def test_hacker_news_posts_become_candidates(self):
        def get(url):
            if 'search_by_date' in url:
                return {'hits': [{'title': 'Ask HN: Who is hiring? (September 2026)', 'objectID': '1'}]}
            return {'children': [
                {'text': 'Acme | SRE | Zurich or Remote (EU) | <a href="https://jobs.lever.co/acme/1">apply</a>'},
                {'text': 'Other | Sales | New York'}]}
        found = list(scout.hacker_news_candidates(get=get))
        self.assertEqual([(c['name'], c['ats'], c['slug']) for c in found], [('Acme', 'lever', 'acme')])



class ExportSourcesTests(unittest.TestCase):
    def test_merges_verifies_and_keeps_only_public_facts(self):
        stores = memory.open_store()
        for name, system, slug, notes in (('Anthropic', 'greenhouse', 'anthropic', 'applied twice'), ('Deadco', 'lever', 'deadco', ''),
                                          ('Cloudflare again', 'greenhouse', 'cloudflare', ''),   # already in the file: file name wins
                                          ('Custom site', 'taleo', 'x', '')):                     # not a crawlable feed type: skipped
            stores.employers.add({'name': name, 'ats': system, 'slug': slug, 'notes': notes})
        stores.employers.add({'name': 'Switched off', 'ats': 'lever', 'slug': 'off', 'active': False})   # not active: not exported

        def fetch(system, slug):
            if slug == 'deadco':
                raise TimeoutError('no answer')
            return [{}] * {'anthropic': 72, 'cloudflare': 380}[slug]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'sources.json'
            path.write_text(json.dumps([{'company': 'Cloudflare', 'board': 'cloudflare'}]))
            kept, failed = scout.export_sources(stores, path, fetch, today='2026-09-27')
            written = json.loads(path.read_text())
        self.assertEqual(written, kept)
        self.assertEqual(written, [
            {'company': 'Anthropic', 'ats': 'greenhouse', 'slug': 'anthropic', 'jobs': 72, 'checked': '2026-09-27'},
            {'company': 'Cloudflare', 'ats': 'greenhouse', 'slug': 'cloudflare', 'jobs': 380, 'checked': '2026-09-27'}])
        self.assertEqual([(f['company'], f['error']) for f in failed], [('Deadco', 'TimeoutError: no answer')])
        self.assertNotIn('applied', json.dumps(written))

    def test_exported_file_feeds_the_crawl(self):
        # The written entries are what feeds.scan and active_sources read.
        entry = {'company': 'Anthropic', 'ats': 'greenhouse', 'slug': 'anthropic', 'jobs': 72, 'checked': '2026-09-27'}
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'db') as db:
            sources = scout.active_sources(db, None, [entry])
        self.assertEqual([(s['company'], s['ats'], s['slug']) for s in sources], [('Anthropic', 'greenhouse', 'anthropic')])



class RunHeadlineTest(unittest.TestCase):
    def test_the_headline_keeps_the_counts_the_card_puts_on_its_second_line(self):
        from src import tgcard
        card = tgcard.card('New employer sources', tgcard.dot('7 checked', '2 new sources'), [tgcard.block('Not added', 'x')], '🔎')
        self.assertEqual(scout.run_headline(card), '🔎 New employer sources · 7 checked · 2 new sources')
        self.assertEqual(scout.run_headline(tgcard.card('Quiet', '')), 'Quiet')

if __name__ == '__main__':
    unittest.main()


class QueueTests(unittest.TestCase):
    """7 Oct 2026: 609 ideas waited while the app probed 15 a run and each run added ~200."""
    def test_a_long_queue_is_probed_faster(self):
        from src.scout import batch_for
        self.assertEqual(batch_for(0), 40)
        self.assertEqual(batch_for(609), 100)
        self.assertEqual(batch_for(300), 50)
        self.assertEqual(batch_for(10, 15), 15)


class RunwayTests(unittest.TestCase):
    def test_how_many_searches_before_most_employers_rest(self):
        from src.sources.feeds import runway
        now = '2026-10-07T03:00:00+00:00'
        rows = [(3, None)] * 242 + [(1, None)] * 7 + [(2, None)]
        self.assertEqual(runway(rows, now)['soon'], {'runs': 2, 'count': 242})
        resting = runway([(5, '2026-10-14T03:00:00+00:00')] * 3 + [(0, None)], now)
        self.assertEqual((resting['resting'], resting['until'], resting['soon']), (3, '2026-10-14T03:00:00+00:00', None))
