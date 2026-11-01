#!/usr/bin/env python3
"""Is a commit proved by the night? A beta by hand starts only on a proved commit (owner, 1 Nov 2026: "Only on a proved commit").

A commit is proved when ALL hold, each read by the commit's sha, never by "the latest run":
  1. every night burn-in pass of it is green, Mac + Linux and Windows: passes 1 to 5 (desktop/e2e/lib/night-pass.mjs, e2e.yml night_pass, e2e-windows.yml night);
     a run of that pass that is red, cancelled or still running is "not proved", a red one even when a re-run of it was green (the burn-in admits only first tries);
  2. main's build.yml ("CI · Tests", the unit suites) is green on it;
  3. a pre-release build of it carries both lanes' unit outcome, green (desktop.yml's Build jobs upload unit-mac.json and unit-windows.json beside the files, after the
     smoke test of the built app: a lane that did not get that far has no such file);
  4. no main check of e2e.yml on it is red.
A missing result is "not proved", never a pass. One line per missing item; exit 0 when proved, 1 otherwise (and the newest commit that IS proved, if any).

  tools/night_proof.py [--repo o/r] [--sha <commit>]     default: main's head, the commit a beta by hand would build
Why (1 Nov 2026, a8): 68 of 90 betas by hand ended red in 24 days (76%), each 30 minutes; the night runs the same suites on the same commit five times over.
Tests: tests/test_night_proof.py (recorded burn-in runs in tests/fixtures/night-proof/). NIGHT_PROOF_DATA=<file> reads the lists from a JSON file instead of GitHub (the tests).
"""
import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

try:
    from . import e2e_gate, main_e2e_state
except ImportError:  # run as tools/night_proof.py
    import e2e_gate
    import main_e2e_state

REPO = 'GarryOne/jobadabra'
PASSES = 5   # = NIGHT_PASSES in desktop/e2e/lib/night-pass.mjs (tests/test_night_proof.py pins both numbers)
SPAN = timedelta(hours=14)   # = SPAN_MS there: a pass looks for pass 1 within the night, never a previous one
MAC_TITLE = re.compile(rf'^Night burn-in (\d)/{PASSES} ')
WINDOWS_TITLE = re.compile(rf'^Night burn-in Windows (\d)/{PASSES} · ([0-9a-f]{{7,40}})$')   # e2e-windows.yml run-name: the sha is the commit the pass tested
LANES = {'mac': 'Mac', 'windows': 'Windows'}


def when(run):
    return datetime.fromisoformat(run['created_at'].replace('Z', '+00:00'))


def same(a, b):
    """The same commit written as a short or a full sha."""
    a, b = (a or '').lower(), (b or '').lower()
    return len(min(a, b, key=len)) >= 7 and (a.startswith(b) or b.startswith(a))


def state_of(run):
    if run.get('status') not in (None, 'completed'):
        return 'still running'
    return {'success': 'green', 'failure': 'red'}.get(run.get('conclusion'), run.get('conclusion') or 'still running')


def mac_passes(runs):
    """[(pass n, the commit it tested, run)] for the Mac + Linux burn-in runs. Pass 1 tests the head it started on; a later pass tests the commit of the newest pass 1
    started within the night before it, else its own head: the rule of nightRef() in desktop/e2e/lib/night-pass.mjs (the run's title does not name the commit)."""
    found = [(int(MAC_TITLE.match(run.get('display_title') or '').group(1)), run) for run in runs if MAC_TITLE.match(run.get('display_title') or '')]
    firsts = sorted((run for number, run in found if number == 1), key=when)
    out = []
    for number, run in found:
        tested = run['head_sha']
        if number > 1:
            before = [first for first in firsts if when(first) <= when(run) and when(run) - when(first) < SPAN]
            tested = before[-1]['head_sha'] if before else run['head_sha']
        out.append((number, tested, run))
    return out


def windows_passes(runs):
    out = []
    for run in runs:
        found = WINDOWS_TITLE.match(run.get('display_title') or '')
        if found:
            out.append((int(found.group(1)), found.group(2), run))
    return out


def burn_in_lines(sha, macs, windows):
    mine = {'mac': [(n, run) for n, tested, run in macs if same(tested, sha)], 'windows': [(n, run) for n, tested, run in windows if same(tested, sha)]}
    if not mine['mac'] and not mine['windows']:
        return [f'not proved: no burn-in on {sha[:7]}']
    lines = []
    for lane, label in (('mac', 'Mac + Linux'), ('windows', 'Windows')):
        for number in range(1, PASSES + 1):
            runs = [run for n, run in mine[lane] if n == number]
            if not runs:
                lines.append(f'not proved: no {label} burn-in pass {number}/{PASSES} on {sha[:7]}')
            for run in runs:
                if state_of(run) != 'green':
                    lines.append(f"not proved: {label} burn-in pass {number}/{PASSES} {state_of(run)} (run {run['id']})")
    return lines


def build_lines(sha, ci_runs):
    verdict = e2e_gate.ci_verdict(ci_runs)
    return [] if verdict == 'green' else [f'not proved: build.yml on {sha[:7]} is {"missing" if verdict == "none" else verdict}']


def main_lines(sha, e2e_runs):
    return [f"not proved: main's e2e is red on {sha[:7]} (run {run['id']})" for run in e2e_runs
            if same(run.get('head_sha'), sha) and main_e2e_state.is_main_check(run) and run.get('conclusion') == 'failure']


def unit_lines(sha, builds):
    """builds: [{tag, sha, unit: {'mac': outcome, 'windows': outcome}}] from the pre-releases that carry unit-<lane>.json."""
    mine = [build for build in builds if same(build.get('sha'), sha)]
    if not mine:
        return [f'not proved: no pre-release build of {sha[:7]} with its unit results (builds before 1 Nov 2026 carry none)']
    best = max(mine, key=lambda build: sum(build['unit'].get(lane) == 'success' for lane in LANES))
    return [f"not proved: unit tests on {LANES[lane]} {best['unit'].get(lane) or 'have no result'} in {best['tag']}" for lane in LANES if best['unit'].get(lane) != 'success']


def proof(sha, data):
    """The lines that say what is missing for `sha`; [] = proved. data: the lists fetch() reads."""
    return (burn_in_lines(sha, mac_passes(data['e2e_runs']), windows_passes(data['windows_runs']))
            + build_lines(sha, data['build_runs'].get(sha, [])) + main_lines(sha, data['e2e_runs']) + unit_lines(sha, data['builds']))


def newest_proved(data):
    """The commit of the newest night that is proved, or ''. Candidates: the commits the burn-in tested, newest pass first."""
    seen = []
    for _, tested, run in sorted(mac_passes(data['e2e_runs']), key=lambda item: when(item[2]), reverse=True):
        if tested not in seen:
            seen.append(tested)
    return next((sha for sha in seen if not proof(sha, data)), '')


def gh(*args):
    result = subprocess.run(['gh', *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"gh {' '.join(args[:3])} failed: {result.stderr.strip()[:200]}")
    return result.stdout


def runs_of(repo, workflow, query='', pages=3):
    """The newest runs of a workflow, 100 a page: PR runs crowd the list, so a night's passes can lie two or three pages back."""
    out = []
    for page in range(1, pages + 1):
        got = json.loads(gh('api', f'repos/{repo}/actions/workflows/{workflow}/runs?per_page=100&page={page}{query}', '--jq', '.workflow_runs'))
        out += got
        if len(got) < 100:
            break
    return out


def fetch(repo):
    e2e_runs, windows_runs = runs_of(repo, 'e2e.yml'), runs_of(repo, 'e2e-windows.yml', '&event=workflow_dispatch')
    shas = {tested for _, tested, _ in mac_passes(e2e_runs)}
    build_runs = {sha: json.loads(gh('api', f'repos/{repo}/actions/workflows/build.yml/runs?head_sha={sha}&status=completed&per_page=20', '--jq', '[.workflow_runs[]|{conclusion}]')) for sha in shas}
    builds = []
    for tag in gh('api', f'repos/{repo}/releases?per_page=30', '--jq', '.[]|select(any(.assets[]; .name=="unit-mac.json" or .name=="unit-windows.json"))|.tag_name').split():
        unit = {}
        for lane in LANES:
            result = subprocess.run(['gh', 'release', 'download', tag, '-R', repo, '-p', f'unit-{lane}.json', '-O', '-'], capture_output=True, text=True)
            unit[lane] = json.loads(result.stdout).get('unit') if result.returncode == 0 and result.stdout.strip() else None
        builds.append({'tag': tag, 'sha': gh('api', f'repos/{repo}/commits/{tag}', '--jq', '.sha').strip(), 'unit': unit})
    return {'e2e_runs': e2e_runs, 'windows_runs': windows_runs, 'build_runs': build_runs, 'builds': builds}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--repo', default=REPO)
    parser.add_argument('--sha', default='')
    args = parser.parse_args(argv)
    try:
        source = os.environ.get('NIGHT_PROOF_DATA')
        data = json.loads(Path(source).read_text()) if source else fetch(args.repo)
        sha = args.sha or (data.get('head') if source else gh('api', f'repos/{args.repo}/commits/main', '--jq', '.sha').strip())
    except (RuntimeError, ValueError, OSError) as error:
        print(f'not proved: {error} (unknown is never proved)')
        return 1
    lines = proof(sha, data)
    if not lines:
        print(f'proved: {sha[:7]}: 5/5 burn-in passes green on Mac + Linux and Windows, build.yml green, both unit results green')
        return 0
    print('\n'.join(lines))
    best = newest_proved(data)
    print(f'a beta by hand starts only on a proved commit; the newest proved commit on main: {best[:7]}' if best else
          'a beta by hand starts only on a proved commit; no commit on main is proved yet (the night burn-in needs 5 green passes on Mac + Linux and on Windows)')
    return 1


if __name__ == '__main__':
    sys.exit(main())
