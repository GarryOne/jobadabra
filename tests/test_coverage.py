"""How much of the market the role keywords catch (src/coverage.py): the funnel of a crawl, the near misses, and what the app tells the user."""
import json
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import coverage  # noqa: E402
from src.sources import feeds  # noqa: E402

NOW = datetime(2026, 10, 2, tzinfo=timezone.utc)


def posting(i, title, place='Zurich, Switzerland'):
    return {'id': str(i), 'title': title, 'location': place, 'url': f'https://x.test/{i}', 'date_posted': '', 'description': 'd', 'remote': False, 'salary': ''}


class PlacesTest(unittest.TestCase):
    def crawl(self, rows):
        tally = coverage.Tally()
        for title, place in rows:
            tally.add(title, in_place=feeds.wanted_location({'location': place}), matched=feeds.wanted_title(title), location=place)
        return tally.summary(NOW)

    def test_matching_roles_just_outside_your_places_are_counted_by_place(self):
        rows = [('Site Reliability Engineer', 'Dublin, Ireland')] * 6 + [('DevOps Engineer', 'Amsterdam')] * 2 + \
               [('Platform Engineer', 'San Francisco, CA')] * 4 + [('Senior Accountant', 'Dublin')] * 9 + [('SRE', 'Zurich')]
        summary = self.crawl(rows)
        self.assertEqual(summary['title_hits'], 13)           # accountant is no title match
        self.assertEqual([(o['place'], o['count']) for o in summary['places']], [('Ireland', 6)])   # Amsterdam: 2 is below the minimum
        self.assertEqual(summary['elsewhere'], 4)             # US: needs a visa, not offered as a place
        self.assertEqual(summary['places'][0]['examples'], ['Site Reliability Engineer'])

    def test_the_verdict_offers_places_not_already_yours_with_the_fragment_to_add(self):
        summary = self.crawl([('Site Reliability Engineer', 'Dublin, Ireland')] * 6 + [('SRE', 'Zurich')])
        offered = coverage.verdict(summary, ['sre'], [])['places']
        self.assertEqual(offered['options'][0]['place'], 'Ireland')
        self.assertIn('dublin', offered['options'][0]['fragment'])
        self.assertTrue(feeds.keyword_regex([offered['options'][0]['fragment']]).search('Dublin'))
        self.assertIsNone(coverage.verdict(summary, ['sre'], [offered['options'][0]['fragment']])['places'])

    def test_every_option_compiles_and_matches_its_own_label_example(self):
        for label, fragment in coverage.PLACE_OPTIONS:
            self.assertTrue(feeds.keyword_regex([fragment]), label)


class TallyTest(unittest.TestCase):
    def test_it_counts_the_funnel_and_the_near_misses_by_term(self):
        tally = coverage.Tally()
        tally.feed(); tally.feed()
        tally.add('Site Reliability Engineer', in_place=True, matched=True)             # caught
        tally.add('Senior Backend Engineer', in_place=True, matched=False)               # near miss: backend
        tally.add('Backend Developer (m/f/d)', in_place=True, matched=False)
        tally.add('Distributed Systems Engineer', in_place=True, matched=False)          # near miss, but only one posting
        tally.add('Staff Software Engineer, Legal Tech', in_place=True, matched=False)   # near miss: software engineer (one)
        tally.add('Accountant', in_place=True, matched=False, excluded=True)             # excluded titles are not the market we want
        tally.add('Backend Engineer', in_place=False, matched=False)                      # not in your places: not a near miss
        summary = tally.summary(NOW)
        self.assertEqual([summary[k] for k in ('feeds', 'fetched', 'in_places', 'matched')], [2, 7, 5, 1])
        by_term = {s['term']: s for s in summary['suggestions']}
        self.assertEqual(by_term['backend']['count'], 2)
        self.assertEqual(by_term['backend']['examples'], ['Senior Backend Engineer', 'Backend Developer (m/f/d)'])
        self.assertNotIn('distributed systems', by_term, 'a single posting is not worth suggesting')
        self.assertEqual(summary['suggestions'][0]['term'], 'backend')   # most postings first

    def test_terms_match_on_word_boundaries_and_hyphen_or_space(self):
        tally = coverage.Tally(vocab=('back-end', 'storage', 'full stack'))
        for title in ('Back End Engineer', 'back-end developer', 'Senior Storage Engineer', 'Cold Storage Operator', 'Full-Stack Engineer', 'Fullstack Engineer', 'Restorage'):
            tally.add(title, in_place=True, matched=False)
        counts = {s['term']: s['count'] for s in tally.summary(NOW)['suggestions']}
        self.assertEqual(counts, {'back-end': 2, 'storage': 2})   # 'full stack' matched once and 'Restorage' not at all

    def test_a_crawl_reports_its_funnel(self):
        sources = [{'company': 'A', 'ats': 'lever', 'slug': 'a'}, {'company': 'B', 'ats': 'lever', 'slug': 'b'}]
        titles = {'a': [posting(1, 'Site Reliability Engineer'), posting(2, 'Senior Backend Engineer'), posting(3, 'Backend Engineer', place='Sydney, Australia')],
                  'b': [posting(4, 'DevOps Engineer'), posting(5, 'Backend Developer'), posting(6, 'Tax Accountant')]}
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))')
        report = feeds.scan(sources, db, fetcher=lambda source: titles[source['slug']], details={})
        funnel = report['funnel']
        self.assertEqual([funnel[k] for k in ('feeds', 'fetched', 'in_places', 'matched')], [2, 6, 4, 2])   # Sydney is outside your places and the accountant is a skipped title
        self.assertEqual({s['term']: s['count'] for s in funnel['suggestions']}, {'backend': 2})
        self.assertEqual(len(report['jobs']), 2)   # the crawl itself is unchanged


class VerdictTest(unittest.TestCase):
    SUMMARY = {'at': '2026-10-02T10:00:00+00:00', 'feeds': 130, 'fetched': 10646, 'in_places': 3142, 'matched': 164,
               'suggestions': [{'term': 'software engineer', 'count': 149, 'examples': ['a']}, {'term': 'backend', 'count': 49, 'examples': ['b']},
                               {'term': 'systems engineer', 'count': 14, 'examples': []}, {'term': 'distributed systems', 'count': 2, 'examples': []}]}

    def test_a_narrow_search_is_called_narrow_with_what_would_add_most(self):
        said = coverage.verdict(self.SUMMARY, keywords=['\\bsre\\b', 'devops'])
        self.assertTrue(said['narrow'])
        self.assertAlmostEqual(said['share'], 164 / 3142)
        self.assertEqual([s['term'] for s in said['suggestions']], ['software engineer', 'backend', 'systems engineer', 'distributed systems'])

    def test_terms_already_in_your_keywords_are_not_suggested_again(self):
        said = coverage.verdict(self.SUMMARY, keywords=['backend', 'Software Engineer'])
        self.assertEqual([s['term'] for s in said['suggestions']], ['systems engineer', 'distributed systems'])

    def test_it_agrees_with_the_window_on_the_shared_table_of_cases(self):
        import json
        table = json.loads((Path(__file__).parent / 'fixtures' / 'audience_cases.json').read_text())['cases']
        for case in table:   # desktop/renderer/audience.js is held to the same rows (desktop/test/audience.test.js)
            self.assertEqual(coverage.looks_technical(case['keywords']), case['technical'], case['keywords'])

    def test_a_search_with_no_technical_keyword_gets_no_engineering_suggestions(self):
        for keywords in (['registered nurse', '\\bnurse\\b'], ['accountant', 'tax advisor'], ['mechanical engineer'], ['infirmière']):
            said = coverage.verdict(self.SUMMARY, keywords=keywords)
            self.assertEqual(said['suggestions'], [], keywords)
            self.assertFalse(said['narrow'], keywords)
        for keywords in (['data analyst'], ['\\bit\\b support'], ['ingénieur système'], ['Softwareentwickler']):
            self.assertTrue(coverage.verdict(self.SUMMARY, keywords=keywords)['suggestions'], keywords)   # technical: as before

    def test_a_wide_enough_search_or_nothing_worth_adding_is_not_a_warning(self):
        self.assertFalse(coverage.verdict(dict(self.SUMMARY, matched=800), keywords=[])['narrow'])                                  # catches a quarter
        self.assertFalse(coverage.verdict(dict(self.SUMMARY, suggestions=[{'term': 'storage', 'count': 3, 'examples': []}]), keywords=[])['narrow'])   # nothing adds 5+
        self.assertIsNone(coverage.verdict(None))
        self.assertIsNone(coverage.verdict({'in_places': 0, 'matched': 0, 'fetched': 5, 'feeds': 1}))


class StorageTest(unittest.TestCase):
    def test_it_is_saved_and_read_back_and_a_broken_file_is_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'sub' / 'coverage.json'
            coverage.save({'in_places': 3, 'matched': 1, 'fetched': 9, 'feeds': 1, 'suggestions': []}, path)
            self.assertEqual(coverage.load(path)['in_places'], 3)
            path.write_text('{not json')
            self.assertIsNone(coverage.load(path))
            self.assertIsNone(coverage.load(Path(tmp) / 'missing.json'))
            coverage.save(None, Path('/proc/nope/coverage.json'))   # an unwritable place never raises


if __name__ == '__main__':
    unittest.main()


class TradeSuggestionsTests(unittest.TestCase):
    """6 Oct 2026: a photographer's search caught 0 of 6,449 postings in Geneva and the card, knowing only IT words, said nothing."""
    def tally(self):
        t = coverage.Tally()
        for title in ['Client Advisor - Boutique Geneva'] * 6 + ['Sales Associate 80%'] * 4 + ['Senior Backend Engineer'] * 9:
            t.add(title, True, False)
        return t.summary()

    def test_a_shop_search_is_offered_shop_words_and_an_it_search_it_words(self):
        shop = coverage.verdict(self.tally(), ['vendeu(r|se)', 'responsable de magasin'])
        self.assertEqual([s['term'] for s in shop['suggestions']][:2], ['client advisor', 'sales associate'])
        self.assertTrue(shop['narrow'])
        it = coverage.verdict(self.tally(), [r'\bsre\b'])
        self.assertIn('backend', [s['term'] for s in it['suggestions']])
        self.assertNotIn('client advisor', [s['term'] for s in it['suggestions']])

    def test_no_key_source_is_offered_while_the_flag_is_off(self):
        # Owner, 24 Oct 2026: Adzuna and Jooble, Brave and SerpApi rows are hidden everywhere (too much configuration).
        self.assertFalse(coverage.KEY_SOURCES_OFFERED)
        self.assertEqual(coverage.unused_sources({}), [])

    @mock.patch.object(coverage, 'KEY_SOURCES_OFFERED', True)
    def test_unused_sources_least_effort_first(self):
        names = [s['id'] for s in coverage.unused_sources({})]
        self.assertEqual(names, ['brave', 'aggregators', 'serpapi'])
        self.assertEqual([s['id'] for s in coverage.unused_sources({'JOOBLE_API_KEY': 'k', 'JOB_PILOTTO_AI_ENGINE': 'cli'})], ['serpapi'],
                         'Claude Code\'s own web search stands in for the Brave key')


class DroppedByFiltersTests(unittest.TestCase):
    def test_jobs_an_excluded_word_drops_are_counted_and_said(self):
        t = coverage.Tally()
        for title in ['Senior Sales Associate'] * 3 + ['Sales Associate']:
            t.add(title, True, title == 'Sales Associate', excluded=title.startswith('Senior'), dropped_by=r'\bsenior\b' if title.startswith('Senior') else '')
        summary = t.summary()
        self.assertEqual([(e['fragment'], e['count']) for e in summary['excluded']], [(r'\bsenior\b', 3)])
        said = coverage.verdict(summary, ['sales associate'], [], [r'\bsenior\b'])
        self.assertEqual(said['excluded'][0]['count'], 3)
        self.assertEqual(coverage.verdict(summary, ['sales associate'], [], [])['excluded'], [], 'a word no longer in the settings is not offered')


class ExplainFactsTests(unittest.TestCase):
    def test_claude_is_given_counts_and_role_words_never_the_cv(self):
        from src.ai import few_jobs
        facts = few_jobs.facts({'in_places': 6477, 'matched': 2, 'suggestions': [{'term': 'retail', 'count': 6, 'examples': ['Sales Associate at X']}]},
                               {'role_keywords': ['photograph(e|er)?'], 'locations': {'top_tier': ['geneva']}, 'cv_text': 'secret'})
        self.assertEqual(facts['missing_role_words'], [{'term': 'retail', 'count': 6}], 'counts only: no job titles or examples')
        self.assertNotIn('secret', json.dumps(facts))


class EmployersStateTests(unittest.TestCase):
    """7 Oct 2026, owner: "how close am I to exhaust my current employers?": the check's feeds read and with a match, the scout's queue."""
    def test_the_meter_reads_the_last_check_and_the_scouts_queue(self):
        import sqlite3
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'jobs.sqlite'
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE scout_candidates (key TEXT, status TEXT, checked_at TEXT)')
                db.executemany('INSERT INTO scout_candidates VALUES (?, ?, ?)', [('a', 'pending', None), ('b', 'pending', None), ('c', 'found', '2026-10-06T20:00:00')])
            state = coverage.employers_state({'employers': {'read': 21, 'matched': 3}}, path)
        self.assertEqual(state, {'read': 21, 'matched': 3, 'pending': 2, 'last_scout': '2026-10-06T20:00:00', 'runway': None, 'batch': 40})
