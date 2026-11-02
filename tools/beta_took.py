"""Says how long a beta by hand takes, measured on the last finished ones, for the line tools/beta-release.sh prints when it starts one.

    python3 tools/beta_took.py <owner/repo>   ->  stdout "the last 5 took 16–22 min", or nothing when no finished beta was found

Why (2 Nov 2026, owner: "why 45 mins? We made it to be 15-25mins"): the line said "about 45 minutes", typed on 7 Oct (86e2696c); the last 7 betas took 15.6–27 min. A typed time goes stale; a measured one does not.
"""
import json
import subprocess
import sys
from datetime import datetime

LAST = 5   # finished betas measured
TITLE = 'Beta by hand'   # desktop.yml's run name for a beta by hand (tools/beta-release.sh finds its run by it)


def _at(stamp):
    return datetime.fromisoformat(stamp.replace('Z', '+00:00'))


def took(runs, last=LAST):
    """'the last N took A–B min' from gh's run list (newest first; createdAt to updatedAt, the wall clock someone waits), over the last `last` betas by hand that
    ended green or red; a cancelled run says nothing about the time. None when there is none."""
    minutes = [round((_at(run['updatedAt']) - _at(run['createdAt'])).total_seconds() / 60) for run in runs
               if run.get('displayTitle') == TITLE and run.get('conclusion') in ('success', 'failure')][:last]
    if not minutes:
        return None
    low, high = min(minutes), max(minutes)
    return f"the last {len(minutes)} took {low} min" if low == high else f"the last {len(minutes)} took {low}–{high} min"


def main(argv):
    """CLI: prints the measured line and exits 0; prints nothing when gh fails or no finished beta is found."""
    out = subprocess.run(['gh', 'run', 'list', '-R', argv[0], '--workflow', 'desktop.yml', '--event', 'workflow_dispatch', '-L', '40',
                          '--json', 'displayTitle,conclusion,createdAt,updatedAt'], capture_output=True, text=True)
    line = took(json.loads(out.stdout or '[]')) if out.returncode == 0 else None
    if line:
        print(line)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
