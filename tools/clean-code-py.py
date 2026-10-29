#!/usr/bin/env python3
"""Refuse new Python code that is too tangled or has a plain bug shape (Ruff), on the lines a change adds, and an old
function a change makes more complex while it is over the limit; old code left as complex as it was is never refused.
  python3 tools/clean-code-py.py [--base origin/main]    exit 1 with file:line, the rule and the fix for each finding
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


def base_line_of(diff):
    """For a diff with no context lines (-U0): a function giving each new line's base line number, or None for a line the diff adds.
    Invariant: a hunk with no new lines (`+c,0`) removes base lines after new line c."""
    hunks = [(int(removed or 1), int(start), int(count or 1)) for removed, start, count in re.findall(r'^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', diff, re.M)]

    def line_of(line):
        shift = 0
        for removed, start, count in hunks:
            if start <= line < start + count:
                return None
            if line > (start + count - 1 if count else start):
                shift += removed - count
        return line + shift
    return line_of


def lint(ruff, path, source):
    """Ruff's findings for one source text, as its JSON items; a Ruff failure stops the gate instead of reading as a clean file."""
    run = subprocess.run([*ruff, 'check', '--isolated', '--select', RULES, '--config', f'lint.mccabe.max-complexity = {MAX_COMPLEXITY}', '--output-format', 'json',
                          '--stdin-filename', path, '-'], input=source, capture_output=True, text=True, cwd=ROOT)
    if run.returncode not in (0, 1):   # 1 = findings
        raise SystemExit(f"clean-code-py: Ruff failed on {path} (exit {run.returncode}): {run.stderr.strip()}")
    return json.loads(run.stdout or '[]')


def complexity(item):
    """The McCabe score in a C901 message ("`f` is too complex (19 > 15)")."""
    return int(re.search(r'\((\d+) > \d+\)', item['message']).group(1))


def grown(file, item, ruff, before):
    """The message when an old function's C901 finding (its def line unchanged) shows the change made it more complex, else None.
    `before` caches the base's scores by line for the file."""
    if item['code'] != 'C901' or not file.get('base'):
        return None
    if 'scores' not in before:
        before['scores'] = {i['location']['row']: complexity(i) for i in lint(ruff, file['path'], file['base']['source']) if i['code'] == 'C901'}
    was = before['scores'].get(file['base']['line_of'](item['location']['row']), 0)
    if complexity(item) <= was:
        return None
    return f"{item['message']}: this change raised it from {was or f'at most {MAX_COMPLEXITY}'}; an old function over the limit may not grow"


def check(files, ruff):
    """Lint each {path, source, added, base} and keep the findings on an added line, and each old function (def line unchanged) the change
    made more complex while it is over the limit: [{path, line, rule, message}]. `base` is {source, line_of} before the change, None for a new file."""
    found = []
    for file in files:
        before = {}
        for item in lint(ruff, file['path'], file['source']):
            row = item['location']['row']
            # Why (29 Oct 2026, owner: "do we have PR CI guardrails to not get back again in this situation"): desktop.py main (64) and
            # daily_search search (84) grew a few lines at a time, each change passing because C901 is reported on the def line only.
            message = item['message'] if row in file['added'] else grown(file, item, ruff, before)
            if message:
                found.append({'path': file['path'], 'line': row, 'rule': item['code'], 'message': message})
    return found


def git(*args, root=ROOT):
    """stdout of `git <args>` run in `root`; raises CalledProcessError on a non-zero exit."""
    return subprocess.run(['git', *args], capture_output=True, text=True, cwd=root, check=True).stdout


def changed_files(base, root=ROOT):
    """The in-scope Python files the committed HEAD adds or edits since `base`, as [{path, source, added, base}]: the pushed commits only (never the
    working tree) and renames counted as new files (base None), so a moved-and-edited file is checked too."""
    rows = [row.split('\t') for row in git('diff', '--name-status', '--no-renames', '--diff-filter=AM', base, 'HEAD', root=root).split('\n') if '\t' in row]
    files = []
    for status, name in rows:
        if not SCOPE.match(name):
            continue
        diff = git('diff', '-U0', '--no-renames', base, 'HEAD', '--', name, root=root)
        before = {'source': git('show', f'{base}:{name}', root=root), 'line_of': base_line_of(diff)} if status == 'M' else None
        files.append({'path': name, 'source': git('show', f'HEAD:{name}', root=root), 'added': added_lines(diff), 'base': before})
    return files


def main():
    """Entry point: 0 when nothing is found (or nothing to check), 1 with the findings on stderr."""
    base = sys.argv[sys.argv.index('--base') + 1] if '--base' in sys.argv else 'origin/main'
    try:
        base = git('merge-base', base, 'HEAD').strip()
    except subprocess.CalledProcessError:
        pass   # no shared history (a shallow checkout): the ref itself is the base
    files = changed_files(base)
    if not files:
        return 0
    ruff = ruff_command()
    if ruff is None:
        print('clean-code-py: Ruff is not installed and could not be fetched (offline?): nothing checked', file=sys.stderr)
        return 0
    found = check(files, ruff)
    for f in found:
        print(f"{f['path']}:{f['line']}  {f['rule']}  {f['message']} ({FIXES.get(f['rule'], '')})", file=sys.stderr)
    if found:
        print(f'clean-code-py: {len(found)} finding(s) in this change. A justified exception: # noqa: <rule> (Why: <reason>)', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
