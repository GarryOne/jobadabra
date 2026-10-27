"""Every workflow gets its Playwright browser through the shared action (cached, a stalled mirror cut), never a bare `playwright install`.

24 Oct 2026: the Chromium step took 18-28 s, but 3 of 40 runs took 5-8 min: Ubuntu's mirror crawled at 72 kB/s while apt fetched the browser's system
libraries. The action keeps browser and packages in the GitHub cache, cuts a stalled download and retries.
"""
import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / '.github' / 'workflows'
ACTION = ROOT / '.github' / 'actions' / 'playwright-browser'


class PlaywrightInstallAction(unittest.TestCase):
    def test_no_workflow_installs_playwright_by_hand(self):
        bare = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
                # Why (27 Oct 2026, persona runs 40510577328): the playwright-core form with apt packages slipped past the old pattern in 9 places and crawled 10 min on apt.
                # A per-suite `playwright-core install chromium` with no apt packages (e2e.yml, desktop.yml, e2e-windows.yml) stays: it needs no mirror.
                if re.search(r'playwright\s+install|playwright-core\s+install\s+--with-deps|install-deps', line) and not line.lstrip().startswith('#'):
                    bare.append(f'{path.name}:{number}')
        self.assertEqual(bare, [], 'use ./.github/actions/playwright-browser instead of `playwright install`: ' + ', '.join(bare))

    def test_the_action_caches_by_exact_version_and_cuts_a_stall(self):
        action = (ACTION / 'action.yml').read_text(encoding='utf-8')
        script = (ACTION / 'install.sh').read_text(encoding='utf-8')
        self.assertIn('~/.cache/ms-playwright', action)
        self.assertNotIn('restore-keys', action, 'a cache must never serve another Playwright version\'s browser')
        self.assertIn('/var/cache/pw-apt', action)
        self.assertRegex(script, r'timeout "\$secs"')
        self.assertIn('--no-shell', script)

    def test_callers_pass_a_known_mode_and_runtime(self):
        for path in sorted(WORKFLOWS.glob('*.yml')):
            text = path.read_text(encoding='utf-8')
            for block in re.findall(r'uses: \./\.github/actions/playwright-browser\n\s+with:(.*?)(?=\n\s+- |\n\S|\Z)', text, re.S):
                for mode in re.findall(r'mode:\s*(\w+)', block):
                    self.assertIn(mode, ('full', 'shell', 'both'), path.name)
                for runtime in re.findall(r'runtime:\s*(\w+)', block):
                    self.assertIn(runtime, ('node', 'python'), path.name)

    def test_a_job_running_real_extension_tests_installs_the_full_browser(self):
        # 27 Oct 2026: harness-daily installed only the headless shell, so its real-extension tests failed every day from 17 Oct with nobody told.
        # A job that runs harness test files (the whole folder or a test-sets.json set) where one starts a real extension needs mode full or both.
        e2e = ROOT / 'desktop' / 'e2e'
        sets = json.loads((e2e / 'test-sets.json').read_text(encoding='utf-8'))
        sets['all'] = sets['pr'] + sets['daily']
        starts = {f.name for f in (e2e / 'test').glob('*.test.mjs')
                  if re.search(r'(?m)^import .*lib/(real-)?extension\.mjs', f.read_text(encoding='utf-8'))}
        self.assertTrue(starts, 'no harness test starts a real extension: the pattern is stale')
        wrong = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            body = path.read_text(encoding='utf-8').split('\njobs:\n', 1)[-1]
            for job in re.split(r'(?m)^  [A-Za-z0-9_-]+:\s*$', body)[1:]:
                runs = set()
                if re.search(r'node --test[^\n]*test/\*\.test\.mjs', job):
                    runs |= set(sets['all'])
                for name in re.findall(r'test-sets\.mjs (\w+)', job):
                    runs |= set(sets.get(name, []))
                needs = sorted(runs & starts)
                if not needs:
                    continue
                modes = re.findall(r'uses: \./\.github/actions/playwright-browser\n\s+with:[^\n]*?mode:\s*(\w+)', job)
                if not any(mode in ('full', 'both') for mode in modes):
                    wrong.append(f'{path.name} (mode {modes or "none"}; e.g. {needs[0]})')
        self.assertEqual(wrong, [], 'these jobs run tests that start a real extension: install mode full or both')


if __name__ == '__main__':
    unittest.main()
