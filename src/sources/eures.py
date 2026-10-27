"""EURES, the EU's public job-vacancy portal (national employment services of 31 countries), for the user's own places: the one free source whose
postings carry a regional code, so a job is kept only when its code lies in the user's place (owner, 27 Oct 2026: "right role in the wrong place";
a blind round of 10 personas found 115 local matches here and 13 in ours). Public search API, no key and no login, read like the portal's own page
does; each job's own EURES address goes with it. Read by: src/sources/aggregators.py (sources()). Tests: tests/test_eures.py.

The portal filters by country or NUTS-1 only and returns each job's NUTS-3 code, so the city's NUTS-2 region is asked once from the AI (a fixed
shape the code validates against the map's country: a bad answer is dropped, the place is then not read) and a job counts when its code starts with it.
"""
import json
import re
import threading
import time
import urllib.parse

from .. import geo
from ..paths import DATA

URL = 'https://europa.eu/eures/api/jv-searchengine/public/jv-search/search'
DETAIL = 'https://europa.eu/eures/portal/jv-se/jv-details/'
COUNTRIES = frozenset('AT BE BG HR CY CZ DK EE FI FR DE HU IS IE IT LV LI LT LU MT NL NO PL PT RO SK SI ES SE CH'.split())   # the portal's member countries
PAGE_SIZE = 50
MAX_PAGES = 6   # per role word and country: the best matches first, the rest waits for another search
KEEP = 100
SECONDS = 25   # a read stops asking for more pages after this (it runs past the search's read cut, src/sources/aggregators.py CHEAP_PAST_CUT)


CUT = [False]   # the last read ended on its clock, not on its pages: src/sources/aggregators.py scan queues it instead of marking it read


def stop_at(began):
    """The monotonic time after which nothing more may be asked. Why (27 Oct 2026, owner's rule: one 180 s deadline for every stage, tests/test_three_minutes.py; 6e's
    review): EURES runs past the read cut, so its own SECONDS never extend the press: it also stops where the AI steps' share starts (titles reserve + tail)."""
    from .. import time_budget
    stop = began + time_budget.part(SECONDS)
    end = time_budget.end()
    return stop if end is None else min(stop, end - time_budget.part(time_budget.RESERVE['titles'] + time_budget.TAIL))


def out_of_time(began, now=None):
    """True when no more page may be asked (stop_at)."""
    return (time.monotonic() if now is None else now) >= stop_at(began)


STORE = DATA / 'eures_regions.json'
LOCK = threading.Lock()
NUTS2 = re.compile(r'[A-Z]{2}[0-9A-Z]{2}')
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['regions'], 'properties': {'regions': {'type': 'array', 'items': {
    'type': 'object', 'additionalProperties': False, 'required': ['n', 'nuts2'],
    'properties': {'n': {'type': 'integer'}, 'nuts2': {'type': 'string', 'description': 'Its NUTS-2 region code (4 characters, e.g. BE10, BG41), "" when unsure'}}}}}}
SYSTEM = """You give the EU's NUTS-2 statistical region (NUTS 2021, 4 characters: country code + 2) that each numbered place lies in, for a town, \
city or area. The place words come from a job seeker, in any language. When a place is a whole country, a region wider than one NUTS-2 region or \
you are unsure, answer "". Never invent a code."""


def _read():
    try:
        data = json.loads(STORE.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def regions(words, client=None):
    """{place word: [NUTS prefix]} for the user's place words in the portal's countries: a country word gives its 2-letter code, a town or area its
    NUTS-2 region from the AI (asked once, kept in data/eures_regions.json; validated against the map's country). A word the AI is unsure of, or any
    word when no AI answers, is left out (unknown, not guessed)."""
    words = list(dict.fromkeys(str(w).strip() for w in words if str(w or '').strip()))
    mapped = geo.resolve(words, client)
    out, todo, kept = {}, [], _read()
    for word in words:
        entry = mapped.get(geo.norm(word))
        if not entry or entry.get('cc') not in COUNTRIES:
            continue
        if entry['kind'] == 'country':
            out[word] = [entry['cc']]
        elif geo.norm(word) in kept:
            out[word] = [kept[geo.norm(word)]] if kept[geo.norm(word)] else []
        else:
            todo.append(word)
    if todo:
        found = _ask(todo, client)
        for word, code in found.items():
            entry = mapped[geo.norm(word)]
            ok = bool(NUTS2.fullmatch(code)) and code[:2] == entry['cc']
            out[word] = [code] if ok else []
            if ok:
                kept[geo.norm(word)] = code
        with LOCK:
            STORE.parent.mkdir(parents=True, exist_ok=True)
            STORE.write_text(json.dumps({**_read(), **{k: v for k, v in kept.items() if v}}, ensure_ascii=False, sort_keys=True))
    return {word: prefixes for word, prefixes in out.items() if prefixes}


def _ask(words, client=None):
    from ..ai import cost, engine
    from ..ai.models import SMALL_MODEL
    if client is None:
        client = engine.client(action='place_triage') if engine.ready() else None
    if client is None:
        return {}
    listed = '\n'.join(f'{n}. {word}' for n, word in enumerate(words, 1))
    response = client.messages.create(model=SMALL_MODEL, max_tokens=1500, system=[{'type': 'text', 'text': SYSTEM}],
                                      messages=[{'role': 'user', 'content': f'Places:\n{listed}'}], output_config=engine.structured(SCHEMA, SMALL_MODEL, 'low'))
    cost.side(SMALL_MODEL, response.usage)
    answer = json.loads(next(b.text for b in response.content if b.type == 'text'))
    return {words[item['n'] - 1]: str(item.get('nuts2') or '').strip().upper() for item in answer.get('regions') or []
            if isinstance(item.get('n'), int) and 1 <= item['n'] <= len(words)}


def _body(query, country, page):
    return {'resultsPerPage': PAGE_SIZE, 'page': page, 'sortSearch': 'BEST_MATCH', 'keywords': [{'keyword': query, 'specificSearchCode': 'EVERYWHERE'}],
            'publicationPeriod': None, 'occupationUris': [], 'skillUris': [], 'requiredExperienceCodes': [], 'positionScheduleCodes': [], 'sectorCodes': [],
            'educationAndQualificationLevelCodes': [], 'positionOfferingCodes': [], 'locationCodes': [country.lower()], 'euresFlagCodes': [],
            'otherBenefitsCodes': [], 'requiredLanguages': [], 'minNumberPost': None, 'sessionId': 'jobadabra'}


def eures(search, get=None, client=None):
    """EURES vacancies for the user's role words, kept only where a job's region code lies in one of the user's places; each carries "<place word>,
    <country>" as its location so the place check reads a real place. [] with no place in the portal's countries. `get(url, data, headers)` returns the parsed JSON."""
    from . import aggregators
    from ..notion.search_settings import readable, terms
    get = get or aggregators._get
    began = time.monotonic()
    CUT[0] = False
    if out_of_time(began):   # started past its share: nothing is asked, not even the region question (gitar-bot, #2251)
        CUT[0] = True
        return []
    places = [readable(str(p)) for group in ('top_tier', 'country_wide', 'abroad') for p in terms((search.get('locations') or {}).get(group))[:6]]
    wanted = regions(places, client)
    jobs, seen = [], set()
    for country in dict.fromkeys(prefix[:2] for prefixes in wanted.values() for prefix in prefixes):
        mine = {word: prefixes for word, prefixes in wanted.items() if prefixes[0][:2] == country}
        for query in aggregators._queries(search)[:3]:
            for page in range(1, MAX_PAGES + 1):
                if out_of_time(began):
                    CUT[0] = True
                    return jobs
                # a request waits at most until the stop time, so a slow page cannot run into the AI steps' share (gitar-bot, #2251)
                data = get(URL, json.dumps(_body(query, country, page)).encode(), {'Content-Type': 'application/json'}, timeout=max(3, min(30, stop_at(began) - time.monotonic())))
                listed = data.get('jvs') or []
                for j in listed:
                    codes = [c.upper() for found in (j.get('locationMap') or {}).values() for c in found or [] if c]
                    word = next((w for w, prefixes in mine.items() if any(c.startswith(p) for c in codes for p in prefixes)), None)
                    if not word or j.get('id') in seen or not j.get('title'):
                        continue
                    seen.add(j['id'])
                    jobs.append(aggregators._job('eures', j['id'], j['title'], (j.get('employer') or {}).get('name'),
                                                 f"{word}, {geo.country_name(country) or country}", DETAIL + urllib.parse.quote(j['id']) + '?lang=en',
                                                 aggregators._when((j.get('creationDate') or 0) // 1000), j.get('description')))
                if len(jobs) >= KEEP or len(listed) < PAGE_SIZE:
                    break
    return jobs
