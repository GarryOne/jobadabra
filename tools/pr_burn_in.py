"""Require five independent green PR jobs before admitting a suite or new step to the backbone."""
# Job: report health
import re


def failures(run, listed, state_of):
    """Synthetic red states for an admission without five green jobs; BASE lanes and grey exemptions cannot admit it.
    In-progress groups wait for their remaining legs, but a failed leg rejects admission immediately.
    """
    groups, step_names = {}, {}
    for job in listed:
        match = re.fullmatch(r'(.+) · burn-in ([1-5])/5', job.get('name', ''))
        if match:
            groups.setdefault(match[1], {})[int(match[2])] = state_of(job)
            for step in job.get('steps', []):
                if step.get('name', '').startswith('Burn-in steps · '):
                    step_names[match[1]] = step['name'].removeprefix('Burn-in steps · ')
    failures = []
    for suite, attempts in groups.items():
        passed = sum(state in ('success', 'finishing') for state in attempts.values())
        if any(state not in ('success', 'finishing', 'running') for state in attempts.values()) or (run.get('status') == 'completed' and passed != 5):
            failed = ','.join(str(n) for n in range(1, 6) if attempts.get(n) not in ('success', 'finishing'))
            detail = f'; tries {failed}' + (f'; {step_names[suite]}' if suite in step_names else '')
            failures.append(({'name': f'{suite} burn-in {passed}/5: not admitted{detail}', 'id': None}, 'failure'))
    return failures


