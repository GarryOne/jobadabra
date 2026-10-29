# Compare beta AI artifacts with main's nightly Wilson bands before release approval.
# Job: run tolerant suites as rates
# Invariants: only measured rates block tolerant AI suites; unavailable data is visible health.
import argparse
import json
import re
import subprocess
from pathlib import Path

try:
    from . import pr_ai_number as ai
except ImportError:  # Direct workflow invocation: python3 tools/beta_rate_gate.py.
    import pr_ai_number as ai

LANES = Path(__file__).resolve().parents[1] / 'desktop/e2e/lanes.json'


def gh(*args, binary=False):
    """The injectable GitHub transport, also used for binary artifact downloads."""
    output = subprocess.run(['gh', *args], check=True, capture_output=True).stdout
    return output if binary else output.decode('utf-8')


def jobs_of(repo, rid, github):
    """Read every job in the current attempt; pagination must not hide a red backbone job."""
    pages = json.loads(github('api', '--paginate', '--slurp', f'repos/{repo}/actions/runs/{rid}/jobs?per_page=100'))
    return [job for page in pages for job in page['jobs']]


def blocking_jobs(jobs, registry, platform):
    """Ignore all tolerant and suspended reds; other unfinished or failed lane jobs block."""
    prefix = 'E2E · Mac + Linux · ' if platform == 'mac' else 'E2E · Windows · '
    lane = [job for job in jobs if job.get('name', '').startswith(prefix)]
    if not lane:
        return ['lane jobs unavailable']
    blocked = []
    for job in lane:
        suite = re.sub(r'-\d+of\d+$', '', job['name'][len(prefix):])
        entry = registry.get(suite, {})
        exempt = entry.get('lane') in ('tolerant', 'suspended')
        if not exempt and job.get('conclusion') != 'success':
            blocked.append(suite)
    return blocked


def main_nights(repo, suite, github, platform='mac', current_run=''):
    """Read seven completed desktop nights with valid rates, regardless of their job conclusion."""
    selected, page = [], 1
    prefix = 'E2E · Windows · ' if platform == 'windows' else 'E2E · Mac + Linux · '
    artifact = f"e2e-artifacts-{'windows-' if platform == 'windows' else ''}{suite}"
    while len(selected) < 7:
        runs = json.loads(github('api', f'repos/{repo}/actions/workflows/desktop.yml/runs?branch=main&status=completed&per_page=100&page={page}'))['workflow_runs']
        for run in sorted(runs, key=lambda r: r['id'], reverse=True):
            scheduled = (run.get('event'), run.get('display_title')) in (
                ('schedule', 'E2E check · nightly backup'), ('workflow_dispatch', 'Nightly beta'))
            if str(run['id']) == str(current_run) or run.get('head_branch') != 'main' or not scheduled or run.get('status') != 'completed':
                continue
            jobs = [j for j in jobs_of(repo, run['id'], github) if re.sub(r'-\d+of\d+$', '', j.get('name', '')) == prefix + suite]
            if jobs and all(j.get('status') == 'completed' for j in jobs):
                _, rates = ai.artifact_rates(repo, run['id'], github, artifact)
                if rates is not None:
                    selected.append((run['id'], rates))
                    if len(selected) == 7:
                        break
        if len(runs) < 100:
            break
        page += 1
    return selected


def check(repo, rid, registry, github=gh, platform='mac'):
    """Return exit status and reviewable rate/health lines for every tolerant AI suite."""
    lines, blocked = [], False
    for suite, entry in registry.items():
        if entry.get('lane') != 'tolerant' or entry.get('input') != 'ai':
            continue
        try:
            prefix = 'e2e-artifacts-windows-' if platform == 'windows' else 'e2e-artifacts-'
            _, current = ai.artifact_rates(repo, rid, github, f'{prefix}{suite}')
            if current is None:
                lines.append(f'{suite}: no band yet: not blocking (this run artifact unavailable)')
                continue
            nights = main_nights(repo, suite, github, platform=platform, current_run=rid)
            ids = [run for run, _ in nights]
            baseline = ai.band([rates for _, rates in nights])
            used = ','.join(str(run) for run in ids) or 'none'
            if not baseline:
                lines.append(f'{suite}: no band yet: not blocking (need 3 main nights and readable artifacts; main runs {used})')
                continue
            for metric, result in ai.verdict(current, baseline).items():
                if result is None:
                    lines.append(f'{suite}: {metric} unavailable; no band yet: not blocking; main runs {used}')
                    continue
                before = baseline[metric]
                raw = current[metric]
                _, numerator, denominator, label = next(m for m in ai.RATE_METRICS if m[0] == metric)
                note = ' (unflagged quality rate)' if metric == 'flags' else ''
                outcome = 'BLOCKED' if result['blocked'] else 'within band'
                lines.append(f"{suite}: {label} {raw[numerator]}/{raw[denominator]}{note}, quality {result['rate']:.2%} "
                             f"(95% {result['lower']:.2%}–{result['upper']:.2%}); main band "
                             f"{before['lower']:.2%}–{before['upper']:.2%}; {outcome}; main runs {used}")
                blocked |= result['blocked']
        except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
            lines.append(f'{suite}: no band yet: not blocking (GitHub/artifact unavailable: {type(error).__name__})')
    return int(blocked), lines


def main():
    """Print rate evidence in the job log; fail approval only for a measured degradation."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--e2e-only', choices=('mac', 'windows'))
    parser.add_argument('--platform', choices=('mac', 'windows'), default='mac')
    args = parser.parse_args()
    registry = json.loads(LANES.read_text())['suites']
    if args.e2e_only:
        blocked = blocking_jobs(jobs_of(args.repo, args.run, gh), registry, args.e2e_only)
        if blocked:
            print('::error::E2E gate blocked: ' + ', '.join(blocked))
            return 1
        print('Tolerant/suspended reds do not block; AI rates decide in the next gate.')
        return 0
    status, lines = check(args.repo, args.run, registry, platform=args.platform)
    for line in lines:
        print(('::error::' if 'BLOCKED' in line else '::notice::') + line)
    return status


if __name__ == '__main__':
    raise SystemExit(main())
