"""An engine command that answers in JSON keeps its JSON as the last stdout line, also when decide() made AI calls: decide's end-of-run lines
("Warning: …" items left unknown, "AI decide calls: …") go to stderr, which the run log and the Notion run row still read.
26 Oct 2026, #2118's PR run: #2099 printed them to stdout at exit, after src.focus's JSON; the app reads the last stdout line
(desktop/lib/pipeline-commands.js), so Focus said "Could not read your Notion" whenever its read had asked the AI."""
import json
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRIPT = """
import json
from src.ai import decide
decide.WAITING['calls']['asks-to-book'] = 1
decide.WAITING['n'] = 3
print(json.dumps({'items': []}), flush=True)
"""


class DecideExitLines(unittest.TestCase):
    def test_a_json_answer_stays_the_last_stdout_line(self):
        done = subprocess.run([sys.executable, '-c', SCRIPT], cwd=ROOT, capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout.strip().split('\n').pop()), {'items': []}, done.stdout)
        self.assertIn('AI decide calls: asks-to-book 1', done.stderr)   # still said, where the run log reads it
        self.assertIn('Warning: ', done.stderr)


if __name__ == '__main__':
    unittest.main()
