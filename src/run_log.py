"""The run history on the store: a run's row in stores.cron_runs (⏱️ Search runs in Notion, data/tracker.sqlite on this Mac),
opened when a job starts, kept alive while it runs, completed with its report at the end, wherever it ran.

What src/notion/cron_runs.py did for Notion alone, on any store: begin() opens the row (Running) and prints
"Cronjob run logged: <link or store ref>" (the desktop links its activity row to it); the job's output lines are kept
(capture) and the latest one is its ⏳ progress; a heartbeat writes its duration through quiet steps (the app takes a
Running row nobody touched for 30 minutes as lost); log_run() completes it with today's title, report (Markdown with its
sections: src/notion/cron_report.run_page renders them), the message it sent and the last lines of its output, and its
numbers (base.RUN_STATS, from run_page's own columns, so the numbers are the ones Notion showed). A stop (SIGTERM/SIGINT)
or an early exit closes it as stopped or failed. The report's words stay in src/notion/cron_report.py.
Guarded by tests/test_run_log.py (memory, sqlite and a Notion row as today's).
"""
import atexit
import os
import signal
import sys
import threading
import time
from collections import deque

from . import run_details, run_result
from .warning_lines import record_logged_warnings
from .notion import cron_report
from .notion.cron_runs import CRASH_LINE, EXIT_GRACE_S, HEARTBEAT_S, LOGGED_MODES, LOG_LINES, STEP_EVERY, STOPPED_WORDS
from .stores import notion_blocks, notion_rows
from .stores.notion_cron_runs import STATS

_output = deque(maxlen=LOG_LINES)
_open = {}   # the row this process opened: {'stores', 'id', 'run'}
_auto = {}   # auto_begin(stores): the next new_run() of a logged mode opens its row
_last_step = {'at': 0.0}


def where():
    return 'github' if os.getenv('GITHUB_RUN_ID') else 'mac'


def new_run(mode):
    """The run dict a job fills (mode, start, trigger, run id, GitHub link); with auto_begin, a logged mode's row opens at once."""
    run = _fresh(mode)
    if _auto.get('stores') and mode in LOGGED_MODES and not _open.get('run'):
        begin(_auto['stores'], run)
    return run


def _fresh(mode):
    from datetime import datetime, timezone
    event = os.getenv('GITHUB_EVENT_NAME', '')
    trigger = os.getenv('JOB_PILOTTO_TRIGGER') or {'schedule': 'Schedule', '': 'Local'}.get(event, 'Manual')
    run = {'mode': mode, 'started_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
           'trigger': trigger, 'warnings': [], 'run_id': run_result.current_id()}
    if os.getenv('GITHUB_RUN_ID'):
        run['run_url'] = (f"{os.getenv('GITHUB_SERVER_URL', 'https://github.com')}/"
                          f"{os.getenv('GITHUB_REPOSITORY', '')}/actions/runs/{os.getenv('GITHUB_RUN_ID')}")
    return run


def auto_begin(stores):
    """This process logs its run: the next new_run() opens the row at once (Status Running)."""
    _auto['stores'] = stores


class _Tee:
    """stdout/stderr, also kept (last lines) for the run's log, the latest line its progress."""
    def __init__(self, stream):
        self.stream, self.partial = stream, ''

    def write(self, text):
        self.partial += text
        *lines, self.partial = self.partial.split('\n')
        lines = [line for line in lines if line.strip()]
        _output.extend(lines)
        for each in lines:
            run_details.line(each)
        if lines:
            _progress(lines[-1])
        return self.stream.write(text)

    def __getattr__(self, name):
        return getattr(self.stream, name)


def capture():
    if not isinstance(sys.stdout, _Tee):
        sys.stdout, sys.stderr = _Tee(sys.stdout), _Tee(sys.stderr)


def _fields(run, final):
    found = {'trigger': run.get('trigger', 'Local'), 'mode': run['mode'], 'title': cron_report.title(run, final)}
    for key, field in (('run_url', 'run_url'), ('application', 'application'), ('run_id', 'log_id')):
        if run.get(key):
            found[field] = str(run[key])
    return found


class BothLogs(RuntimeError):
    """One process logged its run through both src/run_log.py and src/notion/cron_runs.py (a half-switched caller): two
    rows, two stop handlers. Raised, never caught: it shows in tests, not as a doubled run in production."""


def one_log():
    from .notion import cron_runs
    if cron_runs._open.get('id'):
        raise BothLogs('this process opened its run row with src/notion/cron_runs.py: log it there, or move all of it to run_log')


def begin(stores, run):
    """Open the run's row now (Running), so a job in progress shows everywhere; log_run() completes it. Returns its link or
    store ref, or None (never raises, but BothLogs)."""
    one_log()
    capture()
    _install()
    run_details.reset()
    try:
        row = stores.cron_runs.begin(run['mode'], where(), _fields(run, final=False))
    except Exception as error:  # noqa: BLE001 - the run goes on without its row
        print(f'Warning: run not opened in the run history: {type(error).__name__}: {error}')
        return None
    _open.update(stores=stores, id=row['id'], run=run)
    _heartbeat(run)
    named = stores.link_or_ref('cron_runs', row['id'])
    run_result.note_notion(stores.link(row['id']))
    print(f'Cronjob run logged: {named}')  # the desktop app links its activity row to this
    return named


def _heartbeat(run):
    """While this run's row is open, write its elapsed seconds every HEARTBEAT_S (a daemon thread: it ends with the process)."""
    began = time.monotonic()

    def beat():
        stop = threading.Event()
        while not stop.wait(HEARTBEAT_S):
            if _open.get('run') is not run:
                return
            try:
                _open['stores'].cron_runs.touch(_open['id'], {'duration_s': round(time.monotonic() - began)})
            except Exception:  # noqa: BLE001 - best effort, like progress
                pass
    threading.Thread(target=beat, name='run-row-heartbeat', daemon=True).start()


def _progress(line):
    """A running job's latest output line as its ⏳ progress, at most every STEP_EVERY seconds."""
    if not _open.get('run') or len(line) > 160 or CRASH_LINE.match(line) or line.startswith(
            ('Warning', ' ', 'Cronjob run logged', cron_report.JOB_LINE, '<<<', 'message>>>')):
        return
    now = time.monotonic()
    if now - _last_step['at'] < STEP_EVERY:
        return
    _last_step['at'] = now
    try:
        _open['stores'].cron_runs.progress(_open['id'], line)
    except Exception:  # noqa: BLE001 - progress is best effort
        pass


def stats_of(properties):
    """The run's numbers (base.RUN_STATS) from run_page's own columns: what Notion showed, on every store."""
    found = {}
    for key, (column, kind) in STATS.items():
        if column in properties:
            value = notion_rows.read(properties[column], kind)
            if value not in (None, ''):
                found[key] = value
    return found


def details_of(run):
    """How the run ran (src/run_details.py): a search run adds the crawl funnel and the employer meter; never raises."""
    try:
        crawl = run.get('mode') in cron_report.CRAWL_MODES
        employers = None
        if crawl:
            from . import coverage
            from .paths import JOBS_DB
            employers = coverage.employers_state(run.get('funnel')) if JOBS_DB.exists() else None
        return run_details.build(run, run.get('funnel'), employers)
    except Exception as error:  # noqa: BLE001 - the details are an extra; the run still closes
        print(f'Warning: run details not kept ({type(error).__name__}: {error})')
        return None


def finished(run, failed=False):
    """(status, title, summary, report, result, log, stats) of a run at its end, in today's words."""
    from . import telegram
    if failed:
        run['failed'] = True  # the report's words (report_lines): a run that crashed never says "done"
    record_logged_warnings(run, list(_output))  # what the run logged as a warning is recorded too: the row's Status and the panel agree (src/warning_lines.py)
    properties, children = cron_report.run_page(run, final=not failed)
    messages = telegram.MESSAGES
    return {'status': 'Failed' if failed else cron_report.status(run), 'title': cron_report.title(run, final=not failed),
            'summary': cron_report.report_lines(run)[0], 'report': notion_blocks.to_markdown(children),
            'result': '\n'.join(cron_report.result_lines(messages, run)),
            'log': '\n'.join(_output), 'stats': stats_of(properties), 'details': details_of(run)}


def log_run(stores, run, failed=False):
    """Complete the row begin() opened for this run (or add one); returns its link or store ref, or None (never raises,
    but BothLogs)."""
    one_log()
    try:
        end = finished(run, failed)
        args = {k: end[k] for k in ('summary', 'report', 'result', 'log', 'stats', 'title', 'details')}
        row_id = _open.get('id') if _open.get('run') is run and _open.get('stores') is stores else None
        if row_id:
            _open.pop('run')
            try:
                stores.cron_runs.finish(row_id, end['status'], **args)
            except KeyError:
                # The opened row was deleted while the run ran (a person tidying Notion, a test reset): a new row, or the run
                # never ends in Recent activity (5 Oct 2026).
                print(f"Warning: the run's row {row_id} was deleted during the run; writing a new row")
                row_id = None
        if not row_id:  # no row opened (or it was deleted): the whole row at once, started when the run started
            from datetime import datetime, timezone
            row_id = stores.cron_runs.put({'kind': run['mode'], 'where': where(), 'status': end['status'],
                                           'started_at': run['started_at'], 'progress': [],
                                           'finished_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                                           **_fields(run, final=not failed), **args})['id']
        run_result.note_notion(stores.link(row_id))
        run_result.publish(run, failed=failed)
        return stores.link_or_ref('cron_runs', row_id)
    except Exception as error:  # noqa: BLE001
        run_result.publish(run, failed=True)
        print(f'Warning: run not logged to the run history: {type(error).__name__}: {error}')
        return None


def _on_terminate(signum, frame):
    """Stop (the app's SIGTERM, GitHub's SIGINT): the open row closes as stopped, then the process leaves (cron_runs's rule)."""
    run = _open.get('run')
    if run is not None:
        run['warnings'] = list(run.get('warnings') or []) + [STOPPED_WORDS]
        run['stopped'] = True
        log_run(_open['stores'], run, failed=True)
    print(STOPPED_WORDS, flush=True)
    timer = threading.Timer(EXIT_GRACE_S, lambda: os._exit(128 + signum))
    timer.daemon = True
    timer.start()
    sys.exit(128 + signum)


def _unfinished():
    """A job that ended before reporting (a crash, an early exit): its row says so instead of staying Running."""
    if _open.get('run'):
        run = _open['run']
        run['warnings'] = list(run.get('warnings') or []) + ['ended before its report (see the technical log)']
        log_run(_open['stores'], run, failed=True)


_installed = {}


def _install():
    """The stop and exit handlers, once, when this process first opens a row (src/notion/cron_runs.py installs its own at
    import while callers still use it; a process uses one of the two)."""
    if _installed:
        return
    _installed['yes'] = True
    atexit.register(_unfinished)
    for each in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(each, _on_terminate)
        except ValueError:  # not the main thread (a test): nothing to install
            pass

