#!/usr/bin/env python3
"""Adding an application by hand: reading "applied on or before 23 Sep" and reading a job page's metadata
(title, company, description). `add_application` itself stays in src/notion/ledger.py. Re-exported there.

Guarded by tests/test_ledger.py, tests/test_import_url.py and tests/test_added.py."""
import html
import json as _json
import re
import urllib.request
from datetime import date

from ..sources import ats


MONTHS = {m: i for i, m in enumerate(
    ('jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'), 1)}


NUMBER_WORDS = {'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7,
                'eight': 8, 'nine': 9, 'ten': 10, 'a couple of': 2, 'couple of': 2, 'a few': 3, 'few': 3}


def _relative(text, today):
    """A date from "today", "yesterday", "two days ago", "3 weeks ago", "last week" (a week ago), else None."""
    from datetime import timedelta
    if re.search(r'\btoday\b', text):
        return today
    if re.search(r'\byesterday\b', text):
        return today - timedelta(days=1)
    if re.search(r'\blast week\b', text):
        return today - timedelta(days=7)
    words = '|'.join(sorted(map(re.escape, NUMBER_WORDS), key=len, reverse=True))
    if m := re.search(rf'\b(\d+|{words})\s+(day|week|month)s?\s+ago\b', text):
        count = int(m[1]) if m[1].isdigit() else NUMBER_WORDS[m[1]]
        return today - timedelta(days=count * {'day': 1, 'week': 7, 'month': 30}[m[2]])
    return None


def parse_applied(text, today=None):
    """(date or None, approximate) from "2026-09-23", "23 Sep", "23.09", "on or before 23 Sep", "~23/9", or
    "today", "yesterday", "two days ago", "3 weeks ago", "last week" (weeks and months ago count as approximate).
    A year-less date in the future is taken as last year's."""
    today = today or date.today()
    text = (text or '').strip().lower()
    if not text:
        return None, False
    approx = bool(re.search(r'before|approx|around|about|~|<=|≤|ca\.?\b|week|month|few|couple', text))
    if (relative := _relative(text, today)) is not None:
        return relative, approx
    found = None
    if m := re.search(r'(\d{4})-(\d{1,2})-(\d{1,2})', text):
        found = (int(m[1]), int(m[2]), int(m[3]))
    elif m := re.search(r'(\d{1,2})\s*(?:\.|/|\s)\s*([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?', text):
        if m[2] in MONTHS:
            found = (int(m[3]) if m[3] else None, MONTHS[m[2]], int(m[1]))
    elif m := re.search(r'([a-z]{3})[a-z]*\s+(\d{1,2})(?:,?\s+(\d{4}))?', text):
        if m[1] in MONTHS:
            found = (int(m[3]) if m[3] else None, MONTHS[m[1]], int(m[2]))
    elif m := re.search(r'(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?', text):
        found = (int(m[3]) if m[3] else None, int(m[2]), int(m[1]))
    if not found:
        raise ValueError(f'Could not read a date from "{text}". Try 2026-09-23, 23 Sep, "two days ago" or "on or before 23 Sep".')
    year, month, day = found
    value = date(year or today.year, month, day)
    if year is None and value > today:
        value = date(today.year - 1, month, day)
    return value, approx


# Sites that often show a sign-in page instead of the posting. Read like any page since 7 Oct 2026 (owner: "let's remove this restriction";
# a LinkedIn job page often answers a plain visit with its JobPosting data); when the text is missing, the user pastes it or reads it with the
# extension. Never logged into, never past a block.
WALLED = ('linkedin.com', 'glassdoor.', 'indeed.', 'levels.fyi', 'reddit.com')


def walled(url):
    host = (re.match(r'https?://([^/]+)', url or '') or [None, ''])[1].lower()
    return any(site in host for site in WALLED)


def _visible_text(page):
    """The words on a page, when it has no feed and no schema.org JobPosting. Same tag stripping as the board
    crawl (sources/boards.py text); scripts and styles are dropped first so they are not read as the posting."""
    from ..sources.boards import text
    cleaned = re.sub(r'<(script|style|noscript)\b[^>]*>.*?</\1>', ' ', page or '', flags=re.I | re.S)
    return text(cleaned)[:ats.DESCRIPTION_LIMIT]


def page_meta(url, opener=urllib.request.urlopen):
    """Title, company, location, posting date and description of a job page.

    The board feed when the link is one a Jobs check reads (ats.posting), else the page's schema.org
    JobPosting, else the words on the page. The same facts and fit score then read that text. A sign-in page (LinkedIn, Glassdoor…)
    gives little or nothing: the caller asks for the text then."""
    meta = dict(ats.posting(url) or {})
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Jobadabra)'})
        with opener(request, timeout=20) as response:
            page = response.read().decode('utf-8', errors='replace')
    except Exception:  # noqa: BLE001 — a page we can't read still gets tracked with what we have
        return {k: v for k, v in meta.items() if v}
    found_posting = False
    for block in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', page, re.S):
        try:
            data = _json.loads(block)
        except ValueError:
            continue
        for item in data if isinstance(data, list) else data.get('@graph', [data]):
            if isinstance(item, dict) and item.get('@type') == 'JobPosting':
                place = item.get('jobLocation') or {}
                place = place[0] if isinstance(place, list) and place else place
                address = place.get('address') if isinstance(place, dict) else None
                if isinstance(address, dict):
                    address = ', '.join(v for v in (address.get('addressLocality') or address.get('addressRegion'), address.get('addressCountry'))
                                        if isinstance(v, str) and v)
                meta.setdefault('title', item.get('title'))
                meta.setdefault('company', (item.get('hiringOrganization') or {}).get('name'))
                meta.setdefault('location', address)
                meta.setdefault('date_posted', item.get('datePosted'))
                meta.setdefault('description', re.sub(r'<[^>]+>', ' ', html.unescape(item.get('description') or '')))
                found_posting = True
                break
        if found_posting:
            break
    if not meta.get('title') and (m := re.search(r'<title>(.*?)</title>', page, re.S)):
        meta['title'] = html.unescape(m[1]).strip()
    # A posting that is only written on the page, with the form beside it, still has its text.
    if len((meta.get('description') or '').strip()) < 80:
        visible = _visible_text(page)
        if len(visible) >= 80:
            meta['description'] = visible
    return {k: v for k, v in meta.items() if v}
