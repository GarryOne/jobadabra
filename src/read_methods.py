"""How each source's jobs were read, counted per fixed method name (owner, 24 Oct 2026: "how many sources were scraped using feeds, how many using
AI ideas, how many with the headless browser"): feed_api (an employer's job-system JSON or a free job API), plain_page (a careers page or a declared
feed read over plain HTTP), ai_board (a board the AI proposed, read by its search page), browser (the headless browser showed the page), extension_tab
(the user's own incognito tab, src/sources/refused_reads.py). Each source counts once per run, under the last step that gave its jobs (the later
method in METHODS wins). Per method: sources, jobs (in the user's places, or all jobs listed when the scout counts), seconds, AI cost in cents
(API-billed calls only: Claude Code on a plan is $0, src/ai/cost.py). Never a host, URL or company: only the five names leave the machine.
A search saves its tally to data/read_methods.json (src/search_report.py reads it for the technical report); the central scout puts it in its run
record (src/scout_index.py run_record). Tests: tests/test_read_methods.py."""
import contextlib
import contextvars
import json
import threading
import time

METHODS = ('feed_api', 'plain_page', 'ai_board', 'browser', 'extension_tab')
MEASURES = ('sources', 'jobs', 's', 'ai_cents')

_lock = threading.Lock()
_state = {'on': False, 'at': '', 'persist': True, 'sources': {}}   # sources: key -> (method, jobs, seconds, usd)
_current = contextvars.ContextVar('read_method', default=None)


class Read:
    """One source being read: its starting method, what the steps inside it report."""
    def __init__(self, method):
        self.method, self.jobs, self.usd, self.failed, self.started = method, 0, 0.0, False, time.monotonic()


def reset(at='', persist=True):
    """A search (or a scout run) starts: counting begins, nothing is kept from before. persist=False: the scout keeps its tally in memory for its run record
    and never overwrites the search's saved one."""
    with _lock:
        _state.update(on=True, at=at, persist=persist, sources={})


def reading(key, method):
    """Context for reading one source: `with read_methods.reading(key, 'feed_api') as read: ...; read.jobs = n`. Recorded when it ends without an error."""
    return _reading(key, method)


@contextlib.contextmanager
def _reading(key, method):
    read = Read(method)
    token = _current.set(read)
    try:
        yield read
    except BaseException:
        read.failed = True
        raise
    finally:
        _current.reset(token)
        if not read.failed:
            _finish(key, read)


def _finish(key, read):
    with _lock:
        if not _state['on']:
            return
        old = _state['sources'].get(key)
        if old and METHODS.index(old[0]) > METHODS.index(read.method):
            return   # an earlier step must not take back a later one's source
        _state['sources'][key] = (read.method, read.jobs, time.monotonic() - read.started, read.usd)
        persist = _state['persist']
    if persist:
        save()


def mark(method):
    """A step inside the source being read used `method` (the browser showed the page, the extension's tab read it): it takes the source over."""
    read = _current.get()
    if read and METHODS.index(method) > METHODS.index(read.method):
        read.method = method


def found(read, feed):
    """The scout's find_feed answer (ats, slug, jobs) or None for the source being read: a miss is not a read, a careers page is a page, not a feed."""
    read.failed = not feed
    if feed:
        read.jobs = len(feed[2] or [])
        if feed[0] == 'careers':
            mark('plain_page')


def ai(usd):
    """AI cost of a source-finding call made while a source is being read (src/ai/cost.py side)."""
    read = _current.get()
    if read:
        read.usd += usd or 0


def in_places(jobs):
    """How many of these jobs (the engine's job dicts) are in the user's places."""
    from .sources import feeds
    return sum(1 for job in jobs or [] if feeds.wanted_location({'location': job.get('location') or '', 'title': job.get('title') or ''}))


def snapshot():
    """{method: {sources, jobs, s, ai_cents}} for every method, zeros included."""
    out = {method: dict.fromkeys(MEASURES, 0) for method in METHODS}
    with _lock:
        for method, jobs, seconds, usd in _state['sources'].values():
            out[method]['sources'] += 1
            out[method]['jobs'] += jobs
            out[method]['s'] += seconds
            out[method]['ai_cents'] += usd * 100
    for row in out.values():
        row['s'], row['ai_cents'] = round(row['s']), round(row['ai_cents'])
    return out


def flat(reads=None):
    """The install report's fields: read_<method>_<measure>; empty when nothing was read (a build or a run with no counted source)."""
    reads = reads or snapshot()
    if not any(reads[method]['sources'] for method in METHODS):
        return {}
    return {f'read_{method}_{measure}': reads[method][measure] for method in METHODS for measure in MEASURES}


def _file():
    from .paths import DATA
    return DATA / 'read_methods.json'


def save():
    """Keep this search's tally for the report that is built after it (a separate process). Never breaks a search."""
    try:
        path = _file()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'at': _state['at'], 'reads': snapshot()}), encoding='utf-8')
    except Exception:  # noqa: BLE001 — a count never stops a search
        pass


def _extension_file():
    from .paths import DATA
    return DATA / 'read_extension.json'


def note_extension(key, jobs):
    """A refused site was read in the user's own tab (src/sources/refused_reads.py): kept until the next search report takes it ({site: jobs in places})."""
    try:
        path = _extension_file()
        try:
            kept = json.loads(path.read_text(encoding='utf-8'))
        except Exception:  # noqa: BLE001
            kept = {}
        kept[key] = jobs
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(kept), encoding='utf-8')
    except Exception:  # noqa: BLE001
        pass


def take_extension():
    """(sites read in the tab since the last report, their jobs in places); the note is cleared. Seconds are not measured: the tab is the extension's."""
    try:
        path = _extension_file()
        kept = json.loads(path.read_text(encoding='utf-8'))
        path.unlink()
        return len(kept), sum(int(v) for v in kept.values())
    except Exception:  # noqa: BLE001
        return 0, 0


def saved(since):
    """The saved tally if it belongs to the search that started at `since` (an ISO time), else {}."""
    try:
        data = json.loads(_file().read_text(encoding='utf-8'))
        return flat(data['reads']) if str(data.get('at', ''))[:19] >= str(since)[:19] else {}
    except Exception:  # noqa: BLE001
        return {}
