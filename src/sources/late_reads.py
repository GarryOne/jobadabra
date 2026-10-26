"""Answers that land after a timed search's read cut, kept for the next search (owner, 26 Oct 2026: "We want a soft stop. And next one to
continue/start properly without redoing the same job"). A read still open at the cut is not waited for and not killed: when it ends, its
answer goes to data/late_reads.json (an employer site's jobs, a job board's page result), and the next search takes it there instead of
asking the site again. A board whose other ways were cut keeps its page result here too, so the next search goes up its ladder from it.
An answer older than MAX_HOURS is dropped (the site may have changed). Tests: tests/test_three_minutes_resume.py."""
import json
import os
import threading
from datetime import datetime, timedelta, timezone

from .. import paths

FILE = 'late_reads.json'
MAX_HOURS = 6   # as feed_facts.FRESH_HOURS: a list read this recently is not read again
_lock = threading.Lock()


def _file():
    return paths.DATA / FILE


def _load():
    try:
        data = json.loads(_file().read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(data):   # whole or not at all: the process may end while a late read writes (src/run_exit.py)
    part = _file().with_suffix('.part')
    part.write_text(json.dumps(data, ensure_ascii=False, default=str))
    os.replace(part, _file())


def keep(kind, key, answer, now=None):
    """Keep `answer` (JSON) for the next search's read of `key` (kind: 'employer' or 'board'). Called from the reading thread itself."""
    at = (now or datetime.now(timezone.utc)).isoformat(timespec='seconds')
    with _lock:
        data = _load()
        data.setdefault(kind, {})[key] = {'at': at, 'answer': answer}
        try:
            _file().parent.mkdir(parents=True, exist_ok=True)
            _write(data)
        except OSError:
            pass


def take(kind, key, now=None):
    """The kept answer for `key`, removed from the file; None when there is none or it is older than MAX_HOURS."""
    with _lock:
        data = _load()
        kept = (data.get(kind) or {}).pop(key, None)
        if kept is None:
            return None
        try:
            _write(data)
        except OSError:
            pass
    try:
        fresh = (now or datetime.now(timezone.utc)) - datetime.fromisoformat(kept['at']) < timedelta(hours=MAX_HOURS)
    except (KeyError, TypeError, ValueError):
        return None
    return kept.get('answer') if fresh else None


def when_done(future, kind, key, answer_of):
    """Keep the future's answer when it ends (answer_of(result) -> JSON, or None to keep nothing); a failed read keeps nothing."""
    def done(finished):
        try:
            answer = answer_of(finished.result())
        except Exception:  # noqa: BLE001 — a failed late read: the next search asks the site itself
            return
        if answer is not None:
            keep(kind, key, answer)
    future.add_done_callback(done)
