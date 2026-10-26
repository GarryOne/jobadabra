"""A refresh's time budget (owner, 7 Oct 2026: "never more than 2-3 minutes"; a run read 1,650 jobs and sorted 600 titles for 30 minutes).
`start(seconds)` at the top of a run. Each AI step then takes a batch it can finish (`batch`): its share of the time left divided by its own
pace, measured on this computer by earlier refreshes (`record`), best places first (owner: "not a hard cut, a batch that is reasonably small").
What is not in the batch waits for the next refresh, said in the log. `over()` stays as a safety net for a slow day: a step starts no new
call past the deadline (a call already running finishes). No budget (a CLI run, a cloud run, a test): every step takes all it has.
One deadline, wall clock (owner, 26 Oct 2026: "A find jobs session should take at most 3min"; runs with --budget 180 took 12-23 min): every
stage in STAGES shares the run's DEADLINE, set once at start() and never moved; the reads stop at their cut (src/sources/read_budget.py),
the AI steps at their reserve, every floor at the end; a stage past its time only queues its work and says so once (later).
The seconds below are planned for the app's 180 s and scaled to the run's own budget (part). Tests: tests/test_three_minutes.py."""
import json
import threading
import time

from . import budget_tape

DEADLINE = None
STARTED = None
BEGAN = None   # when the search started (src/sources/read_budget.py cut_at)
PLANNED = 180   # the app's budget, which the seconds below are planned for (part)
RESERVE = {'titles': 70, 'enrich': 40, 'score': 0}   # seconds kept for the AI steps that come after this one
FACTS = 25   # a refresh that scores first keeps this many seconds for reading the postings' facts after it (score_first)
TAIL = 15    # no AI call starts this close to the end: one already running finishes by it (Free AI answered in ~15 s, 26 Oct 2026)
SCORING = 45   # seconds before scoring's own stop where the title floor (LOCAL_TITLES) starts no call: scoring keeps them (26 Oct 2026, a proof
#                on a copy of the owner's data: the floor's title calls held the board read to 136 s and a search scored only its 3 floor jobs)
SCORE_FIRST = False
# Every stage that reads or calls the AI after the budget starts (tests/test_three_minutes.py loops over them; a new one goes here and there).
STAGES = ('web search', 'job boards', 'employer sites', 'free job APIs', 'Google Jobs', 'job-alert emails', 'descriptions', 'places',
          'title sorting', 'scoring', 'job facts', 'kits', 'employer names')
_said = set()   # the stages that said their time-up line in this search (later)
FLOOR = 3     # the first jobs of a search are scored whatever the clock says (owner, 18 Oct 2026: "Yes, always 3"): a new user sees fits in press 1
_scored = [0]  # scores started in this search (may_score)
LOCAL_TITLES = 300  # titles in the user's own places sorted whatever the clock says, like FLOOR for scores (local_titles)
_local = [0]
_lock = threading.Lock()


def start(seconds, now=None):
    global DEADLINE, STARTED, BEGAN
    STARTED = BEGAN = now if now is not None else time.monotonic()
    DEADLINE = STARTED + seconds if seconds else None
    if seconds:
        budget_tape.new_search()
    score_first(False)
    _said.clear()
    _scored[0] = 0   # a new search: its first FLOOR scores start again whatever the clock
    _local[0] = 0


def part(seconds):
    """`seconds` of the app's PLANNED budget, in this run's own (a 3-second test run keeps the same parts as the app's 3 minutes)."""
    if DEADLINE is None or BEGAN is None:
        return seconds
    return seconds * (DEADLINE - BEGAN) / PLANNED


def ended(now=None):
    """The run's time is over: no AI call starts, TAIL before the deadline so a call running ends by it. The floors (FLOOR scores,
    LOCAL_TITLES) beat every step's reserve, never this (26 Oct 2026, a proof run: local-title calls started at 179 s ended the run at 188 s)."""
    return DEADLINE is not None and (now if now is not None else time.monotonic()) >= DEADLINE - part(TAIL)


def later(stage, n, noun):
    """Say once per search that `stage` (one of STAGES) stopped at the run's time and `n` `noun` wait for the next search (the panel shows
    it, desktop/renderer/human-log.js). Returns True, so a stage can `return` on it."""
    if stage not in _said and n:
        _said.add(stage)
        spent = int(time.monotonic() - BEGAN) if BEGAN is not None else 0
        print(f'⏱ Time is up ({spent // 60} min {spent % 60:02d} s) for {stage}: {n} {noun} {"waits" if n == 1 else "wait"} for the next search', flush=True)
    return True


def floor_left():
    """Scores this search still starts whatever the clock says (FLOOR minus those already started)."""
    return max(0, FLOOR - _scored[0])


def local_titles(wanted):
    """How many of `wanted` titles located in the user's own places are sorted whatever the clock says (and counted): the search's first
    LOCAL_TITLES. 24 Oct 2026, Chisinau: ~750 worldwide-remote titles spent the 3 minutes, and a Moldovan board's titles (the only local jobs)
    were left "for the next refresh" at 158 s."""
    if ended() or _scorings():   # the floor beats the titles' reserve, never the run's end nor scoring's share (SCORING)
        return 0
    with _lock:
        n = max(0, min(wanted, LOCAL_TITLES - _local[0]))
        _local[0] += n
        return n


def _scorings(now=None):
    """Scoring's own share has begun: SCORING seconds before scoring stops (reserve('score'))."""
    return DEADLINE is not None and (now if now is not None else time.monotonic()) >= DEADLINE - reserve('score') - part(SCORING)


def may_score(now=None):
    if now is None:
        return budget_tape.decide('may_score', [], lambda: _may_score(None))
    return _may_score(now)


def _may_score(now):
    """One job's score may start now (and is counted): before the deadline, or while the search has started fewer than FLOOR scores.
    18 Oct 2026, the persona rerun: the driver's 33 jobs were listed in press 1 and none scored, the budget spent before scoring began;
    the floor moves those 3 scores from the next search to this one (no new spend)."""
    with _lock:
        if _over('score', now) and (not floor_left() or ended(now)):   # the floor beats scoring's reserve, never the run's end
            return False
        _scored[0] += 1
        return True


def score_first(on=True):
    """This refresh scores first and reads the facts after (src/daily_search.py). Scoring then stops FACTS seconds early and the reading goes
    to the end of the budget. 10 Oct 2026: scoring took every second, the reading started with "Time is up" on every refresh, and no job ever
    had its facts (seniority, salary, languages...): 0 of 103 read."""
    global SCORE_FIRST
    SCORE_FIRST = on


def reserve(step):
    """Seconds before the deadline at which `step` starts no new call (this run's part of them, the TAIL included)."""
    if SCORE_FIRST:
        return part({'titles': RESERVE['titles'], 'enrich': 0, 'score': FACTS}.get(step, 0) + TAIL)
    return part(RESERVE.get(step, 0) + TAIL)


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
    floor = min(wanted, floor_left()) if step == 'score' and not ended(now) else 0   # never fewer than the search's first scores (may_score)
    left = DEADLINE - (now if now is not None else time.monotonic()) - part(TAIL + (FACTS if SCORE_FIRST and step in ('score', 'job') else 0))
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
    # No round when its share does not cover one (26 Oct 2026, #2064 measured: a floor of one round per call put a place round in the board
    # loop for each board; scoring started at 116 s instead of 55 s and a search scored 8 jobs instead of 28)
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
