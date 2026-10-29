"""Opt-in contributions: only public facts and coarse tags leave, only when switched on, at most daily, never fatal."""
import json
import re
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import contribute  # noqa: E402
from src.stores import memory  # noqa: E402
from site_private import assert_site_accepts, needs_site  # noqa: E402

NOW = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
SEARCH = {'role_keywords': ['site reliability', '\\bsre\\b', 'platform engineer', 'security engineer'],
          'locations': {'top_tier': ['\\bzurich\\b', 'london'], 'country_wide': ['switzerland'], 'abroad': []}}
FEEDS = [{'company': 'Matched Co', 'ats': 'lever', 'slug': 'matched'}, {'company': 'Quiet Co', 'ats': 'lever', 'slug': 'quiet'},
         {'company': 'Mine Co', 'ats': 'greenhouse', 'slug': 'mine'}, {'company': 'Odd', 'ats': 'nonsense', 'slug': 'x'}]
REPORT = {'sources': [{'company': 'Matched Co', 'ok': True, 'total': 9, 'matches': 2}, {'company': 'Quiet Co', 'ok': True, 'total': 5, 'matches': 0}]}


from tests.model_stand_ins import answers  # noqa: E402 (the model's answers)
def own_list():
    """A store holding one employer the user added themselves (any adapter: the memory one here)."""
    stores = memory.open_store()
    stores.employers.add({'name': 'Mine Co', 'ats': 'greenhouse', 'slug': 'mine'})
    return stores


class TagsTest(unittest.TestCase):
    def test_tags_come_from_fixed_lists_only(self):
        with answers({'pool-role': {'site reliability': 'sre_devops', 'sre': 'sre_devops', 'platform engineer': 'sre_devops', 'security engineer': 'security'},
                      'pool-region': {'zurich': 'europe', 'london': 'europe', 'switzerland': 'europe'}}):
            roles, regions = contribute.tags(SEARCH)
        self.assertEqual(roles, ['security', 'sre_devops'])
        self.assertEqual(regions, ['europe'])
        for value in [*roles, *regions]:
            self.assertIn(value, {*contribute.ROLES, *contribute.REGIONS, 'other'})

    def test_unknown_profile_is_other_and_no_region(self):
        with answers({}):
            self.assertEqual(contribute.tags({'role_keywords': ['florist'], 'locations': {}}), (['other'], []))


class PayloadTest(unittest.TestCase):
    def test_every_feed_read_or_own_and_only_public_facts(self):
        body = contribute.payload(FEEDS, REPORT, own_list(), install='abc-12345678', search=SEARCH)
        self.assertEqual({(f['slug'], f['matched'], f['own']) for f in body['feeds']},
                         {('matched', True, False), ('mine', False, True), ('quiet', False, False)})   # 'quiet' was read with no match: sent since 7 Oct 2026; 'nonsense' is not a feed system
        self.assertEqual(set(body), {'v', 'install', 'roles', 'regions', 'countries', 'metros', 'families', 'feeds'})
        self.assertEqual(body['v'], 2)
        self.assertEqual(set(body['feeds'][0]), {'ats', 'slug', 'company', 'matched', 'own', 'how', 'site', 'failed', 'jobs', 'hits'} & set(body['feeds'][0]) | {'ats', 'slug', 'company', 'matched', 'own', 'how', 'site', 'failed'})
        for feed in body['feeds']:
            self.assertLessEqual(set(feed), {'ats', 'slug', 'company', 'matched', 'own', 'how', 'site', 'failed', 'jobs', 'hits'}, 'only public facts and counts')
        self.assertNotIn('Zurich', json.dumps(body))    # no search text: only fixed tags


class SendTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.stamp = Path(self.tmp.name) / 'sent.json'
        self.env = {'JOB_PILOTTO_SHARE_EMPLOYERS': '1', 'JOB_PILOTTO_INSTALL_ID': 'abc-12345678'}

    def tearDown(self):
        self.tmp.cleanup()

    def test_off_by_default_and_needs_an_install_id(self):
        self.assertFalse(contribute.enabled({}))
        self.assertFalse(contribute.enabled({'JOB_PILOTTO_SHARE_EMPLOYERS': '1'}))
        self.assertFalse(contribute.enabled({**self.env, 'JOB_PILOTTO_DISABLE': 'contribute'}))
        self.assertTrue(contribute.enabled(self.env))

    def test_nothing_is_sent_unless_opted_in(self):
        posts = []
        with mock.patch.dict('os.environ', {}, clear=True):
            self.assertFalse(contribute.maybe_send(FEEDS, REPORT, None, post=posts.append, stamp=self.stamp, search=SEARCH, now=NOW))
        self.assertEqual(posts, [])

    def test_sends_after_every_run_and_survives_a_dead_service(self):
        posts = []
        with mock.patch.dict('os.environ', self.env, clear=True):
            ok = lambda request: posts.append(request) or 200  # noqa: E731
            self.assertTrue(contribute.maybe_send(FEEDS, REPORT, None, post=ok, stamp=self.stamp, search=SEARCH, now=NOW, url='https://x.test/c'))
            self.assertTrue(contribute.maybe_send(FEEDS, REPORT, None, post=ok, stamp=self.stamp, search=SEARCH, now=NOW + timedelta(minutes=1)),
                            'no wait between runs: data is shared as it is produced')
            self.assertEqual(len(posts), 2)
            self.assertEqual(json.loads(posts[0].data)['install'], 'abc-12345678')

            def down(request):
                raise OSError('offline')
            self.stamp.unlink()
            self.assertFalse(contribute.maybe_send(FEEDS, REPORT, None, post=down, stamp=self.stamp, search=SEARCH, now=NOW))
            self.assertFalse(self.stamp.exists())   # not marked as sent: tried again next run
            self.assertFalse(contribute.maybe_send(FEEDS, REPORT, None, post=lambda r: 429, stamp=self.stamp, search=SEARCH, now=NOW))


if __name__ == '__main__':
    unittest.main()


class TradeTagsTests(unittest.TestCase):
    @needs_site
    def test_every_role_tag_the_app_sends_is_one_the_website_keeps(self):
        """6 Oct 2026: a photographer's shares were all tagged 'other' (the tags knew only IT); the site drops a tag it does not list."""
        import re
        from src import contribute, role_kinds
        # the tag list moved from api/pool.js to shared/pool-labels.js (20 Oct 2026, the site's folder split): read whichever the tree has
        root = Path(__file__).resolve().parents[1]
        site = next(p for p in (root / 'shared' / 'pool-labels.js', root / 'api' / 'pool.js') if p.exists()).read_text()
        accepted = set(re.findall(r"'(\w+)'", re.search(r'export const ROLES = \[([^\]]+)\]', site).group(1)))
        sendable = set(contribute.ROLES) | set(contribute.TRADE_ROLES) | {'other'}
        assert_site_accepts(self, sendable, accepted, 'role tags')
        self.assertEqual(set(contribute.TRADE_ROLES), set(role_kinds.KINDS) - {'software', 'other'})
        roles, _ = contribute.tags({'role_keywords': ['vendeu(r|se)', 'magasinier', 'photograph(e|er)?'], 'locations': {'top_tier': ['geneva']}})
        self.assertEqual(roles, ['creative_media', 'logistics', 'sales_retail'])


class FoundHereTests(unittest.TestCase):
    def test_every_feed_the_scout_verified_is_shared_with_how_it_was_found(self):
        """6 Oct 2026: only feeds that had matched a job went, so Coop or Manor stayed on the Mac until one of their jobs matched."""
        import sqlite3
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE feed_sources (ats TEXT, slug TEXT, company TEXT, active INTEGER)')
        db.execute('CREATE TABLE scout_candidates (ats TEXT, slug TEXT, origin TEXT, careers TEXT)')
        db.execute("INSERT INTO feed_sources VALUES ('successfactors', 'jobs.coop.ch', 'Coop', 1)")
        db.execute("INSERT INTO scout_candidates VALUES ('successfactors', 'jobs.coop.ch', 'AI idea 2026-10-06', 'https://jobs.coop.ch/')")
        feeds = [{'company': 'Coop', 'ats': 'successfactors', 'slug': 'jobs.coop.ch'}]
        report = {'sources': [{'company': 'Coop', 'ok': True, 'total': 3142, 'matches': 0}]}
        body = contribute.payload(feeds, report, None, install='abc-12345678', search=SEARCH, db=db)
        self.assertEqual(body['feeds'], [{'ats': 'successfactors', 'slug': 'jobs.coop.ch', 'company': 'Coop', 'matched': False, 'own': False,
                                         'how': 'ai_idea', 'site': 'https://jobs.coop.ch/', 'jobs': 3142, 'hits': 0, 'failed': False}])

    @needs_site
    def test_the_words_the_app_sends_for_how_a_feed_was_found_are_the_ones_the_site_keeps(self):
        assert_site_accepts(self, set(word for _, word in contribute.HOW) | {'index', 'own', 'other'},
                            re.findall(r"'(\w+)'", re.search(r'export const HOW = \[([^\]]+)\]',
                                (Path(__file__).resolve().parents[1] / 'api' / 'pool.js').read_text()).group(1)),
                            'how a feed was found')


class DeadEndTests(unittest.TestCase):
    def test_no_readable_job_site_is_shared_and_then_skipped_by_other_installs(self):
        """6 Oct 2026: every install probed the same employers with no readable job site."""
        import sqlite3
        from datetime import datetime, timezone
        from src import employer_index, scout
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE scout_candidates (name TEXT, website TEXT, status TEXT, checked_at TEXT, checked_with TEXT)')
        today = datetime.now(timezone.utc).isoformat(timespec='seconds')
        db.execute("INSERT INTO scout_candidates VALUES ('Fnac Suisse', 'https://www.fnac.ch/fr', 'none', ?, ?)", (today, scout.READERS))
        db.execute("INSERT INTO scout_candidates VALUES ('Old Readers', 'https://old.ch', 'none', ?, 'aaaaaaaaaaaa')", (today,))
        self.assertEqual(contribute.dead_ends(db), [{'company': 'Fnac Suisse', 'host': 'fnac.ch', 'outcome': 'no_feed'}], 'only what the current readers found')
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / 'index.json'
            cache.write_text(json.dumps({'feeds': [], 'nofeed': [{'key': 'fnacsuisse', 'last': today[:10]}, {'key': 'stale', 'last': '2020-01-01'}]}))
            self.assertEqual(employer_index.central_nofeed(cache), {'fnacsuisse'}, 'older than 30 days: probed again')
            week_ago = (datetime.now(timezone.utc) - timedelta(days=10)).date().isoformat()
            cache.write_text(json.dumps({'feeds': [], 'nofeed': [{'key': 'down', 'last': week_ago, 'outcome': 'unreachable'},
                                                               {'key': 'shut', 'last': week_ago, 'outcome': 'refused'}]}))
            self.assertEqual(employer_index.central_nofeed(cache), {'shut'}, 'a site that was down rests 7 days, a refusal 30')


class ShareNowTests(unittest.TestCase):
    """6 Oct 2026, owner: send what an install learns right away, so closing the app loses nothing."""
    def test_one_find_or_one_dead_end_goes_at_once_and_only_when_sharing_is_on(self):
        posts = []
        ok = lambda request: posts.append(json.loads(request.data)) or 200  # noqa: E731
        on = {'JOB_PILOTTO_SHARE_EMPLOYERS': '1', 'JOB_PILOTTO_INSTALL_ID': 'abc-12345678'}
        with mock.patch.dict('os.environ', on, clear=True), mock.patch.object(contribute, 'tags', lambda search=None: (['sales_retail'], ['europe'])):
            self.assertTrue(contribute.share_now(feed={'ats': 'successfactors', 'slug': 'jobs.coop.ch', 'company': 'Coop', 'how': 'ai_idea'}, post=ok, url='https://x.test/c'))
            self.assertTrue(contribute.share_now(dead={'company': 'Fnac Suisse', 'host': 'fnac.ch'}, post=ok, url='https://x.test/c'))
        self.assertEqual([len(p['feeds']) for p in posts], [1, 0])
        self.assertEqual(posts[1]['nofeed'], [{'company': 'Fnac Suisse', 'host': 'fnac.ch'}])
        self.assertEqual(posts[0]['feeds'][0]['how'], 'ai_idea')
        with mock.patch.dict('os.environ', {}, clear=True):
            self.assertFalse(contribute.share_now(feed={'ats': 'lever', 'slug': 'x', 'company': 'X'}, post=ok))
        self.assertEqual(len(posts), 2, 'sharing off: nothing sent')

    def test_the_scout_sends_each_verified_employer_and_dead_end_as_it_records_it(self):
        from src import scout, scout_probe, store as job_store
        sent = []
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, \
                mock.patch.object(contribute, 'share_now', lambda feed=None, dead=None, **k: sent.append('feed' if feed else 'dead') or True):
            seeds = {'excluded': [], 'tier1_known': [], 'tier1': [], 'manual_watch': [], 'regional': {}, 'tech_only': False}
            names = [dict(name='Found Co', origin='AI idea 2026-10-06', priority=92, ats='lever', slug='found'), dict(name='Nothing Co', origin='AI idea 2026-10-06', priority=91, website='https://nothing.example')]
            probe = lambda system, slug: [{'title': 'Vendeur', 'location': 'Geneva', 'url': 'u', 'description': ''}] * 3 if slug == 'found' else None
            fake_quality = lambda jobs: (80, {'preferred': 2, 'relevant': 3, 'jobs': len(jobs)})  # noqa: E731
            with mock.patch.object(scout.careers, 'discover', lambda url: None), \
                    mock.patch.object(scout_probe, 'quality', fake_quality), mock.patch.object(scout, 'quality', fake_quality):   # run() and find_feed() each look it up in their own module
                scout.run(db, 5, None, seeds, probe, harvest_sources=[lambda: names])
        self.assertEqual(sorted(sent), ['dead', 'feed'])


class EveryReadTests(unittest.TestCase):
    """7 Oct 2026, owner: "let's fix these gaps": every feed read (also with 0 matches) and every job board, by fixed name."""
    def test_a_feed_read_with_no_match_and_each_board_go_up_with_counts_only(self):
        feed_list = [{'ats': 'lever', 'slug': 'matched', 'company': 'Matched'}, {'ats': 'greenhouse', 'slug': 'quiet', 'company': 'Quiet'},
                     {'ats': 'greenhouse', 'slug': 'broken', 'company': 'Broken'}]
        report = {'sources': [{'company': 'Matched', 'ok': True, 'total': 40, 'matches': 2}, {'company': 'Quiet', 'ok': True, 'total': 12, 'matches': 0},
                              {'company': 'Broken', 'ok': False, 'error': 'HTTPError: 500'},
                              {'company': 'jobs.ch', 'ok': True, 'total': 300, 'matches': 9},
                              {'company': 'Google Jobs: photographe / Genève', 'ok': True, 'total': 10, 'matches': 1},
                              {'company': 'Google Jobs: assistant photo / Lausanne', 'ok': True, 'total': 5, 'matches': 0},
                              {'company': 'LinkedIn alerts', 'ok': True, 'total': 7, 'matches': 3},
                              {'company': 'Some private thing', 'ok': True, 'total': 1, 'matches': 1}]}
        with mock.patch.object(contribute, 'tags', lambda search=None: (['creative_media'], ['europe'])):
            body = contribute.payload(feed_list, report, None, install='abc-12345678')
        by = {f['slug']: f for f in body['feeds']}
        self.assertEqual(set(by), {'matched', 'quiet', 'broken'})
        self.assertEqual((by['quiet']['matched'], by['quiet']['jobs'], by['quiet']['hits'], by['quiet']['how']), (False, 12, 0, 'index'))
        self.assertTrue(by['broken']['failed'])
        boards = {b['board']: b for b in body['boards']}
        self.assertEqual(set(boards), {'jobsch', 'google_jobs', 'alerts_linkedin'}, 'only fixed names; queries and places never leave')
        self.assertEqual((boards['google_jobs']['jobs'], boards['google_jobs']['hits']), (15, 1), 'one line per board, summed')
        self.assertNotIn('photographe', json.dumps(body))

    def test_a_today_check_shares_too(self):
        source = Path(__file__).resolve().parents[1] / 'src' / 'daily_search.py'
        self.assertIn("args.mode in ('scheduled', 'run', 'today'):\n        try:  # opt-in", source.read_text())


class OnlyChangedTests(unittest.TestCase):
    """7 Oct 2026, scale: only what changed goes up, plus each item once a day; nothing is marked unless the site took it."""
    def test_unchanged_items_wait_a_day_changed_ones_go_and_a_refusal_marks_nothing(self):
        import sqlite3
        db = sqlite3.connect(':memory:')
        body = {'v': 2, 'roles': ['creative_media'], 'regions': ['europe'], 'feeds': [{'ats': 'lever', 'slug': 'a', 'matched': True, 'own': False, 'failed': False, 'how': 'index', 'site': None, 'hits': 2, 'jobs': 100}],
                'boards': [{'board': 'jobsch', 'jobs': 300, 'hits': 9, 'failed': False}], 'nofeed': [{'company': 'Fnac', 'host': 'fnac.ch'}]}
        first, marks = contribute.only_changed(db, body, NOW)
        self.assertEqual((len(first['feeds']), len(first['boards']), len(first['nofeed'])), (1, 1, 1))
        again, _ = contribute.only_changed(db, body, NOW)
        self.assertEqual(len(again['feeds']), 1, 'not marked yet (the send failed): sent again')
        contribute.mark_sent(db, marks, NOW)
        same, _ = contribute.only_changed(db, body, NOW + timedelta(hours=1))
        self.assertEqual((same['feeds'], 'boards' in same, 'nofeed' in same), ([], False, False))
        nudged = json.loads(json.dumps(body))
        nudged['feeds'][0]['jobs'] = 105   # a few jobs more: not a change
        nudged['boards'][0]['hits'] = 10   # one more match: a change
        changed, _ = contribute.only_changed(db, nudged, NOW + timedelta(hours=1))
        self.assertEqual((changed['feeds'], [b['board'] for b in changed['boards']]), ([], ['jobsch']))
        later, _ = contribute.only_changed(db, body, NOW + timedelta(hours=21))
        self.assertEqual(len(later['feeds']), 1, 'once a day anyway: the site keeps it as still read')


class OutcomeTests(unittest.TestCase):
    """7 Oct 2026, owner: what each feed and board led to (strong fit, saved, applied, interview, offer) and the traits of its matches, as counts."""
    def test_outcomes_traits_and_board_duplicates_are_counted_by_fixed_names(self):
        from src import store
        from src.ai import enrich, score
        with tempfile.TemporaryDirectory() as tmp, store.connect(Path(tmp) / 'jobs.sqlite') as db:
            db.execute('CREATE TABLE IF NOT EXISTS scores (job_id INTEGER PRIMARY KEY, scorer_version INTEGER, input_hash TEXT, model TEXT, created_at TEXT, data_json TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS enrichments (job_id INTEGER PRIMARY KEY, extractor_version INTEGER, description_hash TEXT, model TEXT, created_at TEXT, data_json TEXT)')
            now = datetime.now(timezone.utc).isoformat(timespec='seconds')
            db.execute("INSERT INTO companies (id, name, updated_at) VALUES (1, 'Migros', ?)", (now,))
            db.executemany('INSERT INTO sources (id, name, kind) VALUES (?, ?, ?)', [(1, 'Migros', 'employer feed'), (2, 'Google Jobs', 'job board'), (3, 'LinkedIn alert', 'job board')])
            jobs = [(1, 1, 'https://m/1', 85, 'Interviewing'), (2, 1, 'https://m/2', 72, 'Applied'), (3, 1, 'https://m/3', 40, None), (4, 2, 'https://g/1', 90, 'Saved'), (5, 3, 'https://l/1', 75, 'Offer')]
            for job_id, source, url, fit, _ in jobs:
                db.execute("INSERT INTO jobs (id, canonical_key, source_id, company_id, title, url, first_seen_at, last_seen_at) VALUES (?, ?, ?, 1, 'Vendeur', ?, ?, ?)", (job_id, url, source, url, now, now))
                db.execute('INSERT INTO scores (job_id, data_json) VALUES (?, ?)', (job_id, json.dumps({'score': fit})))
                db.execute('INSERT INTO enrichments (job_id, data_json) VALUES (?, ?)', (job_id, json.dumps({'languages': [{'language': 'French', 'level': 'required'}],
                           'seniority': {'value': 'junior'}, 'work_mode': {'value': 'onsite'}})))
            stages = {url: stage for _, _, url, _, stage in jobs if stage}
            led = contribute.outcomes(db, stages)
            self.assertEqual({k: led['Migros'][k] for k in ('strong', 'saved', 'applied', 'interview', 'offer')}, {'strong': 2, 'saved': 2, 'applied': 2, 'interview': 1, 'offer': 0},
                             'an interview was applied to and saved: each step counts the ones after it')
            self.assertEqual((led['Migros']['langs'], led['Migros']['senior']), ({'French': 3}, {'junior': 3}))
            feed_list = [{'ats': 'successfactors', 'slug': 'migros', 'company': 'Migros'}]
            report = {'sources': [{'company': 'Migros', 'ok': True, 'total': 50, 'matches': 3}, {'company': 'Google Jobs: vendeur / Genève', 'ok': True, 'total': 20, 'matches': 2},
                                  {'company': 'LinkedIn alerts', 'ok': True, 'total': 4, 'matches': 1}],
                      'jobs': [{'source': 'Google Jobs', 'company': 'Migros'}, {'source': 'Google Jobs', 'company': 'Small Shop'}]}
            with mock.patch.object(contribute, 'tags', lambda search=None: (['sales_retail'], ['europe'])):
                body = contribute.payload(feed_list, report, None, install='abc-12345678', db=db, stages=stages)
        self.assertEqual(body['feeds'][0]['out']['interview'], 1)
        boards = {b['board']: b for b in body['boards']}
        self.assertEqual((boards['google_jobs']['dup'], boards['google_jobs']['out']['saved']), (1, 1), 'one Google match was Migros, read directly too')
        self.assertEqual(boards['alerts_linkedin']['out']['offer'], 1, '"LinkedIn alert" in the job store is the LinkedIn alerts board')
        self.assertNotIn('Vendeur', json.dumps(body))
        self.assertNotIn('https://m/1', json.dumps(body))


class SiteFactsTests(unittest.TestCase):
    """Facts about sites go to the pool (7 Oct 2026): job pages, browser-only sites, dead pages; never a query (someone's own filters)."""
    def test_site_facts_are_public_and_carry_no_filters(self):
        import tempfile
        from pathlib import Path
        from unittest import mock
        from src import contribute
        from src.sources import visits
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(visits, 'STORE', Path(tmp) / 'visits.json'):
            visits._save({'jobpages': {'www.iwc.com': 'https://careers.richemont.com/en/jobs/iwc?location=Geneva#jp-read-x', 'bad': 'javascript:x'},
                          'sites': {'h': {'company': 'Bulgari', 'url': 'https://bulgari.recruitmentplatform.com/FO/x'}},
                          'jobpage_bad': {'https://www.franckmuller.com/careers?lang=fr': '2026-10-07'}})
            facts = contribute.site_facts()
        self.assertEqual(facts, [{'host': 'iwc.com', 'kind': 'jobpage', 'url': 'https://careers.richemont.com/en/jobs/iwc'},
                                 {'host': 'bulgari.recruitmentplatform.com', 'kind': 'browser'},
                                 {'host': 'franckmuller.com', 'kind': 'dead', 'url': 'https://www.franckmuller.com/careers'}])


class LayoutShareTests(unittest.TestCase):
    def test_only_proven_layouts_learned_here_are_shared(self):
        import tempfile
        from pathlib import Path
        from unittest import mock
        from src import contribute
        from src.sources import visits
        good = {'selector': 'main > div.card', 'title': 0, 'company': -1, 'place': 2, 'link': 0, 'next': 'none', 'why': 'x'}
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(visits, 'STORE', Path(tmp) / 'visits.json'):
            visits._save({'recipes': {'a.test': {'recipe': good}, 'b.test': {'recipe': good, 'missed': 1}, 'c.test': {'recipe': good, 'pooled': True},
                                      'd.test': {'recipe': good}}, 'reads': {'a.test': {'jobs': 12}, 'b.test': {'jobs': 3}, 'c.test': {'jobs': 4}, 'd.test': {'jobs': 0}}})
            layouts = [f for f in contribute.site_facts() if f['kind'] == 'layout']
        self.assertEqual(layouts, [{'host': 'a.test', 'kind': 'layout', 'recipe': {k: v for k, v in good.items() if k != 'why'}}],
                         'a.test only: b missed once, c came from the pool, d read no jobs; never Claude\'s words')
