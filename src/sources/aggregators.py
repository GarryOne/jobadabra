"""Job aggregators with public APIs: more jobs straight away, and every employer they name becomes a scout candidate (via the jobs table).

Free, no key: Arbeitnow (Europe, mostly Germany), Himalayas and Jobicy (remote). Free with a key: Adzuna (`ADZUNA_APP_ID` +
`ADZUNA_APP_KEY`, 16 countries incl. Switzerland) and Jooble (`JOOBLE_API_KEY`). Each one's terms are kept: the job's own address and the
source's name go with every job (Jobicy, Arbeitnow ask for that), each is asked at most every SPACING_HOURS for the same search (a changed
search reads at once: 25 Oct 2026, a pilot search 8 minutes after a software one read no board), and only the roles and places of
this user's search are kept. Remotive is not used: its terms forbid passing its jobs to another product. job-room.ch (the Swiss public
employment service) is not used either until it offers a documented public API.
"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from .. import read_methods
from . import ats, board_employers, boards_ahead, feeds, host_pace

SPACING_HOURS = 6
PAGES = 2
JOBSCH_PAGES = 5   # jobs.ch pages read at most per search and place (20 postings a page)
TIMEOUT = 30
TABLE = 'CREATE TABLE IF NOT EXISTS aggregator_runs (source TEXT PRIMARY KEY, at TEXT NOT NULL)'
SEARCH_TABLE = 'CREATE TABLE IF NOT EXISTS aggregator_searches (source TEXT PRIMARY KEY, search TEXT NOT NULL)'   # which search each last read was for
# Search-place country words -> Adzuna's country codes (the countries it covers).
# Every country Adzuna serves (its API's endpoints), by the English name places.countries() answers (src/places.py: the AI says which
# country each place word is in, in any language; 8 Oct 2026: a regex of ten countries' city names).
ADZUNA_COUNTRIES = {'gb': 'United Kingdom', 'us': 'United States', 'at': 'Austria', 'au': 'Australia', 'be': 'Belgium', 'br': 'Brazil',
                    'ca': 'Canada', 'ch': 'Switzerland', 'de': 'Germany', 'es': 'Spain', 'fr': 'France', 'in': 'India', 'it': 'Italy',
                    'mx': 'Mexico', 'nl': 'Netherlands', 'nz': 'New Zealand', 'pl': 'Poland', 'sg': 'Singapore', 'za': 'South Africa'}


def _get(url, data=None, headers=None):
    request = urllib.request.Request(url, data=data, headers={'User-Agent': ats.USER_AGENT, 'Accept': 'application/json', **(headers or {})})
    with host_pace.open(request, TIMEOUT) as response:
        return json.loads(response.read())


def _when(value):
    try:
        return datetime.fromtimestamp(int(value), timezone.utc).date().isoformat()
    except (TypeError, ValueError):
        return str(value or '')[:10]


def _job(source, id, title, company, location, url, posted='', description='', remote=False, salary=''):
    return {**ats._job(f'{source}:{id}', title, location, url, posted, ats.plain(description), remote, salary), 'company': (company or '').strip() or 'Unknown employer'}


def arbeitnow(get=_get):
    jobs = []
    for page in range(1, PAGES + 1):
        for j in get(f'https://www.arbeitnow.com/api/job-board-api?page={page}').get('data', []):
            jobs.append(_job('arbeitnow', j.get('slug'), j.get('title'), j.get('company_name'), j.get('location') or ('Remote' if j.get('remote') else ''),
                             j.get('url'), _when(j.get('created_at')), j.get('description'), bool(j.get('remote'))))
    return jobs


def himalayas(get=_get):
    jobs, cursor = [], ''
    for _ in range(PAGES):
        data = get('https://himalayas.app/jobs/api?limit=100' + (f'&cursor={urllib.parse.quote(cursor)}' if cursor else ''))
        for j in data.get('jobs', []):
            where = ', '.join(j.get('locationRestrictions') or []) or 'Anywhere'
            jobs.append(_job('himalayas', j.get('guid'), j.get('title'), j.get('companyName'), f'Remote ({where})', j.get('applicationLink') or j.get('guid'),
                             _when(j.get('pubDate')), j.get('description') or j.get('excerpt'), True))
        cursor = data.get('nextCursor') or ''
        if not cursor:
            break
    return jobs


def jobicy(get=_get, tags=('devops', 'sre', 'cloud', 'kubernetes', 'platform')):
    jobs = []
    for tag in tags:
        for j in get(f'https://jobicy.com/api/v2/remote-jobs?count=50&tag={urllib.parse.quote(tag)}').get('jobs', []):
            jobs.append(_job('jobicy', j.get('id'), j.get('jobTitle'), j.get('companyName'), f"Remote ({j.get('jobGeo') or 'Anywhere'})", j.get('url'),
                             str(j.get('pubDate') or '')[:10], j.get('jobDescription') or j.get('jobExcerpt'), True))
    return jobs


def _queries(search):
    from ..notion.search_settings import terms
    return (terms(search.get('jobs_board_search_queries')) or terms(search.get('role_keywords')))[:4]


def _countries(search):
    """The Adzuna countries of the user's places (at most four), from what places.countries() knows; [] before it knows any."""
    from .. import places
    from ..notion.search_settings import readable
    names = places.countries(search, limit=10)
    words = [readable(str(p)) for group in (search.get('locations') or {}).values() for p in group]
    cache = places.load()
    if any(places.in_switzerland(w, cache) for w in words) and 'Switzerland' not in names:
        names = ['Switzerland', *names]   # the first market from its fixed table, before (or without) the AI's answer
    codes = [code for name in names for code, country in ADZUNA_COUNTRIES.items() if country == name]
    codes += list((place_countries(words) or {}).values())   # the AI's country for each place word (kept per word); its words only without AI
    return list(dict.fromkeys(c for c in codes if c in ADZUNA_COUNTRIES))[:4]


PLACE_COUNTRY_TASK = 'A place name. Answer the code of the country it is in: ' + '; '.join(f'{c} = {n}' for c, n in ADZUNA_COUNTRIES.items())


def place_countries(words):
    """{place word lowercased: country code or 'other'} by the AI (topic place-country, ai_first: a word in the text is not the place,
    "London, Ontario" is not in the UK); the pack's patterns only with no AI at all; a place past the AI's cap is left out (unknown).
    None when nothing is known. Shared with Google Jobs (src/sources/google_jobs.py within_places), so each place is asked once."""
    from ..ai import decide
    items = {str(w).lower(): str(w) for w in words if str(w or '').strip()}
    return decide.decide('place-country', items, (*ADZUNA_COUNTRIES, 'other'), PLACE_COUNTRY_TASK) if items else {}


def adzuna(search, get=_get):
    app_id, app_key = os.getenv('ADZUNA_APP_ID'), os.getenv('ADZUNA_APP_KEY')
    jobs = []
    for country in _countries(search):
        for query in _queries(search):
            params = urllib.parse.urlencode({'app_id': app_id, 'app_key': app_key, 'what': query, 'results_per_page': 50, 'content-type': 'application/json'})
            for j in get(f'https://api.adzuna.com/v1/api/jobs/{country}/search/1?{params}').get('results', []):
                salary = f"{j.get('salary_min') or ''}–{j.get('salary_max') or ''}".strip('–') if j.get('salary_min') or j.get('salary_max') else ''
                jobs.append(_job('adzuna', j.get('id'), j.get('title'), (j.get('company') or {}).get('display_name'), (j.get('location') or {}).get('display_name'),
                                 j.get('redirect_url'), str(j.get('created') or '')[:10], j.get('description'), False, salary))
    return jobs


def jooble(search, get=_get):
    key = os.getenv('JOOBLE_API_KEY')
    from ..notion.search_settings import terms
    places = terms((search.get('locations') or {}).get('top_tier'))[:2] or ['']
    jobs = []
    for query in _queries(search):
        for place in places:
            body = json.dumps({'keywords': query, 'location': place}).encode()
            for j in get(f'https://jooble.org/api/{urllib.parse.quote(key)}', body, {'Content-Type': 'application/json'}).get('jobs', []):
                jobs.append(_job('jooble', j.get('id'), j.get('title'), j.get('company'), j.get('location'), j.get('link'), str(j.get('updated') or '')[:10],
                                 j.get('snippet'), 'remote' in str(j.get('type') or '').lower(), j.get('salary') or ''))
    return jobs


def jobsch(search, get=None):
    """jobs.ch, Switzerland's biggest job board, for any profession: the search pages' own job listing (schema.org data), for the user's job-board searches. Only for a search
    with Swiss places. Only the search pages are read (the job detail pages are not needed) (the same ones the employer discovery in
    boards.py reads, 0.35 s apart, kept 6 hours); a job's own jobs.ch address goes with it and the user opens it in the browser. The listing carries a short description only."""
    from . import boards
    if not boards.swiss_places(search):
        return []
    fetch = get or (lambda url, client=boards.Client(): client.get(url)['html'])
    jobs, seen = [], set()
    # The same searches as the employer discovery (boards.py, 6 Oct 2026): in the user's Swiss cities (and the whole country when wanted), each
    # board word on its own too, page by page until a short page or one with nothing new. Before: 4 searches, all of Switzerland, 2 pages: a
    # Geneva search got St. Gallen and Wallisellen, and two runs in a row found the same few jobs.
    for query in boards.jobsch_terms(search) or _queries(search):
        for place in boards.jobsch_places(search):
          for page in range(1, JOBSCH_PAGES + 1):
            try:
                markup = fetch('https://www.jobs.ch/en/vacancies/?' + urllib.parse.urlencode({'term': query, **({'location': place} if place else {}), 'page': page}))
            except urllib.error.HTTPError as error:
                if error.code in host_pace.REFUSED:   # a block is taken as it is, what was read is kept (6 Oct 2026)
                    print(f'Warning: jobs.ch refused more searches for now (HTTP {error.code}); {len(jobs)} job(s) read before that are kept')
                    return jobs
                raise
            except host_pace.Busy as error:   # it asked us to slow down for longer than this run waits: the next run goes on
                print(f'Warning: {error}; {len(jobs)} job(s) read before that are kept')
                return jobs
            listed = list(boards.walk(boards.Page(markup).schemas, 'JobPosting'))
            towns = ats.jobsch_towns(markup if isinstance(markup, str) else markup.decode('utf-8', 'replace'))
            fresh = 0
            for j in listed:
                places = j.get('jobLocation') or []
                places = places if isinstance(places, list) else [places]
                where = []
                for spot in places:   # not `place`: that is the search's town, still used for the next page and the fallback below
                    address = (spot or {}).get('address') or {}
                    town = re.sub(r'^[A-Z]{2} ', '', str(address.get('addressLocality') or address.get('addressRegion') or '').strip())   # "ZH Herrliberg" -> "Herrliberg"
                    if town and town not in where:
                        where.append(town)
                url = j.get('url') or ''
                key = re.search(r'/detail/([0-9a-f-]{36})', url)
                if not (url and j.get('title') and key) or key.group(1) in seen:
                    continue
                seen.add(key.group(1))
                if not where and towns.get(key.group(1)):
                    where.append(towns[key.group(1)])
                fresh += 1
                jobs.append(_job('jobsch', key.group(1), j['title'], (j.get('hiringOrganization') or {}).get('name'), ', '.join(f'{town}, Switzerland' for town in where) or (f'{place} area, Switzerland' if place else 'Switzerland'),   # a search in a town: near it
                                 url, str(j.get('datePosted') or '')[:10], j.get('description')))
            if len(listed) < boards.PAGE_SIZE or not fresh:
                break
    return jobs


def technical_search(search):
    from ..coverage import technical_search as technical   # one definition of an IT search (role kinds)
    return technical(search)


def sources(env=None):
    """[(name, reader)] of the aggregators this install may use now (free ones always; keyed ones when their keys are set)."""
    env = os.environ if env is None else env
    from ..features import disabled
    found = [] if disabled('aggregators', env) else [('Arbeitnow', lambda search: arbeitnow()), ('Himalayas', lambda search: himalayas()),
                                                      ('Jobicy', lambda search: jobicy() if technical_search(search) else [])]   # its tags are IT ones
    if not disabled('aggregators', env) and not disabled('jobsch', env):
        found.append(('jobs.ch', jobsch))   # Swiss places only (it returns nothing otherwise)
    if not disabled('aggregators', env) and not disabled('found_boards', env):   # boards found for your countries (src/sources/found_boards.py)
        from . import found_boards
        found.append(('Job boards found', found_boards.read))
    if env.get('ADZUNA_APP_ID') and env.get('ADZUNA_APP_KEY') and not disabled('adzuna', env):
        found.append(('Adzuna', adzuna))
    if env.get('JOOBLE_API_KEY') and not disabled('jooble', env):
        found.append(('Jooble', jooble))
    return found


def search_key(search):
    """A short key of what a reader is asked for: the search's roles, board searches and places (other settings do not change a read)."""
    import hashlib
    search = search or {}
    places = search.get('locations') or {}
    parts = [sorted(map(str, search.get('role_keywords') or [])), sorted(map(str, search.get('jobs_board_search_queries') or [])),
             {key: sorted(map(str, places.get(key) or [])) for key in sorted(places)} if isinstance(places, dict) else []]
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False).encode()).hexdigest()[:12]


def read_lately(db, name, now=None, search=None):
    """When reader `name` was last read, if that was within SPACING_HOURS for this search (it is not read again before), else None.
    Without a search, or a last read from before the key was kept, any search counts as the same one."""
    db.execute(TABLE)
    db.execute(SEARCH_TABLE)
    last = db.execute('SELECT at FROM aggregator_runs WHERE source = ?', (name,)).fetchone()
    at = datetime.fromisoformat(last[0]) if last else None
    if not at or at <= (now or datetime.now(timezone.utc)) - timedelta(hours=SPACING_HOURS):
        return None
    kept_for = db.execute('SELECT search FROM aggregator_searches WHERE source = ?', (name,)).fetchone()
    return None if search is not None and kept_for and kept_for[0] != search_key(search) else at


def mark_read(db, name, now, search=None):
    """Reader `name` was read now (for this search)."""
    db.execute(TABLE)
    db.execute(SEARCH_TABLE)
    with db:
        db.execute('INSERT OR REPLACE INTO aggregator_runs (source, at) VALUES (?, ?)', (name, now.isoformat(timespec='seconds')))
        if search is not None:
            db.execute('INSERT OR REPLACE INTO aggregator_searches (source, search) VALUES (?, ?)', (name, search_key(search)))


def kept(db, name, found, now=None):
    """One reader's jobs in your roles and places, in the report's shape, each recorded in the seen history; their employer named
    (board_employers). Also the first-jobs slice's proven boards (src/first_jobs.py)."""
    now, matched = now or datetime.now(timezone.utc), []
    feeds.triage(found)   # their titles judged by the AI first, the role words' hits too (owner, 26 Oct 2026: "The AI decides")
    with db:
        for job in found:
            if not (job.get('url') and feeds.wanted_title(job['title']) and feeds.wanted_location(job)):
                continue
            matched.append({**{k: job[k] for k in ('company', 'id', 'title', 'url', 'date_posted', 'description')},
                            'location': job['location'] or 'Unspecified', 'work_mode': 'Remote (stated)' if job['remote'] else '',
                            'salary_text': job['salary'], 'notes': f'Found on {name}', 'source': name, 'source_kind': 'job board',
                            'status': feeds.record(db, name.lower(), job, now.isoformat(timespec='seconds'))})
    board_employers.fill_missing(matched)   # the page's own hiringOrganization, a few per run
    board_employers.note(matched, name)
    return matched


def scan(db, search, now=None, readers=None, on_jobs=None, ahead=None):
    """A feeds.scan-style report ({'jobs', 'sources'}) from the aggregators that are due; your roles and places only, source named on each job.
    on_jobs(jobs): each reader's jobs as soon as it is read (owner, 18 Oct 2026: jobs shown as quickly as possible). ahead: the found boards
    already read beside the employer sites (src/sources/boards_ahead.py), taken instead of read again."""
    report = {'jobs': [], 'sources': []}
    # The end-to-end fixture mode reads feeds from files and never reaches a live site (careers.py does the same): real postings from a public API would land in a test's data
    # (3 Oct 2026: jobicy rows in the quality suite). `readers` given = a test of this function itself.
    if readers is None and os.getenv('JOB_PILOTTO_FIXTURE_DIR'):
        return _done(report)
    now = now or datetime.now(timezone.utc)
    db.execute(TABLE)
    from .. import time_budget
    from . import read_budget
    late = []   # due past the search's read cut: not read, not marked read; the next search reads them (tests/test_three_minutes.py)
    for name, read in (readers if readers is not None else sources()):
        lately = read_lately(db, name, now, search)
        if lately and name != boards_ahead.NAME:   # the found boards rest one by one (board_yield.not_read_since)
            continue
        if read_budget.past_cut() and not (ahead is not None and name == boards_ahead.NAME):   # the boards read beside the employers are only taken
            late.append(name)
            continue
        try:
            if ahead is not None and name == boards_ahead.NAME:
                found, matched = ahead.take(db, now)
            else:
                if name == boards_ahead.NAME:   # the found boards count one by one (found_boards.read_board)
                    found = read(search, since=now - timedelta(hours=SPACING_HOURS)) if lately else read(search)
                else:
                    with read_methods.reading(name, 'feed_api') as counted:   # a free job API is a feed
                        found = read(search)
                        counted.jobs = read_methods.in_places(found)
                matched = kept(db, name, found, now)
            mark_read(db, name, now, search)
            if on_jobs and matched and not (ahead is not None and name == boards_ahead.NAME and ahead.shown):   # shown already
                on_jobs(matched)
            report['jobs'].extend(matched)
            report['sources'].append({'company': name, 'ok': True, 'total': len(found), 'matches': len(matched)})
        except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError) as error:
            report['sources'].append({'company': name, 'ok': False, 'error': f'{type(error).__name__}: {error}'})
    if late:
        time_budget.later('free job APIs', len(late), 'sources' if len(late) != 1 else 'source')
    return _done(report)


def _done(report):
    """The step's end, said once every board and job API is read (the found boards read beside the employer sites and those a web search found
    mid-run included): the Find card's "Job boards" chip shows ✓ only then (desktop/renderer/find-card-model.js stepChips; owner, 26 Oct 2026)."""
    print(f"Job boards: done, {len(report['jobs'])} job(s) for your search", flush=True)
    return report
