"""Quality checks for the words the AI writes for the owner (insight headline, next step).

Rule-based and public: no AI, no cost. The prompts (insights.HONEST) ask for these properties; this says when an answer
did not keep them, so a run can log it (area "quality") and tests can pin examples of good and bad output.
"""
import re

HEADLINE_MAX = 110
ACTION_MAX = 100
# A state of the world the statistics never contain: the AI made it up from an empty result.
INVENTED_STATE = re.compile(r'\b(search (is )?paused|no eligible (jobs|positions)|market is empty|nothing (is )?available)\b', re.I)
# Advice that points away from the app, or to "Jobadabra" from inside it.
VAGUE_ACTION = re.compile(r'\b(clarify|determine whether|with (job pilotto|jobadabra)|or a recruiter|consider)\b', re.I)
THIN_WORDS = re.compile(r'not enough data|too (early|few)|small sample|sample (is|was) (small|thin|tiny)|(is|are|was) small\b', re.I)
VERBS = {'add', 'apply', 'ask', 'check', 'collect', 'fix', 'follow', 'learn', 'open', 'practise', 'practice', 'prepare', 'raise', 'review',
         'run', 'send', 'set', 'start', 'target', 'update', 'widen', 'narrow', 'put', 'try', 'drop', 'move', 'wait', 'keep', 'use', 'build'}


def problems(headline, action, sample_size=None):
    """What is wrong with this headline and next step, as short sentences (empty list: nothing found)."""
    found = []
    headline, action = (headline or '').strip(), (action or '').strip()
    if not headline:
        return ['no headline']
    if len(headline) > HEADLINE_MAX:
        found.append(f'headline is {len(headline)} characters (max {HEADLINE_MAX})')
    if INVENTED_STATE.search(headline):
        found.append('headline states a situation the statistics do not contain')
    if not re.search(r'\d', headline) and not THIN_WORDS.search(headline):
        found.append('headline has no number from the statistics')
    if sample_size is not None and sample_size < 5 and not THIN_WORDS.search(headline):
        found.append(f'sample is {sample_size} but the headline does not say it is small')
    if action:
        if len(action) > ACTION_MAX:
            found.append(f'next step is {len(action)} characters (max {ACTION_MAX})')
        if action.split()[0].strip(',.:').lower() not in VERBS:
            found.append('next step does not start with a verb')
        if VAGUE_ACTION.search(action):
            found.append('next step is vague advice, not an action in the app')
    return found
