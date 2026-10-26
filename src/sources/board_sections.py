"""A job board's own section for the user's kind of work, opened when its home or search page gave no relevant job (owner, 24 Oct 2026: a
Moldovan board's home page was news, its IT section listed 100 jobs in the city; Moldova's search found 5 local jobs). The section is picked by the AI
from the page's own links (meaning in any language and any kind of work, src/ai/decide.py), never a word list: each link is the 'best' field for this role, a 'near' one,
a 'hub' (all jobs, all categories: one more hop) or 'other'. Sections are read like any listing page (JobPosting data, else the AI page reader, which
leaves a recipe), at most MAX_SECTIONS per board, robots.txt is not consulted (owner, 26 Oct 2026). Tests: tests/test_board_sections.py."""
import urllib.parse

from . import board_pages, careers, careers_parse

DEPTH = 3       # pages of hubs followed down from the home page (a home page, its jobs hub, its categories hub)
MAX_SECTIONS = 2      # section pages read per board
MAX_HUBS = 2          # hub pages opened per page (a link to "all categories", then the sections on it)
MAX_LINKS = 80        # links of one page sent to the AI
MAX_LABEL = 70        # a longer link text is a sentence, not a section name
ANSWERS = ('best', 'near', 'hub', 'other')
TOPIC = 'board field link'
TASK = ('The user searches for jobs as "{role}". Each item is a link on a job board: its text and its address path. Answer "best" only for a link '
        "that opens the board's own category or field of exactly this kind of work (for a software engineer the board's IT / software / programming "
        'field, whatever the language): usually one link on a board, at most two. "near" if it opens a field that is close to it (engineering, web '
        'design, data, telecom). "hub" if it opens the board\'s list of all jobs or of all categories/fields. Else "other": every unrelated field '
        '(sales, food, building, finance, ...), news, employers, CV tools, log in, one job, a city only, a language.')


def candidates(markup, page_url):
    """[(address, text)] links of this page on the board's own site, one per path, with a short text, not the page itself."""
    host = careers_parse.registrable(urllib.parse.urlsplit(page_url).hostname or '')
    here = urllib.parse.urlsplit(page_url).path.rstrip('/')
    out, seen = [], set()
    for url, text in careers_parse.links(str(markup or ''), page_url):
        parts = urllib.parse.urlsplit(url)
        key = parts.path.rstrip('/')
        if (parts.scheme not in ('http', 'https') or careers_parse.registrable(parts.hostname or '') != host or key in seen or key == here
                or not text or len(text) > MAX_LABEL or key in ('', '/')):
            continue
        seen.add(key)
        out.append((url.split('#')[0], text))
    return out[:MAX_LINKS]


def pick(markup, page_url, role, decide):
    """([section addresses], [hub addresses]) the AI picked among the page's links; ([], []) with no AI answer (decide returns None)."""
    found = candidates(markup, page_url)
    if not found or not role:
        return [], []
    items = {f'{role}|{text}|{urllib.parse.urlsplit(url).path}': f'Link text: {text}\nPath: {urllib.parse.urlsplit(url).path}' for url, text in found}
    answers = decide(TOPIC, items, ANSWERS, TASK.format(role=role)) or {}
    chosen = {key: answers.get(key) for key in items}
    pairs = [(url, chosen[f'{role}|{text}|{urllib.parse.urlsplit(url).path}']) for url, text in found]
    best, near = [url for url, answer in pairs if answer == 'best'], [url for url, answer in pairs if answer == 'near']
    return (best + near)[:MAX_SECTIONS], [url for url, answer in pairs if answer == 'hub'][:MAX_HUBS]   # the exact field first, then close ones


def read(page, address, role, fetch, decide, relevant, shape=lambda found: found, show=None, rendered=None):
    """(jobs, section address) from the board's sections reachable from this page (its markup, fetched at address): its own sections, else the
    sections on one hub page. shape(found) -> the jobs in the aggregators' shape (with the board's place for those that name none), relevant(shaped) -> the
    jobs worth keeping; the first section giving some is returned, shaped, with all its jobs. show: reads a page after its scripts ran (headless
    browser), tried on a section whose plain page gave no relevant job; the section's address is then added to `rendered` (24 Oct 2026: two Moldovan
    boards list their sections' jobs by script only)."""
    level, seen = [(page, address)], {address}
    for _ in range(DEPTH):   # the page's own sections first, then the sections of the hubs it names, and theirs
        hubs = []
        for markup, where in level:
            sections, more_hubs = pick(markup, where, role, decide)
            for url in sections:
                if url in seen:
                    continue
                seen.add(url)
                for how in _ways(url, fetch, show):
                    listing = _page(url, how, fetch)
                    found = _jobs(url, listing, fetch, relevant, shape) if listing else []
                    if found and relevant(shape(found)):
                        if how is show and rendered is not None:
                            rendered.append(url)
                        return shape(found), url
            hubs += [hub for hub in more_hubs if hub not in seen]
        level = []
        for hub in hubs[:MAX_HUBS]:
            seen.add(hub)
            hub_page = _page(hub, fetch, fetch)
            if hub_page:
                level.append((hub_page, hub))
        if not level:
            break
    return [], None


def _ways(url, fetch, show):
    """How to read a section, in order: the plain page, then the browser; the browser first when the plain page has no job addresses of its own
    (a menu of job words only: its cards come by script; 24 Oct 2026, a board's IT category gave its 7 menu links as jobs)."""
    if not show:
        return (fetch,)
    plain = _page(url, fetch, fetch)
    return (fetch, show) if not plain or careers_parse.has_job_ids(plain, url) or careers.jsonld_jobs(plain, url) else (show, fetch)


def _jobs(url, listing, fetch, relevant, shape):
    """Every job of a section's page (its first pages): its own job data, else the job pages its cards link, else the AI page reader (as a board's search page is read,
    found_boards.py; 24 Oct 2026: the reader first saw only the top of a 35-card page and the cards' job pages were never read), and the next pages while they give relevant ones."""
    found = careers.jsonld_jobs(listing, url) or careers.read_page_from(listing, url, fetch) or careers._asked(url, listing, [], fetch)
    if found:
        found = found + board_pages.more(url, listing, found, fetch, lambda markup, link: careers.jsonld_jobs(markup, link) or careers.read_page_from(
            markup, link, fetch), lambda some: relevant(shape(some)))
    return found


def _page(url, get, fetch):
    try:
        return str(get(url) or '')
    except Exception:  # noqa: BLE001 — a section that does not answer: the next one
        return ''
