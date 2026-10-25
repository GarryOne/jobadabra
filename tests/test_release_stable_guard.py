"""The promote guard in tools/release-stable.sh: a release may only become stable when the Windows installer it
carries is the one its own build made.

When the windows job fails, desktop.yml's mac-only fallback uploads the *previous* release's generic
Job-Pilotto-windows-x64.exe, so the release looks promotable while its Windows app is an older version (30 Sep 2026:
alpha.131-133 shipped that way, and RELEASE.md §2 warns about it). A generic filename alone proves nothing; the
versioned installer beside it, the same bytes, does.

Driven with a fake `gh` on PATH: no network, no release touched.
"""
import os
import shutil
import signal
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'tools' / 'release-stable.sh'
TAG = 'desktop-v0.4.0-alpha.143'
OWN = f'Job-Pilotto-{TAG.removeprefix("desktop-v")}-x64.exe'
GENERIC = 'Job-Pilotto-windows-x64.exe'
DMG = f'Job-Pilotto-{TAG.removeprefix("desktop-v")}-arm64.dmg'

FAKE_GH = textwrap.dedent('''\
    #!/usr/bin/env bash
    if [ "$1" = release ] && [ "$2" = view ]; then printf '%s\\n' "${FAKE_ASSETS:-}"; exit 0; fi
    if [ "$1" = release ] && [ "$2" = edit ]; then echo "edited $3"; exit 0; fi
    if [ "$1" = api ]; then echo abc1234def5678; exit 0; fi
    if [ "$1" = workflow ] && [ "$2" = run ]; then echo "$*" >> "$FAKE_LOG"; touch "$FAKE_STARTED"; exit 0; fi
    if [ "$1" = run ] && [ "$2" = watch ]; then echo "watched $3" >> "$FAKE_LOG"; exit 0; fi
    if [ "$1" = run ] && [ "$2" = list ]; then
      now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      case "$*" in
        *--event*) echo 4242; exit 0 ;;   # "which run did I just start" (the script's -q picks the id)
      esac
      state="${FAKE_E2E:-green}"
      [ -e "$FAKE_STARTED" ] && state="${FAKE_E2E_AFTER:-green}"
      case "$state" in
        green) printf '[{"conclusion":"success","headSha":"abc1234def5678","createdAt":"%s"}]' "$now" ;;
        red) printf '[{"conclusion":"failure","headSha":"abc1234def5678","createdAt":"%s"}]' "$now" ;;
        other) printf '[{"conclusion":"success","headSha":"fff0000aaaa","createdAt":"%s"}]' "$now" ;;
        stale) echo '[{"conclusion":"success","headSha":"abc1234def5678","createdAt":"2020-01-01T00:00:00Z"}]' ;;
        none) echo '[]' ;;
      esac
      exit 0
    fi
    echo "fake gh: unexpected $*" >&2; exit 1
    ''')


# The script's own switches: one left in the environment by whoever runs the suite (a hotfix's SKIP_E2E=1, a canary job's E2E_NO_START=1)
# would change what each test checks. They are set per test only.
OWN_SWITCHES = {'DRY_RUN', 'SKIP_E2E'}


def run_alone(command, env, timeout=60):
    """Run the script in its own process group and end the whole group when it returns or times out: on a timeout,
    subprocess.run kills only bash, and a `$(gate)` subshell (it shows as `release-stable.sh <tag>` too) was left running
    after the suite (9 Oct 2026). Fails if anything of the run is still alive afterwards."""
    child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env, start_new_session=True)
    try:
        out, err = child.communicate(timeout=timeout)
    finally:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()
    left = subprocess.run(['pgrep', '-g', str(child.pid)], capture_output=True, text=True).stdout.split()
    assert not left, f'release-stable.sh left processes running after its test: {left}'
    return subprocess.CompletedProcess(command, child.returncode, out, err)


class PromoteGuardTests(unittest.TestCase):
    def promote(self, assets, e2e='green', skip=False, after='green', no_start=False, extra=None):
        """Run the real script against these (name, size) assets, with a fake gh standing in for GitHub."""
        with tempfile.TemporaryDirectory() as folder:
            binary = Path(folder) / 'gh'
            binary.write_text(FAKE_GH)
            binary.chmod(0o755)
            self.log = Path(folder) / 'gh.log'
            env = {**{name: value for name, value in os.environ.items() if name not in OWN_SWITCHES and not name.startswith('E2E_')},
                   'PATH': f'{folder}{os.pathsep}{os.environ["PATH"]}', 'FAKE_LOG': str(self.log), 'FAKE_STARTED': str(Path(folder) / 'started'),
                   'FAKE_ASSETS': '\n'.join(f'{name}\t{size}' for name, size in assets), 'FAKE_E2E': e2e, 'FAKE_E2E_AFTER': after, 'E2E_POLL_SECONDS': '0',
                   **({'SKIP_E2E': '1'} if skip else {}), **({'E2E_NO_START': '1'} if no_start else {}), **(extra or {})}
            # The real gh would edit a real release: the script must find the fake first.
            self.assertEqual(shutil.which('gh', path=env['PATH']), str(binary))
            done = run_alone(['bash', str(SCRIPT), TAG], env)
            self.calls = self.log.read_text() if self.log.exists() else ''
            return done

    def test_its_own_installer_at_the_same_size_promotes(self):
        done = self.promote([(OWN, 191850045), (GENERIC, 191850045)])
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn('Stable:', done.stdout)

    def test_the_jobadabra_names_are_guarded_the_same_way(self):
        # Since 25 Oct 2026 a build's own installer is Jobadabra-<version>-x64.exe; the Job-Pilotto-* names beside it are copies.
        new_own, new_generic = OWN.replace('Job-Pilotto', 'Jobadabra'), GENERIC.replace('Job-Pilotto', 'Jobadabra')
        done = self.promote([(new_own, 7), (new_generic, 7), (OWN, 7), (GENERIC, 7)])
        self.assertEqual(done.returncode, 0, done.stderr)
        done = self.promote([(new_own, 7), (new_generic, 8), (OWN, 7), (GENERIC, 7)])
        self.assertEqual(done.returncode, 1)
        self.assertIn('Jobadabra-', done.stderr)
        # the mac-only fallback carried the previous release's installer under the generic names only
        done = self.promote([(DMG, 1), (new_generic, 7), (GENERIC, 7)])
        self.assertEqual(done.returncode, 1)
        self.assertIn('carries no installer of its own', done.stderr)

    def test_a_carried_over_installer_is_refused(self):
        # The mac-only fallback: the previous release's .exe under the generic name, nothing versioned.
        done = self.promote([(DMG, 197596581), (GENERIC, 191848238)])
        self.assertEqual(done.returncode, 1)
        self.assertIn('carries no installer of its own', done.stderr)

    def test_an_installer_of_another_size_is_refused(self):
        done = self.promote([(OWN, 191850045), (GENERIC, 191848238)])
        self.assertEqual(done.returncode, 1)
        self.assertIn('is not the one its build made', done.stderr)

    def test_a_release_with_no_windows_installer_waits(self):
        done = self.promote([(DMG, 197596581)])
        self.assertEqual(done.returncode, 1)
        self.assertIn('no Windows installer yet', done.stderr)


    def test_a_green_end_to_end_run_lets_the_build_through(self):
        done = self.promote([(OWN, 1), (GENERIC, 1)], e2e='green')
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn('End-to-end (Mac + Linux): green', done.stdout)

    def test_a_red_end_to_end_run_stops_the_promotion(self):
        done = self.promote([(OWN, 1), (GENERIC, 1)], e2e='red')
        self.assertEqual(done.returncode, 1)
        self.assertIn('is RED', done.stderr)
        self.assertNotIn('Stable:', done.stdout)

    def test_without_the_right_to_start_a_run_none_or_an_old_one_stops_it(self):
        # The canary auto-promote (E2E_NO_START=1) cannot start a run: it waits for the schedule's.
        for state, words in (('none', 'No finished end-to-end run'), ('stale', 'over two days old')):
            done = self.promote([(OWN, 1), (GENERIC, 1)], e2e=state, no_start=True)
            self.assertEqual(done.returncode, 1, state)
            self.assertIn(words, done.stderr)
            self.assertEqual(self.calls, '', 'it started nothing')

    def test_a_run_of_another_commit_does_not_vouch_for_this_build(self):
        # A human promotion needs THIS build's commit tested: the script starts a run on the tag, waits, and decides by it.
        done = self.promote([(OWN, 1), (GENERIC, 1)], e2e='other', after='green')
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn('--ref ' + TAG, self.calls)
        self.assertIn('watched 4242', self.calls)
        self.assertIn('End-to-end (Mac + Linux): green', done.stdout)

    def test_the_run_it_started_decides_and_a_red_one_stops_the_promotion(self):
        done = self.promote([(OWN, 1), (GENERIC, 1)], e2e='stale', after='red')
        self.assertEqual(done.returncode, 1)
        self.assertIn('is RED', done.stderr)
        self.assertNotIn('Stable:', done.stdout)

    def test_a_green_run_of_the_commit_starts_nothing(self):
        done = self.promote([(OWN, 1), (GENERIC, 1)], e2e='green')
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.calls, '')

    def test_no_start_accepts_the_latest_run_on_main_as_before(self):
        done = self.promote([(OWN, 1), (GENERIC, 1)], e2e='other', no_start=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.calls, '')

    def test_skip_e2e_promotes_anyway_for_a_hotfix(self):
        done = self.promote([(OWN, 1), (GENERIC, 1)], e2e='red', skip=True)
        self.assertEqual(done.returncode, 0, done.stderr)


    def test_the_run_that_just_passed_is_its_own_proof(self):
        # The promote job of e2e.yml runs after every suite passed: it does not look the run up (it is still in progress, and on the build's commit, not main's).
        done = self.promote([(OWN, 1), (GENERIC, 1)], e2e='red', extra={'E2E_ALREADY_GREEN': '1'})
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn('Stable:', done.stdout)
        self.assertEqual(self.calls, '', 'it asked GitHub for no run and started none')

    def test_the_installer_check_still_applies_to_a_run_that_just_passed(self):
        done = self.promote([(DMG, 1), (GENERIC, 2)], extra={'E2E_ALREADY_GREEN': '1'})
        self.assertEqual(done.returncode, 1)
        self.assertIn('carries no installer of its own', done.stderr)

    def test_a_dry_run_says_what_it_would_do_and_promotes_nothing(self):
        done = self.promote([(OWN, 1), (GENERIC, 1)], extra={'E2E_ALREADY_GREEN': '1', 'DRY_RUN': '1'})
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn('Dry run: would make', done.stdout)
        self.assertNotIn('Stable:', done.stdout)


if __name__ == '__main__':
    unittest.main()
