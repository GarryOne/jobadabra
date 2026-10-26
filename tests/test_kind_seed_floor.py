"""A kind of work is the AI's judgement; the seed's old keyword patterns answer only with no AI at all (config/meanings_schema.json 'ai_first').
26 Oct 2026, the owner's live run: "office" in the old finance_admin list read "First Officer" as finance_admin before the AI was asked, so
a pilot search read 1,107 office employers and found no job ("I merged 20-30 PRs ... and still not finding any pilot job"). One loop over
every path that labels a search's or a posting's kind of work."""
import json
import sqlite3
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src import contribute, role_kinds  # noqa: E402
from src.ai import decide, meanings, meanings_pack  # noqa: E402

SEARCH_WORDS = ['First Officer', 'pilot first officer', 'air traffic controller', 'police officer', 'customs officer', 'security officer']
AIRLINE_TITLES = ['First Officer A320', 'Captain B737', 'Senior First Officer', 'Cabin Crew Member', 'Air Traffic Controller (ATCO)',
                  'Flight Operations Officer']
WRONG = {'finance_admin', 'software', 'accounting_finance', 'security'}   # what the old keyword lists gave these words


def answer(text, allowed):
    """A stand-in AI: an aviation or public-service kind for these words; 'none' for the pool labels (no tech area, no listed family)."""
    if 'aviation_transport' not in allowed:
        return 'none'
    low = text.lower()
    return 'public_security' if any(word in low for word in ('police', 'customs', 'security')) else 'aviation_transport'


class FakeClient:
    def __init__(self):
        self.calls = 0
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls += 1
        content = kwargs['messages'][0]['content']
        allowed = content.split('Allowed answers: ', 1)[1].split('\n', 1)[0].split(', ')
        items = content.split('### Item ')[1:]
        results = [{'index': i, 'answer': answer(item.split('\n', 1)[1], allowed)} for i, item in enumerate(items)]
        return SimpleNamespace(stop_reason='end_turn', usage=None, content=[SimpleNamespace(type='text', text=json.dumps({'results': results}))])


class AiFirst(unittest.TestCase):
    def setUp(self):
        decide._calls['n'] = 0
        self.client = FakeClient()
        for patch in (mock.patch.object(decide, '_db', lambda: sqlite3.connect(':memory:')),
                      mock.patch.object(decide.engine, 'ready', return_value=True),
                      mock.patch.object(decide.engine, 'client', lambda **k: self.client),
                      mock.patch.object(meanings, 'engine', decide.engine, create=True),
                      mock.patch.object(meanings_pack, 'queue', lambda *a, **k: None),
                      mock.patch.object(meanings_pack, 'tables', lambda: (meanings_pack._load(meanings_pack.SEED_FILE.read_text(), '')))):
            patch.start()
            self.addCleanup(patch.stop)


class EveryPathTests(AiFirst):
    def test_the_seed_still_reads_these_words_wrongly_so_the_test_proves_something(self):
        wrong = {w: meanings_pack.first('role-kind', w) for w in SEARCH_WORDS}
        self.assertEqual(wrong['First Officer'], 'finance_admin')
        self.assertEqual(meanings_pack.first('job-title-kind', 'First Officer A320'), 'finance_admin')

    def test_no_path_that_labels_a_kind_of_work_answers_with_the_old_keyword(self):
        paths = {
            'role_kinds.of_search': lambda: role_kinds.of_search({'role_keywords': SEARCH_WORDS}),
            'role_kinds.kinds_of (search words)': lambda: set(role_kinds.kinds_of(SEARCH_WORDS).values()),
            'role_kinds.kind_of': lambda: {role_kinds.kind_of(word) for word in SEARCH_WORDS},
            'role_kinds.kinds_of (posting titles)': lambda: set(role_kinds.kinds_of(AIRLINE_TITLES, 'job-title-kind').values()),
            'role_kinds.mix (posting titles)': lambda: set(role_kinds.mix(AIRLINE_TITLES) or {}),
            'contribute.tags roles ("pilot first officer")': lambda: set(contribute.tags({'role_keywords': ['pilot first officer'], 'locations': {}})[0]),
            'contribute.tags roles (every word)': lambda: set(contribute.tags({'role_keywords': SEARCH_WORDS, 'locations': {}})[0]),
            'contribute.fine_tags families': lambda: set(contribute.fine_tags({'role_keywords': SEARCH_WORDS, 'locations': {}})['families']),
            'meanings.labels pool-role': lambda: set(meanings.labels('pool-role', SEARCH_WORDS, contribute.ROLES, 'A role.')),
        }
        for name, path in paths.items():
            with self.subTest(path=name):
                decide._calls['n'] = 0
                found = path()
                self.assertFalse(found & WRONG, f'{name}: {sorted(found)}')
        self.assertEqual(role_kinds.of_search({'role_keywords': ['pilot first officer']}), {'aviation_transport'})
        self.assertGreater(self.client.calls, 0, 'the AI was asked')

    def test_every_topic_whose_answers_are_kinds_of_work_asks_the_ai_first(self):
        work = set(role_kinds.KINDS) - {'other'}
        for topic, spec in meanings_pack.schema().items():
            if set(spec['answers']) & work or topic == 'pool-family':
                with self.subTest(topic=topic):
                    self.assertTrue(meanings_pack.ai_first(topic))

    def test_the_sites_learned_wording_still_answers_before_the_ai(self):
        with mock.patch.object(meanings_pack, 'tables', lambda: ({}, {'role-kind': {'first officer': 'aviation_transport'}})):
            self.assertEqual(role_kinds.judged(['First Officer']), {'First Officer': 'aviation_transport'})
        self.assertEqual(self.client.calls, 0)


class AnInstallWithStateTests(AiFirst):
    """The owner's install on 26 Oct 2026 (rows shaped like his, made up here): no role-kind row, pool-role "pilot first officer -> none",
    a few job-title-kind rows, and an answer kept before the kinds grew. The search must come out as aviation and read no office firm."""
    def test_the_pilot_search_with_old_kept_answers_reads_aviation_employers_only(self):
        from src import employer_index
        import tempfile
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / 'jobs.sqlite'
        db = decide._table(sqlite3.connect(path))
        db.executemany('INSERT INTO decisions (topic, key, answer, at) VALUES (?, ?, ?, ?)', [
            ('pool-role', 'pilot first officer', 'none', '2026-10-25T22:48:00+00:00'),
            ('pool-family', 'pilot first officer', 'none', '2026-10-25T22:48:00+00:00'),
            ('role-kind', 'first officer', 'finance_admin', '2026-10-20T09:00:00+00:00'),   # before the kinds grew: asked again
            ('job-title-kind', 'accountant', 'finance_admin', '2026-10-26T01:00:00+00:00')])
        db.commit()
        db.close()
        with mock.patch.object(decide, '_db', lambda: sqlite3.connect(path)):
            search = {'role_keywords': ['First Officer', 'pilot first officer'], 'locations': {}}
            wanted = role_kinds.of_search(search)
            roles, _ = contribute.tags(search)
        self.assertEqual(wanted, {'aviation_transport'})
        self.assertNotIn('finance_admin', roles)
        index = [{'company': 'Office firm', 'places': ['Zurich'], 'kinds': {'finance_admin': 1.0}, 'checked': '2026-10-27'},
                 {'company': 'Airline', 'places': ['Zurich'], 'kinds': {'aviation_transport': 0.3, 'other': 0.7}, 'checked': '2026-10-27'},
                 {'company': 'Not counted yet', 'places': ['Zurich']}]
        zurich = lambda job: 'zurich' in job['location'].lower()
        self.assertEqual([f['company'] for f in employer_index.relevant(index, zurich, wanted)], ['Airline'], 'not counted yet: not read on a guess')
        with sqlite3.connect(path) as db:
            kept = dict(db.execute("SELECT key, answer FROM decisions WHERE topic = 'role-kind'").fetchall())
        self.assertEqual(kept['first officer'], 'aviation_transport', 'the AI answer replaces the old one and is kept')


class WithoutTheAiTests(AiFirst):
    def test_with_no_ai_at_all_the_old_lists_are_the_floor(self):
        with mock.patch.object(decide.engine, 'ready', return_value=False):
            self.assertEqual(role_kinds.of_search({'role_keywords': ['accountant']}), {'finance_admin'})
            self.assertIn('accounting_finance', meanings.labels('pool-family', ['accountant'], {'accounting_finance': 'x', 'photography': 'y'}, 't'))

    def test_past_the_cap_a_title_is_not_counted_never_a_keywords_guess(self):
        decide._calls['n'] = decide.MAX_CALLS_PER_RUN
        self.assertEqual(role_kinds.judged(AIRLINE_TITLES, 'job-title-kind'), {})
        self.assertIsNone(role_kinds.mix(AIRLINE_TITLES))


if __name__ == '__main__':
    unittest.main()
