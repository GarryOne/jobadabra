"""The meanings pack on this computer: wording -> fixed answer, per topic, before any AI is asked (approved by the owner, 8 Oct 2026: the
learned knowledge lives in Cloudflare and comes through the existing alias pack; a Swiss or English user never gets a worse answer).

Two layers, both checked against config/meanings_schema.json (a topic and an answer the code knows, a pattern that compiles):
- the seed (config/meanings_seed.json, tools/meanings_seed.py): the keyword lists the code used before, the offline floor;
- the site's rows (data/meanings.json, written by the app from GET /api/packs/aliases, desktop/lib/aliases.js): learned wordings added,
  and seed rows the site switched off ('off') left out.
Lookup order in src/ai/decide.py: this computer's own decisions -> this pack -> AI -> "don't know"; an 'ai_first' topic's patterns answer
only when there is no AI at all. Tests: tests/test_meanings_pack.py."""
import json
import re
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_FILE = ROOT / 'config' / 'meanings_schema.json'
SEED_FILE = ROOT / 'config' / 'meanings_seed.json'
MAX_PATTERN = 2000
MAX_WORDING = 200


@lru_cache(maxsize=1)
def schema():
    return {topic: spec for topic, spec in json.loads(SCHEMA_FILE.read_text()).items() if not topic.startswith('_')}


def _norm(text):
    return re.sub(r'\s+', ' ', str(text or '')).strip().lower()


def _site_file():
    from ..paths import DATA
    return DATA / 'meanings.json'


def valid(row):
    """A row the code may use: a known topic and answer, and a pattern that compiles or a short exact wording."""
    spec = schema().get(row.get('topic'))
    if not spec or not (row.get('answer') in spec['answers'] or (spec.get('answer_pattern') and isinstance(row.get('answer'), str)
                                                                   and re.fullmatch(spec['answer_pattern'], row['answer']))):
        return False   # a fixed answer, or a fixed format (job-location-geo: src/geo.py encode)
    kind, wording = row.get('kind', 'pattern'), row.get('wording', row.get('pattern'))
    if not isinstance(wording, str) or not wording.strip():
        return False
    if kind == 'exact':
        return len(wording) <= MAX_WORDING
    if kind != 'pattern' or len(wording) > MAX_PATTERN:
        return False
    try:
        re.compile(wording, re.I)
    except re.error:
        return False
    return True


def _load(seed_text, site_text):
    seed = [{'topic': r['topic'], 'kind': 'pattern', 'wording': r['pattern'], 'answer': r['answer'], 'ord': i}
            for i, r in enumerate(json.loads(seed_text).get('patterns') or [])]
    site = {}
    try:
        site = json.loads(site_text) if site_text else {}
    except ValueError:
        site = {}
    off = {(o[0], o[1], o[2]) for o in site.get('off') or [] if isinstance(o, list) and len(o) == 3}
    rows = [r for r in seed if (r['topic'], 'pattern', r['wording']) not in off]
    rows += [{**r, 'ord': r.get('ord', 10_000)} for r in site.get('rows') or [] if isinstance(r, dict)]
    patterns, exact = {}, {}
    for row in sorted((r for r in rows if valid(r)), key=lambda r: r.get('ord', 0)):
        if row.get('kind') == 'exact':
            exact.setdefault(row['topic'], {})[_norm(row['wording'])] = row['answer']
        else:
            patterns.setdefault(row['topic'], []).append((re.compile(row['wording'], re.I), row['answer']))
    return patterns, exact


_cache = {}


def tables():
    """(patterns, exact) per topic, reloaded when the site file changes."""
    site = _site_file()
    try:
        site_text, stamp = site.read_text(), site.stat().st_mtime
    except OSError:
        site_text, stamp = '', 0
    if _cache.get('stamp') != stamp:
        _cache['stamp'], _cache['tables'] = stamp, _load(SEED_FILE.read_text(), site_text)
    return _cache['tables']


def patterns(topic, answer):
    """The pattern texts of one answer (seed + site rows, without those switched off), for code that skips by pattern before any AI."""
    return [rx.pattern for rx, found in tables()[0].get(topic, []) if found == answer]


def ai_first(topic):
    """True when this topic's patterns are only the offline floor (config/meanings_schema.json 'ai_first'): the AI is asked first and the
    patterns answer only when there is no AI at all."""
    return bool(schema().get(topic, {}).get('ai_first'))


def every(topic, text, patterns=True):
    """Every answer the pack gives this text ('many' topics): exact wordings first, then all matching patterns (patterns=False: none);
    [] when it knows nothing."""
    rows, exact = tables()
    known = exact.get(topic, {}).get(_norm(text))
    found = [known] if known else []
    if patterns:
        found += [answer for rx, answer in rows.get(topic, []) if rx.search(str(text or ''))]
    return list(dict.fromkeys(found))


def first(topic, text, patterns=True):
    """The pack's answer for this text: an exact wording, else the first matching pattern in order; None when it knows nothing."""
    found = every(topic, text, patterns)
    return found[0] if found else None


MAX_OUTBOX = 500


def _outbox():
    from ..paths import DATA
    return DATA / 'meanings_outbox.json'


def queue(topic, wording, answer):
    """Keep the model's answer for a public wording (a topic whose schema says share) for the site; the app sends it with the pack request
    (desktop/lib/aliases.js) when the user's technical reports are on. A user's own words and anything from mail never get here."""
    if not schema().get(topic, {}).get('share') or not valid({'topic': topic, 'kind': 'exact', 'wording': wording, 'answer': answer}):
        return
    file = _outbox()
    try:
        rows = json.loads(file.read_text()).get('rows') or []
    except (OSError, ValueError):
        rows = []
    row = {'topic': topic, 'wording': _norm(wording), 'answer': answer}
    if row not in rows:
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(json.dumps({'rows': (rows + [row])[-MAX_OUTBOX:]}, ensure_ascii=False))


class Matcher:
    """A pack-backed stand-in for a compiled keyword regex (`.search`, `.findall`): the rows of one topic and answer, read at each use, so the
    site's rows and switch-offs apply without a release. The seed keeps each old list whole, as one row: the same matches as before."""

    def __init__(self, topic, answer):
        self.topic, self.answer = topic, answer

    def _rows(self):
        return [rx for rx, found in tables()[0].get(self.topic, []) if found == self.answer]

    def search(self, text, *args):
        return next((m for rx in self._rows() if (m := rx.search(text, *args))), None)

    def findall(self, text, *args):
        return [found for rx in self._rows() for found in rx.findall(text, *args)]


def matcher(topic, answer):
    return Matcher(topic, answer)
