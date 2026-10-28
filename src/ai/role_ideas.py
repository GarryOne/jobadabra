"""Roles suggested for you (owner, 7 Oct 2026: "suggest potential roles"): the "too narrow" box's chips were words common in the market's
titles ("social media", "graphic designer"), which did not fit the owner. Here Claude reads the Profile and the search's role words and
proposes up to MAX_IDEAS neighbouring roles this person could do, each with the word to search for (in the language jobs in their places use);
each is counted in the titles of their places that the role words miss (src/coverage.py missed_titles). At most once a day, kept in
data/role_ideas.json; ideas the person set aside (data/role_ideas_aside.json) are never proposed or shown again.

What Claude sees: the Profile text, the role words, places and words ruled out; never the jobs or employers.
"""
import hashlib
import json
from datetime import datetime, timezone

from ..paths import DATA, keyword_regex
from .models import MAIN_MODEL, SMALL_MODEL
from . import providers
from .providers.contract import detail, reason

MODEL = MAIN_MODEL
MAX_IDEAS = 8
STORE = DATA / 'role_ideas.json'
ASIDE = DATA / 'role_ideas_aside.json'
ASIDE_KEPT = 60
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['ideas'],
          'properties': {'ideas': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['role', 'word', 'why'],
                                                              'properties': {'role': {'type': 'string', 'description': 'The role, a few words'},
                                                                             'word': {'type': 'string', 'description': 'The word or short phrase a job title for it contains, in the language jobs in their places use'},
                                                                             'why': {'type': 'string', 'description': 'One short reason from their profile'}}}}}}
SYSTEM = """You suggest roles to a job seeker that they could do but do not search for yet. You get their profile (CV and preferences), the \
role words they search with, their places, the words they rule out, and roles they already set aside. Suggest up to 8 neighbouring roles \
their experience fits at a similar level: the same skills used in another job (a photographer: studio or photo lab assistant, product \
photographer, image retoucher; a shop seller: cashier, visual merchandiser, order picker). For each, give the word or short phrase a job \
title for it would contain, in the language most jobs in their places are written in (French in Geneva, German in Zurich), and one short \
reason from their profile. Never a role they already search for, rule out, or set aside; nothing far above or below their level."""


def _key(search):
    words = {'roles': sorted(str(w) for w in search.get('role_keywords') or [])}
    return hashlib.sha1(json.dumps(words, ensure_ascii=False).encode()).hexdigest()[:12]


def _load():
    try:
        return json.loads(STORE.read_text())
    except (OSError, ValueError):
        return {}


def aside_words():
    """The words set aside with Not true, lowercased, newest last."""
    try:
        words = json.loads(ASIDE.read_text())
    except (OSError, ValueError):
        return []
    return [str(w).lower() for w in words if str(w).strip()] if isinstance(words, list) else []


def put_aside(words):
    """Sets these words aside too (the newest ASIDE_KEPT are kept). Why (#2350, Gitar): the list lived in one window's browser storage, so
    Focus, which reads the kept ideas here, offered a role again after a Not true."""
    new = [str(w).lower() for w in words or [] if str(w).strip()]
    if not new:
        return
    have = aside_words()
    merged = [w for w in have if w not in new] + list(dict.fromkeys(new))
    ASIDE.parent.mkdir(parents=True, exist_ok=True)
    temp = ASIDE.with_suffix('.tmp')
    temp.write_text(json.dumps(merged[-ASIDE_KEPT:], ensure_ascii=False))
    temp.replace(ASIDE)


COUNT_MODEL = SMALL_MODEL
COUNT_TITLES = 600
COUNT_SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['roles'], 'properties': {'roles': {'type': 'array', 'items': {
    'type': 'object', 'additionalProperties': False, 'required': ['n', 'titles'],
    'properties': {'n': {'type': 'integer'}, 'titles': {'type': 'array', 'items': {'type': 'integer'}, 'description': 'Numbers of the job titles that are this kind of job'}}}}}}
COUNT_SYSTEM = """You get numbered roles and numbered job titles, in any language. For each role, answer the numbers of the titles that are \
that kind of job (a "cashier" role: "Vendeuse Caisses", "Caissière 50%"; not a store manager). A title can fit several roles. Leave out \
titles that only share a word."""


def ai_counts(ideas, titles, client=None):
    """{word: how many of these titles are that role's kind of job}, by Claude (7 Oct 2026: counting the exact word showed 0 for every
    suggestion: "caissier" is not in "Vendeuse Caisses"). One Haiku call; Claude sees the roles and job titles only."""
    from . import cost, engine
    titles = sorted(set(titles))[:COUNT_TITLES]
    if not ideas or not titles:
        return {}
    client = client or engine.client(action='role_counts')
    roles = '\n'.join(f"{n}. {idea['role']} (title word: {idea['word']})" for n, idea in enumerate(ideas, 1))
    listed = '\n'.join(f'{n}. {title}' for n, title in enumerate(titles, 1))
    response = client.messages.create(model=COUNT_MODEL, max_tokens=4000, system=[{'type': 'text', 'text': COUNT_SYSTEM}],
                                      messages=[{'role': 'user', 'content': f'Roles:\n{roles}\n\nJob titles:\n{listed}'}],
                                      output_config=engine.structured(COUNT_SCHEMA, COUNT_MODEL, 'low'))
    cost.side(COUNT_MODEL, response.usage)
    answer = json.loads(next(b.text for b in response.content if b.type == 'text'))
    counts = {}
    for item in answer.get('roles') or []:
        n = item.get('n')
        if isinstance(n, int) and 1 <= n <= len(ideas):
            counts[ideas[n - 1]['word']] = len({t for t in item.get('titles') or [] if isinstance(t, int) and 1 <= t <= len(titles)})
    return counts


def count(word, titles):
    """Titles (of the places, missed by the role words) that contain this word."""
    try:
        pattern = keyword_regex([word])
    except Exception:  # noqa: BLE001 — a word that is no pattern counts nothing
        return 0
    return sum(1 for title in titles if pattern.search(title))


def ideas(profile, search, titles, set_aside=(), client=None, today=None):
    """[{role, word, why, count}] for this search, from today's answer when there is one; asked of Claude at most once a day."""
    today = today or datetime.now(timezone.utc).date().isoformat()
    key, data = _key(search), _load()
    aside = {str(w).lower() for w in set_aside} | set(aside_words())
    kept = data.get(key) or {}
    roles = sorted({str(w).lower() for w in search.get('role_keywords') or []})
    # Roles only added since today's answer (one of these ideas taken, or typed on Strategy): today's ideas still hold, minus the added ones.
    # 7 Oct 2026: every "Add role" changed the key and asked Claude again, 10 paid calls in an afternoon and a new list each time.
    earlier = next((entry for entry in data.values() if entry.get('day') == today and entry.get('roles') is not None
                    and set(entry['roles']) <= set(roles)), None)
    if kept.get('day') != today and earlier:
        kept = earlier
    if kept.get('day') != today:
        if not (profile or '').strip():
            return []
        from . import engine, cost
        from ..notion.search_settings import terms
        places = search.get('locations') or {}
        ask = {'profile': profile[:6000], 'role_words': terms(search.get('role_keywords'))[:30],
               'places': terms((places.get('top_tier') or []) + (places.get('country_wide') or []))[:10],
               'ruled_out': terms(search.get('title_exclude_keywords'))[:20], 'set_aside': sorted(aside)[:40]}
        client = client or engine.client(action='role_ideas')
        response = client.messages.create(model=MODEL, max_tokens=1200, system=[{'type': 'text', 'text': SYSTEM}],
                                          messages=[{'role': 'user', 'content': 'The job seeker (JSON):\n' + json.dumps(ask, ensure_ascii=False)}],
                                          output_config=engine.structured(SCHEMA, MODEL, 'low'))
        cost.side(MODEL, response.usage)
        answer = json.loads(next(b.text for b in response.content if b.type == 'text'))
        kept = {'day': today, 'roles': roles, 'ideas': [{k: str(i.get(k) or '')[:120] for k in ('role', 'word', 'why')} for i in answer.get('ideas') or []][:MAX_IDEAS]}
        STORE.parent.mkdir(parents=True, exist_ok=True)
        STORE.write_text(json.dumps({key: kept}, ensure_ascii=False))   # this search's ideas only
        print(f"Roles: {providers.who()} suggested {len(kept['ideas'])} role(s) for this search")
    have = {str(w).lower() for w in search.get('role_keywords') or []}
    shown = [i for i in kept.get('ideas') or [] if i.get('word') and i['word'].lower() not in have and i['word'].lower() not in aside]
    # Counted by Claude once for these titles (kept with the day's ideas); the exact word when Claude cannot be asked
    titles_hash = hashlib.sha1(json.dumps(sorted(set(titles)), ensure_ascii=False).encode()).hexdigest()[:12]
    counted = kept.get('counted') or {}
    if counted.get('titles') != titles_hash and shown and titles:
        try:
            counted = {'titles': titles_hash, 'counts': ai_counts(shown, titles, client)}
            data = _load()
            data[key] = {**kept, 'counted': counted}
            STORE.parent.mkdir(parents=True, exist_ok=True)
            STORE.write_text(json.dumps({key: data[key]}, ensure_ascii=False))
        except Exception as error:  # noqa: BLE001 — counted by their word this time
            print(f'Roles: {providers.who()} could not count them ({reason(error)}); counting the title word', flush=True)
            detail('role counts', error)
            counted = {}
    return _counted(shown, counted.get('counts') or {}, titles)


def _counted(shown, counts, titles):
    out = [{**i, 'count': counts[i['word']] if i['word'] in counts else count(i['word'], titles)} for i in shown]
    return sorted(out, key=lambda i: -i['count'])


def search_key(search):
    """Which search an answer belongs to (its role words): Focus keeps a Not now or Not true on role ideas against it (src/suggestions_search.py)."""
    return _key(search)


def kept(search, titles):
    """The ideas kept for this search, as ideas() last counted them, without asking Claude: Focus's Suggestions never wait for an AI (insights
    PR 1b). The answer of a search whose roles only grew since (an idea added) still holds; a word set aside is never shown.
    -> [{role, word, why, count}], most openings first."""
    data = _load()
    have = {str(w).lower() for w in search.get('role_keywords') or []} | set(aside_words())
    found = data.get(_key(search)) or next((entry for entry in data.values() if entry.get('roles') is not None and set(entry['roles']) <= have), {})
    shown = [i for i in found.get('ideas') or [] if i.get('word') and i['word'].lower() not in have]
    return _counted(shown, (found.get('counted') or {}).get('counts') or {}, titles)
