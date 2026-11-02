"""The versioned result of one engine process, written for the desktop app.

stdout stays human text. When JOBADABRA_RESULT_FILE is set, this module writes one JSON object
there: v, ok, run_id, warnings, job, notion_url, mail. The same run_id is the Notion "Run id"
column (src/notion/cron_runs.py) and the id in logs/app.log and logs/engine.log.
"""
import atexit
import json
import os
import uuid

_job = None
_notion = None
_mail = None
_published = False
_minted = ''


def current_id():
    """The id for this process: JOBADABRA_RUN_ID when the app or GitHub set one, otherwise minted once."""
    global _minted
    chosen = os.environ.get('JOBADABRA_RUN_ID', '').strip()
    if chosen:
        return chosen
    if not _minted:
        _minted = uuid.uuid4().hex[:12]
    return _minted


def note_job(job):
    """The Applications row a one-job run created or updated (the same object log_job prints)."""
    global _job
    _job = job


def note_notion(url):
    """The Cronjob Runs page URL, once Notion has accepted the row."""
    global _notion
    if url:
        _notion = url


def note_mail(code):
    """Why a Gmail check ended without reading mail: spend, plan, claude, or google."""
    global _mail
    _mail = code


def publish(run, failed=False):
    """Write the result file. Later calls overwrite, so the end of the run wins over an earlier note.
    No file is set (a terminal, a test): nothing is written. Never raises."""
    global _published
    _published = True
    path = os.environ.get('JOBADABRA_RESULT_FILE', '').strip()
    if not path:
        return None
    warnings = run.get('warnings') or []
    body = {
        'v': 1,
        'ok': not failed and not warnings,
        'run_id': str(run.get('run_id') or current_id()),
        'warnings': [{'message': str(item)} for item in warnings],
        'job': _job,
        'notion_url': _notion,
        'mail': {'skipped': _mail} if _mail else None,
    }
    try:
        with open(path, 'w', encoding='utf-8') as handle:
            json.dump(body, handle)
        return body
    except OSError:
        return None


def reset():
    """Drop notes. Tests only: one process is one run."""
    global _job, _notion, _mail, _published, _minted
    _job = _notion = _mail = None
    _published = False
    _minted = ''


@atexit.register
def _at_exit():
    """A command that never opened a Cronjob Runs row still leaves a result, so the app can read the id."""
    if not _published:
        publish({'run_id': current_id(), 'warnings': []})
