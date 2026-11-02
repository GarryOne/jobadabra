"""The scout's AI step (src/ai/scout_ideas.py): what Claude is shown, how its answer is checked, and that a bad answer costs nothing."""
import json
import sqlite3
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import scout  # noqa: E402
from src.ai import scout_ideas  # noqa: E402

NOW = datetime(2026, 10, 3, 9, 0, tzinfo=timezone.utc)
SEARCH = {'role_keywords': ['site reliability', '\\bsre\\b'], 'locations': {'top_tier': ['\\bz[uü]rich\\b'], 'country_wide': ['\\bswitzerland\\b'], 'abroad': ['\\bberlin\\b']}}


class FakeClient:
    """Answers each call from a queue and keeps what it was asked."""

    def __init__(self, *answers, stop='end_turn'):
        self.answers, self.calls, self.stop = list(answers), [], stop
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        block = SimpleNamespace(type='text', text=json.dumps(self.answers.pop(0)))
        return SimpleNamespace(stop_reason=self.stop, content=[block], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


def database():
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    scout.harvest(db, {'excluded': []}, [lambda: []])
    return db


def add(db, name, origin, status='pending'):
    db.execute("INSERT INTO scout_candidates (key, name, origin, priority, status, added_at) VALUES (?, ?, ?, 50, ?, 'x')", (scout.key_for(name), name, origin, status))


IDEAS = {'companies': [{'name': 'Acme AG', 'website': 'https://www.acme.ch/en', 'reason': 'Zurich SaaS'},
                       {'name': 'Linked Up', 'website': 'https://www.linkedin.com/company/x', 'reason': 'x'},
                       {'name': 'See https://evil.example', 'website': '', 'reason': 'x'},
                       {'name': 'Known GmbH', 'website': '', 'reason': 'x'}],
         'directories': [{'label': 'Members', 'url': 'https://assoc.example/members', 'why': 'member list'},
                         {'label': 'LinkedIn list', 'url': 'https://www.linkedin.com/x', 'why': 'x'}],
         'note': 'Tried banks and cloud consultancies: SwissDevJobs found most feeds.'}
PAGE = '<html><body><p>Our members</p><a href="https://beta.example/about">Beta SA</a><a href="https://www.gamma.ch">Gamma</a></body></html>'


class WhatClaudeSeesTests(unittest.TestCase):
    def test_yield_by_kind_of_source_and_last_ideas_with_their_outcome(self):
        db = database()
        for i in range(3):
            add(db, f'Hn{i}', 'Hacker News: (September 2026', 'found' if i == 0 else 'none')
        add(db, 'Swiss1', 'SwissDevJobs employer', 'found')
        add(db, 'Idea1', 'AI idea 2026-09-30', 'none')
        add(db, 'Idea2', 'AI idea 2026-09-30', 'pending')
        table = {row['origin']: row for row in scout_ideas.origin_yield(db)}
        self.assertEqual((table['Hacker News']['probed'], table['Hacker News']['found'], table['Hacker News']['share']), (3, 1, 0.33))
        self.assertEqual(table['SwissDevJobs employer']['share'], 1.0)
        self.assertEqual(scout_ideas.origin_yield(db)[0]['origin'], 'SwissDevJobs employer')   # best first
        self.assertEqual({i['name']: i['result'] for i in scout_ideas.last_ideas(db)}, {'Idea1': 'no public feed', 'Idea2': 'not probed yet'})

    def test_the_prompt_holds_roles_places_and_counts_but_no_regex_and_nothing_personal(self):
        db = database()
        data = scout_ideas.payload(db, SEARCH)
        self.assertEqual(data['roles'], ['site reliability', 'sre'])
        self.assertEqual(data['places']['top_tier'], ['zürich'])
        self.assertNotIn('\\b', json.dumps(data))
        self.assertEqual(set(data), {'roles', 'places', 'sources_so_far', 'feeds_found_examples', 'last_time', 'candidates_known'})


class CheckingTheAnswerTests(unittest.TestCase):
    def test_names_and_addresses_are_validated_and_known_companies_dropped(self):
        known = {scout.key_for('Known GmbH')}
        got = scout_ideas.clean_candidates(IDEAS['companies'], 'AI idea 2026-10-03', 78, known)
        self.assertEqual([(c['name'], c['website'], c['priority']) for c in got], [('Acme AG', 'https://www.acme.ch', 78), ('Linked Up', None, 78)])
        self.assertEqual(scout_ideas.origin_of('javascript:alert(1)'), '')
        self.assertEqual(scout_ideas.origin_of('http://127.0.0.1:8080/x'), '')
        self.assertEqual(scout_ideas.origin_of('acme.ch/careers'), 'https://acme.ch')

    def test_robots_txt_is_not_consulted(self):
        self.assertFalse(hasattr(scout_ideas, 'allowed'), 'owner\'s decision, 6 Oct 2026: a site that does not want us blocks us')

    def test_page_text_lists_outside_links_and_drops_scripts(self):
        text = scout_ideas.page_text('<script>evil()</script><p>Hello</p>' + PAGE, 'https://assoc.example/members')
        self.assertIn('Beta SA -> https://beta.example', text)
        self.assertNotIn('evil()', text)


NURSE = {'role_keywords': ['registered nurse', '\\bnurse\\b', 'ward sister'], 'locations': {'top_tier': ['manchester'], 'country_wide': ['united kingdom'], 'abroad': []}}
IT_WORDS = ('IT ', 'DevOps', 'engineer', 'software', 'SaaS', 'cloud', 'infrastructure')


class JobsSiteTests(unittest.TestCase):
    def test_a_companys_own_job_site_is_kept_and_a_job_board_is_not(self):
        """6 Oct 2026: Rolex's jobs are on carrieres-rolex.com and Coop's on jobs.coop.ch, which no guess from the name reaches."""
        got = scout_ideas.clean_candidates([
            {'name': 'Rolex', 'website': 'https://www.rolex.com', 'jobs_site': 'https://www.carrieres-rolex.com/Rolex/go/Toutes-nos-offres-Rolex/2901501/'},
            {'name': 'Manor', 'website': 'https://www.manor.ch', 'jobs_site': 'https://www.jobs.ch/en/companies/manor'},
            {'name': 'Fnac', 'website': 'https://www.fnac.ch', 'jobs_site': 'javascript:alert(1)'}], 'AI idea', 92, set())
        self.assertEqual([c['careers'] for c in got], ['https://www.carrieres-rolex.com/Rolex/go/Toutes-nos-offres-Rolex/2901501/', None, None])
        self.assertIn('jobs_site', scout_ideas.IDEAS_SCHEMA['properties']['companies']['items']['required'])


class RoleNeutralPromptsTests(unittest.TestCase):
    """A prompt that tells the model to prefer IT employers is a risk for every other profession (5 Oct 2026): the IT guidance stays for IT searches only."""
    def test_a_technical_search_keeps_the_it_prompts_word_for_word(self):
        self.assertIs(scout_ideas.ideas_system(SEARCH), scout_ideas.IDEAS_SYSTEM)
        self.assertIs(scout_ideas.read_system(SEARCH), scout_ideas.READ_SYSTEM)
        self.assertIs(scout_ideas.read_system(None), scout_ideas.READ_SYSTEM)   # no search known: as before
        self.assertIs(scout_ideas.ideas_system({'role_keywords': []}), scout_ideas.IDEAS_SYSTEM_GENERAL)   # unknown roles steer no one to IT (19 Oct 2026)

    def test_a_nurses_prompts_mention_no_it_work_and_name_her_kind_of_employers(self):
        ideas, read = scout_ideas.ideas_system(NURSE), scout_ideas.read_system(NURSE)
        for word in IT_WORDS:
            self.assertNotIn(word, ideas, f'{word!r} in the ideas prompt')
            self.assertNotIn(word, read, f'{word!r} in the directory reader prompt')
        self.assertIn('hospitals', ideas)
        self.assertIn('Never invent a company', ideas)   # the rules that matter stay
        self.assertIn('untrusted', read)

    def test_a_run_for_a_nurse_sends_the_neutral_prompts_and_her_roles_to_the_reader(self):
        db = database()
        client = FakeClient(IDEAS, {'companies': [{'name': 'Beta SA', 'website': ''}]})
        fetch = lambda url: (_ for _ in ()).throw(OSError('none')) if url.endswith('robots.txt') else PAGE
        scout_ideas.run(db, NURSE, client, NOW, get=fetch)
        self.assertEqual(client.calls[0]['system'][0]['text'], scout_ideas.IDEAS_SYSTEM_GENERAL)
        self.assertEqual(client.calls[1]['system'][0]['text'], scout_ideas.READ_SYSTEM_GENERAL)
        self.assertIn('registered nurse', client.calls[1]['messages'][0]['content'])


class RunTests(unittest.TestCase):
    def fetch(self, url):
        if url.endswith('robots.txt'):
            raise OSError('none')
        return PAGE

    def test_a_run_asks_reads_the_allowed_list_and_returns_candidates_with_their_origin(self):
        db = database()
        add(db, 'Known GmbH', 'x')
        client = FakeClient(IDEAS, {'companies': [{'name': 'Beta SA', 'website': 'https://beta.example'}, {'name': 'Gamma', 'website': ''}]})
        found = scout_ideas.run(db, SEARCH, client, NOW, get=self.fetch)
        names = {c['name']: c['origin'] for c in found['candidates']}
        self.assertEqual(names, {'Acme AG': 'AI idea 2026-10-03', 'Linked Up': 'AI idea 2026-10-03', 'Beta SA': 'AI list: assoc.example', 'Gamma': 'AI list: assoc.example'})
        self.assertEqual((found['companies'], found['directories'], found['note'][:6]), (2, 2, 'Tried '))
        self.assertEqual(len(client.calls), 2, 'the LinkedIn list is never fetched or read')
        self.assertIn('untrusted', client.calls[1]['system'][0]['text'])

    def test_it_asks_for_new_ideas_on_every_run_and_ranks_them_above_the_fixed_lists(self):
        db = database()
        scout_ideas.run(db, SEARCH, FakeClient({'companies': [], 'directories': [], 'note': 'n'}), NOW)
        found = scout_ideas.run(db, SEARCH, FakeClient(IDEAS), NOW + timedelta(minutes=2), get=self.fetch)
        self.assertTrue(found['candidates'])
        self.assertTrue(all(c['priority'] > 88 for c in found['candidates']), 'above SwissDevJobs (88) and Hacker News (85)')

    def test_a_cut_off_answer_raises_and_records_nothing(self):
        db = database()
        with self.assertRaises(RuntimeError):
            scout_ideas.run(db, SEARCH, FakeClient(IDEAS, stop='max_tokens'), NOW)
        self.assertIsNone(db.execute("SELECT value FROM scout_meta WHERE key = 'ideas_at'").fetchone())

    def test_the_scout_carries_on_when_the_ideas_fail_and_when_they_are_off(self):
        db = database()
        import os
        from unittest import mock
        with mock.patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'k', 'JOBADABRA_DISABLE': ''}), \
                mock.patch.object(scout_ideas, 'run', side_effect=RuntimeError('boom')):
            self.assertIsNone(scout.ai_ideas(db))
        with mock.patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'k', 'JOBADABRA_DISABLE': 'scout_ai'}):
            self.assertIsNone(scout.ai_ideas(db))
        self.assertIsNone(scout.ai_ideas(db, harvest_sources=[]), 'a caller with its own sources gets no AI')

    def test_the_summary_tells_the_owner_what_was_tried(self):
        text = scout.telegram_summary({'checked': 0, 'harvested': 5, 'queued': 9, 'total_feeds': 3,
                                       'ideas': {'companies': 4, 'directories': 6, 'note': 'Tried banks.'}}, [])
        self.assertIn('New ideas', text)
        self.assertIn('4 companies and 6 from company lists', text)


if __name__ == '__main__':
    unittest.main()
