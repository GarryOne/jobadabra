"""A beta that released past a step that passed on its retry lists it in the release notes (owner, 1 Nov 2026, "Auto-retry in betas only": "If it passes, the beta releases and the notes
list it"). tools/beta-approve.sh adds the line from PASSED_ON_RETRY_FILE under the Beta-approved line, and adds nothing when the file is empty or missing. Job: report health"""
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAKE_GH = '''#!/bin/sh
case "$1 $2" in
  "release view") printf 'Version 0.8.70\\n' ;;
  "api repos/GarryOne/jobadabra/commits/desktop-v0.8.70") printf 'abc1234\\n' ;;
  "release edit") printf '%s\\n' "$7" > "$FAKE_NOTES" ;;
  *) exit 0 ;;
esac
'''


def approve(retry_text):
    with tempfile.TemporaryDirectory() as directory:
        folder = Path(directory)
        (folder / 'bin').mkdir()
        gh = folder / 'bin' / 'gh'
        gh.write_text(FAKE_GH)
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        env = dict(os.environ, PATH=f"{folder / 'bin'}:{os.environ['PATH']}", FAKE_NOTES=str(folder / 'notes'))
        if retry_text is not None:
            (folder / 'retry.txt').write_text(retry_text)
            env['PASSED_ON_RETRY_FILE'] = str(folder / 'retry.txt')
        subprocess.run(['bash', str(ROOT / 'tools' / 'beta-approve.sh'), 'desktop-v0.8.70'], capture_output=True, text=True, env=env, check=True)
        return (folder / 'notes').read_text()


class TheNotesListWhatPassedOnRetry(unittest.TestCase):
    def test_the_line_is_added_under_the_approval_line(self):
        notes = approve('Passed on retry in this beta: jobs · the list, focus · a card\n')
        self.assertIn('Beta-approved: unit suites and every end-to-end suite passed on commit abc1234', notes)
        self.assertTrue(notes.rstrip().endswith('Passed on retry in this beta: jobs · the list, focus · a card'), notes)

    def test_nothing_is_added_when_no_step_retried(self):
        for text in ('', None):
            self.assertNotIn('Passed on retry', approve(text), repr(text))


if __name__ == '__main__':
    unittest.main()
