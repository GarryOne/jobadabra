"""Notion "⏰ Cronjob Runs": one row per scheduled pipeline run, with its cost and a mini-report.

`daily.main()` fills a run dict as it goes (crawl counts, per-stage AI stats from enrich/score/kit,
Job Matches sync, Telegram outcome, warnings) and hands it to `log_run` at the end. The report is
written by code from those numbers, so it costs nothing; a Notion failure never fails the run.
"""
import atexit
import signal
import json
from collections import deque
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from html import unescape
import os
import re
import sys

from .. import run_result, tz
from ..warning_lines import record_logged_warnings
from ..stores.notion_columns import without_missing as _without_missing
# Rendering lives in cron_report.py; every name stays importable from here.
from .cron_report import (  # noqa: F401
    STAGES, clip, _text, _para, _linked, _sender, _clock, EMAIL_ACTION, email_lines, total_usd, total_tokens,
    billed_to, cost_text, status, mail_lines, ONE_OFF, STEP_NAME, report_lines, CRAWL_MODES, KINDS, TZ,
    SUBJECT_MAX, counted, job_subject, subject, title, JOB_LINE, log_job, run_page, plain, RESULT_PARAS,
    _result_paras, extra_blocks)

CRON_RUNS_DATABASE_ID = os.getenv('NOTION_CRON_RUNS_DB', '')


def new_run(mode):
    """The run dict an AI job fills for its ⏰ Cronjob Runs row; trigger and link come from GitHub Actions.
    Every AI job logs one (crawls, kits, insights, interviews, mail), so the rows add up to the month's spend."""
    event = os.getenv('GITHUB_EVENT_NAME', '')
    # The desktop app says what started it (JOB_PILOTTO_TRIGGER: "Mac schedule" or "Mac (you)").
    trigger = os.getenv('JOB_PILOTTO_TRIGGER') or {'schedule': 'Schedule', '': 'Local'}.get(event, 'Manual')
    run = {'mode': mode, 'started_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
           'trigger': trigger, 'warnings': [], 'run_id': run_result.current_id()}
    if os.getenv('GITHUB_RUN_ID'):
        run['run_url'] = (f"{os.getenv('GITHUB_SERVER_URL', 'https://github.com')}/"
                          f"{os.getenv('GITHUB_REPOSITORY', '')}/actions/runs/{os.getenv('GITHUB_RUN_ID')}")
    if _auto.get('tracker') and mode in LOGGED_MODES and not _open.get('run'):
        begin(_auto['tracker'], run)
    return run


# The jobs that always end with a row (log_run), so opening one at the start is safe (see begin()).
LOGGED_MODES = {'scheduled', 'run', 'today', 'prepare', 'add', 'interview', 'insight', 'weekly', 'mail', 'rejection', 'scout', 'prep', 'import', 'kits'}
_auto = {}


def auto_begin(tracker):
    """This process logs its run: the next new_run() opens the row at once (Status Running)."""
    _auto['tracker'] = tracker




# Notion is where every run's history lives, wherever it ran (this Mac, GitHub, a Telegram button): the row
# appears when the job starts (Status Running), and at the end holds the report, what the job produced (the
# message it sent or showed) and the last lines of its output. The app, Telegram and Notion all read these rows.
LOG_LINES = 80
_output = deque(maxlen=LOG_LINES)
_open = {}  # the row this process opened with begin(): {'tracker', 'id', 'url', 'run'}


class _Tee:
    """stdout/stderr, also kept (last lines) for the run's page."""
    def __init__(self, stream):
        self.stream, self.partial = stream, ''

    def write(self, text):
        self.partial += text
        *lines, self.partial = self.partial.split('\n')
        lines = [line for line in lines if line.strip()]
        _output.extend(lines)
        if lines:
            _progress(lines[-1])
        return self.stream.write(text)

    def __getattr__(self, name):
        return getattr(self.stream, name)


def capture():
    if not isinstance(sys.stdout, _Tee):
        sys.stdout, sys.stderr = _Tee(sys.stdout), _Tee(sys.stderr)


def begin(tracker, run):
    """Open the run's row now (Status Running), so a job in progress shows everywhere; log_run() completes it.
    Returns its URL, or None (never raises, but run_log.BothLogs)."""
    _one_log()
    capture()
    if not tracker or not CRON_RUNS_DATABASE_ID:
        return None
    try:
        properties = {key: value for key, value in run_page(run, final=False)[0].items()
                      if key in ('Run', 'Started', 'Mode', 'Trigger', 'Run URL', 'Run id')}
        properties['Status'] = {'select': {'name': 'Running'}}
        page = _without_missing(lambda props: tracker._request(
            'POST', 'pages', {'parent': {'database_id': CRON_RUNS_DATABASE_ID}, 'properties': props}), properties)
        _open.update(tracker=tracker, id=page['id'], url=page.get('url'), run=run)
        _heartbeat(run)
        run_result.note_notion(page.get('url'))
        print(f"Cronjob run logged: {page.get('url')}")  # the desktop app links its activity row to this
        return page.get('url')
    except Exception as error:
        print(f'Warning: cronjob run not opened in Notion: {type(error).__name__}: {error}')
        return None


def _one_log():
    """src/run_log.py opened this process's row: a half-switched caller (see run_log.BothLogs)."""
    from .. import run_log
    if run_log._open.get('id'):
        raise run_log.BothLogs('this process opened its run row with src/run_log.py: log it there too')


def running():
    """True while a run's row is open in this process (attach() would put blocks there): a log uploads its screenshots for the
    run only then, else they go with the job (src/ai/inbox_notion.py)."""
    return bool(_open.get('id') and _open.get('tracker'))


def attach(blocks):
    """Add blocks (a log's screenshots) to the row begin() opened, while its run is going. Returns that row's URL, or None
    when no row is open or Notion refuses (the caller keeps them elsewhere). Never raises."""
    if not blocks or not _open.get('id') or not _open.get('tracker'):
        return None
    try:
        _open['tracker']._request('PATCH', f"blocks/{_open['id']}/children", {'children': blocks[:100]})
        return _open.get('url') or ''
    except Exception as error:  # noqa: BLE001
        print(f'Warning: not added to the run: {type(error).__name__}: {error}', file=sys.stderr)
        return None


STEP_EVERY = 10  # seconds between progress updates of a running row
# A running row is edited at least this often, even through a long quiet step: its time so far goes into Duration (s). The app takes a "Running"
# row nobody edited for 30 minutes as a lost run (desktop/lib/run-history.js LOST_MS): 7 Oct 2026, a run killed hard (SIGKILL: a GitHub
# force-cancel, a dead runner, a crashed app not opened again) cannot close its row, and it showed as running for 3 hours.
HEARTBEAT_S = 300


def _heartbeat(run):
    """While this run's row is open, write its elapsed seconds every HEARTBEAT_S (a daemon thread: it ends with the process)."""
    import threading
    import time
    began = time.monotonic()

    def beat():
        stop = threading.Event()
        while not stop.wait(HEARTBEAT_S):
            if _open.get('run') is not run:   # the row was completed (log_run) or replaced: nothing to keep alive
                return
            try:
                _open['tracker']._request('PATCH', f"pages/{_open['id']}", {'properties': {'Duration (s)': {'number': round(time.monotonic() - began)}}})
            except Exception:  # noqa: BLE001 - best effort, like _progress
                pass
    threading.Thread(target=beat, name='run-row-heartbeat', daemon=True).start()
_last_step = {'at': 0.0}
# A crash's traceback and exception line are not a step (the app's own rule: desktop/lib/pipeline.js CRASH_LINE). 7 Oct 2026: the app was killed
# mid-run on Windows, Python died printing its traceback, and the row stayed "Running" with "⏳ Traceback (most recent call last):" in Recent activity.
CRASH_LINE = re.compile(r'^(?:Traceback \(most recent call last\)|(?:[\w.]+\.)?[A-Z]\w*(?:Error|Exception|Exit|Interrupt)\b)')


def _progress(line):
    """A running job's latest output line as its row's Summary (⏳ …), at most every STEP_EVERY seconds, so a
    job running elsewhere (GitHub, a Telegram button) shows some progress in the app and in Notion."""
    import time
    if not _open.get('run') or len(line) > 160 or line.startswith(('Warning', ' ', 'Cronjob run logged', JOB_LINE, '<<<', 'message>>>')) or CRASH_LINE.match(line):
        return
    now = time.monotonic()
    if now - _last_step['at'] < STEP_EVERY:
        return
    _last_step['at'] = now
    try:
        _open['tracker']._request('PATCH', f"pages/{_open['id']}", {'properties': {'Summary': _text(f'⏳ {line}')}})
    except Exception:  # noqa: BLE001 - progress is best effort
        pass




def log_run(tracker, run, failed=False):
    """Complete the row begin() opened (or create it); returns its URL, or None when Notion refuses (never raises,
    but run_log.BothLogs)."""
    from .. import telegram
    _one_log()
    try:
        if failed:
            run['failed'] = True  # the report's words (report_lines): a run that crashed never says "done"
        record_logged_warnings(run, list(_output))  # what the run logged as a warning is recorded too: the row's Status and the panel agree (src/warning_lines.py)
        properties, children = run_page(run, final=not failed)
        if failed:
            properties['Status'] = {'select': {'name': 'Failed'}}
        children = children[:50] + extra_blocks(telegram.MESSAGES, list(_output), run)
        if _open.get('id') and _open.get('run') is run:
            _open.pop('run')
            try:
                _without_missing(lambda props: tracker._request('PATCH', f"pages/{_open['id']}", {'properties': props}), properties)
                tracker._request('PATCH', f"blocks/{_open['id']}/children", {'children': children[:100]})
                url = _open.get('url')
                run_result.note_notion(url)
                run_result.publish(run, failed=failed)
                return url
            except Exception as error:  # noqa: BLE001
                # The opened row was archived or deleted while the run ran (a person tidying Notion, a test reset): write a new
                # row instead, or the run never ends in Recent activity (5 Oct 2026). Anything else is a real failure.
                if not re.search(r'archived|Could not find|404', str(error), re.I):
                    raise
                print(f"Warning: the run's Notion row {_open['id']} was archived or deleted during the run; writing a new row")
                _open.clear()
        page = _without_missing(lambda props: tracker._request('POST', 'pages', {'parent': {'database_id': CRON_RUNS_DATABASE_ID},
                                                                                'properties': props, 'children': children[:100]}), properties)
        run_result.note_notion(page.get('url'))
        run_result.publish(run, failed=failed)
        return page.get('url')
    except Exception as error:
        run_result.publish(run, failed=True)
        print(f'Warning: cronjob run not logged to Notion: {type(error).__name__}: {error}')
        return None


STOPPED_WORDS = 'Stopped before it finished: Jobadabra was closed, or Stop was pressed'
EXIT_GRACE_S = 3


def _on_terminate(signum, frame):
    """The app stops a run with SIGTERM (Stop, quitting the app, its watchdog); GitHub's cancel (Stop on a GitHub run) with SIGINT. The open row is closed as stopped here, then the run
    leaves through sys.exit so `finally` and atexit run; worker threads still busy (the scout checks 6 employers at once, each with a
    Claude call) are not waited for: the process ends EXIT_GRACE_S later whatever they do. 7 Oct 2026: a scout kept running for
    minutes after the app quit, held the run lock, and the restarted run waited for it."""
    import threading
    run = _open.get('run')
    if run is not None:
        run['warnings'] = list(run.get('warnings') or []) + [STOPPED_WORDS]
        run['stopped'] = True
        try:
            log_run(_open['tracker'], run, failed=True)
        except Exception:  # noqa: BLE001  log_run never raises; a stop must not hang on Notion either way
            pass
    print(STOPPED_WORDS, flush=True)
    timer = threading.Timer(EXIT_GRACE_S, lambda: os._exit(128 + signum))
    timer.daemon = True
    timer.start()
    sys.exit(128 + signum)


# SIGINT too: Stop on a GitHub run cancels it there, and Actions sends SIGINT first (then SIGTERM, then a kill): the row says
# "Stopped", not "ended before its report" (7 Oct 2026).
for _signal in (signal.SIGTERM, signal.SIGINT):
    try:
        signal.signal(_signal, _on_terminate)
    except ValueError:  # not the main thread (a test): nothing to install
        pass


@atexit.register
def _unfinished():
    """A job that ended before reporting (a crash, an early exit): its row says so instead of staying Running."""
    if _open.get('run'):
        run = _open['run']
        run['warnings'] = list(run.get('warnings') or []) + ['ended before its report (see the technical log)']
        log_run(_open['tracker'], run, failed=True)
