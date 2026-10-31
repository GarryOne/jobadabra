# Reads step timings and formats informational PR speed numbers without deciding required status.
# Job: report health
# Invariants: only passed default-store samples count; missing current data adds no line; no status or comment writes.
import io
import json
import math
import re
import statistics
import sys
import zipfile
from collections import defaultdict
from functools import lru_cache

PR_TITLE = 'E2E for PR · '
# Mirrors e2e-step-timings.mjs comparable; the offline parity test executes both filters.
EXCLUDED = re.compile(r'^(Mutant|RC soak|Stable canary|Beta E2E tests|Gate|Night burn-in|Bisect|E2E check · outside world|E2E for PR|E2E after merge) ')
# Whole-step elapsed time, including fixture/assertion overhead, rather than an invented inner-path timer.
PATHS = (
    # Why (30 Oct 2026, a8 review): this step delays every AI call by 8 s; it cannot measure the user's Find jobs promise.
    ('jobs', 'a slow Jobs check keeps showing that it is working, and ends cleanly', 'Jobs check with slow AI', None, None),
    ('focus', 'Focus finishes loading within 20 seconds, with no error text', 'Focus', 20, '20 s'),
    ('focusdismiss', 'Focus finishes loading within 20 seconds, with no error text', 'Focus', 20, '20 s'),
)
# Why (30 Oct 2026, Gitar on #2531): the verdict shares the 1,000/h token.
MAX_ZIP_DOWNLOADS = 5
MAX_ARTIFACT_LISTS = 8
MAX_RUN_LISTS = 1
MAIN_RUN_LIMIT = 100   # one gh run list page, shared by every timed suite; never expand history


class _BudgetExhausted(Exception):
    """Stop optional evidence reads before they can consume another REST request."""


class _ReadBudget:
    """Charge attempts across all suites and reserve a ZIP allowance for the suite being read."""

    def __init__(self, gh):
        """Start one verdict's shared REST budget; failures consume their attempted request."""
        self.gh = gh
        self.remaining = {'runs': MAX_RUN_LISTS, 'lists': MAX_ARTIFACT_LISTS, 'zips': MAX_ZIP_DOWNLOADS}
        self.allowance = MAX_ZIP_DOWNLOADS
        self.stopped = False

    def stop(self):
        """Report a budget stop once, even when several suites hit their allowances."""
        if not self.stopped:
            print('Speed number budget exhausted: keeping current numbers; main samples may be limited')
            self.stopped = True

    def __call__(self, *args, binary=False):
        """Refuse a request before it could exceed the shared budget or this suite's ZIP allowance."""
        kind = 'runs' if args[0] == 'run' else 'zips' if binary else 'lists'
        if not self.remaining[kind] or not self.remaining['zips'] or not self.allowance:
            self.stop()
            raise _BudgetExhausted()
        self.remaining[kind] -= 1
        if binary:
            self.allowance -= 1
        return self.gh(*args, binary=binary)


def comparable(title):
    """Count exactly the full-run titles the step-timing tool accepts."""
    return isinstance(title, str) and bool(title) and not EXCLUDED.match(title)


def artifact_matches(name, suite):
    """Match default-store artifacts, including shards, with the timing tool's suite-key rules."""
    prefix = 'e2e-artifacts-'
    return (name.startswith(prefix) and not re.search(r'-(standin|sqlite)$', name)
            and re.sub(r'-\d+of\d+$', '', name[len(prefix):]) == suite)


def valid_seconds(step):
    """Validate passed numeric seconds; booleans, nulls and nonfinite values are unavailable."""
    value = step.get('seconds')
    if step.get('status') != 'passed' or type(value) not in (int, float, str) or isinstance(value, str) and not value.strip():
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) and number >= 0 else None
    except ValueError:
        return None


def artifact_list(repo, rid, gh):
    """Read one artifact page; incomplete optional evidence must never trigger pagination."""
    return json.loads(gh('api', f'repos/{repo}/actions/runs/{rid}/artifacts?per_page=100'))['artifacts']


def observations(repo, artifacts, suite, gh):
    """Read steps.json from the newest unexpired artifact of each default-store shard."""
    latest = {}
    for artifact in artifacts:
        name = artifact.get('name', '')
        if not artifact.get('expired') and artifact_matches(name, suite):
            if name not in latest or artifact['id'] > latest[name]['id']:
                latest[name] = artifact
    result = []
    for name, artifact in latest.items():
        try:
            data = gh('api', f"repos/{repo}/actions/artifacts/{artifact['id']}/zip", binary=True)
        except _BudgetExhausted:
            break
        with zipfile.ZipFile(io.BytesIO(data)) as zipped:
            member = zipped.getinfo('steps.json')
            if member.file_size > 4 * 1024 * 1024:
                raise ValueError('oversized steps.json')
            rows = json.loads(zipped.read(member))['results']
        if not isinstance(rows, list):
            raise ValueError('results must be an array')
        steps = [(row.get('name'), seconds) for row in rows if (seconds := valid_seconds(row)) is not None]
        result.append((name, steps))
    return result


def calm_samples(observed, step_name):
    """Reject shard totals above 1.5 times their median; return pooled seconds and contributing run count."""
    by_shard = defaultdict(list)
    for rid, shard, steps in observed:
        by_shard[shard].append((sum(seconds for _, seconds in steps), rid, steps))
    samples, sampled_runs = [], set()
    for runs in by_shard.values():
        middle = statistics.median(total for total, _, _ in runs)
        for total, rid, steps in runs:
            if total <= 1.5 * middle:
                values = [seconds for name, seconds in steps if name == step_name]
                samples.extend(values)
                if values:
                    sampled_runs.add(rid)
    return sorted(samples), len(sampled_runs)


def _main_runs(repo, gh):
    """Read at most one page of completed main runs; no expanding or paginated history search."""
    return json.loads(gh('run', 'list', '--repo', repo, '--workflow', 'e2e.yml', '--branch', 'main',
                         '--status', 'completed', '--limit', str(MAIN_RUN_LIMIT), '--json', 'databaseId,displayTitle'))


def main_samples(repo, suite, step_name, gh, artifacts, candidates=None):
    """Collect calm samples from one fixed main-run list, stopping when the shared read budget ends."""
    observed = []
    for run in _main_runs(repo, gh) if candidates is None else candidates:
        rid = run['databaseId']
        if comparable(run.get('displayTitle')):
            try:
                measured = observations(repo, artifacts(rid), suite, gh)
            except _BudgetExhausted:
                break
            observed.extend((rid, shard, steps) for shard, steps in measured)
    return calm_samples(observed, step_name)


def duration(seconds):
    """Render elapsed seconds as 2m40 or 20s, rounded to the nearest second."""
    total = math.floor(seconds + 0.5)
    minutes, rest = divmod(total, 60)
    return f'{minutes}m{rest:02}' if minutes else f'{rest}s'


def description(label, seconds, samples, promise, promise_text, sample_runs=None):
    """Report median and an empirical upper band; neither a slower range nor a broken promise is a red."""
    count = len(samples) if sample_runs is None else sample_runs
    comparison = f'main median from {count} runs {duration(statistics.median(samples))}' if samples else 'no main median yet'
    text = f'{label} {duration(seconds)}, {comparison}'
    # Three calm observations minimum, as with the AI number's three-night band; speed's upper spread is nearest-rank p95.
    if len(samples) >= 3 and seconds > samples[math.ceil(0.95 * len(samples)) - 1]:
        text += " · SLOWER than main's range"
    if promise is not None and seconds > promise:
        text += f' · over the {promise_text} promise'
    return text


def _current_numbers(repo, runs, artifacts, read):
    """Read every selected suite's current number before main; reserve one ZIP for each remaining suite."""
    selected_paths = []
    for path in PATHS:
        suite = path[0]
        selected = [run for run in runs if str(run.get('displayTitle', '')).startswith(PR_TITLE)
                    and suite in run['displayTitle'][len(PR_TITLE):].split(' · ')[0].split(',')]
        if selected:
            selected_paths.append((path, max(selected, key=lambda r: (r.get('createdAt') or '', r['databaseId']))))
    current_numbers = []
    for index, (path, run) in enumerate(selected_paths):
        suite, step_name = path[:2]
        read.allowance = max(0, read.remaining['zips'] - (len(selected_paths) - index - 1))
        try:
            current = [seconds for _, steps in observations(repo, artifacts(run['databaseId']), suite, read)
                       for name, seconds in steps if name == step_name]
            if current:
                current_numbers.append((path, statistics.median(current)))
        except _BudgetExhausted:
            pass
        except Exception as error:
            print(f'Speed number unavailable for {suite} ({type(error).__name__}): required verdict unchanged', file=sys.stderr)
    return current_numbers


def _main_numbers(repo, current_numbers, artifacts, read):
    """Split remaining main ZIPs evenly, with promised steps first for remainder ZIPs; always show current numbers."""
    # Why (30 Oct 2026, Gitar on #2531): Jobs must not spend Focus's current ZIP or its share of main samples.
    ordered = sorted(current_numbers, key=lambda entry: entry[0][3] is None)
    share, extra = divmod(read.remaining['zips'], len(ordered))
    candidates = lru_cache()(lambda: _main_runs(repo, read))
    lines = []
    for index, ((suite, step_name, label, promise, promise_text), current) in enumerate(ordered):
        read.allowance = share + (index < extra)
        samples, sample_runs = [], 0
        try:
            if read.allowance:
                samples, sample_runs = main_samples(repo, suite, step_name, read, artifacts, candidates())
            else:
                read.stop()
        except _BudgetExhausted:
            pass
        except Exception as error:
            print(f'Speed number unavailable for {suite} ({type(error).__name__}): required verdict unchanged', file=sys.stderr)
        line = description(label, current, samples, promise, promise_text, sample_runs)
        print(line)
        lines.append(line)
    return lines


def summary(repo, runs, gh, why):
    """Read current numbers first, then share bounded main reads; fit complete entries within 140 characters."""
    read = _ReadBudget(gh)
    artifacts = lru_cache()(lambda rid: artifact_list(repo, rid, read))
    current = _current_numbers(repo, runs, artifacts, read)
    lines = _main_numbers(repo, current, artifacts, read) if current else []
    if not lines:
        return why
    # Keep every current number and whole context/AI-count segments; full comparisons remain in the job log.
    measured = ' · '.join(lines)
    if len(measured) > 140:
        lines = [line.split(' · ')[0] for line in lines]
        measured = ' · '.join(lines)
    if len(measured) > 140:
        measured = ' · '.join(line.split(', main median')[0] for line in lines)
    context = why.split(' · ')
    while context and len(' · '.join([*context, measured])) > 140:
        context.pop()
    return ' · '.join([*context, measured])
