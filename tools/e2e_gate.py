"""The end-to-end gate of tools/release-stable.sh: may this build be promoted, judging by the e2e runs GitHub lists (newest first)?

    gh run list ... --json conclusion,headSha,createdAt | python3 tools/e2e_gate.py <commit-sha> commit|latest
    -> green | red <sha7> | stale | none
    gh run list --workflow build.yml --commit <sha> --status completed --json conclusion | python3 tools/e2e_gate.py ci
    -> green | red | none

`commit`: a human promotion needs a run of THIS build's commit. `latest`: the daily canary auto-promote cannot start a run, so the newest run stands in.
A cancelled or skipped run says nothing about the product, so it is no verdict. A green run older than two days no longer vouches for anything.
"""
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone

MAX_AGE = timedelta(days=2)


def verdict(runs, sha, mode, now=None):
    now = now or datetime.now(timezone.utc)
    decided = [run for run in runs if run.get('conclusion') in ('success', 'failure')]
    own = [run for run in decided if run.get('headSha') == sha]
    run = own[0] if own else (decided[0] if mode == 'latest' and decided else None)
    if run is None:
        return 'none'
    if run['conclusion'] != 'success':
        return f"red {run['headSha'][:7]}"
    if now - datetime.fromisoformat(run['createdAt'].replace('Z', '+00:00')) > MAX_AGE:
        return 'stale'
    return 'green'


def beta_verdict(notes, sha):
    """The release notes of a beta that BOTH platforms approved, each line naming this build's commit: the proof a manual promotion accepts (owner, 12 Oct 2026: the beta-approved
    artifact goes to stable as it is, same tag, same version, same build; no fresh run). One platform alone, or an approval of another commit, is none."""
    short = (sha or '')[:7]
    lines = [line.strip() for line in (notes or '').splitlines()]
    mac = any(line.startswith('Beta-approved:') and f'commit {short}' in line for line in lines)
    windows = any(line.startswith('Beta-approved (Windows):') and f'commit {short}' in line for line in lines)
    return 'green' if short and mac and windows else 'none'


def ci_verdict(runs):
    """build.yml (the unit suites) on the build's commit: green when every run of it succeeded and there is one."""
    if not runs:
        return 'none'
    if any(run.get('conclusion') not in ('success', 'cancelled') for run in runs):
        return 'red'
    return 'green' if all(run.get('conclusion') == 'success' for run in runs) else 'superseded'   # cancelled only: a newer push to main replaced it (15 Oct 2026)


def _newer_main_build(repo, sha, query, jq):
    """Return the first matching main build SHA ahead of sha, or '' when gh yields no match."""
    def gh(*args):
        return subprocess.run(['gh', 'api', *args], capture_output=True, text=True).stdout.strip()
    for head in gh(f'repos/{repo}/actions/workflows/build.yml/runs?branch=main&{query}', '--jq', jq).split():
        if head != sha and gh(f'repos/{repo}/compare/{sha}...{head}', '--jq', '.status') == 'ahead':
            return head
    return ''


def newer_green(repo, sha):
    """The sha of a NEWER commit of main whose build.yml run succeeded, or '' (a push to main cancels the older commit's run: the newest commit's run decides)."""
    return _newer_main_build(repo, sha, 'status=success&per_page=30', '.workflow_runs[].head_sha')


def newer_running(repo, sha):
    """Return the newest pending main build's SHA only when its commit is ahead of sha, or ''."""
    # Why (28 Oct 2026, owner): queued or running newer builds still decide a cancelled beta's verdict.
    return _newer_main_build(repo, sha, 'per_page=30', '.workflow_runs[] | select(.status != "completed") | .head_sha')


if __name__ == '__main__':
    if sys.argv[1] == 'beta':   # gh release view <tag> --json body -q .body | python3 tools/e2e_gate.py beta <commit-sha>
        print(beta_verdict(sys.stdin.read(), sys.argv[2] if len(sys.argv) > 2 else ''))
    elif sys.argv[1] == 'ci':   # gh run list --workflow build.yml --commit <sha> --status completed --json conclusion | python3 tools/e2e_gate.py ci
        print(ci_verdict(json.load(sys.stdin)))
    elif sys.argv[1] == 'newer-green':   # python3 tools/e2e_gate.py newer-green <repo> <sha>: prints a newer green commit of main, or nothing
        print(newer_green(sys.argv[2], sys.argv[3]))
    elif sys.argv[1] == 'newer-running':   # prints the newest pending build commit ahead of the beta on main, or nothing
        print(newer_running(sys.argv[2], sys.argv[3]))
    else:
        print(verdict(json.load(sys.stdin), sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'commit'))
