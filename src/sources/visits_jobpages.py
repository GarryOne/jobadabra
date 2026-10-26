"""Finding each employer's job list for a visit: the pool's and the web search's job pages, the choice of the best address for your country,
and the job page of a home page that is not one.

Split out of visits.py (pure move; visits.py re-exports it). The store stays in visits.py and is looked up there at call time.
Guarded by tests/test_visits.py and test_visit_unblock.py.
"""
import json
import re
import urllib.parse
from datetime import timedelta

from . import careers, read_routes
from ..ai import meanings_pack, page_words
from ..ai.providers.contract import detail, reason


JOBLIST = meanings_pack.matcher('page-words', 'job_list')   # the meanings pack: the old list (seed) + rows the site adds
NOT_A_LIST = meanings_pack.matcher('page-words', 'not_a_list')   # the meanings pack: the old list (seed) + rows the site adds
LOCALE = re.compile(r'(?:^|[/_.-])([a-z]{2})(?:[-_]([a-z]{2}))?(?=$|[/_.])', re.I)


def _usable(url, words=None):
    """An address that can be a job list: https, no template code (7 Oct 2026: DHL's '${getUrl(linkEle,' was taken for a link), not a sign-in,
    job-alert, article or news page (Baume & Mercier went to Workday's jobAlerts sign-in; Rolex to a 2024 article)."""
    url = str(url or '')
    if url.startswith('http://'):
        url = 'https://' + url[7:]
    path = urllib.parse.urlsplit(url).path
    if not url.startswith('https://') or re.search(r'\$\{|\{\{|%7B', url):
        return ''
    now = (words or page_words.link_words([('', path)], floor='not_a_list')).get(('', path))   # not judged yet (None): not usable this run
    return url if now and not now.not_jobs else ''


def _best(urls, countries=()):
    """Usable addresses, best first: one for your country (/ch-fr/, ?country=ch), then one in no language or in English, then a job-list
    word in the path; another country's or language's page last (7 Oct 2026: Franck Muller's /ar/careers was an Arabic 404)."""
    codes = {code.lower() for code in countries or ()}
    def rank(url):
        parts = urllib.parse.urlsplit(url)
        found = [(a.lower(), (b or '').lower()) for a, b in LOCALE.findall(parts.path)]
        local = any(a in codes or b in codes for a, b in found) or any(f'={code}' in parts.query.lower() for code in codes)
        foreign = found and not local and not any(a == 'en' for a, _ in found)
        return (0 if local else 2 if foreign else 1, 0 if (listed.get(('', parts.path)) or page_words.Words(False, False, False, False)).weak else 1)
    words = page_words.link_words((('', urllib.parse.urlsplit(url).path) for url in urls), floor='not_a_list')
    usable = [u for u in (_usable(url, words) for url in urls) if u]
    listed = page_words.link_words((('', urllib.parse.urlsplit(url).path) for url in usable), floor='job_list')
    return sorted(dict.fromkeys(usable), key=rank)


def _countries():
    try:
        from .. import employer_index
        return employer_index.me_now().get('countries') or []
    except Exception:  # noqa: BLE001 — no search yet: no country preferred
        return []


MISS_DAYS = 7   # a site whose job page a search could not find is not searched again for a week
BAD_DAYS = 30   # a job page that showed no jobs is not chosen again for this long


def _bad_pages(data, now):
    since = (now - timedelta(days=BAD_DAYS)).isoformat(timespec='seconds')
    return {page.rstrip('/') for page, at in (data.get('jobpage_bad') or {}).items() if at > since}


def pool_facts():
    """{kind: {host: url}} the central pool serves about sites (src/contribute.py site_facts; at least 3 installs agree): a company's job page,
    a site only a browser reads, a dead page. Read from the employer index this install downloads (src/employer_index.py)."""
    from ..employer_index import CACHE
    try:
        served = json.loads(CACHE.read_text()).get('sites') or []
    except (OSError, ValueError, AttributeError):
        return {}
    out = {}
    for fact in served if isinstance(served, list) else []:
        if isinstance(fact, dict) and fact.get('kind') in ('jobpage', 'browser', 'dead') and isinstance(fact.get('host'), str):
            out.setdefault(fact['kind'], {})[fact['host']] = fact.get('url')
        elif isinstance(fact, dict) and fact.get('kind') == 'browser_read' and isinstance(fact.get('host'), str) and _read_ok(fact.get('read')):
            out.setdefault('browser_read', {})[fact['host']] = _read_ok(fact['read'])
        elif isinstance(fact, dict) and fact.get('kind') == 'route' and fact.get('route') in read_routes.ROUTES and isinstance(fact.get('host'), str):
            out.setdefault('route', {})[fact['host']] = fact['route']   # how a site's posting text is read (src/sources/read_routes.py)
        elif isinstance(fact, dict) and fact.get('kind') == 'layout' and isinstance(fact.get('host'), str):
            out.setdefault('layout', {})[fact['host']] = fact.get('recipe')
        elif isinstance(fact, dict) and fact.get('kind') == 'board' and isinstance(fact.get('host'), str) and isinstance(fact.get('recipe'), dict):
            out.setdefault('board', {})[fact['host']] = {'url': fact.get('url'), 'countries': fact['recipe'].get('countries') or [],
                                                         'relevant': _cells(fact.get('relevant'))}
    return out


def _read_ok(read):
    """A served browser outcome in its fixed shape (src/sources/refused_reads.shared), or None."""
    from . import refused_reads
    from .. import role_kinds
    if not isinstance(read, dict) or read.get('outcome') not in refused_reads.OUTCOMES:
        return None
    jobs = read.get('jobs')
    return {'outcome': read['outcome'], **({'jobs': jobs} if isinstance(jobs, int) and jobs >= 0 else {}),
            **({'kinds': role_kinds.valid(read.get('kinds'))} if role_kinds.valid(read.get('kinds')) else {}),
            **({'step': read['step']} if read.get('step') in refused_reads.STEPS else {}),
            **({'route': refused_reads.valid_route(read.get('route'))} if refused_reads.valid_route(read.get('route')) else {})}


def _cells(items):
    """What a board gave installs per role family × country (site/src/employers.js boardCells): fixed shape, or dropped."""
    out = []
    for cell in items if isinstance(items, list) else []:
        if isinstance(cell, dict) and all(isinstance(cell.get(k), str) for k in ('family', 'country')) and \
                all(isinstance(cell.get(k), int) and cell[k] >= 0 for k in ('installs', 'in_places', 'fit70')) and cell['installs'] > 0:
            out.append({k: cell[k] for k in ('family', 'country', 'installs', 'in_places', 'fit70')})
    return out


def find_job_pages(sites, countries=(), search=None, now=None):
    """Each employer's job list before its tab opens (owner, 7 Oct 2026: "rebuild the URLs to go to the jobs page, not the home page"): one
    "<company> jobs" web search per site with no known job page, preferring an address for your country (/ch-en, ?country=ch). Kept per site,
    a miss too (for MISS_DAYS). Returns {start url: job page url} for the sites that have one."""
    from . import web_search
    now = now or visits._now()
    search = search or web_search.job_sites
    data = visits._load()
    known, missed = data.get('jobpages') or {}, data.get('jobpage_misses') or {}
    recent = (now - timedelta(days=MISS_DAYS)).isoformat(timespec='seconds')
    found = {}
    pooled = (visits.pool_facts().get('jobpage') or {})
    for site in sites:
        host = visits.host_of(site['url'])
        if site['url'] in known.values():   # already its job page (visit_list swaps it in)
            continue
        if host not in known and str(pooled.get(host) or '').startswith('https://'):   # other installs found it: no web search, no AI
            with visits.LOCK:
                fresh = visits._load()
                fresh.setdefault('jobpages', {})[host] = pooled[host]
                visits._save(fresh)
            known = {**known, host: pooled[host]}
            print(f"Visit: job page of {site['name']}: {pooled[host]} (from the pool)")
        if host in known or site.get('kind') == 'portal' or missed.get(host, '') > recent or not web_search.provider():
            if host in known:
                found[site['url']] = known[host]
            continue
        bad = _bad_pages(data, now)
        try:   # its website said too: another company with the same name is not taken (src/sources/web_search.py)
            results = search(site['name'], site=site['url'])
        except TypeError:   # a search that takes the name only
            results = search(site['name'])
        urls = [url for url in results if url.split('#')[0].rstrip('/') not in {site['url'].rstrip('/'), *bad}]
        page = (_best(urls, countries) or [None])[0]
        print(f"Visit: job page of {site['name']}: {page or 'not found'}")
        with visits.LOCK:
            fresh = visits._load()
            if page:
                fresh.setdefault('jobpages', {})[host] = page
                found[site['url']] = page
            else:
                fresh.setdefault('jobpage_misses', {})[host] = now.isoformat(timespec='seconds')
            visits._save(fresh)
    return found


def job_page(url, markup):
    """The job list's address from a page that is not one (a home page: hublot.com/en-ch, whose jobs are at /joboffers/en): the page's own
    careers link (careers.careers_links, no AI), else the scout's AI link chooser. Kept per site, so the next Open goes straight there.
    Owner, 7 Oct 2026: "on this homepage there are no jobs; this should be the right page"."""
    found = careers.careers_links(markup or '', url)
    name = re.sub(r'<[^>]+>', '', (re.search(r'<title[^>]*>(.*?)</title>', markup or '', re.S | re.I) or [None, ''])[1]).split('|')[0].split(' - ')[0].strip()
    name = name if 2 <= len(name) <= 60 else visits.host_of(url).split('.')[0]
    if found:   # the page's own careers links go through the same check as a search's (8 Oct 2026: Fust's link led to its "application process" page)
        from . import web_search
        found = web_search.only_job_lists(name, url.split('#')[0], found)
    if not found:
        choose = careers.chooser()
        try:
            found = choose(url, markup or '') if choose else []
        except Exception as error:  # noqa: BLE001 — no answer: the page is read as it is
            print(f'Warning: job list link not chosen for {visits.host_of(url)} ({reason(error)})')
            detail('job pages', error)
            found = []
    if not found:   # no careers link and no AI pick: "<company> jobs", as a person would (owner, 7 Oct 2026: the most reliable)
        from . import web_search
        if web_search.provider():
            try:
                found = web_search.job_sites(name, site=url.split('#')[0])
            except Exception as error:  # noqa: BLE001
                print(f'Warning: web search for {name} jobs failed ({reason(error)})')
                detail('job pages', error)
                found = []
    bad = _bad_pages(visits._load(), visits._now())
    page = next((link for link in _best(found, _countries()) if link.split('#')[0] != url.split('#')[0] and link.split('#')[0].rstrip('/') not in bad), None)
    if page:
        with visits.LOCK:
            data = visits._load()
            data.setdefault('jobpages', {})[visits.host_of(url)] = page
            visits._save(data)
        print(f'Visit: the job list of {visits.host_of(url)} is {page}')
    return page


from . import visits  # noqa: E402  (at the end: visits imports this file back, so importing this file first works too)
