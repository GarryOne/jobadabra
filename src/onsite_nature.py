"""Whether the roles a search looks for can only be done on site (pilot, nurse, electrician), judged by the AI in a fixed answer, never from a
word list (owner, 26 Oct 2026: "remote, Europe" for a First Officer found 0 jobs and nothing said why). With Remote jobs on, Strategy then says
it in one line. It is a message, not a filter: jobs in your places are kept whether remote or not (remote only adds). Tests: tests/test_onsite_nature.py."""
from .ai import decide

TOPIC = 'role-onsite'
ANSWERS = ('on_site', 'can_be_remote')
TASK = ('A role a job seeker looks for, in any language. Answer on_site if people in this role can only do the work physically at a workplace, '
        'vehicle, site or patient (pilot, nurse, electrician, chef); can_be_remote if a good part of the work can be done from home.')


def note(search):
    """{'roles', 'text'} when Remote jobs is on and every role is on site by nature, else None (also when nothing could be judged)."""
    from .sources.feeds import remote_wanted
    from .notion.search_settings import terms
    roles = terms((search or {}).get('role_keywords'))[:10]
    if not roles or not remote_wanted(search):
        return None
    answers = decide.decide(TOPIC, {role: role for role in roles}, ANSWERS, TASK)
    if not answers or any(answers.get(role) != 'on_site' for role in roles):
        return None
    return {'roles': roles, 'text': 'These roles are done on site, so remote jobs are few. Jobs in your places are included, remote or not.'}
