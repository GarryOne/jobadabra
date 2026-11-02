"""Phenom career sites (careers.dhl.com, careers.allianz.com...): the public search the site's own page sends to its `/widgets` address, no login.

Large retailers, logistics firms, insurers and pharma run their careers pages on it, always on the employer's own domain, so a site is found
from its page (`phenom_site`) and not from a link. Slug: the site's host name. The page names its reference (`refNum`) and its language path
(`/global/en`); the search is asked for the newest jobs, then for each of the user's own words (ats_sites.workday_terms), as Workday is.
Guarded by tests/test_ats_phenom.py.
"""
import json
import os
import re
import urllib.request

PHENOM_PAGE = 50     # jobs a request asks for
PHENOM_ALL_PAGES = 4  # newest 200 with no word
PHENOM_TERM_PAGES = 2


def phenom_site(page):
    """The host of a Phenom career site when `page` is one of its pages (it names the site's /widgets address), else ''."""
    match = re.search(r'"widgetApiEndpoint"\s*:\s*"https://([a-z0-9.-]+)/widgets"', page or '')
    return match.group(1).lower() if match and 'phenompeople' in page else ''


def _check(slug):
    if not re.fullmatch(r'[a-z0-9-]+(\.[a-z0-9-]+)+', slug or ''):
        raise ValueError('not a Phenom site')


def _post(url, body):
    """The JSON a widgets request answers (a fixture folder stands in for the network in the journey tests)."""
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers={
        'User-Agent': ats.USER_AGENT, 'Content-Type': 'application/json', 'Accept': 'application/json'})
    fixtures = os.getenv('JOBADABRA_FIXTURE_DIR')
    if fixtures:
        return json.loads(ats._fixture(fixtures, f'{url}?{body.get("keywords", "")}'))
    with host_pace.open(request, ats.TIMEOUT) as response:
        return json.loads(response.read())


def phenom(slug):
    """Jobs of one Phenom career site (see the module note)."""
    _check(slug)
    home = ats._get(f'https://{slug}/').decode('utf-8', 'replace')
    ref = re.search(r'"refNum"\s*:\s*"([^"]+)"', home)
    if not ref:
        raise ValueError('not a Phenom site')
    path = re.search(r'rel="canonical" href="https://[^/"]+/([a-z]{2,10})/([a-z]{2})(?:/|")', home)
    country, language = path.groups() if path else ('global', 'en')
    page = re.search(r'"pageId"\s*:\s*"([^"]+)"', home)
    jobs, seen = [], set()
    for term, pages in [('', PHENOM_ALL_PAGES), *((term, PHENOM_TERM_PAGES) for term in ats.workday_terms())]:
        for index in range(pages):
            body = {'lang': f'{language}_{country}', 'deviceType': 'desktop', 'country': country, 'pageName': 'search-results',
                    'ddoKey': 'refineSearch', 'sortBy': 'Most recent', 'subsearch': '', 'from': PHENOM_PAGE * index, 'jobs': True,
                    'counts': False, 'all_fields': [], 'size': PHENOM_PAGE, 'clearAll': False, 'jdsource': 'facets',
                    'isSliderEnable': False, 'pageId': page.group(1) if page else 'page12', 'siteType': 'external', 'keywords': term,
                    'global': True, 'selected_fields': {}, 'locationData': {}, 'refNum': ref.group(1)}
            found = ((_post(f'https://{slug}/widgets', body).get('refineSearch') or {}).get('data') or {}).get('jobs') or []
            for j in found:
                key = str(j.get('jobSeqNo') or j.get('jobId') or '')
                if not key or key in seen:
                    continue
                seen.add(key)
                where = j.get('location') or j.get('cityStateCountry') or ''
                jobs.append(_job(key, j.get('title'), where, f'https://{slug}/{country}/{language}/job/{key}',
                                 (j.get('postedDate') or '')[:10], ats.plain(j.get('descriptionTeaser')),
                                 'remote' in (j.get('workHours') or j.get('type') or '').lower()))
            if len(found) < PHENOM_PAGE:
                break
    return jobs


from . import ats, host_pace  # noqa: E402  (at the end: ats imports this file back, so importing this file first works too)
from .ats import _job  # noqa: E402
