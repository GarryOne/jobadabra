"""Picks the main commit a beta by hand is built from: the newest one whose CI · Tests run (build.yml) finished fully green.

    python3 tools/beta_pick.py <owner/repo> [--commit <sha>]   ->  stdout "<sha> <commits behind main's head>"; stderr says what it skipped and why

Why (1 Nov 2026, owner: "beta should just promote the latest main CI commit that ran fully and it was green", "2-3-4 commits olds... or 5 commits olds"): main's CI proved that commit
(unit suites, worker, harness, integration, recorded pages, smoke, fill check), so the beta does not wait for main's queue (beta 41339598113 idled 24 min on three commits) or run those jobs again.
Why (1 Nov 2026, owner: "latest green one", after beta 12 found none of the last 30 usable): its workflow files used to have to match main's head, because GitHub refuses a tag on a commit whose
workflow files differ (desktop.yml "Tag this build now"). On a night with workflow merges that skipped every green commit. tools/beta-release.sh now puts main's head's workflow files on the picked
commit's code (a branch beta-pick/<sha7>), so only "is it on main" is asked here.
"""
import subprocess
import sys

RUNS = 30   # successful runs read; main merges often, so a green commit is rarely older than a few


def pick(green, usable, forced=None):
    """(sha, [(skipped sha, reason)]) from `green` (newest first); sha is '' when nothing qualifies. `forced` must itself be green and `usable`."""
    skipped = []
    for sha in green:
        if forced and not sha.startswith(forced):
            continue
        if not usable(sha):
            skipped.append((sha, "it is not on main's history"))
            if forced:
                return '', skipped
            continue
        return sha, skipped
    return '', skipped


def _run(*args):
    return subprocess.run(args, capture_output=True, text=True)


def green_commits(repo):
    """The head shas of main's successful CI · Tests runs, newest first, each once (a run is only `success` when every one of its jobs passed or was skipped)."""
    out = _run('gh', 'api', f'repos/{repo}/actions/workflows/build.yml/runs?branch=main&status=success&per_page={RUNS}', '--jq', '.workflow_runs[].head_sha')
    seen = []
    for sha in out.stdout.split():
        if sha not in seen:
            seen.append(sha)
    return seen


def main(argv):
    """CLI: prints "<sha> <behind>" and exits 0, or says why nothing qualifies and exits 1."""
    repo = argv[0]
    forced = argv[argv.index('--commit') + 1] if '--commit' in argv else None
    _run('git', 'fetch', '-q', 'origin', 'main')
    head = _run('git', 'rev-parse', 'origin/main').stdout.strip()
    on_main = lambda sha: _run('git', 'merge-base', '--is-ancestor', sha, head).returncode == 0
    green = green_commits(repo)
    sha, skipped = pick(green, on_main, forced)
    for other, why in skipped:
        print(f'skipped {other[:7]}: {why}', file=sys.stderr)
    if not sha:
        print('No commit of main qualifies: ' + (f'{forced} is not a fully green CI · Tests commit of main' if forced else f'none of the last {len(green)} green CI · Tests runs is on main')
              + (". Name another green commit, or run tools/beta-release.sh without --commit." if forced else ". tools/beta-release.sh builds main's head instead; its Release waits for that commit's CI."), file=sys.stderr)
        return 1
    behind = int(_run('git', 'rev-list', '--count', f'{sha}..{head}').stdout.strip() or 0)
    print(f'{sha} {behind}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
