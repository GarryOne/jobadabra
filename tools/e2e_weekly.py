#!/usr/bin/env python3
"""The week's e2e reds by root cause, as one GitHub issue (gate G6, owner's yes 26 Oct 2026: "GitHub issue now").

  python3 tools/e2e_weekly.py [--days 7] [--dry-run]      e2e-weekly.yml, Mondays; --dry-run prints the issue instead of writing it

Every red suite job of the week's betas (desktop.yml), main checks (e2e.yml) and Windows runs (e2e-windows.yml) gets a cause read from its log (AI key, test
environment, intermittent, one cause behind N steps, a wait that ran out, a check that failed), mass events (one cause turning 5+ suites red in a run) count once,
and each row says which gate catches it now: G1 (the PR's plan missed the suite: the code→suite map), G2a (main was red before the beta), G4 (Windows never ran on
main), G5 (intermittent), or nothing yet. The `red-main` issues (gate G2b) add the breaking PR and whether it ran the suite. The rows the gates do not catch are
the next gate to build; a "G1: missed" row is a suite the coverage map must learn (pr-suites.mjs --map).
Why: 26 Oct 2026, the owner: "why still we have problems with e2e? What's wrong in our process", "I want to emphasize on the root causes".
Tests: tests/test_e2e_weekly.py
"""
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.e2e_causes import ENVIRONMENT_CAUSES, classify  # noqa: E402  (one classifier: the bisect skips environment reds with it)
from tools.main_e2e_state import NOT_SUITE, is_main_check, suite_of  # noqa: E402

REPO = os.environ.get('GITHUB_REPOSITORY', 'GarryOne/jobadabra')
LABEL = 'e2e-weekly'
MASS = 5            # suites red on one cause in one run: one event, not five bugs
SAMPLE = 3          # a run with many reds: read this many logs first; all on one environment cause → the whole run is that event



def suite_and_os(job_name, kind):
    """'E2E · Windows · foryou' → ('foryou', 'Windows'); an e2e.yml job 'recorded-2of5' → ('recorded', 'Mac/Linux')."""
    parts = [p.strip() for p in job_name.split('·')]
    if len(parts) >= 3 and parts[0] == 'E2E':
        return suite_of(re.sub(r' \(Windows\)$', '', parts[-1])), 'Windows' if parts[1] == 'Windows' else 'Mac/Linux'
    name = re.sub(r' \(Windows\)$', '', job_name)
    return suite_of(name), 'Windows' if kind == 'windows' or name != job_name else 'Mac/Linux'


def is_suite_job(name):
    return name not in NOT_SUITE and not name.startswith(('Release ·', 'Build', 'Code → suite map', 'Windows HTML report', 'approve')) and name != 'changes'


def events(rows):
    """Rows of one run sharing an environment cause on MASS+ suites fold into one event row."""
    out, by_run = [], {}
    for row in rows:
        by_run.setdefault((row['run'], row['cause']), []).append(row)
    for (run, cause), group in by_run.items():
        if cause in ENVIRONMENT_CAUSES and len(group) >= MASS:
            first = group[0]
            out.append({**first, 'suite': f'{len(group)} suites', 'event': len(group)})
        else:
            out.extend(group)
    return out


def caught_by(row):
    """Which gate catches this red now, from what is known about it."""
    if row['cause'] in ENVIRONMENT_CAUSES:
        return 'the test environment: no gate (fix the key or the service)'
    if row.get('pr_ran') is False:
        return f"G1: PR #{row['pr']} did not run `{row['suite']}` (the code→suite map learns it)"
    if row['kind'] == 'beta' and row.get('main_before') == 'failure':
        return 'G2a: main was red on it before the beta (a beta now refuses)'
    if row['cause'] == 'intermittent':
        return 'G5: kept red as intermittent (a race)'
    if row['os'] == 'Windows' and row['kind'] == 'beta' and row.get('main_before') is None:
        return 'G4: Windows never ran it on main before (daily now)'
    if row['kind'] in ('main', 'windows'):   # red on main itself: G2a blocks the beta and the bisect issue (G2b) names the breaking PR
        return 'G2a: red main, owned: a beta refuses and the bisect issue names the PR'
    if row.get('pr_ran') is True:
        return f"nothing yet: PR #{row['pr']} ran it green, it broke later"
    return 'nothing yet: read it (skill fix-failing-e2e)'


def main_before(main_runs, suite, before, jobs_of, os_name='Mac/Linux'):
    """The newest main check of `suite` on `os_name` that finished before `before` (ISO): 'success' | 'failure' | None (main never ran it there).
    A Windows beta red is compared with main's Windows jobs only: a green Linux job says nothing about Windows (first dry run, 26 Oct 2026)."""
    for run in main_runs:
        if (run.get('created_at') or '') >= before:
            continue
        for job in jobs_of(run['id']):
            if is_suite_job(job.get('name', '')) and suite_and_os(job['name'], 'main') == (suite, os_name) and job.get('conclusion') in ('success', 'failure'):
                return job['conclusion']
    return None


def breaking_prs(issues):
    """`red-main` issues (gate G2b) → {suite: {'pr': n, 'branch': b}}."""
    out = {}
    for issue in issues:
        title = re.match(r'Red main: (\S+)', issue.get('title') or '')
        found = re.search(r'Breaking PR: #(\d+) \(branch `([^`]+)`\)', issue.get('body') or '')
        if title and found:
            out[title.group(1)] = {'pr': int(found.group(1)), 'branch': found.group(2)}
    return out


def render(rows, week, days, counts):
    lines = [f'## E2E root causes · {week}', '',
             f"> {counts['runs']} runs read (betas, main checks, Windows) over {days} days · {counts['red']} red suite jobs · "
             f"{len(rows)} rows after folding mass events", '']
    if counts.get('unread'):
        lines += [f"> ⚠ GitHub did not list the jobs of {len(counts['unread'])} run(s), so they are missing here: {', '.join(counts['unread'])}", '']
    by_cause = Counter(row['cause'] for row in rows)
    lines += ['| Cause | Rows |', '|---|---:|'] + [f'| {cause} | {n} |' for cause, n in by_cause.most_common()] + ['']
    gaps = [row for row in rows if caught_by(row).startswith('nothing yet')]
    lines += [f'**Not caught by any gate yet: {len(gaps)}.** These are the next gate to build.', '',
              '| Where | Suite | OS | Cause | First red step | Caught by now |', '|---|---|---|---|---|---|']
    for row in sorted(rows, key=lambda r: (not caught_by(r).startswith('nothing yet'), r['kind'], r['suite'])):
        where = f"[{row['kind']}]({row['url']})"
        lines.append(f"| {where} | `{row['suite']}` | {row['os']} | {row['cause']} | {row['detail'].replace('|', '/')} | {caught_by(row)} |")
    lines += ['', '<sub>Built by tools/e2e_weekly.py (gate G6). A "G1" row: run `node desktop/e2e/pr-suites.mjs --base <PR base> --plan --map <coverage-map.json>` on that PR '
              'to see whether the map picks it now.</sub>']
    return '\n'.join(lines)


# ---- GitHub ----
def gh(*args, check=True, tries=4):
    for attempt in range(tries):   # GitHub answers a 502 now and then: a weekly report must not die on one (26 Oct 2026, the first dry run)
        out = subprocess.run(['gh', *args], capture_output=True, text=True)
        if out.returncode == 0 or not check:
            break
        if attempt + 1 < tries:
            time.sleep(10 * 2 ** attempt)   # 10, 20, 40 s: the second dry run hit three 502s in 30 s on one run
    if check and out.returncode:
        raise RuntimeError(f"gh {' '.join(args[:3])}: {out.stderr.strip()[:200]}")
    return out.stdout


def gh_json(*args):
    return json.loads(gh(*args) or 'null')


def runs_of(workflow, since):
    runs = gh_json('api', f'repos/{REPO}/actions/workflows/{workflow}/runs?status=completed&per_page=100&created=>={since}', '--jq', '.workflow_runs') or []
    return [r for r in runs if r.get('conclusion') in ('success', 'failure')]


_jobs = {}
UNREAD = []   # runs GitHub would not list the jobs of, even after the retries: named in the report, never a crash


def jobs_of(run_id):
    if run_id not in _jobs:
        try:
            _jobs[run_id] = gh_json('api', f'repos/{REPO}/actions/runs/{run_id}/jobs?per_page=100', '--jq', '.jobs') or []
        except RuntimeError as error:
            UNREAD.append(f'{run_id} ({str(error)[-60:]})')
            _jobs[run_id] = []
    return _jobs[run_id]


def log_of(job_id):
    return gh('run', 'view', '--job', str(job_id), '-R', REPO, '--log-failed', check=False)


def collect(days):
    since = time.strftime('%Y-%m-%d', time.gmtime(time.time() - days * 86400))
    betas = [r for r in runs_of('desktop.yml', since) if r['conclusion'] == 'failure']
    main = [r for r in runs_of('e2e.yml', since) if is_main_check(r)]
    windows = [r for r in runs_of('e2e-windows.yml', since) if r.get('head_branch') == 'main' and r['conclusion'] == 'failure']
    reds = []
    for kind, runs in (('beta', betas), ('main', [r for r in main if r['conclusion'] == 'failure']), ('windows', windows)):
        for run in runs:
            failed = [j for j in jobs_of(run['id']) if j.get('conclusion') == 'failure' and is_suite_job(j.get('name', ''))]
            sampled = {}
            if len(failed) > MASS:   # many reds: one environment cause? read a few first
                for job in failed[:SAMPLE]:
                    sampled[job['id']] = classify(log_of(job['id']))
                causes = {c for c, _ in sampled.values()}
                if len(causes) == 1 and causes <= set(ENVIRONMENT_CAUSES):
                    cause, detail = next(iter(sampled.values()))
                    sampled = {job['id']: (cause, detail) for job in failed}
            for job in failed:
                cause, detail = sampled.get(job['id']) or classify(log_of(job['id']))
                suite, os_name = suite_and_os(job['name'], kind)
                reds.append({'kind': kind, 'run': run['id'], 'url': run.get('html_url', ''), 'at': run.get('created_at', ''), 'suite': suite, 'os': os_name,
                             'cause': cause, 'detail': detail})
    prs = breaking_prs(gh_json('issue', 'list', '-R', REPO, '--label', 'red-main', '--state', 'all', '--search', f'created:>={since}', '--json', 'title,body') or [])
    for row in reds:
        if row['kind'] == 'beta' and row['cause'] not in ENVIRONMENT_CAUSES:
            row['main_before'] = main_before(main, row['suite'], row['at'], jobs_of, row['os'])
        if row['suite'] in prs:
            row.update(prs[row['suite']])
            ran = gh_json('api', f"repos/{REPO}/actions/workflows/e2e.yml/runs?branch={prs[row['suite']]['branch']}&per_page=20", '--jq', '[.workflow_runs[].id]') or []
            row['pr_ran'] = any(suite_and_os(j['name'], 'pr')[0] == row['suite'] for rid in ran for j in jobs_of(rid) if j.get('conclusion') in ('success', 'failure'))
    return reds, len(betas) + len(main) + len(windows)


def main(argv):
    days = int(argv[argv.index('--days') + 1]) if '--days' in argv else 7
    reds, runs = collect(days)
    rows = events(reds)
    week = time.strftime('%G-W%V', time.gmtime())
    body = render(rows, week, days, {'runs': runs, 'red': len(reds), 'unread': UNREAD})
    if '--dry-run' in argv:
        print(body)
        return 0
    title = f'E2E root causes · {week}'
    gh('label', 'create', LABEL, '-R', REPO, '--force', '--color', '1D76DB', '--description', "The week's e2e reds by root cause (tools/e2e_weekly.py)", check=False)
    existing = [i for i in gh_json('issue', 'list', '-R', REPO, '--label', LABEL, '--state', 'all', '--json', 'number,title') or [] if i['title'] == title]
    if existing:
        gh('issue', 'edit', str(existing[0]['number']), '-R', REPO, '--body', body)
    else:
        gh('issue', 'create', '-R', REPO, '--title', title, '--label', LABEL, '--body', body)
    print(f'{title}: {len(rows)} rows')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
