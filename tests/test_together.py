"""The pool labels the employer pick waits for are looked up side by side (#2913, 2 Nov 2026: about 7 independent AI calls one after another, 4-30 s each
on the Codex relay, so a first press named its employers after 45-150 s and read 0 of 15). A barrier makes every lookup wait for the others: a serial
run breaks it, so no clock decides this test. Tests: this file, tests/test_contribute.py, tests/test_pool_tags.py."""
import threading
import unittest
from unittest import mock

from src import contribute, employer_index, role_kinds
from src.ai import meanings, slots
from src.together import together

SEARCH = {'role_keywords': ['Truck driver'], 'locations': {'top_tier': ['Sofia'], 'country_wide': ['Bulgaria'], 'abroad': []}}
WAIT = 10   # a hang guard only


class TogetherTests(unittest.TestCase):
    def test_calls_overlap_and_results_keep_the_callers_order(self):
        gate = threading.Barrier(3, timeout=WAIT)
        make = lambda value: lambda: (gate.wait(), value)[1]   # noqa: E731 — each waits for the other two
        self.assertEqual(together(make('a'), make('b'), make('c')), ['a', 'b', 'c'])

    def test_a_pool_thread_asks_at_the_callers_slot_level(self):
        with slots.priority(slots.FIRST):
            levels = together(slots.level, slots.level)
        self.assertEqual(levels, [slots.FIRST, slots.FIRST])

    def test_the_first_failure_is_raised_after_the_others_ended(self):
        ended = []

        def fails():
            raise ValueError('boom')
        with self.assertRaises(ValueError):
            together(fails, lambda: ended.append('ok'))
        self.assertEqual(ended, ['ok'])


class ThePoolLabelsAreAskedAtOnce(unittest.TestCase):
    def test_every_label_lookup_of_a_search_is_in_flight_together(self):
        """role-kind, pool-role, pool-region, pool-country, pool-metro and pool-family: all waiting for each other before any answers; the metros of
        the first places come after, as cache reads, so the AI is asked exactly what a serial run asked (no duplicate, an old tape still matches)."""
        gate = threading.Barrier(6, timeout=WAIT)
        asked, lock = [], threading.Lock()

        def ask(topic):
            with lock:
                first = topic not in asked   # the second pool-metro ask is the cache read: it never reaches the AI, so it does not wait
                asked.append(topic)
            if first:
                gate.wait()

        def labels(topic, texts, choices, task):
            ask(topic)
            return []

        def kinds(search):
            ask('role-kind')
            return set()

        def countries(texts):
            ask('pool-country')
            return []
        with mock.patch.object(meanings, 'labels', side_effect=labels), mock.patch.object(role_kinds, 'of_search', side_effect=kinds), \
                mock.patch('src.pool_tags.countries', side_effect=countries):
            me = employer_index.me_now(SEARCH)
        self.assertEqual(me['roles'], ['other'])
        self.assertEqual(sorted(set(asked)), ['pool-country', 'pool-family', 'pool-metro', 'pool-region', 'pool-role', 'role-kind'], asked)
        self.assertFalse(gate.broken)

    def test_the_result_is_the_one_a_serial_run_gave(self):
        with mock.patch.object(meanings, 'labels', side_effect=lambda topic, texts, choices, task: {'pool-role': ['sre'], 'pool-region': ['ch'],
                               'pool-metro': ['ch-zurich'], 'pool-family': ['warehouse']}.get(topic, [])), \
                mock.patch.object(role_kinds, 'of_search', return_value={'logistics'}), mock.patch('src.pool_tags.countries', return_value=['bg']):
            roles, regions = contribute.tags(SEARCH)
            fine = contribute.fine_tags(SEARCH)
        self.assertEqual((roles, regions), (['logistics', 'sre'], ['ch']))
        self.assertEqual(fine, {'countries': ['bg'], 'metros': ['ch-zurich'], 'families': ['warehouse']})


if __name__ == '__main__':
    unittest.main()
