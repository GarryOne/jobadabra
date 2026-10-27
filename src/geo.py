"""Places and job locations as country + coordinates, so matching is by distance, not by name words (owner, 18 Oct 2026: a "Franken" search read
jobs.ch for 355 s because the region's "Baden-Württemberg" matched the Swiss town Baden). A small model places each distinct string ONCE
(city/area/country/remote, ISO country code, lat/lon, radius); the code validates the answer, keeps it in data/geo.json and decides by country
and haversine distance. Fixed words in, validated numbers out: a bad answer is dropped, never kept as sure. Only place strings are sent (no CV, no
profile, no employer), so the cache holds no personal data and can be shared as product data later.
Tests: tests/test_geo.py. Read by: src/ai/place_triage.py (fast path before asking the model where a job is).
"""
import json
import math
import re
import threading
from pathlib import Path

from .ai import batch_scope
from .ai.providers import slots
from .paths import DATA

BATCH = 40
KINDS = ('city', 'area', 'country', 'remote', 'unknown')
MAX_RADIUS = {'city': 60, 'area': 400}
STORE = DATA / 'geo.json'
LOCK = threading.Lock()
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['places'], 'properties': {'places': {'type': 'array', 'items': {
    'type': 'object', 'additionalProperties': False, 'required': ['n', 'kind', 'cc', 'lat', 'lon', 'r_km'],
    'properties': {'n': {'type': 'integer'},
                   'kind': {'type': 'string', 'enum': list(KINDS), 'description': 'city: a town or city; area: a region, state or district; country; remote; unknown'},
                   'cc': {'type': 'string', 'description': 'ISO 3166-1 alpha-2 country code of the place, "" for remote or unknown'},
                   'lat': {'type': 'number', 'description': 'Latitude of its centre, 0 for country, remote or unknown'},
                   'lon': {'type': 'number', 'description': 'Longitude of its centre, 0 for country, remote or unknown'},
                   'r_km': {'type': 'integer', 'description': 'Radius in km that covers the city and its commuter suburbs, or the area; 0 for country, remote or unknown'}}}}}}
SYSTEM = """You place strings on the map. Each is a place a job seeker types ("Franken", "Zurigo", "Nuremberg") or a job location as a posting writes it, \
in any language or format ("1211 Genf, Genf, CH", "Biel/Bienne", "Klagenfurt, AT, 9020", "Remote - EMEA", "Fnac Lausanne (Manor) (1)"). For each, answer:
- kind: "city" (one town or city, or an address in one), "area" (a region, state, canton or district that is not a whole country), "country", \
"remote" (work from anywhere or a region, no place), or "unknown" (not a place you can place).
- cc: its ISO 3166-1 alpha-2 country code. When a name exists in several countries ("Baden", "Altdorf"), choose the country the other words of the string \
point to; with none, the larger and more likely job market.
- lat, lon: the centre. r_km: for a city the radius that covers its commuter suburbs (a separate town 15 km or more away is not part of it); \
for an area the radius that covers it. For a country, remote or unknown: 0, 0, 0.
Never invent a place: when unsure, answer "unknown"."""


def norm(text):
    return ' '.join(str(text or '').lower().split())[:120]


def _read():
    try:
        data = json.loads(STORE.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


batch_scope.watch('geo', _read)


def load():
    """The kept answers (for readers side by side: as they were when the reader began, src/ai/batch_scope.py)."""
    return batch_scope.view('geo', _read)


def valid(item):
    """The cleaned entry for the model's answer, or None when it breaks the fixed shape (a country code that is not two letters, a
    coordinate off the globe, a radius over the cap for its kind)."""
    kind = item.get('kind')
    if kind not in KINDS:
        return None
    if kind in ('remote', 'unknown'):
        return {'kind': kind}
    cc = str(item.get('cc') or '').upper()
    if not re.fullmatch(r'[A-Z]{2}', cc) or cc in ('XX', 'ZZ'):
        return None
    if kind == 'country':
        return {'kind': kind, 'cc': cc}
    try:
        lat, lon, radius = float(item['lat']), float(item['lon']), int(item['r_km'])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0) or not 1 <= radius <= MAX_RADIUS[kind]:
        return None
    return {'kind': kind, 'cc': cc, 'lat': round(lat, 3), 'lon': round(lon, 3), 'r': radius}


TOPIC = 'job-location-geo'   # config/meanings_schema.json: the shared form of a posting location's answer
CODED = re.compile(r'(city|area):([A-Z]{2}):(-?\d{1,2}\.\d):(-?\d{1,3}\.\d):(\d{1,3})')


def encode(entry):
    """The fixed-format answer the site may learn: lat/lon to 0.1 degree and the radius to 5 km, so installs that placed a string alike agree."""
    if entry['kind'] in ('remote', 'unknown'):
        return entry['kind']
    if entry['kind'] == 'country':
        return f"country:{entry['cc']}"
    return f"{entry['kind']}:{entry['cc']}:{entry['lat']:.1f}:{entry['lon']:.1f}:{max(5, 5 * round(entry['r'] / 5))}"


BOXES = json.loads((Path(__file__).resolve().parent.parent / 'config' / 'country_boxes.json').read_text())   # cc -> name + box; site/src/meanings.js checks the same table


def country_name(cc):
    """The English name of a country code in config/country_boxes.json, None when the table lacks it."""
    return (BOXES.get(cc) or {}).get('name')


def inside(entry):
    """False when the entry's point lies outside its country's box (a pack answer someone got wrong); True when inside or the table lacks the country."""
    box = (BOXES.get(entry.get('cc')) or {}).get('box')
    return not box or 'lat' not in entry or (box[0] <= entry['lat'] <= box[2] and box[1] <= entry['lon'] <= box[3])


def decode(answer):
    """The entry for a fixed-format answer from the pack, validated like the model's own answer; None for anything else."""
    text = str(answer or '')
    if text in ('remote', 'unknown'):
        return {'kind': text}
    if re.fullmatch(r'country:[A-Z]{2}', text):
        return valid({'kind': 'country', 'cc': text[8:]})
    found = CODED.fullmatch(text)
    if not found:
        return None
    kind, cc, lat, lon, radius = found.groups()
    entry = valid({'kind': kind, 'cc': cc, 'lat': lat, 'lon': lon, 'r_km': radius})
    return entry if entry and inside(entry) else None


def _from_pack(keys):
    """What the shared pack (src/ai/meanings_pack.py: rows the site learned from 3+ installs) says about these strings."""
    from .ai import meanings_pack
    out = {}
    for key in keys:
        entry = decode(meanings_pack.first(TOPIC, key))
        if entry:
            out[key] = entry
    return out


def resolve(strings, client=None, ask=True, share=False):
    """{normalized string: entry} for the strings the cache, the shared pack or the model knows. A string is asked once, ever (an 'unknown'
    answer is kept too). share=True only for job locations (a posting's public words): the model's answers are queued for the site; a user's
    own place words are never shared."""
    keys = list(dict.fromkeys(k for k in (norm(s) for s in strings) if k))
    data = load()
    todo = [k for k in keys if k not in data]
    found = _from_pack(todo) if todo else {}
    todo = [k for k in todo if k not in found]
    if todo and ask:
        if client is None:
            from .ai import engine
            client = engine.client(action='place_triage') if engine.ready() else None
        if client is not None:
            asked = _ask(client, todo)
            found.update(asked)
            if share:
                from .ai import meanings_pack
                for key, entry in asked.items():
                    meanings_pack.queue(TOPIC, key, encode(entry))
    if found:
        data.update(found)
        with LOCK:
            STORE.parent.mkdir(parents=True, exist_ok=True)
            STORE.write_text(json.dumps({**_read(), **found}, ensure_ascii=False, sort_keys=True))
    return {k: data[k] for k in keys if k in data}


def _ask(client, keys):
    """The model's validated answers for these strings, in batches run side by side (1,300 locations a first search, 18 Oct 2026)."""
    from concurrent.futures import ThreadPoolExecutor
    from .ai import cost, engine
    from .ai.models import SMALL_MODEL

    def one(batch):
        listed = '\n'.join(f'{n}. {key}' for n, key in enumerate(batch, 1))
        response = client.messages.create(model=SMALL_MODEL, max_tokens=4000, system=[{'type': 'text', 'text': SYSTEM}],
                                          messages=[{'role': 'user', 'content': f'Strings:\n{listed}'}],
                                          output_config=engine.structured(SCHEMA, SMALL_MODEL, 'low'))
        cost.side(SMALL_MODEL, response.usage)
        answer = json.loads(next(b.text for b in response.content if b.type == 'text'))
        found = {}
        for item in answer.get('places') or []:
            n = item.get('n')
            entry = valid(item) if isinstance(n, int) and 1 <= n <= len(batch) else None
            if entry:
                found[batch[n - 1]] = entry
        return found

    batches = [keys[start:start + BATCH] for start in range(0, len(keys), BATCH)]
    out = {}
    with ThreadPoolExecutor(max_workers=max(1, min(len(batches), engine.PARALLEL))) as pool:
        for found in pool.map(slots.carry(one), batches):
            out.update(found)
    return out


def km(a, b):
    """Great-circle distance in km between two entries with lat/lon."""
    p1, p2 = math.radians(a['lat']), math.radians(b['lat'])
    d = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b['lon'] - a['lon']) / 2) ** 2
    return 12742 * math.asin(math.sqrt(d))


def within(place, location):
    """True when the job location is inside the user's place, False when it is a different place, None when the map cannot say (remote, unknown,
    or a location that names only a country for a place smaller than one): the caller then asks the model or reads the posting, as before."""
    if not place or not location or place.get('kind') in ('remote', 'unknown') or location.get('kind') in ('remote', 'unknown'):
        return None
    if place['cc'] != location['cc']:
        return False
    if place['kind'] == 'country':
        return True
    if location['kind'] == 'country':
        return None
    return km(place, location) <= place['r']


def verdicts(locations, words, client=None, ask=True):
    """{normalized location: 'best' | 'in' | 'out'} for the locations the map can decide against these place words (place_triage.places_words);
    a location it cannot place, or that is remote or only a country for a smaller place, is left out for the model. With work rights given, only
    'out' is decided here: a visa need comes with the model's country answer."""
    groups = (('best', words.get('best_places') or []), ('in', words.get('anywhere_in') or []), ('in', words.get('cities_abroad') or []))
    found = {**resolve([w for _, ws in groups for w in ws], client, ask), **resolve(locations, client, ask, share=True)}
    places = [(answer, found.get(norm(w))) for answer, ws in groups for w in ws]
    if not places or any(entry is None for _, entry in places):
        return {}   # a place the map cannot place: the model decides, as before
    out = {}
    for location in dict.fromkeys(norm(loc) for loc in locations):
        entry = found.get(location)
        results = [(answer, within(place, entry)) for answer, place in places] if entry else []
        if not results or any(r is None for _, r in results):
            continue
        hit = next((answer for answer, r in results if r and answer == 'best'), None) or next((answer for answer, r in results if r), None)
        if hit and not words.get('work_rights'):
            out[location] = hit
        elif not hit:
            out[location] = 'out'
    return out


def cannot_hold(location, words):
    """True when this location is only a country (kept map answer, no model call) and none of the user's places lies in that country: a job there
    can never be in their places, so it is not "unclear" (owner, 24 Oct 2026: Canada, US, Poland listed as "Place unclear" for a Moldova search).
    False when the map lacks the location or any of the places, or when the user accepts remote jobs (their setting: a remote job in a country
    may be open to them, so it stays until its posting is read, as before): the model or the posting decides then."""
    if words.get('remote_jobs') != 'no':
        return False
    data = load()
    entry = data.get(norm(location))
    places = [w for key in ('best_places', 'anywhere_in', 'cities_abroad') for w in words.get(key) or []]
    if not entry or entry.get('kind') != 'country' or not places:
        return False
    codes = [(data.get(norm(w)) or {}).get('cc') for w in places]
    return all(codes) and entry['cc'] not in codes
