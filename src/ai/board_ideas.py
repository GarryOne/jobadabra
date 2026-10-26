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
                                                                   'where the place goes (left out when the board takes no place); a board '
                                                                   "of this field (sector) with no search page: its page that lists this field's jobs, else its home page"},
                   'countries': {'type': 'array', 'items': {'type': 'string'}, 'description': 'English country names it serves'},
                   'kinds': {'type': 'array', 'items': {'type': 'string'}},
                   'source_kind': {'type': 'string', 'enum': ['public_service', 'general', 'sector', 'regional', 'agency']}}}}}}
SYSTEM = """You know the job boards people really use to find work in each country. You get a job seeker's countries, places and roles. \
List 8 to 16 job boards (at least 8 when the country has them; not company career sites) where jobs for these roles in these places are posted: the country's \
public job service first (the state's own), then the general boards, then boards for these kinds of role (a developer board for developers, a hospitality board for chefs), then regional boards for these places and staffing agencies' boards. source_kind: public_service, general, sector, regional or agency. Leave out \
LinkedIn, Indeed, Glassdoor and levels.fyi. For each, its public search page as a template: https, the board's own address, {role} where \
the keywords go and {place} where the place goes (no {place} when the board has no place search); a board of this field with no search \
page: its page that lists this field's jobs, else its home page. Only boards you are confident exist with that address; fewer is better than a guess. kinds: from software, sales_b2b, sales_retail, logistics, hospitality, healthcare, \
creative_media, finance_admin, education, trades, engineering, business_ops, manufacturing, science, customer_service, legal, aviation_transport, \
public_security, other, any."""
SOURCE_KINDS = ('public_service', 'general', 'sector', 'regional', 'agency')
FIELD_SYSTEM = """You know the job boards people in each trade or field really use. You get a job seeker's roles, their kind of work and the \
places they want. List up to 16 job boards DEDICATED TO THIS FIELD that carry its jobs in these places: the field's international boards, its \
national boards in these countries, the job boards of its professional associations and unions, and the job sections of its trade magazines \
and news sites (a board for nurses, for truck drivers, for stage technicians, for pilots: whatever this field is). Not general boards (any \
job), not one employer's own career site, not LinkedIn, Indeed, Glassdoor or levels.fyi. For each: its search page as a template (https, \
{role} where the keywords go, {place} where the place goes, no {place} when it has none); a board with no search page: its page that lists \
this field's jobs, else its home page. source_kind: sector. kinds: from the given ones. Only boards you are confident exist; fewer is better \
than a guess."""   # one call per search, besides the per-country slices (owner's yes, 26 Oct 2026: "Field first"; tests/test_field_boards.py)
KINDS = (*ROLE_KINDS, 'any')   # src/role_kinds.py KINDS, plus a board for every kind


def _host(url):
    try:
        return (urllib.parse.urlsplit(url).hostname or '').lower().removeprefix('www.')
    except ValueError:
        return ''


def valid(board, listing=False):
    """The board in the shape the code reads, or None: https on its own host, {role} in it, nothing but the two placeholders. listing: a board the
    pool serves may be a page that lists the jobs (a section of the board, measured by the scout), so {role} is not required. A board the AI
    marked as one of the field's own (source_kind 'sector') may come as its category page or its home page, with no {role}: some field boards
    list their jobs only by category, and the read finds the field's section from the home page (src/sources/board_sections.py; owner's yes,
    26 Oct 2026; tests/test_board_category_pages.py). A general board's page without {role} is every job, not the field's: still dropped."""
    if not isinstance(board, dict):
        return None
    url, name = str(board.get('search_url') or '').strip(), re.sub(r'\s+', ' ', str(board.get('name') or '')).strip()[:60]
    host = _host(url.replace('{role}', 'x').replace('{place}', 'x'))
    category = board.get('source_kind') == 'sector' and '{place}' not in url
    if not (name and url.startswith('https://') and len(url) <= 300 and ('{role}' in url or listing or category) and host and '.' in host):
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
    own = list(_field(asked_for(search), client) or [])   # the field's own boards first: the slices' general ones come after (MAX_BOARDS * 2 cap)
    for part in asked:
        found = _proposal(part, client)
        if found is None:
            return _merge(own, shared)   # no AI or it failed: what is known so far, and the shared boards
        own.extend(board for board in found if board['host'] not in {b['host'] for b in own})
    return _merge(own, shared)


def _field(asked, client=None):
    """The boards of this search's field across all its places (FIELD_SYSTEM), one call cached per roles, kinds and countries; one the AI
    left unmarked is a field board ('sector'), one it marked general still needs a keyword search page (valid); None without AI or when the call failed. 26 Oct 2026, a First Officer in Europe: 10 slices of 5 countries asked
    "public service first, then general boards" gave 111 boards, 14 for aviation, 2 of them read; one field call gave 10-14 aviation boards."""
    if not asked:
        return None
    key, countries, roles, kinds, place_words = asked
    key = 'field-' + key
    data = load()
    if key in (data.get('ideas') or {}):
        return data['ideas'][key]
    answer = _ask(FIELD_SYSTEM, {'countries': countries, 'places': place_words, 'roles': roles, 'kinds': kinds}, client)
    if answer is None:
        return None
    found = list({b['host']: b for b in (valid({**item, 'source_kind': item.get('source_kind') or 'sector'}) for item in answer if isinstance(item, dict)) if b}.values())[:MAX_BOARDS]
    data = load()
    data.setdefault('ideas', {})[key] = found
    save(data)
    print(f"Job boards of your field: {', '.join(b['name'] for b in found) or 'none'}", flush=True)
    return found


def _ask(system, content, client=None):
    """The AI's boards for this instruction ([] when it named none), or None without AI or when the call failed (said in the log)."""
    try:
        from . import cost, engine
        if client is None:
            if not engine.ready():
                return None
            client = engine.client(action='scout')
        response = client.messages.create(
            model=MODEL, max_tokens=6000, system=[{'type': 'text', 'text': system}],
            messages=[{'role': 'user', 'content': json.dumps(content, ensure_ascii=False)}],
            output_config=engine.structured(SCHEMA, MODEL, 'low'))
        cost.side(MODEL, response.usage)
        if response.stop_reason != 'end_turn':
            raise RuntimeError(f'stopped with {response.stop_reason}')
        return json.loads(next(block.text for block in response.content if block.type == 'text')).get('boards') or []
    except Exception as error:  # noqa: BLE001 — the fixed boards and the shared ones still run
        print(f'Job boards: the AI proposed none this time ({reason(error)}); the known boards still run', flush=True)
        detail('job boards', error)
        return None


def _proposal(asked, client=None):
    """The validated boards Claude proposed for one slice (cached per its key), or None without AI or when the call failed."""
    key, countries, roles, kinds, place_words = asked
    data = load()
    if key in (data.get('ideas') or {}):
        return data['ideas'][key]
    answer = _ask(SYSTEM, {'countries': countries, 'places': place_words, 'roles': roles, 'kinds': kinds}, client)
    if answer is None:
        return None   # no AI: the boards other installs found for these countries
    data = load()
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
