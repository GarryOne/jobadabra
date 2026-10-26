"""Oracle Recruiting Cloud (Candidate Experience) career sites: the public job-search endpoint each site's own page calls, no login.

Hotels, hospitals, retailers and banks run their careers pages on it (a site lives at <tenant>.fa.<region>.oraclecloud.com, often behind the
employer's own domain). Slug: `tenant.region.SITE` (e.g. `efet.us2.CX_1`), the three parts of the site's address. Like Workday it lists thousands
of jobs, so the newest are read with no word, then each of the user's own search words (ats_sites.workday_terms).
Guarded by tests/test_ats_oracle.py.
"""
import re
import urllib.parse

ORACLE_ALL_PAGE = 100    # jobs a request returns (the endpoint's own page size)
ORACLE_ALL_PAGES = 2     # newest 200 with no word: what an employer hires for, not only what one user asks
ORACLE_TERM_PAGE = 50    # per search word, as Workday reads a word's first two pages
LOCATION_COUNTRY = re.compile(r'^[A-Z]{2}$')


def split_oracle(slug):
    """(tenant, region, site) of a slug, or ValueError."""
    parts = str(slug or '').split('.', 2)
    if len(parts) != 3 or not re.fullmatch(r'[a-z0-9-]+', parts[0]) or not re.fullmatch(r'[a-z0-9]{2,8}', parts[1]) or not re.fullmatch(r'[\w-]+', parts[2]):
        raise ValueError('not an Oracle Recruiting Cloud slug')
    return parts


def oracle_base(slug):
    tenant, region, _ = split_oracle(slug)
    return f'https://{tenant}.fa.{region}.oraclecloud.com'


def oracle(slug):
    """Jobs of one Oracle Recruiting Cloud career site (see the module note)."""
    tenant, region, site = split_oracle(slug)
    base = oracle_base(slug)
    jobs, seen = [], set()
    for term, size, pages in [('', ORACLE_ALL_PAGE, ORACLE_ALL_PAGES), *((term, ORACLE_TERM_PAGE, 1) for term in ats.workday_terms())]:
        for page in range(pages):
            finder = f'findReqs;siteNumber={site},limit={size},offset={size * page},sortBy=POSTING_DATES_DESC'
            if term:
                finder += f',keyword={urllib.parse.quote(term)}'
            data = ats._json(f'{base}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true'
                             f'&expand=requisitionList.secondaryLocations&finder={finder}')
            items = (data.get('items') or [{}])[0].get('requisitionList') or []
            if not term and page == 0:   # sorted newest first: the same top and total as last time is the same list
                ats.first_page([j.get('Id') for j in items], (data.get('items') or [{}])[0].get('TotalJobsCount'))
            for j in items:
                job_id = str(j.get('Id') or '')
                if not job_id or job_id in seen:
                    continue
                seen.add(job_id)
                where = j.get('PrimaryLocation') or ''
                jobs.append(_job(job_id, j.get('Title'), where, f'{base}/hcmUI/CandidateExperience/en/sites/{site}/job/{job_id}',
                                 j.get('PostedDate') or '', ats.plain(j.get('ShortDescriptionStr')),
                                 'remote' in (j.get('WorkplaceType') or '').lower()))
            if len(items) < size:
                break
    return jobs


from . import ats  # noqa: E402  (at the end: ats imports this file back, so importing this file first works too)
from .ats import _job  # noqa: E402
