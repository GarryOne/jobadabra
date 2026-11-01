"""The reading recipes of visited sites: a layout learned with Claude (or served by the pool and checked again), how many visits in a row it
found nothing, and when it is forgotten.

Split out of visits.py (pure move; visits.py re-exports it). The store stays in visits.py and is looked up there at call time.
Guarded by tests/test_visits.py and test_visit_reader.py.
"""
import re



LAYOUT_LINE = range(-1, 31)


def layout_ok(recipe):
    """A layout in its checked, canonical form, or None: a CSS selector of plain selector characters, small line numbers, how to reach the next
    page; nothing else. The pool's check is the same (site/src/pool.js layoutOf): a served layout passes it again here before it is used."""
    if not isinstance(recipe, dict):
        return None
    selector, nxt = recipe.get('selector'), recipe.get('next')
    lines = [recipe.get(key) for key in ('title', 'company', 'place', 'link')]
    if not isinstance(selector, str) or not selector.strip() or len(selector) > 400 or re.search(r'[<{}`\\]|javascript:|url\(', selector, re.I):
        return None
    if not all(isinstance(n, int) and not isinstance(n, bool) and n in LAYOUT_LINE for n in lines) or lines[0] < 0:
        return None
    if not isinstance(nxt, str) or len(nxt) > 200 or re.search(r'[<>{}`]|javascript:', nxt, re.I):
        return None
    return {'selector': selector.strip(), 'title': lines[0], 'company': lines[1], 'place': lines[2], 'link': lines[3], 'next': nxt}


def recipe_for(url, now=None):
    """The reading recipe learned for this site (src/ai/visit_reader.py), or None. With none learned here, a layout at least 3 installs share for
    this host (the central pool, 8 Oct 2026: no Claude call to learn a site others already read), checked again and kept like a learned one,
    so it is forgotten after RECIPE_MISSES misses like any other. JOBADABRA_DISABLE=pool_layouts turns that off."""
    kept = ((visits._load().get('recipes') or {}).get(visits.host_of(url)) or {}).get('recipe')
    if kept:
        return kept
    from .. import features
    if features.disabled('pool_layouts'):
        return None
    served = layout_ok((visits.pool_facts().get('layout') or {}).get(visits.host_of(url)))
    if not served:
        return None
    with visits.LOCK:
        data = visits._load()
        data.setdefault('recipes', {})[visits.host_of(url)] = {'recipe': served, 'learned_at': (now or visits._now()).isoformat(timespec='seconds'), 'pooled': True}
        visits._save(data)
    print(f"Visit: how to read {visits.host_of(url)} came from the pool (no AI call)")
    return served


def save_recipe(url, recipe, now=None):
    """Keep a recipe Claude made for this site; the extension replays it with no AI until it stops finding jobs."""
    with visits.LOCK:
        data = visits._load()
        data.setdefault('recipes', {})[visits.host_of(url)] = {'recipe': recipe, 'learned_at': (now or visits._now()).isoformat(timespec='seconds')}
        visits._save(data)
    print(f"Visit: learned how to read {visits.host_of(url)}: blocks {recipe['selector'][:60]}, next page by {recipe['next']}")


RECIPE_MISSES = 2   # visits in a row on which a learned recipe found nothing, before it is learned again


def recipe_missed(url):
    """A recipe that found no jobs on a page where the quick guess found none either: maybe the page simply has none (a brand's list filtered
    to your place, 7 Oct 2026: Richemont's recipe was forgotten on one brand and learned again with Claude on the next, same layout). Kept
    until it misses RECIPE_MISSES visits in a row; a page read with jobs (read) resets the count. True when it is forgotten now."""
    with visits.LOCK:
        data = visits._load()
        kept = (data.get('recipes') or {}).get(visits.host_of(url))
        if not kept:
            return False
        kept['missed'] = kept.get('missed', 0) + 1
        gone = kept['missed'] >= RECIPE_MISSES
        if gone:
            data['recipes'].pop(visits.host_of(url))
        visits._save(data)
    print(f"Visit: the recipe for {visits.host_of(url)} found no jobs ({'twice in a row: learned again next time' if gone else 'kept: the page may have none'})")
    return gone


def forget_recipe(url):
    """A recipe that found nothing: dropped, so Claude is asked again."""
    with visits.LOCK:
        data = visits._load()
        if (data.get('recipes') or {}).pop(visits.host_of(url), None) is not None:
            visits._save(data)
            print(f'Visit: the recipe for {visits.host_of(url)} found no jobs; it is learned again')


from . import visits  # noqa: E402  (at the end: visits imports this file back, so importing this file first works too)
