"""The Jobadabra service as the engine sees it: a random local install id, the token the website gives that id, and the private
playbook (per-board notes for application sessions, learned over many applications and kept on our side).

Nothing about the user goes up: the id is random and local. Every call here fails soft ('' / None): the engine works without the service.
"""
import json
import os
import re
import secrets
import datetime
import urllib.error
import urllib.parse
import urllib.request

from .paths import DATA
from .sources import ats

SITE = 'https://www.jobpilotto.top'
TIMEOUT = 10
ID_FILE = DATA / 'install_id'
TOKENS_FILE = DATA / 'site_tokens.json'   # this install's site tokens, kept once given (site_token)
_ID = re.compile(r'[A-Za-z0-9_-]{8,64}')


def install_id(path=None, env=None):
    """The shared id the app set (JOB_PILOTTO_INSTALL_ID), else a random one kept next to the data."""
    given = (env if env is not None else os.environ).get('JOB_PILOTTO_INSTALL_ID', '')
    if _ID.fullmatch(given):
        return given
    path = path or ID_FILE
    try:
        stored = path.read_text().strip()
        if _ID.fullmatch(stored):
            return stored
    except OSError:
        pass
    fresh = secrets.token_hex(12)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(fresh + '\n')
    except OSError:
        pass   # an id that is not kept is still valid for this run
    return fresh


def site_token(install, purpose, ask, path=None, today=None):
    """This install's site token for a purpose ('recipes', 'index'): kept once given (an install's token never changes), and not asked again
    the same UTC day after the site refused it (429, its per-address daily limit; 17-18 Oct 2026 the day's tokens ran out). The app keeps
    its own the same way (desktop/lib/install-token.js). `ask()` returns the token or raises. -> the token, or ''."""
    path = path or TOKENS_FILE
    today = today or datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    try:
        kept = json.loads(path.read_text())
    except (OSError, ValueError):
        kept = {}
    entry = kept.get(purpose) if isinstance(kept.get(purpose), dict) else {}
    if entry.get('install') == install and entry.get('value'):
        return str(entry['value'])
    if entry.get('refused') == today:
        return ''
    try:
        token = str(ask() or '')
        entry = {'install': install, 'value': token} if token else {}
    except urllib.error.HTTPError as error:
        token, entry = '', ({'refused': today} if error.code == 429 else {})
    except Exception:  # noqa: BLE001 - offline: asked again next time
        return ''
    if entry:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({**kept, purpose: entry}) + '\n')
        except OSError:
            pass
    return token


def _post(url, body):
    request = urllib.request.Request(url, method='POST', data=json.dumps(body).encode(),
                                     headers={'User-Agent': ats.USER_AGENT, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.load(response)


def _get(url, headers):
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT, **headers})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.load(response)


# Runs that must never ask the LIVE site (mirrors desktop/lib/telemetry.js reportingOff): each such run has a fresh random install id, and each id costs the
# site a few Workers KV writes (a mint counter, a quota counter); 12 Oct 2026: ~450 throwaway ids a day used the whole free 1,000-puts-a-day limit.
OFF_FLAGS = ('JOB_PILOTTO_NO_SERVICE', 'JOB_PILOTTO_E2E', 'JOB_PILOTTO_SMOKE', 'JOB_PILOTTO_PTY_SMOKE', 'CI', 'GITHUB_ACTIONS')


def site_off(env=None):
    """Why this run must not ask the live site (a test, smoke or CI run), or '' when it may."""
    env = os.environ if env is None else env
    return next((flag for flag in OFF_FLAGS if env.get(flag)), '')


def playbook(board, base=None, install=None, post=_post, get=_get, env=None):
    """The private notes for one board ('greenhouse', 'ashby', 'lever', 'other'), or '' when unavailable."""
    explicit = base or (os.environ if env is None else env).get('JOB_PILOTTO_SITE')   # a test site is fine; only the live one is off limits
    if not explicit and site_off(env):
        return ''
    base = (explicit or SITE).rstrip('/')
    try:
        install = install or install_id()
        mint = lambda: str(post(f'{base}/api/install-token', {'install': install}).get('token') or '')   # noqa: E731
        token = site_token(install, 'recipes', mint) if post is _post and not explicit else mint()   # kept on the live path; a test's site is asked each time
        if not token:
            return ''
        answer = get(f'{base}/api/playbook?board={urllib.parse.quote(str(board).lower())}',
                     {'Authorization': f'Bearer {token}', 'X-Install-Id': install})
        return str(answer.get('text') or '')
    except Exception:  # noqa: BLE001 — the playbook is a bonus: any trouble means "none"
        return ''
