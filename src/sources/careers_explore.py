"""Finding where a company's jobs are: guessed careers addresses, the careers links of a page explored one level deeper, and what each
page offers (a job system, a SuccessFactors site, or jobs of its own).

Split out of careers.py (pure move; careers.py re-exports it). careers.py imports and re-exports every name here and keeps
`discover`, the module state (READER, CHOOSER, RENDER, REFUSALS) and the fetchers; names that tests patch on `careers`
(careers_links, _asked, READER ...) are looked up on that module at call time. Guarded by tests/test_careers.py and test_discover.py.
"""
import re
import urllib.parse

from . import ats
from ..ai import page_words
from .careers_parse import JOB_ID, NO_JOBS, encode, job_links, jsonld_jobs, registrable


def successfactors_site(page, link):
    """The host of a SAP SuccessFactors career site ("Recruiting Marketing": its pages load from rmkcdn), whose /sitemal.xml lists every job."""
    host = urllib.parse.urlsplit(link).hostname or ''
    return host if re.search(r'rmkcdn\.successfactors\.com|rmk-map-\d|successfactors\.(?:eu|com)/career', page or '') and re.search(r'rmkcdn', page or '') else ''


def _look(page, link, fetch_page, careers_page=False):
    """What one careers page offers: {'ats', 'slug'}, {'ats': 'careers', 'jobs'} (slug added by the caller), or None."""
    found = careers.embedded_system(page)
    if found:
        return {'ats': found[0], 'slug': found[1]}
    site = successfactors_site(page, link)
    if site:
        return {'ats': 'successfactors', 'slug': site}
    site = ats.phenom_site(page)   # a Phenom career site (src/sources/ats_phenom.py): read through its own search, so its list is not read from the page
    if site:
        return {'ats': 'phenom', 'slug': site}
    site = ats.eightfold_site(page)   # an Eightfold career site (src/sources/ats_eightfold.py): read through its own search
    if site:
        return {'ats': 'eightfold', 'slug': site}
    jobs = jsonld_jobs(page, link) or careers.read_page_from(page, link, fetch_page)
    if len(jobs) == 1 and jobs[0]['url'].rstrip('/') == link.rstrip('/'):
        jobs = []   # that link is one job's page, not the list of jobs
    jobs = careers._asked(link, page, jobs, fetch_page, careers_page)
    return {'ats': 'careers', 'jobs': jobs} if jobs else None


def _shell(markup):
    """The page is mostly an empty frame that scripts fill in: little text, or a single-page-app marker."""
    text = re.sub(r'<[^>]+>', ' ', re.sub(r'<(script|style)\b.*?</\1>', ' ', markup, flags=re.S | re.I))
    return len(re.sub(r'\s+', ' ', text).strip()) < 800 or bool(re.search(r'id="(root|__next|app)"|__NEXT_DATA__|ng-version|data-reactroot', markup))


# A careers site on its own subdomain of the company's domain (jobs.ethz.ch), for a home page that does not link it. Only the company's own registrable domain; the page fetch refuses a
# private address like every other (get_text).
CAREER_SUBDOMAINS = ('jobs', 'karriere', 'careers', 'stellen', 'recruiting', 'jobportal')
# Domains whose last two labels are not a company's (acme.co.uk: the company is acme, not co.uk).
SECOND_LEVEL = {'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'org.au', 'co.nz', 'co.jp', 'com.br', 'co.za', 'com.cn', 'com.sg', 'co.in', 'com.mx', 'com.tr', 'com.ar'}


def company_domain(host):
    """The company's own domain of a host name: acme.ch for www.acme.ch, acme.co.uk for jobs.acme.co.uk; '' when the host has no company part (co.uk)."""
    labels = (host or '').lower().removeprefix('www.').split('.')
    take = 3 if '.'.join(labels[-2:]) in SECOND_LEVEL else 2
    return '.'.join(labels[-take:]) if len(labels) >= take else ''
COMMON_PATHS = ('/karriere', '/jobs', '/careers', '/stellen', '/offene-stellen', '/de/karriere', '/de/jobs', '/en/careers', '/en/jobs', '/fr/carrieres')


def guessed_links(website, fetch_page):
    """Where a careers page usually is, for a home page that links none: the site map's job-like addresses, then the common paths."""
    parts = urllib.parse.urlsplit(website)
    origin = f'{parts.scheme}://{parts.netloc}'
    found, strong = [], {}
    try:
        sitemap = fetch_page(f'{origin}/sitemap.xml')
        locations = re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', sitemap)
        if '<sitemapindex' in sitemap:   # an index of site maps: read the ones that sound like pages, at most two
            children = [loc for loc in locations if re.search(r'page|seite|job|career|karriere|post', loc, re.I)][:2] or locations[:1]
            locations = [loc for child in children for loc in re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', _quiet(fetch_page, child))]
        mine = [loc for loc in locations if registrable(urllib.parse.urlsplit(loc).hostname) == registrable(parts.hostname)]
        words = page_words.link_words(('', urllib.parse.urlsplit(loc).path) for loc in mine)
        for loc in mine:
            now = words[('', str(urllib.parse.urlsplit(loc).path or ''))]
            if now and (now.strong or now.weak) and not now.not_jobs:
                found.append(loc)
                strong[loc] = now.strong
    except Exception:  # noqa: BLE001 — no site map: the common paths are still tried
        pass
    found.sort(key=lambda loc: (not strong.get(loc), len(loc)))
    domain = company_domain(parts.hostname or '')
    subdomains = [f'{parts.scheme}://{name}.{domain}' for name in CAREER_SUBDOMAINS if domain and (parts.hostname or '') != f'{name}.{domain}']
    return list(dict.fromkeys(found[:4] + subdomains + [origin + path for path in COMMON_PATHS]))


def _quiet(fetch_page, url):
    try:
        return fetch_page(url)
    except Exception:  # noqa: BLE001
        return ''


def _says_no_jobs(markup, link=''):
    """The page says it has no open jobs, in any language: as the AI reader read it (kept per page; a page it has not read is not known to be
    empty). The four languages NO_JOBS knows answer only with no AI at all (audit PR 7, 26 Oct 2026)."""
    if link and careers.READER == 'auto':
        try:
            from ..ai import page_reader
            if page_reader.said_no_open_jobs(link):
                return True
        except Exception:  # noqa: BLE001 — no cache yet: as before
            pass
    if page_words.ai_on():
        return False
    return bool(NO_JOBS.search(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', markup))))


def _listed(page, url, result):
    """Whether what a page gave is a list of single jobs, not a careers menu: its job data, jobs a reader found, or at least 3 job links
    ending in a job id (a UUID, a long number). A menu is jobs that are all the page's own links, none with an id."""
    links = set(job_links(page, url))
    jobs = [job.get('url') for job in result.get('jobs') or []]
    if not jobs or jsonld_jobs(page, url) or not set(jobs) <= links:
        return True
    return sum(1 for link in jobs if JOB_ID.search(urllib.parse.urlsplit(link).path.rstrip('/'))) >= 3


def _explore(start, home, fetch_page, show=None, links=None, limit=8):
    """The careers links of a page, then (one level deeper) the job-list links of the best of them. A careers page that says it has no open
    jobs right now is remembered: when nothing better turns up it is the answer, to be watched ({'empty': True})."""
    seen, empty, weak = set(), None, None
    queue = [(link, 0) for link in (links if links is not None else careers.careers_links(home, start))]
    while queue and len(seen) < limit:
        link, depth = queue.pop(0)
        if link in seen:
            continue
        seen.add(link)
        found = ats.detect(link)
        if found:
            return {'ats': found[0], 'slug': found[1]}
        try:
            page = fetch_page(link)
        except Exception:  # noqa: BLE001
            continue
        result = _look(page, link, fetch_page, careers_page=True)
        if not result and show and _shell(page):   # the plain page is an empty frame: read this one page again after its scripts ran
            try:
                page = show(link)
                result = _look(page, link, show, careers_page=True)
            except Exception:  # noqa: BLE001 — refused or no browser: nothing more to do
                pass
        if result:
            if result['ats'] == 'careers':
                try:
                    result['slug'] = encode(link)
                except ValueError:
                    continue
                # A page whose "jobs" are links without a job id is a careers menu (7 Oct 2026: jobs.migros.ch's trainee, career-changer
                # pages; its 23 Geneva jobs were one link deeper, on "postes vacants"): kept only if nothing deeper lists real jobs.
                if not _listed(page, link, result):
                    weak = weak or result
                    if depth == 0:
                        queue += [(deeper, 1) for deeper in careers.careers_links(page, link) if deeper not in seen][:5]
                    continue
            return result
        if not empty and _says_no_jobs(page, link):
            empty = link
        if depth == 0:   # a general careers page: the list of jobs is usually one link further
            queue += [(deeper, 1) for deeper in careers.careers_links(page, link) if deeper not in seen][:3]
    if weak:
        return weak
    if empty:
        try:
            return {'ats': 'careers', 'slug': encode(empty), 'jobs': [], 'empty': True}
        except ValueError:
            return None
    return None


from . import careers  # noqa: E402  (at the end: careers imports this file back, so importing this file first works too)
