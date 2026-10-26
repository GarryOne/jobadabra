"""Whether a proposed job board is one (owner, 19 Oct 2026, step 1 of the local-sources sketch: two of a driver's three trade boards were
made up: fahrerjobs.de is one haulage company's own site, trucker.jobs has no address). Asked once per board, only when its read gave no
job: its home page is fetched (structure only: no address, or a home page that is not there, is 'gone'; a refusal is left to the read),
and the AI says what the site is from its name, description and link texts, one fixed answer (src/ai/decide.py). Nothing is checked
while the AI page reader is off (careers.READER None: tests, a user who keeps pages from the AI). found_boards.read reads a spare board in place of one
that is not a board, hands 'one employer' to the scout with its website (board_employers.note_site) and skips them later
(board_yield.pick). Tests: tests/test_board_check.py.
field_kind: the same question for THIS search's field, asked before a board the web search found joins the list (owner's yes, 26 Oct 2026, discovery
sketch "AI judges the page": a pilot search's web search returned a recruiter, a news site's search page and an empty board as trade boards).
Tests: tests/test_board_judge.py."""
import re
import socket
import urllib.error
import urllib.parse
from html.parser import HTMLParser

from . import careers

KINDS = ('job board', 'one employer', 'other')
NOT_A_BOARD = ('gone', 'one employer', 'other')   # what is read in place of a board, not as one
TOPIC = 'job site kind'
INSTRUCTIONS = ("Say what this website is, from its name, description and the texts of its links. 'job board': it lists job offers "
                "from many different employers (a job portal, a job search site, a staffing agency's list of its clients' jobs). 'one "
                "employer': it is one company's or organisation's own site, even with a careers page. 'other': anything else (a directory, "
                "news, a parked or empty domain).")
LINKS = 40   # link texts sent at most


class _Digest(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title, self.meta, self.links, self._in = '', {}, [], None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta' and (attrs.get('name') or attrs.get('property')) in ('description', 'og:site_name', 'og:description'):
            self.meta.setdefault(attrs.get('name') or attrs.get('property'), (attrs.get('content') or '').strip())
        if tag in ('title', 'a'):
            self._in = tag
            if tag == 'a':
                self.links.append('')

    def handle_endtag(self, tag):
        if tag == self._in:
            self._in = None

    def handle_data(self, data):
        if self._in == 'title':
            self.title += data
        elif self._in == 'a' and self.links:
            self.links[-1] += data


def _read(page):
    digest = _Digest()
    try:
        digest.feed(page)
    except Exception:  # noqa: BLE001 — a broken page: what was read so far
        pass
    return digest


def digest(page):
    """The page's name, description and link texts, as the AI is asked about it."""
    found = _read(page)
    links = list(dict.fromkeys(text for text in (' '.join(link.split()) for link in found.links) if 1 < len(text) < 60))[:LINKS]
    return '\n'.join(part for part in (f"Name: {' '.join(found.title.split())}", f"Site: {found.meta.get('og:site_name', '')}",
                                       f"Description: {found.meta.get('description') or found.meta.get('og:description', '')}",
                                       'Links: ' + ' | '.join(links)) if part.split(': ', 1)[1])


def name_of(page, host):
    """The site's own name (og:site_name, else its title's first part), else its host."""
    found = _read(page)
    title = re.split(r'\s*[|·:]\s+|\s+[\-–—]\s+', ' '.join(found.title.split()))[0]   # "Name: page" / "Name | page" / "Name - page\"
    return found.meta.get('og:site_name') or title or host


def home(board):
    parts = urllib.parse.urlsplit(board['search_url'])
    return f'{parts.scheme}://{parts.netloc}/'


def kind(board, fetch, ask=None):
    """(kind, home page): kind 'gone', 'job board', 'one employer', 'other', or None when unknown (no AI, a refusal, a passing error)."""
    if careers.READER is None:   # the AI page reader is off (tests, a user who keeps pages from the AI): no check at all
        return None, ''
    address = home(board)
    try:
        page = str(fetch(address) or '')
    except urllib.error.HTTPError as error:
        return ('gone' if error.code in (404, 410) else None), ''
    except urllib.error.URLError as error:
        return ('gone' if isinstance(error.reason, socket.gaierror) else None), ''
    except ValueError:   # careers.get_text: the host has no public address
        return 'gone', ''
    except Exception:  # noqa: BLE001 — a refusal or a passing error: the read's own answer stands
        return None, ''
    if not page.strip():
        return None, page
    if ask is None:
        from ..ai import decide
        ask = decide.one
    answer = ask(TOPIC, urllib.parse.urlsplit(address).hostname, digest(page), KINDS, INSTRUCTIONS)
    return (answer if answer in KINDS else None), page


FIELD_KINDS = ('field board', 'job board', 'one employer', 'other')
FIELD_TOPIC = 'job site kind for a field'
FIELD_INSTRUCTIONS = ("Say what this website is for the person looking for work given first, from its name, description and the texts of its "
                      "links. 'field board': it lists job offers from many employers in that person's field (a job board of the field, a "
                      "recruiter's list of many clients' jobs in it, the job section of the field's trade press or association). 'job board': it "
                      "lists job offers from many employers of any field (a general job portal). 'one employer': it is one company's or "
                      "organisation's own site, even with a careers page. 'other': anything else (news without job offers, a directory, a shop, "
                      "a parked or empty domain).")


def field_kind(board, fetch, roles, ask=None):
    """'field board', 'job board', 'one employer' or 'other' for the page this board was found as (its home page when it is a search template),
    for someone looking for work as `roles`; None when unknown (the page reader off, no page, no AI answer): the board then stands as found."""
    if careers.READER is None:
        return None
    address = home(board) if '{' in board['search_url'] else board['search_url']
    try:
        page = str(fetch(address) or '')
    except Exception:  # noqa: BLE001 — a refusal or a passing error: the board stands, its read and check come later
        return None
    if not page.strip():
        return None
    if ask is None:
        from ..ai import decide
        ask = decide.one
    text = f"Looking for work as: {', '.join(roles)}\n{digest(page)}"
    answer = ask(FIELD_TOPIC, urllib.parse.urlsplit(address).hostname, text, FIELD_KINDS, FIELD_INSTRUCTIONS)
    return answer if answer in FIELD_KINDS else None
