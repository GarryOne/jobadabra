"""Every CI job that runs the Python unit tests sets JOBADABRA_PY_JOBS to 6 (tools/py-shards.py): the runner's cores / check slots give only 2 shards, and the slow
modules sleep and wait on git, so 6 overlap well (build.yml 157 s; the beta's Mac unit step took 5-6.5 min on 2 shards, 12 Oct 2026)."""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github' / 'workflows'
# Owner, 1 Nov 2026: the desktop unit step is the composite action .github/actions/unit-tests, whose callers pass `areas:` and `py-jobs:` (the action exports JOBADABRA_PY_JOBS).
RUNS_PYTHON = re.compile(r"--area python\b|UNIT_AREAS: '[^']*\bpython\b|^\s+areas: '[^']*\bpython\b", re.M)
SIX = re.compile(r"^\s+(?:JOBADABRA_PY_JOBS|py-jobs): '?6'?\b", re.M)


def jobs_of(text):
    parts = re.split(r'^  ([\w-]+):\n', text.split('\njobs:\n', 1)[1] if '\njobs:\n' in text else '', flags=re.M)
    return list(zip(parts[1::2], parts[2::2]))


class CiPythonShardsTest(unittest.TestCase):
    def test_every_job_that_runs_the_python_tests_sets_six_shards(self):
        found, lacking = 0, []
        for file in sorted(WORKFLOWS.glob('*.yml')):
            for name, block in jobs_of(file.read_text()):
                code = '\n'.join(line for line in block.splitlines() if not line.lstrip().startswith('#'))   # a comment that names the command is not a run of it
                if not RUNS_PYTHON.search(code):
                    continue
                found += 1
                if not SIX.search(code):
                    lacking.append(f'{file.name} :: {name}')
        self.assertGreaterEqual(found, 3, 'the check found build.yml, the beta Mac build and the Windows by-hand job (the pattern still matches the workflows)')
        self.assertEqual(lacking, [], 'a job runs the Python tests on 2 shards: set JOBADABRA_PY_JOBS: 6 (env of the job or the step)')

    def test_the_patterns_match_the_old_forms(self):   # positive control
        self.assertTrue(RUNS_PYTHON.search("run: bash tools/check.sh --area python --app-only"))
        self.assertTrue(RUNS_PYTHON.search("UNIT_AREAS: 'python desktop'"))
        self.assertFalse(RUNS_PYTHON.search("UNIT_AREAS: 'desktop'"))
        self.assertTrue(SIX.search("          JOBADABRA_PY_JOBS: '6'   # why"))
        self.assertTrue(SIX.search("      JOBADABRA_PY_JOBS: 6"))
        self.assertFalse(SIX.search("      JOBADABRA_PY_JOBS: 2"))
        self.assertTrue(RUNS_PYTHON.search("        with:\n          areas: 'python desktop'"))   # the composite call
        self.assertFalse(RUNS_PYTHON.search("        with:\n          areas: 'desktop'"))
        self.assertTrue(SIX.search("          py-jobs: '6'"))
        self.assertFalse(SIX.search("          py-jobs: '2'"))


if __name__ == '__main__':
    unittest.main()
