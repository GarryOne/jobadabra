"""Pages that only exist after JavaScript runs, read with a headless browser. Optional: needs `pip install playwright` and
`playwright install chromium` (requirements-render.txt); without them every function here says "not available" and the scout carries on.

What it is for: a company's public careers page built in the browser (the HTML a plain request gets is an empty shell). What it is not for:
getting past a site that refuses automated visitors. It shows who it is (the same user agent as every other request, plus "browser"),
waits between pages of one site, loads no images, fonts or media, and gives up at the first 401/403 or bot-check page: a block is
taken as it is. A 429 is "slow down": the site's pace widens (host_pace) and the page waits for a later turn. robots.txt is not consulted (owner's decision, 6 Oct 2026: "if they block us, they block"). No stealth settings, no fingerprint changes, no proxies, no CAPTCHA solving.
"""
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
import urllib.parse
import urllib.request

from . import ats, careers, host_pace

TIMEOUT_MS = 20000
SETTLE_MS = 1500          # after the page loads, for the lists a script fills in
IDLE_MS = 6000            # at most this long for the page's own requests to finish first (24 Oct 2026: a board's category page showed its menu on one load and 32 jobs on the next)
HOST_DELAY_S = 1.0        # between two pages of one site
MAX_PAGES = 60            # per process: a run is not a crawl of the web
CHALLENGE = ('just a moment', 'attention required', 'verify you are human', 'captcha', 'access denied', 'are you a robot')


class Refused(Exception):
    """The site answered 401/403 or showed a bot check: not retried, not worked around."""


# Playwright's sync API belongs to the thread that started it: every browser call runs on this one worker thread, one page at a time.
_worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix='render')
_state = {'playwright': None, 'browser': None, 'pages': 0, 'last': {}}


def _app():
    """The desktop app's own Chromium (desktop/lib/page-render.js), when this run was started by the app: (address, key) or None."""
    url, key = os.getenv('JOB_PILOTTO_RENDER_URL', ''), os.getenv('JOB_PILOTTO_RENDER_TOKEN', '')
    return (url, key) if url.startswith('http://127.0.0.1:') and key else None


def available():
    """The app's browser (a run the desktop app started), or Playwright installed (the browser itself is checked when it first starts)."""
    if _app():
        return True
    try:
        import playwright.sync_api  # noqa: F401
        return True
    except ImportError:
        return False


def _browser():
    if not _state['browser']:
        from playwright.sync_api import sync_playwright
        _state['playwright'] = sync_playwright().start()
        _state['browser'] = _state['playwright'].chromium.launch(headless=True)
    return _state['browser']


def close():
    """Stop the browser (on its own thread). Safe to call when it never started."""
    def stop():
        for key in ('browser', 'playwright'):
            thing = _state[key]
            _state[key] = None
            try:
                thing and (thing.close() if key == 'browser' else thing.stop())
            except Exception:  # noqa: BLE001
                pass
    _worker.submit(stop).result()




def render(url):
    """The page's HTML after its scripts ran. Raises Refused, ValueError (not allowed) or the browser's own errors; one page at a time."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname or not careers._public(parts.hostname):
        raise ValueError('not a public web address')
    from .. import read_methods
    read_methods.mark('browser')   # the source being read now was shown by the headless browser
    return _worker.submit(_render, url, parts).result()


def _through_app(url):
    address, key = _app()
    request = urllib.request.Request(address, data=json.dumps({'url': url, 'user_agent': f'{ats.USER_AGENT} browser'}).encode(),
                                     headers={'Content-Type': 'application/json', 'X-Job-Pilotto-Render': key})
    with urllib.request.urlopen(request, timeout=TIMEOUT_MS / 1000 + 15) as response:
        answer = json.load(response)
    if host_pace.answer(url, int(answer.get('status') or 200)):
        raise host_pace.Busy(url, host_pace.waiting(url))
    if answer.get('status') in host_pace.REFUSED:
        raise Refused(f"HTTP {answer['status']}")
    if answer.get('error'):
        raise ValueError(f"the app could not show the page: {answer['error']}")
    markup = answer.get('html') or ''
    if any(word in markup[:6000].lower() for word in CHALLENGE) and len(markup) < 20000:
        raise Refused('bot check page')
    return markup


def _render(url, parts):
    if _state['pages'] >= MAX_PAGES:
        raise ValueError('page limit for this run reached')
    wait = HOST_DELAY_S - (time.monotonic() - _state['last'].get(parts.hostname, 0))
    if wait > 0:
        time.sleep(wait)
    host_pace.turn(url)
    if _app():
        try:
            return _through_app(url)
        finally:
            _state['pages'] += 1
            _state['last'][parts.hostname] = time.monotonic()
    context = _browser().new_context(user_agent=f'{ats.USER_AGENT} browser', java_script_enabled=True)
    try:
        context.route('**/*', lambda route: route.abort() if route.request.resource_type in ('image', 'media', 'font') else route.continue_())
        page = context.new_page()
        response = page.goto(url, wait_until='domcontentloaded', timeout=TIMEOUT_MS)
        if response is not None and host_pace.answer(url, response.status):
            raise host_pace.Busy(url, host_pace.waiting(url))
        if response is not None and response.status in host_pace.REFUSED:
            raise Refused(f'HTTP {response.status}')
        try:
            page.wait_for_load_state('networkidle', timeout=IDLE_MS)
        except Exception:  # noqa: BLE001 — a page that never goes quiet (a poll, a tracker): read as it stands
            pass
        page.wait_for_timeout(SETTLE_MS)
        markup = page.content()
    finally:
        context.close()
        _state['pages'] += 1
        _state['last'][parts.hostname] = time.monotonic()
    if any(word in markup[:6000].lower() for word in CHALLENGE) and len(markup) < 20000:
        raise Refused('bot check page')
    return markup
