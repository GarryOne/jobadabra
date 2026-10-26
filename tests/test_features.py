import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import daily, features
from src.notion import client as notion
from src.sources import google_jobs


class FeaturesTest(unittest.TestCase):
    def test_on_only_when_everything_it_needs_is_set(self):
        self.assertTrue(features.enabled('discover', {}))
        self.assertFalse(features.enabled('telegram', {'TELEGRAM_BOT_TOKEN': 'x'}))
        self.assertTrue(features.enabled('telegram', {'TELEGRAM_BOT_TOKEN': 'x', 'TELEGRAM_CHAT_ID': 'y'}))
        self.assertFalse(features.enabled('score', {'ANTHROPIC_API_KEY': 'x', 'JOB_PILOTTO_SCORE_MODEL': 'm'}))

    def test_disable_list_and_all(self):
        env = {'SERPAPI_API_KEY': 'x', 'JOB_PILOTTO_DISABLE': ' Google_Jobs , mail '}
        self.assertFalse(features.enabled('google_jobs', env))
        self.assertTrue(features.disabled('mail', env))
        self.assertFalse(features.disabled('scout', env))
        self.assertTrue(features.disabled('scout', {'JOB_PILOTTO_DISABLE': 'all'}))
        states = {f.name: state for f, state, _ in features.status(env)}
        self.assertEqual((states['google_jobs'], states['discover'], states['telegram']), ('disabled', 'on', 'off'))

    def test_every_feature_has_setup_text(self):
        for feature in features.FEATURES:
            self.assertTrue(feature.setup and feature.label and feature.cost in ('free', 'paid', 'free tier'))

    def test_switch_reaches_the_code(self):
        with mock.patch.dict(features.os.environ, {'NOTION_TOKEN': 't', 'SERPAPI_API_KEY': 'k',
                                                   'JOB_PILOTTO_DISABLE': 'notion,google_jobs'}):
            self.assertIsNone(notion.Tracker.from_env())
            self.assertEqual(google_jobs.api_key(), '')

    def test_a_parked_source_leaves_its_saved_key_unused(self):
        # Owner, 26 Oct 2026: Google Jobs (SerpApi) parked with Adzuna, Jooble and Brave (src/features.py PARKED).
        with mock.patch.dict(features.os.environ, {'SERPAPI_API_KEY': 'k', 'JOB_PILOTTO_DISABLE': '', 'JOB_PILOTTO_ENABLE': ''}):
            self.assertEqual(google_jobs.api_key(), '')
        with mock.patch.dict(features.os.environ, {'SERPAPI_API_KEY': 'k', 'JOB_PILOTTO_DISABLE': '', 'JOB_PILOTTO_ENABLE': 'google_jobs'}):
            self.assertEqual(google_jobs.api_key(), 'k')

    def test_daily_flags_follow_the_switch(self):
        args = SimpleNamespace(enrich_max=100, score_max=60, auto_kit_max=5, insight=True, send=True)
        with mock.patch.dict(features.os.environ, {'JOB_PILOTTO_DISABLE': 'score,insights,telegram'}):
            daily.apply_switches(args)
        self.assertEqual((args.enrich_max, args.score_max, args.auto_kit_max, args.insight, args.send),
                         (100, 0, 5, False, False))


if __name__ == '__main__':
    unittest.main()
