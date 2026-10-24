"""Which parts of the Google sign-in (Gmail, Calendar) the user actually allowed, and the plain words for a missing one.

Google's consent screen lets the user untick a box; the token answer then lists only what was granted. This module reads that list,
keeps it next to the token (Keychain item `job-pilotto.google.scopes`, repo secret GOOGLE_SCOPES for Always on) and gives every
caller one error, `MissingScope`, so no screen or message shows a raw 403."""
import os

GMAIL, CALENDAR = 'gmail', 'calendar'
SCOPE_URLS = {GMAIL: 'https://www.googleapis.com/auth/gmail.readonly', CALENDAR: 'https://www.googleapis.com/auth/calendar.readonly'}
SCOPES_SERVICE = 'job-pilotto.google.scopes'
PART_NAMES = {GMAIL: 'Gmail', CALENDAR: 'Calendar'}
WHAT_IT_LOSES = {GMAIL: 'replies and rejections cannot be tracked from your mail', CALENDAR: 'interviews cannot be found in your calendar'}


class MissingScope(RuntimeError):
    """A part of Google the user did not allow (`part` is GMAIL or CALENDAR)."""

    def __init__(self, part):
        self.part = part
        super().__init__(f'{PART_NAMES[part]} was not allowed in the Google sign-in: {WHAT_IT_LOSES[part]}. Reconnect and tick it.')


def parts_in(scope_text):
    """The parts (GMAIL, CALENDAR) named in Google's space-separated `scope` answer, in a fixed order."""
    words = str(scope_text or '').split()
    return tuple(part for part, url in SCOPE_URLS.items() if url in words)


def saved(text):
    """Parts from a stored value ('gmail calendar'); None when nothing is stored (a sign-in made before this check: assume both)."""
    names = str(text or '').split()
    if not names:
        return None
    return tuple(part for part in SCOPE_URLS if part in names)


def from_env(read=None):
    """The saved parts: CI's GOOGLE_SCOPES, else this computer's secret store; None = unknown (all allowed)."""
    if os.getenv('GOOGLE_SCOPES'):
        return saved(os.getenv('GOOGLE_SCOPES'))
    return saved(read(SCOPES_SERVICE)) if read else None


def without(parts, part):
    """`parts` (None = unknown, both) minus `part`; None when `part` was not in it, so there is nothing new to learn."""
    known = tuple(SCOPE_URLS) if parts is None else parts
    return tuple(p for p in known if p != part) if part in known else None


def missing(parts):
    """The parts not allowed (empty when `parts` is None = unknown)."""
    return () if parts is None else tuple(part for part in SCOPE_URLS if part not in parts)


def say(parts):
    """One plain sentence for the app and the Telegram notice; '' when everything is allowed."""
    gone = missing(parts)
    if not gone:
        return ''
    if len(gone) == len(SCOPE_URLS):
        return 'Nothing was allowed in the Google sign-in. Connect again and tick both boxes.'
    return f'{PART_NAMES[gone[0]]} was not allowed: {WHAT_IT_LOSES[gone[0]]}. Reconnect to add it.'


def status(parts):
    """What the app shows: {'granted': [...], 'missing': [...], 'say': '...'}."""
    return {'granted': list(SCOPE_URLS if parts is None else parts), 'missing': list(missing(parts)), 'say': say(parts)}


def request_scopes(only=None):
    """The scope URLs to ask for: just the `only` parts on a reconnect, else both."""
    return tuple(SCOPE_URLS[part] for part in (only or SCOPE_URLS))


def part_of_refusal(url, status, body):
    """The part (GMAIL, CALENDAR) a 403 "insufficient scope" refusal is about, from the URL it came from; None for any other error."""
    if status != 403 or not any(word in body.lower() for word in ('insufficient', 'scope')):
        return None
    return GMAIL if 'gmail.googleapis.com' in url else CALENDAR if 'googleapis.com/calendar' in url else None
