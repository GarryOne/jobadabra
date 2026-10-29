"""Locations, one source (owner, 17 Oct 2026): scoring reads the person's places; a change applies to FUTURE scores only. The places never enter a score's
input hash (so a move or an edit queues no re-score), each new score records which places it used, older scores are marked "based on previous
preferences", and only an explicit refresh queues the ACTIVE ones again. The AI never writes a place: the engine writes the sentences."""
import sqlite3
import unittest
from unittest import mock

from src.ai import locations, score


def search(top=(), country=(), abroad=(), relocation=None):
    places = {'top_tier': list(top), 'country_wide': list(country), 'abroad': list(abroad)}
    if relocation:
        places['relocation'] = [relocation]
    return {'locations': places}


def fresh_db():
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    return db


JOB = {'id': 1, 'title': 'SRE', 'description': 'Run Kubernetes', 'ai': {}, 'first_seen_at': '2026-10-01'}


class LocationsBlockTests(unittest.TestCase):
    def test_the_engine_writes_the_sentences_from_the_places(self):
        text = locations.block(search(['z[uü]rich'], ['switzerland'], ['berlin'], 'yes'))
        self.assertIn('Preferred places: zürich', text)
        self.assertIn('Acceptable places: switzerland', text)
        self.assertIn('Would relocate: yes (berlin)', text)

    def test_no_places_no_block(self):
        self.assertEqual(locations.block(search()), '')

    def test_relocation_no_is_said_and_places_abroad_are_not(self):
        text = locations.block(search(['zurich'], [], ['berlin'], 'no'))
        self.assertIn('Would relocate: no', text)
        self.assertNotIn('berlin', text)

    def test_the_fingerprint_follows_meaning_not_order_case_or_storage(self):
        a = locations.fingerprint(search(['Zürich', 'Zug'], ['switzerland']))
        self.assertEqual(a, locations.fingerprint(search(['zug', 'zürich'], ['SWITZERLAND'])))
        self.assertNotEqual(a, locations.fingerprint(search(['zug'], ['switzerland'])))
        self.assertNotEqual(locations.fingerprint(search(['zug'], [], ['berlin'], 'yes')), locations.fingerprint(search(['zug'], [], ['berlin'], 'no')))


class FutureOnlyTests(unittest.TestCase):
    PROFILE = '# Goals\n- SRE'

    def save(self, db, places):
        with mock.patch.object(locations, 'current', return_value=places):
            score.save(db, JOB, 'm', {'score': 80}, score.scoring_profile(self.PROFILE))

    def test_a_new_score_records_the_places_it_used(self):
        db = fresh_db()
        self.save(db, search(['zurich']))
        self.assertEqual(score.load(db)[1]['locations'], locations.fingerprint(search(['zurich'])))

    def test_changing_places_queues_no_re_score_and_marks_the_old_one(self):
        db = fresh_db()
        self.save(db, search(['zurich']))
        later = search(['berlin'])
        with mock.patch.object(locations, 'current', return_value=later):
            self.assertEqual(score.stale_count(db, [JOB], self.PROFILE), 0)   # nothing waits for an AI call
            self.assertEqual(locations.previous(score.load(db), later), [1])   # but it is marked
        with mock.patch.object(locations, 'current', return_value=search(['zurich'])):
            self.assertEqual(locations.previous(score.load(db), search(['zurich'])), [])

    def test_scores_from_before_places_were_recorded_are_not_marked(self):
        db = fresh_db()
        self.save(db, search())   # a score made when no place was set records none
        self.assertEqual(locations.previous(score.load(db), search(['berlin'])), [])

    def test_only_an_explicit_refresh_queues_the_active_ones(self):
        db = fresh_db()
        other = {**JOB, 'id': 2}
        self.save(db, search(['zurich']))
        with mock.patch.object(locations, 'current', return_value=search(['zurich'])):
            score.save(db, other, 'm', {'score': 70}, score.scoring_profile(self.PROFILE))
        now = search(['berlin'])
        with mock.patch.object(locations, 'current', return_value=now):
            self.assertEqual(locations.refresh(db, now, active_ids={1}), 1)   # job 2 is not active: never touched
            self.assertEqual(score.stale_count(db, [JOB, other], self.PROFILE), 1)


class ActiveJobsTests(unittest.TestCase):
    def test_active_jobs_are_the_shown_ones_without_an_application_stage(self):
        seen = {}

        def eligible(db, hidden_urls=frozenset()):
            seen['hidden'] = hidden_urls
            return [{'id': 1, 'url': 'a'}, {'id': 3, 'url': 'c'}], []

        with mock.patch('src.digest.eligible_jobs', eligible):
            self.assertEqual(locations.active_ids(None, {'b': 'Applied', 'c': None, 'd': 'Rejected'}), {1, 3})
        self.assertEqual(seen['hidden'], {'b', 'd'})   # an application, whatever its stage, is never refreshed

    def test_no_stages_known_leaves_every_shown_job_active(self):
        with mock.patch('src.digest.eligible_jobs', lambda db, hidden_urls=frozenset(): ([{'id': 1, 'url': 'a'}], [])):
            self.assertEqual(locations.active_ids(None), {1})


class OneJobTests(unittest.TestCase):
    def test_a_refresh_can_be_limited_to_one_job_by_its_url(self):
        eligible = ([{'id': 1, 'url': 'https://a'}, {'id': 2, 'url': 'https://b/'}], [])
        with mock.patch('src.digest.eligible_jobs', lambda db, hidden_urls=frozenset(): eligible):
            self.assertEqual(locations.id_for_url(None, 'https://b'), {2})   # the trailing slash is not a different job
            self.assertEqual(locations.id_for_url(None, 'https://nowhere'), set())


class CommandTests(unittest.TestCase):
    def test_the_desktop_has_the_explicit_refresh_command(self):
        from pathlib import Path
        source = (Path(__file__).resolve().parents[1] / 'src' / 'desktop.py').read_text()
        self.assertIn("sub.add_parser('refresh-locations')", source)
        self.assertIn("'refresh-locations': _refresh_locations", source)
        self.assertIn("sub.add_parser('places-now')", source)   # the drawer asks which places are current (lib/places-now.js)
        self.assertIn("'places-now': _places_now", source)


if __name__ == '__main__':
    unittest.main()
