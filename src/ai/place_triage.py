"""Which job locations are in the user's places, decided by AI (owner, 7 Oct 2026: "nothing hard-coded: around the globe there are thousands of
regions, places, cities; use AI to interpret locations"). Word patterns let "Wallisellen" (near Zürich) in as "Wallis" and "Klagenfurt" (Austria)
as "Genf". Now each distinct location a refresh meets is shown to Haiku with the places as the user wrote them (best places, anywhere in, abroad,
remote yes/no); it answers best place, in their places, or out. Each answer is kept per version of the places (data/place_triage.json), so a
location is asked about once; a change of places asks again.

What Haiku sees: location strings from job postings and the user's place words, nothing else (no CV, no profile, no title, no employer). Off
without AI or with JOB_PILOTTO_DISABLE=place_triage, and for a location not decided yet: the place words as patterns, as before (sources/feeds.py).
"""
import hashlib
import json
import threading
import time

from ..paths import DATA
from .models import SMALL_MODEL
from . import batch_scope, providers
from .providers.contract import detail, reason

MODEL = SMALL_MODEL
BATCH = 30   # one line of reasoning per location: 30 a call (7 Oct 2026: 60 at once misfiled Swiss towns)
VERSION = 4   # 4: several places in one location and remote limited to another region are out (#2228 follow-up, 27 Oct 2026); 3: nearest place and distance per location, visa asked apart (7 Oct 2026); a new version asks again
STORE = DATA / 'place_triage.json'
LOCK = threading.Lock()
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['locations'], 'properties': {'locations': {'type': 'array', 'items': {
    'type': 'object', 'additionalProperties': False, 'required': ['n', 'where', 'country', 'nearest', 'km', 'answer'],
    'properties': {'n': {'type': 'integer'},
                   'where': {'type': 'string', 'description': 'The town or area this location is, in English ("" when it names no place)'},
                   'country': {'type': 'string', 'description': 'Its country in English, "" when unknown'},
                   'nearest': {'type': 'string', 'description': 'Which of their places it is nearest to, as they wrote it, or "none"'},
                   'km': {'type': 'integer', 'description': 'Road distance to that place in km, -1 when unknown'},
                   'answer': {'type': 'string', 'enum': ['best', 'inside', 'out']}}}}}}
SYSTEM = """You decide where job postings are, for one job seeker. You get the places they accept, in their own words (their best places, \
places where anywhere is fine, cities abroad, whether remote jobs count), and a numbered list of job locations as postings write them, in any \
language or format ("1211 Genf, Genf, CH", "Biel/Bienne", "Klagenfurt, AT, 9020", "Remote - EMEA", "Fnac Lausanne (Manor) (1)"). For each \
location, first say where it is (town or area, country), which of their places it is nearest to and how far by road in km; then answer:
- "best": in one of their best places, or a suburb that is really part of that city's area (it touches the city; a separate town 15 km or \
more away is not part of it).
- "inside": not a best place, but inside a place where anywhere is fine for them (a region or country they listed there), or one of their \
cities abroad. When they listed no such place, nothing is "inside".
- "out": everything else, including a location naming only a country or an area wider than their places ("Switzerland" for someone who \
wants only Geneva), and remote jobs unless they accept remote work and the posting does not limit it to a region outside their places.
Being in the same country as their places does not make a town "inside". When unsure, answer "out".
A location may list several places ("Vienna; London; Munich", "Remote; New York City - Hybrid; Toronto - Remote; Poland"): it is in their places only when \
one listed place is theirs, or it says remote with no region at all or a region that holds their places. Other cities and remote limits to other \
regions or countries ("Remote (South Africa)", "Ukraine, Remote", "Remote: UK", "Toronto - Remote", "Paris - Full Remote") say where the job is based \
or who may take it: "out" for someone whose places are elsewhere, even when they accept remote work."""
VISA_SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['visa'],
               'properties': {'visa': {'type': 'array', 'items': {'type': 'string'}, 'description': 'The countries, as given, where they need a visa'}}}
VISA_SYSTEM = """You get a job seeker's work rights in their own words (a permit, a citizenship, "EU") and a list of countries. Answer the \
countries where those work rights do not let them work without a visa or sponsorship. When they gave no work rights, answer an empty list."""


def places_words(search, preferences=None):
    """The places as the user wrote them (readable words, not patterns)."""
    from ..notion.search_settings import terms
    places = search.get('locations') or {}
    remote = [str(v).strip().lower() for v in search.get('remote_jobs') or []]
    return {'best_places': terms(places.get('top_tier'))[:20], 'anywhere_in': terms(places.get('country_wide'))[:20],
            'cities_abroad': terms(places.get('abroad'))[:20], 'remote_jobs': 'no' if 'no' in remote else 'yes',
            'remote_limited_to_regions_they_cannot_work_from': terms(search.get('remote_excluded_regions'))[:20],
            'work_rights': [str(w) for w in (preferences or {}).get('work_rights') or []][:10]}


def _preferences():
    from ..paths import CONFIG
    try:
        return json.loads((CONFIG / 'preferences.json').read_text())
    except (OSError, ValueError):
        return {}


def _key(search):
    words = {**places_words(search, _preferences()), 'version': VERSION}
    return hashlib.sha1(json.dumps(words, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]


def norm(location):
    return ' '.join(str(location or '').lower().split())[:120]


def _load():
    try:
        return json.loads(STORE.read_text())
    except (OSError, ValueError):
        return {}


batch_scope.watch('places_store', _load)


def known(search):
    """{location: 'best' | 'in' | 'out'} decided for these places so far (for readers side by side: as it was when they began, src/ai/batch_scope.py)."""
    return batch_scope.view('places_store', _load).get(_key(search)) or {}


def _keep(key, decided):
    with LOCK:
        data = _load()
        data[key] = {**(data.get(key) or {}), **decided}
        for old in list(data)[:-3]:   # the last few versions of the places only
            data.pop(old)
        STORE.parent.mkdir(parents=True, exist_ok=True)
        STORE.write_text(json.dumps(data, ensure_ascii=False))
    if batch_scope.active():   # this reader's own answers, for its next call
        batch_scope.view('places_store', _load).setdefault(key, {}).update(decided)


def decide(locations, search, client=None):
    """Ask about the locations not decided yet for these places (a batch this refresh can finish), keep the answers; returns all known."""
    from . import cost, engine
    from .. import time_budget as budget
    key, decided = _key(search), dict(known(search))
    ask = list(dict.fromkeys(n for n in (norm(loc) for loc in locations) if n and n not in decided))
    ask = ask[:budget.in_calls('place_rounds', len(ask), BATCH, engine.PARALLEL)]
    if not ask:
        return decided
    words = places_words(search, _preferences())
    from .. import geo
    try:   # by country + distance first; a test's client is not asked for the map
        mapped = geo.verdicts(ask, words, client, ask=client is None)
    except Exception as error:  # noqa: BLE001 — the model decides these locations, as before
        print(f'Warning: the map of places was not used ({reason(error)}); the AI placed these locations instead', flush=True)
        detail('map of places', error)
        mapped = {}
    decided.update(mapped)
    ask = [n for n in ask if n not in mapped]
    if not ask:
        _keep(key, decided)
        return decided
    client = client or engine.client(action='place_triage')
    batches = [ask[start:start + BATCH] for start in range(0, len(ask), BATCH)]
    print(f'Places: asking {providers.who()} where {len(ask)} job location(s) are, in {len(batches)} batch(es) of up to {BATCH}', flush=True)
    from concurrent.futures import ThreadPoolExecutor
    from ..progress import Ticker
    ticker, lock, sorted_ = Ticker('Placing job locations with AI', len(ask), every=0), threading.Lock(), [0]

    places = {k: v for k, v in words.items() if k != 'work_rights'}   # the place question only (7 Oct 2026: "authorized to work in
    # Switzerland" in the same call made Swiss towns "inside" a Geneva search)
    countries = {}

    def one(batch):
        if budget.over('place_rounds', key=batch[0]):
            return
        listed = '\n'.join(f'{n}. {location}' for n, location in enumerate(batch, 1))
        response = client.messages.create(model=MODEL, max_tokens=4000, system=[{'type': 'text', 'text': SYSTEM}],
                                          messages=[{'role': 'user', 'content': f'Their places (JSON): {json.dumps(places, ensure_ascii=False)}\nThe job locations:\n{listed}'}],
                                          output_config=engine.structured(SCHEMA, MODEL, 'low'))
        cost.side(MODEL, response.usage)
        answer = json.loads(next(b.text for b in response.content if b.type == 'text'))
        with lock:
            for item in answer.get('locations') or []:
                n = item.get('n')
                if not isinstance(n, int) or not 1 <= n <= len(batch):
                    continue
                place = {'best': 'best', 'inside': 'in'}.get(item.get('answer'), 'out')
                decided[batch[n - 1]] = place
                if place != 'out' and item.get('country'):
                    countries[batch[n - 1]] = str(item['country']).strip()[:40]
            sorted_[0] += len(batch)
            ticker.tick(sorted_[0])
    began = time.monotonic()
    with ThreadPoolExecutor(max_workers=max(1, min(len(batches), engine.PARALLEL))) as pool:
        list(pool.map(one, batches))
    rights = words.get('work_rights') or []
    if countries and rights:
        try:
            response = client.messages.create(model=MODEL, max_tokens=1500, system=[{'type': 'text', 'text': VISA_SYSTEM}],
                                              messages=[{'role': 'user', 'content': f'Their work rights: {json.dumps(rights, ensure_ascii=False)}\n'
                                                                                    f'Countries: {json.dumps(sorted(set(countries.values())), ensure_ascii=False)}'}],
                                              output_config=engine.structured(VISA_SCHEMA, MODEL, 'low'))
            cost.side(MODEL, response.usage)
            needs = {str(c).strip().lower() for c in json.loads(next(b.text for b in response.content if b.type == 'text')).get('visa') or []}
            for location, country in countries.items():
                if country.lower() in needs:
                    decided[location] += ':visa'
        except Exception as error:  # noqa: BLE001 — placed without the visa answer; asked with the next new places
            print(f'Warning: visa needs were not checked ({reason(error)}); they are asked again with the next new places', flush=True)
            detail('visa needs', error)
    budget.record('place_rounds', time.monotonic() - began, -(-sorted_[0] // (BATCH * max(1, engine.PARALLEL))))
    _keep(key, decided)
    asked = [loc for loc in ask if loc in decided]
    print(f'Places: {providers.who()} placed {len(asked)} location(s); {sum(1 for loc in asked if decided[loc] != "out")} are in your places', flush=True)
    return decided


# A location that names no town of its own ("Switzerland", "Romandie", "Several locations", nothing) is "vague": the posting's own words say
# where the job is (owner, 7 Oct 2026: "universal, on any employer, feed, website or portal"; Manor's Geneva jobs said "Switzerland" in their
# address field and "Geneva | Part-time 45%" in their text). Asked as its own question, about the locations already answered "out", so the
# place question above stays as it is (a third answer in it made Haiku misfile Swiss towns, 7 Oct 2026). Stored on the location's answer:
# 'out:vague' (its postings are read) or 'out:clear' (a real place outside); plain 'out' = not asked yet.
VAGUE_BATCH = 60
VAGUE_SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['vague'], 'properties': {'vague': {
    'type': 'array', 'items': {'type': 'integer'}, 'description': 'Numbers of the locations that name no town or city of their own'}}}
VAGUE_SYSTEM = """You get a numbered list of job locations as postings write them. Answer the numbers of the ones that name no town or city \
of their own: only a country ("Switzerland", "CH"), a large region or area ("Romandie", "Canton of Vaud", "Europe"), several places at once \
without one town ("Several locations"), or nothing usable. A location naming a town, a city district or an address is not one of them, \
even with its country ("Zug, Switzerland"); neither is a plain "Remote". You also get the job seeker's places: a country or region that \
cannot contain any of their places ("USA - Remote", "Canada" or "Poland" for someone who picked only a town in Moldova) is never one of them, \
however little else it says: it is a real place outside."""


def cannot_hold_places(location, search):
    """True for a country-only location in a country none of the user's places is in (the map's answers, no model call): never "vague"."""
    from .. import geo
    return geo.cannot_hold(location, places_words(search))


def excluded_remote(location, search):
    """True for a location that says remote and names a region the user cannot work from (their own setting, remote_excluded_regions):
    a floor under the AI's answers, so a weak or missing one never keeps "USA - Remote" for a user who skipped it (21 Oct 2026)."""
    from ..paths import place_regex
    from ..sources.feeds import _REMOTE_SYNONYMS
    import re
    regions = [r for r in search.get('remote_excluded_regions') or [] if str(r).strip()]
    return bool(regions and re.search(_REMOTE_SYNONYMS, location or '', re.I) and place_regex(regions).search(location or ''))


def vague(locations, search, client=None):
    """Of these locations answered "out", ask which name no town of their own (a batch this refresh can finish); returns all known."""
    from . import cost, engine
    from .. import time_budget as budget
    from .. import geo
    key, decided = _key(search), dict(known(search))
    ask = list(dict.fromkeys(n for n in (norm(loc) for loc in locations) if decided.get(n) == 'out'))
    words = places_words(search)
    floor = [n for n in ask if excluded_remote(n, search) or geo.cannot_hold(n, words)]   # a real place outside, whatever the AI would say
    decided.update({n: 'out:clear' for n in floor})
    ask = [n for n in ask if n not in floor]
    if floor and not ask:
        _save(key, decided)
    ask = ask[:budget.in_calls('place_vague', len(ask), VAGUE_BATCH, engine.PARALLEL)]
    if not ask:
        return decided
    client = client or engine.client(action='place_vague')
    places = {k: v for k, v in places_words(search).items() if k in ('best_places', 'anywhere_in', 'cities_abroad')}
    batches = [ask[start:start + VAGUE_BATCH] for start in range(0, len(ask), VAGUE_BATCH)]
    lock, done = threading.Lock(), [0]

    def one(batch):
        if budget.over('place_vague', key=batch[0]):
            return
        listed = '\n'.join(f'{n}. {location}' for n, location in enumerate(batch, 1))
        response = client.messages.create(model=MODEL, max_tokens=1500, system=[{'type': 'text', 'text': VAGUE_SYSTEM}],
                                          messages=[{'role': 'user', 'content': f'Their places (JSON): {json.dumps(places, ensure_ascii=False)}\nThe job locations:\n{listed}'}],
                                          output_config=engine.structured(VAGUE_SCHEMA, MODEL, 'low'))
        cost.side(MODEL, response.usage)
        numbers = {int(n) for n in json.loads(next(b.text for b in response.content if b.type == 'text')).get('vague') or [] if str(n).isdigit()}
        with lock:
            for n, location in enumerate(batch, 1):
                decided[location] = 'out:vague' if n in numbers else 'out:clear'
            done[0] += len(batch)
    began = time.monotonic()
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=max(1, min(len(batches), engine.PARALLEL))) as pool:
        list(pool.map(one, batches))
    budget.record('place_vague', time.monotonic() - began, -(-done[0] // (VAGUE_BATCH * max(1, engine.PARALLEL))))
    _save(key, decided)
    found = [loc for loc in ask if decided.get(loc) == 'out:vague']
    if found:
        print(f'Places: {len(found)} location(s) name no town of their own (e.g. {found[0]}); their postings say where the job is', flush=True)
    return decided


def _save(key, decided):
    _keep(key, decided)


READ_BATCH = 10   # postings: title, location and their first words
READ_STORE = DATA / 'place_reading.json'
READ_SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['jobs'], 'properties': {'jobs': {'type': 'array', 'items': {
    'type': 'object', 'additionalProperties': False, 'required': ['n', 'where', 'nearest', 'km', 'answer'],
    'properties': {'n': {'type': 'integer'},
                   'where': {'type': 'string', 'description': 'Where the job is, from the posting, in English ("" when it does not say)'},
                   'nearest': {'type': 'string', 'description': 'Which of their places it is nearest to, as they wrote it, or "none"'},
                   'km': {'type': 'integer', 'description': 'Road distance to that place in km, -1 when unknown'},
                   'answer': {'type': 'string', 'enum': ['best', 'inside', 'out', 'unclear']}}}}}}
READ_SYSTEM = """You decide where jobs are, for one job seeker, from the postings themselves: their location field named no town, only a \
country or a wide area. You get the places they accept, in their own words, and numbered postings (title, location field, the start of the \
text). Find where the job is from the text: a store or site named, "at the Geneva site", an address, "Geneva | Part-time". A company's \
headquarters is not where the job is. For each posting say where it is, which of their places it is nearest to and how far by road in km; \
then answer "best" (in one of their best places, or a suburb really part of that city's area: it touches the city; a separate town 15 km or \
more away is not), "inside" (inside a place where anywhere is fine for them, or one of their cities abroad; when they listed none, nothing \
is "inside"), "out" (elsewhere), or "unclear" (the text does not say where). Being in the same country does not make a job "inside"."""


def _text_hash(job):
    return hashlib.sha1(f"{job.get('title') or ''}\n{job.get('location') or ''}\n{job.get('description') or ''}".encode()).hexdigest()[:12]


def _load_read():
    try:
        return json.loads(READ_STORE.read_text())
    except (OSError, ValueError):
        return {}


def read_known(search):
    """{job url: {'hash', 'place', 'where'}} read for these places so far; place is 'best', 'in', 'out' or 'unclear'."""
    return _load_read().get(_key(search)) or {}


def read_verdict(job, known):
    """The answer for this job from its own words, or None when it has not been read (or its text changed since)."""
    entry = known.get(job.get('url') or '')
    return entry['place'] if entry and entry.get('hash') == _text_hash(job) else None


def read(jobs, search, client=None):
    """Read the postings whose location names no town (a batch this refresh can finish) and keep where each is; returns all known."""
    from . import cost, engine
    from .. import time_budget as budget
    key, found = _key(search), dict(read_known(search))
    todo = [job for job in jobs if job.get('url') and job.get('description') and read_verdict(job, found) is None]
    todo = list({job['url']: job for job in todo}.values())
    todo = todo[:budget.in_calls('place_reading', len(todo), READ_BATCH, engine.PARALLEL, noun='job(s) to read for their place')]
    if not todo:
        return found
    client = client or engine.client(action='place_reading')
    places = {k: v for k, v in places_words(search, _preferences()).items() if k != 'work_rights'}
    batches = [todo[start:start + READ_BATCH] for start in range(0, len(todo), READ_BATCH)]
    print(f'Places: reading {len(todo)} posting(s) whose location names no town, to find where each job is', flush=True)
    lock, done = threading.Lock(), [0]

    def one(batch):
        if budget.over('place_reading', key=batch[0].get('url') or batch[0].get('title')):
            return
        listed = '\n\n'.join(f"{n}. Title: {job['title']}\nLocation field: {job.get('location') or '(none)'}\nText: {' '.join(job['description'].split())[:1200]}"
                              for n, job in enumerate(batch, 1))
        response = client.messages.create(model=MODEL, max_tokens=3000, system=[{'type': 'text', 'text': READ_SYSTEM}],
                                          messages=[{'role': 'user', 'content': f'Their places (JSON): {json.dumps(places, ensure_ascii=False)}\nThe postings:\n{listed}'}],
                                          output_config=engine.structured(READ_SCHEMA, MODEL, 'low'))
        cost.side(MODEL, response.usage)
        answer = json.loads(next(b.text for b in response.content if b.type == 'text'))
        with lock:
            for item in answer.get('jobs') or []:
                n = item.get('n')
                if not isinstance(n, int) or not 1 <= n <= len(batch):
                    continue
                place = {'best': 'best', 'inside': 'in', 'out': 'out'}.get(item.get('answer'), 'unclear')
                found[batch[n - 1]['url']] = {'hash': _text_hash(batch[n - 1]), 'place': place, 'where': str(item.get('where') or '')[:80]}
            done[0] += len(batch)
    began = time.monotonic()
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=max(1, min(len(batches), engine.PARALLEL))) as pool:
        list(pool.map(one, batches))
    budget.record('place_reading', time.monotonic() - began, -(-done[0] // (READ_BATCH * max(1, engine.PARALLEL))))
    with LOCK:
        data = _load_read()
        data[key] = {**(data.get(key) or {}), **found}
        for old in list(data)[:-3]:
            data.pop(old)
        READ_STORE.parent.mkdir(parents=True, exist_ok=True)
        READ_STORE.write_text(json.dumps(data, ensure_ascii=False))
    now = [job for job in todo if read_verdict(job, found) is not None]
    print(f'Places: read {len(now)} posting(s); {sum(1 for job in now if read_verdict(job, found) in ("best", "in"))} are in your places', flush=True)
    return found
