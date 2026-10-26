"""Source scout, central index: the lists the central scout publishes to every install (feeds, boards, health, market coverage, unread
sites, dead ends) built from the installs' contributions, and `publish_index`.
Tests: tests/test_scout_stats.py, tests/test_employer_index.py, tests/test_contribute.py, tests/test_scout.py.
"""

import json
import re
import time
import urllib.parse
import urllib.request
from collections import Counter
from . import read_methods
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from datetime import datetime, timedelta
from . import contribute, pool_tags, regions, scout_carry, scout_kind_counts, scout_title_seed
from .notion import cron_runs
from .sources import ats, careers, feeds
from .scout_core import OUTCOMES, ensure_tables, _get_text, clean_name, key_for, now
from .scout_probe import job_places, quality, relevant_roles


MIN_INSTALLS = 1   # a contributed feed becomes a candidate when this many installs sent it; the scout verifies it either way. 1 since 6 Oct 2026
#                   (owner: grow the central employer list as much as possible): a job site's address is public company data, and one install's
#                   find (Coop, Migros, Manor on a photographer's Mac) now reaches every install the next night instead of waiting for a second.
OWN_MIN_INSTALLS = 3   # a feed only users added by hand (never found by a scout) becomes a candidate past this many installs: one person's own list stays theirs
FIT_MIN_INSTALLS = 5   # a role / region tag is published for a feed only when this many different installs matched it


def fetch_contributions(base_url, key, get=None, with_nofeed=False):
    """The opt-in aggregate from the website (`GET /api/contributions`, Bearer key); [] when unavailable: never fatal. With with_nofeed,
    (feeds, nofeed): also the employers installs found with no readable job site."""
    def default_get(request):
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    base = base_url.rsplit('/api/', 1)[0] + '/api/contributions'

    def pages(part, field):   # the site adds up in SQL and pages (`next`), so nothing is cut off as installs grow (7 Oct 2026)
        out, after = [], ''
        for _ in range(1000):
            query = urllib.parse.urlencode({'part': part, **({'after': after} if after else {})})
            answer = (get or default_get)(urllib.request.Request(f'{base}?{query}', headers={'Authorization': f'Bearer {key}', 'User-Agent': ats.USER_AGENT}))
            out += [item for item in answer.get(field, []) if isinstance(item, dict)]
            after = answer.get('next')
            if not after:
                return out
        return out
    try:
        feeds = pages('feeds', 'feeds')
        return (feeds, pages('nofeed', 'nofeed')) if with_nofeed else feeds
    except Exception as error:  # noqa: BLE001
        print(f'Warning: pool contributions not read ({type(error).__name__}: {error})')
        return ([], []) if with_nofeed else []


FIT_NAMES = ('roles', 'regions', 'countries', 'metros', 'families')   # finer labels since 7 Oct 2026, same floor
POOL_MIN_INSTALLS = 3   # outcome totals of a feed or board are published only past this many installs (k-anonymity)


def fits(contribution):
    """Role and region tags backed by enough different installs; nothing rarer is ever published. `quiet`: tags whose installs read the feed
    fine, FIT_MIN_INSTALLS of them or more, and none found a job there for that tag (7 Oct 2026): installs with that tag skip it."""
    out = {name: sorted(tag for tag, n in (contribution.get(name) or {}).items() if n >= FIT_MIN_INSTALLS) for name in FIT_NAMES}
    out = {name: tags for name, tags in out.items() if tags}
    quiet = {name: sorted(tag for tag, n in (contribution.get(f'quiet_{name}') or {}).items()
                          if n >= FIT_MIN_INSTALLS and not (contribution.get(name) or {}).get(tag)) for name in ('roles', 'families')}
    quiet = {name: tags for name, tags in quiet.items() if tags}
    return {**out, **({'quiet': quiet} if quiet else {})}


def pool_of(contribution):
    """What a feed led to across installs, published past POOL_MIN_INSTALLS: {installs, matched, applied, interview}, or None."""
    installs = int(contribution.get('installs') or 0)
    if installs < POOL_MIN_INSTALLS:
        return None
    out = contribution.get('out') or {}
    return {'installs': installs, 'matched': int(contribution.get('matched_installs') or 0), 'applied': int(out.get('applied') or 0),
            'interview': int(out.get('interview') or 0)}


def board_stats(boards):
    """Per job board, what it gives people by role kind, family, country and metro: [{board, installs, matched, by: {name: {tag: [installs,
    matched]}}}], each tag past POOL_MIN_INSTALLS only. Installs read it to say "gives a match to 6 in 10 people like you"."""
    out = []
    for board in boards or []:
        if not isinstance(board, dict) or int(board.get('installs') or 0) < POOL_MIN_INSTALLS:
            continue
        by = {}
        for name in FIT_NAMES:
            kept = {tag: [int(line.get('installs') or 0), int(line.get('matched') or 0)] for tag, line in (board.get(name) or {}).items()
                    if isinstance(line, dict) and int(line.get('installs') or 0) >= POOL_MIN_INSTALLS}
            if kept:
                by[name] = kept
        out.append({'board': board.get('board'), 'installs': int(board['installs']), 'matched': int(board.get('matched_installs') or 0), 'by': by})
    return out


def publish_summary(feeds, contributions, boards):
    """One line on what the pool added to this publish (7 Oct 2026: the log said only "Published N feeds"): feeds with labels, quiet marks and
    outcome totals, boards with stats, and the first quiet marks by label, so a wrong one can be traced."""
    labelled = sum(1 for f in feeds if any((f.get('fits') or {}).get(name) for name in FIT_NAMES))
    quiet = [(f['company'], tag) for f in feeds for tags in ((f.get('fits') or {}).get('quiet') or {}).values() for tag in tags]
    pooled = sum(1 for f in feeds if f.get('pool'))
    by_label = {}
    for company, tag in quiet:
        by_label.setdefault(tag, []).append(company)
    first = '; '.join(f"{tag}: {', '.join(names[:5])}{' …' if len(names) > 5 else ''}" for tag, names in sorted(by_label.items())[:8])
    return (f'Pool in this publish: {len(contributions)} shared feeds read, {labelled} feeds with labels, {len(quiet)} quiet marks, {pooled} with outcome totals, '
            f"{len(boards)} boards with stats{f' | quiet for {first}' if first else ''}")


BROKEN_MIN, BROKEN_SHARE = 5, 0.4   # one same error in at least this many feeds and this share of a system's feeds: its reader, not the feeds


def published_line(count, failed, feeds_out):
    """The publish's last lines: what did not answer, by system, and a warning for a system whose feeds mostly failed with one same error, a
    broken reader rather than dead feeds (26 Oct 2026: JOIN changed its page, 66 of the owner's 70 JOIN employers failed on every search, and
    the log said only "N did not answer"). Carried feeds are in `feeds_out` too, so a fully broken system with carry shows at 50%."""
    by_system = Counter(f['ats'] for f in failed)
    listed = Counter(f['ats'] for f in feeds_out)
    lines = [f'Published {count} feeds to the employer index ({len(failed)} did not answer'
             + (': ' + ', '.join(f'{system} {n}' for system, n in by_system.most_common()) if failed else '') + ')',
             # installs read only counted employers: 26 Oct 2026, 9 of 2,517 had counts and no line said so (src/scout_kind_counts.py)
             f"Kind counts by country on {sum(1 for f in feeds_out if f.get('kind_counts'))} of {len(feeds_out)} feeds"]
    for system, n in by_system.most_common():
        kind, same = Counter(re.sub(r'\d+', 'N', str(f.get('error') or ''))[:80] for f in failed if f['ats'] == system).most_common(1)[0]
        if same >= BROKEN_MIN and same >= BROKEN_SHARE * (n + listed[system]):
            lines.append(f'::warning::Scout: the {system} reader looks broken: {same} of its {n + listed[system]} feeds failed with "{kind}"')
    return '\n'.join(lines)


def fetch_boards(base_url, key, get=None):
    """The pool's per-board totals (`GET /api/contributions?part=boards`); [] when unavailable."""
    def default_get(request):
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    request = urllib.request.Request(base_url.rsplit('/api/', 1)[0] + '/api/contributions?part=boards',
                                     headers={'Authorization': f'Bearer {key}', 'User-Agent': ats.USER_AGENT})
    try:
        return [b for b in (get or default_get)(request).get('boards', []) if isinstance(b, dict)]
    except Exception as error:  # noqa: BLE001
        print(f'Warning: pool board totals not read ({type(error).__name__}: {error})')
        return []


def build_index(db, starter=(), fetch=ats.fetch, today=None, workers=8, contributions=(), boards=(), swiss_titles=None, deadline=None, carry=False):
    """Every feed we know (starter list + what this scout found), fetched once: [{company, ats, slug, tier, quality,
    jobs, checked}]. A feed that doesn't answer is left out (it comes back when it does); returns (feeds, failed)."""
    scout_title_seed.load()   # the titles counted on the owner's plan: the capped AI asks only new ones
    ensure_tables(db)
    today = today or now().date().isoformat()
    known = {(s.get('ats', 'greenhouse'), s.get('slug') or s['board']): {'company': s['company'], 'tier': 'Standard'}
             for s in starter}
    for row in db.execute('SELECT ats, slug, company, tier FROM feed_sources WHERE active = 1'):
        known[(row['ats'], row['slug'])] = {'company': row['company'], 'tier': row['tier']}
    board_keys = {(b['ats'], str(b['slug']).lower()) for b in boards}
    by_feed = {(c.get('ats'), c.get('slug')): c for c in contributions}
    for key, c in by_feed.items():   # what apps contributed: verified below like everything else
        installs = c.get('installs') or 0
        own_only = installs and (c.get('own_installs') or 0) >= installs
        if key not in known and key[0] in ats.FETCHERS and installs >= (OWN_MIN_INSTALLS if own_only else MIN_INSTALLS) and c.get('company'):
            known[key] = {'company': str(c['company'])[:120], 'tier': 'Standard'}

    def check(item):
        (system, slug), meta = item
        if deadline is not None and time.monotonic() > deadline:
            return {'skipped': True, 'ats': system, 'slug': slug}
        try:
            jobs = fetch(system, slug)
            if swiss_titles is not None:   # for the market coverage: the titles of this feed's jobs in Swiss places
                swiss_titles.extend(j['title'] for j in jobs if SWISS.search(j.get('location') or ''))
            score, _ = quality(jobs)
            kind = 'board' if (system, slug.lower()) in board_keys else 'employer'   # a job board of many companies is not an employer
            entry = {'company': clean_name(meta['company']) or meta['company'], 'ats': system, 'slug': slug, 'kind': kind, 'tier': meta['tier'], 'quality': score,
                     'jobs': len(jobs), 'relevant': relevant_roles(jobs), 'checked': today, 'places': job_places(jobs),
                     'regions': contribute.regions_of([j.get('location') or '' for j in jobs] + (['remote'] if any(j.get('remote') for j in jobs) else []))}
            entry['countries'] = pool_tags.countries(entry['places'])   # where its jobs are, as fixed ids: /admin/scouting's kind × country coverage
            kinds, counts = scout_kind_counts.of_jobs(jobs)   # what it hires for, and per country: installs read one with jobs of their kind there
            if kinds:
                entry['kinds'] = kinds
            if counts:
                entry['kind_counts'] = counts
            tags = fits(by_feed.get((system, slug), {}))
            pooled = pool_of(by_feed.get((system, slug), {}))
            if pooled:
                entry['pool'] = pooled
            if system == 'careers':   # how to read this page without AI, learned here: every install's crawl can use it
                from .sources import page_recipes
                recipe = page_recipes.load(careers.decode(slug), db)
                if recipe:
                    entry['recipe'] = recipe
            return {**entry, 'fits': tags} if tags else entry
        except Exception as error:  # noqa: BLE001 — a dead feed is reported, not fatal
            return {'company': meta['company'], 'ats': system, 'slug': slug, 'error': f'{type(error).__name__}: {error}'}

    items = scout_carry.order(db, list(known.items())) if carry else list(known.items())
    pool = ThreadPoolExecutor(max_workers=workers)
    try:
        futures = [(item, pool.submit(check, item)) for item in items]
        # No waiting past the deadline (+ a short grace): a fetch already under way may sit for minutes behind a slow site, and the job's limit does not
        # wait for it (23 Oct 2026: 20 workers were in a fetch when the run was cancelled). Such a feed is skipped, and carried over when `carry` is on.
        stop = None if deadline is None else deadline + FETCH_GRACE_S
        results = []
        for ((system, slug), _), future in futures:
            try:
                results.append(future.result(timeout=None if stop is None else max(0.0, stop - time.monotonic())))
            except FutureTimeout:
                results.append({'skipped': True, 'ats': system, 'slug': slug})
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    skipped = sum(1 for r in results if r.get('skipped'))
    left_over = [(r['ats'], r['slug']) for r in results if r.get('skipped')]
    if skipped:
        print(f'Scout: the time for checking feeds ran out; {skipped} of {len(results)} feeds were not read this run' +
              ('; those verified in the last %d days are carried over from their last read' % scout_carry.CARRY_DAYS if carry else ' and are left out of this index'))
    answered = [r for r in results if 'error' not in r and not r.get('skipped')]
    failed = [r for r in results if 'error' in r]
    quiet, fresh = health(db, answered, today, failed)
    kept = sorted(({**r, 'fresh': fresh[(r['ats'], r['slug'])]} for r in answered if (r['ats'], r['slug']) not in quiet),
                  key=lambda r: (r['company'].lower(), r['ats'], r['slug']))
    if carry:
        scout_carry.keep(db, kept, today)
        kept += scout_carry.carried(db, left_over, today)
        kept.sort(key=lambda r: (r['company'].lower(), r['ats'], r['slug']))
    return kept, failed


FETCH_GRACE_S = 20   # after the deadline, a feed fetch under way gets this long to answer
QUIET_DAYS = 90   # a feed with no open job of any kind for this long leaves the published index (it stays known, and returns when it lists jobs)


def health(db, entries, today, failed=()):
    """Each feed's freshness, kept from night to night: ({(ats, slug)} of feeds with no open job of any kind for QUIET_DAYS (left out of the
    index), {(ats, slug): fresh}). fresh = {ok: last read that worked, fails: failed reads in a row, jobs: open jobs now, trend: up/flat/down
    since the last read, new: last day it listed more jobs than before}.
    6 Oct 2026: a feed counted as alive only while it had a job in the central scout's own IT scope, so every shop, warehouse or care
    employer an install found would have left the list after 90 days. Now any open job keeps it, whatever the trade."""
    db.execute('CREATE TABLE IF NOT EXISTS feed_health (ats TEXT NOT NULL, slug TEXT NOT NULL, first_checked TEXT NOT NULL, '
               'last_relevant TEXT, PRIMARY KEY (ats, slug))')
    have = {row[1] for row in db.execute('PRAGMA table_info(feed_health)')}
    for column, kind in (('last_ok', 'TEXT'), ('fails', 'INTEGER DEFAULT 0'), ('jobs', 'INTEGER'), ('last_new', 'TEXT'), ('last_listed', 'TEXT')):
        if column not in have:
            db.execute(f'ALTER TABLE feed_health ADD COLUMN {column} {kind}')   # a table from before 6 Oct 2026
    cutoff = (datetime.fromisoformat(today) - timedelta(days=QUIET_DAYS)).date().isoformat()
    quiet, fresh = set(), {}
    for entry in failed:
        key = (entry['ats'], entry['slug'])
        db.execute('INSERT OR IGNORE INTO feed_health (ats, slug, first_checked) VALUES (?, ?, ?)', (*key, today))
        db.execute('UPDATE feed_health SET fails = COALESCE(fails, 0) + 1 WHERE ats = ? AND slug = ?', key)
    for entry in entries:
        key, jobs = (entry['ats'], entry['slug']), int(entry.get('jobs') or 0)
        db.execute('INSERT OR IGNORE INTO feed_health (ats, slug, first_checked) VALUES (?, ?, ?)', (*key, today))
        before = db.execute('SELECT jobs FROM feed_health WHERE ats = ? AND slug = ?', key).fetchone()[0]
        db.execute('UPDATE feed_health SET last_ok = ?, fails = 0, jobs = ?, last_new = CASE WHEN ? > COALESCE(jobs, 0) THEN ? ELSE last_new END, '
                   'last_listed = CASE WHEN ? > 0 THEN ? ELSE last_listed END, last_relevant = CASE WHEN ? THEN ? ELSE last_relevant END '
                   'WHERE ats = ? AND slug = ?', (today, jobs, jobs, today, jobs, today, bool(entry.get('relevant')), today, *key))
        row = db.execute('SELECT first_checked, last_listed, last_ok, fails, last_new FROM feed_health WHERE ats = ? AND slug = ?', key).fetchone()
        if (row[1] or row[0]) < cutoff:
            quiet.add(key)
        trend = 'flat' if before is None or before == jobs else 'up' if jobs > before else 'down'
        fresh[key] = {'ok': row[2], 'fails': row[3] or 0, 'jobs': jobs, 'trend': trend, 'new': row[4]}
    db.commit()
    return quiet, fresh


SWISS = re.compile(regions.SWITZERLAND, re.I)   # Switzerland's fixed table (src/regions.py): the Swiss market's numbers, the same towns everywhere
# Fixed words for the market coverage (engineering and IT, the central scout's own scope): the same words are asked of jobs.ch.
# One or two words per kind of role (src/role_kinds.py), as Swiss posts write them (German first, the most posts): the yardstick covers every
# kind of job, not IT alone (owner, 19 Oct 2026: "a global job search, across europe"; it was 12 IT words until then).
MARKET_TERMS = ('software engineer', 'devops', 'data engineer', 'key account', 'verkauf', 'logistik', 'chauffeur', 'koch', 'pflege', 'grafik',
                'buchhaltung', 'sachbearbeiter', 'lehrperson', 'elektriker', 'polymechaniker')


def market_coverage(titles, get=None, terms=MARKET_TERMS, pause=1.0, deadline=None):
    """[{term, ours, jobsch}]: open jobs in Swiss places whose title has the word, in our index vs jobs.ch's own total for it (None when
    jobs.ch did not answer). Indicative: jobs.ch also lists agencies and repeats, and our index holds employer feeds only."""
    get = get or _get_text
    lowered = [t.lower() for t in titles]
    out = []
    for term in terms:
        jobsch = None
        if deadline is not None and time.monotonic() > deadline:   # no more waiting for jobs.ch: counts of ours only
            out.append({'term': term, 'ours': sum(1 for t in lowered if term in t), 'jobsch': None})
            continue
        try:
            page = get('https://www.jobs.ch/en/vacancies/?' + urllib.parse.urlencode({'term': term}))
            found = re.search(r'(\d[\d,\u2019\'.]*)\s+jobs\b', page)
            jobsch = int(re.sub(r'\D', '', found.group(1))) if found else None
        except Exception as error:  # noqa: BLE001 — a count we cannot read is shown as unknown
            print(f'Warning: jobs.ch count for {term}: {type(error).__name__}')
        out.append({'term': term, 'ours': sum(1 for t in lowered if term in t), 'jobsch': jobsch})
        time.sleep(pause)
    return out


def run_headline(message):
    """What the run row and Recent activity say about this run: the card's title and its second line ("New employer sources · 7 checked · 2 new sources"). The title alone
    says nothing about the run (5 Oct 2026: the Notion row read "New employer sources (AI cost $0.003)")."""
    return ' · '.join(line for line in cron_runs.plain(message).split('\n')[:2] if line.strip())


def record_unread(db, unread):
    """Keep which job systems were named by a careers page but could not be read (table unread_systems: one row per system and company), and say so in the
    run's log with the vendor's count: the list of what is worth teaching next (an adapter, or a recipe learned once per vendor)."""
    db.execute('CREATE TABLE IF NOT EXISTS unread_systems (system TEXT NOT NULL, why TEXT NOT NULL, company TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY (system, company))')
    for system, why, company in unread:
        db.execute('INSERT OR REPLACE INTO unread_systems (system, why, company, seen_at) VALUES (?, ?, ?, ?)', (system, why, company, now()))
    if unread:
        counts = Counter(system for system, _, _ in unread)
        print('Unread job systems this run: ' + ', '.join(f'{system} ×{n}' for system, n in counts.most_common()) + ' (' + ', '.join(sorted({c for _, _, c in unread}))[:160] + ')')
    return Counter(system for system, _, _ in unread)


def source_kinds(db, feeds_out):
    """{source: {kind: employers}}: which kind of source found the employers of each kind in this list (by the main kind of their jobs), so
    /admin/scouting shows which source fills which gap (owner, 19 Oct 2026). Feeds no scout candidate led to: 'starter or installs'."""
    from .ai import scout_ideas
    from .scout_cells import top_kind
    origin = {(row[0], str(row[1]).lower()): row[2] for row in db.execute("SELECT ats, slug, origin FROM scout_candidates WHERE ats IS NOT NULL AND slug IS NOT NULL")}
    out = {}
    for feed in feeds_out:
        source = scout_ideas.origin_kind(origin.get((feed.get('ats'), str(feed.get('slug')).lower()), '')) or 'starter or installs'
        kinds = out.setdefault(source, {})
        kinds[top_kind(feed)] = kinds.get(top_kind(feed), 0) + 1
    return dict(sorted(out.items(), key=lambda item: -sum(item[1].values()))[:30])


def run_record(summary, results, at=None):
    """One central run, for /admin/scouting's run history: when, the cell its ideas aimed at, names added, employers checked and found."""
    return {'at': (at or now()).strftime('%Y-%m-%dT%H:%M'),   # no '+00:00': the site keeps runs by this exact shape (src/scouting.js)
            'added': summary.get('harvested', 0), 'checked': summary.get('checked', 0),
            'found': sum(1 for _, outcome in results if outcome.get('status') == 'found'), 'reads': read_methods.snapshot()}


def central_stats(db, feeds_out, market=(), run=None):
    """The central scout's own numbers for the website's /intel page: no user data, only counts and its own source names."""
    from .ai import scout_ideas

    def scalar(sql):
        try:
            return db.execute(sql).fetchone()[0] or 0
        except Exception:  # noqa: BLE001 — a table this scout never made counts as 0
            return 0
    try:
        meta = {row[0]: row[1] for row in db.execute('SELECT key, value FROM scout_meta')}
    except Exception:  # noqa: BLE001
        meta = {}
    return {'feeds': len(feeds_out), 'jobs': sum(f.get('jobs') or 0 for f in feeds_out), 'relevant': sum(f.get('relevant') or 0 for f in feeds_out),
            'by_ats': dict(Counter(f['ats'] for f in feeds_out)), 'by_region': dict(Counter(r for f in feeds_out for r in f.get('regions') or [])),
            'queue': {row[0]: row[1] for row in db.execute('SELECT status, COUNT(*) FROM scout_candidates GROUP BY status')},
            'recipes': scalar('SELECT COUNT(*) FROM page_recipes'), 'page_reads': scalar('SELECT COUNT(*) FROM page_reads'),
            'recipes_broken': scalar('SELECT COUNT(*) FROM page_recipes WHERE broken_at IS NOT NULL'),
            'quiet': scalar(f"SELECT COUNT(*) FROM feed_health WHERE COALESCE(last_relevant, first_checked) < date('now', '-{QUIET_DAYS} days')"),
            'link_choices': scalar('SELECT COUNT(*) FROM link_choices'), 'commoncrawl': meta.get('commoncrawl', ''),
            'unread_systems': {row[0]: row[1] for row in db.execute('SELECT system, COUNT(*) FROM unread_systems GROUP BY system')} if scalar("SELECT COUNT(*) FROM sqlite_master WHERE name = 'unread_systems'") else {},
            'ideas_at': meta.get('ideas_at', ''), 'ideas_note': meta.get('ideas_note', ''), 'ideas_cell': meta.get('ideas_cell', ''),
            'source_kinds': source_kinds(db, feeds_out), 'run': {**run, 'cell': meta.get('ideas_cell', '')} if run else None,
            'sources': [{'origin': s['origin'], 'probed': s['probed'], 'found': s['found']} for s in scout_ideas.origin_yield(db)[:25]],
            'market': list(market)}


MAX_DEAD_ENDS = 10000   # the list reached its old cap of 5,000 on 20 Oct 2026, so the rest was probed again and again; ~1 MB at this size


def dead_ends(db, shared=(), days=30):
    """[{key, company, host, last}] to publish: employers installs (shared) or this central scout found with no readable job site in the
    last `days` days. Installs skip them for 30 days (src/employer_index.central_nofeed)."""
    since = (now() - timedelta(days=days)).date().isoformat()
    out = {}
    for item in shared:
        key, last = str(item.get('key') or ''), str(item.get('last') or '')
        if re.fullmatch(r'[a-z0-9]{1,120}', key) and last >= since:
            out[key] = {'key': key, 'company': str(item.get('company') or '')[:120], 'host': item.get('host'), 'last': last[:10],
                        'outcome': item.get('outcome') if item.get('outcome') in OUTCOMES else 'no_feed'}
    for row in db.execute("SELECT name, website, checked_at, outcome FROM scout_candidates WHERE status = 'none' AND checked_at >= ?", (since,)):
        key = key_for(row[0])
        if key and key not in out:
            host = re.sub(r'^https?://(www\.)?', '', row[1] or '').split('/')[0].lower() or None
            out[key] = {'key': key, 'company': str(row[0])[:120], 'host': host, 'last': str(row[2])[:10],
                        'outcome': row[3] if row[3] in OUTCOMES else 'no_feed'}
    return sorted(out.values(), key=lambda item: item['last'], reverse=True)[:MAX_DEAD_ENDS]   # past the cap the oldest drop out, not the newest


def publish_index(feeds, url, key, send=None, stats=None, nofeed=None, boards=None, board_facts=None):
    """Upload the index to the website worker (PUT, Bearer key), with the scout's own numbers. Raises when the service refuses it."""
    if not feeds:
        raise ValueError('nothing to publish: no feed answered')
    body = json.dumps({'feeds': feeds, 'generated': now().isoformat(timespec='seconds'), **({'stats': stats} if stats else {}),
                       **({'nofeed': nofeed} if nofeed else {}), **({'boards': boards} if boards else {}),
                       **({'board_facts': board_facts} if board_facts else {})}).encode()

    def put(request):
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status
    request = urllib.request.Request(url, data=body, method='PUT', headers={
        'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'User-Agent': ats.USER_AGENT})
    status = (send or put)(request)
    if status != 200:
        raise RuntimeError(f'index upload answered {status}')
    return len(feeds)
