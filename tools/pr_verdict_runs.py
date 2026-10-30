"""Refresh pending verdict evidence by run ID, stopping at the first live run or red result."""
import json


def refresh(repo, sha, runs, jobs, gh, counted, red, e2e_title):
    """Mutate the pending snapshot only as far as needed; match head, run ID and attempt.
    Invariant: one actually live run proves pending; an ended red stops further by-ID calls.
    Completed runs reload deciding jobs, including a successful end's lagging jobs.
    """
    for run in counted(runs):
        if run.get('status') == 'completed':
            continue
        fresh = json.loads(gh('api', f"repos/{repo}/actions/runs/{run['databaseId']}"))
        if fresh.get('head_sha') != sha or fresh.get('id') != run['databaseId'] or fresh.get('run_attempt') != run.get('attempt'):
            break
        run.update(status=fresh['status'], conclusion=fresh['conclusion'], updatedAt=fresh['updated_at'])
        if fresh['status'] != 'completed':
            break
        if fresh['conclusion'] in red or str(run.get('displayTitle', '')).startswith(e2e_title):
            listed = json.loads(gh('api', f"repos/{repo}/actions/runs/{run['databaseId']}/jobs?per_page=100", '--jq', '.jobs'))
            jobs[run['databaseId']] = listed
            if fresh['conclusion'] == 'success':
                for job in listed:
                    job.update(status='completed', conclusion='success', completed_at=job.get('completed_at') or fresh['updated_at'])
        if fresh['conclusion'] in red:
            break
