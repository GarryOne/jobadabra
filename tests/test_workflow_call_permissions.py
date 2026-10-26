"""A workflow that calls another (`uses: ./.github/workflows/x.yml`) grants every permission the called one asks for.

26 Oct 2026: 771c9fe gave tests-desktop-windows.yml `statuses: write` (the PR's verdict step), but build.yml calls it with read-only
permissions, so GitHub refused to start main's "CI · Tests" at all (startup_failure on every push for 2 h): main ran no tests.
"""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github' / 'workflows'
LEVEL = {'none': 0, 'read': 1, 'write': 2}
JOB = re.compile(r'^  ([A-Za-z0-9_-]+):\s*$')


def _block(lines, start, indent):
    """The `key: value` lines right under lines[start], indented by `indent` spaces."""
    found = {}
    for line in lines[start + 1:]:
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        if len(line) - len(line.lstrip()) < indent:
            break
        match = re.match(r'^\s*([a-z-]+):\s*([a-z]+)', line)
        if match and len(line) - len(line.lstrip()) == indent:
            found[match.group(1)] = match.group(2)
    return found


def _permissions(text):
    """(the workflow's own permissions, {job: (its permissions or None, the local workflow it calls or None)})."""
    lines = text.splitlines()
    top, jobs, job, in_jobs = {}, {}, None, False
    for i, line in enumerate(lines):
        if line.startswith('permissions:'):
            top = _block(lines, i, 2)
        elif line.startswith('jobs:'):
            in_jobs = True
        elif in_jobs and JOB.match(line):
            job = JOB.match(line).group(1)
            jobs[job] = [None, None]
        elif job and line.startswith('    permissions:'):
            jobs[job][0] = _block(lines, i, 6)
        elif job and re.match(r'^    uses: \./\.github/workflows/', line):
            jobs[job][1] = line.split('/')[-1].strip()
    return top, {name: tuple(spec) for name, spec in jobs.items()}


def _asked(text):
    """Every permission the workflow or one of its jobs asks for, at its highest level."""
    top, jobs = _permissions(text)
    asked = dict(top)
    for job_permissions, _ in jobs.values():
        for scope, level in (job_permissions or {}).items():
            if LEVEL.get(level, 0) > LEVEL.get(asked.get(scope, 'none'), 0):
                asked[scope] = level
    return asked


def short_grants(workflows=WORKFLOWS):
    """Each call whose caller grants less than the called workflow asks for: 'caller job -> called: scope wants X, gets Y'."""
    short = []
    for caller in sorted(workflows.glob('*.yml')):
        top, jobs = _permissions(caller.read_text())
        for job, (job_permissions, called) in jobs.items():
            if not called:
                continue
            granted = job_permissions if job_permissions is not None else top
            for scope, level in _asked((workflows / called).read_text()).items():
                if LEVEL.get(granted.get(scope, 'none'), 0) < LEVEL.get(level, 0):
                    short.append(f"{caller.name} {job} -> {called}: {scope} wants {level}, gets {granted.get(scope, 'none')}")
    return short


class CallersGrantWhatTheyCall(unittest.TestCase):
    def test_every_local_call_grants_what_the_called_workflow_asks(self):
        self.assertEqual(short_grants(), [], 'give the calling job a permissions: block with these (GitHub refuses to start the run)')

    def test_a_read_only_caller_of_a_status_writer_is_caught(self):
        folder = Path(self._tmp())
        (folder / 'caller.yml').write_text('permissions:\n  contents: read\njobs:\n  win:\n    uses: ./.github/workflows/called.yml\n')
        (folder / 'called.yml').write_text('on:\n  workflow_call:\npermissions:\n  contents: read\n  statuses: write\njobs:\n  a:\n    runs-on: x\n')
        self.assertEqual(short_grants(folder), ['caller.yml win -> called.yml: statuses wants write, gets none'])
        (folder / 'caller.yml').write_text('permissions:\n  contents: read\njobs:\n  win:\n    permissions:\n      contents: read\n'
                                           '      statuses: write\n    uses: ./.github/workflows/called.yml\n')
        self.assertEqual(short_grants(folder), [])

    def _tmp(self):
        import tempfile
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        return folder.name


if __name__ == '__main__':
    unittest.main()
