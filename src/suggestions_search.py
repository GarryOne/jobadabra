"""Strategy's search suggestions as Focus Suggestions (spec docs/superpowers/specs/2026-10-28-insights-with-actions-design.md, PR 1b).

Matching roles in places you did not list, roles from your Profile, role words, your own filters and sites only you can open: each is an
entry of the pool (src/suggestions.py) with its top option in one press and "See all N", which opens its row on Strategy with every option.
Employers hiring people like you and more job sources stay on Strategy: their button only opens a list or a screen (owner, 28 Oct 2026,
sketch W6JoQf5fCfop8oxKwnRzrK: "a button that only opens a screen is noise").

Read from the last coverage check against today's settings (src/coverage.py: the summary every search saves) and the role ideas kept for
this search (src/ai/role_ideas.py): no AI call and no wait. A Not now or Not true on a row is kept against its key (keys()): its top option,
the one Focus offers; for role ideas, this search's role words (the AI's ideas change from day to day, the roles they are for do not).
Guarded by tests/test_suggestions_search.py.
"""
import re
import sys

from .suggestions import _entry

KINDS = ('places', 'ideas', 'coverage', 'filters', 'visits')   # on Focus and the Jobs bar
ROWS = ('places', 'coverage', 'filters', 'sources', 'visits', 'foryou')   # Strategy's rows from the coverage check: each answered by its key
SOURCE = 'Search strategy'
LABEL_MAX = 28   # a site's name on its button


def _n(value):
    return f'{int(value or 0):,}'


def _s(count, word, many=''):
    return word if count == 1 else (many or word + 's')


def _plain(fragment):
    return re.sub(r'\\b', '', str(fragment))


def options(verdict, row):
    """A Strategy row's options in its order, as (name its key uses, the option): what Strategy lists and Focus offers the first of."""
    verdict = verdict or {}
    from .coverage import KEY_SOURCES_OFFERED
    found = {'places': [(o['place'], o) for o in (verdict.get('places') or {}).get('options') or []],
             'coverage': [(s['term'], s) for s in verdict.get('suggestions') or []] if verdict.get('narrow') else [],
             'filters': [(e['fragment'], e) for e in verdict.get('excluded') or []] + [(item['language'], item) for item in verdict.get('languages') or []],
             'sources': [(s['id'], s) for s in verdict.get('sources') or []] if KEY_SOURCES_OFFERED else [],
             # A site with a caution note (an account a read may put at risk) is never the one-press top: its note is read on Strategy first
             'visits': sorted(((v['url'], v) for v in verdict.get('visits') or []), key=lambda pair: bool(pair[1].get('note'))),
             'foryou': [(e['company'], e) for e in verdict.get('for_you') or []]}
    return found.get(row, [])


def keys(verdict):
    """{row: key} for every Strategy row the check fills: the key its Not now or Not true is kept against (its top option)."""
    return {row: f'{row}:{found[0][0].lower()}' for row in ROWS if (found := options(verdict, row))}


def _see_all(row, count):
    return [{'label': 'See both' if count == 2 else f'See all {count}', 'do': 'see_all', 'row': row}] if count > 1 else []


def _search_entry(kind, key, title, detail, evidence, first, count, **extra):
    return {**_entry(kind, home='strategy', topic='search', source=SOURCE, title=title, detail=detail, evidence=evidence, key=key,
                     actions=[{**first, 'do': 'change_search'}] + _see_all(kind, count)), **extra}


def places_entry(verdict):
    """Matching roles just outside your places: Add <the place with most>."""
    found = options(verdict, 'places')
    if not found:
        return None
    top, more = found[0][1], len(found) - 1
    return _search_entry('places', keys(verdict)['places'], f"Add {top['place']} to your places",
                         f"{_n(top['count'])} matching {_s(top['count'], 'role')} outside your places" + (f' · and {more} more {_s(more, "place")}' if more else ''),
                         [f"{o['place']}: {_n(o['count'])} open {_s(o['count'], 'role')}, e.g. {'; '.join(o.get('examples') or [])}" for _, o in found],
                         {'label': f"Add {top['place']}", 'kind': 'place', 'value': top['place']}, len(found))


def coverage_entry(verdict):
    """The role words catch little of your places' postings and a word in the titles they miss would add some: Add role word."""
    found = options(verdict, 'coverage')
    if not found:
        return None
    term = found[0][0]
    return _search_entry('coverage', keys(verdict)['coverage'], f'Add "{term}" to your role words',
                         f"Your keywords catch {_n(verdict['matched'])} of {_n(verdict['in_places'])} postings in your places",
                         [f"{s['term']}: {_n(s['count'])} open {_s(s['count'], 'posting')}" for _, s in found],
                         {'label': 'Add role word', 'kind': 'role', 'value': term}, len(found))


def filters_entry(verdict):
    """Your own filters (a title word you left out, a language that rules a job out) hide matching jobs: Remove the first."""
    found = options(verdict, 'filters')
    if not found:
        return None
    hidden = sum(item.get('count') or 0 for _, item in found)
    words = [f'Titles with "{_plain(item["fragment"])}"' if 'fragment' in item else f'jobs requiring {item["language"].capitalize()}' for _, item in found]
    top = found[0][1]
    first = ({'label': f'Remove "{_plain(top["fragment"])}"', 'kind': 'exclude', 'value': top['fragment']} if 'fragment' in top
             else {'label': f'Allow jobs requiring {top["language"].capitalize()}', 'kind': 'language', 'value': top['language']})
    title = (f'{len(found)} of your filters hide' if len(found) > 1 else 'One of your filters hides') + f" {_n(hidden)} matching {_s(hidden, 'job')}"
    return _search_entry('filters', keys(verdict)['filters'], title, ' · '.join(words[:2]) + (f' and {len(words) - 2} more' if len(words) > 2 else ''),
                         [f"{word}: {_n(item.get('count'))} {_s(item.get('count'), 'job')}" for word, (_, item) in zip(words, found)], first, len(found))


def visits_entry(verdict):
    """Sites only you can open (employers that refuse automated visitors, portals with no other way in): Read the first, in your Chrome."""
    found = options(verdict, 'visits')
    if not found or found[0][1].get('note'):
        return None
    names = list(dict.fromkeys(v['name'] for _, v in found))   # one per company, as Strategy lists them
    top = found[0][1]
    name = top['name'] if len(top['name']) <= LABEL_MAX else top['name'][:LABEL_MAX - 1].rstrip() + '…'
    return _search_entry('visits', keys(verdict)['visits'], f"{len(names)} {_s(len(names), 'site')} only you can open",
                         ' · '.join(names[:3]) + (f' and {len(names) - 3} more' if len(names) > 3 else ''),
                         [f"{v['name']}: {v['why']}" for _, v in found], {'label': f'Read {name}', 'kind': 'visit', 'value': top['url']}, len(names))


def ideas_key(search):
    """Role ideas' key: this search's role words (src/ai/role_ideas.py search_key); the `role-ideas` command gives it to Strategy."""
    from .ai import role_ideas
    return f'ideas:{role_ideas.search_key(search)}'


def ideas_entry(ideas, key):
    """Roles from your Profile you do not search for yet, with openings in your places: Add the one with most. Not true also sets them aside
    for the AI (aside: the words the app keeps out of its next ideas)."""
    shown = [i for i in ideas or [] if i.get('word')]
    top = next((i for i in shown if (i.get('count') or 0) > 0), None)
    if not top:
        return None   # no openings: nothing one press would bring
    more = sum(1 for i in shown if (i.get('count') or 0) > 0) - 1
    return _search_entry('ideas', key, f"Add {top['role']} to your roles",
                         f"{_n(top['count'])} {_s(top['count'], 'opening')} now in your places" + (f' · and {more} more {_s(more, "role")}' if more else ''),
                         [f"{i['role']}: {i.get('why') or ''} ({_n(i.get('count'))} {_s(i.get('count'), 'opening')})" for i in shown],
                         {'label': 'Add role', 'kind': 'role', 'value': top['word']}, len(shown), aside=[i['word'] for i in shown])


def entries(verdict, ideas=(), ideas_key=''):
    """Every search entry that holds now, in Strategy's order."""
    found = [places_entry(verdict), ideas_entry(ideas, ideas_key), coverage_entry(verdict), filters_entry(verdict), visits_entry(verdict)]
    return [entry for entry in found if entry]


def ideas_on():
    """An AI is on for the role ideas: they carry the role suggestions, the fixed words none (src/coverage.py verdict by_ai)."""
    from . import features
    from .ai import engine
    return not features.disabled('role_ideas') and engine.ready()


def checked(search, summary, *, extras=False):
    """The coverage check against these settings, as Strategy's rows read it, with each row's key; None before the first search's summary.
    extras: what only Strategy draws (unused sources, employers for you, the employer meter)."""
    from . import coverage
    from .desktop_strategy import _visits
    places = search.get('locations') or {}
    said = coverage.verdict(summary, search.get('role_keywords') or [], [fragment for group in places.values() for fragment in group],
                            search.get('title_exclude_keywords') or [], by_ai=ideas_on(), extras=extras)
    if said is not None:
        said['languages'] = coverage.language_drops()
        said['visits'] = _visits(search)
        said['keys'] = keys(said)
    return said


def now(set_aside=()):
    """Focus's search entries from the last check and the kept role ideas, without the words a Not true set aside (src/suggestions.py
    set_aside); [] before the first search, or when they can't be read: Focus never fails on them. Why (insights PR 1b, owner 28 Oct 2026):
    the rows come to you, read from what the last search kept."""
    from . import coverage
    from .ai import role_ideas
    from .paths import load_search_config
    try:
        search, summary = load_search_config(), coverage.load()
        kept = role_ideas.kept(search, (summary or {}).get('missed_titles') or [], set_aside) if ideas_on() else []
        return entries(checked(search, summary), kept, ideas_key(search))
    except Exception as error:  # noqa: BLE001 - said in the engine log, then no search entries
        print(f'Warning: search suggestions not read ({type(error).__name__}: {error})', file=sys.stderr)
        return []
