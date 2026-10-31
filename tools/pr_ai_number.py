# Reads AI counts and budget refusals, retaining real failures and informational scores.
# Job: report health
# Invariants: BASE grants ordinary reports; qualityai evidence is measured, budget-refused, missing or unknown; score values never gate.
import io
import json
import math
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from fractions import Fraction
from functools import lru_cache

ARTIFACT = 'e2e-artifacts-qualityai'
PR_TITLE = 'E2E for PR · '
UNREADABLE_FOR = timedelta(minutes=30)   # Why (30 Oct 2026, review): a permanently unreadable result must stop holding a PR pending.
METRICS = (('facts', 'exact', 'total', 'facts'), ('flags', 'flagged', 'judged', 'flags'), ('cv', 'found', 'expected', 'CV'))


class ReportSuites(set):
    """BASE's report suites plus per-job qualityai evidence that overrides report/grey exemptions."""


class NumberReadError(RuntimeError):
    """The PR measurement could not be read; unavailable evidence must remain pending."""


def prepare(repo, runs, jobs, gh, main_state, base='main', my_run='', my_status='', runner='', suite_of=None):
    """Return reports and qualityai states: measured/budget-only -> grey, absent/mixed -> red.
    Read errors stay pending up to 30 min after completion, then red."""
    gh = lru_cache()(gh)   # one artifact listing/download per write even when formatting and job evidence share it
    reports, rates = ReportSuites(report_suites(repo, gh, base)), None
    suite_of = suite_of or main_state().suite_of
    reports.qualityai, reports.unreadable, reports.reasons = {}, set(), {}
    try:
        main_module = lru_cache()(main_state)
        # Why (29 Oct 2026, qu): after-merge artifacts measure main's code even though their green cannot clear a suite's state.
        rates = numbers(repo, runs, jobs, gh, lambda run: not main_module().NOT_MAIN_CHECK.match(run.get('display_title') or ''),
                        my_run, my_status, runner, night_module=lambda: main_state('beta_rate_gate'), suite_of=suite_of)
    except Exception as error:
        print(f'AI number unavailable ({type(error).__name__}): evidence pending')
    measurements, failed_runs = {}, set()
    # Why (31 Oct 2026, owner: "Grey: not known yet"): only a proved broker budget refusal is not judged;
    # real/mixed failures stay red. Current job/attempt owns evidence; unreadable expires after 30 min.
    for r in runs:
        for job in jobs.get(r['databaseId'], []):
            if suite_of(job.get('name', '')) != 'qualityai' or job.get('status') != 'completed' or job.get('conclusion') in ('success', 'skipped'):
                continue
            failed_runs.add(r['databaseId'])
            try:
                evidence = {}
                _, current = artifact_rates(repo, r['databaseId'], gh, job=job, attempt=r.get('attempt'), evidence=evidence)
                produced = any((current or {}).get(part) and current[part][den] for part, _, den, _ in METRICS)
                refusal = budget_refusal(repo, job, gh, evidence) if not produced or evidence.get('capped') else None
                state = 'grey' if refusal is True or produced and refusal is not False else 'failure'
                if refusal is True: reports.reasons[job.get('id')] = 'ai-budget'
                if produced: measurements[r['databaseId']] = current
            except Exception as error:
                ended = r.get('updatedAt') or job.get('completed_at')
                young = r.get('status') != 'completed' or ended and datetime.now(timezone.utc) - _at(ended) < UNREADABLE_FOR
                state = 'running' if young else 'failure'
                if not young: reports.unreadable.add(job.get('id'))
                print(f"qualityai result unreadable ({type(error).__name__}): {'pending' if young else 'red after 30 min'}")
            reports.qualityai[job.get('id')] = state
    latest = latest_quality_run(runs)
    if reports.qualityai and latest and latest['databaseId'] in failed_runs:
        current = measurements.get(latest['databaseId'])
        if rates is None or current != rates[0]:
            rates = current, rates[1] if rates else None, False
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


def description(why, current, baseline, below=False):
    """Fit the existing status into 140 characters, dropping CV first and never slicing an AI count."""
    prefix = why
    if 'workflow(s) green in ' in why:
        prefix = why.rsplit('; ', 1)[0] if '; ' in why else ''
    parts = [f'{label} {_count(current, part, num, den)} (main {_count(baseline, part, num, den)})'
             for part, num, den, label in METRICS]
    # Why (30 Oct 2026, qu, owner choice via a8): a measured dip names BELOW in text only; the required status is unchanged.
    ending = "BELOW main's range" if below else comparison(current, baseline)
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


def _at(value):
    """Parse GitHub's UTC timestamps for job ownership and the unreadable-result deadline."""
    return datetime.fromisoformat(str(value).replace('Z', '+00:00'))


def artifact_rates(repo, rid, gh, artifact=ARTIFACT, job=None, attempt=None, evidence=None):
    """Read the newest matching artifact without extracting ZIP paths.
    Job evidence requires the current run attempt, exact matrix job key (shard kept),
    and artifact creation inside that job's start/end window; older attempts cannot qualify.
    Run-level readers (main_rates and beta_rate_gate) retain historical selection; they grant no PR job exemption.
    """
    if job is not None:
        if attempt is None or job.get('run_attempt') != attempt or not job.get('started_at') or not job.get('completed_at'):
            return False, None
        key = job.get('name', '').removeprefix('E2E · ').removeprefix('Mac + Linux · ')
        artifact = 'e2e-artifacts-' + key
    pages = json.loads(gh('api', '--paginate', '--slurp', f'repos/{repo}/actions/runs/{rid}/artifacts?per_page=100'))
    artifacts = [a for page in pages for a in page['artifacts'] if a.get('name') == artifact]
    if job is not None:
        artifacts = [a for a in artifacts if a.get('created_at') and _at(job['started_at']) <= _at(a['created_at']) <= _at(job['completed_at'])]
    if not artifacts:
        return False, None
    latest = max(artifacts, key=lambda a: a['id'])
    if latest.get('expired'):
        return True, None
    data = gh('api', f"repos/{repo}/actions/artifacts/{latest['id']}/zip", binary=True)
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zipped:
            if evidence is not None:
                evidence.update(capped=_json_member(zipped, 'ai-capped.json'),
                                failures=_json_member(zipped, 'suite-failures.json'))
            if 'quality-rates.json' not in zipped.namelist():
                return True, None
            member = zipped.getinfo('quality-rates.json')
            if member.file_size > 65536:
                return True, None
            return True, valid_rates(json.loads(zipped.read(member)))
    except Exception as error:
        if evidence is not None:
            raise NumberReadError('qualityai artifact unreadable') from error
        print(f'AI counts unavailable for run {rid} ({type(error).__name__})', file=sys.stderr)
        return True, None


def _json_member(zipped, name):
    """Read bounded diagnostic JSON; absence is distinct from an unreadable artifact."""
    if name not in zipped.namelist():
        return None
    member = zipped.getinfo(name)
    if member.file_size > 65536:
        raise NumberReadError('oversized ' + name)
    return json.loads(zipped.read(member))


def _cap_failure(message):
    """Parse ai-miss-cause's exact marker and retain its original failure symptom."""
    if not isinstance(message, str) or not message.startswith('AI asks with no stored answer: '):
        return '', False
    _, marker, rest = message.partition('; the AI was refused: ')
    reason, ending, symptom = rest.partition('; the step then failed: ')
    return reason if marker and ending else '', bool(ending) and symptom.startswith(('503 ai-capped:', 'ai-capped:'))


def budget_refusal(repo, job, gh, evidence):
    """True for budget-only failures, False for mixed/nonbudget refusal, None for no refusal.
    Invariants: ai-capped.json's why is authoritative; fallback uses only ai-miss-cause
    failure annotations, never logs. Every original symptom must be an ai-capped failure.
    """
    key = job.get('name', '').removeprefix('E2E · ').removeprefix('Mac + Linux · ')
    suite_steps = {f'Run the {key} suite (first try)',
                   f'Report-only {key} failed its only try (not retried: each run costs AI)'}
    if any(step.get('conclusion') not in (None, 'success', 'skipped', 'neutral')
           and step.get('name') not in suite_steps for step in job.get('steps') or []):
        return False
    cap, failures = evidence.get('capped'), evidence.get('failures')
    why = cap.get('why') if isinstance(cap, dict) else None
    if why:
        if not isinstance(why, str) or not why.startswith('broker: budget:'):
            return False
    else:
        check = job.get('check_run_url') or f"repos/{repo}/check-runs/{job['id']}"
        pages = json.loads(gh('api', '--paginate', '--slurp',
                              check.removeprefix('https://api.github.com/') + '/annotations?per_page=100'))
        annotations = [a for page in pages for a in page if a.get('annotation_level') == 'failure']
        # GitHub adds this wrapper for a failing shell step; it is not a second assertion.
        messages = [a.get('message', '') for a in annotations if a.get('message') != 'Process completed with exit code 1.']
        if not messages:
            return None
        if not all(a.get('title', '').startswith('qualityai · ') for a in annotations
                   if a.get('message') != 'Process completed with exit code 1.'):
            return False
        parsed = [_cap_failure(message) for message in messages]
        if not any(reason.startswith('broker: budget:') for reason, _ in parsed):
            return None
        if not all(reason.startswith('broker: budget:') and capped for reason, capped in parsed):
            return False
        if failures is None:
            return True
    if not isinstance(failures, list) or not failures:
        # No complete failure record: annotations are the fallback, not absence of evidence.
        if failures is None and why:
            return budget_refusal(repo, job, gh, {})
        return False
    return all(isinstance(row, dict) and row.get('suite') == 'qualityai'
               and _cap_failure(row.get('message'))[1] for row in failures)


def _night_reader(night_module=None):
    """Load the shared nightly reader lazily, including for the verdict's standalone helper copy."""
    try:
        from .beta_rate_gate import main_nights
    except ImportError:  # Direct tools invocation or the verdict's standalone helper copy.
        if night_module is not None:
            main_nights = night_module().main_nights
        else:
            from beta_rate_gate import main_nights
    return main_nights


def main_rates(repo, gh, comparable, night_module=None):
    """Read main's newest measurement, then desktop nights only if no e2e artifact exists; broken artifacts never fall back."""
    try:
        runs = json.loads(gh('api', f'repos/{repo}/actions/workflows/e2e.yml/runs?branch=main&status=completed&per_page=10'))['workflow_runs']
        for run in runs[:10]:
            # Why (29 Oct 2026, qu): the API filters are checked again; PR-title runs measure a branch, never main.
            if run.get('head_branch') == 'main' and run.get('status') == 'completed' and not (run.get('display_title') or '').startswith(PR_TITLE) and comparable(run):
                exists, rates = artifact_rates(repo, run['id'], gh)
                if exists:
                    return rates
        # Why (29 Oct 2026, qu): a quiet e2e history still has desktop measurements; reuse the nightly reader without a circular import.
        nights = _night_reader(night_module)(repo, 'qualityai', gh, first_only=True)
        return nights[0][1] if nights else None
    except Exception as error:
        print(f'main AI counts unavailable ({type(error).__name__})', file=sys.stderr)
    return None


def latest_quality_run(runs):
    """Pick only the displayed measurement; all counted title/job states still decide in prepare.
    The caller supplies newest-per-workflow/title runs; timestamp/id/attempt matches counted().
    """
    selected = [run for run in runs if str(run.get('displayTitle', '')).startswith(PR_TITLE)
                and 'qualityai' in run['displayTitle'][len(PR_TITLE):].split(' · ')[0].split(',')]
    return max(selected, key=lambda r: (r.get('createdAt') or '', r['databaseId'], r.get('attempt') or 0)) if selected else None


def numbers(repo, runs, jobs, gh, comparable, my_run='', my_status='', runner='', night_module=None, suite_of=None):
    """Display the newest qualityai measurement among counted titles; prepare judges EVERY title/job.
    Callers pass counted runs: a newer unrelated suite title cannot erase qualityai evidence."""
    if suite_of is None:
        from tools.main_e2e_state import suite_of
    run = latest_quality_run(runs)
    if run is None:
        return None
    current = None
    try:
        rid = run['databaseId']
        if rid not in jobs:
            jobs[rid] = json.loads(gh('api', f'repos/{repo}/actions/runs/{rid}/jobs?per_page=100', '--jq', '.jobs'))
        measured = [j for j in jobs[rid] if suite_of(j.get('name', '')) == 'qualityai']
        # A completed failure may still have produced a valid low score; unfinished jobs cannot supply a final number.
        ready = measured and all(j.get('status') == 'completed' or
                                 str(rid) == str(my_run) and j.get('runner_name') == runner and my_status == 'success' for j in measured)
        if ready:
            _, current = artifact_rates(repo, rid, gh)
    except Exception as error:
        raise NumberReadError('PR AI number read failed') from error
    baseline, below = main_rates(repo, gh, comparable, night_module), False
    if current is not None and baseline is not None:
        try:
            nights = _night_reader(night_module)(repo, 'qualityai', gh)
            # Why (30 Oct 2026, qu, owner choice via a8): only the beta gate's shared band and verdict decide BELOW; missing observations keep the existing wording.
            results = verdict(current, band([rates for _, rates in nights]))
            below = any(result and result['blocked'] for result in results.values())
        except Exception as error:
            print(f'main AI range unavailable ({type(error).__name__})', file=sys.stderr)
    return current, baseline, below


RATE_METRICS = (*METRICS, ('steady', 'within8', 'pairs', 'steady'))


def wilson(successes, total):
    """Wilson two-sided 95% interval for a nonempty binomial sample."""
    z = 1.959963984540054
    rate, z2 = successes / total, z * z
    center = (rate + z2 / (2 * total)) / (1 + z2 / total)
    radius = z * math.sqrt(rate * (1 - rate) / total + z2 / (4 * total * total)) / (1 + z2 / total)
    return {'rate': rate, 'lower': max(0, center - radius), 'upper': min(1, center + radius),
            'successes': successes, 'total': total}


def _sample(rates, part, numerator, denominator):
    counts = (rates or {}).get(part)
    if not counts or not counts[denominator]:
        return None
    success, total = counts[numerator], counts[denominator]
    # Flags measure defects; their quality rate is the unflagged share.
    return (total - success if part == 'flags' else success), total


def band(main_counts_list):
    """Pool at most seven validated nights; each metric needs three measured nights."""
    nights = [valid_rates(night) for night in list(main_counts_list)[:7]]
    if len(nights) < 3 or any(night is None for night in nights):
        return {}
    result = {}
    for part, numerator, denominator, _ in RATE_METRICS:
        samples = [sample for night in nights if (sample := _sample(night, part, numerator, denominator))]
        result[part] = wilson(sum(s[0] for s in samples), sum(s[1] for s in samples)) if len(samples) >= 3 else None
    return result


def verdict(this_counts, baseline):
    """Block only nonoverlapping intervals below main; missing observations stay unavailable."""
    current = valid_rates(this_counts)
    result = {}
    for part, numerator, denominator, _ in RATE_METRICS:
        sample = _sample(current, part, numerator, denominator)
        before = baseline.get(part)
        measured = wilson(*sample) if sample and before else None
        result[part] = {**measured, 'blocked': measured['upper'] < before['lower']} if measured else None
    return result
