"""Opt-out ("Help the pool grow", on by default): tell the central pool which employer career pages and job boards this install reads, with coarse tags (private spec jobadabra-lab:docs/specs/2026-09-30-pool-contributions.md).

Only public facts go up (ATS, board slug, company, a fixed board id, job counts; facts about sites: a company's job page without its query,
a site only a browser reads, a dead page) plus role families and regions from fixed lists, and up to 40 public posting addresses (src/contribute_candidates.py: address, host and
source only, for the daily discovery batch). Nothing else about jobs, applications, the CV or the person. Sent only when JOB_PILOTTO_SHARE_EMPLOYERS=1 (the app sets it: on unless the user switched it off);
`python -m src contribute --show` prints exactly what would be sent, on or off.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import math
import os
import re
import urllib.request

from .paths import DATA, load_search_config
from . import contribute_candidates, contribute_yield, pool_served
from .sources import ats

URL = 'https://www.jobpilotto.top/api/contribute'
STAMP = DATA / 'contribution_sent.json'
EVERY = timedelta(0)   # no wait: shared as it is produced (owner, 6 Oct 2026; was once a day, then 10 minutes); the site allows 30 a minute
MAX_FEEDS = 2000   # every feed a check read (7 Oct 2026); the most useful first, so a cut drops the quietest

# Job boards and other non-employer sources, by fixed id (a run's own names can carry a search or a place: never sent).
BOARDS = {'jobs.ch': 'jobsch', 'Arbeitnow': 'arbeitnow', 'Himalayas': 'himalayas', 'Jobicy': 'jobicy', 'Adzuna': 'adzuna', 'Jooble': 'jooble',
          'Google Jobs': 'google_jobs', 'LinkedIn alerts': 'alerts_linkedin', 'jobs.ch alerts': 'alerts_jobsch', 'jobup.ch alerts': 'alerts_jobup',
          'Indeed alerts': 'alerts_indeed', 'Glassdoor alerts': 'alerts_glassdoor'}


def board_id(name):
    """The fixed id of a run source name ('Google Jobs: photographe / Genève' -> 'google_jobs', 'Adzuna CH' -> 'adzuna'), or None."""
    base = str(name or '').split(':')[0].strip()
    base = f'{base}s' if base.endswith(' alert') else base   # the job store names alert jobs "LinkedIn alert"
    for known, ident in BOARDS.items():
        if base == known or base.startswith(f'{known} ') and not base.endswith(' alerts'):
            return ident
    return None


# Outcomes and traits per feed and board, counted on this install over 90 days (7 Oct 2026): what a source led to, not only what it matched.
# Fixed names and counts only; a job's title, company and address never leave.
STRONG_FIT = 70   # one bar for everyone, so installs compare
OUTCOME_DAYS = 90
LADDER = {'saved': {'Saved', 'Kit ready', 'Applying'}, 'applied': {'Applied', 'Confirmation received', 'No response', 'Rejected', 'Withdrawn'},
          'interview': {'Screening', 'Interview scheduled', 'Interviewing'}, 'offer': {'Offer'}}
STEPS = ['saved', 'applied', 'interview', 'offer']   # each step counts the ones after it too: an interview was applied to
SENIORITY = ['junior', 'mid', 'senior', 'staff_principal', 'lead_manager']
LANGS = ['English', 'German', 'French', 'Italian', 'Spanish', 'Portuguese', 'Dutch', 'Other']


def outcomes(db, stages=None, now=None):
    """{source name: {'strong', 'saved', 'applied', 'interview', 'offer', 'langs', 'senior', 'remote'}} for jobs first seen in the last 90 days.
    Source name = the feed's company or the board's name, as the job store keeps them."""
    if db is None:
        return {}
    since = ((now or datetime.now(timezone.utc)) - timedelta(days=OUTCOME_DAYS)).isoformat(timespec='seconds')
    have = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if 'jobs' not in have:
        return {}
    score_sql = "(SELECT data_json FROM scores WHERE job_id = j.id)" if 'scores' in have else 'NULL'
    facts_sql = "(SELECT data_json FROM enrichments WHERE job_id = j.id)" if 'enrichments' in have else 'NULL'
    stage_of = {url.strip(): stage for url, stage in (stages or {}).items()}
    out = {}
    for name, url, score_json, facts_json in db.execute(f"""SELECT s.name, j.url, {score_sql}, {facts_sql} FROM jobs j JOIN sources s ON s.id = j.source_id
            WHERE j.first_seen_at >= ?""", (since,)):
        line = out.setdefault(name, {'strong': 0, **{step: 0 for step in STEPS}, 'langs': {}, 'senior': {}, 'remote': 0})
        try:
            score = (json.loads(score_json) or {}).get('score') if score_json else None
        except ValueError:
            score = None
        if isinstance(score, (int, float)) and score >= STRONG_FIT:
            line['strong'] += 1
        stage = stage_of.get(str(url or '').strip())
        reached = next((i for i, step in reversed(list(enumerate(STEPS))) if stage in LADDER[step]), None)
        for step in STEPS[:(reached + 1) if reached is not None else 0]:
            line[step] += 1
        if facts_json and isinstance(score, (int, float)):   # traits of the jobs that were scored, i.e. that matched the search
            try:
                facts = json.loads(facts_json) or {}
            except ValueError:
                facts = {}
            first = next((l.get('language') for l in facts.get('languages') or [] if l.get('level') == 'required'), None)
            if first in LANGS:
                line['langs'][first] = line['langs'].get(first, 0) + 1
            level = (facts.get('seniority') or {}).get('value')
            if level in SENIORITY:
                line['senior'][level] = line['senior'].get(level, 0) + 1
            if (facts.get('work_mode') or {}).get('value') == 'remote':
                line['remote'] += 1
    return out


def _with_outcomes(item, line):
    if not line:
        return item
    extra = {key: line[key] for key in ('strong', *STEPS, 'remote') if line.get(key)}
    extra.update({key: line[key] for key in ('langs', 'senior') if line.get(key)})
    return {**item, **({'out': extra} if extra else {})}


def boards_read(report, feed_names):
    """One line per board this run read: jobs listed, jobs that matched, how many of those matches came from an employer whose own feed this
    run also read (`dup`: the board added nothing there), and whether every read of it failed. Counts only."""
    out = {}
    dups = {}
    for job in report.get('jobs', []):
        ident = board_id(job.get('source'))
        if ident and job.get('company') in feed_names:
            dups[ident] = dups.get(ident, 0) + 1
    for source in report.get('sources', []):
        if source.get('company') in feed_names:
            continue
        ident = board_id(source.get('company'))
        if not ident:
            continue
        line = out.setdefault(ident, {'board': ident, 'jobs': 0, 'hits': 0, 'failed': True})
        if source.get('ok'):
            line['jobs'] += int(source.get('total') or 0)
            line['hits'] += int(source.get('matches') or 0)
            line['failed'] = False
    for ident, line in out.items():
        line['dup'] = min(dups.get(ident, 0), line['hits'])
    return list(out.values())

# Fixed lists: the only tags that ever leave the machine.
ROLES = {'software': 'software development (backend, frontend, full stack, web)', 'sre_devops': 'SRE, DevOps, platform, cloud, infrastructure, systems',
         'data': 'data, analytics, BI, machine learning, AI', 'security': 'security', 'mobile': 'mobile (iOS, Android)', 'qa': 'QA, testing',
         'management': 'engineering management, tech lead, CTO, director'}
# And the kinds of role of every other trade (src/role_kinds.py KINDS), sent by name: the site accepts this same list (jobadabra-web shared/pool-labels.js ROLES).
TRADE_ROLES = ['sales_b2b', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades', 'engineering', 'business_ops', 'manufacturing', 'science', 'customer_service', 'legal', 'aviation_transport', 'public_security']
REGIONS = {'europe': 'Europe (EU, EMEA, UK, Switzerland, ...)', 'north_america': 'North America', 'latin_america': 'Latin America',
           'asia_pacific': 'Asia-Pacific', 'middle_east_africa': 'Middle East and Africa'}
# Which of these a role or place word is, in any language, is decided by AI (src/ai/meanings.py labels); without AI: none (8 Oct 2026).


def _plain(fragment):
    """A search.json regex fragment as plain words ('\\bberlin\\b' -> 'berlin')."""
    return re.sub(r'\\b|\\|[()?]|\.\*', ' ', fragment).strip()


def regions_of(places):
    """The fixed-list regions a feed hires in, from its places in any language ('Zürich, Switzerland' -> europe); 'remote' when a place is
    only "remote" (or the feed flags it: the caller passes 'remote')."""
    from .ai import meanings
    places = [p for p in places if p]
    found = set(meanings.labels('job-region', [p for p in places if p != 'remote'], {**REGIONS, 'remote': 'remote or anywhere, no region named'},
                                'Where a job is, as its posting writes it. Answer its region.'))
    return sorted(found | ({'remote'} if 'remote' in places else set()))


def fine_tags(search=None):
    """{'countries', 'metros', 'families'} of this user's own search settings, as fixed-list ids (src/pool_tags.py). No free text ever."""
    from . import pool_tags
    # The user's own words, not the place words the crawl adds for matching (7 Oct 2026, the pool e2e: "Suisse" became all ten Swiss metros).
    search = search or load_search_config(matching=False)
    places = search.get('locations', {})
    own = lambda groups: [_plain(p) for group in groups for p in places.get(group, [])]  # noqa: E731
    countries, _ = pool_tags.places(own(('top_tier', 'country_wide', 'abroad')))
    _, metros = pool_tags.places(own(('top_tier',)))   # metro areas: only the places named first, not a whole country
    return {'countries': countries, 'metros': metros, 'families': pool_tags.families([_plain(k) for k in search.get('role_keywords', [])])}


def tags(search=None):
    """(roles, regions) of this user's own search settings, as fixed-list names. No free text ever."""
    search = search or load_search_config(matching=False)   # their own words, not the crawl's added place words
    from .ai import meanings
    roles = set(meanings.labels('pool-role', [_plain(k) for k in search.get('role_keywords', [])], ROLES, 'A role a job seeker looks for. Answer its tech area.'))
    # The other trades by the role kinds (src/role_kinds.py), so a shop or warehouse search is not just 'other' (6 Oct 2026). Fixed names.
    from .role_kinds import UNKNOWN, of_search
    roles |= (of_search(search) or set()) - {'software', 'other', UNKNOWN}
    places = [_plain(p) for group in ('top_tier', 'country_wide', 'abroad') for p in search.get('locations', {}).get(group, [])]
    regions = set(meanings.labels('pool-region', places, REGIONS, 'A place a job seeker searches in. Answer its region.'))
    return sorted(roles) or ['other'], sorted(regions)


# How an install found a feed, from the scout's candidate origin: fixed words only (the site accepts this same list: site/src/pool.js HOW).
HOW = (('AI idea', 'ai_idea'), ('AI list', 'ai_list'), ('jobs.ch employer', 'jobs_ch'), ('Wikidata', 'wikidata'), ('Tier 1 seed', 'seed'),
       ('Seed list', 'seed'), ('Hacker News', 'hn'), ('hiring-without-whiteboards', 'whiteboards'), ('SwissDevJobs', 'swissdevjobs'))


def how_of(origin):
    return next((word for prefix, word in HOW if str(origin or '').startswith(prefix)), 'other')


def found_here(db):
    """{(ats, slug): {'how', 'site'}} of the feeds this install's own scout verified (src/scout.py feed_sources), with how it found them."""
    if db is None:
        return {}
    try:
        rows = db.execute("""SELECT f.ats, f.slug, c.origin, c.careers FROM feed_sources f
            LEFT JOIN scout_candidates c ON c.ats = f.ats AND c.slug = f.slug WHERE f.active = 1""").fetchall()
    except Exception:  # noqa: BLE001 — no scout tables yet: nothing found here
        return {}
    site = lambda url: url if isinstance(url, str) and url.startswith('https://') and len(url) <= 200 else None
    return {(row[0], row[1]): {'how': how_of(row[2]), 'site': site(row[3])} for row in rows}


def dead_ends(db, days=30):
    """[{company, host}] of employers this install's scout found with no readable job site, with the current readers, in the last `days`
    days (6 Oct 2026): shared so other installs do not probe the same employer again for a while. Public names and website hosts only."""
    if db is None:
        return []
    from . import scout, scout_core
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec='seconds')
    try:
        scout_core.ensure_tables(db)
        rows = db.execute("SELECT name, website, outcome FROM scout_candidates WHERE status = 'none' AND checked_at >= ? AND checked_with = ? LIMIT 300",
                          (since, scout.READERS)).fetchall()
    except Exception:  # noqa: BLE001 — no scout tables yet
        return []
    host = lambda site: (re.sub(r'^https?://(www\.)?', '', site or '').split('/')[0].lower() or None) if site else None
    return [{'company': str(row[0])[:120], 'host': host(row[1]), 'outcome': row[2] if row[2] in scout_core.OUTCOMES else 'no_feed'} for row in rows]


def site_facts(limit=300, db=None):
    """[{host, kind, url?}] facts about employer sites this install learned while reading them (7 Oct 2026): where a company's job list is
    (jobpage), that a site refuses automated visitors so only a browser reads it (browser), a job page that is gone (dead). Public facts
    about sites, never which ones this person opened or what they found there; the central pool serves a fact once 3 installs agree.
    db: the job cache, for what each found board gave (counts only)."""
    from . import source_yield
    from .sources import visits
    data = visits._load()
    out, seen = [], set()
    def add(host, kind, url=None):
        host = (host or '').lower().removeprefix('www.')
        if not re.fullmatch(r'[a-z0-9.-]+\.[a-z]{2,}', host) or (host, kind) in seen:
            return
        if url is not None and not (isinstance(url, str) and url.startswith('https://') and len(url) <= 200 and '#' not in url):
            return
        seen.add((host, kind))
        out.append({'host': host, 'kind': kind, **({'url': url} if url else {})})
    for host, url in (data.get('jobpages') or {}).items():   # the address without its query: that is where someone's own filters sit (?location=Geneva)
        add(host, 'jobpage', str(url).split('#')[0].split('?')[0])
    for site in (data.get('sites') or {}).values():
        add(visits.host_of(site.get('url') or ''), 'browser')
    reads = data.get('reads') or {}
    for host, kept in (data.get('recipes') or {}).items():   # a layout that read jobs here and never missed; never one the pool gave us
        layout = visits.layout_ok((kept or {}).get('recipe'))
        if layout and not kept.get('missed') and not kept.get('pooled') and (reads.get(host) or {}).get('jobs'):
            if (host.lower().removeprefix('www.'), 'layout') not in seen and re.fullmatch(r'[a-z0-9.-]+\.[a-z]{2,}', host.lower().removeprefix('www.')):
                seen.add((host.lower().removeprefix('www.'), 'layout'))
                out.append({'host': host.lower().removeprefix('www.'), 'kind': 'layout', 'recipe': layout})
    # Job boards found for this install's countries that read jobs (src/sources/found_boards.py): the search template (never the filled search,
    # which holds the user's own words) and the countries it serves, as the pool's fixed ids.
    from . import pool_tags
    from .ai import board_ideas
    from .sources.careers_parse import registrable
    ids, counts = {name: code for code, name in pool_tags.COUNTRIES.items()}, source_yield.board_counts(db) if db is not None else {}
    for host, board in (board_ideas.load().get('boards') or {}).items():
        countries = sorted({ids[c] for c in board.get('countries') or [] if c in ids})
        if board.get('state') == 'ok' and countries and (host, 'board') not in seen and re.fullmatch(r'[a-z0-9.-]+\.[a-z]{2,}', host):
            seen.add((host, 'board'))
            given = counts.get(registrable(host))   # what it gave this search (source_yield), summed per family × country by the site
            out.append({'host': host, 'kind': 'board', 'url': board.get('search_url'), 'board': {'countries': countries}, **({'yield': given} if given else {})})
    for url in (data.get('jobpage_bad') or {}):
        add(visits.host_of(url), 'dead', str(url).split('#')[0].split('?')[0])
    from .sources import refused_reads   # what this install's browser met on refused sites (owner, 20 Oct 2026: every install learns from it)
    out += [fact for fact in refused_reads.shared() if re.fullmatch(r'[a-z0-9.-]+\.[a-z]{2,}', fact['host'])]
    from .sources import read_routes
    out += read_routes.facts()   # which way a site's posting text is read, as the pool's fixed words
    return out[:limit]


def payload(feed_list, report, stores=None, install=None, search=None, db=None, stages=None):
    """What would be sent (v2): every feed this install's scout verified, the feeds that gave this user a job (`matched`) and the ones they
    added themselves (`own`), each with how it was found, jobs listed, jobs that matched in their places, its job site and a failed read
    (6 Oct 2026: only matched or own feeds went, without numbers, so most finds stayed on the Mac)."""
    from . import scout
    matched = {s['company'] for s in report.get('sources', []) if s.get('ok') and s.get('matches')}
    read = {s['company']: s for s in report.get('sources', [])}
    found, given = found_here(db), contribute_yield.employer_counts(db)   # jobs located in your places per feed (api/source-ranking.js)
    own = set()
    if stores:
        try:
            own = {(system, slug) for _, system, slug in scout.own_feeds(stores)}
        except Exception as error:  # noqa: BLE001 — store trouble (Notion down) just means no "own" flags today
            print(f'Warning: own employers not read for the pool: {type(error).__name__}')
    feeds = []
    for source in feed_list:
        system, slug = source.get('ats', 'greenhouse'), source.get('slug') or source.get('board')
        if system not in ats.FETCHERS or not slug or system in ats.LOCAL_ONLY:   # a page read through someone's own visit is theirs, not a feed
            continue
        is_own, is_matched, here = (system, slug) in own, source['company'] in matched, found.get((system, slug))
        seen = read.get(source['company']) or {}
        if is_own or is_matched or here or seen:   # every feed read, also with no match: "read fine, nothing for this role here" (7 Oct 2026)
            feeds.append({'ats': system, 'slug': slug, 'company': source['company'][:120], 'matched': is_matched, 'own': is_own,
                          'how': (here or {}).get('how') or ('own' if is_own else 'index'), 'site': (here or {}).get('site'),
                          **({'jobs': int(seen.get('total') or 0), 'hits': int(seen.get('matches') or 0)} if seen.get('ok') else {}),
                          **(contribute_yield.feed_counts(given, source['company'], seen) if given is not None else {}),
                          'failed': bool(seen) and not seen.get('ok')})
    feeds.sort(key=lambda f: (not (f['matched'] or f['own'] or f['how'] != 'index'), -(f.get('hits') or 0), -(f.get('jobs') or 0)))
    if stages is None and stores:
        try:
            stages = {row['url'].strip(): row['stage'] for row in stores.applications.list() if row['url']}
        except Exception as error:  # noqa: BLE001 — store trouble just means no outcomes this time
            print(f'Warning: outcomes not read for the pool: {type(error).__name__}')
    led = outcomes(db, stages)
    feeds = [_with_outcomes(feed, led.get(feed['company'])) for feed in feeds]
    roles, regions = tags(search)
    nofeed = dead_ends(db)
    boards = boards_read(report, {s['company'] for s in feed_list})
    by_board = {}
    for name, line in led.items():
        ident = board_id(name)
        if ident:   # Google Jobs is one board, whatever search found it
            merged = by_board.setdefault(ident, {'strong': 0, **{step: 0 for step in STEPS}, 'langs': {}, 'senior': {}, 'remote': 0})
            for key in ('strong', *STEPS, 'remote'):
                merged[key] += line[key]
            for key in ('langs', 'senior'):
                for tag, n in line[key].items():
                    merged[key][tag] = merged[key].get(tag, 0) + n
    boards = [_with_outcomes(board, by_board.get(board['board'])) for board in boards]
    return {'v': 2, 'install': install or os.getenv('JOB_PILOTTO_INSTALL_ID', ''), 'roles': roles, 'regions': regions, **fine_tags(search),
            'feeds': feeds[:MAX_FEEDS], **({'nofeed': nofeed} if nofeed else {}), **({'boards': boards} if boards else {}),
            **({'sites': sites} if (sites := site_facts(db=db)) else {}), **({'candidates': found} if (found := contribute_candidates.candidates(db, stages)) else {}),
            **({'served': served} if (served := pool_served.load()) else {})}   # steps skipped thanks to the pool: a running total per fixed kind


def enabled(env=None):
    from .features import disabled
    env = os.environ if env is None else env
    return env.get('JOB_PILOTTO_SHARE_EMPLOYERS') == '1' and bool(env.get('JOB_PILOTTO_INSTALL_ID')) and not disabled('contribute', env)


def due(now=None, stamp=None):
    stamp = stamp or STAMP
    now = now or datetime.now(timezone.utc)
    try:
        return now - datetime.fromisoformat(json.loads(stamp.read_text())['sent']) >= EVERY
    except (OSError, ValueError, KeyError):
        return True


def send(body, url=None, post=None, now=None, stamp=None):
    """POST the payload; True when accepted. Never raises: the pool is a favour, not part of the run."""
    if os.getenv('JOB_PILOTTO_FIXTURE_DIR') and not url and not post:   # a fixture run (tests, desktop/e2e) never reaches the real pool
        return False   # (7 Oct 2026: "E2E Ghost" and "E2E Hollow" were in the central "no readable site" list)
    stamp = STAMP if stamp is None else stamp
    url = url or os.getenv('JOB_PILOTTO_CONTRIBUTE_URL') or URL

    def default_post(request):
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, response.read().decode('utf-8', 'replace')
    request = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST',
                                     headers={'Content-Type': 'application/json', 'User-Agent': ats.USER_AGENT})
    try:
        answer = (post or default_post)(request)
    except Exception as error:  # noqa: BLE001
        print(f'Warning: pool contribution not sent ({type(error).__name__}: {error})')
        return False
    status, text = answer if isinstance(answer, tuple) else (answer, '')
    if status != 200:
        print(f'Warning: pool contribution refused ({status})')
        return False
    try:   # what the site did not keep (an unknown label, board or count): engine and site disagree on a name (7 Oct 2026)
        dropped = (json.loads(text) if text else {}).get('dropped')
    except ValueError:
        dropped = None
    if dropped:
        print(f"Warning: the pool kept the share but dropped {', '.join(f'{n} {what}' for what, n in sorted(dropped.items()))}: engine and site lists differ")
    if stamp is not False:
        stamp.parent.mkdir(parents=True, exist_ok=True)
        stamp.write_text(json.dumps({'sent': (now or datetime.now(timezone.utc)).isoformat(timespec='seconds'), 'feeds': len(body['feeds'])}))
    return True


def share_now(feed=None, dead=None, post=None, url=None):
    """One employer the scout just verified (`feed`: ats, slug, company, how, site) or found with no readable job site (`dead`: company,
    host), sent the moment it is known (owner, 6 Oct 2026: "send it right away", so closing the app loses nothing). Opt-in; never raises.
    Whatever fails here goes again with the end-of-run share and the app's catch-up at start (both rebuilt from the local data)."""
    if not enabled():
        return False
    roles, regions = tags()
    body = {'v': 2, 'install': os.getenv('JOB_PILOTTO_INSTALL_ID', ''), 'roles': roles, 'regions': regions, **fine_tags(),
            'feeds': [{'matched': False, 'own': False, 'failed': False, **feed}] if feed else [], **({'nofeed': [dead]} if dead else {})}
    return send(body, url=url, post=post, stamp=False)   # a one-item share does not mark the full share as done


# Only what changed since the last share goes up, plus each item once a day so the site knows it is still read (scale, 7 Oct 2026:
# 5k installs sending every feed on every check would be ~40M database writes a day). A job count counts as changed past ~25%.
SENT_TABLE = 'CREATE TABLE IF NOT EXISTS pool_sent (key TEXT PRIMARY KEY, sig TEXT NOT NULL, sent_at TEXT NOT NULL)'
REFRESH = timedelta(hours=20)


def _bucket(n):
    return round(math.log2(int(n) + 1) * 3) if n else 0


def _signatures(body):
    tags_sig = '|'.join(','.join(body.get(name) or []) for name in ('roles', 'regions', 'countries', 'metros', 'families'))
    for feed in body.get('feeds') or []:
        yield ('feeds', feed, f"feed:{feed['ats']}:{feed['slug']}", json.dumps([tags_sig, feed.get('matched'), feed.get('own'), feed.get('failed'), feed.get('how'),
                                                                           feed.get('site'), feed.get('hits'), _bucket(feed.get('jobs')), feed.get('out')]))
    for dead in body.get('nofeed') or []:
        yield ('nofeed', dead, f"dead:{dead.get('company')}", json.dumps([tags_sig, dead.get('host')]))
    for fact in body.get('sites') or []:
        yield ('sites', fact, f"site:{fact['host']}:{fact['kind']}", json.dumps([fact.get('url'), fact.get('recipe')], sort_keys=True))
    for post in body.get('candidates') or []:
        yield ('candidates', post, f"candidate:{post['url']}", json.dumps([post.get('source')]))
    for board in body.get('boards') or []:
        yield ('boards', board, f"board:{board['board']}", json.dumps([tags_sig, board.get('failed'), board.get('hits'), board.get('dup'), _bucket(board.get('jobs')), board.get('out')]))


def only_changed(db, body, now=None):
    """(the body with only new or changed items, their [(key, sig)] to mark once the site took them). Without a database: everything."""
    if db is None:
        return body, []
    db.execute(SENT_TABLE)
    now = now or datetime.now(timezone.utc)
    last = {row[0]: (row[1], row[2]) for row in db.execute('SELECT key, sig, sent_at FROM pool_sent')}
    keep, marks = {'feeds': [], 'nofeed': [], 'boards': [], 'sites': [], 'candidates': []}, []
    for field, item, key, sig in _signatures(body):
        before = last.get(key)
        if before and before[0] == sig and now - datetime.fromisoformat(before[1]) < REFRESH:
            continue
        keep[field].append(item)
        marks.append((key, sig))
    out = {**body, 'feeds': keep['feeds']}
    for field in ('nofeed', 'boards', 'sites', 'candidates'):
        out.pop(field, None)
        if keep[field]:
            out[field] = keep[field]
    return out, marks


def mark_sent(db, marks, now=None):
    if db is None or not marks:
        return
    stamp = (now or datetime.now(timezone.utc)).isoformat(timespec='seconds')
    db.execute(SENT_TABLE)
    db.executemany('INSERT OR REPLACE INTO pool_sent (key, sig, sent_at) VALUES (?, ?, ?)', [(key, sig, stamp) for key, sig in marks])
    db.commit()


def maybe_send(feed_list, report, stores=None, **kwargs):
    """Called after a full crawl and after a scout run: does nothing unless the user opted in, and at most every EVERY."""
    if not enabled() or not due(kwargs.get('now'), kwargs.get('stamp')):
        return False
    body, marks = only_changed(kwargs.get('db'), payload(feed_list, report, stores, search=kwargs.get('search'), db=kwargs.get('db'), stages=kwargs.get('stages')), kwargs.get('now'))
    if not body['feeds'] and not any(body.get(name) for name in ('nofeed', 'boards', 'sites', 'candidates')):
        return False
    sent = send(body, url=kwargs.get('url'), post=kwargs.get('post'), now=kwargs.get('now'), stamp=kwargs.get('stamp'))
    if sent:
        mark_sent(kwargs.get('db'), marks, kwargs.get('now'))
        print(f"Shared {len(body['feeds'])} employer feeds and {len(body.get('boards') or [])} job boards with the pool (roles {body['roles']}, regions {body['regions']})")
    return sent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--show', action='store_true', help='print exactly what would be sent (nothing is sent)')
    parser.add_argument('--send', action='store_true', help='send it now (the app\'s catch-up at start), when sharing is on')
    args = parser.parse_args()
    from . import scout, store
    from .paths import CONFIG, jobs_db
    stores = scout.employer_store()
    with store.connect(jobs_db()) as db:
        feed_list = scout.active_sources(db, stores, scout.starter_list())
        # Without a crawl in hand: the feeds the scout verified and the user's own are shown; matched ones and counts join after a crawl.
        body = payload(feed_list, {'sources': []}, stores, db=db)
        if args.send:   # the app's catch-up at start: whatever a failed or cut-short share left behind (only what changed)
            body, marks = only_changed(db, body)
            sent = enabled() and (body['feeds'] or body.get('nofeed') or body.get('boards')) and send(body)
            if sent:
                mark_sent(db, marks)
            print(f"Pool catch-up: {'sent' if sent else 'nothing sent'} ({len(body['feeds'])} employers)")
            return 0
    body['install'] = (body['install'] or '')[:8] + '…' if body['install'] else '(your random install id)'
    print(json.dumps(body, indent=1, ensure_ascii=False))
    print('\nThis is a preview and nothing is sent by it. After each jobs check and each employer-growing step of Find jobs (while this is switched on) '
          'every feed and job board read, every employer your scout verified and the ones you added are sent when they changed (and once a day), '
          'with how each was found and how many jobs it listed and matched: public facts and counts, never your jobs, CV or search words.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
