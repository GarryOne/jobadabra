"""Refused sites read in the user's own browser (owner, 19 Oct 2026; rule: CLAUDE.md "Never past a login wall", the opt-in exception). Unless the user turned
off "Read refused sites in my browser", which is on by default (the app checks the setting before it asks this file anything): the employer career sites and job boards that refused the engine
(401/403, a bot check) are fetched ONCE by the extension from the user's Chrome, without cookies or logins, at most every READ_DAYS, one at a time, and the page it brings
is read like a page the person opened (visits_read.read). A bot check, a refusal or a login page in the browser means stop and record: never retried, never solved. A 429 ("slow down") is kept
as 'waiting' for WAIT_DAYS and widens the site's pace (host_pace), never a refusal.
Never LinkedIn, Indeed, Glassdoor, levels.fyi, Reddit or any login wall. Guarded by tests/test_refused_reads.py and desktop/test/refused-reads.test.js."""
import re
import urllib.parse
from datetime import datetime, timedelta, timezone

from ..ai import board_ideas
from ..paths import load_search_config
from . import ats, host_pace, render, visits

READ_DAYS = 30      # a site every step stopped at is asked again after this many days (owner, 20 Oct 2026)
OPENED_DAYS = 7     # a site some step opened is asked again after this many days, starting at the step that worked
WAIT_DAYS = 1       # ... except a site that asked us to slow down: asked again the next day
MAX_QUEUE = 12      # sites handed to the extension in one go
CONCURRENCY = 1     # the extension asks one site at a time, with a pause (extension/refused-read.js)
NEVER = (*board_ideas.PORTALS, 'reddit.', 'xing.')   # login-wall sites: only through the person's own visit
LOGIN_PATH = re.compile(r'/(?:log-?in|sign-?in|sso|oauth\d*|authorize|uas/login|account/login|auth)(?:[/?#.]|$)', re.I)   # a floor: the page we landed on is a login page


def search_config():
    return load_search_config(matching=False)


def _now():
    return datetime.now(timezone.utc)


def allowed(url):
    """False for LinkedIn, Indeed, Glassdoor, levels.fyi, Reddit and a page that is not a plain https address."""
    parts = urllib.parse.urlsplit(url or '')
    host = (parts.hostname or '').lower()
    return parts.scheme == 'https' and bool(host) and not any(word in f'{host}.' for word in NEVER)


STEPS = ('engine', 'download', 'tab')   # the ladder, in order; the step that opened a site is remembered and shared


def _days(entry):
    """How long a site rests after its last read: opened 7, every step stopped 30, "slow down" 1."""
    state = entry.get('state')
    return WAIT_DAYS if state == 'waiting' else OPENED_DAYS if state in ('read', 'empty') else READ_DAYS


def _recent(kept, host, now):
    entry = kept.get(host) or {}
    days = _days(entry)
    return bool(entry.get('at')) and entry['at'] >= (now - timedelta(days=days)).isoformat(timespec='seconds')


def _board_url(board, search):
    from . import found_boards
    place = (found_boards._places(search) or [''])[0] if '{place}' in board['search_url'] else ''
    terms = found_boards._terms(search, 1)
    if not terms:
        return None
    return board['search_url'].replace('{role}', urllib.parse.quote_plus(terms[0])).replace('{place}', urllib.parse.quote_plus(place))


def queue(now=None, limit=MAX_QUEUE, now_hosts=(), everything=False):
    """[{url, name, kind: 'employer'|'board', step?}]: refused employer sites, then boards marked 'browser', that are due (see _days). A host in `now_hosts`
    ("Read now", the person opened a job there or pressed Check for new jobs) is due at once; `step` is where the ladder starts (the one that worked last time)."""
    now = now or _now()
    data = visits._load()
    kept = data.get('refused_reads') or {}
    out, seen = [], set()
    force = {host.lower().removeprefix('www.') for host in now_hosts}
    due = lambda host: everything or host.lower().removeprefix('www.') in force or not _recent(kept, host, now)
    pool = visits.pool_facts().get('browser_read') or {}   # what other installs' browsers met there
    elsewhere = lambda host: (pool.get(host.lower().removeprefix('www.')) or {}).get('outcome')
    for site in (data.get('sites') or {}).values():
        host = visits.host_of(site['url'])
        if allowed(site['url']) and host not in seen and due(host) and elsewhere(host) not in STOPPED:
            seen.add(host)
            out.append({'url': site['url'], 'name': site['company'], 'kind': 'employer', 'step': (kept.get(host) or {}).get('step') or 'download'})
    for pick in visits.unread_picks():   # the scout's picks with no readable job site: tried here before they are ever left to the person
        host = visits.host_of(pick['url'])
        if allowed(pick['url']) and host not in seen and due(host) and elsewhere(host) not in STOPPED:
            seen.add(host)
            out.append({'url': pick['url'], 'name': pick['name'], 'kind': 'employer', 'step': (kept.get(host) or {}).get('step') or 'download'})
    out.sort(key=lambda item: elsewhere(visits.host_of(item['url'])) != 'opened')   # opened in another install's browser: asked first
    search = search_config()
    for board in (board_ideas.load().get('boards') or {}).values():
        if board.get('state') != 'browser':
            continue
        url = _board_url(board, search)
        host = visits.host_of(url or '')
        if url and allowed(url) and host not in seen and due(host):
            seen.add(host)
            out.append({'url': url, 'name': board.get('name') or host, 'kind': 'board', 'step': (kept.get(host) or {}).get('step') or 'download'})
    # Only sites that could have jobs for the CURRENT search, employers and boards alike, whichever search queued them: the visit list's AI judge
    # (owner, 26 Oct 2026: "the websites being read should be relevant and in sync with my current strategy and jobs search"; a pilot search's
    # checks read Moldovan bank, energy and telecom sites an earlier search had queued). A site the person opened a job on is read anyway; when
    # the AI fails this time, none of the others is read (asked again next time); with no AI at all every site is read, as before.
    asked = [item for item in out if visits.host_of(item['url']).lower().removeprefix('www.') not in force]
    if asked:
        fit = {item['url'] for item in visits.relevant(asked, search, label='Refused sites', failed=[])}
        out = [item for item in out if item not in asked or item['url'] in fit]
    return out[:limit]


def _keep(host, url, state, why, now, jobs=None, kinds=None, step=None, route=None):
    with visits.LOCK:
        data = visits._load()
        data.setdefault('refused_reads', {})[host] = {'at': now.isoformat(timespec='seconds'), 'url': url, 'state': state, 'why': why,
                                                      **({'jobs': jobs} if jobs is not None else {}), **({'kinds': kinds} if kinds else {}),
                                                      **({'step': step} if step in STEPS else {}), **({'route': route} if route else {})}
        visits._save(data)


# What every install learns from one read (owner, 20 Oct 2026: "never do that same step again"): a fixed word, and for a page that opened its
# job count and kinds of work. Shared in the daily pool share (src/contribute.py site_facts), served back as pool_facts()['browser_read'].
OUTCOMES = ('opened', 'refused', 'bot', 'login')
STOPPED = ('refused', 'bot', 'login')   # the browser was stopped there: not asked again here either


ROUTE_SYSTEMS = lambda: sorted(set(ats.FETCHERS) - set(ats.LOCAL_ONLY) - {'careers'})   # the job systems a route can name (src/sources/ats.py)


def valid_route(route):
    """A route in its one shared shape, or None: {system, account} (a job system and its account slug, checked by ats.slug_ok, the readers' own rule per system; a Workday
    account is tenant.wdN.Site, an Oracle one tenant.region.SITE, a Phenom or SuccessFactors one the site's host) or {feed} (one https address, no query, no fragment). Never a title, a link list or a text (owner, 20 Oct 2026)."""
    if not isinstance(route, dict):
        return None
    system, account, feed = route.get('system'), route.get('account'), route.get('feed')
    if system in ROUTE_SYSTEMS() and feed is None and set(route) == {'system', 'account'} and isinstance(account, str) and account.strip() == account and ats.slug_ok(system, account):
        return {'system': system, 'account': account}
    parts = urllib.parse.urlsplit(feed) if isinstance(feed, str) and len(feed) <= 300 else None
    if parts and parts.scheme == 'https' and parts.hostname and not (parts.query or parts.fragment) and allowed(feed) and not system and not account:
        return {'feed': feed}
    return None


def route_of(final, html):
    """The job system and account a page reads from, found in its own address or the addresses it links to (ats.detect), or None. Only that pair is kept."""
    for url in [final or '', *re.findall(r'(?:href|src|action)=["\']([^"\']{8,300})', (html or '')[:400000])]:
        found = ats.detect(url)
        if found and valid_route({'system': found[0], 'account': found[1]}):
            return {'system': found[0], 'account': found[1]}
    return None


def _word(entry):
    if entry.get('state') in ('read', 'empty'):
        return 'opened'
    why = str(entry.get('why') or '')
    return 'bot' if 'bot' in why else 'login' if 'login' in why else 'refused' if why.startswith('HTTP') else None


def shared():
    """[{host, kind: 'browser_read', read: {outcome, jobs?, kinds?}}] for the daily share: no address path, page, title or reason text."""
    out = []
    for host, entry in (visits._load().get('refused_reads') or {}).items():
        word = _word(entry or {})
        if word:
            read = {'outcome': word, **({'jobs': entry['jobs'], **({'kinds': entry['kinds']} if entry.get('kinds') else {})} if word == 'opened' and isinstance(entry.get('jobs'), int) else {}),
                    **({'step': entry['step']} if entry.get('step') in STEPS else {}), **({'route': entry['route']} if word == 'opened' and valid_route(entry.get('route')) else {})}
            out.append({'host': host.lower().removeprefix('www.'), 'kind': 'browser_read', 'read': read})
    return out


def _stop_why(status, html, final):
    """Why this page ends the visit, or ''. A refusal status, a bot check (the page is short and says so) or a login page: a floor, never a judgment of a good page."""
    if status in host_pace.REFUSED:
        return f'HTTP {status}'
    from . import refused_state
    text = (html or '')[:6000].lower()
    if not refused_state.is_long_page(html) and any(word in text for word in render.CHALLENGE):
        return 'a bot check'
    if final and (not allowed(final) or LOGIN_PATH.search(urllib.parse.urlsplit(final).path)):
        return 'a login page'
    return ''


def outcome(url, status, html, title='', final='', now=None, step='download', captcha=False):
    """What the extension's fetch of `url` brought: {ok, state: 'read'|'empty'|'stopped'|'skipped', jobs, why, name, feed}. Every answer is kept so the site is not asked again for READ_DAYS."""
    now = now or _now()
    host = visits.host_of(url)
    if not allowed(url):
        return {'ok': True, 'state': 'skipped', 'why': 'a site that is only read through your own visit', 'name': host}
    if host_pace.answer(url, int(status or 0)):   # "slow down": asked again after WAIT_DAYS, not a refusal
        _keep(host, url, 'waiting', 'asked us to slow down', now)
        print(f'Refused sites: {host} asked us to slow down; asked again in {WAIT_DAYS} day(s)')
        return {'ok': True, 'state': 'waiting', 'why': 'asked us to slow down', 'name': host}
    if captcha:   # the real tab met a captcha (the AI's page_state): never solved or retried by us; the person is offered the site to open and solve (owner, 20 Oct 2026)
        why = 'a bot check: needs a quick check from you'
        _keep(host, url, 'stopped', why, now, step=step)
        visits.refused(host, url, why, now=now)   # listed with the sites only you can open
        print(f'Refused sites: {host} shows a captcha; waiting for you to open it and solve it')
        return {'ok': True, 'state': 'stopped', 'why': 'needs a quick check from you', 'needs_check': True, 'name': host}
    why = _stop_why(int(status or 0), html, final)
    if why:
        _keep(host, url, 'stopped', why, now, step=step)
        print(f'Refused sites: {host} stopped ({why}); not asked again for {READ_DAYS} days')
        return {'ok': True, 'state': 'stopped', 'why': why, 'name': host}
    if not 200 <= int(status or 0) < 400:   # no answer (0), gone (404), a server error: a blip, not a page; never read as 'opened' or shared (#1639). Asked again after WAIT_DAYS.
        _keep(host, url, 'waiting', 'the page did not load', now)
        print(f'Refused sites: {host} did not load (HTTP {int(status or 0)}); asked again in {WAIT_DAYS} day(s)')
        return {'ok': True, 'state': 'waiting', 'why': 'the page did not load', 'name': host}
    result = visits.read(url, html or '', None, title or '', now=now)
    state = 'read' if result['jobs'] else 'empty'
    from .. import role_kinds
    titles = [job.get('title') for job in result['jobs'] if isinstance(job, dict)]
    _keep(host, url, state, '', now, jobs=len(result['jobs']), kinds=role_kinds.mix(titles) if titles else None, step=step, route=route_of(final, html) if result['jobs'] else None)
    if result['jobs']:
        from .. import read_methods
        read_methods.note_extension(host, read_methods.in_places(result['jobs']))   # counted in the next search report (no host leaves the machine)
    print(f"Refused sites: read {host} in your browser: {len(result['jobs'])} job(s), {result.get('fits', 0)} matching your search")
    return {'ok': True, 'state': state, 'jobs': len(result['jobs']), 'fits': result.get('fits', 0), 'name': result['name'], 'feed': result['feed']}
