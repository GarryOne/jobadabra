# Read existing main, lane and health evidence for grey PR jobs.
# Invariants: unreadable or mixed failure evidence stays red; BASE alone grants lane exemptions.
import json
import os


def main_red_greys(repo, runs, jobs, ref='', read_main=None, log_of=None, *, job_log, _red_e2e_jobs, main_state_module, mains_own):
    """Ids of the PR e2e run's finished red suite jobs that failed as main's own newest red of that suite (mains_own): grey. Any read that fails keeps them red."""
    log_of = log_of or (lambda job_id: job_log(repo, job_id))
    reds = _red_e2e_jobs(runs, jobs)
    if not reds:
        return set()
    try:
        main_e2e_state = main_state_module(repo, ref)
        main = (read_main or main_e2e_state.live)(repo)
        return {job['id'] for job in reds
                if (main.get(main_e2e_state.suite_of(job['name'])) or {}).get('conclusion') == 'failure'
                and mains_own(log_of(job['id']), [log_of(i) for i in main[main_e2e_state.suite_of(job['name'])].get('jobs') or []])}
    except Exception as error:   # Why (code review, 28 Oct 2026): the verdict is always written; whatever fails here (a read, a None from the API) keeps every red red
        print(f'main\'s own reds not read ({type(error).__name__}: {error}): every red stays red')
        return set()


def lane_greys(repo, runs, jobs, read_lanes=None, *, _red_e2e_jobs, main_state_module, base_branch, gh, suite_of):
    """{job id: 'tolerant' | 'suspended'} for the PR e2e run's finished red suite jobs whose suite desktop/e2e/lanes.json lists in that lane: shown grey, never red.
    A suite not listed is backbone and stays red. Any read that fails, or a file that is not a registry, keeps every red red.
    Why (28 Oct 2026, Gitar on #2376): the registry is read from the PR's BASE branch and takes no ref from the caller. Read at the PR's own commit, a PR that breaks
    `settings` could list it as tolerant in the same diff and go green. A PR that edits lanes.json is judged by main's file; its entry counts after it merges."""
    reds = _red_e2e_jobs(runs, jobs)
    if not reds:
        return {}
    try:
        listed = read_lanes()['suites'] if read_lanes else main_state_module(repo, os.environ.get('GITHUB_SHA') or base_branch(), 'pr_lanes').read_lanes(repo, gh, base_branch())
        return {job['id']: listed[suite_of(job['name'])]['lane'] for job in reds if (listed.get(suite_of(job['name'])) or {}).get('lane') in ('tolerant', 'suspended')}
    except Exception as error:   # Why (28 Oct 2026, same rule as main_red_greys): the verdict is always written; a registry not read keeps every red red
        print(f'lane registry not read ({type(error).__name__}: {error}): every red stays red')
        return {}


def health_greys(repo, runs, jobs, annotations_of=None, log_of=None, ref='', *, gh, job_log, _red_e2e_jobs, main_state_module, marks, _at, RED, REPORT_JOBS):
    """Finished PR e2e jobs -> the existing grey map, with proven health causes only.
    Invariants: a capacity cancellation needs zero steps; AI credit must explain EVERY failure mark;
    install health needs a download transport error in a failed install step, before any suite assertion.
    Missing evidence and mixed failures stay red. A failed read affects only that job.
    Job: report health (e2e reliability design, PR 16/29).
    """
    annotations_of = annotations_of or (lambda jid: [a for page in json.loads(gh('api', '--paginate', '--slurp',
        f'repos/{repo}/check-runs/{jid}/annotations?per_page=100')) for a in page])
    log_of = log_of or (lambda jid: job_log(repo, jid))
    greys, classifier = {}, None
    for job in _red_e2e_jobs(runs, jobs, RED):
        if job.get('name') in REPORT_JOBS:
            continue
        try:
            notes = annotations_of(job['id'])
            classifier = classifier or main_state_module(repo, ref, 'pr_health_greys').health_cause
            cause = classifier(job, lambda _, notes=notes: notes, log_of, marks=marks, at=_at, red=RED)
        except Exception as error:
            print(f"health of job {job['id']} not read ({type(error).__name__}: {error}): stays red")
            continue
        if cause:
            greys[job['id']] = cause
    return greys
