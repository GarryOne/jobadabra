"""Every required check in tools/pr-settings.sh is the name of a job some workflow runs, or the status tools/pr-verdict.py writes (12 Oct 2026: "hole 3" was renamed
"cases fail before the fix"). A required check that nothing reports leaves every PR waiting for ever, so a rename that misses the list (or a typo) fails here."""
import re
import shlex
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def required():
    text = (ROOT / 'tools' / 'pr-settings.sh').read_text()
    return shlex.split(re.search(r"^checks='(.*)'$", text, re.M).group(1))


def job_names():
    """-> regexes of the check name of every job a pull request runs: its `name:` (a ${{ matrix.x }} part matches anything) or, without one, its id (+ " (<matrix values>)")."""
    names = []
    for workflow in sorted((ROOT / '.github' / 'workflows').glob('*.yml')):
        text = workflow.read_text(); lines = text.splitlines()
        trigger = text.split('\njobs:')[0]
        if 'jobs:' not in lines or not re.search(r'^\s*pull_request\b|^on:.*\bpull_request\b', trigger, re.M): continue   # a required check comes from a PR's own run
        jobs = lines[lines.index('jobs:') + 1:]
        for i, line in enumerate(jobs):
            job = re.match(r'^  ([\w-]+):\s*(#.*)?$', line)
            if not job: continue
            name = None
            for below in jobs[i + 1:]:
                if re.match(r'^  \S', below): break
                found = re.match(r'^    name:\s*(.+?)\s*$', below)
                if found: name = found.group(1).strip('\'"'); break
            if name is None:   # no name: GitHub calls it by its id, a matrix job "<id> (<values>)" (build.yml's desktop)
                names.append(re.compile('^' + re.escape(job.group(1)) + r'( \(.+\))?$')); continue
            parts = re.split(r'\$\{\{[^}]*\}\}', name)
            if any(part.strip() for part in parts): names.append(re.compile('^' + '.+'.join(re.escape(part) for part in parts) + '$'))   # all template: matches nothing
    return names


class RequiredChecksTest(unittest.TestCase):
    def test_every_required_check_is_a_job_some_workflow_runs(self):
        verdict = re.search(r"^CONTEXT = '(.+)'$", (ROOT / 'tools' / 'pr-verdict.py').read_text(), re.M).group(1)   # the status pr-verdict.yml writes (26 Oct 2026)
        names, checks = job_names() + [re.compile('^' + re.escape(verdict) + '$')], required()
        self.assertGreaterEqual(len(checks), 1, 'positive control: the list is read (one since 15 Oct 2026: the one job that starts on every PR)')
        self.assertTrue(any(name.match('desktop (ubuntu-24.04)') for name in names), 'positive control: a matrix job name is matched')
        self.assertEqual([check for check in checks if not any(name.match(check) for name in names)], [],
                         'a required check nothing reports blocks every PR: rename it in tools/pr-settings.sh too, then run tools/pr-settings.sh --apply')

    def test_the_old_names_are_gone(self):
        # 15 Oct 2026: four required jobs became one with named steps. An old name coming back (a ruleset entry or a doc) fails here.
        self.assertEqual(required(), ['All checks passed'])
        old = ['pr gates', 'flow-fresh check', 'cases fail before the fix', 'all checks green', 'hole 3']
        tracked = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True, text=True).stdout.split('\0')
        skip = {'docs/rules/why.md', 'tests/test_required_checks.py'}   # why.md keeps the history by name
        hits = []
        for rel in tracked:
            path = ROOT / rel
            if not rel or rel in skip or not path.is_file() or path.suffix not in {'.md', '.yml', '.sh', '.py', '.mjs', '.js'}: continue
            text = path.read_text(errors='ignore')
            hits += [f'{rel}: {name}' for name in old if re.search(rf'(?<![\w-]){re.escape(name)}(?![\w-])', text)]
        self.assertEqual(hits, [], 'an old required-check name came back: the check is "All checks passed", written by tools/pr-verdict.py')


if __name__ == '__main__':
    unittest.main()
