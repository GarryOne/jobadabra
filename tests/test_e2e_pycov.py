"""The e2e Python step map's recorder (desktop/e2e/lib/pycov/sitecustomize.py): which src/ lines a Python process ran, tagged with the e2e step it started and
ended in. Function-body lines belong to that step; lines run at import (module level, def headers) can matter to any step, so they mark the whole suite.
Owner's yes, 26 Oct 2026: a scoring PR ran the whole quality suite (10-22 min) because Python had no per-step map."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK = ROOT / 'desktop' / 'e2e' / 'lib' / 'pycov'
MODULE = '''import os

LIMIT = 3


@staticmethod
def unused():
    return 'never'


def score(n):
    total = (n +
             LIMIT)
    if total > 2:
        total += 1
    return total
'''


@unittest.skipUnless(hasattr(sys, 'monitoring'), 'needs Python 3.12+')
class Recorder(unittest.TestCase):
    def run_in(self, script, step='Score the jobs'):
        root = Path(tempfile.mkdtemp())
        (root / 'src').mkdir()
        (root / 'src' / '__init__.py').write_text('')
        (root / 'src' / 'scoring.py').write_text(MODULE)
        out = root / 'out'; out.mkdir()
        (out / 'step').write_text(step)
        env = {'PATH': os.environ['PATH'], 'PYTHONPATH': str(HOOK), 'E2E_PY_COVERAGE_DIR': str(out), 'E2E_PY_COVERAGE_ROOT': str(root)}
        subprocess.run([sys.executable, '-c', script], cwd=root, env=env, check=True, timeout=30)
        found = [json.loads(p.read_text()) for p in out.glob('*.json')]
        self.assertEqual(len(found), 1, 'one record per process')
        return found[0], out

    def test_function_lines_go_to_the_step_and_import_lines_mark_the_whole_suite(self):
        rec, _ = self.run_in('from src import scoring; scoring.score(5)')
        self.assertEqual((rec['start'], rec['end']), ('Score the jobs', 'Score the jobs'))
        lines = rec['files']['src/scoring.py']
        body = {n for a, b in lines['body'] for n in range(a, b + 1)}
        load = {n for a, b in lines['load'] for n in range(a, b + 1)}
        self.assertTrue({12, 13, 14, 15, 16} <= body, f'the body ran, a statement over two lines whole: {lines}')
        self.assertNotIn(8, body, 'a function never called is in no step')
        self.assertTrue({1, 3, 6, 7, 11} <= load, f'module level, the decorator and the def lines ran at import: {lines}')
        self.assertFalse(body & load)

    def test_a_process_that_outlives_its_step_says_so(self):
        rec, _ = self.run_in('import os; from src import scoring; scoring.score(1); open(os.path.join(os.environ["E2E_PY_COVERAGE_DIR"], "step"), "w").write("Open a job")')
        self.assertEqual((rec['start'], rec['end']), ('Score the jobs', 'Open a job'))

    def test_only_the_repo_s_src_is_recorded_and_nothing_without_the_variables(self):
        rec, _ = self.run_in('import json, os; from src import scoring; scoring.score(1)')
        self.assertEqual(list(rec['files']), ['src/scoring.py'])
        done = subprocess.run([sys.executable, '-c', 'print(1)'], env={'PATH': os.environ['PATH'], 'PYTHONPATH': str(HOOK)}, capture_output=True, text=True, timeout=30)
        self.assertEqual((done.returncode, done.stdout.strip(), done.stderr), (0, '1', ''), 'off: the hook does nothing')


if __name__ == '__main__':
    unittest.main()
