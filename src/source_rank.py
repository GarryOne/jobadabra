"""Which sources a search starts from: the shared ranking per role kind × country of every source (employer feeds and job boards; a board
the web search found is a board), served in the employer index as `ranking` (jobadabra-web api/source-ranking.js; spec
docs/superpowers/specs/2026-10-18-search-learns-sources.md item B). Owner, 26 Oct 2026 ("Parallel + learned": each field + place remembers what
worked for every user): proven sources first, best by jobs located in your places per minute (fit 70+ breaks a tie); a source proven dead for
your kind and countries is skipped; 1 read slot in 5 of every run goes to a source nobody measured yet, so new ones are found. Read at second 0:
no AI call, no network (the index is already downloaded). The kind is a fixed-list value, never a branch here. Run order: jobadabra-33's lane
calls ranked_sources / order. Tests: tests/test_source_rank.py."""
import json

EXPLORE_EVERY = 5   # owner, 26 Oct 2026: 1 slot in 5, in every run (not 1 whole run in 5)
_FIELDS = {'installs': int, 'local': int, 'fit70': int, 'seconds': float, 'per_run': float, 'per_min': float}


def _num(value, kind):
    return kind(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0 else None


def clean(ranking):
    """The served ranking in its fixed shape only: {"<kind>|<country>": {'proven': [...], 'dead': ['employer:<ats>:<slug>' | 'board:<host>']}}."""
    out = {}
    for key, cell in (ranking.items() if isinstance(ranking, dict) else ()):
        if not (isinstance(key, str) and key.count('|') == 1 and isinstance(cell, dict)):
            continue
        proven = []
        for item in cell.get('proven') or []:
            if isinstance(item, dict) and item.get('kind') in ('employer', 'board') and isinstance(item.get('source'), str) and _num(item.get('local'), int) is not None:
                proven.append({'kind': item['kind'], 'source': item['source'][:200], **{k: _num(item.get(k), kind) for k, kind in _FIELDS.items()}})
        dead = [entry for entry in cell.get('dead') or [] if isinstance(entry, str) and entry.split(':', 1)[0] in ('employer', 'board')]
        if proven or dead:
            out[key] = {'proven': proven[:200], 'dead': dead[:3000]}
    return out


def _served(cache=None):
    from . import employer_index
    try:
        return clean(json.loads((cache or employer_index.CACHE).read_text()).get('ranking'))
    except (OSError, ValueError, AttributeError):
        return {}


def _ids(countries):
    """Country names (places.countries) or fixed ids, as the pool's fixed ids."""
    from . import pool_tags
    ids = {name.lower(): code for code, name in pool_tags.COUNTRIES.items()}
    return [c if c in pool_tags.COUNTRIES else ids.get(str(c).lower()) for c in countries or [] if c in pool_tags.COUNTRIES or ids.get(str(c).lower())]


def ranked_sources(search, countries, kinds=None, cache=None):
    """[{kind: 'employer'|'board', source: '<ats>:<slug>'|host, state: 'proven'|'dead', per_run, per_min, installs, why: 'pool'}] for this
    search's role kinds in these countries: proven ones best first (jobs per minute, then fit 70+, then jobs per run), then the dead. A source
    proven in one of your cells is never dead. [] when nobody shared anything for your kinds and countries yet (the run keeps its own order)."""
    if kinds is None:
        from . import contribute
        kinds = contribute.tags(search)[0]
    served, cells = _served(cache), [f'{kind}|{country}' for kind in kinds or [] for country in _ids(countries)]
    if not served or not cells:
        return []
    proven, dead = {}, set()
    for cell in (served.get(key) for key in cells):
        for item in (cell or {}).get('proven') or []:
            key = (item['kind'], item['source'])
            known = proven.setdefault(key, {**item, 'local': 0, 'fit70': 0, 'installs': 0, 'per_min': item['per_min']})
            for field in ('local', 'fit70', 'installs'):
                known[field] += item[field] or 0
            known['per_min'] = max(filter(lambda v: v is not None, (known['per_min'], item['per_min'])), default=None)
        dead |= {tuple(entry.split(':', 1)) for entry in (cell or {}).get('dead') or []}
    out = []
    for item in proven.values():
        out.append({'kind': item['kind'], 'source': item['source'], 'state': 'proven', 'installs': item['installs'], 'fit70': item['fit70'],
                    'per_run': round(item['local'] / item['installs'], 1) if item['installs'] else 0, 'per_min': item['per_min'], 'why': 'pool'})
    out.sort(key=lambda s: (-(s['per_min'] if s['per_min'] is not None else -1), -s['fit70'], -s['per_run'], s['source']))
    out += [{'kind': kind, 'source': source, 'state': 'dead', 'installs': None, 'fit70': 0, 'per_run': 0, 'per_min': 0, 'why': 'pool'}
            for kind, source in sorted(dead - set(proven))]
    return out


def key_of(candidate):
    """('employer', '<ats>:<slug>') for an employer feed, ('board', host) for a job board, as the ranking names them."""
    if candidate.get('host'):
        return 'board', str(candidate['host']).lower().removeprefix('www.')
    return 'employer', f"{candidate.get('ats', 'greenhouse')}:{candidate.get('slug') or candidate.get('board')}"


def order(candidates, search, countries, kinds=None, cache=None, key=key_of):
    """(ordered, skipped): the run's candidates (feed dicts with ats/slug, board dicts with host) with the proven first, best first, and every
    EXPLORE_EVERY-th slot given to one nobody measured yet (in the caller's order); `skipped` are the proven dead. No ranking for this search:
    the candidates as they came, nothing skipped (today's behaviour)."""
    ranked = ranked_sources(search, countries, kinds=kinds, cache=cache)
    if not ranked:
        return list(candidates), []
    place = {(s['kind'], s['source']): n for n, s in enumerate(ranked) if s['state'] == 'proven'}
    dead = {(s['kind'], s['source']) for s in ranked if s['state'] == 'dead'}
    proven = sorted((c for c in candidates if key(c) in place), key=lambda c: place[key(c)])
    untried = [c for c in candidates if key(c) not in place and key(c) not in dead]
    skipped = [c for c in candidates if key(c) in dead]
    ordered = []
    while proven or untried:
        explore = (len(ordered) + 1) % EXPLORE_EVERY == 0
        ordered.append((untried if (explore and untried) or not proven else proven).pop(0))
    return ordered, skipped
