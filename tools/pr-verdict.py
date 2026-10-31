#!/usr/bin/env python3
"""Write the PR's one required status from counted workflows (one writer, no timed re-read).
Usage: tools/pr-verdict.py --repo <owner/repo> (--sha <head> [--revalidate-head] | --sweep-heads) [--dry-run] [--job-status <status>]
Why (30 Oct 2026, owner, "One writer"): ~21 job writers x ~24 calls spent the token's 5,000 REST calls/hour; reads failed and green PRs stayed pending (#2609/#2605/#2598/#2593).
Why (28 Oct 2026, owner, "a PR is red only when its diff broke it"): proven main/health
failures are grey; new failure evidence stays red. AI score values remain informational.
Budget (owner's yes, 26 Oct 2026): CI-changing PRs whose checks ran over 10 min need CI-budget.
Why (27 Oct 2026, owner, "Count running time only"): union job spans count overlaps once, exclude runner queues; #2215's 12.4 min wall time included only 7.x min running.
Design: counted runs: the newest per workflow; for E2E for PR runs, per workflow + title.
The planner filters live/empty counted heads; each started writer revalidates the open head and writes.
"""
import argparse
# Job: report health
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

CONTEXT = 'All checks passed'
E2E_PR_TITLE = 'E2E for PR · '   # e2e.yml run-name for a run pr-suites.yml started
BUDGET_MIN = 10
STEP = "Write the PR's verdict"   # the old per-job writer, gone 30 Oct 2026 (one writer); a branch not yet rebased still has it: job_state reads it as ending
# TODO(AI): drop STEP, job_state's 'finishing' and verdict()'s me/my_status once no open PR predates the one-writer change (30 Oct 2026)
# Jobs that only report (an HTML report, a results upload) never hold or turn the verdict: on #2044 the settings suite was green at 04:36 and the PR waited on
# e2e's "HTML report" queued for a runner (owner, 26 Oct 2026: "again, why I cannot merge this PR?").
REPORT_JOBS = {'HTML report', 'Windows HTML report', 'AI review of the screenshots'}   # never decide a PR (page-cases' report does: its fill time vs main). The review: after the suites, on main and release runs only (.github/actions/e2e-review)
RED = {'failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required', 'stale'}
# Why a red job shows grey, in the order the description tells them: reason -> (word, what it says). 'main': its failure lines are main's own (main_red_greys);
# 'tolerant' / 'suspended': its suite is in the lane registry desktop/e2e/lanes.json (lane_greys; spec lanes table, 28 Oct 2026).
GREY_WORDS = {'main': ('grey', 'red on main too, not this PR'), 'tolerant': ('tolerant', 'AI, clock or outside: not a PR red'), 'suspended': ('suspended', 'flaky on main: not a PR red')}
GREY_WORDS.update({'ai-credit': ('grey', 'AI cap or credit'), 'runner': ('grey', 'runner not acquired'),
                   'install': ('grey', 'install download unavailable'), 'qualityai': ('report', 'AI number produced; score informational'),
                   # Why (31 Oct 2026, owner: "Grey: not known yet"): budget refusal is not a quality judgment.
                   'ai-budget': ('qualityai', 'AI budget refused, not judged')})
CI_FILES = re.compile(r'^(\.github/|tools/pr-|desktop/e2e/(lib/plan|lib/pr-suites|lib/coverage|pr-suites\.mjs|plan-run\.mjs))')
# The workflows a pull request can start: a pull_request trigger, or started by one of them. A workflow outside it (the users' Always On daily/scout/mail.yml,
# the nightly, a release) never runs on a PR, so editing it does not slow a PR: #2137 went red at 11.4 min, every check green, for daily/scout/mail.yml.
# Guard: tests/test_pr_verdict.py recomputes it from .github/workflows (a new PR workflow fails there until listed).
PR_WORKFLOWS = {'beta-approve.yml', 'conflict-label.yml', 'e2e-windows.yml', 'e2e.yml', 'extension-store-publish.yml', 'gitar-label.yml', 'harness.yml', 'hosted-probe.yml', 'key-org-proof.yml',
                'office-addon.yml', 'page-cases.yml', 'pr-closed-cancel.yml', 'pr-gate.yml', 'pr-suites.yml', 'ready-fill-image.yml', 'search-personas.yml', 'tests-desktop-windows.yml',
                'tests-desktop.yml', 'tests-python.yml', 'tests-worker.yml'}


def ci_change(files):
    workflow = re.compile(r'^\.github/workflows/([^/]+)$')
    return any(CI_FILES.match(file) and (not workflow.match(file) or workflow.match(file).group(1) in PR_WORKFLOWS) for file in files)


def _at(text):
    return datetime.fromisoformat(str(text).replace('Z', '+00:00'))


def counted(runs):
    """Newest per workflow; PR e2e runs keep each workflow/title's newest attempt."""
    mine = [r for r in runs if r.get('event') == 'pull_request' or str(r.get('displayTitle', '')).startswith(E2E_PR_TITLE)]
    newest = {}
    for r in sorted(mine, key=lambda r: (r.get('createdAt') or '', r.get('databaseId') or 0, r.get('attempt') or 0)):
        # Why (31 Oct 2026, owner: "Fix: count each run"): keep each E2E title's red; ordinary PR title edits replace the older gate.
        key = (r['workflowName'], r['displayTitle']) if str(r.get('displayTitle', '')).startswith(E2E_PR_TITLE) else r['workflowName']
        newest[key] = r
    return list(newest.values())


def job_state(job, me=None, my_status=''):
    """One job of a running workflow -> 'running', 'finishing' (only its verdict step and clean-up are left) or its conclusion."""
    if me is not None and job.get('id') == me:
        return {'success': 'success', 'failure': 'failure'}.get(my_status, 'cancelled')
    if job.get('status') == 'completed':
        return job.get('conclusion') or 'success'
    steps = job.get('steps') or []
    left = [st for st in steps if st.get('status') != 'completed' and st.get('name') != STEP and not str(st.get('name', '')).startswith('Post ') and st.get('name') != 'Complete job']
    return 'finishing' if any(st.get('name') == STEP for st in steps) and not left else 'running'


def clock(at):
    """'07:04 Zurich' (the owner's time); 'HH:MM UTC' where Python has no time-zone data (Windows runners)."""
    try:
        from zoneinfo import ZoneInfo
        return at.astimezone(ZoneInfo('Europe/Zurich')).strftime('%H:%M Zurich')
    except Exception:   # zoneinfo missing, or no tz database (ZoneInfoNotFoundError)
        return at.astimezone(timezone.utc).strftime('%H:%M UTC')


def marks(log):
    """A suite job's log -> the set of its failure lines ("✗ step: reason", the e2e runner's mark), without gh's job/step columns, the timestamp or the indent."""
    lines = (re.sub(r'^.*?\d{4}-\d\d-\d\dT[\d:.]+Z ', '', line).strip() for line in (log or '').splitlines())
    return {line for line in lines if line.startswith(('✗ ', '✖ '))}


def mains_own(pr_log, main_logs):
    """True when the PR's red suite job printed only failure lines that main's own red of the suite printed too: main's red, not this diff."""
    mine = marks(pr_log)
    return bool(mine) and mine <= set().union(*(marks(log) for log in main_logs))


def label(r, running_jobs=()):
    """How the status names a run it waits for: the PR's e2e run by its suites (the run is not in the PR's checks list), others by workflow."""
    title = str(r.get('displayTitle', ''))
    if title.startswith(E2E_PR_TITLE):
        return 'e2e ' + (', '.join(running_jobs) or title[len(E2E_PR_TITLE):].split(' · ')[0])
    return r['workflowName'].replace('CI · ', '')


def running_minutes(spans, now=None):
    """[(started_at, completed_at or None)] of every job that started -> minutes while at least one ran (overlaps count once). None: no span to read."""
    now = now or datetime.now(timezone.utc)
    parts = sorted((_at(start), _at(end) if end else now) for start, end in spans if start)
    if not parts:
        return None
    total, (lo, hi) = 0.0, parts[0]
    for start, end in parts[1:]:
        if start > hi:
            total += (hi - lo).total_seconds(); lo, hi = start, end
        else:
            hi = max(hi, end)
    return (total + (hi - lo).total_seconds()) / 60


def verdict(runs, files=(), messages=(), jobs=None, me=None, my_status='', now=None, spans=None, greys=(), reports=(), burn_in=None):
    """-> (state or None, description, the runs counted, the ids of other jobs finishing now, the run to link). None: no run of a pull request on this commit.
    jobs: {run id: [job]} for the runs read job by job (not ended, or red); me: the id of the job this runs in, my_status its status so far.
    spans: [(started_at, completed_at)] of every job of the counted runs (a CI change only, job_spans): the budget counts their running time, else the wall time.
    greys: red jobs shown, never red: a set of ids (main's own red) or {id: reason in GREY_WORDS} (main, lane or health evidence).
    reports: BASE's exempt pr:number suites; failed qualityai needs a produced number to qualify."""
    live, quality = counted(runs), getattr(reports, 'qualityai', {})
    if not live:
        return None, '', live, [], None
    now = now or datetime.now(timezone.utc)   # a run still ending (its jobs done or finishing) ends about now
    short = lambda names: ', '.join(names)[:110]
    red, running, finishing, settling, grey, red_jobs = [], [], [], [], [], {}
    for r in live:
        listed = (jobs or {}).get(r.get('databaseId'))
        if listed is None:
            if r.get('status') != 'completed': running.append((r, []))
            elif r.get('conclusion') in RED: red.append(r)
            continue
        numbered = any(suite_of(job.get('name', '')) in reports for job in listed)   # Why (30 Oct 2026, owner/review): qualityai evidence overrides report/grey exemptions, including unknown reads.
        states = [(job, quality.get(job.get('id'), 'grey' if job.get('id') in greys else job_state(job, me, my_status))) for job in listed if job.get('name') not in REPORT_JOBS and (suite_of(job.get('name', '')) not in reports or job.get('id') in quality)]
        states = ((burn_in or main_state_module('', '', 'pr_burn_in').failures)(r, listed, lambda job: job_state(job, me, my_status)) if any(' · burn-in ' in job.get('name', '') for job in listed) else []) + states
        grey += [(job['name'], getattr(reports, 'reasons', {}).get(job.get('id'), 'qualityai') if job.get('id') in quality else greys.get(job['id'], 'main') if isinstance(greys, dict) else 'main') for job, state in states if state == 'grey']
        ending = [job['id'] for job, state in states if state == 'finishing' or job.get('id') == me]
        if any(state in RED for _, state in states):
            red.append(r); red_jobs[r.get('databaseId')] = ['qualityai result unreadable' if job.get('id') in getattr(reports, 'unreadable', ()) else job['name'] for job, state in states if state in RED]
        elif (not states and not numbered and r.get('status') != 'completed') or any(state == 'running' for _, state in states):
            running.append((r, [job['name'] for job, state in states if state == 'running']))
        elif r.get('status') != 'completed' and not ending and not numbered: settling.append(r)   # all its jobs ended, yet the run is not: about to end, or to create the jobs that need them
        else: finishing += [job['id'] for job, state in states if state == 'finishing']
    if red:
        # the failing jobs, not the run's title: #2342's status read "red: e2e focus,settings" with focus green (owner, 28 Oct 2026)
        return 'failure', f'red: {short(label(r, red_jobs.get(r.get("databaseId"), ())) for r in red)}'[:140], live, [], red[0].get('databaseId')
    if settling and not running:
        return 'settling', f'{short(label(r) for r in settling)} ending', live, [], None
    if running:
        # A clock time, never minutes so far: the status is written only when a job ends, so a counter froze between writes (26 Oct 2026, the owner: "it stays
        # like that: 'waiting 3 min: e2e quality' for more than 5 minutes. this is a bug").
        since = clock(min(_at(r['createdAt']) for r, _ in running))
        first = next((r for r, _ in running if str(r.get('displayTitle', '')).startswith(E2E_PR_TITLE)), running[0][0])
        return 'pending', f'{short(label(r, names) for r, names in running)} running since {since}'[:140], live, [], first.get('databaseId')
    minutes = (max(_at(r['updatedAt']) if r.get('status') == 'completed' else now for r in live) - min(_at(r['createdAt']) for r in live)).total_seconds() / 60
    ran = running_minutes(spans, now) if spans else None
    took = f'{minutes:.1f} min' if ran is None else f'{ran:.1f} min running + {max(0.0, minutes - ran):.1f} min waiting for runners'
    if (minutes if ran is None else ran) > BUDGET_MIN and ci_change(files) and not any(re.search(r'(?m)^CI-budget: \S', m or '') for m in messages):
        return 'failure', f'checks ran {took}, over the {BUDGET_MIN}-min budget for a CI change (or "CI-budget: <why>")'[:140], live, finishing, None
    # Why (31 Oct 2026, owner: "Grey: not known yet"): name a refusal separately from a measured AI score.
    told = ''.join((f'{word}: {said}; ' if reason == 'ai-budget' else f'{word}: {short(name for name, why in grey if why == reason)} ({said}); ') for reason, (word, said) in GREY_WORDS.items() if any(why == reason for _, why in grey))
    return 'success', f'{told}{len(live)} workflow(s) green in {took}'[:140], live, finishing, None


def job_spans(repo, runs, reports=()):
    """[(started_at, completed_at)] of every job of the counted runs (one call per run; only for a CI change, the one kind of PR with a budget)."""
    spans = []
    for r in counted(runs):
        for j in json.loads(gh('api', f"repos/{repo}/actions/runs/{r['databaseId']}/jobs?per_page=100", '--jq', '[.jobs[] | {started_at, completed_at, name}]') or '[]'):
            if j.get('name') not in REPORT_JOBS and suite_of(j.get('name', '')) not in reports:
                spans.append((j.get('started_at'), j.get('completed_at')))
    return spans


RETRY_AFTER = (2, 6)   # waits before a GitHub 5xx's 2nd and 3rd try


def gh(*args, binary=False, sleep=time.sleep):
    """Run `gh <args>`; stdout as UTF-8 text (a Windows runner's cp1252 default once hid "E2E for PR · " and wrote a false green, #2062), bytes for an artifact ZIP (binary=True).
    A GitHub server error (HTTP 5xx) is tried again after RETRY_AFTER; any other failure, or the last try, prints gh's error and re-raises."""
    for wait in (*RETRY_AFTER, None):
        try:
            return subprocess.run(['gh', *args], check=True, capture_output=True, encoding=None if binary else 'utf-8').stdout
        except subprocess.CalledProcessError as error:
            stderr = error.stderr.decode('utf-8', 'replace') if isinstance(error.stderr, bytes) else (error.stderr or '')
            # Why (30 Oct 2026): one HTTP 502 on a run's job list at 18:05Z ended the verdict with nothing written; #2605 sat at pending, every check green.
            if wait is not None and re.search(r'HTTP 5\d\d', stderr):
                sleep(wait); continue
            print(f'gh {" ".join(args)[:120]}: {stderr.strip()[:400]}', file=sys.stderr)   # Why (29-30 Oct 2026, api-quota): the 403 of 23:29Z showed only "exit status 1"; a 5xx prints after its last try
            raise


def quota_line(run=None):
    """'quota left: REST n/limit, GraphQL n/limit' of the token this runs with, for the log; '' when it cannot be read (never fails a run; the call is free)."""
    try:
        res = json.loads((run or gh)('api', 'rate_limit'))['resources']
        return f"quota left: REST {res['core']['remaining']}/{res['core']['limit']}, GraphQL {res['graphql']['remaining']}/{res['graphql']['limit']}"
    except Exception:
        return ''


PR_META = """query($owner: String!, $name: String!, $oid: GitObjectID!) { repository(owner: $owner, name: $name) { object(oid: $oid) { ... on Commit {
  associatedPullRequests(first: 5) { nodes { number state mergedAt headRefOid files(first: 100) { pageInfo { hasNextPage } nodes { path } } commits(last: 100) { nodes { commit { message } } } } } } } } }"""


def pr_meta(repo, sha, run=None):
    """-> (pulls for open_pr, the open PR's file names, its commit messages) in ONE GraphQL call. files is None when the open PR has over 100 files (the caller reads
    them over REST: a cut list would hide a CI change). Why (29 Oct 2026, api-quota): these were 3 REST calls per verdict run, ~218 runs an hour at peak, on Actions'
    1,000-an-hour GITHUB_TOKEN quota shared by every workflow; GraphQL is its own bucket."""
    owner, name = repo.split('/')
    answer = json.loads((run or gh)('api', 'graphql', '-f', f'query={PR_META}', '-f', f'owner={owner}', '-f', f'name={name}', '-f', f'oid={sha}'))
    nodes = (((answer.get('data') or {}).get('repository') or {}).get('object') or {}).get('associatedPullRequests', {}).get('nodes', [])
    pulls = [{'number': n['number'], 'state': n['state'].lower(), 'merged_at': n['mergedAt'], 'head_sha': n.get('headRefOid')} for n in nodes]
    number, _ = open_pr(pulls)
    mine = next((n for n in nodes if str(n['number']) == number), None)
    if not mine:
        return pulls, [], []
    files = None if mine['files']['pageInfo']['hasNextPage'] else [f['path'] for f in mine['files']['nodes']]
    return pulls, files, [c['commit']['message'] for c in mine['commits']['nodes']]


def open_pr(pulls):
    """-> (number or '', whether to write). A commit no PR names (a dispatched e2e run's branch) is written; one whose PRs are all merged or closed is not (#2041)."""
    if not pulls:
        return '', True
    live = [p for p in pulls if p.get('state') == 'open' and not p.get('merged_at')]
    return (str(live[0]['number']), True) if live else ('', False)


def ended_run(run, ended):
    """Match a head-validated completion event to the exact run and attempt; reruns stay untouched."""
    return bool(ended) and run.get('databaseId') == ended.get('id') and run.get('attempt') == ended.get('run_attempt')


def list_runs(repo, sha):
    """List a head's runs once; both planner and writer apply counted() to this same list."""
    return json.loads(gh('run', 'list', '-R', repo, '--commit', sha, '-L', '100', '--json',
                        'databaseId,workflowName,status,conclusion,event,createdAt,updatedAt,displayTitle,attempt'))


def read(repo, sha):
    """Read the PR's runs and deciding jobs; a matching completed event outranks a lagging list.
    Invariant: completion evidence applies only to the same head, run id and attempt, never a rerun.
    Red E2E job details still decide lane exemptions and burn-in admission.
    Only a pending result reads live-looking runs by id, stopping at the first live run or red.
    """
    runs = list_runs(repo, sha)
    ended = {}
    if os.environ.get('GITHUB_EVENT_NAME') == 'workflow_run' and os.environ.get('GITHUB_EVENT_PATH'):
        with open(os.environ['GITHUB_EVENT_PATH'], encoding='utf-8') as file:
            event = json.load(file)
        source = event.get('workflow_run') or {}
        if event.get('action') == 'completed' and source.get('status') == 'completed' and source.get('head_sha') == sha:
            ended = source
    for r in runs:
        # Why (30 Oct 2026, #2533): the final Python completion still listed itself running 15 s later; no later event repaired pending.
        if ended_run(r, ended):
            r.update(status='completed', conclusion=ended['conclusion'], updatedAt=ended['updated_at'])
    jobs = {}
    for r in counted(runs):
        if r.get('conclusion') in RED or str(r.get('displayTitle', '')).startswith(E2E_PR_TITLE):
            jobs[r['databaseId']] = json.loads(gh('api', f"repos/{repo}/actions/runs/{r['databaseId']}/jobs?per_page=100", '--jq', '.jobs'))
            # Why (30 Oct 2026, Gitar on #2552): a successful last E2E completion outranks lagging jobs; red jobs retain exemption evidence.
            if ended.get('conclusion') == 'success' and ended_run(r, ended):
                for job in jobs[r['databaseId']]:
                    job.update(status='completed', conclusion='success', completed_at=job.get('completed_at') or r['updatedAt'])
    # Why (30 Oct 2026, quota review): pending alone needs fresh IDs; one live endpoint proves it, and an ended red costs no by-ID read.
    if not any(r.get('status') == 'completed' and r.get('conclusion') in RED for r in counted(runs)) and verdict(runs, jobs=jobs)[0] in ('pending', 'settling'):
        main_state_module(repo, os.environ.get('GITHUB_SHA') or 'main', 'pr_verdict_runs').refresh(repo, sha, runs, jobs, gh, counted, RED, E2E_PR_TITLE)
    return runs, jobs


def job_log(repo, job_id):
    """A finished job's whole log, also while its run still goes (`gh run view --log-failed` refuses until the run ends: code review, 28 Oct 2026).
    gh 2.101 refuses a raw log (terminal escape sequences) without --allow-escape-sequences; a gh older than the flag never refused, so it is asked again without it.
    A log not read raises: the caller keeps the job red and says why."""
    for extra in (['--allow-escape-sequences'], []):
        done = subprocess.run(['gh', 'api', *extra, f'repos/{repo}/actions/jobs/{job_id}/logs'], capture_output=True, encoding='utf-8', errors='replace')
        if done.returncode == 0:
            return done.stdout
        if 'unknown flag' not in (done.stderr or ''):
            break
    raise OSError(f'the log of job {job_id} was not read: {(done.stderr or "").strip()[:120]}')


def main_state_module(repo, ref, name='main_e2e_state'):
    """Load a verdict companion at this script's commit, even from a standalone CI copy."""
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), name + '.py')
    if not os.path.exists(here):
        text = gh('api', '-H', 'Accept: application/vnd.github.raw', f'repos/{repo}/contents/tools/{name}.py?ref={ref}')
        here = os.path.join(tempfile.mkdtemp(), name + '.py')
        with open(here, 'w', encoding='utf-8') as file:
            file.write(text)
    spec = importlib.util.spec_from_file_location(name, here)
    module = sys.modules[name] = importlib.util.module_from_spec(spec)  # Why (29 Oct 2026, qu): the nightly reader imports this same AI companion in standalone CI.
    spec.loader.exec_module(module)
    return module


def _red_e2e_jobs(runs, jobs, conclusions=('failure',)):
    """The finished jobs of the PR's counted e2e runs (E2E_PR_TITLE) that ended in one of `conclusions`: the one scan the three grey readers below start from
    (Gitar on #2415: a third copy of it was blocking)."""
    return [job for run in counted(runs) if str(run.get('displayTitle', '')).startswith(E2E_PR_TITLE)
            for job in jobs.get(run.get('databaseId')) or [] if job.get('status') == 'completed' and job.get('conclusion') in conclusions]


def main_red_greys(repo, runs, jobs, ref='', read_main=None, log_of=None):
    """Delegate main's own-red evidence; unreadable evidence keeps every red red."""
    if not _red_e2e_jobs(runs, jobs):
        return set()
    try:
        return main_state_module(repo, ref, 'pr_verdict_greys').main_red_greys(repo, runs, jobs, ref, read_main, log_of,
            job_log=job_log, _red_e2e_jobs=_red_e2e_jobs, main_state_module=main_state_module, mains_own=mains_own)
    except Exception as error:
        print(f'main grey reader not read ({type(error).__name__}: {error}): every red stays red')
        return set()


def suite_of(job_name):
    """`quality-1of2` -> `quality`: a sharded suite is one suite. The same rule as tools/main_e2e_state.suite_of, copied because this file runs alone in CI (a test keeps them equal)."""
    key = re.sub(r' · burn-in \d+/\d+$', '', re.sub(r'^E2E · (?:Mac \+ Linux · )?', '', job_name))
    return re.sub(r'-\d+of\d+$', '', re.sub(r'-(?:standin|sqlite)$', '', key))


def base_branch(env=None):
    """The branch a PR merges into: GITHUB_BASE_REF on a pull_request run, else main (the workflow_run backstop)."""
    return (env if env is not None else os.environ).get('GITHUB_BASE_REF') or 'main'


def lane_greys(repo, runs, jobs, read_lanes=None):
    """Delegate BASE's lane evidence; the caller cannot supply the PR's own ref."""
    if not _red_e2e_jobs(runs, jobs):
        return {}
    try:
        return main_state_module(repo, os.environ.get('GITHUB_SHA') or base_branch(), 'pr_verdict_greys').lane_greys(repo, runs, jobs, read_lanes,
            _red_e2e_jobs=_red_e2e_jobs, main_state_module=main_state_module, base_branch=base_branch, gh=gh, suite_of=suite_of)
    except Exception as error:
        print(f'lane grey reader not read ({type(error).__name__}: {error}): every red stays red')
        return {}


def health_greys(repo, runs, jobs, annotations_of=None, log_of=None, ref=''):
    """Delegate the existing per-job health evidence; a missing reader grants no grey."""
    if not _red_e2e_jobs(runs, jobs, (*RED, 'success')):
        return {}
    try:
        return main_state_module(repo, ref, 'pr_verdict_greys').health_greys(repo, runs, jobs, annotations_of, log_of, ref,
            gh=gh, job_log=job_log, _red_e2e_jobs=_red_e2e_jobs, main_state_module=main_state_module, marks=marks, _at=_at, RED=RED, REPORT_JOBS=REPORT_JOBS)
    except Exception as error:
        print(f'health grey reader not read ({type(error).__name__}: {error}): every red stays red')
        return {}


def number_description(repo, ref, runs, why, ai_line, state):
    """Compose AI text in every state; only final success/failure may spend calls on speed evidence."""
    why = ai_line(why)
    if state in ('success', 'failure') and any(str(r.get('displayTitle', '')).startswith(E2E_PR_TITLE) for r in counted(runs)):
        try:
            why = main_state_module(repo, ref, 'pr_speed_number').summary(repo, counted(runs), gh, why)
        except Exception as error:
            print(f'Speed number unavailable ({type(error).__name__}): required verdict unchanged')
    return why


def speed_state(state, live, jobs, me, reports, job_status):
    """Preserve the verdict state, but defer speed reads for a red whose deciding peers have not ended."""
    result = state
    # Why (30 Oct 2026, Gitar on #2531): an early red is not the last writer; wait for its peers before spending speed calls.
    if state == 'failure':
        for r in live:
            if r.get('status') == 'completed': continue
            deciding = [j for j in jobs.get(r['databaseId'], []) if j.get('name') not in REPORT_JOBS and suite_of(j.get('name', '')) not in reports]
            if not any(j.get('id') == me for j in deciding) or any(job_state(j, me, job_status) in ('running', 'finishing') for j in deciding):
                result = 'pending'; break
    return result


def flaky_note(repo, ref, live, why):
    """The red PR's description with its flaky-step count (tools/pr_flaky.py note). Why (31 Oct 2026, owner): say "flaky" on the red; information only."""
    try:
        return main_state_module(repo, ref, 'pr_flaky').note(repo, live, why)
    except Exception as error:
        print(f'Flaky read unavailable ({type(error).__name__}): verdict unchanged')
        return why


def main():
    sys.stdout.reconfigure(encoding='utf-8')   # a Windows runner's console is cp1252
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument('--sha'); mode.add_argument('--sweep-heads', action='store_true')
    ap.add_argument('--revalidate-head', action='store_true', help='sweep writer: revalidate open head; planner already filtered live runs')
    ap.add_argument('--job-status', default='', help="the status so far of the job this step ends (${{ job.status }}); empty: the workflow_run backstop")
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    if a.job_status:
        # Why (owner, 30 Oct 2026, "One writer"): pr-verdict.yml alone writes; a branch not yet rebased still runs the old job step, which must not spend calls.
        print(f'{CONTEXT}: pr-verdict.yml writes it when this workflow ends (one writer)'); return 0
    if a.sweep_heads:
        main_state_module(a.repo, os.environ.get('GITHUB_SHA') or 'main', 'pr_verdict_sweep').plan(a.repo, gh, CONTEXT, lambda sha: list_runs(a.repo, sha), counted)
        print(quota_line() or 'quota: not readable'); return 0
    my_run = os.environ.get('GITHUB_RUN_ID', '')
    server = os.environ.get('GITHUB_SERVER_URL', 'https://github.com')
    pulls, files, messages = pr_meta(a.repo, a.sha)
    number, write = open_pr(pulls)
    if a.revalidate_head and not any(p.get('state') == 'open' and not p.get('merged_at') and p.get('head_sha') == a.sha for p in pulls):
        print('sweep: no open PR still has this head'); return 0
    if not write:
        print(f'the pull request of {a.sha[:7]} is merged or closed: nothing to write'); return 0
    if number and files is None:   # over 100 files: the paged REST read
        files = gh('api', '--paginate', f'repos/{a.repo}/pulls/{number}/files', '--jq', '.[].filename').split()
    ref = os.environ.get('GITHUB_SHA') or a.sha
    # Why (30 Oct 2026, owner: "PR verdicts still don't work properly"): a sweep that takes a head queue must write; live filtering belongs to its planner.
    runs, jobs = read(a.repo, a.sha)
    reports, ai_line = set(), str
    if any(str(r.get('displayTitle', '')).startswith(E2E_PR_TITLE) for r in counted(runs)):
        try:
            reports, ai_line = main_state_module(a.repo, ref, 'pr_ai_number').prepare(a.repo, counted(runs), jobs, gh, lambda name='main_e2e_state': main_state_module(a.repo, ref, name), base_branch(), my_run, '', os.environ.get('RUNNER_NAME', ''), suite_of=suite_of)
        except Exception as error:
            print(f'AI number unavailable ({type(error).__name__}): required verdict unchanged')
    spans = job_spans(a.repo, runs, reports) if ci_change(files) and (reports or not any(r.get('status') != 'completed' for r in counted(runs))) else None
    judge = lambda greys: verdict(runs, files, messages, jobs, spans=spans, greys=greys, reports=reports, burn_in=lambda *args: main_state_module(a.repo, ref, 'pr_burn_in').failures(*args))
    state, why, live, _, target = judge(())
    if state == 'failure':   # main's reds are read only for a red: a green PR costs no extra call
        greys = {**{job_id: 'main' for job_id in main_red_greys(a.repo, runs, jobs, ref=ref)}, **lane_greys(a.repo, runs, jobs),
                 **health_greys(a.repo, runs, jobs, ref=ref)}   # a health cause names this run; lanes still come from the base branch
        if greys:
            state, why, live, _, target = judge(greys)
    state = 'pending' if state == 'settling' else state
    print(quota_line() or 'quota: not readable')
    for r in live:
        print(f"  {r.get('conclusion') or r.get('status'):10} {r['workflowName']}")
    if state is None:
        print(f'no pull request run on {a.sha[:7]}: nothing to write'); return 0
    why = number_description(a.repo, ref, runs, why, ai_line, speed_state(state, live, jobs, None, reports, ''))
    # Why (31 Oct 2026, owner: "Grey: not known yet"): preserve the note even with red/pending peers or truncated numbers.
    if 'ai-budget' in getattr(reports, 'reasons', {}).values() and 'qualityai: AI budget refused, not judged' not in why:
        why = ('qualityai: AI budget refused, not judged; ' + why)[:140]
    if state == 'failure':
        why = flaky_note(a.repo, ref, live, why)
    print(f'{CONTEXT}: {state}: {why}')
    url = f'{server}/{a.repo}/actions/runs/{target or my_run}'   # the run it waits on, or the red one: the PR's e2e run is not in its checks list
    if not a.dry_run:
        gh('api', f'repos/{a.repo}/statuses/{a.sha}', '-f', f'state={state}', '-f', f'context={CONTEXT}', '-f', f'description={why}', '-f', f'target_url={url}')
    return 0


if __name__ == '__main__':
    from github_limit import exit_code   # next to this script (sys.path[0]); in pr-verdict.yml's sparse lists (tests/test_sparse_checkout_has_its_files.py)
    sys.exit(exit_code(main, 'PR verdict not written'))
