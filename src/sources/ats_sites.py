"""Company-site and search-driven job feeds: Workday, SuccessFactors, Umantis, Amazon, Netflix, and the Strategy terms they search with.

Split out of ats.py (pure move; ats.py re-exports it). ats.py imports and re-exports every name here; it still owns `_get`/`_json`, which these
functions look up on the `ats` module at call time so tests that patch `ats._get` / `ats.workday_terms` keep working.
Guarded by tests/test_ats.py, test_discover.py and test_visit_ats_feed.py.
"""
import html
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET



WORKDAY_PAGES = 2       # 20 jobs a page per search term: Workday sites list thousands, so each of the user's terms is searched
WORKDAY_ALL_PAGES = 10  # and the newest 200 with no term, for every search: what an employer hires for, not only what one user asks
WORKDAY_MAX_TERMS = 6


def workday_terms(search=None):
    """The user's own search phrases for a Workday search (6 Oct 2026: the reader searched only SRE and DevOps terms, the first user's, so a
    photographer could never see Cartier's or Piaget's boutique jobs). Their jobs-board phrases, else their role keywords as words."""
    if search is None:
        from ..paths import load_search_config
        search = load_search_config()
    phrases = [str(p) for p in search.get('jobs_board_search_queries') or []]
    if not phrases:
        phrases = [re.sub(r'\\[bwsd]|[\\^$()|?*+\[\]{}.]', ' ', str(word)).strip() for word in search.get('role_keywords') or []]
    return [p for p in dict.fromkeys(' '.join(p.split()) for p in phrases) if len(p) > 2][:WORKDAY_MAX_TERMS]


def _split_workday(slug):
    tenant, cluster, site = slug.split('.', 2)
    if not re.fullmatch(r'wd\d{1,2}', cluster) or not re.fullmatch(r'[\w-]+', tenant) or not re.fullmatch(r'[\w-]+', site):
        raise ValueError('not a Workday slug')
    return tenant, cluster, site


def workday(slug):
    """A Workday career site, slug `tenant.wdN.Site`. Its public search (the one its own page uses) is asked for each role term."""
    tenant, cluster, site = _split_workday(slug)
    base = f'https://{tenant}.{cluster}.myworkdayjobs.com'
    jobs, seen = [], set()
    for term, pages in [('', WORKDAY_ALL_PAGES), *((term, WORKDAY_PAGES) for term in ats.workday_terms())]:
        for page in range(pages):
            body = json.dumps({'appliedFacets': {}, 'limit': 20, 'offset': 20 * page, 'searchText': term}).encode()
            request = urllib.request.Request(f'{base}/wday/cxs/{tenant}/{site}/jobs', data=body, headers={
                'User-Agent': USER_AGENT, 'Content-Type': 'application/json', 'Accept': 'application/json'})
            fixtures = os.getenv('JOB_PILOTTO_FIXTURE_DIR')
            if fixtures:
                data = json.loads(_fixture(fixtures, request.full_url))
            else:
                with host_pace.open(request, TIMEOUT) as response:
                    data = json.loads(response.read())
            postings = data.get('jobPostings') or []
            if not term and page == 0:   # newest first: the same top and total as last time is the same list (src/sources/ats.py first_page)
                ats.first_page([j.get('externalPath') for j in postings], data.get('total'))
            for j in postings:
                path = j.get('externalPath') or ''
                if path in seen or not path:
                    continue
                seen.add(path)
                where = j.get('locationsText') or ''
                jobs.append(_job(path, j.get('title'), where, f'{base}/{site}{path}', '', '', 'remote' in where.lower()))
            if len(postings) < 20:
                break
    return jobs


def successfactors(slug):
    """SAP SuccessFactors career sites ("Recruiting Marketing", e.g. careers.swissre.com): every open job in the site's public feed for
    search engines, /sitemal.xml (RSS with Google Base fields: location, employer). Slug: the site's host name."""
    if not re.fullmatch(r'[a-z0-9-]+(\.[a-z0-9-]+)+', slug or ''):
        raise ValueError('not a SuccessFactors site')
    root = ET.fromstring(ats._get(f'https://{slug}/sitemal.xml'))
    base = '{http://base.google.com/ns/1.0}'
    jobs = []
    for item in root.iter('item'):
        title = item.findtext('title') or ''
        where = item.findtext(f'{base}location') or ''
        title = re.sub(r'\s*\(' + re.escape(where) + r'\)\s*$', '', title) if where else title   # "Client Manager (Kuala Lumpur, MY)"
        link = item.findtext('link') or ''
        jobs.append(_job(item.findtext(f'{base}id') or item.findtext('guid') or link, title, where, link, '',
                         plain(item.findtext('description')), 'remote' in where.lower()))
    return jobs


def umantis(slug):
    """Haufe Umantis (common with Swiss employers and cantons): the HTML job list of `slug.umantis.com`, then each job's page for its
    place and text (the list shows neither). Slug: `recruitingapp-1234`."""
    if not re.fullmatch(r'recruitingapp-\d{2,6}', slug):
        raise ValueError('not an Umantis slug')
    base = f'https://{slug}.umantis.com'
    markup = ats._get(f'{base}/Jobs/All').decode('utf-8', 'replace')
    found = []
    for path, label in re.findall(r'href="(/Vacancies/\d+/Description/\d+)"[^>]*?aria-label="([^"]*)"', markup):
        if path not in [p for p, _ in found]:
            found.append((path, html.unescape(label)))
    from . import careers as page

    def one(item):
        path, title = item
        try:
            job = page.job_from_page(ats._get(base + path).decode('utf-8', 'replace'), base + path)
        except (urllib.error.URLError, OSError, ValueError):
            job = None
        return _job(path.split('/')[2], title, (job or {}).get('location', ''), base + path, '', (job or {}).get('description', ''),
                    bool(job and job['remote']))
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(one, found[:40]))


def careers(slug):
    """A company's own careers page (no job system behind it): see careers.py."""
    from . import careers as page
    return page.fetch(slug)


# Company career sites with a public JSON search (no standard ATS). Queried per role and place,
# because they list tens of thousands of jobs.
# What to search for and where comes from the user's Strategy (config/search.json: roles, and the places they target),
# not from one example profile: change the roles or places in Notion and the next crawl asks for those.
MAX_ROLES, MAX_PLACES = 4, 6   # each role x place is one request to a site that lists tens of thousands of jobs


def _strategy_terms():
    from ..notion.search_settings import terms
    from ..paths import load_search_config
    config = load_search_config()
    places = config.get('locations') or {}
    # Places abroad and whole countries first, a city only when there is nothing wider (a country's search covers its cities).
    where = terms([*(places.get('abroad') or []), *(places.get('country_wide') or [])]) or terms(places.get('top_tier'))
    return tuple(terms(config.get('role_keywords')))[:MAX_ROLES], tuple(p.title() for p in where)[:MAX_PLACES]


def search_roles():
    return _strategy_terms()[0]


def search_places():
    return _strategy_terms()[1]


def amazon(slug='amazon'):
    from datetime import datetime
    seen, jobs = set(), []
    for role in search_roles():
        for place in search_places():
            query = urllib.parse.urlencode({'base_query': role, 'loc_query': place, 'result_limit': 100})
            for j in ats._json(f'https://www.amazon.jobs/en/search.json?{query}').get('jobs', []):
                if j['id_icims'] in seen:
                    continue
                seen.add(j['id_icims'])
                try:
                    posted = datetime.strptime(j.get('posted_date', ''), '%B %d, %Y').date().isoformat()
                except ValueError:
                    posted = ''
                description = plain(' '.join(j.get(k) or '' for k in
                                             ('description', 'basic_qualifications', 'preferred_qualifications')))
                jobs.append(_job(j['id_icims'], j.get('title'), j.get('normalized_location') or j.get('city', ''),
                                 'https://www.amazon.jobs' + j['job_path'], posted, description))
    return jobs


def netflix(slug='netflix'):
    from datetime import datetime, timezone
    seen, jobs = set(), []
    for role in search_roles():
        query = urllib.parse.urlencode({'domain': 'netflix.com', 'query': role, 'num': 100})
        for j in ats._json(f'https://explore.jobs.netflix.net/api/apply/v2/jobs?{query}').get('positions', []):
            if j['id'] in seen:
                continue
            seen.add(j['id'])
            posted = (datetime.fromtimestamp(int(j['t_create']), timezone.utc).date().isoformat()
                      if j.get('t_create') else '')
            locations = '; '.join(j.get('locations') or [j.get('location', '')])
            jobs.append(_job(j['id'], j.get('name'), locations, j['canonicalPositionUrl'], posted,
                             plain(j.get('job_description')), 'remote' in locations.lower()))
    return jobs


from . import ats  # noqa: E402  (at the end: ats imports this file back, so importing this file first works too)
from . import host_pace  # noqa: E402
from .ats import _fixture, _job, plain, USER_AGENT, TIMEOUT  # noqa: E402  (at the end: ats imports this file back, so importing this file first works too)
