"""What a job board declares itself when its search page gives nothing (script-only page): an RSS/Atom or JSON feed named by <link rel=alternate>,
or the sitemap named in robots.txt leading to job pages that publish schema.org JobPosting data. Found by structure, never per site; the route
that worked is kept per host in data/found_boards.json (found_boards.read) and tried first next time. A 401/403 or a bot check on any of
these stops at once (Stop): the user's own visit (src/sources/visits_portals.py) stays the path. Tests: tests/test_board_routes.py."""
import email.utils
import html
import json
import re
import urllib.error
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

from . import board_state, careers, host_pace
from ..ai import page_words, slots
from .careers_parse import JOB_ID, MAX_JOB_PAGES, jsonld_jobs

MAX_SITEMAPS = 3      # sitemaps read per board
MAX_ITEMS = 200       # feed items kept
FEED_TYPES = {'application/rss+xml': 'feed', 'application/atom+xml': 'feed', 'application/feed+json': 'json', 'application/json': 'json'}


class Stop(Exception):
    """The board (or one of its declared routes) refused: 401/403 or a bot check (a 429 is host_pace's "slow down"). No further route is tried."""


def _get(fetch, url):
    """The text at url, or '' when it is not there; Stop for a refusal."""
    try:
        return fetch(url)
    except urllib.error.HTTPError as error:
        careers.note_refusal(url, error)
        if error.code in host_pace.REFUSED:
            raise Stop(url) from error
    except (urllib.error.URLError, OSError, ValueError) as error:
        if type(error).__name__ == 'Refused':
            raise Stop(url) from error
    return ''


def declared(page, base):
    """[(kind, address)] of the feeds the page names with <link rel=alternate>, kind 'feed' (RSS/Atom) or 'json'."""
    found = []
    for tag in re.findall(r'<link\b[^>]*>', page, re.I):
        attrs = {k.lower(): html.unescape(v) for k, _, v in re.findall(r'([\w:-]+)\s*=\s*(["\'])(.*?)\2', tag, re.S)}
        kind = FEED_TYPES.get(attrs.get('type', '').split(';')[0].strip().lower())
        if kind and 'alternate' in attrs.get('rel', '').lower().split() and attrs.get('href'):
            found.append((kind, urllib.parse.urljoin(base, attrs['href'])))
    return list(dict.fromkeys(found))


def _when(text):
    text = (text or '').strip()
    if re.match(r'\d{4}-\d{2}-\d{2}', text):
        return text[:10]
    try:
        return email.utils.parsedate_to_datetime(text).date().isoformat()
    except (TypeError, ValueError):
        return ''


def _items(text):
    """[{title, url, description, posted}] from an RSS or Atom document; none for anything with an entity declaration."""
    if re.search(r'<!(DOCTYPE|ENTITY)', text, re.I):
        return []
    try:
        root = ET.fromstring(text.strip().encode('utf-8'))
    except (ET.ParseError, ValueError):
        return []
    for element in root.iter():
        element.tag = element.tag.rsplit('}', 1)[-1] if isinstance(element.tag, str) else element.tag
    out = []
    for item in [e for e in root.iter() if e.tag in ('item', 'entry')][:MAX_ITEMS]:
        def child(*names):
            return next((c for c in item if c.tag in names), None)
        link = child('link')
        url = (link.get('href') or (link.text or '')).strip() if link is not None else ''
        title, summary = child('title'), child('description', 'summary', 'content')
        when = child('pubDate', 'published', 'updated')
        out.append({'title': (title.text or '').strip() if title is not None else '', 'url': url,
                    'description': (summary.text or '') if summary is not None else '', 'posted': _when(when.text if when is not None else '')})
    return out


def _json_items(text):
    try:
        data = json.loads(text)
    except ValueError:
        return []
    rows = data if isinstance(data, list) else next((data[k] for k in ('items', 'jobs', 'results', 'data') if isinstance(data.get(k), list)), []) if isinstance(data, dict) else []
    return [{'title': str(r.get('title') or '').strip(), 'url': str(r.get('url') or r.get('link') or '').strip(),
             'description': str(r.get('content_text') or r.get('content_html') or r.get('summary') or r.get('description') or ''),
             'posted': _when(str(r.get('date_published') or r.get('date') or ''))} for r in rows[:MAX_ITEMS] if isinstance(r, dict)]


def _feed_jobs(items, board, base):
    from .aggregators import _job
    jobs = []
    for item in items:
        url = urllib.parse.urljoin(base, item['url'])
        if item['title'] and url.startswith('http'):
            jobs.append(_job(board['host'], url, item['title'], f"via {board['name']}", '', url, item['posted'], item['description']))
    return jobs


def _locs(xml):
    return re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', xml)


def _sitemap_pages(url, fetch, host):
    """Job-page addresses of one sitemap (or the job-ish children of an index), same host only."""
    xml = _get(fetch, url)
    locations = _locs(xml)
    if '<sitemapindex' in xml:
        children = [loc for loc in locations if re.search(r'job|career|karriere|stelle|vacanc|offre|emploi|post', loc, re.I)][:MAX_SITEMAPS] or locations[:1]
        locations = [loc for child in children for loc in _locs(_get(fetch, child))]
    pages = []
    same = [(loc, urllib.parse.urlsplit(loc)) for loc in locations]
    same = [(loc, parts) for loc, parts in same if (parts.hostname or '').removeprefix('www.') == host.removeprefix('www.')]
    words = page_words.link_words(('', parts.path) for loc, parts in same)
    for loc, parts in same:
        now = words[('', str(parts.path or ''))]
        if now and (now.job_path or JOB_ID.search(parts.path)) and not now.not_jobs:
            pages.append(loc)
    return pages


def _sitemap_jobs(url, fetch, board, terms):
    pages = _sitemap_pages(url, fetch, board['host'])
    words = [w for t in terms for w in re.findall(r'\w{4,}', t.lower())]
    pages.sort(key=lambda p: not any(w in p.lower() for w in words))   # addresses naming the search come first; the title triage judges the rest
    refused = []

    def one(link):
        try:
            page = _get(fetch, link)
            return [{**job, 'company': job.get('employer')} for job in jsonld_jobs(page, link)]
        except Stop:
            refused.append(link)
            return []
    with ThreadPoolExecutor(max_workers=6) as pool:
        found = [job for result in pool.map(slots.carry(one), pages[:MAX_JOB_PAGES]) for job in result]
    if refused:
        raise Stop(refused[0])
    from .aggregators import _job
    return [_job(board['host'], j['id'] or j['url'], j['title'], j.get('company') or f"via {board['name']}", j['location'], j['url'], j.get('date_posted', ''),
                 j.get('description', ''), j.get('remote'), j.get('salary', '')) for j in found]


def follow(route, fetch, board, terms):
    """The jobs one route gives now."""
    if route['kind'] == 'sitemap':
        return _sitemap_jobs(route['url'], fetch, board, terms)
    if route['kind'] == 'state':
        return board_state.jobs(_get(fetch, route['url']), route['url'], board)
    text = _get(fetch, route['url'])
    return _feed_jobs(_items(text) if route['kind'] == 'feed' else _json_items(text), board, route['url'])


def discover(page, url, fetch, board, terms):
    """(jobs, route) from the first route the board declares that gives jobs; ([], None) when none does. Raises Stop on a refusal."""
    origin = '{0.scheme}://{0.netloc}'.format(urllib.parse.urlsplit(url))

    def sitemaps():   # robots.txt is read only when no declared feed gave jobs
        robots = _get(fetch, f'{origin}/robots.txt')
        yield from ({'kind': 'sitemap', 'url': urllib.parse.urljoin(origin, m.strip())} for m in re.findall(r'^\s*sitemap:\s*(\S+)', robots, re.I | re.M)[:MAX_SITEMAPS])
    embedded = board_state.jobs(page, url, board)   # the page's own data, already fetched: no extra request
    if embedded:
        return embedded, {'kind': 'state', 'url': url}
    for route in [{'kind': kind, 'url': address} for kind, address in declared(page, url)], sitemaps():
        for one in route:
            jobs = follow(one, fetch, board, terms)
            if jobs:
                return jobs, one
    return [], None
