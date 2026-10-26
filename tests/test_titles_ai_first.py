"""The AI decides which job titles fit a search; the role, excluded and level words only show a job at once and decide without AI (owner, 26 Oct
2026: "The AI decides"; "Show at once, AI removes"). Before, a role-word hit was kept "whatever the AI says" ("Pilote / Product Owner Agentic AI"
at EY was a new job for a pilot search), and an excluded or level word dropped a title before any AI ("Senior First Officer", a pilot rank, for a
junior search). Tests: this file; the old gate test in tests/test_title_triage.py."""
import json
import pathlib
import re
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from src import levels
from src.ai import title_triage
from src.sources import feeds

ROOT = pathlib.Path(__file__).resolve().parents[1]
PILOTE = 'Pilote / Product Owner Agentic AI Microsoft Expérimenté H/F'
JUDGED = {' '.join(PILOTE.lower().split())[:160]: False, 'senior first officer': True}


class TitlesAiFirstTest(unittest.TestCase):
    def setUp(self):
        self.patches = [mock.patch.object(feeds, 'TRIAGED', dict(JUDGED)), mock.patch.object(feeds, 'TITLES', feeds.keyword_regex([r'\bpilot(e)?\b', 'first officer'])),
                        mock.patch.object(feeds, 'EXCLUDED_TITLES', feeds.keyword_regex([r'\bsenior\b', r'\bcaptain\b']))]
        for patch in self.patches:
            patch.start()

    def tearDown(self):
        for patch in self.patches:
            patch.stop()

    def test_the_ais_answer_wins_over_every_word(self):
        self.assertFalse(feeds.wanted_title(PILOTE), 'a role word in the title, the AI said no: not a job of this search')
        self.assertTrue(feeds.wanted_title('Senior First Officer'), 'an excluded or level word, the AI said yes: a job of this search')

    def test_a_title_the_ai_has_not_judged_is_decided_by_the_words(self):
        self.assertTrue(feeds.wanted_title('Pilot A320'))
        self.assertFalse(feeds.wanted_title('Captain B737'), 'an excluded word without an AI answer')
        self.assertFalse(feeds.wanted_title('Cabin Crew'), 'no role word and no AI answer')

    def test_a_role_word_hit_shows_at_once_until_the_ai_says_no(self):
        self.assertTrue(feeds.sure_title('Pilot A320'), 'shown in the first seconds, before the AI sort')
        self.assertFalse(feeds.sure_title(PILOTE), 'the AI said no: never shown again')
        self.assertTrue(feeds.sure_title('Senior First Officer'), 'the AI said yes: shown at once too')

    def test_an_open_job_the_ai_rejected_leaves_the_list_at_the_searchs_end(self):
        with mock.patch.object(feeds, 'wanted_location', return_value=True), mock.patch.object(feeds, 'placing', return_value=False):
            self.assertFalse(feeds.keep_open({'title': PILOTE, 'location': 'Paris'}))
            self.assertTrue(feeds.keep_open({'title': 'Pilot A320', 'location': 'Paris'}), 'not judged: kept by its place, as before')

    def test_the_ai_sort_is_asked_about_role_word_and_excluded_word_titles_too(self):
        asked = []
        decide = lambda titles, search, local=False: asked.extend(titles) or {}
        jobs = [{'title': t, 'location': 'Paris'} for t in ('Pilot A320', 'Captain B737', 'Cabin Crew')]
        with mock.patch.object(feeds, 'wanted_location', return_value=True), mock.patch.object(feeds, 'in_my_place', return_value=True), \
                mock.patch('src.ai.engine.ready', lambda *a, **k: True), mock.patch.object(title_triage, 'decide', decide):
            feeds.triage(jobs)
        self.assertEqual(set(asked), {'Pilot A320', 'Captain B737', 'Cabin Crew'})

    def test_a_failed_or_capped_ai_sort_leaves_a_title_unknown_never_a_words_guess(self):
        """CLAUDE.md: a busy or failed AI leaves the item unknown; the words decide only with no AI at all. A role-word hit is still shown."""
        jobs = [{'title': 'Pilot A320', 'location': 'Paris'}]
        for why, decide in (('failed', mock.Mock(side_effect=RuntimeError('overloaded'))), ('past its cap', lambda titles, search, local=False: {})):
            with self.subTest(why), mock.patch.object(feeds, 'TRIAGED', dict(JUDGED)), mock.patch.object(feeds, 'wanted_location', return_value=True), \
                    mock.patch.object(feeds, 'in_my_place', return_value=True), mock.patch('src.ai.engine.ready', lambda *a, **k: True), \
                    mock.patch.object(title_triage, 'decide', decide), mock.patch('builtins.print'):
                self.assertTrue(feeds.wanted_title('Pilot A320'), 'before the sort runs: the words (no AI asked yet)')
                feeds.triage(jobs)
                self.assertFalse(feeds.wanted_title('Pilot A320'), 'the AI sort ran and did not judge it: not kept or counted, asked next run')
                self.assertTrue(feeds.sure_title('Pilot A320'), 'still shown at once (owner: "Show at once, AI removes")')
                self.assertFalse(feeds.wanted_title(PILOTE))
                self.assertTrue(feeds.wanted_title('Senior First Officer'), "the AI's earlier answers still count")
                with mock.patch.object(feeds, 'placing', return_value=False):
                    self.assertTrue(feeds.keep_open({'title': 'Pilot A320', 'location': 'Paris'}), 'a shown job is closed only on an AI no')

    def test_an_unchanged_list_is_read_again_until_the_ai_judged_its_word_hit_titles(self):
        from src.sources import feed_facts
        with mock.patch.object(feeds, 'wanted_location', return_value=True), mock.patch.object(feeds, 'placing', return_value=False), \
                mock.patch.object(feed_facts, '_triage_on', return_value=True):
            self.assertFalse(feed_facts.settled({'title': 'Pilot A320', 'location': 'Paris'}), 'a role-word hit still waits for the AI')
            self.assertFalse(feed_facts.settled({'title': 'Captain B737', 'location': 'Paris'}), 'an excluded-word title too')
            self.assertTrue(feed_facts.settled({'title': 'Senior First Officer', 'location': 'Paris'}), 'the AI answered')

    def test_with_ai_turned_off_the_words_decide(self):
        with mock.patch('src.ai.engine.ready', lambda *a, **k: False):
            feeds.triage([{'title': 'Pilot A320', 'location': 'Paris'}])
        self.assertTrue(feeds.wanted_title('Pilot A320'), 'no AI at all: the words are the floor')


class LevelGoesToTheAiTest(unittest.TestCase):
    def test_the_level_is_its_own_field_not_ruled_out_words(self):
        sent = []

        class Client:
            messages = SimpleNamespace(create=lambda **kw: sent.append(kw['messages'][0]['content']) or SimpleNamespace(
                content=[SimpleNamespace(type='text', text=json.dumps({'fit': [1]}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1)))
        skips = levels.title_skips('junior')
        self.assertTrue(skips, 'the junior level skips senior titles without AI')
        search = {'role_keywords': ['pilot'], 'level': 'junior', 'title_exclude_keywords': [r'\bcargo\b', *skips]}
        with mock.patch.object(title_triage, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 't.json'):
            title_triage.decide(['Senior First Officer'], search, Client())
        words = json.loads(sent[0].split('The search (JSON): ', 1)[1].split('\nThe titles:', 1)[0])
        self.assertEqual(words.get('level'), 'junior')
        self.assertEqual(words['words_ruled_out'], ['cargo'], 'the level skips stay the no-AI floor, never words the AI must obey')


class EveryTitleFilterAsksTheAiTest(unittest.TestCase):
    EXEMPT = {'src/sources/feeds.py': 'the gate itself',
              'src/sources/feed_facts.py': 'only which places still wait for an answer, after feed_scan sorted the titles'}

    def test_each_file_that_keeps_jobs_by_title_runs_the_ai_sort_on_them_first(self):
        missing = []
        for path in sorted((ROOT / 'src').rglob('*.py')):
            rel = path.relative_to(ROOT).as_posix()
            text = path.read_text()
            if rel in self.EXEMPT or not re.search(r'\bwanted_title\(', text):
                continue
            if not re.search(r'\btriage\(', text):
                missing.append(rel)
        self.assertEqual(missing, [], 'these keep jobs by feeds.wanted_title without feeds.triage: the role words alone decide there')


if __name__ == '__main__':
    unittest.main()
