#!/usr/bin/env python3
"""Public job feeds of common applicant-tracking systems, normalised to one shape.

Every fetcher returns a list of dicts with: id, title, location, url, date_posted,
description (plain text, may be ''), remote (bool), salary (str, may be '').
Only documented public endpoints are used; they need no login.
"""
import functools
import html
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from . import host_pace, posting_text
from .ats_conditional import HEAD, Unchanged, conditional, conditional_state, first_page  # noqa: F401  (re-exported: ats.Unchanged, ats.first_page)

USER_AGENT = 'JobPilotto/0.1 (personal job search; contact via GitHub GarryOne/jobadabra)'
TIMEOUT = 20
DESCRIPTION_LIMIT = 12000


def _fixture(folder, url):
    """JOB_PILOTTO_FIXTURE_DIR (the end-to-end journey, desktop/e2e): a feed is read from <folder>/routes.json -> file instead of the network,
    so the test is the same every day. A URL with no route fails like an unreachable feed; nothing leaves the computer."""
    routes = json.loads((Path(folder) / 'routes.json').read_text())
    for part, name in routes.items():
        if part in url:
            return (Path(folder) / name).read_bytes()
    raise OSError(f'no fixture for {url}')


def _get(url):
    fixtures = os.getenv('JOB_PILOTTO_FIXTURE_DIR')
    if fixtures:
        return _fixture(fixtures, url)
    state = conditional_state()
    first = state is not None and state.pages == 0
    if state is not None:
        state.pages += 1
    headers = {'User-Agent': USER_AGENT, 'Accept': 'application/json, text/xml'}
    if first and state.ask and not state.ask.startswith(HEAD):
        headers['If-None-Match'] = state.ask
    request = urllib.request.Request(url, headers=headers)
    try:
        with host_pace.open(request, TIMEOUT) as response:
            if first:
                state.etag = response.headers.get('ETag')
            return response.read()
    except urllib.error.HTTPError as error:
        if error.code == 304 and first and state.ask and not state.ask.startswith(HEAD):
            raise Unchanged(url) from None
        raise


def _json(url):
    return json.loads(_get(url))


def plain(markup):
    """HTML (possibly escaped twice) to text that keeps its headings, paragraphs and list items (src/sources/posting_text.py)."""
    return posting_text.html_to_text(markup, DESCRIPTION_LIMIT)


def _job(id, title, location, url, date_posted='', description='', remote=False, salary=''):
    return {'id': str(id), 'title': (title or '').strip(), 'location': (location or '').strip(),
            'url': url, 'date_posted': date_posted or '', 'description': description or '',
            'remote': bool(remote), 'salary': salary or ''}


def greenhouse(slug):
    data = _json(f'https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true')
    return [_job(j['id'], j['title'], (j.get('location') or {}).get('name', ''), j['absolute_url'],
                 j.get('first_published') or j.get('updated_at', ''), plain(j.get('content')),
                 'remote' in ((j.get('location') or {}).get('name', '')).lower())
            for j in data['jobs']]


def lever(slug):
    data = _json(f'https://api.lever.co/v0/postings/{slug}?mode=json')
    jobs = []
    for j in data:
        categories = j.get('categories') or {}
        created = j.get('createdAt')
        posted = ''
        if created:
            from datetime import datetime, timezone
            posted = datetime.fromtimestamp(int(created) / 1000, timezone.utc).isoformat(timespec='seconds')
        salary = j.get('salaryRange') or {}
        salary_text = (f"{salary.get('currency', '')} {salary.get('min', '')}–{salary.get('max', '')}".strip()
                       if salary.get('min') else '')
        jobs.append(_job(j['id'], j.get('text'), categories.get('location', ''), j['hostedUrl'], posted,
                         (j.get('descriptionPlain') or '')[:DESCRIPTION_LIMIT],
                         (j.get('workplaceType') or '').lower() == 'remote', salary_text))
    return jobs


def ashby(slug):
    data = _json(f'https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true')
    jobs = []
    for j in data.get('jobs', []):
        if j.get('isListed') is False:
            continue
        compensation = j.get('compensation') or {}
        salary = (compensation.get('scrapeableCompensationSalarySummary')
                  or compensation.get('compensationTierSummary') or '')
        locations = [j.get('location') or ''] + [s.get('location', '') for s in j.get('secondaryLocations') or []]
        jobs.append(_job(j['id'], j.get('title'), '; '.join(l for l in locations if l), j['jobUrl'],
                         j.get('publishedAt', ''), (j.get('descriptionPlain') or '')[:DESCRIPTION_LIMIT],
                         j.get('isRemote') or (j.get('workplaceType') or '').lower() == 'remote',
                         salary if j.get('shouldDisplayCompensationOnJobPostings', True) else ''))
    return jobs


def smartrecruiters(slug):
    jobs, offset = [], 0
    while True:
        data = _json(f'https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100&offset={offset}')
        for j in data.get('content', []):
            location = j.get('location') or {}
            where = ', '.join(p for p in (location.get('city'), location.get('country')) if p)
            jobs.append(_job(j['id'], j.get('name'), where, f"https://jobs.smartrecruiters.com/{slug}/{j['id']}",
                             j.get('releasedDate', ''), '', location.get('remote')))
        offset += 100
        if offset >= data.get('totalFound', 0) or offset >= 1000:
            return jobs


# Its postings list has no description: each posting's details are fetched for the jobs that pass the filters
# (feeds.scan), so stage 1 and the fit score can read them (without it, SmartRecruiters jobs stayed unscored).
def smartrecruiters_detail(slug, job_id):
    data = _json(f'https://api.smartrecruiters.com/v1/companies/{slug}/postings/{job_id}')
    sections = (data.get('jobAd') or {}).get('sections') or {}
    parts = [plain((sections.get(key) or {}).get('text')) for key in
             ('jobDescription', 'qualifications', 'additionalInformation', 'companyDescription')]
    return '\n\n'.join(part for part in parts if part)[:DESCRIPTION_LIMIT]


def workable(slug):
    data = _json(f'https://apply.workable.com/api/v1/widget/accounts/{slug}')
    jobs = []
    for j in data.get('jobs', []):
        where = ', '.join(p for p in (j.get('city'), j.get('country')) if p)
        jobs.append(_job(j.get('shortcode'), j.get('title'), where, j.get('url') or j.get('shortlink'),
                         j.get('published_on', ''), '', j.get('telecommuting')))
    return jobs


def recruitee(slug):
    data = _json(f'https://{slug}.recruitee.com/api/offers/')
    return [_job(j['id'], j.get('title'), j.get('location', ''), j.get('careers_url'), j.get('published_at', ''),
                 plain(j.get('description')), j.get('remote')) for j in data.get('offers', [])]


def personio(slug):
    root = ET.fromstring(_get(f'https://{slug}.jobs.personio.de/xml'))
    jobs = []
    for p in root.findall('position'):
        offices = [p.findtext('office') or ''] + [o.text or '' for o in p.findall('additionalOffices/office')]
        description = ' '.join(plain(d.findtext('value')) for d in p.findall('jobDescriptions/jobDescription'))
        jobs.append(_job(p.findtext('id'), p.findtext('name'), '; '.join(o for o in offices if o),
                         f"https://{slug}.jobs.personio.de/job/{p.findtext('id')}", p.findtext('createdAt') or '',
                         description[:DESCRIPTION_LIMIT], 'remote' in ' '.join(offices).lower()))
    return jobs


def teamtailor(slug):
    """Teamtailor's public RSS feed of a company's open jobs. The slug is the company's name on teamtailor.com, or its own careers address
    ("jobs.tamedia.ch"): many companies serve the same feed from their own domain, and the made-up name in the page's scripts is not theirs."""
    if '.' in slug:
        from . import careers
        if not re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)+', slug) or not careers._public(slug):
            raise ValueError('not a public Teamtailor careers address')
        url = f'https://{slug}/jobs.rss'
    else:
        url = f'https://{slug}.teamtailor.com/jobs.rss'
    root = ET.fromstring(_get(url))
    ns = {'tt': 'https://teamtailor.com/locations'}
    jobs = []
    for item in root.iter('item'):
        places = []
        for place in item.findall('tt:locations/tt:location', ns):
            where = ', '.join(part for part in (place.findtext('tt:city', default='', namespaces=ns), place.findtext('tt:country', default='', namespaces=ns)) if part)
            if where:
                places.append(where)
        remote = (item.findtext('remoteStatus') or '').lower() in ('fully', 'hybrid')
        link = item.findtext('link') or ''
        jobs.append(_job(item.findtext('guid') or link, item.findtext('title'), '; '.join(places) or ('Remote' if remote else ''), link,
                         item.findtext('pubDate') or '', plain(item.findtext('description')), remote))
    return jobs


def join(slug):
    """JOIN (join.com): the company page carries its jobs in the page data, a few per page."""
    jobs, page = [], 1
    while page <= 20:
        markup = _get(f'https://join.com/companies/{slug}?page={page}').decode('utf-8', 'replace')
        found = re.search(r'__NEXT_DATA__[^>]*>(.*?)</script>', markup, re.S)
        state = json.loads(found.group(1))['props']['pageProps']['initialState']['jobs'] if found else {}
        for j in state.get('items') or []:
            city = j.get('city') or {}
            where = ', '.join(part for part in (city.get('cityName'), city.get('countryName')) if part)
            remote = (j.get('workplaceType') or '').upper() == 'REMOTE' or bool(j.get('remoteType'))
            jobs.append(_job(j.get('id'), j.get('title'), where, f"https://join.com/companies/{slug}/{j.get('idParam')}",
                             str(j.get('createdAt') or '')[:10], '', remote))
        if page >= int((state.get('pagination') or {}).get('pageCount') or 1):
            break
        page += 1
    return jobs


# The feeds below live in their own files (pure move); they read `_get`/`_json`/`_job`/`plain` above, so they are imported here, after those.
from .ats_sites import (WORKDAY_PAGES, WORKDAY_ALL_PAGES, WORKDAY_MAX_TERMS, workday_terms, _split_workday, workday, successfactors,  # noqa: E402,F401
                        umantis, careers, MAX_ROLES, MAX_PLACES, _strategy_terms, search_roles, search_places, amazon, netflix)
from .ats_oracle import (ORACLE_ALL_PAGE, ORACLE_ALL_PAGES, ORACLE_TERM_PAGE, split_oracle, oracle_base, oracle)  # noqa: E402,F401
from .ats_phenom import (PHENOM_PAGE, PHENOM_ALL_PAGES, PHENOM_TERM_PAGES, phenom_site, phenom)  # noqa: E402,F401
from .ats_eightfold import (EIGHTFOLD_STEP, EIGHTFOLD_ALL_PAGES, EIGHTFOLD_TERM_PAGES, eightfold_site, eightfold)  # noqa: E402,F401
from .ats_slugs import slug_ok  # noqa: E402,F401
from .ats_jobsch import (JOBSCH_PAGES, JOBSCH_COMPANY, jobsch_company, _postings, _unescape, jobsch_towns, jobsch_find, jobsch)  # noqa: E402,F401


# Boards whose list has no description, and how to fetch one posting's (ats -> fn(slug, job_id) -> text).
DETAILS = {'smartrecruiters': smartrecruiters_detail}
FETCHERS = {'greenhouse': greenhouse, 'lever': lever, 'ashby': ashby, 'smartrecruiters': smartrecruiters,
            'workable': workable, 'recruitee': recruitee, 'personio': personio,
            'teamtailor': teamtailor, 'join': join, 'workday': workday, 'umantis': umantis, 'successfactors': successfactors, 'oracle': oracle, 'phenom': phenom, 'eightfold': eightfold, 'careers': careers,
            'amazon': amazon, 'netflix': netflix, 'jobsch': jobsch, 'visit': lambda slug: _visit(slug)}


LOCAL_ONLY = {'visit'}   # feed types that live on one install only: never published, shared or sent to the website


def _visit(slug):
    """The jobs read on a page a person opened and sent through the extension (src/sources/visits.py): nothing is fetched here."""
    from . import visits
    return visits.fetch(slug)
# Standard systems a company slug can be guessed for; company sites are listed explicitly.
GUESSABLE = ('greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'personio', 'smartrecruiters', 'teamtailor', 'join')

# Hosts that reveal an ATS and its board slug inside a careers or job URL.
URL_PATTERNS = [
    # embed/job_board and embed/job_app are the same board: the job id is the token, not the path.
    ('greenhouse', r'(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/(?:embed/job_(?:board|app)\?for=)?([\w-]+)'),
    ('greenhouse', r'boards-api\.greenhouse\.io/v1/boards/([\w-]+)'),
    ('lever', r'jobs\.(?:eu\.)?lever\.co/([\w-]+)'),
    ('ashby', r'jobs\.ashbyhq\.com/([\w.-]+)'),
    ('smartrecruiters', r'(?:jobs|careers)\.smartrecruiters\.com/([\w-]+)'),
    ('workable', r'apply\.workable\.com/([\w-]+)'),
    ('recruitee', r'([\w-]+)\.recruitee\.com'),
    ('personio', r'([\w-]+)\.jobs\.personio\.(?:de|com)'),
    ('teamtailor', r'([\w-]+)\.teamtailor\.com'),
    ('join', r'join\.com/companies/([\w-]+)'),
    ('umantis', r'(recruitingapp-\d{2,6})\.umantis\.com'),
    ('workday', r'([\w-]+)\.(wd\d{1,2})\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([\w-]+)'),
    # Oracle Recruiting Cloud: tenant, region and site number, written `tenant.region.SITE` (src/sources/ats_oracle.py)
    ('oracle', r'([\w-]+)\.fa\.([a-z0-9]{2,8})\.oraclecloud\.com/hcmUI/CandidateExperience/(?:[a-z]{2}(?:[-_][A-Za-z]{2})?/)?sites/([\w-]+)'),
]
IGNORED_SLUGS = {'embed', 'j', 'api', 'v1', 'jobs', 'careers', 'www', 'o', 'career', 'app', 'support', 'help', 'blog', 'static', 'tt', 'assets', 'scripts', 'cdn'}


def detect(url):
    """(ats, slug) found in a URL, or None."""
    for name, pattern in URL_PATTERNS:
        match = re.search(pattern, url or '', re.I)
        if match and match.group(1).lower() not in IGNORED_SLUGS:
            # Workday's board is three parts (tenant, cluster, site), written `tenant.wdN.Site`: letters, digits and dots only.
            return name, '.'.join(match.groups()) if name in ('workday', 'oracle') else match.group(1)
    return None


LEGAL_FORM = r'ag|sa|gmbh|ltd|limited|inc|llc|plc|se'
BRAND_WORD = r'group|holding|technologies|technology|labs'   # often part of the board's name too: Wynd Labs is ashby/wynd-labs


def name_slugs(company):
    """The slugs that spell the whole company name, legal form left out, brand words without then with:
    'Digitec Galaxus AG' -> digitecgalaxus, digitec-galaxus; 'Wynd Labs' -> wynd, wyndlabs, wynd-labs."""
    def spelled(drop):
        words = re.findall(r'[a-z0-9]+', re.sub(rf'\b({drop})\b\.?', '', company.lower()).replace('&', ' and '))
        return [''.join(words), '-'.join(words)] if words else []
    guesses = [*spelled(f'{LEGAL_FORM}|{BRAND_WORD}'), *spelled(LEGAL_FORM)]
    return list(dict.fromkeys(g for g in guesses if len(g) >= 3))


def slug_guesses(company):
    """Likely board slugs for a company name: the whole name (name_slugs), then its first word alone:
    'Digitec Galaxus AG' -> digitecgalaxus, digitec-galaxus, digitec."""
    first = re.findall(r'[a-z0-9]+', re.sub(rf'\b({LEGAL_FORM}|{BRAND_WORD})\b\.?', '', company.lower()))[:1]
    return list(dict.fromkeys([*name_slugs(company), *(w for w in first if len(w) >= 3)]))


def domain_guesses(website):
    """Likely board slugs from a company's web address: 'https://www.acme-tech.ch/en' -> acme-tech, acmetech, acme."""
    host = urllib.parse.urlsplit(website if '//' in (website or '') else f'//{website or ""}').hostname or ''
    labels = [label for label in host.lower().split('.') if label and label != 'www']
    if len(labels) < 2:
        return []
    name = labels[-2] if labels[-2] not in ('co', 'com', 'org', 'net') or len(labels) < 3 else labels[-3]
    words = [w for w in re.split(r'[^a-z0-9]+', name) if w]
    guesses = [name, ''.join(words), '-'.join(words), f'{name}-{labels[-1]}']
    return list(dict.fromkeys(g for g in guesses if len(g) >= 3))


def fetch(ats, slug):
    """Jobs from one feed; raises on network/format errors."""
    return FETCHERS[ats](slug)


@functools.lru_cache(maxsize=64)
def _board(ats, slug):
    """One board's jobs, fetched once per process (liveness checks for many jobs on one board)."""
    return tuple(fetch(ats, slug))


def _wanted(url):
    """The job id a board URL points at. A Greenhouse embed puts it in token or gh_jid; other links use the
    last path segment, which is also how a crawled row's URL is matched."""
    if 'greenhouse.io' in (url or ''):
        match = re.search(r'[?&](?:token|gh_jid)=(\d+)', url)
        if match:
            return match.group(1).lower()
    return (url or '').split('?')[0].rstrip('/').rsplit('/', 1)[-1].lower()


def _same_job(job, wanted):
    return job['id'].lower() == wanted or job['url'].split('?')[0].rstrip('/').rsplit('/', 1)[-1].lower() == wanted


def posting(url):
    """One posting fetched live from its job board by URL, or None when the board isn't supported or
    the posting is gone. Lets kit drafting and apply marking work for tracked jobs the crawl no
    longer holds (its SQLite is a cache; Notion keeps every tracked job)."""
    found = detect(url)
    if not found:
        return None
    wanted = _wanted(url)
    try:
        jobs = _board(*found)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, KeyError, ET.ParseError,
            json.JSONDecodeError, OSError):
        return None
    return next((job for job in jobs if _same_job(job, wanted)), None)


def _own_domain_board(url, company):
    """(ats, slug, job id) for a Greenhouse posting on the employer's own site ("n26.com/…?gh_jid=123"), found from the
    company name; only a board whose postings link back to that same site counts, so a guessed slug of another
    company can never say a job is gone. None when there's no such board."""
    jid = re.search(r'[?&]gh_jid=(\d+)', url or '')
    host = urllib.parse.urlsplit(url or '').hostname or ''
    if not jid or not host or not company:
        return None
    for slug in slug_guesses(company):
        try:
            jobs = _board('greenhouse', slug)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, KeyError,
                json.JSONDecodeError, OSError):
            continue
        if any(urllib.parse.urlsplit(job['url']).hostname == host for job in jobs):
            return 'greenhouse', slug, jid.group(1)
    return None


def is_live(url, company=''):
    """True if the posting is still on its job board, False if the board no longer lists it,
    None when we can't tell (unsupported board, or the board didn't answer). A Greenhouse posting on the
    employer's own site is checked on that employer's board when `company` is given."""
    found = detect(url)
    wanted = _wanted(url) if found else None
    if not found:
        own = _own_domain_board(url, company)
        if not own:
            return None
        found, wanted = own[:2], own[2]
    try:
        jobs = _board(*found)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, KeyError, ET.ParseError,
            json.JSONDecodeError, OSError):
        return None
    if not jobs:
        return None  # an empty board is more likely an outage than every job closing at once
    return any(_same_job(job, wanted) for job in jobs)


def probe(ats, slug):
    """Jobs if this (ats, slug) is a live board with at least one posting, else None."""
    try:
        jobs = fetch(ats, slug)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, KeyError, ET.ParseError,
            json.JSONDecodeError, OSError):
        return None
    return jobs or None
