"""Require five independent green PR jobs before admitting a suite to the backbone."""
# Job: pick the suites
import re


def failures(run, listed, state_of):
    """Synthetic red states for an admission without five green jobs; BASE lanes and grey exemptions cannot admit it.
    In-progress groups wait for their remaining legs, but a failed leg rejects admission immediately.
    """
    groups = {}
    for job in listed:
        match = re.fullmatch(r'(.+) · burn-in ([1-5])/5', job.get('name', ''))
        if match:
            groups.setdefault(match[1], {})[int(match[2])] = state_of(job)
    failures = []
    for suite, attempts in groups.items():
        passed = sum(state in ('success', 'finishing') for state in attempts.values())
        if any(state not in ('success', 'finishing', 'running') for state in attempts.values()) or (run.get('status') == 'completed' and passed != 5):
            failures.append(({'name': f'{suite} burn-in {passed}/5: not admitted', 'id': None}, 'failure'))
    return failures


