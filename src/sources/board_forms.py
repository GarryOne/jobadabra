"""A job board's own search link, read from the search form on its home page (structure only: a form sent by GET with a text box, on the
board's own site, no password box), for a board whose proposed link gave no relevant job (owner, 18 Oct 2026: 14 of 32 boards proposed
for six candidates gave nothing or ignored the search words, e.g. warehouse jobs for "financial analyst" in Amsterdam). The first text
box takes the role, a second the place; hidden fields keep their values. found_boards.read tries it once per proposed link and keeps it
when it brings relevant jobs; with none, the job list the board declares itself (found_boards._another_way). Tests: tests/test_board_forms.py."""
import urllib.parse
from html.parser import HTMLParser

from .careers_parse import registrable

TEXT_BOXES = ('', 'text', 'search')   # an <input> a person types words into
MAX_TEMPLATES = 2                     # forms tried per board: the home page's search box is among the first


class _Forms(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.forms, self.open = [], None

    def handle_starttag(self, tag, attrs):
        attrs = {key: value or '' for key, value in attrs}
        if tag == 'form':
            self.open = {'action': attrs.get('action', ''), 'method': attrs.get('method', 'get').lower(), 'boxes': [], 'hidden': [], 'password': False}
            self.forms.append(self.open)
        elif tag == 'input' and self.open is not None:
            kind = attrs.get('type', '').lower()
            if kind == 'password':
                self.open['password'] = True
            elif kind == 'hidden' and attrs.get('name'):
                self.open['hidden'].append((attrs['name'], attrs.get('value', '')))
            elif kind in TEXT_BOXES and attrs.get('name'):
                self.open['boxes'].append(attrs['name'])

    def handle_endtag(self, tag):
        if tag == 'form':
            self.open = None


def templates(markup, page_url):
    """The search links the page's own forms make, with {role} (and {place} for a second text box), forms with two boxes first."""
    parser = _Forms()
    try:
        parser.feed(str(markup or ''))
    except Exception:  # noqa: BLE001 — a page the parser cannot read gives no form
        return []
    home = urllib.parse.urlsplit(page_url).hostname or ''
    out = []
    for found in sorted(parser.forms, key=lambda f: -min(len(f['boxes']), 2)):
        if found['method'] != 'get' or found['password'] or not found['boxes']:
            continue
        action = urllib.parse.urljoin(page_url, found['action'] or page_url)
        parts = urllib.parse.urlsplit(action)
        if parts.scheme not in ('http', 'https') or registrable(parts.hostname or '') != registrable(home):
            continue
        fields = [*(f'{urllib.parse.quote_plus(name)}={urllib.parse.quote_plus(value)}' for name, value in found['hidden']),
                  f'{urllib.parse.quote_plus(found["boxes"][0])}={{role}}',
                  *([f'{urllib.parse.quote_plus(found["boxes"][1])}={{place}}'] if len(found['boxes']) > 1 else [])]
        url = urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path or '/', '&'.join([*([parts.query] if parts.query else []), *fields]), ''))
        if url not in out:
            out.append(url)
    return out[:MAX_TEMPLATES]


def home(board, fetch):
    """(address, markup) of the board's home page; markup '' when it does not answer."""
    parts = urllib.parse.urlsplit(board['search_url'])
    address = f'{parts.scheme}://{parts.netloc}/'
    try:
        return address, str(fetch(address) or '')
    except Exception:  # noqa: BLE001 — a home page that does not answer: the proposed link stays
        return address, ''


def home_templates(board, fetch, page=None):
    """The search links the board's home page forms make (page: home()'s answer, fetched once)."""
    address, markup = page or home(board, fetch)
    found = templates(markup, address) if markup else []
    return [url for url in found if url != board['search_url']]
