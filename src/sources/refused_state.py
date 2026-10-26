"""What a page a refused-site read brought IS: the real page, a passive check that may clear by itself, a captcha, a login page or a refusal (owner, 20 Oct 2026).
The AI judges it with a fixed answer (src/ai/decide.py, any language, no vendor list); the status and the address are floors that only AND with it;
a short word list answers only when there is no AI at all (a busy or failed AI leaves the page unjudged: None). Used by the extension's real-tab step to know when to keep waiting
(a passive check) and when to stop (a captcha: only the user solves it, never us). Guard: tests/test_refused_state.py."""
import hashlib
import re
import urllib.parse

from ..ai import decide
from . import host_pace

STATES = ('page', 'passive_check', 'captcha', 'login', 'refused')
LOGIN_PATH = re.compile(r'/(?:log-?in|sign-?in|sso|oauth\d*|authorize|uas/login|account/login|auth)(?:[/?#.]|$)', re.I)
BIG_PAGE = 20000   # a page this long (bytes) AND with REAL_TEXT readable characters is a real page whatever else it says (the same floor as refused_reads._stop_why)
REAL_TEXT = 1500   # a check page is long in bytes (scripts, styles) but has a few hundred characters to read: 29 KB for two sites measured on 21 Oct 2026
TASK = ('A web page was opened in a browser to read a company\'s job list. Say what it is now: page = the real page (content, a job list, a careers site); '
        'passive_check = a "checking your browser" or "just a moment" wait page that clears by itself without any action by the visitor; '
        'captcha = a page that asks the visitor to tick a box, pick pictures or type characters to prove they are human; '
        'login = a page that asks the visitor to sign in; refused = access denied or blocked with nothing to do. Frame hosts list the embedded frames.')


def _text(html, title):
    body = re.sub(r'(?is)<(script|style|noscript)\b.*?</\1>', ' ', html or '')
    frames = sorted({urllib.parse.urlsplit(src).hostname or '' for src in re.findall(r'(?i)<iframe[^>]+src=["\']([^"\']+)', body)} - {''})[:5]
    words = re.sub(r'\s+', ' ', re.sub(r'(?s)<[^>]+>', ' ', body)).strip()[:400]
    return f'Title: {title or ""}\nFrame hosts: {", ".join(frames)}\nText: {words}'


def readable_chars(html):
    """How many characters of text a person could read on the page: tags, scripts and styles left out."""
    body = re.sub(r'(?is)<(script|style|noscript)\b.*?</\1>', ' ', html or '')
    return len(re.sub(r'\s+', ' ', re.sub(r'(?s)<[^>]+>', ' ', body)).strip())


def is_long_page(html):
    """The floor: long in bytes and a lot to read. Size alone is not enough (a check page carries big scripts)."""
    return len(html or '') >= BIG_PAGE and readable_chars(html) >= REAL_TEXT


def _word_rule(html):
    low = (html or '')[:6000].lower()
    if any(word in low for word in ('captcha', 'verify you are human', 'are you a robot')):
        return 'captcha'
    if any(word in low for word in ('just a moment', 'attention required', 'checking your browser')):
        return 'passive_check'
    return 'refused' if 'access denied' in low else 'page'


def page_state(status, html, title='', final=''):
    """One of STATES. A refusal status and a login address are floors; a long page is a page; else the AI answers (the word rule only with no AI at all)."""
    from . import refused_reads
    if int(status or 0) in host_pace.REFUSED:
        return 'refused'
    if final and (not refused_reads.allowed(final) or LOGIN_PATH.search(urllib.parse.urlsplit(final).path)):
        return 'login'
    if is_long_page(html):
        return 'page'
    if not (html or '').strip():
        return 'refused'
    text = _text(html, title)
    answer = decide.one('page_state', hashlib.sha1(text.encode()).hexdigest()[:16], text, STATES, TASK)
    if answer in STATES:
        return answer
    return _word_rule(html) if decide.no_ai() else None   # a busy or failed AI: not judged (the tab step stops as refused), never a word guess

