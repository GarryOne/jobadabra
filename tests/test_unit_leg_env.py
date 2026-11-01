"""The unit leg of the Test matrix runs with none of the e2e jobs' live tokens (owner's rule: tests and automation never touch live accounts or paid APIs; 1 Nov 2026).

desktop.yml's test-mac / test-windows jobs hold E2E_ANTHROPIC_KEY, E2E_OPENAI_KEY, E2E_NOTION_TOKEN*, GH_TOKEN, CI_* … in their job-level `env`, and the unit leg is one more leg of the same
job, so it inherits them. The Build box's own unit step never had them. The composite action .github/actions/unit-tests unsets them before the tests run: a denylist (by prefix and by
exact name), not `env -i`, because desktop.yml never runs on a PR and a Windows variable an allowlist forgot would only show up as a red beta. This test derives the secrets from the jobs,
so a secret added to them later without being covered here fails on the PR that adds it.
"""
import fnmatch
import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = (ROOT / '.github/workflows/desktop.yml').read_text()
ACTION = (ROOT / '.github/actions/unit-tests/action.yml').read_text()
TEST_JOBS = ('test-mac', 'test-windows')
SECRET_LIKE = re.compile(r'TOKEN|KEY|SECRET|PASSWORD')


def job(name):
    nxt = {'test-mac': 'test-windows', 'test-windows': 'release-mac'}[name]
    return WORKFLOW.split(f'\n  {name}:\n')[1].split(f'\n  {nxt}:\n')[0]


def job_env(name):
    """-> {NAME: value} for the job-level `env:` block, and the names listed in E2E_ARTIFACT_SECRET_NAMES."""
    block = job(name).split('\n    env:\n')[1].split('\n    permissions:\n')[0]
    values = dict(re.findall(r'(?m)^      ([A-Z][A-Z0-9_]*): (.*)$', block))
    listed = re.findall(r'(?m)^        ([A-Z][A-Z0-9_]*)$', block)
    return values, listed


def covered_by_the_action():
    """The patterns of the action's scrub: the `case` line between `for name in $(compgen -e)` and `unset`."""
    line = re.search(r'(?m)^\s+([A-Za-z0-9_*|]+)\) unset "\$name" ;;$', ACTION).group(1)
    return line.split('|')


class UnitLegEnv(unittest.TestCase):
    def secrets(self, name):
        values, listed = job_env(name)
        derived = {key for key, value in values.items() if 'secrets.' in value or ('vars.' in value and SECRET_LIKE.search(key))}
        return derived | set(listed)

    def test_the_positive_control_the_jobs_do_hold_secrets(self):
        for name in TEST_JOBS:
            found = self.secrets(name)
            self.assertIn('E2E_ANTHROPIC_KEY', found, name)
            self.assertTrue(any(key.startswith('E2E_NOTION_TOKEN') for key in found), name)
            self.assertIn('GH_TOKEN', found, name)

    def test_every_secret_of_the_test_jobs_is_unset_by_the_unit_action(self):
        patterns = covered_by_the_action()
        for prefix in ('E2E_*', 'CI_*', 'FREE_AI_*', 'AI_COST_*', 'GH_TOKEN', 'GITHUB_TOKEN'):
            self.assertIn(prefix, patterns)
        for name in TEST_JOBS:
            loose = sorted(key for key in self.secrets(name) if not any(fnmatch.fnmatchcase(key, pattern) for pattern in patterns))
            self.assertEqual(loose, [], f'{name}: these tokens of the job would reach the unit tests: add them to the scrub in .github/actions/unit-tests/action.yml')

    @unittest.skipUnless(shutil.which('bash'), 'needs bash')
    def test_the_scrub_removes_tokens_and_keeps_the_rest(self):
        loop = ACTION.split('        for name in $(compgen -e); do\n')[1].split('        done\n')[0]
        script = 'for name in $(compgen -e); do\n' + loop + 'done\nprintf "%s\\n" "${E2E_OPENAI_KEY-gone}" "${GH_TOKEN-gone}" "${E2E_NOTION_TOKEN_FOCUS-gone}" "${CI_FREE_AI_CF_ACCOUNT_ID-gone}" "${VERSION-gone}" "${SYSTEMROOT-gone}"\n'
        env = {**os.environ, 'E2E_OPENAI_KEY': 'fake-1', 'GH_TOKEN': 'fake-2', 'E2E_NOTION_TOKEN_FOCUS': 'fake-3',
               'CI_FREE_AI_CF_ACCOUNT_ID': 'fake-4', 'VERSION': '1.2.3', 'SYSTEMROOT': 'C:/Windows'}
        out = subprocess.run(['bash', '-c', script], env=env, capture_output=True, text=True, check=True).stdout.split()
        self.assertEqual(out, ['gone', 'gone', 'gone', 'gone', '1.2.3', 'C:/Windows'], 'tokens are unset; the version and the Windows system variables stay')


if __name__ == '__main__':
    unittest.main()
