"""Descriptions for jobs that arrived without one.

Some boards list postings without their text (SmartRecruiters), and a job board's detail page can fail on the day a
job is found (jobs.ch). Without a description a job never gets stage 1 facts or a fit score, and nothing tried
again: it sat in the list with "–". Each run fetches the missing ones from the posting itself, newest first, a few
at a time (the importer keeps them: it only ever writes a real description over an empty one).
"""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import json
import re
import threading
import urllib.error
import urllib.request
from urllib.parse import parse_qsl, urlsplit

from .. import pool_served
from . import ats, boards, host_pace, read_routes
from .careers_parse import registrable

SMARTRECRUITERS = re.compile(r'jobs\.smartrecruiters\.com/([^/?#]+)/(\d+)')


class _Prose(HTMLParser):
    """The HTML inside a page's first `prose` block (TechTree's posting text), tags kept so boards.text spaces it."""
    VOID = {'br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'wbr'}

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.depth, self.parts = 0, []

    def handle_starttag(self, tag, attrs):
        if self.depth:
            self.parts.append(self.get_starttag_text() or '')
            if tag not in self.VOID:
                self.depth += 1
        elif 'prose' in (dict(attrs).get('class') or '').split() and tag not in self.VOID:
            self.depth = 1

    def handle_endtag(self, tag):
        if self.depth:
            self.depth -= 1
            if self.depth:
                self.parts.append(f'</{tag}>')

    def handle_data(self, data):
        if self.depth:
            self.parts.append(data)

    def handle_entityref(self, name):
        if self.depth:
            self.parts.append(f'&{name};')

    def handle_charref(self, name):
        if self.depth:
            self.parts.append(f'&#{name};')


def techtree_text(html):
    """A TechTree posting page's own text (its list page, which the board reader uses, has none)."""
    reader = _Prose()
    reader.feed(html or '')
    return boards.text(' '.join(reader.parts))[:12000]


# Any posting page (owner, 7 Oct 2026: "universal, on any employer, feed, website or portal"): only these three had a reader, and every other
# site's postings were never even fetched ("can't be read" in the log was untrue for Bulgari, Fnac, H&M, Digitec, Workday). Now: Workday's
# own JSON for a Workday posting; else the page's schema.org JobPosting (most career sites publish it); else the page's main text. A site
# that refuses (401/403 or a "are you human" page) is respected: not asked again for a week, its jobs left for your browser (the
# extension, Find jobs using your browser). Sign-in sites (LinkedIn, Glassdoor, Indeed…) are never fetched (owner's rule).
WORKDAY = re.compile(r'^https://([^./]+)\.(wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([^/?#]+)/job/([^?#]+)')
CHALLENGE = re.compile(r'captcha|are you (?:a )?human|verify (?:that )?you are (?:a )?human|cf-chl|access denied|just a moment\.\.\.', re.I)
REFUSED_CODES = host_pace.REFUSED   # 429 is "slow down" (host_pace), never a refusal (owner, 20 Oct 2026)
REFUSED_DAYS = 7
MIN_TEXT = 400   # shorter: a cookie notice, an error or a login page, not a posting


_ROUTE = threading.local()   # the route that read the last page on this thread (src/sources/read_routes.py), set by page_text and fetch


class Refused(Exception):
    """The site refused an automated visit: respected, never worked around."""


def walled(url):
    from ..notion.ledger import WALLED
    host = (urlsplit(url or '').hostname or '').lower()
    return any(wall in host for wall in WALLED)


def readable(url):
    """Whether this posting's text may be fetched here: any web page but a sign-in site's."""
    return str(url or '').startswith(('http://', 'https://')) and not walled(url)


def _get(url, opener=None, accept='text/html'):
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Jobadabra; personal job search)', 'Accept': accept})
    try:
        with host_pace.open(request, 15, opener) as response:
            return response.read(3_000_000).decode('utf-8', errors='replace')
    except urllib.error.HTTPError as error:
        if error.code in REFUSED_CODES:
            raise Refused(f'HTTP {error.code}') from error
        raise


def main_text(html):
    """A page's own words: its <main> (or <article>, else <body>) without scripts, styles, menus, header and footer."""
    html = re.sub(r'(?is)<(script|style|noscript|svg|nav|header|footer|form)\b.*?</\1>', ' ', html or '')
    for tag in ('main', 'article', 'body'):
        found = re.search(rf'(?is)<{tag}\b[^>]*>(.*)</{tag}>', html)
        if found:
            return boards.text(found.group(1))
    return boards.text(html)


def page_text(url, opener=None):
    """The posting's text from any page; '' when none; Refused when the site refuses."""
    workday = WORKDAY.match(url or '')
    if workday:
        tenant, wd, site, path = workday.groups()
        data = json.loads(_get(f'https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/job/{path}', opener, 'application/json'))
        _ROUTE.route = 'api'
        return boards.text((data.get('jobPostingInfo') or {}).get('jobDescription') or '')[:12000]
    html = _get(url, opener)
    posting = next(boards.walk(boards.Page(html).schemas, 'JobPosting'), {})
    text = boards.text(posting.get('description', '') if isinstance(posting.get('description'), str) else '')
    if len(text) >= 200:
        _ROUTE.route = 'jobposting'
        return text[:12000]
    words = main_text(html)
    if CHALLENGE.search(words[:3000]) and len(words) < 3000:
        raise Refused('a bot check')
    _ROUTE.route = 'main'
    return words[:12000] if len(words) >= MIN_TEXT else ''


def fetch(url, client=None):
    """The posting's text, from its own API or page; '' when the page has none; Refused when the site refuses an automated visit."""
    _ROUTE.route = None
    match = SMARTRECRUITERS.search(url or '')
    if match:
        _ROUTE.route = 'api'
        return ats.smartrecruiters_detail(match.group(1), match.group(2))
    host = urlsplit(url or '').hostname or ''
    if host.endswith('jobs.ch'):
        page = (client or boards.Client()).get(url)
        posting = next(boards.walk(boards.Page(page['html']).schemas, 'JobPosting'), {})
        _ROUTE.route = 'jobposting'
        return boards.text(posting.get('description', ''))[:12000]
    if host.endswith('techtree.dev'):   # 6 Oct 2026: every TechTree job stayed unscored, "–"
        _ROUTE.route = 'main'
        return techtree_text((client or boards.Client()).get(url)['html'])
    return page_text(url)


def _refused_hosts(now):
    from ..paths import DATA
    try:
        kept = json.loads((DATA / 'refused_hosts.json').read_text())
    except (OSError, ValueError):
        kept = {}
    since = (now - timedelta(days=REFUSED_DAYS)).isoformat()
    # {host: {'at', 'why'}} since 20 Oct 2026; a bare time was kept before, also for a 429 ("slow down", host_pace now): dropped, asked again
    return {host: line for host, line in kept.items() if isinstance(line, dict) and str(line.get('at', '')) >= since}


def _keep_refused(hosts):
    from ..paths import DATA
    try:
        DATA.mkdir(parents=True, exist_ok=True)
        (DATA / 'refused_hosts.json').write_text(json.dumps(hosts))
    except OSError:
        pass


def backfill(db, limit=20, days=14, fetcher=fetch, now=None):
    """Fill in up to `limit` open jobs (seen in the last `days`) that have no description, from any posting page (page_text), 4 at a time.
    A site that refuses is not asked again for a week; it and sign-in sites are said as "readable in your browser". A site that asks us to
    slow down (host_pace.Busy) keeps its jobs for a later run, not refused. Returns a log line."""
    now = now or datetime.now(timezone.utc)
    since = (now - timedelta(days=days)).isoformat(timespec='seconds')
    rows = db.execute("SELECT id, url FROM jobs WHERE state='open' AND coalesce(description, '') = '' AND first_seen_at >= ? "
                      "ORDER BY first_seen_at DESC LIMIT ?", (since, limit)).fetchall()
    if not rows:
        return ''
    refused_before = _refused_hosts(now) if fetcher is fetch else {}
    host = lambda url: (urlsplit(url or '').hostname or '?').lower()
    from . import visits
    pooled = visits.pool_facts().get('route') or {} if fetcher is fetch else {}   # how other installs found each site read (src/sources/read_routes.py)
    walled_at, refused_at, scripted_at, waiting_at, closed_at, todo = Counter(), Counter(), Counter(), Counter(), Counter(), []
    for job_id, url in rows:
        if not readable(url):
            walled_at[host(url)] += 1
        elif host(url) in refused_before:
            refused_at[host(url)] += 1
        elif read_routes.skip(url, pooled, now):   # other installs found this site closed to a plain read: not asked again
            closed_at[host(url)] += 1
            pool_served.count('site_route')
        else:
            todo.append((job_id, url))

    def one(item):
        _ROUTE.route = None
        try:
            text = fetcher(item[1])
            if fetcher is fetch:   # how this site's text was read: shared with other installs (src/sources/read_routes.py)
                read_routes.record(item[1], _ROUTE.route if text else 'browser_only', now)
            return item, text, None
        except Exception as error:  # noqa: BLE001 — one posting failing never stops the others
            if isinstance(error, Refused) and fetcher is fetch:
                read_routes.record(item[1], 'refused', now)
            return item, '', error
    filled = failed = gone = empty = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(one, todo))
    for (job_id, url), text, error in results:
        if isinstance(error, host_pace.Busy):
            waiting_at[host(url)] += 1   # tried again in a later run, at the pace the site asked for
        elif isinstance(error, Refused):
            refused_at[host(url)] += 1
            refused_before[host(url)] = {'at': now.isoformat(), 'why': str(error)}
        elif getattr(error, 'code', None) in (404, 410):   # the posting was taken down: the job expired, not unscored
            db.execute("UPDATE jobs SET state='expired' WHERE id=?", (job_id,))
            gone += 1
        elif error is not None:
            failed += 1   # tried again next run
        elif text:
            db.execute('UPDATE jobs SET description=? WHERE id=?', (text, job_id))
            filled += 1
        else:
            empty += 1
            scripted_at[host(url)] += 1   # a page that draws its text with scripts: a browser shows it
    db.commit()
    if fetcher is fetch:
        _keep_refused(refused_before)
    hosts = lambda counts: ', '.join(sorted(counts))
    return (f'Descriptions: read {filled} of {len(rows)} missing job texts' + (f', {gone} posting(s) taken down (closed)' if gone else '')
            + (f', {empty} drawn only in a browser ({hosts(scripted_at)})' if empty else '') + (f', {failed} failed (tried again next time)' if failed else '')
            + (f', {sum(waiting_at.values())} waiting: {hosts(waiting_at)} asked us to slow down (tried again later)' if waiting_at else '')
            + (f', {sum(refused_at.values())} refused by {hosts(refused_at)}' if refused_at else '')
            + (f', {sum(walled_at.values())} on sign-in sites ({hosts(walled_at)})' if walled_at else '')
            + (f', {sum(closed_at.values())} not asked: other installs found {hosts(closed_at)} closed to a plain read' if closed_at else '')
            + (' → readable in your browser (Actions, Find jobs using your browser)' if refused_at or walled_at or closed_at or empty else ''))


BROWSER_AFTER = timedelta(hours=6)   # a job whose text this Mac could not read for this long (a page drawn by scripts) is a browser job too


def same_posting(a, b):
    """True when two addresses are one posting: the same host and path, and one's query only adds parameters to the other's (8 Oct 2026:
    Bulgari's details.html?jobId=1091811 and ...?jobId=1091811&jobTitle=CLIENT%20ADVISOR were listed twice). No parameter is named: any site."""
    one, two = urlsplit(a or ''), urlsplit(b or '')
    if (one.hostname or '').lower() != (two.hostname or '').lower() or one.path.rstrip('/') != two.path.rstrip('/'):
        return False
    first, second = set(parse_qsl(one.query, keep_blank_values=True)), set(parse_qsl(two.query, keep_blank_values=True))
    return first <= second or second <= first


def stuck(db, days=14, limit=60, now=None):
    """[{url, title, company, location, waiting_until}] open jobs in your places whose posting text only a browser can read: a sign-in site, a site
    that refused us, or a page tried for BROWSER_AFTER with no text (drawn by scripts). waiting_until (epoch seconds, else 0): the site asked us to
    slow down and is asked again then (owner, 20 Oct 2026: shown as waiting, not refused). Without the text they are never scored, so never listed; the
    extension reads them in your browser (Actions, Find jobs using your browser: "Jobs we couldn't read", 8 Oct 2026). Newest first."""
    from . import feeds, visits
    now = now or datetime.now(timezone.utc)
    gone = visits.dismissed()
    since, tried = (now - timedelta(days=days)).isoformat(timespec='seconds'), (now - BROWSER_AFTER).isoformat(timespec='seconds')
    refused = _refused_hosts(now)
    closed = read_routes.closed(visits.pool_facts().get('route'))
    rows = db.execute("""SELECT jobs.url, jobs.title, jobs.location, companies.name, jobs.first_seen_at FROM jobs
        LEFT JOIN companies ON companies.id = jobs.company_id WHERE jobs.state = 'open' AND coalesce(jobs.description, '') = ''
        AND jobs.first_seen_at >= ? ORDER BY jobs.first_seen_at DESC""", (since,)).fetchall()
    out = []
    for url, title, location, company, seen in rows:
        host = (urlsplit(url or '').hostname or '').lower()
        waiting = host_pace.waiting(url) if url else 0
        if not url or url in gone or not (walled(url) or host in refused or registrable(host) in closed or seen <= tried or waiting):
            continue
        job = {'url': url, 'title': title or '', 'company': company or '', 'location': location or '', 'waiting_until': round(waiting)}
        if feeds.wanted_location(job) and not any(same_posting(url, kept['url']) for kept in out):   # one row per posting
            out.append(job)
    return out[:limit]


def save_text(db, url, text):
    """A posting's text read in your browser: kept for the open job with this address that has none yet. True when one was filled."""
    text = ' '.join(str(text or '').split())[:12000]
    if len(text) < 200:   # a login page, an error page or an empty one: not a posting
        return False
    # The same posting under another address (same_posting) gets the text too, or it comes back as a job we couldn't read.
    host = (urlsplit(url or '').hostname or '').lower()
    twins = [row[0] for row in db.execute("SELECT url FROM jobs WHERE state='open' AND coalesce(description, '') = '' AND url LIKE ?", (f'%{host}%',))
             if same_posting(url, row[0])] if host else []
    changed = sum(db.execute("UPDATE jobs SET description=? WHERE url=? AND state='open' AND coalesce(description, '') = ''", (text, one)).rowcount
                  for one in dict.fromkeys([url, *twins]))
    db.commit()
    return changed > 0
