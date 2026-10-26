"""What content means, decided by AI in any language (CLAUDE.md "Meaning comes from AI, never from keyword lists"; the shared mechanism is
src/ai/decide.py). One function per decision; the callers keep no words of their own. Without AI the answer is "don't know" (the safe
default named in each function), never an English guess: a keyword rule is kept only where a wrong action would hurt (owner, 8 Oct 2026).
Tests: tests/test_decide.py."""
import hashlib

from . import decide, engine

ROUND_KINDS = ('recruiter_screen', 'technical', 'hiring_manager', 'other')


def round_kind(round_):
    """What kind of round this was, from its name in any language ("Entretien RH", "Fachgespräch"): AI, kept per name; 'other' without AI."""
    text = (round_ or '').strip()
    if not text:
        return 'other'
    found = decide.one('interview-round', text.lower(), text, ROUND_KINDS,
                       'The name of one interview round. recruiter_screen: a first call with a recruiter, HR or talent team; technical: a skills, '
                       'coding, design or take-home round; hiring_manager: with the hiring manager, a director or a final/culture round; other.')
    return found or 'other'   # without AI: not known


def asks_to_book(note):
    """The reply asks you to pick or book a time, in any language: AI, kept per note; False without AI."""
    found = decide.one('asks-to-book', hashlib.sha256((note or '').encode()).hexdigest()[:20], note or '', ('asks_to_book', 'other'),
                       'A short note about an employer\'s or recruiter\'s reply. asks_to_book: it asks the candidate to pick, book or confirm '
                       'a time for a call or interview (a scheduling link, slots, availability); other: anything else.') if (note or '').strip() else 'other'
    return found == 'asks_to_book'


def job_events(events, text_of):
    """The calendar events that are a job interview or a call about a job, in any language; [] without AI (read again at the next check)."""
    key = lambda event: event.get('id') or event.get('summary', '')
    judged = decide.decide('calendar-event', {key(e): f"{e.get('summary', '')}\n{text_of(e)[:400]}" for e in events}, ('job_interview', 'other'),
                           'One calendar event. job_interview: a job interview, screening or call with an employer or recruiter about a job; '
                           'other: anything else.') or {}
    return [e for e in events if judged.get(key(e)) == 'job_interview']


def labels(topic, texts, choices, task):
    """The fixed-list ids these texts name (choices: id -> name): every id the meanings pack gives a text, else the model's one; 'none'
    left out. Without AI: what the pack knows (the old lists), so nothing a Swiss or English user had is lost."""
    texts = [str(t).strip() for t in texts if str(t or '').strip()]
    if not texts:
        return []
    from . import meanings_pack
    late = meanings_pack.ai_first(topic)   # a kind of work: the keyword patterns only without AI (decide.py), the site's learned wordings first
    known = {t: meanings_pack.every(topic, t, patterns=not late) for t in texts}   # every id the pack gives a text (the old lists + what the site learned)
    rest = [t for t in texts if not known[t]]
    named = '; '.join(f'{key} = {name}' for key, name in choices.items())
    found = (decide.decide(topic, {t.lower(): t for t in rest}, (*choices, 'none'), f'{task} Ids: {named}; none = none of these.', floor=False) or {}) if rest else {}
    if late and rest and not engine.ready():   # no AI at all: every id the old lists give ('many'), as before
        known.update({t: meanings_pack.every(topic, t) for t in rest if t.lower() not in found})
    return sorted({a for answers in known.values() for a in answers if a in choices} | {a for a in found.values() if a != 'none'})
