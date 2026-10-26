"""The central employer index: download at most daily, cache, merge with the starter list, never fail a run."""
import sqlite3
import json
import sys
import tempfile
import unittest
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import employer_index, scout  # noqa: E402
from src import store as job_store  # noqa: E402

NOW = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
FEEDS = [{'company': 'Bigco', 'ats': 'lever', 'slug': 'bigco', 'quality': 80, 'checked': '2026-09-30'},
         {'company': 'Weird', 'ats': 'nonsense', 'slug': 'x'}, 'junk', {'company': 'NoSlug', 'ats': 'lever'}]


def server(calls, status=200, feeds=FEEDS, etag='"v1"'):
    def get(url, headers):
        calls.append((url, headers))
        if status == 304:
            return 304, '', None
        return status, json.dumps({'feeds': feeds}), etag
    return get


class LoadTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = Path(self.tmp.name) / 'index.json'

    def tearDown(self):
        self.tmp.cleanup()

    def test_downloads_cleans_and_caches(self):
        calls = []
        feeds = employer_index.load(self.cache, 'https://x.test/api/index', server(calls), NOW)
        self.assertEqual([f['slug'] for f in feeds], ['bigco'])   # unknown ATS, junk and slug-less entries dropped
        self.assertEqual(len(calls), 1)
        self.assertTrue(self.cache.exists())

    def test_sends_an_index_token_and_a_stable_install_id(self):
        calls, minted = [], []
        def mint(base, install):
            minted.append((base, install))
            return 'tok-' + install
        employer_index.load(self.cache, 'https://x.test/api/index', server(calls), NOW, mint=mint)
        headers = calls[0][1]
        install = headers['X-Install-Id']
        self.assertRegex(install, r'^[0-9a-f]{24}$')                      # random, local, nothing about the user
        self.assertEqual(headers['Authorization'], f'Bearer tok-{install}')
        self.assertEqual(minted, [('https://x.test', install)])
        employer_index.load(self.cache, 'https://x.test/api/index', server(calls), NOW + timedelta(hours=21), mint=mint)
        self.assertEqual(calls[1][1]['X-Install-Id'], install)             # the same id on the next download

    def test_the_shared_install_id_wins_when_set(self):
        calls = []
        employer_index.load(self.cache, 'u', server(calls), NOW, install_id='shared-install-1', mint=lambda base, install: 't')
        self.assertEqual(calls[0][1]['X-Install-Id'], 'shared-install-1')

    def test_no_token_still_tries_and_a_refusal_falls_back_to_the_cache(self):
        calls = []
        employer_index.load(self.cache, 'u', server(calls), NOW, mint=lambda base, install: '')
        self.assertNotIn('Authorization', calls[0][1])                     # a website in soft mode may still answer
        def refused(url, headers):
            raise urllib.error.HTTPError(url, 401, 'token needed', {}, None)
        feeds = employer_index.load(self.cache, 'u', refused, NOW + timedelta(days=2), mint=lambda base, install: '')
        self.assertEqual([f['slug'] for f in feeds], ['bigco'])            # the old cache, and the run says why
        self.assertIn('401', employer_index.problem)

    def test_at_most_hourly(self):   # was daily until 7 Oct 2026; an unchanged list is a cheap 304 now
        calls = []
        employer_index.load(self.cache, 'u', server(calls), NOW)
        again = employer_index.load(self.cache, 'u', server(calls), NOW + timedelta(minutes=30))
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(again), 1)
        employer_index.load(self.cache, 'u', server(calls), NOW + timedelta(hours=1))
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][1]['If-None-Match'], '"v1"')   # revalidates instead of re-downloading

    def test_not_modified_keeps_the_cache(self):
        employer_index.load(self.cache, 'u', server([]), NOW)
        feeds = employer_index.load(self.cache, 'u', server([], status=304), NOW + timedelta(days=2))
        self.assertEqual([f['slug'] for f in feeds], ['bigco'])
        self.assertEqual(json.loads(self.cache.read_text())['fetched'], (NOW + timedelta(days=2)).isoformat(timespec='seconds'))

    def test_service_down_uses_the_old_cache(self):
        employer_index.load(self.cache, 'u', server([]), NOW)

        def down(url, headers):
            raise urllib.error.URLError('offline')
        feeds = employer_index.load(self.cache, 'u', down, NOW + timedelta(days=9), retry_wait=0)
        self.assertEqual([f['slug'] for f in feeds], ['bigco'])

    def test_a_blip_is_retried_once_before_giving_up(self):
        calls = []
        base = server(calls)

        def blip(url, headers):
            if not calls:
                calls.append('failed')
                raise urllib.error.URLError('blip')
            return base(url, headers)
        feeds = employer_index.load(self.cache, 'u', blip, NOW, retry_wait=0)
        self.assertEqual([f['slug'] for f in feeds], ['bigco'])
        self.assertEqual(employer_index.problem, '')

    def test_service_down_and_no_cache_is_empty_not_an_error(self):
        def down(url, headers):
            raise urllib.error.URLError('offline')
        self.assertEqual(employer_index.load(self.cache, 'u', down, NOW, retry_wait=0), [])
        self.assertIn('offline', employer_index.problem)
        self.assertFalse(self.cache.exists())

    def test_garbage_answers_and_a_corrupt_cache_are_survived(self):
        self.cache.write_text('{not json')
        bad = lambda url, headers: (200, '<html>oops</html>', None)  # noqa: E731
        self.assertEqual(employer_index.load(self.cache, 'u', bad, NOW), [])

    def test_an_invalid_install_id_is_replaced_by_a_random_local_one(self):
        calls = []
        employer_index.load(self.cache, 'u', server(calls), NOW, install_id='abc-12345678')
        self.assertEqual(calls[0][1]['X-Install-Id'], 'abc-12345678')
        self.cache.unlink()
        calls.clear()
        employer_index.load(self.cache, 'u', server(calls), NOW, install_id='has spaces / and slashes')
        self.assertNotEqual(calls[0][1]['X-Install-Id'], 'has spaces / and slashes')   # not sent as given: a random local id instead
        self.assertRegex(calls[0][1]['X-Install-Id'], r'^[0-9a-f]{24}$')


class MergeTest(unittest.TestCase):
    STARTER = [{'company': 'Starter Name', 'ats': 'lever', 'slug': 'bigco', 'jobs': 3},
               {'company': 'Old', 'board': 'oldco'}]

    def test_starter_wins_and_index_adds(self):
        merged = employer_index.merge(self.STARTER, [{'company': 'Bigco', 'ats': 'lever', 'slug': 'bigco'},
                                                    {'company': 'Farco', 'ats': 'greenhouse', 'slug': 'farco'}])
        self.assertEqual([m['company'] for m in merged], ['Starter Name', 'Old', 'Farco'])

    def test_offline_the_starter_list_alone_works(self):
        self.assertEqual(len(employer_index.merge(self.STARTER, [])), 2)

    def test_active_sources_merges_index_local_feeds_and_exclusions(self):
        index = [{'company': 'Farco', 'ats': 'greenhouse', 'slug': 'farco'},
                 {'company': 'My Employer AG', 'ats': 'ashby', 'slug': 'mine'}]
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict('os.environ', {'JOB_PILOTTO_EXCLUDED_COMPANIES': 'My Employer'}):
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                sources = scout.active_sources(db, None, self.STARTER, index)
        self.assertEqual({(s.get('ats', 'greenhouse'), s.get('slug') or s['board']) for s in sources},
                         {('lever', 'bigco'), ('greenhouse', 'oldco'), ('greenhouse', 'farco')})


class RelevantTest(unittest.TestCase):
    def test_only_feeds_with_roles_in_my_places_and_feeds_without_info(self):
        from src.sources import feeds
        index = [{'company': 'Zh', 'ats': 'lever', 'slug': 'zh', 'places': ['Zurich, Switzerland', 'Tokyo']},
                 {'company': 'Jp', 'ats': 'lever', 'slug': 'jp', 'places': ['Tokyo, Japan']},
                 {'company': 'Old', 'ats': 'lever', 'slug': 'old', 'places': None},
                 {'company': 'Rem', 'ats': 'lever', 'slug': 'rem', 'places': ['Remote']}]
        where = lambda job: 'zurich' in job['location'].lower() or 'remote' in job['location'].lower()  # noqa: E731
        self.assertEqual([f['company'] for f in employer_index.relevant(index, where)], ['Zh', 'Old', 'Rem'])
        self.assertEqual(employer_index.relevant(index, feeds.wanted_location)[1]['company'], 'Old')  # the real matcher

    def test_daily_uses_the_filter_unless_asked_for_everything(self):
        from src import daily, features
        index = [{'company': 'Zh', 'ats': 'lever', 'slug': 'zh', 'places': ['Nowhere-land']}]
        # The run's own switches (JOB_PILOTTO_DISABLE, keys present) must not decide this test.
        self.enterContext(mock.patch.object(features, 'disabled', lambda name: False))
        with mock.patch.object(employer_index, 'load', return_value=index), \
                mock.patch.dict('os.environ', {'JOB_PILOTTO_INDEX_ALL': ''}):
            self.assertEqual(daily.downloaded_index(), [])
        with mock.patch.object(employer_index, 'load', return_value=index), \
                mock.patch.dict('os.environ', {'JOB_PILOTTO_INDEX_ALL': '1'}):
            self.assertEqual(len(daily.downloaded_index()), 1)


class BuildAndPublishTest(unittest.TestCase):
    def fetch(self, system, slug):
        if slug == 'dead':
            raise urllib.error.URLError('gone')
        return [{'id': '1', 'title': 'Site Reliability Engineer', 'location': 'Zurich, Switzerland', 'url': 'u',
                 'date_posted': '2099-01-01', 'description': 'Kubernetes', 'remote': False, 'salary': ''}]

    def test_build_verifies_every_feed_and_drops_dead_ones(self):
        starter = [{'company': 'Bigco', 'ats': 'lever', 'slug': 'bigco'}, {'company': 'Dead', 'ats': 'lever', 'slug': 'dead'}]
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'j.sqlite') as db:
            db.executescript(scout.TABLES)
            db.execute("INSERT INTO feed_sources (ats, slug, company, tier, quality, added_at) VALUES "
                       "('ashby', 'found', 'Found Co', 'Tier 1', 50, '2026-09-30')")
            feeds, failed = scout.build_index(db, starter, self.fetch, today='2026-09-30')
        self.assertEqual([f['company'] for f in feeds], ['Bigco', 'Found Co'])
        self.assertEqual(feeds[1]['tier'], 'Tier 1')
        self.assertTrue(all(f['checked'] == '2026-09-30' and 0 < f['quality'] <= 100 for f in feeds))
        self.assertEqual([f['company'] for f in failed], ['Dead'])
        self.assertEqual(feeds[0]['places'], ['Zurich, Switzerland'])
        self.assertEqual(feeds[0]['countries'], ['ch'])   # where its jobs are, as fixed ids: the kind × country coverage (19 Oct 2026)
        self.assertEqual({f['kind'] for f in feeds}, {'employer'})

    def test_publish_sends_the_key_and_refuses_empty(self):
        seen = []

        def send(request):
            seen.append(request)
            return 200
        self.assertEqual(scout.publish_index([{'company': 'A', 'ats': 'lever', 'slug': 'a'}], 'https://x.test/api/index', 'k3y', send), 1)
        self.assertEqual(seen[0].get_method(), 'PUT')
        self.assertEqual(seen[0].get_header('Authorization'), 'Bearer k3y')
        self.assertEqual(json.loads(seen[0].data)['feeds'][0]['slug'], 'a')
        with self.assertRaises(ValueError):
            scout.publish_index([], 'https://x.test/i', 'k', send)
        with self.assertRaises(RuntimeError):
            scout.publish_index([{'company': 'A', 'ats': 'lever', 'slug': 'a'}], 'https://x.test/i', 'k', lambda r: 401)


if __name__ == '__main__':
    unittest.main()


class CentralLocationsTest(unittest.TestCase):
    def test_locations_file_replaces_places_only(self):
        from src import paths
        plain = paths.load_search_config()
        with mock.patch.dict('os.environ', {'JOB_PILOTTO_LOCATIONS_FILE': str(paths.ROOT / 'config' / 'central_locations.json')}):
            central = paths.load_search_config()
        self.assertNotEqual(central['role_keywords'], plain['role_keywords'])   # engineering and IT, not the example profile
        from src.sources import feeds as f
        rx = paths.keyword_regex(central['role_keywords'])
        for title in ('Site Reliability Engineer', 'Senior Backend Developer', 'Data Scientist', 'Engineering Manager', 'iOS Engineer'):
            self.assertTrue(rx.search(title), title)
        excl = paths.keyword_regex(central['title_exclude_keywords'])
        for title in ('Sales Engineer', 'Mechanical Engineer', 'Marketing Manager'):
            self.assertTrue(excl.search(title), title)
        self.assertTrue(any('zurich' in p for p in central['locations']['top_tier']))
        self.assertTrue(any('singapore' in p for p in central['locations']['top_tier']))
        self.assertEqual(central['remote_excluded_regions'], ['(?!x)x'])   # no region is excluded for the shared index


class ContributionsTest(unittest.TestCase):
    def fetch(self, system, slug):
        return [{'id': '1', 'title': 'Site Reliability Engineer', 'location': 'Zurich, Switzerland', 'url': 'u',
                 'date_posted': '2099-01-01', 'description': 'd', 'remote': False, 'salary': ''}]

    def test_contributed_feeds_from_one_install_on_are_candidates_and_are_verified(self):
        contributions = [
            {'ats': 'lever', 'slug': 'popular', 'company': 'Popular', 'installs': 3, 'matched_installs': 3, 'roles': {'sre_devops': 5, 'data': 2}, 'regions': {'europe': 5}},
            {'ats': 'lever', 'slug': 'lonely', 'company': 'Lonely', 'installs': 1, 'matched_installs': 1, 'roles': {'sre_devops': 1}, 'regions': {}},
            {'ats': 'nonsense', 'slug': 'x', 'company': 'Bad', 'installs': 9, 'roles': {}, 'regions': {}}]
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'j.sqlite') as db:
            feeds, failed = scout.build_index(db, [], self.fetch, today='2026-09-30', contributions=contributions)
        # One install is enough since 6 Oct 2026 (owner: grow the central list); unknown job systems never; every one is verified (fetched).
        self.assertEqual([f['slug'] for f in feeds], ['lonely', 'popular'])
        popular = next(f for f in feeds if f['slug'] == 'popular')
        self.assertEqual(popular['fits'], {'roles': ['sre_devops'], 'regions': ['europe']})   # 'data' has 2 installs (< 5)

    def test_a_tag_needs_five_installs(self):
        self.assertEqual(scout.fits({'roles': {'qa': 4, 'data': 5}, 'regions': {'europe': 4}}), {'roles': ['data']})
        self.assertEqual(scout.fits({}), {})

    def test_reading_contributions_never_fails_the_scout(self):
        def down(request):
            raise OSError('offline')
        self.assertEqual(scout.fetch_contributions('https://x.test/api/index', 'k', down), [])
        self.assertEqual(scout.fetch_contributions('https://x.test/api/index', 'k', lambda r: {'feeds': [{'slug': 'a'}, 'junk']}), [{'slug': 'a'}])


class HonestCountTest(unittest.TestCase):
    def test_harvested_names_are_cleaned(self):
        self.assertEqual(scout.clean_name('Turquoise|Senior Performance Engineer|FT| Remote USA'), 'Turquoise')
        self.assertEqual(scout.clean_name('WorkHero  https://workhero.pro'), 'WorkHero')
        self.assertEqual(scout.clean_name('LiveKit| http://livekit.io/'), 'LiveKit')
        self.assertEqual(scout.clean_name('  Acme Corp – '), 'Acme Corp')

    def test_a_board_of_many_companies_is_not_counted_as_an_employer(self):
        def fetch(system, slug):
            return [{'id': '1', 'title': 'Software Engineer', 'location': 'Berlin', 'url': 'u', 'date_posted': '', 'description': '', 'remote': False, 'salary': ''}]
        starter = [{'company': 'Phaselaw', 'ats': 'ashby', 'slug': 'Pear-VC'}, {'company': 'Real Co|Senior SRE|Remote', 'ats': 'lever', 'slug': 'real'}]
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'j.sqlite') as db:
            feeds, _ = scout.build_index(db, starter, fetch, today='2026-09-30', boards=[{'ats': 'ashby', 'slug': 'pear-vc'}])
        self.assertEqual({f['slug']: f['kind'] for f in feeds}, {'Pear-VC': 'board', 'real': 'employer'})
        self.assertIn('Real Co', [f['company'] for f in feeds])


class RelevantRolesTest(unittest.TestCase):
    def test_counts_engineering_titles_once_per_employer(self):
        import re

        def job(title):
            return {'id': title, 'title': title, 'location': 'Berlin', 'url': 'u', 'date_posted': '', 'description': '', 'remote': False, 'salary': ''}
        jobs = [job('Senior Backend Engineer'), job('Senior Backend Engineer'), job('Site Reliability Engineer'),
                job('Account Executive'), job('Head of Global Total Rewards'), job('Sales Engineer')]
        wanted = lambda title: bool(re.search('engineer', title or '', re.I)) and not re.search('sales', title or '', re.I)  # noqa: E731
        from src import scout_probe   # what counts is the scout's judge (AI kinds since 26 Oct 2026, tests/test_scout_judge_kinds.py)
        with mock.patch.object(scout_probe, 'counted_jobs', lambda jobs: [j for j in jobs if wanted(j['title'])]):
            self.assertEqual(scout.relevant_roles(jobs), 2)   # the repeated title is one role; sales and HR titles are not engineering


class SliceTests(unittest.TestCase):
    """The index in D1: each feed carries its regions (fixed words), each install asks only for its own regions."""

    def test_a_feeds_places_become_fixed_region_words(self):
        from src import contribute
        from tests.model_stand_ins import answers
        with answers({'job-region': {'zürich, switzerland': 'europe', 'remote - emea': 'europe', 'san francisco, ca': 'north_america', 'anywhere': 'remote'}}):
            self.assertEqual(contribute.regions_of(['Zürich, Switzerland', 'Remote - EMEA', 'remote']), ['europe', 'remote'])   # 'remote': the feed's flag
            self.assertEqual(contribute.regions_of(['San Francisco, CA']), ['north_america'])
            self.assertEqual(contribute.regions_of(['Anywhere']), ['remote'])
        self.assertEqual(contribute.regions_of([]), [])

    def test_an_install_asks_for_its_regions_only_and_downloads_again_when_they_change(self):
        import tempfile
        from datetime import datetime, timezone
        from pathlib import Path
        from unittest import mock
        asked = []

        def get(url, headers):
            asked.append(url)
            return 200, json.dumps({'feeds': [{'company': 'A', 'ats': 'lever', 'slug': 'a', 'regions': ['europe', 'mars']}]}), '"e1"'
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / 'index.json'
            now = datetime(2026, 10, 3, tzinfo=timezone.utc)
            with mock.patch.object(employer_index, 'my_regions', return_value=['europe', 'remote']):
                feeds = employer_index.load(cache=cache, url='https://x.test/api/index', get=get, now=now, install_id='abcdefgh12')
                employer_index.load(cache=cache, url='https://x.test/api/index', get=get, now=now, install_id='abcdefgh12')
            self.assertEqual(asked, ['https://x.test/api/index?regions=europe,remote'], 'the second load comes from the cache')
            self.assertEqual(feeds[0]['regions'], ['europe'])
            with mock.patch.object(employer_index, 'my_regions', return_value=['north_america']):
                employer_index.load(cache=cache, url='https://x.test/api/index', get=get, now=now, install_id='abcdefgh12')
            self.assertEqual(asked[-1], 'https://x.test/api/index?regions=north_america')


class FreshnessTests(unittest.TestCase):
    """6 Oct 2026: a feed stayed in the index only while it had a job in the central scout's IT scope, so shop or care employers would leave it."""
    def test_any_open_job_keeps_a_feed_and_freshness_is_tracked(self):
        db = sqlite3.connect(':memory:')
        shop = {'ats': 'successfactors', 'slug': 'jobs.coop.ch', 'jobs': 3142, 'relevant': 0}
        empty = {'ats': 'lever', 'slug': 'gone', 'jobs': 0, 'relevant': 0}
        quiet, fresh = scout.health(db, [shop, empty], '2026-06-01')
        self.assertEqual(fresh[('successfactors', 'jobs.coop.ch')]['jobs'], 3142)
        quiet, fresh = scout.health(db, [{**shop, 'jobs': 3200}, empty], '2026-10-06', failed=[{'ats': 'lever', 'slug': 'dead'}])
        self.assertNotIn(('successfactors', 'jobs.coop.ch'), quiet, 'open jobs of any kind keep it')
        self.assertIn(('lever', 'gone'), quiet, 'no open job for 90 days: left out')
        self.assertEqual({k: fresh[('successfactors', 'jobs.coop.ch')][k] for k in ('ok', 'fails', 'jobs', 'trend', 'new')},
                         {'ok': '2026-10-06', 'fails': 0, 'jobs': 3200, 'trend': 'up', 'new': '2026-10-06'})
        scout.health(db, [], '2026-10-07', failed=[{'ats': 'successfactors', 'slug': 'jobs.coop.ch'}])
        self.assertEqual(db.execute("SELECT fails FROM feed_health WHERE slug = 'jobs.coop.ch'").fetchone()[0], 1)

    def test_the_engine_keeps_only_a_valid_freshness(self):
        out = employer_index.clean([{'company': 'Coop', 'ats': 'successfactors', 'slug': 'jobs.coop.ch',
                                     'fresh': {'ok': '2026-10-06', 'fails': 2, 'jobs': 3200, 'trend': 'sideways', 'new': 'yesterday'}},
                                    {'company': 'X', 'ats': 'lever', 'slug': 'x', 'fresh': {'ok': 'never'}}])
        self.assertEqual(out[0]['fresh'], {'ok': '2026-10-06', 'fails': 2, 'jobs': 3200, 'trend': 'flat', 'new': None})
        self.assertNotIn('fresh', out[1])


class ForYouTests(unittest.TestCase):
    """7 Oct 2026, owner: rank employers and boards per user from the pool (outcomes, metro, family)."""
    ME = {'roles': ['creative_media'], 'families': ['photography'], 'countries': ['ch'], 'metros': ['ch-geneva']}

    def test_a_feed_quiet_for_every_family_of_mine_is_left_out_others_stay(self):
        quiet = {'company': 'Netflix', 'ats': 'lever', 'slug': 'n', 'fits': {'quiet': {'families': ['photography']}}}
        mixed = {'company': 'Studio', 'ats': 'lever', 'slug': 's', 'fits': {'quiet': {'families': ['graphic_design']}}}
        kept = employer_index.relevant([quiet, mixed], lambda job: True, me=self.ME, today=employer_index.QUIET_FROM)
        self.assertEqual([f['company'] for f in kept], ['Studio'])
        both = {**self.ME, 'families': ['photography', 'video_film']}
        self.assertEqual(len(employer_index.relevant([quiet], lambda job: True, me=both, today=employer_index.QUIET_FROM)), 1, 'kept while one of my families may still find jobs there')

    def test_employers_for_you_rank_by_interviews_and_the_most_specific_shared_label(self):
        index = [{'company': 'Manor', 'fits': {'countries': ['ch']}, 'pool': {'installs': 9, 'matched': 6, 'applied': 4, 'interview': 2}},
                 {'company': 'Studio Geneva', 'fits': {'families': ['photography']}, 'pool': {'installs': 4, 'matched': 3, 'applied': 3, 'interview': 1}},
                 {'company': 'Bank', 'fits': {'families': ['accounting_finance']}, 'pool': {'installs': 20, 'matched': 20, 'applied': 9, 'interview': 5}},
                 {'company': 'Unknown', 'fits': {'families': ['photography']}}]
        ranked = employer_index.for_you(index, self.ME)
        self.assertEqual([r['company'] for r in ranked], ['Studio Geneva', 'Manor'], 'family beats country; another family is not mine; no totals, no rank')
        self.assertEqual(ranked[0]['why'], 'your kind of work')

    def test_board_rate_reads_the_most_specific_label_with_numbers(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / 'index.json'
            cache.write_text(json.dumps({'feeds': [], 'boards': [{'board': 'jooble', 'installs': 40, 'matched': 10,
                                                                  'by': {'roles': {'creative_media': [12, 3]}, 'families': {'photography': [5, 4]}}}]}))
            self.assertEqual(employer_index.board_rate('jooble', self.ME, cache), (5, 4))
            self.assertIsNone(employer_index.board_rate('adzuna', self.ME, cache))
            from src import coverage
            text = coverage.people_like_you('aggregators', self.ME, rate=lambda board, me: employer_index.board_rate(board, me, cache))
            self.assertEqual(text, 'gave a match to 8 in 10 people like you')


class CentralRankTests(unittest.TestCase):
    def test_quiet_labels_totals_and_board_stats_respect_the_install_floors(self):
        contribution = {'installs': 7, 'matched_installs': 2, 'roles': {'software': 5}, 'families': {}, 'quiet_families': {'photography': 6, 'video_film': 2},
                        'quiet_roles': {'software': 9}, 'out': {'applied': 3, 'interview': 1}}
        tags = scout.fits(contribution)
        self.assertEqual(tags['quiet'], {'families': ['photography']}, 'software found jobs there: never quiet for it; video_film: too few installs')
        self.assertEqual(scout.pool_of(contribution), {'installs': 7, 'matched': 2, 'applied': 3, 'interview': 1})
        self.assertIsNone(scout.pool_of({'installs': 2}))
        boards = scout.board_stats([{'board': 'jooble', 'installs': 10, 'matched_installs': 4, 'families': {'photography': {'installs': 5, 'matched': 4}, 'nursing_care': {'installs': 1, 'matched': 1}}},
                                    {'board': 'jobicy', 'installs': 2}])
        self.assertEqual(boards, [{'board': 'jooble', 'installs': 10, 'matched': 4, 'by': {'families': {'photography': [5, 4]}}}])


class HourlyCheckTests(unittest.TestCase):
    """7 Oct 2026: installs check the central list about hourly; an unchanged list is a 304 asked by its publish time."""
    def test_an_hour_old_cache_asks_still_this_publish_and_keeps_its_list_on_304(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / 'index.json'
            feed = {'company': 'Migros', 'ats': 'lever', 'slug': 'migros'}
            first = lambda url, headers: (200, json.dumps({'generated': '2026-10-07T04:50:00Z', 'feeds': [feed]}), '"e1"')  # noqa: E731
            now = datetime(2026, 10, 7, 6, 0, tzinfo=timezone.utc)
            with mock.patch.object(employer_index, 'my_regions', lambda: []):
                self.assertEqual(len(employer_index.load(cache, url='https://x.test/api/index', get=first, now=now, install_id='abcdefgh12')), 1)
                asked = []
                again = lambda url, headers: asked.append(headers) or (304, '', None)  # noqa: E731
                employer_index.load(cache, url='https://x.test/api/index', get=again, now=now + timedelta(minutes=30), install_id='abcdefgh12')
                self.assertEqual(asked, [], 'under an hour: the cache answers')
                kept = employer_index.load(cache, url='https://x.test/api/index', get=again, now=now + timedelta(minutes=61), install_id='abcdefgh12')
        self.assertEqual(asked[0]['X-Index-Generated'], '2026-10-07T04:50:00Z')
        self.assertEqual([f['company'] for f in kept], ['Migros'])


class OwnFloorTests(unittest.TestCase):
    """7 Oct 2026 (privacy): a feed only users added themselves needs 3 installs before the central scout takes it up; a scout find needs 1."""
    def test_one_users_own_employer_stays_theirs_until_three_installs_share_it(self):
        import sqlite3
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        contributions = [{'ats': 'lever', 'slug': 'mine', 'company': 'My Cousin GmbH', 'installs': 2, 'own_installs': 2},
                         {'ats': 'lever', 'slug': 'shared', 'company': 'Shared AG', 'installs': 3, 'own_installs': 3},
                         {'ats': 'lever', 'slug': 'found', 'company': 'Found SA', 'installs': 1, 'own_installs': 0}]
        seen = []
        fetch = lambda system, slug: seen.append(slug) or [{'title': 'x', 'location': 'Geneva', 'url': 'u'}]  # noqa: E731
        scout.build_index(db, [], fetch=fetch, contributions=contributions, workers=1)
        self.assertEqual(sorted(seen), ['found', 'shared'])


class DebuggableTests(unittest.TestCase):
    """7 Oct 2026, owner: every pool decision can be traced from the logs; the quiet rule runs in shadow mode first and never hides a user's own match."""
    ME = {'roles': ['creative_media'], 'families': ['photography'], 'countries': ['ch'], 'metros': ['ch-geneva']}
    QUIET = {'company': 'Quiet Gallery', 'fits': {'quiet': {'families': ['photography']}}}

    def test_shadow_mode_keeps_the_feed_and_names_it_then_skips_it(self):
        said = []
        kept = employer_index.relevant([self.QUIET], lambda job: True, me=self.ME, today='2026-10-08', said=said)
        self.assertEqual((len(kept), said), (1, [('Quiet Gallery', 'photography', 'shadow')]))
        said = []
        kept = employer_index.relevant([self.QUIET], lambda job: True, me=self.ME, today=employer_index.QUIET_FROM, said=said)
        self.assertEqual((len(kept), said), (0, [('Quiet Gallery', 'photography', 'out')]))

    def test_an_employer_where_the_user_has_a_scored_job_is_never_left_out(self):
        said = []
        kept = employer_index.relevant([self.QUIET], lambda job: True, me=self.ME, keep={'Quiet Gallery'}, today='2027-01-01', said=said)
        self.assertEqual((len(kept), said), (1, []))

    def test_the_central_publish_says_what_the_pool_added(self):
        feeds = [{'company': 'A', 'fits': {'families': ['photography']}, 'pool': {'installs': 3}}, {'company': 'B', 'fits': {'quiet': {'families': ['photography']}}}]
        line = scout.publish_summary(feeds, [{}, {}, {}], [{'board': 'jooble'}])
        self.assertEqual(line, 'Pool in this publish: 3 shared feeds read, 1 feeds with labels, 1 quiet marks, 1 with outcome totals, 1 boards with stats | quiet for photography: B')

    def test_a_share_the_site_trimmed_is_a_warning_in_the_log(self):
        import io
        from contextlib import redirect_stdout
        from src import contribute
        out = io.StringIO()
        with redirect_stdout(out):
            ok = contribute.send({'feeds': []}, url='https://x.test', post=lambda request: (200, '{"ok": true, "dropped": {"metros": 2}}'), stamp=False)
        self.assertTrue(ok)
        self.assertIn('dropped 2 metros', out.getvalue())
