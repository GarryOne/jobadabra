#!/usr/bin/env python3
"""Refuse new Python code that is too tangled or has a plain bug shape (Ruff), on the lines a change adds, never on old code.
  python3 tools/clean-code-py.py [--base origin/main]    exit 1 with file:line, the rule and the fix for each finding on an added line
Run by tools/pre-push-check.sh (the push gate, and CI's pr-gate job through it). Ruff is pinned and installed on first use into
~/.cache/jobadabra (no manual step); with no network and no Ruff it says so and checks nothing.
Why (28 Oct 2026, owner): "our code is very clean so that AI hallucinations are less prone to introduce bugs". Rules kept by a 20-finding sample on the
whole tree (docs/superpowers/plans/2026-10-28-clean-code-checks.md): McCabe complexity, unused imports and locals, a lambda over a loop variable, a raise
inside except without `from`. Dropped as noise or style: star imports, argument and statement counts, `open()` without a with, redefined re-exports."""
import json
import os
import re
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUFF_VERSION = '0.17.3'
MAX_COMPLEXITY = 15   # McCabe; the Python baseline has 87 functions over 10, 33 over 15
RULES = 'C901,F401,F841,B023,B904'
SCOPE = re.compile(r'^(src|tools)/.*\.py$')
FIXES = {'C901': 'split the function into named steps', 'F401': 'remove the import, or `# noqa: F401 (<why>)` for a deliberate re-export',
         'F841': 'remove the unused local', 'B023': 'bind the loop variable (a default argument)', 'B904': 'raise ... from error (or from None)'}


def added_lines(diff):
    """Line numbers a unified diff (-U0) adds to its file."""
    added = set()
    for start, count in re.findall(r'^@@ [^+]*\+(\d+)(?:,(\d+))? @@', diff, re.M):
        added.update(range(int(start), int(start) + (1 if count == '' else int(count))))
    return added


def ruff_command():
    """The pinned Ruff as an argv list: the one on PATH when its version matches, else a venv under ~/.cache/jobadabra (made on first use); None when it cannot be had."""
    def version(argv):
        try:
            return subprocess.run([*argv, '--version'], capture_output=True, text=True, timeout=30).stdout.split()[-1]
        except (OSError, subprocess.SubprocessError, IndexError):
            return None
    if version(['ruff']) == RUFF_VERSION:
        return ['ruff']
    home = Path(os.environ.get('JOBADABRA_CACHE', Path.home() / '.cache' / 'jobadabra')) / f'ruff-{RUFF_VERSION}'
    binary = home / ('Scripts' if os.name == 'nt' else 'bin') / ('ruff.exe' if os.name == 'nt' else 'ruff')
    if not binary.exists():
        try:
            venv.create(home, with_pip=True)
            subprocess.run([str(binary.parent / ('python.exe' if os.name == 'nt' else 'python')), '-m', 'pip', 'install', '-q', f'ruff=={RUFF_VERSION}'], check=True, capture_output=True, timeout=300)
        except (OSError, subprocess.SubprocessError):
            return None
    return [str(binary)] if version([str(binary)]) == RUFF_VERSION else None


def check(files, ruff):
    """Lint each {path, source, added} and keep the findings that sit on an added line: [{path, line, rule, message}]."""
    found = []
    for file in files:
        run = subprocess.run([*ruff, 'check', '--isolated', '--select', RULES, '--config', f'lint.mccabe.max-complexity = {MAX_COMPLEXITY}', '--output-format', 'json',
                              '--stdin-filename', file['path'], '-'], input=file['source'], capture_output=True, text=True, cwd=ROOT)
        for item in json.loads(run.stdout or '[]'):
            if item['location']['row'] in file['added']:
                found.append({'path': file['path'], 'line': item['location']['row'], 'rule': item['code'], 'message': item['message']})
    return found


def git(*args):
    """stdout of `git <args>` run in the repo root; raises CalledProcessError on a non-zero exit."""
    return subprocess.run(['git', *args], capture_output=True, text=True, cwd=ROOT, check=True).stdout


def main():
    """Entry point: 0 when nothing is found (or nothing to check), 1 with the findings on stderr."""
    base = sys.argv[sys.argv.index('--base') + 1] if '--base' in sys.argv else 'origin/main'
    try:
        base = git('merge-base', base, 'HEAD').strip()
    except subprocess.CalledProcessError:
        pass   # no shared history (a shallow checkout): the ref itself is the base
    names = [n for n in git('diff', '--name-only', '--diff-filter=AM', base).split('\n') if SCOPE.match(n)]
    if not names:
        return 0
    ruff = ruff_command()
    if ruff is None:
        print('clean-code-py: Ruff is not installed and could not be fetched (offline?): nothing checked', file=sys.stderr)
        return 0
    files = [{'path': n, 'source': (ROOT / n).read_text(encoding='utf-8'), 'added': added_lines(git('diff', '-U0', base, '--', n))} for n in names]
    found = check(files, ruff)
    for f in found:
        print(f"{f['path']}:{f['line']}  {f['rule']}  {f['message']} ({FIXES.get(f['rule'], '')})", file=sys.stderr)
    if found:
        print(f'clean-code-py: {len(found)} finding(s) on lines this change adds. A justified exception: # noqa: <rule> (Why: <reason>)', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
