"""This search's own numbers (jobs looked at, matches, scored, good fits), each job counted once by its URL, printed as one structured line the Find jobs card reads."""
import threading

PREFIX = 'Run counts: '
_lock = threading.Lock()
_sets = {'looked': set(), 'matches': set(), 'scored': set(), 'good': set()}


def reset():
    with _lock:
        for seen in _sets.values():
            seen.clear()


def line():
    return f"{PREFIX}looked={len(_sets['looked'])} matches={len(_sets['matches'])} scored={len(_sets['scored'])} good={len(_sets['good'])}"


def _add(kind, keys):
    with _lock:
        seen = _sets[kind]
        before = len(seen)
        seen.update(str(key).strip() for key in keys if key)
        if kind != 'looked':
            _sets['looked'].update(str(key).strip() for key in keys if key and kind == 'matches')   # a match was looked at
        changed = len(seen) != before
        if changed:
            print(line(), flush=True)   # the card shows the latest one (desktop/renderer/find-card-model.js runCounts)


def waiting():
    """Jobs this search matched and has not scored yet (src/time_budget.py local_titles: while any waits, the title floor leaves scoring its share)."""
    with _lock:
        return len(_sets['matches'] - _sets['scored'])


def looked(jobs):
    _add('looked', [job.get('url') or job.get('id') for job in jobs])


def matched(jobs):
    _add('matches', [job.get('url') or job.get('id') for job in jobs])


GOOD_FIT = 70   # the Jobs page's "high fit" bar (desktop/renderer/jobs-view.js)


def scored(job, score=None):
    key = job.get('url') or job.get('id')
    _add('scored', [key])
    if key:   # a job scored again below the bar is no longer a good fit
        with _lock:
            before = len(_sets['good'])
            (_sets['good'].add if (score or 0) >= GOOD_FIT else _sets['good'].discard)(str(key).strip())
            if len(_sets['good']) != before:
                print(line(), flush=True)
