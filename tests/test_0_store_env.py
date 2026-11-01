"""Every test starts with no store chosen, and a test that leaves one chosen fails by name.

open_stores() reads JOBADABRA_STORE (and the sqlite folder JOBADABRA_DATA_DIR) from os.environ, so a value from the shell,
a developer's .env or an earlier test silently turned open_stores(tracker=fake) into sqlite/memory instead of Notion (9 Oct
2026, three times in one session). Rather than each test guarding itself, unittest discovery loads this file second (sorted
names, after test_0_notion_ids) and wraps TestCase.run for the whole suite: before each test the variables are removed, after
it a test that set them without restoring (a bare os.environ[...] =, a patcher started without addCleanup(stop)) fails and
the value is removed, so the next test is never steered by it. Set them inside a test with mock.patch.dict, as usual.

The Notion connection (NOTION_TOKEN, the NOTION_*_DB ids, the NOTION_*_PAGE* ids) is the same kind of steering, but the suite sets
fake ids on purpose (test_0_notion_ids, a full run only: a module run alone has none). So for those, every test ends with them
exactly as it found them: one it set, changed or removed is restored, and the test fails by name."""
import os
import re
import sys
import unittest

STEERING = ('JOBADABRA_STORE', 'JOBADABRA_DATA_DIR')
NOTION = re.compile(r'^NOTION_(TOKEN|\w+_DB|\w*PAGE\w*)$')
_run = unittest.TestCase.run


def _clear():
    return {name: os.environ.pop(name) for name in STEERING if name in os.environ}


def _notion():
    return {name: value for name, value in os.environ.items() if NOTION.match(name)}


def _restore(before):
    for name in set(_notion()) - set(before):
        del os.environ[name]
    os.environ.update(before)


def _fail(self, result, message):
    try:
        raise AssertionError(f'{self.id()} {message}: set it with mock.patch.dict (or addCleanup(patcher.stop)) so the next test '
                             'does not open that store')
    except AssertionError:
        result.addFailure(self, sys.exc_info())


def run_without_a_chosen_store(self, result=None):
    _clear()
    before = _notion()
    outcome = _run(self, result)
    left, after = _clear(), _notion()
    if after != before:
        _restore(before)
    if result is not None:
        if left:
            _fail(self, result, f'left {left} in os.environ')
        if after != before:
            changed = {name: (before.get(name), after.get(name)) for name in set(before) | set(after) if before.get(name) != after.get(name)}
            _fail(self, result, f'changed the Notion connection in os.environ (before, after): {changed}')
    return outcome


run_without_a_chosen_store.guard = True
unittest.TestCase.run = run_without_a_chosen_store
_clear()


class StoreEnvGuardTests(unittest.TestCase):
    def test_the_guard_wraps_every_test(self):
        self.assertTrue(getattr(unittest.TestCase.run, 'guard', False), 'TestCase.run is no longer the store-env guard')

    def test_a_test_starts_without_a_chosen_store(self):
        for name in STEERING:
            self.assertNotIn(name, os.environ)

    def test_a_leaking_test_fails_and_the_next_one_is_not_steered(self):
        class Leaks(unittest.TestCase):
            def test_leak(self):
                os.environ['JOBADABRA_STORE'] = 'sqlite'

            def test_tidy(self):
                from unittest import mock
                with mock.patch.dict(os.environ, {'JOBADABRA_STORE': 'memory'}):
                    pass

        result = unittest.TestResult()
        unittest.defaultTestLoader.loadTestsFromTestCase(Leaks).run(result)
        self.assertEqual([test.id().rsplit('.', 1)[-1] for test, _ in result.failures], ['test_leak'])
        self.assertIn("'JOBADABRA_STORE': 'sqlite'", result.failures[0][1])
        self.assertNotIn('JOBADABRA_STORE', os.environ)

    def test_a_test_that_changes_the_notion_connection_fails_and_it_is_put_back(self):
        from unittest import mock
        class Leaks(unittest.TestCase):
            def test_set(self):
                os.environ['NOTION_TOKEN'] = 'secret_leaked'

            def test_changed(self):
                os.environ['NOTION_APPLICATIONS_DB'] = 'another-db'

            def test_removed(self):
                os.environ.pop('NOTION_MATCHES_DB', None)

            def test_tidy(self):
                with mock.patch.dict(os.environ, {'NOTION_APPLICATIONS_DB': 'its-own', 'NOTION_TOKEN': 't'}):
                    pass

        start = {'NOTION_APPLICATIONS_DB': 'apps', 'NOTION_MATCHES_DB': 'matches'}
        with mock.patch.dict(os.environ, start):
            os.environ.pop('NOTION_TOKEN', None)
            result = unittest.TestResult()
            unittest.defaultTestLoader.loadTestsFromTestCase(Leaks).run(result)
            self.assertEqual(sorted(test.id().rsplit('.', 1)[-1] for test, _ in result.failures), ['test_changed', 'test_removed', 'test_set'])
            self.assertIn("'NOTION_APPLICATIONS_DB': ('apps', 'another-db')", ' '.join(text for _, text in result.failures))
            self.assertEqual({name: os.environ.get(name) for name in (*start, 'NOTION_TOKEN')}, {**start, 'NOTION_TOKEN': None})


if __name__ == '__main__':
    unittest.main()
