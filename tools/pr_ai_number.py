# Reads artifact counts and formats the PR's informational AI number without deciding its required status.
# Job: report health
# Invariants: only BASE grants exemptions; artifact counts never decide the required status.
import io
import json
import sys
import zipfile
from fractions import Fraction
from functools import lru_cache

ARTIFACT = 'e2e-artifacts-qualityai'
PR_TITLE = 'E2E for PR · '
METRICS = (('facts', 'exact', 'total', 'facts'), ('flags', 'flagged', 'judged', 'flags'), ('cv', 'found', 'expected', 'CV'))


def prepare(repo, runs, jobs, gh, main_state, base='main', my_run='', my_status='', runner=''):
    """Read BASE's exemptions and the numbers once; return exempt suites and the shared status formatter."""
    reports, rates = report_suites(repo, gh, base), None
    try:
        if 'qualityai' in reports:
            main_module = lru_cache()(main_state)
            rates = numbers(repo, runs, jobs, gh, lambda run: main_module().counts_green(run), my_run, my_status, runner)
    except Exception as error:
        print(f'AI number unavailable ({type(error).__name__}): required verdict unchanged')
    return reports, (lambda why: description(why, *rates)) if rates is not None else str


def valid_rates(value):
    """Validate v1 counts; null and zero-denominator parts remain unavailable, never zero scores."""
    if not isinstance(value, dict) or type(value.get('v')) is not int or value['v'] != 1:
        return None
    if any(part not in value or value[part] is not None and not isinstance(value[part], str) for part in ('ranking', 'caps')):
        return None
    for part, fields in (('facts', ('exact', 'total')), ('flags', ('flagged', 'judged')),
                         ('cv', ('found', 'expected', 'corrected')), ('steady', ('within8', 'pairs'))):
        if part not in value:
            return None
        counts = value[part]
        if counts is None:
            continue
        if not isinstance(counts, dict) or any(type(counts.get(k)) is not int or counts[k] < 0 for k in fields):
            return None
        if counts[fields[0]] > counts[fields[1]]:
            return None
    return value


def item_difference(now, total, before, base_total):
    """Exact share delta; the one-item allowance uses the larger item from the two sample sizes."""
    return Fraction(now, total) - Fraction(before, base_total)


def comparison(current, baseline):
    """Compare all three rates, allowing one item in either sample; mixed changes name the degradation."""
    if baseline is None:
        return 'main unavailable'
    directions = []
    for part, numerator, denominator, _ in METRICS:
        now, before = (current or {}).get(part), baseline.get(part)
        if not now or not before or not now[denominator] or not before[denominator]:
            return 'n/a'
        delta = item_difference(now[numerator], now[denominator], before[numerator], before[denominator])
        allowance = max(Fraction(1, now[denominator]), Fraction(1, before[denominator]))
        directions.append(0 if abs(delta) <= allowance else (1 if delta > 0 else -1) * (-1 if part == 'flags' else 1))
    return 'lower than main' if -1 in directions else 'better than main' if 1 in directions else 'same as main'


def _count(rates, part, numerator, denominator):
    """Render one reached nonempty part, with complete integer tokens."""
    counts = (rates or {}).get(part)
    return f'{counts[numerator]}/{counts[denominator]}' if counts and counts[denominator] else 'n/a'


def description(why, current, baseline):
    """Fit the existing status into 140 characters, dropping CV first and never slicing an AI count."""
    prefix = why
    if 'workflow(s) green in ' in why:
        prefix = why.rsplit('; ', 1)[0] if '; ' in why else ''
    parts = [f'{label} {_count(current, part, num, den)} (main {_count(baseline, part, num, den)})'
             for part, num, den, label in METRICS]
    ending = comparison(current, baseline)
    line = lambda: 'AI: ' + ' · '.join([*parts, ending])
    if len((prefix + ' · ' if prefix else '') + line()) > 140:
        parts.pop()   # CV is always the first part dropped.
    while len(line()) > 140 and parts:
        parts.pop()
    room = 140 - len(line()) - 3
    if len(prefix) > max(0, room):
        prefix = (prefix[:max(0, room - 1)].rsplit(' ', 1)[0] + '…') if room > 1 else ''
    return (prefix + ' · ' if prefix else '') + line()


def report_suites(repo, gh, base='main'):
    """Read only BASE's tolerant pr:number entries; an unreadable registry grants no exemption."""
    try:
        lanes = json.loads(gh('api', '-H', 'Accept: application/vnd.github.raw',
                              f'repos/{repo}/contents/desktop/e2e/lanes.json?ref={base}'))['suites']
        return {name for name, entry in lanes.items() if isinstance(entry, dict) and entry.get('lane') == 'tolerant' and entry.get('pr') == 'number'}
    except Exception as error:
        print(f'PR number lanes unavailable ({type(error).__name__}): no exemption', file=sys.stderr)
        return set()


def artifact_rates(repo, rid, gh):
    """Return (artifact exists, validated rates) from the newest artifact, without extracting ZIP paths."""
    pages = json.loads(gh('api', '--paginate', '--slurp', f'repos/{repo}/actions/runs/{rid}/artifacts?per_page=100'))
    artifacts = [a for page in pages for a in page['artifacts'] if a.get('name') == ARTIFACT]
    if not artifacts:
        return False, None
    latest = max(artifacts, key=lambda a: a['id'])
    try:
        if latest.get('expired'):
            return True, None
        data = gh('api', f"repos/{repo}/actions/artifacts/{latest['id']}/zip", binary=True)
        with zipfile.ZipFile(io.BytesIO(data)) as zipped:
            member = zipped.getinfo('quality-rates.json')
            if member.file_size > 65536:
                return True, None
            return True, valid_rates(json.loads(zipped.read(member)))
    except Exception as error:
        print(f'AI counts unavailable for run {rid} ({type(error).__name__})', file=sys.stderr)
        return True, None


def main_rates(repo, gh, comparable):
    """Search at most ten completed main runs; a broken newest artifact never falls back to an older number."""
    try:
        runs = json.loads(gh('api', f'repos/{repo}/actions/workflows/e2e.yml/runs?branch=main&status=completed&per_page=10'))['workflow_runs']
        for run in runs[:10]:
            if comparable(run):
                exists, rates = artifact_rates(repo, run['id'], gh)
                if exists:
                    return rates
    except Exception as error:
        print(f'main AI counts unavailable ({type(error).__name__})', file=sys.stderr)
    return None


def numbers(repo, runs, jobs, gh, comparable, my_run='', my_status='', runner=''):
    """Read this PR's newest qualityai measurement and main once; failed or unfinished samples are n/a."""
    selected = [run for run in runs if str(run.get('displayTitle', '')).startswith(PR_TITLE)
                and 'qualityai' in run['displayTitle'][len(PR_TITLE):].split(' · ')[0].split(',')]
    if not selected:
        return None
    run = max(selected, key=lambda r: (r.get('createdAt') or '', r['databaseId']))
    current = None
    try:
        rid = run['databaseId']
        if rid not in jobs:
            jobs[rid] = json.loads(gh('api', f'repos/{repo}/actions/runs/{rid}/jobs?per_page=100', '--jq', '.jobs'))
        measured = [j for j in jobs[rid] if j.get('name') == 'qualityai']
        ready = measured and all((j.get('conclusion') == 'success' if j.get('status') == 'completed' else
                                  str(rid) == str(my_run) and j.get('runner_name') == runner and my_status == 'success') for j in measured)
        if ready:
            _, current = artifact_rates(repo, rid, gh)
    except Exception as error:
        print(f'PR AI counts unavailable ({type(error).__name__})', file=sys.stderr)
    return current, main_rates(repo, gh, comparable)
