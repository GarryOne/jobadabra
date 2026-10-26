"""A company's own careers page, for employers with no job-system feed (Greenhouse, Lever, ...).

The scout uses it on a company website: find the careers link, see whether an ATS is embedded (then its feed is used), else read the jobs
the page itself publishes as schema.org JobPosting data (JSON-LD), on the listing page or on the job pages it links to. Public pages only,
fetched like a browser would, no login, no workaround for a site that refuses (a 403 is an answer). The result is a normal feed:
ats 'careers', slug = the page address written with word characters only (`encode`), so it travels through the employer index unchanged.
"""
import html
import ipaddress
import json
import os
import re
import time
import socket
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from . import ats, host_pace

MAX_BYTES = 2_000_000
from ..ai import meanings_pack
from .careers_parse import (MAX_JOB_PAGES, CAREER_WORDS, JOB_PATH, JOB_ID, COUNTRIES, AGGREGATORS, own_site, encode, decode, links,  # noqa: F401
                            NO_JOBS, STRONG_WORDS, JOB_HOST, NOT_JOBS, registrable, careers_links, _walk, _words, jsonld_jobs, job_links,
                            MAX_LIST_PAGES, PAGE_PAUSE_S, page_links)
# ---------- fetching ----------

def _public(host):
    """False for an address that leads to this computer or a private network: a catalog entry must never make a run reach those."""
    if os.getenv('JOB_PILOTTO_FIXTURE_DIR'):
        return True
    try:
        for family, _, _, _, address in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(address[0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
    except (OSError, ValueError):
        return False
    return True


def get_text(url):
    """The page's HTML, or raises. Only http(s) to public hosts."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname or not _public(parts.hostname):
        raise ValueError('not a public web address')
    fixtures = os.getenv('JOB_PILOTTO_FIXTURE_DIR')
    if fixtures:
        return ats._fixture(fixtures, url).decode('utf-8', 'replace')
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT, 'Accept': 'text/html,application/xhtml+xml'})
    with host_pace.open(request, ats.TIMEOUT) as response:
        return response.read(MAX_BYTES).decode(response.headers.get_content_charset() or 'utf-8', 'replace')


# ---------- reading a page ----------

def embedded_system(markup):
    """(ats, slug) of the first job system the page links or embeds, or None. A Teamtailor careers site on the company's own domain
    ("jobs.tamedia.ch") is read from that address: its feed is there, and the name in Teamtailor's scripts is not the company's."""
    found = None
    for url in re.findall(r'https?:(?:\\?/){2}[^\s"\'<>\\)]+', markup):
        found = ats.detect(url)
        if found:
            break
    if (not found or found[0] == 'teamtailor') and 'teamtailor' in markup.lower():
        own = re.search(r'https?:(?:\\?/){2}([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\\?/)jobs\.rss', markup, re.I)
        if own and _public(own.group(1).lower()):
            return 'teamtailor', own.group(1).lower()
    return found



def _places():
    """Your places as one pattern (config/search.json), to find where a job page says the job is."""
    from ..paths import keyword_regex, load_search_config, place_regex
    groups = (load_search_config().get('locations') or {})
    return place_regex([*groups.get('top_tier', []), *groups.get('country_wide', []), *groups.get('abroad', [])] or [r'(?!x)x'])


def job_from_page(markup, url):
    """A job from a page with no job data: the main heading is the title, the page text the description, the place is any of your places
    the text names. Rough on purpose: read_page_from asks the AI whether the page is one posting (one_posting.py; the title filter alone kept a
    board's "3,531 Assistant Psychology jobs" category, 26 Oct 2026), and the crawl's title filter keeps only the roles you look for."""
    heading = re.search(r'<h1[^>]*>(.*?)</h1>', markup, re.S | re.I)
    title = ats.plain(heading.group(1) if heading else (re.search(r'<title[^>]*>(.*?)</title>', markup, re.S | re.I) or [None, ''])[1])
    title = re.split(r'\s+[|\u2013\u2014-]\s+', title)[0].strip()
    if not 4 <= len(title) <= 120:
        return None
    body = re.sub(r'<(script|style|noscript|nav|header|footer)\b.*?</\1>', ' ', markup, flags=re.S | re.I)
    text = ats.plain(body)
    found = []
    for match in _places().finditer(text[:6000]):
        word = match.group(0).strip().title()
        if word not in found:
            found.append(word)
    return ats._job(url, title, ', '.join(found[:3]), url, '', text, bool(re.search(r'\bremote\b|home.?office', text[:3000], re.I)))


def read_page(url, fetch=None):
    """Jobs a careers page publishes: its own data, or the data of the job pages it links to. Raises when the page cannot be read."""
    fetch = fetch or get_text   # looked up when called: a test's or a run's own fetcher applies
    markup = fetch(url)
    jobs = jsonld_jobs(markup, url) or read_page_from(markup, url, fetch)
    return _asked(url, markup, jobs, fetch)


def fetch(slug, sleep=time.sleep):
    """The ats 'careers' feed: the jobs on the page this slug stands for, and on its numbered pages; read again through the browser when the
    plain page has none."""
    url = decode(slug)
    jobs = read_page(url)
    show = renderer() if not jobs else None
    jobs = read_page(url, show) if show else jobs
    if not jobs:
        return jobs
    try:
        more = page_links(url, get_text(url))
    except Exception:  # noqa: BLE001 — the first page is read; its page links are a bonus
        more = []
    seen = {job.get('url') for job in jobs}
    for link in more:
        sleep(PAGE_PAUSE_S)
        try:
            fresh = [job for job in read_page(link, show) if job.get("url") not in seen]
        except Exception:  # noqa: BLE001 — a page that fails ends the list here
            break
        if not fresh:
            break
        seen.update(job.get('url') for job in fresh)
        jobs = jobs + fresh
    return jobs


READER = 'auto'   # 'auto': Claude reads pages the rules cannot (ai/page_reader.py) when an AI is available; None: never; or a function (url, html) -> jobs (tests)


def reader():
    if READER != 'auto':
        return READER
    if os.getenv('JOB_PILOTTO_FIXTURE_DIR'):
        return None
    from ..ai import page_reader
    return page_reader.read if page_reader.usable() else None


# A job title, in any of the usual languages, as opposed to a menu entry ("About us", "Benefits"): a role noun or a workload/gender mark.
TITLE_LIKE = meanings_pack.matcher('page-words', 'job_title')   # the meanings pack: the old list (seed) + rows the site adds


# Headings of career pages themselves, not jobs: "Search Swiss Re Careers", "Early talent opportunities", "Life at Acme", "Students".
NOT_A_JOB = meanings_pack.matcher('page-words', 'not_a_job')   # the meanings pack: the old list (seed) + rows the site adds


def _heading(title):
    """A career page's own heading or menu entry, never a job: it uses those words and has no role noun. "Senior Search Engineer",
    "Site Reliability Engineer, Europe" and "Graduate Software Engineer" are jobs (#110, 3 Oct 2026: NOT_A_JOB alone dropped them)."""
    return bool(NOT_A_JOB.search(title)) and not TITLE_LIKE.search(title)


def _plausible(jobs):
    """Rules found jobs: do they look like job titles (or roles you look for)? If not, the links were probably menu entries."""
    jobs = [job for job in jobs if not _heading(job['title'])]
    if not jobs:
        return False
    from ..ai import page_reader
    return page_reader.plausible(jobs) or sum(1 for job in jobs if TITLE_LIKE.search(job['title'])) >= max(1, len(jobs) // 2)


def _from_recipe(url, markup, fetch_page):
    """Jobs read by a recipe learned for this page (page_recipes.py), or []: no model call."""
    from . import page_recipes
    recipe = page_recipes.load(url)
    items = page_recipes.replay(recipe, markup, url) if recipe else []
    if recipe and not items:
        page_recipes.mark_broken(url)   # the page changed: flag it; the page is read the usual way and a new read learns a new recipe
    if not items:
        return []
    listing = job_from_page(markup, url) or {}

    def one(item):
        title, link = item
        found = None
        if link:
            try:
                found = jsonld_jobs(fetch_page(link), link)[:1] or [job_from_page(fetch_page(link), link)]
            except Exception:  # noqa: BLE001
                found = None
        job = (found or [None])[0] or {}
        return ats._job(link or f'{url}#{title}', title, job.get('location') or listing.get('location', ''), link or url,
                        job.get('date_posted', ''), job.get('description', ''), bool(job.get('remote')))
    with ThreadPoolExecutor(max_workers=6) as pool:
        return list(pool.map(one, items[:40]))


def _asked(url, markup, jobs, fetch_page=None, careers_page=False):
    """Rules' jobs when they look like jobs; else a recipe learned earlier (no AI); else, when a model can read the page, its answer,
    and a recipe derived from that answer so the next read needs no model."""
    jobs = [job for job in jobs if not _heading(job['title'])]   # career-page headings are never jobs
    if _plausible(jobs):
        return jobs
    fetch_page = fetch_page or get_text
    replayed = _from_recipe(url, markup, fetch_page)
    if replayed:
        return replayed
    # What the rules found does not look like job titles (menu entries, "About us"): not a list of jobs. Without a model to read the page,
    # nothing is taken from it, and the scout goes on to the page's own links (the real job site is often one link further).
    read = reader()
    if not read:
        return []
    answer = read(url, markup, careers_page=True) if careers_page and READER == 'auto' else read(url, markup)
    if answer is None:
        return []
    if answer and READER == 'auto':   # a real model answered: learn how to read this page without it
        from . import page_recipes
        recipe = page_recipes.derive(markup, url, answer)
        if recipe:
            page_recipes.save(url, recipe)
    return answer


CHOOSER = 'auto'   # 'auto': a model picks the job-list link on a home page the rules cannot read (ai/page_reader.py); None: never; or a function (tests)


def chooser():
    if CHOOSER != 'auto':
        return CHOOSER
    if os.getenv('JOB_PILOTTO_FIXTURE_DIR'):
        return None
    from ..ai import page_reader
    return page_reader.choose_links if page_reader.usable() else None


RENDER = 'auto'   # 'auto': the headless browser (render.py) when Playwright is installed; None: never; or a function url -> html (tests)


def renderer():
    """The function that reads a page after its scripts ran, or None. Off with JOB_PILOTTO_RENDER=0 and in the end-to-end fixtures."""
    if RENDER != 'auto':
        return RENDER
    if os.getenv('JOB_PILOTTO_RENDER') == '0' or os.getenv('JOB_PILOTTO_FIXTURE_DIR'):
        return None
    from . import render
    return render.render if render.available() else None


REFUSALS = {}   # host -> why, for this run: a site that answered 401/403 or a bot check (a 429 is host_pace's "slow down") (the scout offers it as a site only you can open)


def note_refusal(url, error):
    code = getattr(error, 'code', None)
    why = f'HTTP {code}' if code in host_pace.REFUSED else (str(error) if type(error).__name__ == 'Refused' else '')
    if why:
        REFUSALS[(urllib.parse.urlsplit(url if '//' in url else f'https://{url}').hostname or '').lower().removeprefix('www.')] = why


def discover(website, fetch_page=get_text):
    """What a company website offers: {'ats', 'slug'} for an embedded job system, {'ats': 'careers', 'slug', 'jobs'} for a page with jobs,
    or None. Home page, the careers links on it, and one level deeper. A page that is only a shell (its jobs appear after scripts run) is
    read again through the browser when RENDER is set; a site that refuses is left alone."""
    if not own_site(website):
        return None
    website = website if '//' in website else f'https://{website}'
    try:
        home = fetch_page(website)
    except Exception as error:  # noqa: BLE001 — a site that is down or refuses is just "nothing found"
        note_refusal(website, error)
        return None
    # Only a link that looks like the careers link counts as the company's job system: a stray widget or partner link on the home page is not.
    show = renderer() if fetch_page is get_text else None
    found = _explore(website, home, fetch_page, show)
    if not found or found.get('empty'):   # nothing linked, or only an empty page: try the site map and the usual addresses too
        guessed = _explore(website, home, fetch_page, show, links=guessed_links(website, fetch_page), limit=20)
        if guessed and (not found or not guessed.get('empty')):
            found = guessed
    if (not found or found.get('empty')) and (choose := chooser()):   # a model reads the home page's links and picks the job list
        try:
            picked = choose(website, home)
        except Exception:  # noqa: BLE001 — no answer: nothing more to try
            picked = []
        chosen = _explore(website, home, fetch_page, show, links=picked) if picked else None
        if chosen and (not found or not chosen.get('empty')):
            found = chosen
    if found or show is None:
        return found
    try:
        shown = show(website)
    except Exception as error:  # noqa: BLE001 — refused, not allowed or no browser: nothing more to do
        note_refusal(website, error)
        return None
    return _explore(website, shown, show)


def read_page_from(markup, url, fetch_page):
    """read_page for a page already fetched: the data of the job pages it links to, or (a page of plain text) the pages' own headings, kept only
    when the AI judges the page one posting (src/sources/one_posting.py: a site's "About Us" or a "3,531 ... jobs" category is not)."""
    def one(link):
        try:
            page = fetch_page(link)
        except Exception:  # noqa: BLE001
            return [], []
        declared = jsonld_jobs(page, link)
        return (declared, []) if declared else ([], [job for job in [job_from_page(page, link)] if job])
    with ThreadPoolExecutor(max_workers=6) as pool:
        read = list(pool.map(one, job_links(markup, url)))
    from . import one_posting
    headed = list({job['url']: job for _, jobs in read for job in jobs}.values())
    postings = {job['url'] for job in one_posting.kept(headed, reader() is not None)}
    found = [job for declared, jobs in read for job in declared + [job for job in jobs if job['url'] in postings]]
    return list({job['url']: job for job in found}.values())



# Imported last: these look up READER, _asked, careers_links ... on this module when called.
from .careers_explore import (successfactors_site, _look, _shell, CAREER_SUBDOMAINS, SECOND_LEVEL, company_domain, COMMON_PATHS,  # noqa: E402,F401
                              guessed_links, _quiet, _says_no_jobs, _listed, _explore)
