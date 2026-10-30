# Classify proven CI health failures without changing the PR verdict.
# Job: report health
import re


# Health causes (PR 16/29). Why (28 Oct 2026, Gitar on #2415): compiled once; "spend limit or credit" is the phrase desktop/e2e/lib/ai-refused.mjs adds only when the engine log
# carried the limit or credit message (a bare "the AI refused (400)" can be a request of ours that is wrong, so it stays red).
_CREDIT = re.compile(r'ai-capped:|credit balance is too low|insufficient_quota|the AI refused \(\d+\) \d+ times?[^;]*spend limit or credit', re.I)
_INSTALL = re.compile(r'install|npm ci|playwright.*browser', re.I)
# An npm lockfile/script error is this diff's failure. Only a transport error during installation is health.
_TRANSPORT = re.compile(r'(?:npm (?:error|ERR!).*\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)\b|'
                        r'(?:download|fetch).*\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)\b)', re.I)


def _runner_never_acquired(job, annotations):
    """A capacity cancellation: no steps, no runner, and GitHub's own annotation says so."""
    return (not job.get('steps') and not job.get('runner_name')
            and any('not acquired by Runner' in a.get('message', '') for a in annotations))


def _credit_only(job, annotations, failures, red):
    """Every failure mark is a cap or credit line (a deliberate "no credit" stub stays red), every named annotation too, and only suite steps failed."""
    named_errors = [a.get('message', '') for a in annotations if a.get('annotation_level') == 'failure' and ' · ' in a.get('title', '')]
    return bool(failures) and all(_CREDIT.search(line) and 'stub no-credit on purpose' not in line for line in failures) \
        and all(_CREDIT.search(text) for text in named_errors) \
        and all('suite' in step.get('name', '').lower() for step in _failed_steps(job, red))


def _failed_steps(job, red):
    return [step for step in job.get('steps') or [] if step.get('conclusion') in red]


def _install_download_failed(step, log, at):
    """Only this failed step's own lines count: a recovered download in an earlier step explains no later failure."""
    if not _INSTALL.search(step.get('name', '')) or not step.get('started_at') or not step.get('completed_at'):
        return False
    start, end = at(step['started_at']).timestamp(), at(step['completed_at']).timestamp() + 1
    stamps = ((re.match(r'^(\d{4}-\d\d-\d\dT[\d:.]+Z) ', line), line) for line in log.splitlines())
    return bool(_TRANSPORT.search('\n'.join(line for stamp, line in stamps if stamp and start <= at(stamp[1]).timestamp() < end)))


def health_cause(job, annotations_of, log_of, *, marks, at, red):
    """'runner' | 'ai-credit' | 'install' | '' for one finished red job. Missing evidence and mixed failures give ''."""
    annotations = annotations_of(job['id'])
    if _runner_never_acquired(job, annotations):
        return 'runner'
    log = log_of(job['id'])
    failures = marks(log)
    if _credit_only(job, annotations, failures, red):
        return 'ai-credit'
    failed = _failed_steps(job, red)
    if not failures and failed and all(_install_download_failed(step, log, at) for step in failed):
        return 'install'
    return ''
