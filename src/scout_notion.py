"""Source scout, the employers registry: the active store's employers (🌍 Employers & Sources in Notion, the employers table on this
Mac). Which feeds are active (`active_sources`, `own_feeds`), the local sources.json export, and writing each checked employer
(`write_employer`, `sync_employers`) through stores.employers (src/stores/base.py Employers).
Tests: tests/test_scout_notion_sync.py, tests/test_scout.py, tests/test_scout_employers_store.py (Notion users get today's pages).
"""

import json
import os
import re
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from . import employer_index, scout_core
from .paths import CONFIG
from .sources import ats, careers
from .scout_core import ensure_tables, key_for, now
from .scout_probe import board_url


def excluded_companies(seeds=None):
    """Keys of companies this user never wants suggested or crawled (seed list + JOBADABRA_EXCLUDED_COMPANIES)."""
    extra = [name for name in os.getenv('JOBADABRA_EXCLUDED_COMPANIES', '').split(',') if name.strip()]
    return {key_for(name.strip()) for name in (seeds or {}).get('excluded', []) + extra}


def active_sources(db, stores=None, static=(), index=()):
    """Feeds for feeds.scan: starter sources.json + the downloaded employer index + local feed_sources + the store's active
    employers with a feed (the owner's own list: Employers & Sources in Notion)."""
    ensure_tables(db)
    skip = excluded_companies()
    sources = {(s.get('ats', 'greenhouse'), s.get('slug') or s['board']): dict(s)
               for s in employer_index.merge(static, index, lambda company: key_for(company) in skip)}
    for row in db.execute('SELECT ats, slug, company FROM feed_sources WHERE active = 1'):
        sources.setdefault((row['ats'], row['slug']), {'company': row['company'], 'ats': row['ats'], 'slug': row['slug']})
    if stores:
        try:
            for name, system, slug in own_feeds(stores):
                sources.setdefault((system, slug), {'company': name, 'ats': system, 'slug': slug})
        except Exception as error:  # the store unreachable (Notion down): crawl what we know locally.
            print(f'Warning: Employers & Sources not read: {type(error).__name__}: {error}')
    return list(sources.values())


def own_feeds(stores):
    """[(company, ats, slug)] for every active employer of the store with a crawlable feed."""
    return [(row['name'], row['ats'], row['slug']) for row in stores.employers.list(active=True)
            if row['ats'] in ats.FETCHERS and row['slug']]


def export_sources(stores, path=CONFIG / 'sources.json', fetch=ats.fetch, today=None):
    """Write the shared starter list: config/sources.json plus every Active Employers & Sources feed.

    Only public facts go into git (company, ATS, board slug, open jobs, date checked); tiers, ratings,
    research notes and anything about your applications stay in your own Notion. Each feed is fetched
    once to confirm it answers; one that doesn't is left out and named in the result."""
    today = today or now().date().isoformat()
    existing = json.loads(path.read_text()) if path.exists() else []
    feeds_by_key = {}
    for entry in existing:
        system, slug = entry.get('ats', 'greenhouse'), entry.get('slug') or entry['board']
        feeds_by_key[(system, slug)] = entry['company']
    for name, system, slug in own_feeds(stores):
        feeds_by_key.setdefault((system, slug), name)

    def check(item):
        (system, slug), company = item
        try:
            return {'company': company, 'ats': system, 'slug': slug, 'jobs': len(fetch(system, slug)), 'checked': today}
        except Exception as error:  # noqa: BLE001 — a dead feed is reported, not fatal
            return {'company': company, 'ats': system, 'slug': slug, 'error': f'{type(error).__name__}: {error}'}

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(check, feeds_by_key.items()))
    kept = sorted((r for r in results if 'error' not in r), key=lambda r: (r['company'].lower(), r['ats'], r['slug']))
    path.write_text(json.dumps(kept, indent=2, ensure_ascii=False) + '\n')
    return kept, [r for r in results if 'error' in r]


def research_links(name):
    query = urllib.parse.quote(name)
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return (f'https://www.glassdoor.com/Search/results.htm?keyword={query}',
            f'https://www.levels.fyi/companies/{slug}/salaries')


# Each check outcome as Employers & Sources' Feed status (config/notion_schema.json lists the options). 'watch' was missing until
# 6 Oct 2026: a careers page with no open jobs today failed its Notion write with KeyError: 'watch'.
FEED_STATUS = {'found': 'Feed found', 'low': 'Low relevance', 'manual': 'Manual watch', 'none': 'No public feed', 'watch': 'No open jobs'}


def employer_record(candidate, outcome, today):
    """The employer's fields for one check outcome (the columns Find employers has always written), or None when it is not kept."""
    glassdoor, levels = research_links(candidate['name'])
    status, system, slug, score, stats = (outcome.get(k) for k in ('status', 'ats', 'slug', 'quality', 'stats'))
    if status == 'none' and candidate['tier'] != 'Tier 1':
        return None  # Keep the list focused: unfeedable standard companies are only tracked locally.
    record = {'name': candidate['name'], 'kind': 'Employer', 'tier': candidate['tier'], 'feed_status': FEED_STATUS[status],
              'active': status == 'found', 'origin': (candidate['origin'] or '')[:2000], 'glassdoor': glassdoor, 'levels_fyi': levels,
              'checked': today}
    if score is not None:
        record['quality'] = score
    if system:
        record.update({'ats': system, 'slug': (slug or '')[:2000], 'feed': board_url(system, slug), 'careers_url': board_url(system, slug)})
    elif candidate.get('careers'):
        record['careers_url'] = candidate['careers']
    if stats:
        record.update({'cities': ', '.join(stats['places'])[:2000], 'relevant_roles': stats['relevant'],
                       'in_preferred_places': stats['preferred'],
                       'notes': (f"{stats['jobs']} postings; {stats['relevant']} matching; {stats['preferred']} in "
                                 f"preferred places ({stats['swiss']} in your countries or cities); stack overlap "
                                 f"{int(stats['stack_share'] * 100)}%" + ('; salaries published' if stats['salary_published'] else ''))[:2000]})
    if status == 'found':
        record.update({'integration': 'Working', 'added': today})
    return record


def write_employer(stores, candidate, outcome):
    """One employer per candidate worth keeping, created or updated by name (stores.employers.upsert)."""
    record = employer_record(candidate, outcome, now().date().isoformat())
    if record:
        stores.employers.upsert(record)


def not_updated(stores, name):
    """The warning's words (renderer/run-warnings.js reads "Notion not updated for <company>": kept for Notion users)."""
    return f'Notion not updated for {name}' if stores.name == 'notion' else f'Employer list not updated for {name}'


def synced_key(stores):
    """Which list a "written there" mark belongs to: Notion's Employers & Sources database (a workspace connected later gets every
    employer again), else the store's name. '' when there is nowhere to write."""
    if stores is None:
        return ''
    database = getattr(stores.employers, 'database_id', None)
    return database if database is not None else stores.name


def mark_synced(db, key, stores):
    db.execute('INSERT OR IGNORE INTO notion_synced (db_id, key) VALUES (?, ?)', (synced_key(stores), key))
    db.commit()


def sync_employers(db, stores, limit=200):
    """Write every checked employer the store has not received yet: the ones checked before the app had this store (trying it, before
    connecting Notion), a write that failed, or a workspace connected later. Before 6 Oct 2026 they stayed only in this computer's scout
    table: three Find new employers runs (45 employers, Breitling's feed among them) never reached the user's Notion. Safe to repeat:
    write_employer matches employers by name. Returns (written, failed)."""
    where = synced_key(stores)
    if not where:
        return 0, 0
    # A duplicate (the same feed as one already read, under another name) is stored as 'found' so it is not checked again, but it never got a
    # row of its own (run() skips it): a 'found' is written only when its feed is registered under its own name (7 Oct 2026, e2e employers).
    rows = db.execute(f"""SELECT key, name, origin, tier, ats, slug, careers, website, status, quality, stats_json FROM scout_candidates c
        WHERE checked_at IS NOT NULL AND status IN ({','.join('?' * len(FEED_STATUS))})
        AND (status != 'found' OR EXISTS (SELECT 1 FROM feed_sources f WHERE f.ats = c.ats AND f.slug = c.slug AND f.company = c.name))
        AND key NOT IN (SELECT key FROM notion_synced WHERE db_id = ?) ORDER BY checked_at LIMIT ?""",
                      (*FEED_STATUS, where, limit)).fetchall()
    written = failed = 0
    for key, name, origin, tier, system, slug, careers, website, status, score, stats in rows:
        candidate = {'key': key, 'name': name, 'origin': origin, 'tier': tier, 'careers': careers, 'website': website}
        outcome = {'status': status, 'ats': system, 'slug': slug, 'quality': score, 'stats': json.loads(stats) if stats else None}
        try:
            write_employer(stores, candidate, outcome)
        except Exception as error:  # noqa: BLE001  one employer failing must not stop the others; tried again next time
            failed += 1
            print(f'Warning: {not_updated(stores, name)}: {type(error).__name__}: {error}')
            continue
        mark_synced(db, key, stores)
        written += 1
    return written, failed
