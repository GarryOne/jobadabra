"""How much of the market does the search catch? The funnel of one crawl, and the near misses.

A crawl fetches every posting of every feed, keeps those with a wanted title in a wanted place, and drops the rest without a word.
When the role keywords are narrow that silently hides most of the relevant market (owner, 2 Oct 2026: 3,142 postings in his places,
164 matched, "distributed systems", his top interest, was not a keyword). This counts, per crawl: postings fetched, in the wanted
places, matched by the role keywords; and, among the in-place postings no keyword matched, how many titles contain each of a list of
engineering role terms, with examples, so the app can say "your keywords catch 5%; adding backend would add 49" and let the user choose.
No AI and no network: it only counts what the crawl already fetched.
"""
import json
import os
import sys
import re
from datetime import datetime, timezone

from .paths import DATA

FILE = DATA / 'coverage.json'
# Engineering role terms a user might want to add, as plain words (shown to the user; matched in titles, any case).
VOCAB = ('distributed systems', 'systems engineer', 'backend', 'back-end', 'full stack', 'software engineer', 'data platform',
         'data infrastructure', 'data engineer', 'security engineer', 'machine learning', 'ml engineer', 'performance engineer',
         'storage', 'networking', 'database', 'release engineer', 'build engineer', 'devsecops', 'operations engineer', 'sdet')
# The same kinds of role in the languages job titles are written in across Europe (German, French, Italian, Spanish, Dutch, Polish):
# an English-only search silently misses them. Offered like the words above; marked so the card can say why.
LOCAL_VOCAB = ('systemtechniker', 'systemingenieur', 'systemadministrator', 'informatiker', 'plattform', 'infrastruktur', 'cloud-ingenieur',
               'betriebsingenieur', 'netzwerktechniker', 'softwareentwickler', 'entwickler', 'applikationsentwickler', 'dateningenieur',
               'ingénieur système', 'ingénieur systèmes', 'ingénieur cloud', 'ingénieur devops', 'ingénieur infrastructure', 'ingénieur logiciel',
               'administrateur système', 'administrateur systèmes', 'développeur', 'ingénieur réseau', 'sistemista', 'sviluppatore',
               'ingegnere cloud', 'ingegnere devops', 'amministratore di sistema', 'ingeniero devops', 'ingeniero cloud', 'desarrollador',
               'ontwikkelaar', 'systeembeheerder', 'programista', 'administrator systemów')
# Role words of other trades, in the languages of the places users search (6 Oct 2026: a photographer's search caught 0 of 6,449 postings
# in Geneva and the card, knowing only IT words, said nothing). Offered only to a search of that kind (role_kinds), fixed like the above.
TRADE_VOCAB = ('sales associate', 'sales advisor', 'client advisor', 'client adviser', 'store manager', 'shop manager', 'retail', 'cashier',
               'conseiller de vente', 'conseillère de vente', 'vendeur', 'vendeuse', 'gestionnaire de vente', 'employé de magasin', 'caissier',
               'caissière', 'gérant', 'gérante', 'responsable de magasin', 'verkäufer', 'verkäuferin', 'filialleiter', 'detailhandel',
               'warehouse', 'logistics', 'magasinier', 'logisticien', 'préparateur', 'cariste', 'chauffeur', 'livreur', 'lagerist', 'logistiker',
               'photographer', 'photographe', 'fotograf', 'videographer', 'vidéaste', 'retoucheur', 'graphic designer', 'graphiste',
               'content creator', 'social media', 'waiter', 'serveur', 'serveuse', 'barista', 'cuisinier', 'koch', 'réceptionniste',
               'nurse', 'infirmier', 'infirmière', 'pflegefachfrau', 'pflegefachmann', 'assistant en soins', 'accountant', 'comptable',
               'buchhalter', 'office assistant', 'assistant administratif', 'sachbearbeiter', 'teacher', 'enseignant', 'lehrer',
               'technician', 'technicien', 'électricien', 'mécanicien', 'elektriker', 'polymechaniker')
VOCAB = VOCAB + LOCAL_VOCAB + TRADE_VOCAB
LOCAL_MIN = 3   # a local-language word with at least this many missed postings is worth saying, however broad the search already is
EXAMPLES = 3
# Places a user with EU work rights could add, as a fixed list (label shown, regex fragment written into the search settings' "abroad"
# places). The app only ever adds a fragment offered here: fixed words in, nothing typed by a server or a posting.
PLACE_OPTIONS = (
    ('United Kingdom', r'\bunited\ kingdom\b|\buk\b|\bengland\b|\bscotland\b|\bwales\b|\bbristol\b|\bcambridge\b|\bmanchester\b|\bedinburgh\b|\bbelfast\b'),
    ('Ireland', r'\bireland\b|\bdublin\b|\bcork\b'),
    ('Netherlands', r'\bnetherlands\b|\bamsterdam\b|\brotterdam\b|\butrecht\b|\beindhoven\b'),
    ('France', r'\bfrance\b|\bparis\b|\blyon\b'),
    ('Germany', r'\bgermany\b|\bdeutschland\b|\bmunich\b|\bm[uü]nchen\b|\bhamburg\b|\bfrankfurt\b|\bcologne\b|\bstuttgart\b'),
    ('Spain', r'\bspain\b|\bmadrid\b|\bbarcelona\b'),
    ('Portugal', r'\bportugal\b|\blisbon\b|\bporto\b'),
    ('Italy', r'\bitaly\b|\bmilan\b|\brome\b'),
    ('Poland', r'\bpoland\b|\bwarsaw\b|\bkrak[oó]w\b|\bwroc[lł]aw\b'),
    ('Nordics', r'\bsweden\b|\bstockholm\b|\bdenmark\b|\bcopenhagen\b|\bnorway\b|\boslo\b|\bfinland\b|\bhelsinki\b'),
    ('Austria', r'\baustria\b|\bvienna\b|\bwien\b'),
    ('Belgium and Luxembourg', r'\bbelgium\b|\bbrussels\b|\bluxembourg\b'),
    ('Central and Eastern Europe', r'\bczech\b|\bprague\b|\bromania\b|\bbucharest\b|\bhungary\b|\bbudapest\b|\blithuania\b|\bvilnius\b|\bestonia\b|\btallinn\b|\bgreece\b|\bathens\b'),
)
PLACE_PATTERNS = tuple((label, fragment, re.compile(fragment, re.I)) for label, fragment in PLACE_OPTIONS)
MIN_PLACE_POSTINGS = 5   # a place is offered when at least this many matching postings sit there
NARROW_BELOW = 0.10   # the keywords catch under a tenth of the in-place postings that are engineering roles: say so


def _pattern(term):
    """The term as it appears in a title: a space and a hyphen are the same ("back-end" finds "Back End"), whole words only."""
    words = [re.escape(word) for word in re.split(r'[\s-]+', term.strip()) if word]
    return re.compile(r'(?<![a-z])' + r'[\s-]'.join(words) + r'(?![a-z])', re.I)


MISSED_KEPT = 4000   # titles kept for counting suggested roles (a cache, rebuilt by every search)


class Tally:
    """Counts one crawl. add() takes each fetched posting with the three decisions the crawl already made."""

    def __init__(self, vocab=VOCAB):
        self.fetched = self.in_places = self.matched = self.feeds = 0
        self.vocab = {term: _pattern(term) for term in vocab}
        self.near = {term: {'count': 0, 'examples': []} for term in vocab}
        self.title_hits = self.elsewhere = 0   # role-keyword matches anywhere / those outside the wanted places
        self.places = {label: {'count': 0, 'examples': [], 'fragment': fragment} for label, fragment, _ in PLACE_PATTERNS}
        self.dropped = {}   # excluded-title word -> postings in the places that the role keywords caught and that word dropped
        self.missed = set()   # titles in the places the role keywords miss (lowercased, at most MISSED_KEPT): counted by src/ai/role_ideas.py

    def feed(self):
        self.feeds += 1

    def add(self, title, in_place, matched, excluded=False, location='', dropped_by=''):
        self.fetched += 1
        if dropped_by and in_place:
            entry = self.dropped.setdefault(dropped_by, {'count': 0, 'examples': []})
            entry['count'] += 1
            if len(entry['examples']) < EXAMPLES and title not in entry['examples']:
                entry['examples'].append(title)
        if matched and not excluded:
            self.title_hits += 1
            if not in_place:
                self._out_of_place(title, location)
        if not in_place or excluded:
            return
        self.in_places += 1
        if matched:
            self.matched += 1
            return
        if len(self.missed) < MISSED_KEPT:
            self.missed.add(' '.join(str(title or '').lower().split())[:120])
        for term, pattern in self.vocab.items():
            if pattern.search(title or ''):
                entry = self.near[term]
                entry['count'] += 1
                if len(entry['examples']) < EXAMPLES and title not in entry['examples']:
                    entry['examples'].append(title)

    def _out_of_place(self, title, location):
        """A posting the role keywords caught in a place you did not list: counted under the first place option it sits in."""
        for label, _, pattern in PLACE_PATTERNS:
            if pattern.search(location or ''):
                entry = self.places[label]
                entry['count'] += 1
                if len(entry['examples']) < EXAMPLES and title not in entry['examples']:
                    entry['examples'].append(title)
                return
        self.elsewhere += 1

    def summary(self, now=None):
        suggestions = sorted(({'term': term, **entry} for term, entry in self.near.items() if entry['count'] >= 2),
                             key=lambda item: -item['count'])
        places = sorted(({'place': label, **entry} for label, entry in self.places.items() if entry['count'] >= MIN_PLACE_POSTINGS),
                        key=lambda item: -item['count'])
        return {'excluded': sorted(({'fragment': f, **e} for f, e in self.dropped.items()), key=lambda item: -item['count'])[:8], 'at': (now or datetime.now(timezone.utc)).isoformat(timespec='seconds'), 'feeds': self.feeds, 'fetched': self.fetched,
                'in_places': self.in_places, 'matched': self.matched, 'suggestions': suggestions,
                'title_hits': self.title_hits, 'places': places, 'elsewhere': self.elsewhere, 'missed_titles': sorted(self.missed)}


def save(summary, path=FILE):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(summary, ensure_ascii=False, indent=1) + '\n')
    except OSError:
        pass   # a number for the Strategy page is never worth failing a crawl


def load(path=FILE):
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) and 'in_places' in data else None
    except (OSError, ValueError):
        return None


def looks_technical(keywords):
    """True when any role keyword names IT/engineering work (regex fragments like "\\bsre\\b" are read as their words).
    An empty list is no IT search: roles not known yet steer no one to tech (owner, 19 Oct 2026: a global search, not a tech one)."""
    words = [re.sub(r'\\[bwsd]|[\\^$()|?*+\[\]{}.]', ' ', str(word)) for word in keywords]
    from .role_kinds import kinds_of   # the meanings pack (these words were its seed) and the AI, in any language
    return bool(words) and 'software' in kinds_of(words).values()


def technical_search(search):
    """True when a search's roles are IT or engineering work: the developer-only sources (SwissDevJobs, TechTree, the tech seed lists) are for it.
    Roles not known yet (no strategy drafted, or words we cannot place) are not IT work: no one is steered to tech before their own roles say so. One definition for the scout and the job boards (6 Oct 2026: a photographer's checks crawled both boards)."""
    from .role_kinds import of_search   # the kinds of role a search looks for: one classifier for scout, boards and employers
    kinds = of_search(search)
    return bool(kinds) and 'software' in kinds


def verdict(summary, keywords=(), locations=(), excludes=None, by_ai=False, extras=True):
    """What to tell the user: {'narrow': bool, 'share': matched / in_places, 'suggestions': those not already keywords}.
    Narrow = the keywords catch under NARROW_BELOW of the in-place postings AND some listed term would add at least 5 more.
    A search with no technical keyword (a nurse, an accountant) gets no engineering suggestions and no "too narrow" warning.
    by_ai (an AI is on for the role ideas): the fixed words suggest nothing; the AI's role ideas from the Profile carry the suggestions and say
    the share, from `tight` (owner, 26 Oct 2026, audit PR 6: "One AI row"; the words stay the floor with no AI at all).
    extras: the unused sources, employers for you and the employer meter, which only Strategy draws (Focus's Suggestions leave them out)."""
    if not summary or not (summary.get('in_places') or summary.get('places')):
        return None
    have = {str(word).lower() for word in keywords}
    from .role_kinds import kind_of, of_search
    wanted = of_search({'role_keywords': list(keywords)})
    # The words of the search's own kinds of role only: an IT search gets IT words, a shop search shop words (6 Oct 2026: nothing for others);
    # roles not known yet get none (19 Oct 2026: before the strategy no one is offered engineering terms).
    def offered(term):
        if not wanted:
            return False
        return term not in TRADE_VOCAB if 'software' in wanted else kind_of(term) in wanted
    suggestions = [] if by_ai else [s for s in summary.get('suggestions', []) if s['term'].lower() not in have and offered(s['term'])]
    share = summary['matched'] / summary['in_places'] if summary.get('in_places') else 1
    for item in suggestions:
        item['local'] = item['term'] in LOCAL_VOCAB
    local = any(item['local'] and item['count'] >= LOCAL_MIN for item in suggestions)
    return {'narrow': (share < NARROW_BELOW and any(s['count'] >= 5 for s in suggestions)) or local, 'local': local, 'tight': share < NARROW_BELOW, 'share': share, 'matched': summary['matched'],
            'in_places': summary['in_places'], 'fetched': summary['fetched'], 'feeds': summary['feeds'], 'at': summary.get('at'),
            'suggestions': suggestions[:8], 'places': places_verdict(summary, locations),
            **({'sources': unused_sources(), 'for_you': employers_for_you(), 'employers': employers_state(summary)} if extras else {}),
            'excluded': [item for item in summary.get('excluded') or [] if item['fragment'] in set(excludes or ()) and item['count'] >= 2]}


# Ways to get more jobs this install does not use yet, least effort first. Fixed list: what each costs is said, nothing is turned on here
# (owner, 6 Oct 2026: "recommend all the unused options, ordered by the lowest effort; keys, costs or the user's browser as an option").
SOURCES = (
    {'id': 'brave', 'name': 'Web search (Brave)', 'effort': 'A free key, about 2 minutes', 'gain': "finds employers' own job sites when their name leads nowhere",
     'unused': lambda env: not env.get('BRAVE_SEARCH_API_KEY') and not _claude_code(env)},
    {'id': 'aggregators', 'name': 'Adzuna and Jooble', 'effort': 'Two free keys, about 3 minutes', 'gain': 'job search engines across all trades and countries',
     'unused': lambda env: not ((env.get('ADZUNA_APP_ID') and env.get('ADZUNA_APP_KEY')) or env.get('JOOBLE_API_KEY'))},
    {'id': 'serpapi', 'name': 'Google Jobs (SerpApi)', 'effort': 'A free key (250 searches a month); paid plans beyond', 'gain': 'jobs Google has collected from every site, LinkedIn included',
     'unused': lambda env: not env.get('SERPAPI_API_KEY')},
)


# Owner, 24 Oct 2026: "too much overhead, of configuration for the user"; the in-house scout and search do well without these keys. The three rows are not
# offered anywhere while this is False (desktop/renderer/key-sources.js is the app's copy; desktop/test/key-sources.test.js ties them). A key already set still works.
KEY_SOURCES_OFFERED = False


def _claude_code(env):
    """The AI engine is the user's own plan's CLI (Claude Code or Codex): its web search stands in for the keyed ones."""
    return (env.get('JOB_PILOTTO_AI_ENGINE') or '').lower() in ('cli', 'codex')


BOARDS_OF = {'aggregators': ('adzuna', 'jooble'), 'serpapi': ('google_jobs',)}   # a source here -> its board ids in the shared pool
PEOPLE_MIN = 3   # people like you behind a rate, at least


def people_like_you(source_id, me=None, rate=None):
    """'Gave a match to 6 in 10 people like you' for a source, from the shared pool's board totals (src/employer_index.board_rate), or ''."""
    from . import employer_index
    rate = rate or employer_index.board_rate
    try:
        me = me or employer_index.me_now()
        pairs = [pair for pair in (rate(board, me) for board in BOARDS_OF.get(source_id, ())) if pair and pair[0] >= PEOPLE_MIN]
    except Exception as error:  # noqa: BLE001 — said, then nothing shown
        print(f'Warning: what {source_id} gave people like you not read ({type(error).__name__}: {error})', file=sys.stderr)
        return ''
    if not pairs:
        return ''
    installs, matched = max(pairs, key=lambda pair: pair[1] / pair[0])
    return f'gave a match to {round(10 * matched / installs)} in 10 people like you'


def unused_sources(env=None):
    """[{id, name, effort, gain, people}] of SOURCES this install does not use, in order (least effort first). `people`: what it gave
    people like this user, from the shared pool (7 Oct 2026), or ''."""
    env = os.environ if env is None else env
    if not KEY_SOURCES_OFFERED:
        return []
    return [{**{key: source[key] for key in ('id', 'name', 'effort', 'gain')}, 'people': people_like_you(source['id'])} for source in SOURCES if source['unused'](env)]


def employers_state(summary, db_path=None):
    """{'read', 'matched', 'pending', 'last_scout', 'runway'} for the "Your employers" meter: the last check's employer feeds read and with a match
    (src/sources/feeds.py), and the scout's candidates not checked yet with its last check. Missing parts are None."""
    import sqlite3
    from .paths import jobs_db
    state = dict((summary or {}).get('employers') or {})
    try:
        with sqlite3.connect(db_path or jobs_db()) as db:
            if db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scout_candidates'").fetchone():
                state['pending'] = db.execute("SELECT COUNT(*) FROM scout_candidates WHERE status = 'pending'").fetchone()[0]
                state['last_scout'] = db.execute('SELECT MAX(checked_at) FROM scout_candidates').fetchone()[0]
                from .scout import batch_for
                state['batch'] = batch_for(state['pending'])
            if db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'feed_rest'").fetchone():
                from datetime import datetime, timezone
                from .sources.feeds import runway
                state['runway'] = runway(db.execute('SELECT misses, rest_until FROM feed_rest').fetchall(),
                                         datetime.now(timezone.utc).isoformat(timespec='seconds'))
    except sqlite3.Error as error:
        print(f'Warning: employer counts not read ({error})', file=sys.stderr)
    return {key: state.get(key) for key in ('read', 'matched', 'pending', 'last_scout', 'runway', 'batch')}


def employers_for_you():
    """Employers of the shared list where people like this user got interviews or applied (src/employer_index.for_you), or []."""
    from . import employer_index
    try:
        stored = employer_index._read(employer_index.CACHE) or {}
        picks = employer_index.for_you(stored.get('feeds') or [], employer_index.me_now())
    except Exception as error:  # noqa: BLE001 — said, then no card
        print(f'Warning: employers for you not ranked ({type(error).__name__}: {error})', file=sys.stderr)
        return []
    # "Why is X first?": each pick with its score and the label it shares with this user (engine log, stderr: stdout is the app's JSON).
    for i, pick in enumerate(picks, 1):
        print(f"For you #{i}: {pick['company']} score {pick['score']} (shared {pick['label']}; {pick['interview']} interviews, {pick['applied']} applied)", file=sys.stderr)
    return picks


def language_drops(db=None):
    """[{language, count, examples}]: open jobs in the cache that a language in the user's "languages that rule a job out" hides (the
    AI read it as required), most first. 6 Oct 2026: a photographer's preferences ruled out English, German, Italian and Spanish."""
    from . import digest, store
    from .paths import jobs_db
    try:
        db = db or store.connect(jobs_db())
        _, hidden = digest.eligible_jobs(db)
    except Exception:  # noqa: BLE001 — no cache yet: nothing to say
        return []
    ruled_out = set(digest.PREFERENCES.get('disqualifying_languages') or [])
    counts = {}
    for job in hidden:
        for item in (job.get('ai') or {}).get('languages') or []:
            if item.get('level') == 'required' and item.get('language') in ruled_out:
                entry = counts.setdefault(item['language'], {'language': item['language'], 'count': 0, 'examples': []})
                entry['count'] += 1
                if len(entry['examples']) < EXAMPLES:
                    entry['examples'].append(str(job.get('title') or '')[:80])
    return sorted(counts.values(), key=lambda item: -item['count'])


def places_verdict(summary, locations=()):
    """Where the role keywords find jobs just outside your places: {'title_hits', 'matched', 'options', 'elsewhere'} or None.
    Options are the offered places (fixed list) that hold at least MIN_PLACE_POSTINGS postings, minus fragments already in your places."""
    have = {str(fragment).lower() for fragment in locations}
    options = [o for o in summary.get('places') or [] if o.get('fragment', '').lower() not in have]
    if not options:
        return None
    return {'title_hits': summary.get('title_hits', 0), 'matched': summary['matched'], 'elsewhere': summary.get('elsewhere', 0),
            'options': [{'place': o['place'], 'count': o['count'], 'examples': o.get('examples', []), 'fragment': o['fragment']} for o in options[:8]]}
