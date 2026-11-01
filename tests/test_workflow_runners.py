"""Every Linux job names its Ubuntu version: `ubuntu-latest` moves to a new release on GitHub's date (Ubuntu 26 from 19 Oct 2026), with a notice on every
job until then and, after, a new system under the e2e suites (Electron, xvfb) in the middle of whatever release is going out. The move is ours to make,
in one change that bumps the version below everywhere and is checked by an e2e run.
"""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = [*sorted((ROOT / '.github' / 'workflows').glob('*.yml')), ROOT / 'desktop' / 'e2e' / 'lib' / 'plan.mjs']


class PinnedRunners(unittest.TestCase):
    def test_every_macos_runner_uses_the_e2e_image(self):
        def pinned_runners(text):
            found = []
            runner_indent = None
            for number, line in enumerate(text.splitlines(), 1):
                code = line.split('#', 1)[0].rstrip()
                if not code.strip():
                    continue
                indent = len(code) - len(code.lstrip())
                if runner_indent is not None and indent <= runner_indent:
                    runner_indent = None
                key = re.match(r'\s*(?:-\s+)?(?:runs-on|os):\s*(.*)', code)
                if key:
                    runner_indent = indent if not key.group(1) else None
                    value = key.group(1)
                elif runner_indent is not None:
                    value = code
                else:
                    continue
                for runner in re.findall(r'(?<![\w-])macos[\w.-]*', value):
                    if runner != 'macos-latest':
                        found.append((number, runner))
            return found

        # Matrix include entries are runner declarations too, despite the YAML list dash.
        for runner in ('macos-14', 'macos-latest'):
            with self.subTest(matrix_include=runner):
                self.assertEqual(pinned_runners(f'        - os: {runner}'),
                                 [(1, runner)] if runner != 'macos-latest' else [])
        found = [f'{path.relative_to(ROOT)}:{number}: {runner}'
                 for path in sorted((ROOT / '.github' / 'workflows').glob('*.yml'))
                 for number, runner in pinned_runners(path.read_text(encoding='utf-8'))]
        self.assertEqual(found, [], "a pinned macOS image is retired under us (macos-14 brownout, 30 Oct 2026); use macos-latest, the e2e lanes' image")

    def test_no_job_runs_on_ubuntu_latest(self):
        found = [f'{path.name}:{number}' for path in FILES for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1)
                 if re.search(r'ubuntu-latest', line)]
        self.assertEqual(found, [], 'name the Ubuntu version (ubuntu-24.04) instead of ubuntu-latest')


class NoReplayOnMacOS(unittest.TestCase):
    """15 Oct 2026: macOS runners queued for hours, and the PR gate had replayed Mac-made rows on Linux as same as live: replays run on Linux. Only the jobs that build and test the Mac app stay."""
    MAC_APP = {'desktop.yml', 'fresh-install-smoke.yml'}

    def test_no_replay_workflow_has_a_macos_job(self):
        found = [f'{path.name}:{number}' for path in sorted((ROOT / '.github' / 'workflows').glob('*.yml')) if path.name not in self.MAC_APP
                 for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1) if re.search(r'runs-on:.*macos', line)]
        replays = [item for item in found if re.search(r'replay|verdicts|page-cases|control-tests|record', item)]
        self.assertEqual(replays, [], 'a replay job runs on ubuntu-24.04; only desktop.yml and fresh-install-smoke.yml may use macOS')


if __name__ == '__main__':
    unittest.main()
