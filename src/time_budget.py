"""A refresh's time budget (owner, 7 Oct 2026: "never more than 2-3 minutes"; a run read 1,650 jobs and sorted 600 titles for 30 minutes).
`start(seconds)` at the top of a run. Each AI step then takes a batch it can finish (`batch`): its share of the time left divided by its own
pace, measured on this computer by earlier refreshes (`record`), best places first (owner: "not a hard cut, a batch that is reasonably small").
What is not in the batch waits for the next refresh, said in the log. `over()` stays as a safety net for a slow day: a step starts no new
call past the deadline (a call already running finishes). No budget (a CLI run, a cloud run, a test): every step takes all it has."""
import json
import threading
import time

from . import budget_tape

DEADLINE = None
STARTED = None
RESERVE = {'titles': 75, 'enrich': 40, 'score': 0}   # seconds kept for the AI steps that come after this one
FACTS = 60   # a refresh that scores first keeps this many seconds for reading the postings' facts after it (score_first)
SCORE_FIRST = False
SCORE_OWN = 180   # seconds scoring gets of its own once placing and sorting are done (score_own)
FLOOR = 3     # the first jobs of a search are scored whatever the clock says (owner, 18 Oct 2026: "Yes, always 3"): a new user sees fits in press 1
_scored = [0]  # scores started in this search (may_score)
LOCAL_TITLES = 300  # titles in the user's own places sorted whatever the clock says, like FLOOR for scores (local_titles)
_local = [0]
_lock = threading.Lock()


def start(seconds, now=None):
    global DEADLINE, STARTED
    STARTED = now if now is not None else time.monotonic()
    DEADLINE = STARTED + seconds if seconds else None
    if seconds:
        budget_tape.new_search()
    score_first(False)
    _scored[0] = 0   # a new search: its first FLOOR scores start again whatever the clock
    _local[0] = 0


def floor_left():
    """Scores this search still starts whatever the clock says (FLOOR minus those already started)."""
    return max(0, FLOOR - _scored[0])


def local_titles(wanted):
    """How many of `wanted` titles located in the user's own places are sorted whatever the clock says (and counted): the search's first
    LOCAL_TITLES. 24 Oct 2026, Chisinau: ~750 worldwide-remote titles spent the 3 minutes, and a Moldovan board's titles (the only local jobs)
    were left "for the next refresh" at 158 s."""
    with _lock:
        n = max(0, min(wanted, LOCAL_TITLES - _local[0]))
        _local[0] += n
        return n


def may_score(now=None):
    if now is None:
        return budget_tape.decide('may_score', [], lambda: _may_score(None))
    return _may_score(now)


def _may_score(now):
    """One job's score may start now (and is counted): before the deadline, or while the search has started fewer than FLOOR scores.
    18 Oct 2026, the persona rerun: the driver's 33 jobs were listed in press 1 and none scored, the budget spent before scoring began;
    the floor moves those 3 scores from the next search to this one (no new spend)."""
    with _lock:
        if _over('score', now) and not floor_left():
            return False
        _scored[0] += 1
        return True


def restart(now=None):
    """The crawl is over: the AI steps get the whole budget from here. 17 Oct 2026: the clock started with the process, the employer crawl
    (910 feeds, 6-40 min) outlasted the 3 minutes, and every AI step found "No time left": 0 jobs scored since 10 Oct, 2868 waiting.
    The budget (set 7 Oct, a9bedff, when the crawl took ~1 min) is for the AI steps, not for downloading."""
    global DEADLINE, STARTED
    if DEADLINE is None:
        return
    seconds = DEADLINE - STARTED
    STARTED = now if now is not None else time.monotonic()
    DEADLINE = STARTED + seconds


def score_own(now=None):
    """Scoring gets SCORE_OWN seconds of its own, plus the FACTS the reading keeps, counted from now: the AI steps before it (employer
    reading, placing, title sorting) no longer spend the whole budget first. 18 Oct 2026, #1440: those steps took ~165 of the 180 s, scoring
    got the 3-job floor, and Cluj's first search scored 6 jobs instead of 57 (same tape, replayed). Never shortens a deadline."""
    global DEADLINE
    if DEADLINE is None:
        return
    DEADLINE = max(DEADLINE, (now if now is not None else time.monotonic()) + SCORE_OWN + FACTS)


def score_first(on=True):
    """This refresh scores first and reads the facts after (src/daily_search.py). Scoring then stops FACTS seconds early and the reading goes
    to the end of the budget. 10 Oct 2026: scoring took every second, the reading started with "Time is up" on every refresh, and no job ever
    had its facts (seniority, salary, languages...): 0 of 103 read."""
    global SCORE_FIRST
    SCORE_FIRST = on


def reserve(step):
    """Seconds before the deadline at which `step` starts no new call."""
    if SCORE_FIRST:
        return {'titles': RESERVE['titles'], 'enrich': 0, 'score': FACTS}.get(step, 0)
    return RESERVE.get(step, 0)


def over(step='score', now=None, key=None):
    """True when `step` must not start another AI call: the run's budget, minus what the later steps keep, is spent. On a search tape the
    answer is the recorded one (src/budget_tape.py): a replay takes the recording's path, not its own clock's. Batches that run side by
    side name themselves with `key` (their first item): the answer is kept per batch, not per call position, which is the threads' arrival order
    (19 Oct 2026, heal proof 6: 18 title questions the recording had skipped as out of time were asked by the replay)."""
    if now is None:
        return budget_tape.decide('over', [step] if key is None else [step, str(key)], lambda: _over(step, None))
    return _over(step, now)


def _over(step, now):
    if DEADLINE is None:
        return False
    return (now if now is not None else time.monotonic()) >= DEADLINE - reserve(step)


# Each step's share of the time left when it starts: title sorting least (a backlog that shrinks to a few dozen titles a day), scoring all
# that remains (it puts jobs in your list with a fit). Default paces (seconds of wall time per item, Claude Code taking 2 calls at a time):
# measured on the owner's Mac, 7 Oct 2026; replaced by this computer's own after one refresh.
SHARE = {'place_rounds': 0.15, 'place_vague': 0.05, 'place_reading': 0.1, 'title_rounds': 0.2, 'enrich': 0.45, 'score': 1.0, 'job': 1.0}
PACE = {'place_rounds': 10.0, 'place_vague': 6.0, 'place_reading': 15.0, 'title_rounds': 10.0, 'enrich': 12.0, 'score': 3.0, 'job': 15.0}   # job: read and scored, end to end; *_rounds: per round of calls
NOUN = {'place_rounds': 'round(s) of place calls', 'place_vague': 'round(s) of vague-location calls', 'place_reading': 'round(s) of postings read for their place', 'title_rounds': 'round(s) of title calls', 'enrich': 'job(s) to read', 'score': 'job(s) to score', 'job': 'new job(s)'}
WORDS = {'place_rounds': 'places {n} of {total} job locations', 'place_vague': 'checks {n} of {total} locations for a town', 'place_reading': 'reads {n} of {total} postings for their place', 'title_rounds': 'sorts {n} of {total} job titles', 'enrich': 'reads {n} of {total} new jobs', 'score': 'scores {n} of {total} jobs',
         'job': 'reads and scores {n} of {total} new jobs'}


def _paces():
    from .paths import DATA
    try:
        return {**PACE, **json.loads((DATA / 'step_pace.json').read_text())}
    except (OSError, ValueError):
        return dict(PACE)


def batch(step, wanted, now=None, say=True):
    if now is None:
        return budget_tape.decide('batch', [step, wanted], lambda: _batch(step, wanted, None, say))
    return _batch(step, wanted, now, say)


def _batch(step, wanted, now, say):
    """How many of `wanted` items this step takes so the refresh ends on time: its share of the time left, at its measured pace. Says the
    plan in the log when it takes fewer (say=False: a step that tops up with further batches says what is left once, at its end). Without a budget: all of them."""
    if DEADLINE is None or wanted <= 0:
        return wanted
    floor = min(wanted, floor_left()) if step == 'score' else 0   # never fewer than the search's first scores (may_score)
    left = DEADLINE - (now if now is not None else time.monotonic()) - (FACTS if SCORE_FIRST and step in ('score', 'job') else 0)
    pace = max(0.5, _paces().get(step, PACE[step]))
    n = max(floor, min(wanted, int(left * SHARE[step] / pace)))
    if not say:
        return n
    if not n:
        print(f'⏱ No time left in this refresh to {WORDS[step].split(" ", 1)[0].rstrip("s")} any: {wanted} {NOUN[step]} wait for the next one', flush=True)
    elif n < wanted:
        print(f'⏱ This refresh {WORDS[step].format(n=n, total=wanted)} (about {round(pace, 1):g} s each, to finish in about '
              f'{round((DEADLINE - STARTED) / 60, 1):g} min); {wanted - n} wait for the next refresh, best places and closest jobs first', flush=True)
    return n


def in_calls(step, wanted, size, parallel, now=None, noun='location(s)'):
    if now is None:
        return budget_tape.decide('in_calls', [step, wanted, size, parallel], lambda: _in_calls(step, wanted, size, parallel, None, noun))
    return _in_calls(step, wanted, size, parallel, now, noun)


def _in_calls(step, wanted, size, parallel, now, noun):
    """How many of `wanted` items a step that answers `size` items a call, `parallel` calls at once, takes: its share of the time left
    over its measured time per round of calls (7 Oct 2026: placing locations was paced per location, at least 0.5 s each, so a refresh
    asked 32 of 1,500 locations in one call when Haiku answers 60 a call in ~6 s, two at a time)."""
    if DEADLINE is None or wanted <= 0:
        return wanted
    per_round = size * max(1, parallel)
    rounds = _batch(step, -(-wanted // per_round), now, False)
    n = min(wanted, rounds * per_round)
    if not n:
        print(f'⏱ No time left in this refresh for these: {wanted} {noun} wait for the next one', flush=True)
    elif n < wanted:
        print(f'⏱ This refresh {WORDS[step].format(n=n, total=wanted)} ({rounds} round(s) of {max(1, parallel)} calls, about '
              f'{round(max(0.5, _paces().get(step, PACE[step])), 1):g} s each); {wanted - n} wait for the next refresh, best places first', flush=True)
    return n


def record(step, seconds, done):
    """This computer's pace for `step` (wall seconds per item), smoothed over refreshes, for the next one's batch."""
    if DEADLINE is None or done <= 0 or seconds <= 0:   # only a refresh with a budget measures (never a test or a one-off command)
        return
    from .paths import DATA
    paces = _paces()
    paces[step] = round(0.5 * paces.get(step, PACE[step]) + 0.5 * seconds / done, 2)
    try:
        DATA.mkdir(parents=True, exist_ok=True)
        (DATA / 'step_pace.json').write_text(json.dumps({k: paces[k] for k in PACE}))
    except OSError:
        pass


def left_line(step, left, noun='job(s)'):
    """The run's line for work left over: said once per step, so the user knows nothing was dropped."""
    return f'⏱ Time is up for this refresh: {left} {noun} left for the next one (it stops at {round((DEADLINE - STARTED) / 60, 1):g} min)'


def best_first(jobs):
    """Jobs in your best places first (Search settings "Best places"), then the closest to your search (src/job_rank.py: your role words,
    level and skills), the order kept otherwise: a short search spends its time on them."""
    from .paths import load_search_config, place_regex
    from .job_rank import ranker
    search = load_search_config()
    best = place_regex((search.get('locations') or {}).get('top_tier') or [r'(?!x)x'])
    closeness = ranker(search)
    from .sources import feeds
    def first(job):   # Claude's answer when it placed the location (src/ai/place_triage.py), else the best places' words
        verdict = feeds.place_of(job)
        return (0 if (verdict == 'best' if verdict is not None else feeds.mentions(best, job.get('location') or '')) else 1, -closeness(job))
    return sorted(jobs, key=first)
