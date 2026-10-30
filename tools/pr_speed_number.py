# Reads step timings and formats informational PR speed numbers without deciding required status.
# Job: report health
# Invariants: only passed default-store samples count; missing data adds no line; no status or comment writes.
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
EXCLUDED = re.compile(r'^(Mutant|RC soak|Stable canary|Beta E2E tests|Gate|Bisect|E2E check · outside world|E2E for PR|E2E after merge) ')
# Whole-step elapsed time, including fixture/assertion overhead, rather than an invented inner-path timer.
PATHS = (
    # Why (30 Oct 2026, a8 review): this step delays every AI call by 8 s; it cannot measure the user's Find jobs promise.
    ('jobs', 'a slow Jobs check keeps showing that it is working, and ends cleanly', 'Jobs check with slow AI', None, None),
    ('focus', 'Focus finishes loading within 20 seconds, with no error text', 'Focus', 20, '20 s'),
    ('focusdismiss', 'Focus finishes loading within 20 seconds, with no error text', 'Focus', 20, '20 s'),
)


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
    """Read every artifact page without downloading or extracting any paths."""
    pages = json.loads(gh('api', '--paginate', '--slurp', f'repos/{repo}/actions/runs/{rid}/artifacts?per_page=100'))
    return [artifact for page in pages for artifact in page['artifacts']]


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
        data = gh('api', f"repos/{repo}/actions/artifacts/{artifact['id']}/zip", binary=True)
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
    """Mirror measure(): reject shard totals above 1.5 times their median before pooling a step."""
    by_shard = defaultdict(list)
    for shard, steps in observed:
        by_shard[shard].append((sum(seconds for _, seconds in steps), steps))
    samples = []
    for runs in by_shard.values():
        middle = statistics.median(total for total, _ in runs)
        for total, steps in runs:
            if total <= 1.5 * middle:
                samples.extend(seconds for name, seconds in steps if name == step_name)
    return sorted(samples)


def main_samples(repo, suite, step_name, gh, artifacts, runs=12):
    """Search newest completed main runs until N have suite artifacts, just like downloadArtifacts()."""
    seen, observed, downloaded, limit = set(), [], 0, runs
    while downloaded < runs:
        candidates = json.loads(gh('run', 'list', '--repo', repo, '--workflow', 'e2e.yml', '--branch', 'main',
                                   '--status', 'completed', '--limit', str(limit), '--json', 'databaseId,displayTitle'))
        for run in candidates:
            rid = run['databaseId']
            if rid in seen:
                continue
            seen.add(rid)
            if not comparable(run.get('displayTitle')):
                continue
            measured = observations(repo, artifacts(rid), suite, gh)
            if not measured:
                continue
            observed.extend(measured)
            downloaded += 1
            if downloaded == runs:
                break
        if len(candidates) < limit:
            break
        limit *= 2
    return calm_samples(observed, step_name)


def duration(seconds):
    """Render elapsed seconds as 2m40 or 20s, rounded to the nearest second."""
    total = math.floor(seconds + 0.5)
    minutes, rest = divmod(total, 60)
    return f'{minutes}m{rest:02}' if minutes else f'{rest}s'


def description(label, seconds, samples, promise, promise_text):
    """Report median and an empirical upper band; neither a slower range nor a broken promise is a red."""
    text = f'{label} {duration(seconds)}, main median {duration(statistics.median(samples))}'
    # Three calm observations minimum, as with the AI number's three-night band; speed's upper spread is nearest-rank p95.
    if len(samples) >= 3 and seconds > samples[math.ceil(0.95 * len(samples)) - 1]:
        text += " · SLOWER than main's range"
    if promise is not None and seconds > promise:
        text += f' · over the {promise_text} promise'
    return text


def summary(repo, runs, gh, why):
    """Append complete measured entries within GitHub's 140-character description; never change a verdict."""
    artifacts = lru_cache()(lambda rid: artifact_list(repo, rid, gh))
    lines = []
    for suite, step_name, label, promise, promise_text in PATHS:
        selected = [run for run in runs if str(run.get('displayTitle', '')).startswith(PR_TITLE)
                    and suite in run['displayTitle'][len(PR_TITLE):].split(' · ')[0].split(',')]
        if not selected:
            continue
        try:
            run = max(selected, key=lambda r: (r.get('createdAt') or '', r['databaseId']))
            current = [seconds for _, steps in observations(repo, artifacts(run['databaseId']), suite, gh)
                       for name, seconds in steps if name == step_name]
            if not current:
                continue
            samples = main_samples(repo, suite, step_name, gh, artifacts)
            if samples:
                line = description(label, statistics.median(current), samples, promise, promise_text)
                print(line)
                lines.append(line)
        except Exception as error:
            print(f'Speed number unavailable for {suite} ({type(error).__name__}): required verdict unchanged', file=sys.stderr)
    if not lines:
        return why
    # Keep whole context/AI-count segments, never a cut count. Full measurements remain in the job log if several cannot fit.
    measured = lines[0]
    for line in lines[1:]:
        if len(measured + ' · ' + line) <= 140:
            measured += ' · ' + line
    context = why.split(' · ')
    while context and len(' · '.join([*context, measured])) > 140:
        context.pop()
    return ' · '.join([*context, measured])
