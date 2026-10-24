"""Interview analysis, the Claude call: the model names, the facts a call can reveal, the review's schema and prompt,
the candidate applications and the one structured call (with the fallback model). Re-exported by src/ai/interviews.py.
Tests: tests/test_interviews_run.py.
"""
import json
import os
import re
import sys

from . import engine
from ..notion import titles
from .interviews_stages import CANDIDATE_STAGES
from .models import BIG_MODEL, MAIN_MODEL


# Opus for reviews and the insights built on them (owner, 30 Sep 2026): rare, judgment-heavy calls on noisy transcripts.
# Opus thinks by default (it can't be switched off), so its answers get room: MAX_TOKENS. A request it declines is answered
# once by FALLBACK_MODEL (ask()).
DEFAULT_MODEL = os.getenv('JOB_PILOTTO_INTERVIEW_MODEL', BIG_MODEL)
FALLBACK_MODEL = MAIN_MODEL
MAX_TOKENS = 16000


TEXT_TYPES = ('.txt', '.md', '.srt', '.vtt', '.text')
MAX_CHARS = 180_000  # about 3 hours of speech, within Notion's request size; longer files are cut, with a note


# Facts a call can reveal about the job -> (label, Applications column, kind). Kind 'text' and 'select' are columns
# of their own; 'fact' lines share the "Call facts" column ("Label: value · Label: value").
FACTS = {
    'salary': ('Salary', 'Salary', 'text'),
    'salary_ask': ('Your ask', 'Call facts', 'fact'),
    'contract': ('Contract', 'Contract', 'select'),
    'location': ('Location', 'Location', 'text'),
    'work_mode': ('Work mode', 'Work mode', 'select'),
    'relocation': ('Relocation', 'Call facts', 'fact'),
    'team_size': ('Team size', 'Call facts', 'fact'),
    'company_size': ('Company size', 'Call facts', 'fact'),
    'visa': ('Visa/permit', 'Call facts', 'fact'),
    'start_date': ('Start date', 'Call facts', 'fact'),
}
SELECT_OPTIONS = {'Contract': ('Employee', 'B2B / contractor', 'Employee or B2B'), 'Work mode': ('On-site', 'Hybrid', 'Remote')}
NOT_STATED = re.compile(r'^\s*(not stated|unknown|none|n/?a|-)?\s*\.?\s*$', re.I)

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['application', 'company', 'round', 'interviewers', 'duration_min', 'questions', 'strengths',
                 'weaknesses', 'signals', 'red_flags', 'next_step', 'practice', 'overall', 'summary', 'facts'],
    'properties': {
        'application': {'type': 'integer', 'description': 'Index of the matching application in the list, or -1 if unclear'},
        'company': {'type': 'string', 'description': 'The employer exactly as named in the caption or transcript; "" when it is not named '
                                                     '(never a description, never "unnamed ...", never a guess)'},
        'round': {'type': 'string', 'description': 'e.g. "Recruiter screen", "Technical 1", "System design", "Hiring manager"'},
        'interviewers': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Roles only (e.g. "SRE manager"), no names'},
        'duration_min': {'type': 'integer', 'description': 'Estimated from timestamps, or 0 if unknown'},
        'questions': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False,
            'required': ['topic', 'question', 'answer', 'quality', 'better'],
            'properties': {
                'topic': {'type': 'string', 'description': 'Short topic label, e.g. "Kubernetes networking", "Incident response", "Motivation"'},
                'question': {'type': 'string'},
                'answer': {'type': 'string', 'description': "One-line gist of the candidate's answer"},
                'quality': {'type': 'string', 'enum': ['strong', 'ok', 'weak', 'not_answered']},
                'better': {'type': 'string', 'description': 'For ok/weak answers: what a stronger answer would add; else ""'},
            }}},
        'strengths': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Up to 4, each with evidence'},
        'weaknesses': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Up to 4, each with evidence'},
        'signals': {'type': 'array', 'items': {'type': 'string'},
                    'description': 'What they revealed: team, salary range, process, concerns, enthusiasm'},
        'red_flags': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Anything the candidate said that could count against them'},
        'next_step': {'type': 'string', 'description': 'What happens next, as stated, or "not stated"'},
        'practice': {'type': 'array', 'items': {'type': 'string'}, 'description': '1-3 concrete things to practise before the next round'},
        'overall': {'type': 'string', 'enum': ['positive', 'neutral', 'negative']},
        'summary': {'type': 'string', 'description': '2-3 sentences'},
        'facts': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False, 'required': ['field', 'value', 'quote'],
            'properties': {
                'field': {'type': 'string', 'enum': list(FACTS)},
                'value': {'type': 'string', 'description': 'The fact, short (see the rules for each field)'},
                'quote': {'type': 'string', 'description': 'The words said in the call, verbatim, at most 20 words'},
            }}, 'description': 'Facts about the job the call revealed; only what was actually said, each field at most once'},
    },
}

SYSTEM = """You review job interviews for the candidate (the owner of Jobadabra). You get the candidate's \
profile, the list of their applications, the caption they wrote, and a transcript or their own notes.

- Identify the application from the caption first, then the transcript (company, role). If two \
applications at the same company fit, prefer the one in an interview stage or applied most recently. \
Use -1 when you can't tell.
- company: the employer's name only when the call or caption names it; otherwise an empty string. Never a \
description, never "unnamed ...", never a guess (a recruiter may not name the client).
- The transcript may not label speakers. Infer who is the candidate from context (the profile helps).
- Be honest and specific. "weak" means the answer missed what the question was probing, was vague, or \
was wrong; say what a stronger answer would add, using the candidate's real experience from the profile.
- Only report what the transcript supports. Notes written by the candidate are their own recollection; \
say less when the input is thin.
- Interviewers by role only; never names.
- facts: only what someone actually said in this call, never guesses or the posting. salary = the employer's \
range or offer, with currency and period (e.g. "150-170k/year gross", in the currency said); salary_ask = what the candidate asked \
for, same format; contract = exactly "Employee", "B2B / contractor" or "Employee or B2B"; work_mode = exactly \
"On-site", "Hybrid" or "Remote"; location = a SHORT summary, at most about five words (e.g. "Hybrid, 2 days in office", "Remote, one region"), \
never conditions: who can be employed where, through which setup, or relocation terms belong in relocation; relocation, \
team_size, company_size, visa (work permit/sponsorship), start_date = short, as said.

The candidate's profile follows.

"""


def candidates(stores):
    """The applications an interview may belong to (application records), latest applied first."""
    rows = stores.applications.list(stages=list(CANDIDATE_STAGES))
    return sorted(rows, key=lambda r: r.get('applied_on') or '', reverse=True)


def ask(client, model, **request):
    """One structured call; when `model` declines it (stop_reason "refusal"), the same request once on FALLBACK_MODEL.
    Returns (parsed JSON, usage, the model that answered): cost is counted at that model's price."""
    response = client.messages.create(model=model, **request)
    if response.stop_reason == 'refusal' and model != FALLBACK_MODEL:
        print(f'Warning: {model} declined; asking {FALLBACK_MODEL}', file=sys.stderr)
        model = FALLBACK_MODEL
        response = client.messages.create(model=model, **request)
    if response.stop_reason != 'end_turn':
        raise RuntimeError(f'stopped with {response.stop_reason}')
    return json.loads(next(block.text for block in response.content if block.type == 'text')), response.usage, model


def analyse(client, model, profile, apps, caption, transcript):
    listing = '\n'.join(
        f"{i}. {r.get('company') or ''} — {titles.role_of(r.get('title') or '', r.get('company') or '', r.get('via') or '')} "
        f"(stage {r.get('stage') or ''}, applied {r.get('applied_on') or '?'})"
        for i, r in enumerate(apps))
    return ask(client, model, max_tokens=MAX_TOKENS,
               system=[{'type': 'text', 'text': SYSTEM + profile}],
               messages=[{'role': 'user', 'content': f'Applications:\n{listing or "(none)"}\n\nCaption: {caption or "(none)"}\n\n'
                                                     f'Transcript or notes:\n{transcript}'}],
               output_config=engine.structured(SCHEMA, model))
