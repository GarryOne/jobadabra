"""Source scout, Google results for job boards: the board pass's second source of candidates, for boards the AI's own list and the Anthropic web
search never name (owner, 26 Oct 2026, "Yes, free plan only": a pilot board ranked 4th on Google for "first officer pilot jobs Europe" while
Anthropic's search never returned it, not even for its own name). Per kind of work and country, at most PER_PAIR SerpApi searches, once ever;
only the result addresses are kept, each new site's page is judged by the AI for that kind of work (src/sources/board_check.py field_kind), and
only a 'field board' joins the pass (a site not judged waits for the next run, never searched again), where its local jobs are measured like any proposed board (src/scout_boards.py).
Hard stops (SerpApi's free plan: 250 searches a month, shared with the owner's own key use): MONTH_CAP of ours a month, never when the account
(free to ask) has RESERVE or fewer left, at most PER_RUN a run. Off without SCOUT_SERPAPI_KEY (GitHub secret CENTRAL_SCOUT_SERPAPI_KEY), said in the log. Never SERPAPI_API_KEY on the scout: that name turns on
the role and hiring searches' SerpApi lane (src/sources/web_search.py provider), uncapped by these stops.
Tests: tests/test_scout_google_boards.py."""
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from . import pool_tags, role_kinds, scout_cells

SEARCH_URL = 'https://serpapi.com/search.json'
KEY_ENV = 'SCOUT_SERPAPI_KEY'
MONTH_CAP = 200   # our searches a month: below the free plan's 250, room left for the owner's own use of the key
RESERVE = 20      # never search when the account has this many or fewer left
PER_RUN = 12      # searches a scout run
PER_PAIR = 6      # searches per kind of work and country: its first 3 field words, 2 forms each
FORMS = ('{word} jobs {country}', '{word} job board {country}')
MAX_JUDGED = 15   # sites whose page the AI judges per run: also the judge's own AI allowance (decide allowance=, outside the scout's 600)
TRIES = 3         # runs a site the AI could not judge waits for an answer
WAITING = 40      # sites kept waiting per country


def _get(url, params, opener=urllib.request.urlopen):
    request = urllib.request.Request(f'{url}?{urllib.parse.urlencode(params)}', headers={'User-Agent': 'job-pilotto'})
    with opener(request, timeout=40) as response:
        return json.load(response)


def queries(kind, country):
    """The searches for one kind of work in one country: its first field words (src/role_kinds.py WORK) in each form."""
    words = [word.strip() for word in role_kinds.WORK.get(kind, '').split(',') if word.strip()][:PER_PAIR // len(FORMS)]
    return [form.format(word=word, country=country) for word in words for form in FORMS]


def _month(db, now):
    used = scout_cells._meta(db, 'serp_month', {})
    month = now.strftime('%Y-%m')
    return month, int(used.get('used') or 0) if used.get('month') == month else 0


def boards(db, country, kinds, judge, key=None, get=_get, account=None, now=None, out=print):
    """[board] the AI judged as field boards among Google's results for these kinds of work in this country (pool id), never searched for this pair
    before, plus the sites an earlier run found but could not judge (judged first: never searched again); [] when off or nothing to judge.
    judge(board, roles) -> 'field board' / 'job board' / 'one employer' / 'other' / None (not judged: the site waits, at most TRIES runs)."""
    key = os.getenv(KEY_ENV, '').strip() if key is None else key
    if not key:
        out(f'Board pass, Google results: off (no {KEY_ENV})')
        return []
    name = pool_tags.COUNTRIES.get(country, country)
    waiting = scout_cells._meta(db, 'serp_waiting', {})
    waiting = waiting if isinstance(waiting, dict) else {}
    earlier = [board for board in waiting.get(country) or [] if isinstance(board, dict) and board.get('host')]
    found = {board['host']: board for board in earlier}
    searched, used = _search(db, country, name, kinds, key, get, account, now or datetime.now(timezone.utc), out, found)
    if not found:
        return []
    kept, said, still = [], {}, []
    for number, board in enumerate(found.values()):
        if number >= MAX_JUDGED:
            still.append(board)
            continue
        answer = judge(board, [role_kinds.WORK.get(board['kinds'][0], board['kinds'][0])]) or 'no answer'
        said.setdefault(answer, []).append(board['host'])
        if answer == 'field board':
            kept.append({field: value for field, value in board.items() if field != 'tries'} | {'name': board['host']})
        elif answer == 'no answer' and int(board.get('tries') or 0) + 1 < TRIES:
            still.append({**board, 'tries': int(board.get('tries') or 0) + 1})
    scout_cells._set(db, 'serp_waiting', {**waiting, country: still[:WAITING]})
    db.commit()
    verdicts = '; '.join(f"{answer}: {', '.join(hosts)}" for answer, hosts in sorted(said.items(), key=lambda item: item[0] != 'field board'))
    out(f"Board pass, Google results: {name}: {searched} searches ({used + searched} of {MONTH_CAP} this month), {len(found)} sites"
        + (f" ({len(earlier)} from earlier runs)" if earlier else '') + f", {len(kept)} field boards" + (f"; judged {verdicts}" if verdicts else '')
        + (f"; not judged (over {MAX_JUDGED}): {len(found) - MAX_JUDGED}" if len(found) > MAX_JUDGED else '')
        + (f"; {len(still[:WAITING])} wait for the next run" if still else ''))
    return kept


def _search(db, country, name, kinds, key, get, account, now, out, found):
    """Google's results for this country's kinds of work not searched before, added to `found` (host -> board); (searches made, used before)."""
    from .ai import board_ideas
    done = set(scout_cells._meta(db, 'serp_pairs', []))
    pairs = [kind for kind in kinds if f'{kind}|{country}' not in done]
    month, used = _month(db, now)
    if not pairs:
        return 0, used
    try:
        left = (account or (lambda: get('https://serpapi.com/account.json', {'api_key': key})))()
        left = int(left.get('total_searches_left', left.get('plan_searches_left', 0)))
    except Exception as error:  # noqa: BLE001 — no account answer: no search (the stop must hold)
        out(f'Board pass, Google results: skipped, the account did not answer ({type(error).__name__})')
        return 0, used
    allowed = min(PER_RUN, MONTH_CAP - used, left - RESERVE)
    if allowed <= 0:
        out(f'Board pass, Google results: stopped: {used} of {MONTH_CAP} searches used in {month}, {left} left on the account (keeps {RESERVE})')
        return 0, used
    searched = 0
    for kind in pairs:
        asked = queries(kind, name)
        if searched + len(asked) > allowed:
            break
        for query in asked:
            searched += 1
            scout_cells._set(db, 'serp_month', {'month': month, 'used': used + searched})   # counted before the answer: a failed call still used one
            db.commit()
            try:
                data = get(SEARCH_URL, {'engine': 'google', 'q': query, 'num': 10, 'api_key': key})
            except Exception:  # noqa: BLE001 — one failed search: the next one
                continue
            for result in data.get('organic_results') or []:
                board = board_ideas.valid({'name': result.get('title') or '', 'search_url': str(result.get('link') or ''), 'countries': [name],
                                           'kinds': [kind], 'source_kind': 'sector'})
                if board and board['host'] not in found:
                    found[board['host']] = board
        done.add(f'{kind}|{country}')
        scout_cells._set(db, 'serp_pairs', sorted(done))
        db.commit()
    return searched, used
