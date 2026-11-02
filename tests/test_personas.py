"""Nothing is hard-coded to the owner (a Swiss SRE, EU citizen): the visa flag, the digest's places, Google Jobs and the time zone follow
each user's own places and citizenship / work rights. Two fictional users: a data analyst in Austin (US citizen), a marketing manager in
São Paulo (Brazilian, open to Portugal and Spain). Run end to end by desktop/e2e/suites/personas.mjs."""
import os
import unittest
from pathlib import Path
from unittest import mock

from src import digest, tz
from src.paths import keyword_regex
from src.sources import google_jobs

AUSTIN = {'search': {'locations': {'top_tier': ['austin'], 'country_wide': ['united states', 'texas'], 'abroad': ['portugal', 'spain']}},
          'work_rights': ['united states']}
SAO_PAULO = {'search': {'locations': {'top_tier': ['s[aã]o paulo'], 'country_wide': ['brazil', 'brasil'], 'abroad': ['portugal', 'spain', 'lisbon']}},
             'work_rights': ['brazil']}
OWNER = {'search': {'locations': {'top_tier': ['z[uü]rich'], 'country_wide': ['switzerland'], 'abroad': ['berlin', 'london', 'dubai']}},
         'work_rights': ['\\beu\\b']}


def as_user(user):
    places = user['search']['locations']
    return mock.patch.multiple(
        digest, HOME=keyword_regex([*places['top_tier'], *places['country_wide']]), BEST_PLACES=keyword_regex(places['top_tier']),
        PREFERRED_ABROAD=keyword_regex(places['abroad']), WORK_RIGHTS=digest.work_rights_regex(user['work_rights']))


def job(location, **extra):
    return {'location': location, 'city': '', **extra}


class SponsorshipFollowsTheUser(unittest.TestCase):
    def test_us_citizen_needs_none_in_the_us_and_needs_it_in_portugal(self):
        with as_user(AUSTIN):
            self.assertFalse(digest.needs_sponsorship(job('Austin, TX')))
            self.assertFalse(digest.needs_sponsorship(job('Remote, United States')))
            self.assertTrue(digest.needs_sponsorship(job('Lisbon, Portugal')))
            self.assertTrue(digest.needs_sponsorship(job('Madrid, Spain')))

    def test_brazilian_needs_it_in_portugal_and_spain_not_at_home(self):
        with as_user(SAO_PAULO):
            self.assertFalse(digest.needs_sponsorship(job('São Paulo, Brazil')))
            self.assertTrue(digest.needs_sponsorship(job('Lisbon, Portugal')))
            self.assertTrue(digest.needs_sponsorship(job('Madrid, Spain')))

    def test_an_eu_citizen_needs_none_in_the_eu_but_does_elsewhere(self):
        with as_user(OWNER):
            self.assertFalse(digest.needs_sponsorship(job('Berlin, Germany')))
            self.assertTrue(digest.needs_sponsorship(job('Dubai, UAE')))
            self.assertTrue(digest.needs_sponsorship(job('London, UK')))

    def test_no_work_rights_set_means_every_place_abroad_needs_it(self):
        with as_user({**OWNER, 'work_rights': []}):
            self.assertTrue(digest.needs_sponsorship(job('Berlin, Germany')))

    def test_eu_means_member_states_not_anything_with_the_letters(self):
        rights = digest.work_rights_regex(['\\beu\\b'])
        self.assertTrue(rights.search('Lisbon, Portugal'))
        self.assertFalse(rights.search('Lima, Peru'))
        self.assertIs(digest.work_rights_regex([]), None)

    def test_the_badge_follows(self):
        ai = {'english_is_enough': {'value': 'yes'}, 'languages': [], 'salary': {'stated': False, 'text': ''}, 'employer_type': {'value': 'direct_employer'}}
        with as_user(AUSTIN):
            self.assertIn('🔴 visa sponsorship needed', digest._ai_badges(ai, job('Lisbon, Portugal')))
            self.assertNotIn('🔴 visa sponsorship needed', digest._ai_badges(ai, job('Austin, TX')))


    def test_the_badge_shows_even_without_ai_facts(self):
        with as_user(AUSTIN):
            block = digest._job_block(1, {'title': 'Analytics Engineer', 'company': 'Acme', 'location': 'Lisbon, Portugal', 'city': '', 'url': ''})
            self.assertIn('<b>Check:</b> visa sponsorship needed', block)
            home = digest._job_block(1, {'title': 'Data Analyst', 'company': 'Acme', 'location': 'Austin, TX', 'city': '', 'url': ''})
            self.assertNotIn('visa sponsorship', home)


class WordingIsNotSwiss(unittest.TestCase):
    def test_places_and_digest_wording(self):
        with as_user(AUSTIN):
            self.assertTrue(digest.in_places(job('Austin, TX')))
            self.assertFalse(digest.in_places(job('Zurich, Switzerland')))
        source = Path(digest.__file__).read_text(encoding='utf-8')
        self.assertIn('Outside your preferred locations', source)
        self.assertNotRegex(source.replace('Zürich Versicherungs', ''), r'🇨🇭|Swiss')

    def test_salary_follows_the_posting(self):
        self.assertEqual(digest._salary('Salary R$ 8.000 - R$ 10.000 per month'), 'R$ 8.000 - R$ 10.000')
        self.assertEqual(digest._salary('Pay: $95,000 - $120,000 a year'), '$95,000 - $120,000')
        self.assertEqual(digest._salary('BRL 9000 monthly'), 'BRL 9000')
        self.assertEqual(digest._salary('CHF 150-170k/year'), 'CHF 150-170k')

    def test_languages_of_other_markets_are_named(self):
        ai = {'english_is_enough': {'value': 'no'}, 'languages': [{'language': 'Portuguese', 'level': 'required'}],
              'salary': {'stated': False, 'text': ''}, 'employer_type': {'value': 'direct_employer'}}
        self.assertIn('🇵🇹 Portuguese required', digest._ai_badges(ai))
        self.assertNotIn('⚠️ other language required', digest._ai_badges(ai))


class NothingSearchesSomewhereTheUserNeverChose(unittest.TestCase):
    def test_google_jobs_has_no_default_place_or_country(self):
        config = google_jobs.settings({})
        self.assertEqual((config['locations'], config['country'], config['queries']), ([], '', []))

    def test_without_places_it_spends_no_credit(self):
        calls = []
        report = google_jobs.scan(None, 'key', google_jobs.settings({}), opener=lambda *a, **k: calls.append(a))
        self.assertEqual((report['jobs'], report['sources'], calls), ([], [], []))

    def test_each_search_uses_the_users_place_language_and_country(self):
        import io, json, sqlite3
        urls = []

        def opener(request, timeout=0):
            urls.append(request.full_url)
            return io.BytesIO(json.dumps({'total_searches_left': 100, 'jobs_results': []}).encode())
        config = google_jobs.settings({'google_jobs': {'queries': ['analista de marketing'], 'country': 'br',
                                                       'locations': [{'location': 'Sao Paulo,State of Sao Paulo,Brazil', 'language': 'pt'}]}})
        with sqlite3.connect(':memory:') as db:
            google_jobs.scan(db, 'key', config, opener=opener)
        search = [u for u in urls if 'google_jobs' in u][0]
        self.assertTrue(all(part in search for part in ('gl=br', 'hl=pt', 'Brazil')), search)
        self.assertNotIn('Zurich', search)


class TimeZoneIsTheUsers(unittest.TestCase):
    def test_env_wins_and_there_is_no_fixed_city(self):
        with mock.patch.dict(os.environ, {'JOBADABRA_TZ': 'America/Chicago'}):
            self.assertEqual(tz.zone_name(), 'America/Chicago')
        with mock.patch.dict(os.environ, {'JOBADABRA_TZ': 'America/Sao_Paulo'}):
            self.assertEqual(tz.local_zone().key, 'America/Sao_Paulo')
        with mock.patch.dict(os.environ, {'JOBADABRA_TZ': 'Not/AZone', 'TZ': ''}):
            self.assertTrue(tz.zone_name())   # an unknown name falls back to the machine's, then UTC: never Zurich on purpose

    def test_source_has_no_hardcoded_zone(self):
        root = os.path.join(os.path.dirname(__file__), '..', 'src')
        for folder, _, names in os.walk(root):
            for name in names:
                if name.endswith('.py') and name != 'google.py':   # google.py: a table that maps Windows zone names
                    text = Path(folder, name).read_text(encoding='utf-8')
                    self.assertNotRegex(text, r"getenv\('JOBADABRA_TZ', 'Europe/", name)


if __name__ == '__main__':
    unittest.main()
