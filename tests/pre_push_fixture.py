"""The fixture of the push hook's tests (tools/pre-push-check.sh): a throwaway repo with a stub `gh` and a stub tools/check.sh, plus the helpers the three test files share.
Owns: setUp/hook/commit/areas_run and the gate and watchdog stubs. Tests: test_pre_push_check.py (commit subjects, red main, areas, the gates beside the suites), test_pre_push_areas.py (which areas a push runs),
test_pre_push_budget.py (the watchdog, JP_GATE_FULL, the SLOW summary). Not a test module itself (no test_ prefix)."""
import json
import os
import shutil
import subprocess
import tempfile
import time
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK = ROOT / 'tools' / 'pre-push-check.sh'

# The stub suite: fails when the file a test needs is missing from the checkout it runs in, and logs where it ran.
CHECK = '''#!/usr/bin/env bash
echo "$PWD $*" >> "$CHECK_LOG"
[ -f desktop/shared/needed.js ] || { echo "not ok - needed.js missing"; exit 1; }
'''
# The stub gh: `run list --status completed` answers the last finished build, any other `run list` the newest build.
GH = '''#!/usr/bin/env bash
case "$*" in *"run view"*) echo "$GH_FAILED_JOBS" ;; *"run rerun"*) echo "$*" >> "$CHECK_LOG.rerun" ;; *"run list"*) echo "$GH_RUNS" ;; esac
'''


def runs_json(sha, tests=('completed', 'success'), pages=('completed', 'success'), run_id=42):
    """What `gh run list --json ...` says about main's CI runs of one commit (tools/red-main.sh reads it)."""
    rows = [{'workflowName': name, 'headSha': sha, 'status': st, 'conclusion': conc, 'databaseId': run_id + n, 'updatedAt': '2026-10-11T15:00:00Z', 'url': f'https://x/runs/{run_id + n}'}
            for n, (name, (st, conc)) in enumerate((('CI · Tests', tests), ('CI · Integration · Page cases (all cases, real extension, Linux)', pages)))]
    return json.dumps(rows)


def git(cwd, *args):
    return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()

@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class PrePushFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.repo, origin, self.bin = self.tmp / 'repo', self.tmp / 'origin.git', self.tmp / 'bin'
        for folder in ('src', 'worker', 'tools', 'desktop', 'admin'):
            (self.repo / folder).mkdir(parents=True)
        self.bin.mkdir()
        (self.repo / 'src' / 'daily.py').write_text('')
        (self.repo / 'worker' / 'package.json').write_text('{}')
        (self.repo / 'admin' / 'a.js').write_text('')   # the website's folder (in the real repo it is laid over by the private repo's CI); the hook skips the site area without it
        (self.repo / 'desktop' / '.gitignore').write_text('shared/\n')
        shutil.copy(HOOK, self.repo / 'tools' / 'pre-push-check.sh')
        shutil.copy(ROOT / 'tools' / 'commit-subject.py', self.repo / 'tools' / 'commit-subject.py')
        shutil.copy(ROOT / 'tools' / 'gate-watchdog.sh', self.repo / 'tools' / 'gate-watchdog.sh')   # the hook sources it when it sits beside it
        shutil.copy(ROOT / 'tools' / 'ci-installs-dev.py', self.repo / 'tools' / 'ci-installs-dev.py')   # the build.yml dev-dependency gate
        shutil.copy(ROOT / 'tools' / 'red-main.sh', self.repo / 'tools' / 'red-main.sh')   # main's state: green, red or unknown
        (self.repo / 'tools' / 'stale-expectations.mjs').write_text('')
        for path, text in ((self.repo / 'tools' / 'check.sh', CHECK), (self.bin / 'gh', GH), (self.bin / 'actionlint', '#!/bin/sh\n')):
            path.write_text(text)
            path.chmod(0o755)
        subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', str(origin)], check=True)
        git(self.repo, 'init', '-q', '-b', 'main')
        git(self.repo, 'config', 'user.email', 't@example.com')
        git(self.repo, 'config', 'user.name', 'Test')
        git(self.repo, 'add', '-A')
        git(self.repo, 'commit', '-qm', 'Start')
        git(self.repo, 'remote', 'add', 'origin', str(origin))
        git(self.repo, 'push', '-q', 'origin', 'main')
        self.log = self.tmp / 'check.log'
        self.env = {**os.environ, 'PATH': f'{self.bin}{os.pathsep}{os.environ["PATH"]}', 'CHECK_LOG': str(self.log),
                    'GH_RUNS': runs_json(git(self.repo, 'rev-parse', 'origin/main')), 'GH_FAILED_JOBS': ''}

    def hook(self, command, **env):
        payload = json.dumps({'tool_input': {'command': command}, 'cwd': str(self.repo)})
        result = subprocess.run(['bash', str(self.repo / 'tools' / 'pre-push-check.sh')], input=payload, capture_output=True,
                                text=True, env={**self.env, **env}, timeout=120)
        return result.returncode, result.stderr

    def commit(self, subject, files=None):
        for name, text in (files or {'change.txt': subject}).items():
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        git(self.repo, 'add', '-A')
        git(self.repo, 'commit', '-qm', subject)

    def needed_committed(self):
        (self.repo / 'desktop' / '.gitignore').write_text('')
        self.commit('Add the needed file', {'desktop/shared/needed.js': 'export {};\n'})

    def areas_run(self, command='git push origin HEAD:main'):
        self.log.unlink(missing_ok=True)
        code, err = self.hook(command)
        runs = self.log.read_text().splitlines() if self.log.exists() else []
        return code, sorted(line.split(' --area ')[1].split()[0] for line in runs), err   # areas run side by side (9 Oct 2026): compare as a set

    def gate_stubs(self, journey_exit=0, seconds=1):
        # a journey gate and a suite that each take `seconds` and log when they start and end; the ladder gate is absent (the hook skips a gate that is not there)
        (self.repo / 'tools' / 'journey-gate.mjs').write_text(f"import fs from 'node:fs'; fs.appendFileSync(process.env.CHECK_LOG + '.order', 'gate-start\\n'); await new Promise(r => setTimeout(r, {seconds * 1000})); fs.appendFileSync(process.env.CHECK_LOG + '.order', 'gate-end\\n'); console.log('journey gate: stub says {'no' if journey_exit else 'yes'}'); process.exit({journey_exit});\n")
        check = self.repo / 'tools' / 'check.sh'
        check.write_text(f'#!/usr/bin/env bash\necho suite-start >> "$CHECK_LOG.order"; sleep {seconds}; echo suite-end >> "$CHECK_LOG.order"\n')
        check.chmod(0o755)
        self.commit('Gate stubs', {'desktop/shared/needed.js': 'export {};\n', 'worker/a.js': 'x'})
        git(self.repo, 'push', '-q', 'origin', 'HEAD:main')
        self.commit('Worker change', {'worker/b.js': str(journey_exit) + str(seconds)})
        Path(str(self.log) + '.order').unlink(missing_ok=True)

    def slow_suite(self, seconds, whole=False):
        check = self.repo / 'tools' / 'check.sh'
        check.write_text(f'#!/usr/bin/env bash\necho "$PWD $*" >> "$CHECK_LOG"\nsleep {seconds}\n')
        check.chmod(0o755)
        self.commit('Slow suite stub', {'desktop/shared/needed.js': 'export {};\n', 'worker/a.js': 'x'})
        git(self.repo, 'push', '-q', 'origin', 'HEAD:main')
        self.commit('Worker change', {'Makefile': str(seconds)} if whole else {'worker/b.js': str(seconds)})   # an unknown top-level path: the picker says "all", the whole suite runs, and it may be deferred
