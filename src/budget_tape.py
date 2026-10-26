"""The search tape's time-budget decisions: what `time_budget` decided at each point of a recorded search, kept beside the web and AI answers
and read back in a replay, so a replay takes the same path whatever the replaying computer's speed or thread timing (owner, 18 Oct 2026: two
replays of one tape disagreed, 35 vs 39 places and 67 vs 522 missing web answers, because a decision read a wall clock).
A loop with its own deadline (the scout's minutes) asks through until() the same way.
Off unless JOB_PILOTTO_SEARCH_TAPE is set; a live run never touches it. A decision the tape lacks (a changed search asks a new question) is
computed from the clock, as in a live run. Each process that starts a budget is the run's next search (new_search), so one tape holds every press. Same-key decisions are matched by their order (over() only ever flips false to true, so threads
asking at once still see the same number of false answers). Tests: tests/test_budget_tape.py, tests/test_scout_budget_tape.py."""
import json
import os
import threading
import time
from pathlib import Path

_lock = threading.Lock()
_epoch = [0]    # which search of the run this process is (the 1st, 2nd... to call start()): one tape holds every press's processes
_seen = {}      # key -> decisions asked so far in this process (the position of the next one)
_tape = {}      # key -> [recorded values], read once per process


def _folder():
    folder = os.getenv('JOB_PILOTTO_SEARCH_TAPE')
    return Path(folder) if folder else None


def active():
    return _folder() is not None


def _mode():
    return os.getenv('JOB_PILOTTO_SEARCH_TAPE_MODE', 'replay')


def _load():
    if _tape:
        return _tape
    file = _folder() / 'budget.jsonl'
    for line in file.read_text().splitlines() if file.exists() else []:
        try:
            record = json.loads(line)
            _tape.setdefault(record['key'], []).append(record['value'])
        except (ValueError, KeyError):
            continue
    _tape.setdefault('', [])   # marks the tape as read (an empty file is read once)
    return _tape


def new_search(name=None):
    """A process starts its time budget: it is the run's next search. The count lives in the run's own data folder (fresh for each replay and
    each recording), so the same processes in the same order get the same numbers in both. name: a step of a press that is no search of its own
    (the job boards' step, 'discover'): its own count, so the searches keep their numbers on a tape recorded before that step had a clock."""
    if not active():
        return
    from .paths import DATA
    file = DATA / (f'{name}_epoch.txt' if name else 'budget_epoch.txt')
    try:
        epoch = int(file.read_text()) + 1
    except (OSError, ValueError):
        epoch = 1
    try:
        DATA.mkdir(parents=True, exist_ok=True)
        file.write_text(str(epoch))
    except OSError:
        pass
    with _lock:
        _epoch[0] = f'{name} {epoch}' if name else epoch
        _seen.clear()


def until(name, deadline):
    """`may another step start?` for a loop with its own deadline (the scout's minutes): True while time.monotonic() is before `deadline`
    (None: always), False from its first False on. In a search tape the answers are kept, and a replay gets the recording's, so it starts
    the steps the recording started however fast its clock runs (19 Oct 2026: a replay checked 54 more employers than its recording,
    487 web answers the tape lacked). Each such process of the run is numbered by its own count in the run's data folder."""
    if deadline is None:
        return lambda: True
    number = _count(f'{name}_runs.txt') if active() else 0
    stopped = [False]

    def may():
        if not stopped[0]:
            stopped[0] = not decide(f'{name} may start', [number], lambda: time.monotonic() < deadline)
        return not stopped[0]
    return may


def _count(name):
    """This process's number among the run's processes counting in DATA/<name> (1, 2...)."""
    from .paths import DATA
    file = DATA / name
    try:
        number = int(file.read_text()) + 1
    except (OSError, ValueError):
        number = 1
    try:
        DATA.mkdir(parents=True, exist_ok=True)
        file.write_text(str(number))
    except OSError:
        pass
    return number


def decide(kind, args, compute):
    """The decision `kind(*args)`: from the tape in a replay (when it has this one), else `compute()`, kept in a recording."""
    if not active():
        return compute()
    key = json.dumps([_epoch[0], kind, *args], default=str)
    with _lock:
        position = _seen[key] = _seen.get(key, -1) + 1
        recorded = _load().get(key, [])
        if _mode() == 'replay' and position < len(recorded):
            return recorded[position]
    value = compute()
    if _mode() == 'record':
        with _lock:
            _folder().mkdir(parents=True, exist_ok=True)
            with open(_folder() / 'budget.jsonl', 'a', encoding='utf-8') as file:
                file.write(json.dumps({'key': key, 'value': value}) + '\n')
    return value


def within(name, key, used, limit):
    """`may another call of `name` be made for `key`?` for a per-run limit on model calls (the page reader's 25, the decide batches' 60): plain `used < limit` live;
    in a search tape the answer is kept per `key` (the page or batch asked about) and a replay gets the recording's, so the calls go to the pages the recording
    called, whatever order the replay's threads reach them in (19 Oct 2026, heal proof 5: 2 careers pages asked that the recording had not, a count of
    who came first). A key the tape lacks (a changed search) is the plain count."""
    return decide(f'{name} within limit', [key], lambda: used < limit)
