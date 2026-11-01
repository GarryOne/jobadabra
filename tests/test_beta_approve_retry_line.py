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


def approve(retry_text, red=None):
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
        if red is not None:
            env['RED_ON_MAIN_NOTE'] = red
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


class TheNotesListARedMainThatDidNotStopTheBeta(unittest.TestCase):
    def test_the_gates_line_follows_the_retry_line(self):
        # Owner, 1 Nov 2026: "Safety strict, rest tolerant": a red on main that is not safety or data does not stop a beta; its notes list it (tools/red-main-gate.sh prints the line).
        notes = approve('Passed on retry in this beta: jobs · the list\n', 'Red on main, not safety or data: applyflows · a sign-up page before the form')
        self.assertTrue(notes.rstrip().endswith('Passed on retry in this beta: jobs · the list\nRed on main, not safety or data: applyflows · a sign-up page before the form'), notes)

    def test_it_stands_alone_and_an_empty_note_adds_nothing(self):
        self.assertTrue(approve(None, 'Red on main, not safety or data: a · b').rstrip().endswith('Red on main, not safety or data: a · b'))
        self.assertNotIn('Red on main', approve(None, ''))


WORKFLOW = (ROOT / '.github' / 'workflows' / 'desktop.yml').read_text()


def job_text(name):
    return WORKFLOW.split(f'\n  {name}:\n')[1].split('\n\n  # ')[0]


class TheRetryLineTravelsFromTheReleaseJobToTheOfferJob(unittest.TestCase):
    """1 Nov 2026 (a8): the Release job passes the retry line to the lane's offer job as a multi-line job output; the real workflow lines are run here, not copies of them."""

    def test_a_value_with_a_quote_and_a_newline_arrives_whole_in_the_notes(self):
        sent = 'Passed on retry in this beta: jobs · the "list", focus · it\'s a card\nsecond line with $HOME and `ticks`'
        step = job_text('release-mac').split('id: retry')[1].split('\n      - name:')[0]
        send = next(line.strip() for line in step.splitlines() if "echo 'text<<RETRY_END'" in line)
        offer = job_text('release-mac-offer')
        receive = next(line.strip() for line in offer.splitlines() if line.strip().startswith('if [ -n "$RETRY" ]'))
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / 'a' / 'b').mkdir(parents=True)
            (folder / 'passed-on-retry.txt').write_text(sent + '\n')   # what passed-on-retry.mjs | tee wrote, two levels above the step's directory
            out = folder / 'github_output'
            subprocess.run(['bash', '-c', send], cwd=folder / 'a' / 'b', env=dict(os.environ, GITHUB_OUTPUT=str(out)), check=True)
            lines = out.read_text().splitlines()   # GitHub's own heredoc reading: name<<DELIMITER, the value, the DELIMITER
            self.assertEqual(lines[0], 'text<<RETRY_END')
            self.assertEqual(lines[-1], 'RETRY_END')
            retry = '\n'.join(lines[1:-1])
            (folder / 'bin').mkdir()
            gh = folder / 'bin' / 'gh'
            gh.write_text(FAKE_GH)
            gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
            temp = folder / 'runner'
            temp.mkdir()
            env = dict(os.environ, PATH=f"{folder / 'bin'}:{os.environ['PATH']}", FAKE_NOTES=str(folder / 'notes'), RETRY=retry, RUNNER_TEMP=str(temp), TAG='desktop-v0.8.70')
            script = receive + '\nbash "$ROOT/tools/beta-approve.sh" "$TAG"'
            subprocess.run(['bash', '-c', script], env=dict(env, ROOT=str(ROOT)), check=True, capture_output=True, text=True)
            self.assertTrue((folder / 'notes').read_text().rstrip().endswith(sent), (folder / 'notes').read_text())

    def test_no_retry_means_no_file_and_no_line(self):
        offer = job_text('release-windows-offer')
        receive = next(line.strip() for line in offer.splitlines() if line.strip().startswith('if [ -n "$RETRY" ]'))
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / 'bin').mkdir()
            gh = folder / 'bin' / 'gh'
            gh.write_text(FAKE_GH)
            gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
            env = dict(os.environ, PATH=f"{folder / 'bin'}:{os.environ['PATH']}", FAKE_NOTES=str(folder / 'notes'), RETRY='', RUNNER_TEMP=str(folder), TAG='desktop-v0.8.70', ROOT=str(ROOT))
            subprocess.run(['bash', '-c', receive + '\nbash "$ROOT/tools/beta-approve.sh" --windows "$TAG"'], env=env, check=True, capture_output=True, text=True)
            self.assertNotIn('Passed on retry', (folder / 'notes').read_text())
            self.assertFalse((folder / 'passed-on-retry.txt').exists())


if __name__ == '__main__':
    unittest.main()
