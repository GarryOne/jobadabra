# A GitHub API rate limit is named (with its reset time), never hidden behind "release not found" or a traceback.
# Plays the real texts: CI run 41228178173 (verdict), beta 41226261602 (release upload, beta gate, prune).
import json
import subprocess
import unittest
from datetime import datetime, timezone

from tools import github_limit as limit

INSTALLATION_403 = ('gh run list -R GarryOne/jobadabra --commit a5fd215: failed to get runs: HTTP 403: API rate limit exceeded for installation. '
                    'If you reach out to GitHub Support for help, please include the request ID F401:20A9D2:8AEA0:9AC46:6AE62F5F (https://api.github.com/x)')
RESET = int(datetime(2026, 10, 31, 18, 30, 12, tzinfo=timezone.utc).timestamp())
EMPTY = {'resources': {'core': {'limit': 5000, 'remaining': 0, 'reset': RESET}}}
ERROR_BODY = {'message': 'API rate limit exceeded for installation. If you reach out to GitHub Support for help', 'documentation_url': 'https://docs.github.com/rest'}


class Recognises(unittest.TestCase):
    def test_the_rate_limit_texts_of_the_incident_are_limits(self):
        self.assertTrue(limit.is_limit(INSTALLATION_403))
        self.assertTrue(limit.is_limit('HTTP 429: You have exceeded a secondary rate limit. Please wait a few minutes'))
        self.assertTrue(limit.is_limit(json.dumps(ERROR_BODY)))

    def test_other_failures_are_not(self):
        for text in ('release not found', 'HTTP 404: Not Found', 'HTTP 403: Resource not accessible by integration', '', None):
            self.assertFalse(limit.is_limit(text), text)


class Message(unittest.TestCase):
    def test_names_the_code_the_scope_and_the_reset_time(self):
        self.assertEqual(limit.limit_message(INSTALLATION_403, EMPTY), 'GitHub API rate limit (403 … for installation), reset at 18:30:12 UTC')

    def test_a_secondary_limit_is_a_429_and_an_unreadable_reset_is_said(self):
        self.assertEqual(limit.limit_message('HTTP 429: secondary rate limit', None), 'GitHub API rate limit (429 … for this token), reset time not readable')

    def test_a_budget_that_is_not_empty_does_not_pretend_to_know_the_reset(self):
        left = {'resources': {'core': {'limit': 5000, 'remaining': 120, 'reset': RESET}}}
        self.assertIn('reset at 18:30:12 UTC', limit.limit_message(INSTALLATION_403, left))


class RunGh(unittest.TestCase):
    def failing(self, stdout='', stderr=''):
        def run(command, **kwargs):
            raise subprocess.CalledProcessError(1, command, output=stdout, stderr=stderr)
        return run

    def test_a_limit_becomes_one_named_error(self):
        with self.assertRaises(limit.GitHubLimit) as caught:
            limit.run_gh('api', 'x', run=self.failing(stderr=INSTALLATION_403), rate=lambda: EMPTY)
        self.assertEqual(str(caught.exception), 'GitHub API rate limit (403 … for installation), reset at 18:30:12 UTC')

    def test_gh_api_prints_the_error_body_on_stdout(self):
        with self.assertRaises(limit.GitHubLimit):
            limit.run_gh('api', 'x', run=self.failing(stdout=json.dumps(ERROR_BODY)), rate=lambda: EMPTY)

    def test_any_other_failure_stays_what_it_was(self):
        with self.assertRaises(subprocess.CalledProcessError):
            limit.run_gh('api', 'x', run=self.failing(stderr='HTTP 404: Not Found'), rate=lambda: EMPTY)

    def test_success_returns_stdout(self):
        done = subprocess.CompletedProcess([], 0, stdout='[]', stderr='')
        self.assertEqual(limit.run_gh('api', 'x', run=lambda command, **kwargs: done, rate=lambda: EMPTY), '[]')


class ExpectList(unittest.TestCase):
    def test_the_error_object_gh_prints_is_not_iterated_as_a_release_list(self):
        # canary_promote.py:141 iterated this dict's keys as releases and died on r.get (beta 41226261602, "Clean up old builds")
        with self.assertRaises(limit.GitHubLimit) as caught:
            limit.expect_list(ERROR_BODY, 'the release list', rate=lambda: EMPTY)
        self.assertIn('GitHub API rate limit (403 … for installation), reset at 18:30:12 UTC', str(caught.exception))

    def test_another_error_object_says_what_github_answered(self):
        with self.assertRaises(ValueError) as caught:
            limit.expect_list({'message': 'Not Found'}, 'the release list')
        self.assertEqual(str(caught.exception), "the release list: GitHub answered 'Not Found', not a list")

    def test_a_list_passes(self):
        self.assertEqual(limit.expect_list([{'tag_name': 'a'}], 'the release list'), [{'tag_name': 'a'}])


class Explain(unittest.TestCase):
    def test_a_shell_step_that_failed_gets_the_limit_said(self):
        self.assertEqual(limit.explain('gh release upload', rate=lambda: EMPTY),
                         '::error::gh release upload failed: GitHub API rate limit (403 … for installation), reset at 18:30:12 UTC')

    def test_with_budget_left_it_does_not_blame_the_limit(self):
        left = {'resources': {'core': {'limit': 5000, 'remaining': 4000, 'reset': RESET}}}
        self.assertEqual(limit.explain('gh release upload', rate=lambda: left), '')


if __name__ == '__main__':
    unittest.main()
