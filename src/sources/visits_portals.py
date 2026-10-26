"""The portals and employers offered for a visit: search pages for LinkedIn, Indeed, Glassdoor and levels.fyi built from the user's own role
word and place, and the scout's employers with no job list we can read.

Split out of visits.py (pure move; import it through visits, never first). No stored state here: visits.py imports and re-exports every
name. Guarded by tests/test_visits.py and test_visit_filters.py.
"""
import re
import urllib.parse

from ..paths import load_search_config


# Portals with no API for this: a visit is the way in. The search page is built from the user's own first role word and place.
PORTALS = {
    'linkedin': {'name': 'LinkedIn', 'host': 'linkedin.com', 'url': 'https://www.linkedin.com/jobs/search/?keywords={role}&location={place}',
                 'note': 'LinkedIn forbids reading its pages with an extension and may restrict accounts that do: one read per click keeps that small, not zero'},
    'indeed': {'name': 'Indeed', 'host': 'indeed.', 'url': 'https://{indeed}/jobs?q={role}&l={place}', 'note': ''},
    'glassdoor': {'name': 'Glassdoor', 'host': 'glassdoor.', 'url': 'https://www.glassdoor.com/Job/jobs.htm?sc.keyword={role}&locKeyword={place}', 'note': ''},
    'levelsfyi': {'name': 'levels.fyi', 'host': 'levels.fyi', 'url': 'https://www.levels.fyi/jobs?searchText={role}&location={place}', 'note': '', 'kinds': {'software'}},
}
# Indeed's site per country (7 Oct 2026: a Swiss search opened www.indeed.com and read jobs in Michigan); the search's own countries pick it.
INDEED = {'ch': 'ch.indeed.com', 'de': 'de.indeed.com', 'at': 'at.indeed.com', 'fr': 'fr.indeed.com', 'it': 'it.indeed.com', 'gb': 'uk.indeed.com',
          'ie': 'ie.indeed.com', 'nl': 'nl.indeed.com', 'be': 'be.indeed.com', 'lu': 'lu.indeed.com', 'es': 'es.indeed.com', 'pt': 'pt.indeed.com',
          'se': 'se.indeed.com', 'dk': 'dk.indeed.com', 'no': 'no.indeed.com', 'fi': 'fi.indeed.com', 'pl': 'pl.indeed.com', 'cz': 'cz.indeed.com',
          'ro': 'ro.indeed.com', 'gr': 'gr.indeed.com', 'us': 'www.indeed.com', 'ca': 'ca.indeed.com', 'au': 'au.indeed.com', 'sg': 'sg.indeed.com',
          'in': 'in.indeed.com', 'ae': 'ae.indeed.com', 'br': 'br.indeed.com', 'mx': 'mx.indeed.com', 'jp': 'jp.indeed.com'}


def _plain_words(fragments):
    """A search pattern as the words a portal's search box takes: a letter choice as its accented letter ("gen[èe]ve" -> "genève",
    7 Oct 2026: it became "gen ve", so LinkedIn ignored the place and showed the signed-in account's own suggestions), a choice of forms as
    the first one ("vendeu(r|se)" -> "vendeur"), an optional ending left out ("photograph(e|er)?" -> "photograph")."""
    def letter(match):
        choice = match.group(1)
        return next((c for c in choice if ord(c) > 127), choice[-1:])
    words = []
    for fragment in fragments:
        text = re.sub(r'\\b', '', str(fragment))
        text = re.sub(r'\([^()]*\)\?', '', text)
        text = re.sub(r'\(([^()|]*)\|[^()]*\)', r'\1', text)
        text = re.sub(r'\[([^\]]*)\]', letter, text)
        text = re.sub(r'\\(.)', r'\1', text)
        text = re.sub(r'[()?*+|^$]|\.\*', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        if text:
            words.append(text)
    return words


def portals(search=None, kinds=None):
    """The portal search pages for this user's first role word and place: [{key, name, url, note}]."""
    search = search or load_search_config(matching=False)
    roles = _plain_words(search.get('role_keywords') or [])
    places = _plain_words((search.get('locations') or {}).get('top_tier') or [])
    if not roles:
        return []
    from .. import pool_tags
    countries, _ = pool_tags.places([*places, *_plain_words((search.get('locations') or {}).get('country_wide') or [])])
    indeed = next((INDEED[country] for country in countries if country in INDEED), 'www.indeed.com')
    out = []
    for key, portal in PORTALS.items():
        if portal.get('kinds') and kinds is not None and not (portal['kinds'] & set(kinds)):
            continue
        url = portal['url'].format(role=urllib.parse.quote(roles[0]), place=urllib.parse.quote(places[0] if places else ''), indeed=indeed)
        out.append({'key': key, 'name': portal['name'], 'url': url, 'note': portal['note']})
    # Job boards found for your countries that refuse automated reading (src/sources/found_boards.py 'browser'): your own visit reads them.
    from ..ai import board_ideas
    for host, board in sorted((board_ideas.load().get('boards') or {}).items()):
        if board.get('state') != 'browser' or '{role}' not in str(board.get('search_url')):
            continue
        url = board['search_url'].replace('{role}', urllib.parse.quote(roles[0])).replace('{place}', urllib.parse.quote(places[0] if places else ''))
        out.append({'key': f'board:{host}', 'name': board.get('name') or host, 'url': url,
                    'note': 'A job board of your country that only a browser reads: open it, then click the Jobadabra icon'})
    return out


def unread_picks(db_path=None, limit=30):
    """Employers the scout picked for THIS search (its AI ideas and the user's own lists, never the old tech seed lists) that ended with no
    readable job site, with an address to open: [{name, url, origin}], best first. Owner, 7 Oct 2026: "for a photographer or store manager, start with
    H&M, Manor… the sites we cannot read ourselves that are relevant for such a candidate", not only LinkedIn and Glassdoor."""
    import sqlite3
    from ..paths import jobs_db
    try:
        with sqlite3.connect(db_path or jobs_db()) as db:
            rows = db.execute("""SELECT name, COALESCE(NULLIF(careers, ''), website), origin FROM scout_candidates
                WHERE status IN ('none', 'watch') AND COALESCE(NULLIF(careers, ''), website, '') LIKE 'http%'
                AND origin NOT LIKE 'Tier 1%' AND origin NOT LIKE 'Seed%' ORDER BY priority DESC, checked_at DESC LIMIT ?""", (limit,)).fetchall()
    except sqlite3.Error:
        return []
    return [{'name': name, 'url': url, 'origin': origin or ''} for name, url, origin in rows]   # origin: which list or search named it

