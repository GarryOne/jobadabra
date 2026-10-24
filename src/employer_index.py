"""The central employer index: feeds found and verified by one scout for everyone, downloaded by every install.

Nothing about the user goes up: a plain GET with a random install id and the token the website gives that id
(the full list is not a public download; the website's own counters use a separate public summary). The result
is cached on disk and checked about hourly (an unchanged list is a 304 by its publish time); if the service is down the cache is used (however old), else nothing, and
`merge` then falls back to the user's own starter feeds (config/sources.json, empty unless they added some: every starting source is central
since 6 Oct 2026), so a run never fails because of this.
"""
from datetime import datetime, timedelta, timezone
import json
import time
import os
import re
import secrets
import urllib.request

from . import role_kinds
from .paths import DATA
from . import service

OUTCOMES = {'no_feed': 30, 'refused': 30, 'unreachable': 7}   # fixed words, days each rests (see scout_core)
from .sources import ats, page_recipes

REGION_NAMES = ('europe', 'north_america', 'latin_america', 'asia_pacific', 'middle_east_africa', 'remote')   # site/src/pool.js REGIONS

URL = 'https://www.jobpilotto.top/api/index'
CACHE = DATA / 'employer_index.json'
MAX_AGE = timedelta(minutes=55)   # checked about hourly (7 Oct 2026): an unchanged list costs one tiny 304, the central scout publishes every 6 h
TIMEOUT = 10


def _get(url, headers):
    """(status, body text, etag); 304 has no body. Raises on network errors and other statuses."""
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT, **headers})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.status, response.read().decode('utf-8'), response.headers.get('ETag')
    except urllib.error.HTTPError as error:
        if error.code == 304:
            return 304, '', None
        raise


def _mint(base, install):
    """The index token for this install id from the website ('' when it cannot be had: the download is then tried without)."""
    request = urllib.request.Request(f'{base}/api/install-token', method='POST',
                                     data=json.dumps({'install': install, 'purpose': 'index'}).encode(),
                                     headers={'User-Agent': ats.USER_AGENT, 'Content-Type': 'application/json'})
    def ask():
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return str(json.load(response).get('token') or '')
    return service.site_token(install, 'index', ask)   # kept once given; quiet the rest of the day after a refusal (the download is then tried without)


def fresh_of(fresh):
    """A feed's freshness as the index carries it (src/scout.py health): fixed fields, or None."""
    if not isinstance(fresh, dict) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(fresh.get('ok') or '')):
        return None
    number = lambda value: int(value) if isinstance(value, (int, float)) and 0 <= value < 10**6 else 0
    return {'ok': fresh['ok'], 'fails': number(fresh.get('fails')), 'jobs': number(fresh.get('jobs')),
            'trend': fresh.get('trend') if fresh.get('trend') in ('up', 'flat', 'down') else 'flat',
            'new': fresh.get('new') if re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(fresh.get('new') or '')) else None}


def clean_nofeed(items):
    """The central list of employers with no readable job site (published by the central scout): fixed fields, or dropped."""
    out = []
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict) and re.fullmatch(r'[a-z0-9]{1,120}', str(item.get('key') or '')) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(item.get('last') or '')):
            out.append({'key': item['key'], 'last': item['last'], 'outcome': item.get('outcome') if item.get('outcome') in OUTCOMES else 'no_feed'})
    return out[:5000]


def clean_boards(items):
    """Per job board, what it gives people by label (src/scout.py board_stats): fixed shape, or dropped."""
    out = []
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict) and re.fullmatch(r'[a-z_]{2,30}', str(item.get('board') or '')) and isinstance(item.get('by'), dict):
            by = {name: {tag: pair for tag, pair in (tags or {}).items() if isinstance(pair, list) and len(pair) == 2 and all(isinstance(n, int) for n in pair)}
                  for name, tags in item['by'].items() if isinstance(tags, dict)}
            out.append({'board': item['board'], 'installs': int(item.get('installs') or 0), 'matched': int(item.get('matched') or 0), 'by': by})
    return out[:30]


def clean_sites(items):
    """The facts about sites the pool serves (src/sources/visits_jobpages.py pool_facts, src/ai/board_ideas.py served): dicts with a host and a kind, kept as served."""
    return [item for item in items if isinstance(item, dict) and isinstance(item.get('host'), str) and isinstance(item.get('kind'), str)][:3000] if isinstance(items, list) else []


SPECIFIC = ('families', 'metros', 'roles', 'countries')   # the most telling label first: a photographer's family says more than "Europe"


def board_rate(board, me, cache=None):
    """(installs, matched) of people like this user on a job board, by their most specific label with data, or None."""
    stored = _read(cache or CACHE) or {}
    line = next((b for b in stored.get('boards') or [] if b['board'] == board), None)
    if not line:
        return None
    for name in SPECIFIC:
        pairs = [line['by'].get(name, {}).get(tag) for tag in me.get(name) or []]
        pairs = [pair for pair in pairs if pair]
        if pairs:
            return sum(p[0] for p in pairs), sum(p[1] for p in pairs)
    return None


def me_now(search=None):
    """This user's fixed-list labels (src/contribute.py): role kinds, families, countries, metros. Nothing leaves the Mac here."""
    from . import contribute
    roles, _ = contribute.tags(search)
    return {'roles': roles, **contribute.fine_tags(search)}


QUIET_FROM = '2026-10-21'   # shadow mode until then (owner, 7 Oct 2026): quiet feeds are named in the log but still crawled


def quiet_label(feed, me):
    """The label of this user's that makes the feed quiet for them ('photography'), or ''."""
    if not quiet_for(feed, me):
        return ''
    quiet = (feed.get('fits') or {}).get('quiet') or {}
    return ', '.join(tag for name in ('families', 'roles') for tag in me.get(name) or [] if tag in (quiet.get(name) or []))


def quiet_for(feed, me):
    """True when installs of every family (or, without one, every role kind) of this user read the feed fine and none found a job there."""
    quiet = (feed.get('fits') or {}).get('quiet') or {}
    for name in ('families', 'roles'):
        mine = [tag for tag in me.get(name) or [] if tag != 'other']
        if mine:
            return all(tag in (quiet.get(name) or []) for tag in mine)
    return False


def for_you(index, me, n=8):
    """The employers of the central list that worked best for people like this user: [{company, interview, applied, why}], best first.
    Only feeds with published outcome totals (3+ installs) and a label of this user's among their fits."""
    scored = []
    for feed in index:   # each pick is logged by the caller (coverage.employers_for_you) with its score and reason
        pool, fits = feed.get('pool') or {}, feed.get('fits') or {}
        if not pool or quiet_for(feed, me):
            continue
        shared = [name for name in SPECIFIC if set(me.get(name) or []) & set(fits.get(name) or [])]
        if not shared:
            continue
        score = 3 * pool.get('interview', 0) + pool.get('applied', 0) + 2 * pool.get('matched', 0) / max(1, pool.get('installs', 1))
        score *= {'families': 3, 'metros': 2.5, 'roles': 1.5, 'countries': 1}[shared[0]]
        why = {'families': 'your kind of work', 'metros': 'your area', 'roles': 'your kind of role', 'countries': 'your country'}[shared[0]]
        scored.append((score, {'company': feed['company'], 'interview': pool.get('interview', 0), 'applied': pool.get('applied', 0), 'why': why,
                               'score': round(score, 1), 'label': shared[0]}))
    return [item for _, item in sorted(scored, key=lambda pair: -pair[0])[:n] if item['interview'] or item['applied']]


def central_nofeed(cache=None, today=None, days=30):
    """{key} of employers some install or the central scout found with no readable job site in the last `days` days (6 Oct 2026): this
    install's scout skips them instead of probing the same dead end."""
    if os.getenv('JOB_PILOTTO_FIXTURE_DIR') and cache is None:   # a fixture run reads nothing downloaded (as load() does)
        return set()
    day = today or datetime.now(timezone.utc).date()
    stored = _read(cache or CACHE) or {}
    return {item['key'] for item in stored.get('nofeed') or []
            if item.get('last', '') >= (day - timedelta(days=min(days, OUTCOMES.get(item.get('outcome'), days)))).isoformat()}


def fresh_nofeed(items, today=None):
    """{key} of the dead ends in `items` ({key, last, outcome}) still resting today; the same rule as central_nofeed, for a list just fetched."""
    day = today or datetime.now(timezone.utc).date()
    return {item['key'] for item in clean_nofeed(items)
            if item['last'] >= (day - timedelta(days=OUTCOMES[item['outcome']])).isoformat()}


def clean(feeds):
    """Only well-formed entries for feeds we can crawl: unknown ATS names or missing slugs are dropped."""
    out = []
    for item in feeds if isinstance(feeds, list) else []:
        if not isinstance(item, dict):
            continue
        system, slug, company = item.get('ats'), item.get('slug'), item.get('company')
        if system in ats.FETCHERS and isinstance(slug, str) and slug and isinstance(company, str) and company:
            places = item.get('places')
            out.append({'company': company, 'ats': system, 'slug': slug, 'quality': item.get('quality'),
                        'checked': item.get('checked'),
                        'places': [p for p in places if isinstance(p, str)] if isinstance(places, list) else None,
                        'fits': item.get('fits') if isinstance(item.get('fits'), dict) else None,
                        **({'kinds': role_kinds.valid(item.get('kinds'))} if role_kinds.valid(item.get('kinds')) else {}),
                        **({'fresh': fresh_of(item.get('fresh'))} if fresh_of(item.get('fresh')) else {}),
                        **({'pool': {k: int(item['pool'].get(k) or 0) for k in ('installs', 'matched', 'applied', 'interview')}}
                           if isinstance(item.get('pool'), dict) else {}),
                        'regions': [r for r in item.get('regions') or [] if isinstance(r, str) and r in REGION_NAMES],
                        **({'recipe': item['recipe']} if system == 'careers' and page_recipes.valid(item.get('recipe')) else {})})
    return out


def _read(cache):
    try:
        data = json.loads(cache.read_text())
        return {'fetched': data.get('fetched'), 'etag': data.get('etag'), 'feeds': clean(data.get('feeds')),
                'install': data.get('install'), 'regions': data.get('regions') or [], 'nofeed': clean_nofeed(data.get('nofeed')), 'boards': clean_boards(data.get('boards')),
                'sites': clean_sites(data.get('sites')),
                'generated': data.get('generated') if isinstance(data.get('generated'), str) else None}
    except (OSError, ValueError, AttributeError):
        return None


problem = ''   # why the last load() could not download the index ('' when it could, or did not need to): the run reports it
RETRY_WAIT = 3   # seconds before the one retry of a failed download (a blip must not cost the whole crawl its 247 feeds)


def my_regions():
    """This install's regions from its own search settings (src/contribute.py tags), or [] (then the whole list is asked for)."""
    try:
        from .contribute import tags
        return tags()[1]
    except Exception:  # noqa: BLE001 — no search settings yet: the whole list, as before
        return []


def load(cache=None, url=None, get=_get, now=None, install_id=None, retry_wait=None, mint=None):
    """The downloaded index (list of feeds), from the cache when it is under a day old. Never raises."""
    global problem
    problem = ''
    if os.getenv('JOB_PILOTTO_FIXTURE_DIR'):   # the end-to-end journey: only its own fixture feeds, nothing downloaded
        return []
    retry_wait = RETRY_WAIT if retry_wait is None else retry_wait
    cache = cache or CACHE
    url = url or os.getenv('JOB_PILOTTO_INDEX_URL') or URL
    now = now or datetime.now(timezone.utc)
    # Only the slice for this install's own regions (fixed words: europe, remote...): nothing else about the user goes up.
    regions = my_regions()
    if regions:
        url = f"{url}{'&' if '?' in url else '?'}regions={','.join(regions)}"
    stored = _read(cache)
    if stored and stored['regions'] != regions:
        stored = {**stored, 'fetched': None, 'etag': None, 'generated': None}   # the search moved to other regions: download the new slice
    if stored and stored['fetched']:
        try:
            if now - datetime.fromisoformat(stored['fetched']) < MAX_AGE:
                return stored['feeds']
        except ValueError:
            pass
    headers = {'Accept': 'application/json'}
    # The id is random and local: the one the app shares with the pool when you opted in, else one kept next to the cache.
    install_id = install_id or os.getenv('JOB_PILOTTO_INSTALL_ID') or (stored or {}).get('install')
    if not (install_id and re.fullmatch(r'[A-Za-z0-9_-]{8,64}', install_id)):
        install_id = secrets.token_hex(12)
    headers['X-Install-Id'] = install_id
    if stored and stored.get('generated'):   # "still this publish?": answered without a download or a count against the day's quota
        headers['X-Index-Generated'] = stored['generated']
    mint = mint if mint is not None else (_mint if get is _get else (lambda base, install: ''))
    token = mint(url.rsplit('/api/', 1)[0], install_id)
    if token:
        headers['Authorization'] = f'Bearer {token}'
    if stored and stored['etag']:
        headers['If-None-Match'] = stored['etag']
    try:
        for attempt in (1, 2):
            try:
                status, body, etag = get(url, headers)
                if status == 304 and stored:
                    feeds, etag, dead, boards, sites = stored['feeds'], stored['etag'] or etag, stored.get('nofeed') or [], stored.get('boards') or [], stored.get('sites') or []
                    generated = stored.get('generated')
                else:
                    parsed = json.loads(body)
                    feeds, dead, boards, sites = clean(parsed.get('feeds')), clean_nofeed(parsed.get('nofeed')), clean_boards(parsed.get('boards')), clean_sites(parsed.get('sites'))
                    generated = parsed.get('generated') if isinstance(parsed.get('generated'), str) else None
                break
            except Exception:  # noqa: BLE001 — once more after a short wait, then the outer handler decides
                if attempt == 2:
                    raise
                time.sleep(retry_wait)
        entry = {'fetched': now.isoformat(timespec='seconds'), 'etag': etag, 'install': install_id, 'regions': regions, 'feeds': feeds, 'nofeed': dead, 'boards': boards, 'sites': sites, 'generated': generated}
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(entry, indent=1, ensure_ascii=False) + '\n')
        return feeds
    except Exception as error:  # noqa: BLE001 — the index is a bonus: any trouble means "use what we have"
        problem = f'{type(error).__name__}: {error}'
        print(f'Warning: employer index not downloaded ({problem}); '
              f'using {"the cache" if stored else "the starter list only"}')
        return stored['feeds'] if stored else []


def merge(starter, index, skip=lambda company: False):
    """Starter list first (it keeps its names), then downloaded feeds not already in it, minus skipped companies."""
    merged = {}
    for source in [*starter, *index]:
        key = (source.get('ats', 'greenhouse'), source.get('slug') or source['board'])
        if key not in merged and not skip(source['company']):
            merged[key] = dict(source)
    return list(merged.values())


def relevant(index, wanted_location, wanted_kinds=None, me=None, keep=(), today=None, said=None):
    """Only feeds with roles in the user's own places (their search.json), so a worldwide index doesn't cost every
    crawl the time of feeds it would throw away. A feed with no place information (older index) is kept. With the kinds of role the user
    looks for (role_kinds.of_search), also only feeds that hire for one of them: a software company is skipped for a photographer
    (6 Oct 2026); a feed without a published mix is kept. With `me` (this user's labels), also not a feed that many installs of their family
    read fine and never found a job at (quiet_for, 7 Oct 2026): before QUIET_FROM only named (shadow mode), and never a company in `keep`
    (where this user already has a scored job). `said`, a list, gets one line per decision for the log: [(company, label, 'out'|'shadow')]."""
    out = []
    shadow = (today or datetime.now(timezone.utc).date().isoformat()) < QUIET_FROM
    for f in index:
        if f.get('places') and not any(wanted_location({'location': place}) for place in f['places']):
            continue
        if not role_kinds.fits(f.get('kinds'), wanted_kinds):
            continue
        label = quiet_label(f, me) if me and f['company'] not in keep else ''
        if label and said is not None:
            said.append((f['company'], label, 'shadow' if shadow else 'out'))
        if label and not shadow:
            continue
        out.append(f)
    return out
