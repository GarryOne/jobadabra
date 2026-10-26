"""Sites only you can open (owner, 7 Oct 2026): employers whose job site refuses automated visitors (401/403, a bot check) and job portals
with no open API (LinkedIn, Indeed, Glassdoor, levels.fyi). The app lists them; you open one in your own Chrome, as yourself, and the
extension's "Read the jobs on this page" sends the page you see to the app. Nothing here browses, clicks, logs in or gets past a check:
the page arrives only because a person opened it and pressed the button.

The jobs read are kept in data/visits.json and served as the feed `visit:<page address>` (ats.FETCHERS['visit']), so the next jobs check
filters, scores and tracks them like any other feed. A page read more than STALE_DAYS ago is offered again."""
import hashlib
import json
import re
import sys
import threading
import urllib.parse
from datetime import datetime, timedelta, timezone

from ..paths import DATA, load_search_config
from . import ats, careers
from ..ai.models import SMALL_MODEL
from .visits_portals import PORTALS, INDEED, _plain_words, portals, unread_picks   # noqa: F401
from ..ai.providers.contract import detail, reason

STORE = DATA / 'visits.json'
STALE_DAYS = 7          # a page read longer ago is offered for a visit again (its jobs come and go)
KEEP_DAYS = 21          # a visit's jobs are served for this long; then the feed is empty until the next visit
MAX_JOBS = 500
MAX_LIST = 40   # the Actions list scrolls (7 Oct 2026: H&M, Manor and Rolex were left out at 15)
LOCK = threading.Lock()
REFUSED = re.compile(r'\b(401|403)\b|Refused|bot check', re.I)   # a site asking us to slow down is paced (host_pace), not refused


def _now():
    return datetime.now(timezone.utc)


def _load():
    try:
        data = json.loads(STORE.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(data):
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(data, indent=1, ensure_ascii=False) + '\n')


def host_of(url):
    return (urllib.parse.urlsplit(url if '//' in url else f'https://{url}').hostname or '').lower().removeprefix('www.')


def refused(company, url, why, now=None):
    """Note an employer whose job site refused us (from the scout or a jobs check): it is offered for a visit. Only 401/403 or a bot check."""
    if not url or not REFUSED.search(str(why)):
        return False
    with LOCK:
        data = _load()
        sites = data.setdefault('sites', {})
        line = sites.setdefault(host_of(url), {'company': company, 'url': url})
        line.update({'why': str(why)[:80], 'refused_at': (now or _now()).isoformat(timespec='seconds')})
        _save(data)
    print(f'Visit: {company} ({host_of(url)}) refused us ({str(why)[:60]}): offered as a site only you can open')
    return True



def visit_list(search=None, kinds=None, now=None, picks=None):
    """What to offer for a visit: the employers first (refused ones, then the scout's unread picks for this search), then the portals, each
    group least recently read first: [{name, url, kind: 'employer'|'portal', why, last_read, note}]."""
    now = now or _now()
    data = _load()
    # A read that found no jobs is not a read: the site comes back at once (7 Oct 2026: home pages read as 0 jobs hid Hublot, IWC… for a week).
    read = {host: entry for host, entry in (data.get('reads') or {}).items() if entry.get('jobs')}
    stale = (now - timedelta(days=STALE_DAYS)).isoformat(timespec='seconds')
    out = []
    for site in (data.get('sites') or {}).values():
        if not REFUSED.search(str(site.get('why') or 'Refused')):   # noted before 20 Oct 2026 for a "slow down": paced now, not a visit
            continue
        last = (read.get(host_of(site['url'])) or {}).get('at')
        if not last or last < stale:
            out.append({'name': site['company'], 'url': site['url'], 'kind': 'employer', 'why': 'refuses automated visitors', 'last_read': last, 'note': ''})
    have = {host_of(item['url']) for item in out}
    jobpages = data.get('jobpages') or {}
    for pick in (unread_picks() if picks is None else picks):
        pick = {**pick, 'url': jobpages.get(host_of(pick['url']), pick['url'])}   # its job list once found, not its home page
        last = (read.get(host_of(pick['url'])) or {}).get('at')
        if host_of(pick['url']) not in have and (not last or last < stale):
            have.add(host_of(pick['url']))
            out.append({'name': pick['name'], 'url': pick['url'], 'kind': 'employer', 'why': 'picked for your search, no job list we can read', 'last_read': last,
                        'note': 'Opens their site: if it is not their job list, go to it, then click the Jobadabra icon'})
    for portal in portals(search, kinds):
        last = (read.get(host_of(portal['url'])) or {}).get('at')
        if not last or last < stale:
            out.append({'name': portal['name'], 'url': portal['url'], 'kind': 'portal', 'why': 'no way in but your own visit', 'last_read': last, 'note': portal['note']})
    # One entry per company and per job page (7 Oct 2026: Nestlé, Rolex, Tag Heuer twice; Tiffany read twice in one run), none you removed
    hidden, fails, seen, kept = data.get('hidden') or {}, data.get('fails') or {}, set(), []
    for item in out:
        name = re.sub(r'[^a-z0-9]', '', item['name'].lower())
        host = host_of(jobpages.get(host_of(item['url']), item['url']))   # tiffany.com and tiffanycareers.com: one job list, read once
        if host in hidden or host_of(item['url']) in hidden or name in seen or host in seen:
            continue
        page = jobpages.get(host_of(item['url']), item['url'])
        if page.split('#')[0].split('?')[0].rstrip('/') in {str(u).rstrip('/') for u in (pool_facts().get('dead') or {}).values()}:
            continue   # other installs found this job page gone
        system = ats.detect(page)
        if system and system[0] in ats.FETCHERS and system[0] not in ('careers', 'visit'):   # the engine reads it itself at every refresh
            continue   # 7 Oct 2026: Chanel's Workday, 220 jobs read in the browser for nothing
        seen.update({name, host})
        failed = fails.get(host) or {}
        if failed.get('count', 0) >= 2:   # failed twice in a row: offered, not ticked, with why (owner: "let the user delete/dismiss them")
            item = {**item, 'failing': True, 'note': f"Failed {failed['count']} times in a row: {failed.get('why', '')}"[:200]}
        kept.append(item)
    kept = [item for item in kept if left_to_hand(item, data)]
    kept = relevant(kept, search)
    return sorted(kept, key=lambda item: (item['kind'] != 'employer', item['last_read'] or ''))[:MAX_LIST]


def left_to_hand(item, data):
    """True when this site is for the person's own visit: a portal (login wall), a site the automatic Chrome read may not open, or one it stopped at
    (refused, bot check, login). A site not asked yet, or opened, empty or asked to slow down there, is not (owner, 24 Oct 2026: 12 sites listed,
    none tried; picks were not even in the automatic queue)."""
    if item['kind'] != 'employer':
        return True
    from . import refused_reads
    if not refused_reads.allowed(item['url']):
        return True
    return ((data.get('refused_reads') or {}).get(host_of(item['url'])) or {}).get('state') == 'stopped'


RELEVANT_MODEL = SMALL_MODEL
KEEP_LISTS = 8   # answers kept, one per list of sites, roles and places
RELEVANT_SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['keep'], 'properties': {'keep': {
    'type': 'array', 'items': {'type': 'integer'}, 'description': 'Numbers of the sites likely to have jobs of their kinds in their places'}}}
RELEVANT_SYSTEM = """You get a job seeker's roles and places, and numbered sites to read jobs from (an employer's name and address, or a job \
portal). Answer the numbers of the sites likely to have jobs of their kinds of role in their places: an employer that runs shops, studios, \
warehouses or offices there where such people work, or a portal that lists such jobs. Leave out sites whose jobs are of other kinds (a \
private bank for a shop seller, a tech salary site for a photographer) or that have no presence in their places. When unsure, keep it."""


def relevant(items, search, client=None, label='Visit list'):
    """The sites worth your browser's time for these roles and places, by Claude once per list (7 Oct 2026: Cornèr Bank, Geneva Freeport and
    levels.fyi were read for a photographer and shop seller); all of them without AI. Claude sees site names and addresses, roles and places.
    One judge for the visit list and the refused sites' browser reads (src/sources/refused_reads.py queue); the last KEEP_LISTS answers are kept,
    so the two lists never push each other's answer out."""
    from ..notion.search_settings import terms
    search = search or load_search_config(matching=False)
    roles = terms(search.get('role_keywords'))[:40]
    places = terms([*(search.get('locations') or {}).get('top_tier', []), *(search.get('locations') or {}).get('country_wide', [])])[:12]
    if not items or not roles:
        return items
    key = hashlib.sha256(json.dumps([sorted(i['url'] for i in items), sorted(roles), places], ensure_ascii=False).encode()).hexdigest()[:12]
    data = _load()
    kept = (data.get('relevant') or {}).get(key)
    if kept is None:
        try:
            from ..ai import cost, engine
            if not engine.ready():
                return items
            client = client or engine.client(action='visit_relevant')
            listed = '\n'.join(f"{n}. {i['name']} ({i['url']}) [{i['kind']}]" for n, i in enumerate(items, 1))
            response = client.messages.create(model=RELEVANT_MODEL, max_tokens=1500, system=[{'type': 'text', 'text': RELEVANT_SYSTEM}],
                                              messages=[{'role': 'user', 'content': f'Their roles: {json.dumps(roles, ensure_ascii=False)}\nTheir places: '
                                                                                    f'{json.dumps(places, ensure_ascii=False)}\nThe sites:\n{listed}'}],
                                              output_config=engine.structured(RELEVANT_SCHEMA, RELEVANT_MODEL, 'low'))
            cost.side(RELEVANT_MODEL, response.usage)
            numbers = {int(n) for n in json.loads(next(b.text for b in response.content if b.type == 'text')).get('keep') or [] if str(n).isdigit()}
            kept = [items[n - 1]['url'] for n in sorted(numbers) if 1 <= n <= len(items)]
        except Exception as error:  # noqa: BLE001 — every site this time
            print(f'{label}: not sorted by AI ({reason(error)}); every site is offered', file=sys.stderr)
            detail('visit list', error)
            return items
        with LOCK:
            data = _load()
            data['relevant'] = dict([*list((data.get('relevant') or {}).items())[-(KEEP_LISTS - 1):], (key, kept)])
            _save(data)
        left = [i['name'] for i in items if i['url'] not in kept]
        if left:
            print(f"{label}: left out as unlikely for your roles: {', '.join(left)}", file=sys.stderr)
    return [i for i in items if i['url'] in kept]


def outcome(results, now=None):
    """A browser run's results [{url, ok, why}]: a site that failed twice in a row is offered unticked with why; one that read jobs is clear."""
    now = now or _now()
    with LOCK:
        data = _load()
        fails = data.setdefault('fails', {})
        for result in results or []:
            host = host_of(result.get('url') or '')
            if not host:
                continue
            if result.get('ok'):
                fails.pop(host, None)
            else:
                fails[host] = {'count': (fails.get(host) or {}).get('count', 0) + 1, 'why': str(result.get('why') or '')[:160],
                               'at': now.isoformat(timespec='seconds')}
        _save(data)


def hide(url, now=None):
    """You removed this site from the list (a dead page, a site you do not want): not offered again."""
    with LOCK:
        data = _load()
        data.setdefault('hidden', {})[host_of(url)] = (now or _now()).isoformat(timespec='seconds')
        _save(data)


def dismiss(url, now=None):
    """You dismissed a job in "Jobs we couldn't read": its posting is not offered again (the job only, not its whole site)."""
    with LOCK:
        data = _load()
        data.setdefault('dismissed', {})[url] = (now or _now()).isoformat(timespec='seconds')
        _save(data)


def dismissed():
    """The job addresses you dismissed in "Jobs we couldn't read"."""
    return set((_load().get('dismissed') or {}))


def listed(url):
    """True when this page's site is on the visit list (the extension lights its icon there)."""
    host = host_of(url)
    data = _load()
    return host in (data.get('sites') or {}) or any(portal['host'] in host for portal in PORTALS.values())


def fetch(slug, now=None):
    """The feed visit:<page address>: the jobs read on that page at the last visit, while under KEEP_DAYS old ([] after)."""
    page = (_load().get('pages') or {}).get(slug)
    if not page:
        return []
    if page.get('at', '') < ((now or _now()) - timedelta(days=KEEP_DAYS)).isoformat(timespec='seconds'):
        return []
    return page.get('jobs') or []


# Imported last: these read the store (STORE, LOCK, _load, _save, _now) on this module when called.
from .visits_read import (_title_place, _place, _from_cards, QUERY_ID, _has_job_id, fitting, read, session_result)  # noqa: E402,F401
from .visits_jobpages import (JOBLIST, NOT_A_LIST, LOCALE, _usable, _best, _countries, MISS_DAYS, BAD_DAYS, _bad_pages, pool_facts,  # noqa: E402,F401
                              find_job_pages, job_page)
from .visits_recipes import (LAYOUT_LINE, layout_ok, recipe_for, save_recipe, RECIPE_MISSES, recipe_missed, forget_recipe)  # noqa: E402,F401
