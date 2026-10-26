"""Free AI scores a job that can show twice and keeps the agreed score (owner, 26 Oct 2026: "Temp 0 + ask twice").

Measured 26 Oct 2026 (690 draws on CI's quality fixtures, sketch "Free AI score stability"): Free AI's same request moved more than 8
points on 17 of 23 asks, also at temperature 0 (Workers AI does not repeat itself); keeping the agreed score of two asks, 3 of 23.
Only Free AI, only a job whose first score reaches RESCORE_MIN (the bar for showing), never a text that is not one job.
Two scores within AGREE points keep their mean; further apart, a third ask decides and its middle answer is kept whole.
Guard: tests/test_score_agree.py."""
from . import cost, providers, score_not_a_job

AGREE = 8   # the quality suite's own stability bar (desktop/e2e/suites/quality.mjs)


def steady(data, usage, ask_again, bar, env=None):
    """The kept answer and the usage of every ask. ask_again() -> (data, usage) asks the same question once more."""
    if providers.who(env) != 'Free AI' or data['score'] < bar or not score_not_a_job.is_one_job(data):
        return data, usage
    second, again = ask_again()
    usage = cost.combined(usage, again)
    if not score_not_a_job.is_one_job(second):
        return data, usage
    if abs(data['score'] - second['score']) <= AGREE:
        return {**data, 'score': round((data['score'] + second['score']) / 2)}, usage
    third, again = ask_again()
    usage = cost.combined(usage, again)
    answers = sorted([a for a in (data, second, third) if score_not_a_job.is_one_job(a)], key=lambda a: a['score'])
    return answers[len(answers) // 2], usage
