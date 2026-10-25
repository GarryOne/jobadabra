"""Interview analysis, the stages: which stages an interview moves forward, which it never touches, and the stage a held
call leads to. Re-exported by src/ai/interviews.py. Tests: tests/test_interviews_advance_facts.py, tests/test_interviews_focus.py.
"""
from . import meanings


# Stages an interview can move an application forward from; later stages are never overwritten.
BEFORE_INTERVIEW = ('Applied', 'Confirmation received', 'Screening', 'Interview scheduled', 'Applying', 'No response',
                    'Recruiter lead')
CANDIDATE_STAGES = BEFORE_INTERVIEW + ('Interviewing', 'Offer', 'Rejected')
# Talking to them, or a call booked: once a call was held, the application is in process (Interviewing).
IN_TALKS = ('Recruiter lead', 'Screening', 'Interview scheduled')
# Never touched by an interview: an offer, or the application is over.
CLOSED = ('Offer', 'Rejected', 'Withdrawn', 'Closed', 'Dismissed')
CANCELLED = 'Interview cancelled'  # 📈 Application Events kind: the call didn't happen (Stage stays)
from ..app_source import APP_SOURCE  # noqa: F401  (interviews.py imports it from here)


def held_stage(stage, round_=''):
    """The Stage once an interview was held, or None to leave it: never a closed stage, never back from Interviewing.
    A recruiter/screening round held is Screening (owner, 30 Sep 2026: the funnel's "Interviews" step starts with a
    technical or hiring-manager round), even when the call was booked as "Interview scheduled"; any other round is
    Interviewing."""
    if stage in CLOSED or stage == 'Interviewing':
        return None
    if meanings.round_kind(round_) == 'recruiter_screen':
        return None if stage == 'Screening' else 'Screening'
    return 'Interviewing'
