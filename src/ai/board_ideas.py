"""Job boards for the user's countries and kinds of role, proposed by Claude (spec docs/superpowers/specs/2026-10-08-job-board-discovery.md;
owner, 8 Oct 2026: "We should be able to discover new job boards"). A board is data, never code: a name, its host and a search address with
{role} (and {place} when the board takes one). One call per set of countries, roles and kinds, kept in data/found_boards.json ('ideas');
Claude sees the countries, place words and role words only, never the CV. Every answer is checked here before anything reads it: an https
address on the board's own host, the {role} placeholder, not a portal the visit list already offers (LinkedIn, Indeed, Glassdoor,
levels.fyi) and not one of the boards with their own reader (jobs.ch, SwissDevJobs, TechTree). Tests: tests/test_board_ideas.py."""
import hashlib
import json
import re
import urllib.parse

from ..role_kinds import KINDS as ROLE_KINDS
from .models import MAIN_MODEL
from .providers.contract import detail, reason

MODEL = MAIN_MODEL   # owner, 18 Oct 2026: the main model; the small one proposed 2 useless boards for a Dutch controller
MAX_BOARDS = 16
OWN_READERS = ('jobs.ch', 'swissdevjobs.ch', 'techtree.io')   # src/sources/boards.py BOARDS: read by their own code, never twice
PORTALS = ('linkedin.', 'indeed.', 'glassdoor.', 'levels.fyi')  # src/sources/visits_portals.py: offered as visits already
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['boards'], 'properties': {'boards': {'type': 'array', 'items': {
    'type': 'object', 'additionalProperties': False, 'required': ['name', 'search_url', 'countries', 'kinds', 'source_kind'],
    'properties': {'name': {'type': 'string'},
                   'search_url': {'type': 'string', 'description': 'Its public search page, https, with {role} where the keywords go and {place} '
                                                                   'where the place goes (left out when the board takes no place)'},
                   'countries': {'type': 'array', 'items': {'type': 'string'}, 'description': 'English country names it serves'},
                   'kinds': {'type': 'array', 'items': {'type': 'string'}},
                   'source_kind': {'type': 'string', 'enum': ['public_service', 'general', 'sector', 'regional', 'agency']}}}}}}
SYSTEM = """You know the job boards people really use to find work in each country. You get a job seeker's countries, places and roles. \
List 8 to 16 job boards (at least 8 when the country has them; not company career sites) where jobs for these roles in these places are posted: the country's \
public job service first (the state's own), then the general boards, then boards for these kinds of role (a developer board for developers, a hospitality board for chefs), then regional boards for these places and staffing agencies' boards. source_kind: public_service, general, sector, regional or agency. Leave out \
LinkedIn, Indeed, Glassdoor and levels.fyi. For each, its public search page as a template: https, the board's own address, {role} where \
the keywords go and {place} where the place goes (no {place} when the board has no place search). Only boards you are confident exist with \
that search address; fewer is better than a guess. kinds: from software, sales_b2b, sales_retail, logistics, hospitality, healthcare, \
creative_media, finance_admin, education, trades, engineering, business_ops, manufacturing, science, customer_service, legal, aviation_transport, \
public_security, other, any."""
SOURCE_KINDS = ('public_service', 'general', 'sector', 'regional', 'agency')
KINDS = (*ROLE_KINDS, 'any')   # src/role_kinds.py KINDS, plus a board for every kind


def _host(url):
    try:
        return (urllib.parse.urlsplit(url).hostname or '').lower().removeprefix('www.')
    except ValueError:
        return ''


def valid(board, listing=False):
    """The board in the shape the code reads, or None: https on its own host, {role} in it, nothing but the two placeholders. listing: a board the
    pool serves may be a page that lists the jobs (a section of the board, measured by the scout), so {role} is not required."""
    if not isinstance(board, dict):
        return None
    url, name = str(board.get('search_url') or '').strip(), re.sub(r'\s+', ' ', str(board.get('name') or '')).strip()[:60]
    host = _host(url.replace('{role}', 'x').replace('{place}', 'x'))
    if not (name and url.startswith('https://') and len(url) <= 300 and ('{role}' in url or listing) and host and '.' in host):
        return None
    if set(re.findall(r'\{(\w*)\}', url)) - {'role', 'place'} or any(p in host for p in PORTALS) or any(host.endswith(o) for o in OWN_READERS):
        return None
    countries = [re.sub(r'\s+', ' ', str(c)).strip()[:40] for c in board.get('countries') or [] if str(c).strip()][:10]
    kinds = [k for k in board.get('kinds') or [] if k in KINDS] or ['any']
    source_kind = board.get('source_kind') if board.get('source_kind') in SOURCE_KINDS else 'general'
    return {'name': name, 'host': host, 'search_url': url, 'countries': countries, 'kinds': kinds, 'source_kind': source_kind}


def _store():
    from ..paths import DATA
    return DATA / 'found_boards.json'


def load():
    try:
        return json.loads(_store().read_text())
    except (OSError, ValueError):
        return {}


def save(data):
    file = _store()
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(data, ensure_ascii=False, indent=1))


SLICE = 5   # countries per proposal call; a region's countries are split into equal slices, each asked (26 Oct 2026: Europe = its first 5 only)


def _asked(countries, roles, kinds, place_words):
    key = hashlib.sha256(json.dumps([countries, sorted(roles), kinds, 'main-model'], ensure_ascii=False).encode()).hexdigest()[:12]
    return key, countries, roles, kinds, place_words


def _parts(search):
    from .. import places
    from ..notion.search_settings import terms
    from ..role_kinds import of_search
    countries = places.countries(search, limit=None)
    roles = terms((search or {}).get('role_keywords'))[:20]
    if not countries or not roles:
        return None
    return countries, roles, sorted(of_search(search) or []), [w for w in places.words_of(search)][:10]


def asked_for(search):
    """(cache key, countries, roles, kinds, place words) of this search's whole board proposal, every country of its places; None without
    countries or roles. Its web search (src/sources/board_web.py) is keyed by it; the proposal itself is asked in slices (slices)."""
    parts = _parts(search)
    return _asked(*parts) if parts else None


def slices(search):
    """[asked_for-shaped tuples] per slice of at most SLICE countries, the slices as equal as they can be: every country of a region is asked
    with the same weight (owner, 26 Oct 2026: "Europe should be europe. All countries should have equal weight.")."""
    parts = _parts(search)
    if not parts:
        return []
    countries, roles, kinds, place_words = parts
    count = -(-len(countries) // SLICE)
    size, extra = divmod(len(countries), count)
    out, start = [], 0
    for n in range(count):
        end = start + size + (1 if n < extra else 0)
        out.append(_asked(countries[start:end], roles, kinds, place_words))
        start = end
    return out


def ideas(search, client=None):
    """The boards Claude proposed for this search's countries, roles and kinds (validated), one call per slice of countries, each from the
    cache when it already answered for it; [] without AI or without countries."""
    asked = slices(search)
    if not asked:
        return []
    shared = ranked(served([country for part in asked for country in part[1]]), search)
    own = []
    for part in asked:
        found = _proposal(part, client)
        if found is None:
            return _merge(own, shared)   # no AI or it failed: what is known so far, and the shared boards
        own.extend(board for board in found if board['host'] not in {b['host'] for b in own})
    return _merge(own, shared)


def _proposal(asked, client=None):
    """The validated boards Claude proposed for one slice (cached per its key), or None without AI or when the call failed."""
    key, countries, roles, kinds, place_words = asked
    data = load()
    if key in (data.get('ideas') or {}):
        return data['ideas'][key]
    try:
        from . import cost, engine
        if client is None:
            if not engine.ready():
                return None   # no AI: the boards other installs found for these countries
            client = engine.client(action='scout')
        response = client.messages.create(
            model=MODEL, max_tokens=6000, system=[{'type': 'text', 'text': SYSTEM}],
            messages=[{'role': 'user', 'content': json.dumps({'countries': countries, 'places': place_words, 'roles': roles, 'kinds': kinds},
                                                             ensure_ascii=False)}],
            output_config=engine.structured(SCHEMA, MODEL, 'low'))
        cost.side(MODEL, response.usage)
        if response.stop_reason != 'end_turn':
            raise RuntimeError(f'stopped with {response.stop_reason}')
        answer = json.loads(next(block.text for block in response.content if block.type == 'text')).get('boards') or []
    except Exception as error:  # noqa: BLE001 — the fixed boards and the shared ones still run
        print(f'Job boards: the AI proposed none this time ({reason(error)}); the known boards still run', flush=True)
        detail('job boards', error)
        return None
    found = list({b['host']: b for b in (valid(item) for item in answer) if b}.values())[:MAX_BOARDS]
    data.setdefault('ideas', {})[key] = found
    save(data)
    print(f"Job boards proposed for {', '.join(countries)}: {', '.join(b['name'] for b in found) or 'none'}", flush=True)
    return found


def served(countries):
    """The boards the central pool serves for these countries (3+ installs read jobs there: src/contribute.py site_facts, kind 'board'),
    checked like Claude's proposals; work without AI too. Each keeps what it gave installs per role family in these countries ('cells')."""
    from .. import pool_tags
    from ..sources.visits_jobpages import pool_facts
    ids = {name: code for code, name in pool_tags.COUNTRIES.items()}
    wanted = {ids[c] for c in countries if c in ids}
    out = []
    for host, fact in (pool_facts().get('board') or {}).items():
        if wanted & set(fact.get('countries') or []):
            board = valid({'name': host, 'search_url': fact.get('url'), 'countries': [pool_tags.COUNTRIES.get(c, c) for c in fact['countries']]}, listing=True)
            if board and board['host'] == host:
                cells = [cell for cell in fact.get('relevant') or [] if cell['country'] in wanted]
                out.append({**board, **({'cells': cells} if cells else {})})
    return out


def _families(search):
    """The user's role families as the pool's fixed ids, from the same words the pool share sends (src/contribute.py fine_tags)."""
    from .. import pool_tags
    from ..contribute import _plain
    return set(pool_tags.families([_plain(k) for k in (search or {}).get('role_keywords', [])]))


def ranked(boards, search):
    """The boards best first by what they gave installs with this user's role families in these countries (owner, 18 Oct 2026: "relevant
    jobs per role"): jobs in their places per install, then fit 70+ per install; 'rank' is kept on each board (0: no data for this user).
    Boards without data keep their order after the ranked ones."""
    if not any(board.get('cells') for board in boards):
        return boards
    families = _families(search)
    for board in boards:
        cells = [cell for cell in board.pop('cells', None) or [] if cell['family'] in families]
        installs = sum(cell['installs'] for cell in cells)
        board['rank'] = round(sum(cell['in_places'] for cell in cells) / installs, 1) if installs else 0
        board['rank_fit70'] = round(sum(cell['fit70'] for cell in cells) / installs, 1) if installs else 0
    return sorted(boards, key=lambda board: (-board['rank'], -board['rank_fit70']))


def proven(search, limit=2):
    """The boards that gave installs like this one the most jobs in their places (rank > 0), best first, without any AI call: read in the
    first-jobs slice (src/first_jobs.py)."""
    from .. import places
    countries = places.countries(search, limit=None)
    return [board for board in ranked(served(countries), search) if board.get('rank')][:limit] if countries else []


def _merge(own, shared):
    """Shared boards first (ranked), then Claude's own proposals; a board in both keeps its rank and the shared link (the page measured to give
    local jobs, maybe a section of the board), with Claude's own kinds and place words."""
    merged = {board['host']: board for board in shared}
    for board in own:
        known = merged.get(board['host'], {})
        merged[board['host']] = {**known, **board, **({'search_url': known['search_url']} if known.get('search_url') else {})}
    return list(merged.values())[:MAX_BOARDS * 2]
