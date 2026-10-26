"""Why an e2e suite job went red, from its log: the first red step decides (AI key or service, environment, intermittent, one cause, timeout, a check).
Used by tools/e2e_bisect.py (never bisect an environment red: 26 Oct 2026, 10 bisects of dead-key reds filled the job queue) and the weekly report (gate G6).
Tests: tests/test_e2e_causes.py
"""
import re


CAUSES = [   # first match wins; read from the failed job's log
    # the Claude key (out of credit, workspace limit) and, since #1997, CI's Free AI (relay refused or down, Workers AI token not active)
    ('ai-key', re.compile(r'credit balance is too low|the API refused model|reached your specified workspace|Free AI relay (?:refused|at \S+ is not answering)'
                          r'|CI_FREE_AI_CF_TOKEN is not an active', re.I)),
    ('environment', re.compile(r"Unexpected token '<'|<!DOCTYPE|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|EAI_AGAIN|ETIMEDOUT", re.I)),
    ('intermittent', re.compile(r'🔁 intermittent')),
    ('one-cause', re.compile(r'⚠ one cause, \d+ steps')),
    ('timeout', re.compile(r'Timeout \d+\s?ms exceeded|did not (?:appear|finish|go quiet) within')),
]
ENVIRONMENT_CAUSES = ('ai-key', 'environment')
WHOLE_LOG = ('intermittent', 'one-cause')   # printed at the suite's end, not in the step
STEP = re.compile(r'✗ (.+)$', re.M)


def classify(log):
    """A failed job's log → (cause, detail): the first matching cause, and the first red step's line."""
    log = log or ''
    step = STEP.search(log)
    # The first red step's own lines decide; the rest of the log is the env dump ("E2E_ANTHROPIC_KEY: ***" on every step: 26 Oct 2026,
    # every red read as ai-key) and later steps' noise. The suite's summary markers (one cause, intermittent) are read from the whole log.
    first = log[step.start():] if step else log
    nxt = re.search(r'^.*(?:✗|✓) ', first[1:], re.M)
    first = first[:nxt.start() + 1] if nxt else first
    cause = next((name for name, pattern in CAUSES if pattern.search(log if name in WHOLE_LOG else first)), 'check-failed')
    one = re.search(r'⚠ one cause, \d+ steps: [^\n]*?(?=\. Fix it first|$)', log, re.M)
    detail = one.group(0) if cause == 'one-cause' and one else (step.group(1).strip() if step else '')
    return cause, detail[:160]

