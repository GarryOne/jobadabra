"""Which job titles could fit this search (owner, 7 Oct 2026: "Only the location should be strict"): the title gate in front of the AI fit
score was the search's exact role words, so "Client Advisor" at Vacheron Constantin in Geneva and Fnac's "Collaborateur Magasin" were never
scored. Now a title in the user's places that the words miss is shown to Haiku with the search (role words, words ruled out); it answers which
could fit, and each decision is kept per search (data/title_triage.json), so a title is asked about once. The fit score then grades them.

What Haiku sees: job titles and the search's own words, nothing else (no CV, no profile, no employer). Off without AI, or with
JOB_PILOTTO_DISABLE=title_triage: the exact role words only, as before.
"""
import hashlib
import json
import time
import threading

from ..paths import DATA
from .models import SMALL_MODEL
from . import batch_scope, providers

MODEL = SMALL_MODEL
BATCH = 30   # ~30 s a batch through Claude Code (100 took ~2 min): a 3-minute search can stop between them
MAX_NEW = 600       # titles asked about in one run at most (a first run on a big list is spread over the next ones)
STORE = DATA / 'title_triage.json'
LOCK = threading.Lock()
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['fit'],
          'properties': {'fit': {'type': 'array', 'items': {'type': 'integer'}, 'description': 'The numbers of the titles that could fit'}}}
SYSTEM = """You sort job titles for one job seeker. You get their search (the role words they wrote, and words that rule a title out) and a \
numbered list of job titles, in any language. Answer with the numbers of the titles that could be the kind of job they look for: the same \
work under another name or in another language counts ("Client Advisor" or "Collaborateur Magasin" for a shop seller; "Content Creator - \
Photo" for a photographer), and so does a close neighbour of their work at a similar level. Leave out other kinds of work (software, \
finance, marketing management, legal…), and titles of the work their ruled-out words name (the same word in another sense is no reason). \
A level, when given, is the seniority they want: leave out a title plainly far from it (an internship for a lead); a rank that only sounds like \
a level ("Senior First Officer" is a pilot rank) is judged by its work. A title with their role word can still be another job ("Pilote / Product \
Owner" is no pilot). When unsure, include it: a later step scores each job."""


def _key(search):
    words = {'roles': sorted(str(w) for w in search.get('role_keywords') or []), 'out': sorted(str(w) for w in search.get('title_exclude_keywords') or [])}
    return hashlib.sha1(json.dumps(words, ensure_ascii=False).encode()).hexdigest()[:12]


def _norm(title):
    return ' '.join(str(title or '').lower().split())[:160]


def _load():
    try:
        return json.loads(STORE.read_text())
    except (OSError, ValueError):
        return {}


batch_scope.watch('titles_store', _load)


def known(search):
    """{title: True/False} decided for this search so far (for readers side by side: as it was when they began, src/ai/batch_scope.py)."""
    return batch_scope.view('titles_store', _load).get(_key(search)) or {}


def decide(titles, search, client=None, local=False):
    """Ask about the titles not decided yet for this search (at most MAX_NEW), keep the answers; returns {title: fits} for all known.
    local: these titles are of jobs in the user's own places; the search's first few are sorted whatever the clock says (src/time_budget.py)."""
    from . import engine
    key, decided = _key(search), dict(known(search))
    ask = list(dict.fromkeys(t for t in (_norm(t) for t in titles) if t and t not in decided))[:MAX_NEW]
    from .. import time_budget as budget
    # A batch this refresh can finish, in whole rounds of calls (src/time_budget.py); the rest is asked next time. 18 Oct 2026, persona runs: paced
    # per title (0.5 s at least), a refresh planned "28 of 600 titles" for its 3 minutes, sorted them in one 7 s call and left 572 waiting.
    taken = budget.in_calls('title_rounds', len(ask), BATCH, engine.PARALLEL, noun='title(s)')
    forced = budget.local_titles(len(ask) - taken) if local and taken < len(ask) else 0   # past the clock: local titles only
    ask, sure = ask[:taken + forced], set(ask[:taken + forced])
    if not ask:
        return decided
    client = client or engine.client(action='title_triage')
    from ..notion.search_settings import terms
    from .. import levels   # the level is said as a level: its skip words (src/levels.py) are the no-AI floor, never words the AI must obey
    skips, level = set(terms(levels.title_skips(search.get('level')))), levels.level_of(search.get('level'))
    words = {'role_words': terms(search.get('role_keywords'))[:20], 'words_ruled_out': [w for w in terms(search.get('title_exclude_keywords')) if w not in skips][:20],
             **({'level': level} if level else {})}
    from . import cost
    from ..progress import Ticker
    from concurrent.futures import ThreadPoolExecutor
    batches = [ask[start:start + BATCH] for start in range(0, len(ask), BATCH)]
    # Said before the first answer, then after each batch with the time left (owner, 7 Oct 2026: 6 batches ran ~2 min each with only
    # "Still running · no new output" on screen). Batches run side by side; Claude Code still takes engine.PARALLEL at a time.
    print(f'Titles: asking {providers.who()} about {len(ask)} job title(s) in your places, in {len(batches)} batch(es) of up to {BATCH}', flush=True)
    ticker, lock, sorted_ = Ticker('Sorting job titles with AI', len(ask), every=0), threading.Lock(), [0]

    late = [0]   # titles of batches not started: the search's time was up (src/time_budget.py); the next search asks about them

    def one(batch):
        if budget.over('titles', key=batch[0]) and not (local and (sure.issuperset(batch) and forced or budget.local_titles(len(batch)) >= len(batch))):
            with lock:
                late[0] += len(batch)
            return
        listed = '\n'.join(f'{n}. {title}' for n, title in enumerate(batch, 1))
        response = client.messages.create(model=MODEL, max_tokens=1500, system=[{'type': 'text', 'text': SYSTEM}],
                                          messages=[{'role': 'user', 'content': f'The search (JSON): {json.dumps(words, ensure_ascii=False)}\nThe titles:\n{listed}'}],
                                          output_config=engine.structured(SCHEMA, MODEL, 'low'))
        cost.side(MODEL, response.usage)
        fit = {int(n) for n in json.loads(next(b.text for b in response.content if b.type == 'text')).get('fit') or [] if str(n).isdigit()}
        with lock:
            for n, title in enumerate(batch, 1):
                decided[title] = n in fit
            sorted_[0] += len(batch)
            ticker.tick(sorted_[0])
    began = time.monotonic()
    with ThreadPoolExecutor(max_workers=max(1, min(len(batches), engine.PARALLEL))) as pool:
        list(pool.map(one, batches))
    budget.record('title_rounds', time.monotonic() - began, -(-sorted_[0] // (BATCH * max(1, engine.PARALLEL))))
    with LOCK:
        data = _load()
        data[key] = {**(data.get(key) or {}), **decided}
        for old in list(data)[:-3]:   # the last few searches only
            data.pop(old)
        STORE.parent.mkdir(parents=True, exist_ok=True)
        STORE.write_text(json.dumps(data, ensure_ascii=False))
    if batch_scope.active():   # this reader's own answers, for its next call
        batch_scope.view('titles_store', _load).setdefault(key, {}).update(decided)
    asked = [t for t in ask if t in decided]
    if late[0]:
        print(budget.left_line('titles', late[0], 'title(s)'), flush=True)
    print(f'Titles: {providers.who()} sorted {len(asked)} new title(s) in your places; {sum(1 for t in asked if decided[t])} could fit your search')
    return decided
