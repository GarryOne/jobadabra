"""A beta by hand says which version it released, from what the run leaves behind, not from a log line a refactor can rename (#41277723872: desktop-v0.8.67 was released and approved on both
platforms, the script said "Build ? finished without a release" because it read the version from the log's "Releasing X" line, which the log now shows first as the step's source). The lines below are
the real ones of run 41277723872 (released) and 41275070968 (Not released: red: Mac + Linux: focusdismiss). Job: report health"""
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URL = 'https://github.com/GarryOne/jobadabra/actions/runs/'
# What `gh api .../matching-refs/tags/desktop-v --jq '.[] | "\(.ref) \(.object.sha)"'` prints: the tags of the repo, the one of this run's head commit among them.
TAGS = '''refs/tags/desktop-v0.8.65 894a706aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
refs/tags/desktop-v0.8.66 59b9a0cba1b8b7b12eac7ce303c1c6a4fa5a9add
refs/tags/desktop-v0.8.67 649f9ddd286032c25ca916a81d9622259ff66940
refs/tags/desktop-v0.1.0-12 649f9ddd286032c25ca916a81d9622259ff66940
'''
# Real run-log lines: the release step's own source first (this is what the old sed matched), the step name of the gate, the gate's one line, the source's lowercase "not released".
LOG_RELEASED = '''Anything new?\tUNKNOWN STEP\t2026-11-01T05:38:49.3533295Z \x1b[36;1mecho "Releasing $version"\x1b[0m
Anything new?\tUNKNOWN STEP\t2026-11-01T05:38:49.4060680Z Releasing 0.8.67
Anything new?\tUNKNOWN STEP\t2026-11-01T05:38:50.9471465Z \x1b[36;1m  echo "::warning::Workflows changed on main during this build: not released; a new build of main starts."\x1b[0m
Release · Windows beta\tNot released on Windows, an E2E suite failed on Mac + Linux or Windows, or a unit test failed\t2026-11-01T06:02:04.1251315Z ##[group]Run python3 tools/beta_rate_gate.py
Release · Windows beta\tRelease it to Windows beta testers\t2026-11-01T06:34:04.9420502Z desktop-v0.8.67: Beta-approved (Windows): unit suites and every Windows end-to-end suite passed on commit 649f9dd (2026-11-01)
'''
LOG_RED = '''Anything new?\tUNKNOWN STEP\t2026-11-01T04:58:14.2235946Z \x1b[36;1mecho "Releasing $version"\x1b[0m
Anything new?\tUNKNOWN STEP\t2026-11-01T04:58:14.2811005Z Releasing 0.8.66
Anything new?\tUNKNOWN STEP\t2026-11-01T04:58:16.7893849Z \x1b[36;1m  echo "### ⚠️ ${version} not released: superseded by a new build of main (workflows changed on main during the build)."\x1b[0m
Release · Mac beta\tNot released on Mac, an E2E suite failed on Mac + Linux or Windows, or a unit test failed\t2026-11-01T05:23:47.5110906Z ##[error]Not released: red: Mac + Linux: focusdismiss
Release · Windows beta\tNot released on Windows, an E2E suite failed on Mac + Linux or Windows, or a unit test failed\t2026-11-01T05:24:32.7160767Z ##[error]Not released: red: Mac + Linux: focusdismiss
'''
NOTES_BOTH = '''**Version 0.8.67**\n\n## What's changed\n\n- A thing (abc)\n
Beta-approved (Windows): unit suites and every Windows end-to-end suite passed on commit 649f9dd (2026-11-01)
Beta-approved: unit suites and every end-to-end suite passed on commit 649f9dd (2026-11-01)
'''
NOTES_NONE = '**Version 0.8.66**\n\n## What\'s changed\n\n- A thing (abc)\n'
FAKE_GH = '''#!/bin/sh
case "$1 $2" in
  "run view") case "$*" in *--log*) cat "$FAKE_LOG" ;; *) printf '%s\\n' "$FAKE_HEAD" ;; esac ;;
  "api repos/GarryOne/jobadabra/git/matching-refs/tags/desktop-v") cat "$FAKE_TAGS" ;;
  "release view") [ -f "$FAKE_NOTES" ] && cat "$FAKE_NOTES" || exit 1 ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
'''


def report(run, head, log, notes, tags=TAGS):
    with tempfile.TemporaryDirectory() as directory:
        folder = Path(directory)
        (folder / 'bin').mkdir()
        gh = folder / 'bin' / 'gh'
        gh.write_text(FAKE_GH)
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        (folder / 'log').write_text(log)
        (folder / 'tags').write_text(tags)
        if notes is not None:
            (folder / 'notes').write_text(notes)
        env = dict(os.environ, PATH=f"{folder / 'bin'}:{os.environ['PATH']}", FAKE_LOG=str(folder / 'log'), FAKE_TAGS=str(folder / 'tags'), FAKE_NOTES=str(folder / 'notes'), FAKE_HEAD=head)
        done = subprocess.run(['bash', str(ROOT / 'tools' / 'beta-release-report.sh'), run, URL + run], capture_output=True, text=True, env=env)
        assert done.returncode == 0, done.stderr
        return done.stdout


class TheBetaSaysWhichVersionItReleased(unittest.TestCase):
    def test_a_released_beta_names_its_version_and_both_platforms(self):
        out = report('41277723872', '649f9ddd286032c25ca916a81d9622259ff66940', LOG_RELEASED, NOTES_BOTH)
        self.assertEqual(out.strip(), f'desktop-v0.8.67: Mac beta approved, Windows beta approved. The run: {URL}41277723872')

    def test_a_beta_the_gate_refused_quotes_the_gates_reason(self):
        out = report('41275070968', '59b9a0cba1b8b7b12eac7ce303c1c6a4fa5a9add', LOG_RED, NOTES_NONE)
        self.assertEqual(out.splitlines(), [f'desktop-v0.8.66: Mac beta NOT approved, Windows beta NOT approved. The run: {URL}41275070968', 'Not released: red: Mac + Linux: focusdismiss'])

    def test_a_build_without_a_release_still_says_so(self):
        out = report('41275070968', '59b9a0cba1b8b7b12eac7ce303c1c6a4fa5a9add', LOG_RED, None)
        self.assertIn('desktop-v0.8.66: the build finished without a release', out)

    def test_a_run_whose_commit_has_no_version_tag_is_not_given_a_made_up_one(self):
        out = report('41277723872', 'f' * 40, LOG_RELEASED, NOTES_BOTH)
        self.assertIn('made no version tag at fffffff', out)
        self.assertNotIn('desktop-v0.8', out)


if __name__ == '__main__':
    unittest.main()
