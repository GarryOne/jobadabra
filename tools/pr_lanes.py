# Read BASE's lane registry for the required PR verdict and ship's check wait.
# Job: report health
# Invariants: an unreadable registry exempts nothing; only finished tolerant failures are skipped by ship.
import json
import re
import subprocess
import sys


def read_lanes(repo, github, base='main'):
    """Read the PR base's suite entries; the PR's own registry never grants exemptions."""
    return json.loads(github('api', '-H', 'Accept: application/vnd.github.raw',
                             f'repos/{repo}/contents/desktop/e2e/lanes.json?ref={base}'))['suites']


def ship_checks(checks, listed):
    """Keep all checks, treating only failed/cancelled tolerant suite jobs as skipped."""
    def suite_of(name):
        # Same job shapes as pr-verdict.py and main_e2e_state.py; parity guarded by test_pr_verdict_lanes.
        key = re.sub(r' · burn-in \d+/\d+$', '', re.sub(r'^E2E · (?:Mac \+ Linux · )?', '', name))
        return re.sub(r'-\d+of\d+$', '', re.sub(r'-(?:standin|sqlite)$', '', key))
    return [{**check, 'bucket': 'skipping'} if check.get('bucket') in ('fail', 'cancel')
            and (listed.get(suite_of(check.get('name', ''))) or {}).get('lane') == 'tolerant' else check for check in checks]


def main():
    """Filter ship's JSON checks using the base registry, failing closed on any read error."""
    checks = json.load(sys.stdin)
    try:
        listed = read_lanes(sys.argv[1], lambda *args: subprocess.check_output(['gh', *args], text=True),
                            sys.argv[2] if len(sys.argv) > 2 else 'main')
        checks = ship_checks(checks, listed)
    except Exception as error:
        print(f'lane registry not read ({type(error).__name__}: {error}): every red stays red', file=sys.stderr)
    print(json.dumps(checks))


if __name__ == '__main__':
    main()
