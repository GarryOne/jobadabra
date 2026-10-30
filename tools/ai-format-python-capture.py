# Capture real engine sender functions from their AST without importing runtime modules or credentials.
"""Refresh the engine snapshots: python3 tools/ai-format-python-capture.py.

Only selected original definitions execute; imports resolve to explicit offline fixtures.
The Node generator verifies source hashes and consumes these snapshots in-process.
"""
import ast
import builtins
import copy
import hashlib
import json
import re
import sqlite3
import tempfile
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace as NS

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'desktop/e2e/fixtures/golden/ai-format-python.json'
DEPENDENCIES = {}
IMPORTS = {}


def read(file):
    """Read an explicitly named repository fixture/source and record its fingerprint."""
    data = (ROOT / file).read_bytes()
    DEPENDENCIES[file] = hashlib.sha256(data).hexdigest()
    return data.decode()


def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    """Resolve only explicitly injected dependencies; never invoke a runtime import."""
    if name == 'copy' and not level:
        return copy
    if name == 're' and not level:
        return re
    if fromlist and all(key in IMPORTS for key in fromlist):
        return NS(**{key: IMPORTS[key] for key in fromlist})
    raise RuntimeError(f'Offline capture forbids import {name} {fromlist}')


def load(file, names, **bindings):
    """Execute intact, explicitly selected AST definitions with inert dependencies."""
    tree = ast.parse(read(file), filename=file)
    selected, found = [], set()
    for node in tree.body:
        assigned = {part.id for target in node.targets for part in ast.walk(target)
                    if isinstance(part, ast.Name)} if isinstance(node, ast.Assign) else set()
        declared = {node.name} if isinstance(node, ast.FunctionDef) else assigned
        if declared & set(names):
            selected.append(node)
            found |= declared
    if set(names) - found:
        raise RuntimeError(f'{file}: definitions disappeared: {set(names) - found}')
    safe_builtins = {**vars(builtins), '__import__': safe_import}
    # Why (30 Oct 2026, ap): no paths.py/engine/provider imports may read .env, login state or the owner's data.
    namespace = dict(__builtins__=safe_builtins, __package__='src.ai', json=json, re=re, hashlib=hashlib,
                     datetime=datetime, timezone=timezone, unicodedata=unicodedata,
                     os=NS(getenv=lambda name, default=None: default), sys=NS(modules={}), print=lambda *a, **k: None,
                     **bindings)
    exec(compile(ast.Module(body=selected, type_ignores=[]), file, 'exec'), namespace)
    return NS(**{name: namespace[name] for name in names})


def locate(file, marker, *, after=None):
    """Locate a live sender/parser marker without freezing a stale line number."""
    started = after is None
    for number, line in enumerate(read(file).splitlines(), 1):
        started = started or after in line
        if started and marker in line:
            return f'{file}:{number}'
    raise RuntimeError(f'{file}: missing {marker}')


class Client:
    """One fixture response, with the exact Messages body saved before parsing."""
    def __init__(self, answer):
        self.messages, self.request = self, None
        self.calls = 0
        self.answer = answer

    def create(self, **body):
        self.calls += 1
        if self.calls != 1:
            raise AssertionError('More than one sender call')
        self.request = copy.deepcopy(body)
        return NS(content=[NS(type='text', text=json.dumps(self.answer))], stop_reason='end_turn',
                  usage=NS(input_tokens=0, output_tokens=0, billing='subscription'))


def capture_engine():
    """Capture declared engine senders with fixture-only state and one-response clients."""
    models = load('src/ai/models.py', ['SMALL_MODEL', 'MAIN_MODEL', 'BIG_MODEL'])
    schema = load('src/ai/providers/schema.py', ['LIMITS', 'without_limits'])
    engine = load('src/ai/engine.py', ['effort_for', 'structured'], without_limits=schema.without_limits)
    cost = NS(side=lambda *a: None)
    paths = load('src/paths.py', ['whole_word', 'keyword_regex'])
    terms = load('src/notion/search_settings.py', ['ACCENTS', 'META', '_accents_to_plain', 'fragment_of', 'readable', 'terms'],
                 whole_word=paths.whole_word)
    IMPORTS.update(engine=engine, cost=cost, terms=terms.terms, SMALL_MODEL=models.SMALL_MODEL)
    IMPORTS['_key'] = load('src/regions.py', ['_key'])._key
    answers_file = 'desktop/e2e/fixtures/golden/ai-answers.json'
    table = json.loads((ROOT / answers_file).read_text(encoding='utf-8'))
    interview = table['answers']['app.interview']['recruiter-call-gamma']
    # Canonical subtree bytes: json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False), UTF-8; same as the Node checker/tests.
    encoded = json.dumps(interview, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    DEPENDENCIES[answers_file + '#answers.app.interview.recruiter-call-gamma'] = hashlib.sha256(encoded).hexdigest()
    candidate = read('desktop/e2e/fixtures/golden/candidate.txt')
    transcript = read('desktop/e2e/lib/interview-data.mjs').split('export const TRANSCRIPT = `', 1)[1].split('`;', 1)[0]
    review = json.loads(interview['reply']['content'][0]['text'])
    entries = []

    def keep(kind, client, context, source, marker, validator, parser, *, action=None, source_after=None, validator_after=None):
        if client.request is None or client.calls != 1:
            raise AssertionError(f'{kind}: expected exactly one captured request')
        model = client.request['model']
        entries.append(dict(kind=kind, action=action or kind.removeprefix('app.'), request=client.request, context=context,
                            source=locate(source, marker, after=source_after), validator=locate(validator, parser, after=validator_after),
                            tier='small' if 'haiku' in model else 'large' if 'opus' in model else 'mid'))

    places = load('src/places.py', ['MODEL', 'MAX_NAMES', 'REGION_COUNTRIES', 'NAME_OK', 'SCHEMA', 'SYSTEM',
                  '_plain', '_key', 'clean_names', 'ask'], SMALL_MODEL=models.SMALL_MODEL)
    words = ['germany', 'berlin']
    client = Client({'places': []})
    places.ask(client, words)
    keep('places', client, {'words': words}, 'src/places.py', 'response = client.messages.create(', 'src/places.py', 'if response.stop_reason')

    redraft = load('src/field_redraft.py', ['SCHEMA', 'SYSTEM', 'ask'])
    search = {'role_keywords': ['first officer', 'pilot'], 'locations': {}}
    client = Client({'board_words': [], 'stack_words': [], 'queries': []})
    redraft.ask(search, '', client)
    keep('field_redraft', client, {'search': search, 'profile': ''}, 'src/field_redraft.py', 'response = client.messages.create',
         'src/field_redraft.py', 'def redrafted(')

    interviews = load('src/ai/interviews_ai.py', ['DEFAULT_MODEL', 'FALLBACK_MODEL', 'MAX_TOKENS', 'FACTS', 'SCHEMA', 'SYSTEM', 'ask', 'analyse'],
                      BIG_MODEL=models.BIG_MODEL, MAIN_MODEL=models.MAIN_MODEL, engine=engine)
    client = Client(review)
    interviews.analyse(client, interviews.DEFAULT_MODEL, candidate, [], 'recruiter-call-gamma', transcript)
    keep('interview', client, {'profile': candidate, 'apps': [], 'caption': 'recruiter-call-gamma', 'transcript': transcript},
         'src/ai/interviews_ai.py', 'response = client.messages.create(model=model, **request)', 'src/ai/interviews_ai.py', 'if response.stop_reason !=')

    text = load('src/ai/interview_insights_text.py', ['MIN_SUPPORT', 'ROUND_TYPES', 'MAX_REVIEW_CHARS', 'KINDS', 'SCHEMA', 'SYSTEM'])
    insights = load('src/ai/interview_insights.py', ['prompt_input', 'generate'], interviews=interviews, engine=engine,
                    SYSTEM=text.SYSTEM, SCHEMA=text.SCHEMA, MAX_REVIEW_CHARS=text.MAX_REVIEW_CHARS, ROUND_TYPES=text.ROUND_TYPES)
    item = dict(id='fixture-I1', label='I1', date='2026-10-30', round='Recruiter screen', round_type='Recruiter screen',
                company='Gamma Freight', job='Senior Site Reliability Engineer', outcome='positive', topics=['Terraform'], weak_topics=['multi cloud'],
                next_step=review['next_step'], summary=review['summary'], strengths=review['strengths'], weak_spots=review['weaknesses'],
                practice=review['practice'], signals=review['signals'], weak_answers=[], mixed_answers=[], against=review['red_flags'], transcript=transcript)
    client = Client(json.loads(table['kinds']['interview_patterns']['answer']['reply']['content'][0]['text']))
    insights.generate(client, interviews.DEFAULT_MODEL, [item])
    keep('interview_patterns', client, {'items': [item]}, 'src/ai/interviews_ai.py', 'response = client.messages.create(model=model, **request)',
         'src/ai/interview_insights.py', 'def validate(')

    with tempfile.TemporaryDirectory(prefix='.ai-format-', dir=ROOT) as temporary:
        ideas = load('src/ai/role_ideas.py', ['MODEL', 'MAX_IDEAS', 'SCHEMA', 'SYSTEM', '_key', '_load', 'ideas', '_counted', 'count'],
                     MAIN_MODEL=models.MAIN_MODEL, STORE=Path(temporary) / 'roles.json', providers=NS(who=lambda: 'offline capture'))
        search = {'role_keywords': ['vendeur', 'photographe'], 'locations': {'top_tier': ['geneve']}}
        client = Client({'ideas': []})
        ideas.ideas('Photographer and shop seller', search, [], client=client, today='2026-10-30')
        keep('role_ideas', client, {'profile': 'Photographer and shop seller', 'search': search, 'titles': [], 'set_aside': []},
             'src/ai/role_ideas.py', 'response = client.messages.create(model=MODEL', 'src/ai/role_ideas.py', "kept = {'day': today")

    notes = load('src/ai/schema_notes.py', ['text'])
    bands = load('src/ai/score_bands.py', ['UNMET', 'TEXT'])
    score_search = load('src/ai/score_search.py', ['PART', 'RULE', 'SEARCH_ROLE_FIT', 'extend', 'block', 'apply', 'tier'],
                        _roles=lambda search=None: ['Site Reliability Engineer'])
    scorer = load('src/ai/score.py', ['_component', '_open_component', 'SCHEMA', 'SYSTEM', 'EFFORT', '_ask'], engine=engine,
                  score_bands=bands, score_search=score_search, schema_notes=notes, locations=NS(block_now=lambda: ''),
                  hints=NS(load=lambda: {}, text=lambda value: ''))
    job = json.loads(read('desktop/e2e/fixtures/golden/truth.json'))[0]
    job['company'] = json.loads(read('desktop/e2e/fixtures/golden/sources.json'))[0]['company']
    client = Client(json.loads(table['answers']['app.score']['3001']['reply']['content'][0]['text']))
    scorer._ask(client, models.MAIN_MODEL, job, candidate, None, '', scorer.SCHEMA)
    keep('app.score', client, {'job': job, 'profile': candidate, 'roles': ['Site Reliability Engineer'], 'hints': {}, 'locations': ''},
         'src/ai/score.py', 'response = client.messages.create(**params)', 'src/ai/score.py', 'if response.stop_reason !=')

    pack = NS(ai_first=lambda topic: False, first=lambda *a, **k: None, queue=lambda *a: None)
    IMPORTS['meanings_pack'] = pack
    decide = load('src/ai/decide.py', ['MODEL', 'BATCH', 'MAX_TEXT', 'MAX_CALLS_PER_RUN', 'CENTRAL_MAX_CALLS', '_calls', '_own',
                  'SCOPE', 'STOPPED', 'WAITING', 'CACHE_ONLY', 'SYSTEM', 'limit', '_table', 'kept', 'decide'],
                  SMALL_MODEL=models.SMALL_MODEL, budget_tape=NS(within=lambda *a: True), cost=cost, engine=engine)
    captured = json.loads(read('desktop/e2e/fixtures/golden/interviews-decide.json'))['requests'][0]
    task, choices, blocks = re.fullmatch(r'Task: ([\s\S]+)\nAllowed answers: ([^\n]+)\n\n([\s\S]+)', captured['messages'][0]['content']).groups()
    items = {'fixture-0': blocks.split('\n', 1)[1]}
    client = Client({'results': []})
    with sqlite3.connect(':memory:') as db:
        decide.decide('nightly-fixture', items, choices.split(', '), task, client=client, db=db)
    keep('app.decide', client, {'topic': 'nightly-fixture', 'items': items, 'answers': choices.split(', '), 'instructions': task},
         'src/ai/decide.py', 'response = client.messages.create(model=MODEL', 'src/ai/decide.py', "results = json.loads(next(block.text")

    kinds = load('src/role_kinds.py', ['KINDS', 'WORK'])
    enrich = load('src/ai/enrich.py', ['LANGUAGES', '_evidence', 'IT_FAMILIES', 'IT_WORK', 'ROLE_FAMILIES', 'SCHEMA', 'SYSTEM', '_ask'],
                  KINDS=kinds.KINDS, WORK=kinds.WORK, schema_notes=notes, engine=engine)
    client = Client({})
    enrich._ask(client, models.SMALL_MODEL, job, enrich.SCHEMA)
    keep('app.enrich', client, {'subrequest': 'full', 'job': job}, 'src/ai/enrich.py', 'response = client.messages.create(',
         'src/ai/enrich.py', 'return json.loads(next(block.text')

    # Why (30 Oct 2026, ap): the declared app.places item family and legacy places kind both need entries even though they share a sender.
    words = ['Zürich', 'Paris']
    client = Client({'places': []})
    places.ask(client, words)
    keep('app.places', client, {'subrequest': 'place-word-expansion', 'words': words}, 'src/places.py', 'response = client.messages.create(',
         'src/places.py', 'answer = json.loads(next(block.text')

    engine.PARALLEL = 1
    slots = NS(carry=lambda function: function)
    IMPORTS.update(ThreadPoolExecutor=ThreadPoolExecutor, Ticker=lambda *a, **k: NS(tick=lambda *a: None),
                   time_budget=NS(in_calls=lambda label, count, *a, **k: count, over=lambda *a, **k: False, record=lambda *a: None),
                   keyword_regex=paths.keyword_regex, geo=NS(verdicts=lambda *a, **k: {}))
    geo = load('src/geo.py', ['BATCH', 'KINDS', 'MAX_RADIUS', 'SCHEMA', 'SYSTEM', 'valid', '_ask'], slots=slots)
    strings = ['zurich, switzerland', 'remote']
    client = Client({'places': [{'n': 1, 'kind': 'city', 'cc': 'CH', 'lat': 47.37, 'lon': 8.54, 'r_km': 15},
                               {'n': 2, 'kind': 'remote', 'cc': '', 'lat': 0, 'lon': 0, 'r_km': 0}]})
    geo._ask(client, strings)
    keep('app.geo', client, {'subrequest': 'map', 'strings': strings}, 'src/geo.py', 'response = client.messages.create(',
         'src/geo.py', 'def valid(', action='place_triage')

    # Why (30 Oct 2026, ap): qu's #2533 declared app.visit rows, so the manifest's completeness test needs the real site-relevance sender; its stored-list cache is a one-line fixture and the engine gate says ready.
    visits = load('src/sources/visits.py', ['RELEVANT_MODEL', 'RELEVANT_SCHEMA', 'RELEVANT_SYSTEM', 'RELEVANT_UNSURE', 'RELEVANT_VERSION', 'KEEP_LISTS', 'relevant'],
                  SMALL_MODEL=models.SMALL_MODEL, _load=lambda: {}, _save=lambda data: None, LOCK=threading.Lock(), load_search_config=lambda **k: {},
                  reason=str, detail=lambda *a: None)
    IMPORTS['engine'] = NS(**vars(engine), ready=lambda: True, client=lambda **k: None)
    sites = [{'name': 'Acme Freight', 'url': 'https://acme-freight.example/careers', 'kind': 'employer', 'found': 'logistics'},
             {'name': 'Example Jobs', 'url': 'https://jobs.example/search', 'kind': 'portal', 'found': ''}]
    visit_search = {'role_keywords': ['warehouse manager'], 'locations': {'top_tier': ['Zurich'], 'country_wide': []}}
    client = Client({'keep': [1, 2]})
    visits.relevant(sites, visit_search, client=client, label='Visit list', unsure='keep')
    keep('app.visit', client, {'sites': sites, 'search': visit_search, 'unsure': 'keep'}, 'src/sources/visits.py', 'response = client.messages.create(',
         'src/sources/visits.py', 'numbers = {int(n)', action='visit_relevant')

    with tempfile.TemporaryDirectory(prefix='.ai-format-', dir=ROOT) as temporary:
        temporary = Path(temporary)
        scope = NS(view=lambda *a: {}, active=lambda: False)
        bindings = dict(SMALL_MODEL=models.SMALL_MODEL, slots=slots, batch_scope=scope, threading=threading, time=time,
                        LOCK=threading.Lock(), providers=NS(who=lambda: 'offline capture'))
        place_search = {'locations': {'top_tier': ['zurich'], 'country_wide': ['switzerland']}, 'remote_jobs': ['yes']}
        place_names = ['MODEL', 'BATCH', 'VERSION', 'SCHEMA', 'SYSTEM', 'VISA_SCHEMA', 'VISA_SYSTEM',
                       'places_words', '_key', 'norm', '_load', 'known', '_keep', 'decide']
        location_reply = {'locations': [{'n': 1, 'where': 'Zurich', 'country': 'Switzerland', 'nearest': 'zurich', 'km': 0, 'answer': 'best'}]}
        triage = load('src/ai/place_triage.py', place_names, **bindings, STORE=temporary / 'locations.json', _preferences=lambda: {})
        client = Client(location_reply)
        triage.decide(['zurich'], place_search, client=client)
        keep('app.place', client, {'subrequest': 'location', 'locations': ['zurich'], 'search': place_search, 'preferences': {}},
             'src/ai/place_triage.py', 'response = client.messages.create(model=MODEL, max_tokens=4000',
             'src/ai/place_triage.py', "answer = json.loads(next(b.text", action='place_triage')

        rights = ['Swiss citizenship']
        triage = load('src/ai/place_triage.py', place_names, **bindings, STORE=temporary / 'visa.json',
                      _preferences=lambda: {'work_rights': rights})
        preliminary, client = Client(location_reply), Client({'visa': []})
        # Why (30 Oct 2026, ap): visa is the real decide() follow-up; satisfy its prerequisite with a separate one-response fixture client, never a copied visa request builder.
        def route(**body):
            return (preliminary if preliminary.calls == 0 else client).create(**body)
        triage.decide(['zurich'], place_search, client=NS(messages=NS(create=route)))
        if preliminary.calls != 1:
            raise AssertionError('Visa prerequisite was not captured once')
        keep('app.visa', client, {'subrequest': 'visa', 'rights': rights, 'countries': ['Switzerland'],
                                'search': place_search, 'locations': ['zurich'], 'prerequisite_reply': location_reply},
             'src/ai/place_triage.py', 'response = client.messages.create(model=MODEL, max_tokens=1500, system=',
             'src/ai/place_triage.py', 'needs = {str(c).strip().lower()', action='place_triage')

        # Why (30 Oct 2026, ap): jobs 5/5 declares app.placeVague rows, so the manifest needs the real vague() sender; its decided-places store is a one-word fixture.
        IMPORTS['geo'] = NS(verdicts=lambda *a, **k: {}, cannot_hold=lambda *a: False)
        vague_names = ['MODEL', 'VERSION', 'VAGUE_BATCH', 'VAGUE_SCHEMA', 'VAGUE_SYSTEM', 'places_words', '_key', 'norm', 'vague']
        vague_places = load('src/ai/place_triage.py', vague_names, **{k: v for k, v in bindings.items()}, known=lambda search: {'bern': 'out'}, _preferences=lambda: {},
                            _save=lambda key, decided: None, excluded_remote=lambda *a: False)
        client = Client({'vague': [1]})
        vague_places.vague(['Bern'], place_search, client=client)
        keep('app.placeVague', client, {'subrequest': 'vague', 'locations': ['bern'], 'search': place_search},
             'src/ai/place_triage.py', 'response = client.messages.create(model=MODEL, max_tokens=1500, system=[{',
             'src/ai/place_triage.py', "numbers = {int(n) for n in json.loads", action='place_vague')

        pack.patterns = lambda *a: []
        IMPORTS['levels'] = load('src/levels.py', ['SENIOR', 'ENTRY', 'LEVELS', '_BY_WORD', '_named', 'level_of', 'title_skips'])
        title = load('src/ai/title_triage.py', ['MODEL', 'BATCH', 'MAX_NEW', 'SCHEMA', 'SYSTEM', 'RECHECK_SYSTEM', '_key', '_norm',
                     '_load', 'known', '_second_look', 'decide'], **bindings, STORE=temporary / 'titles.json')
        title_search = {'role_keywords': ['site reliability'], 'title_exclude_keywords': ['intern'], 'level': ['senior']}
        titles = ['Senior Site Reliability Engineer']
        client = Client({'fit': [1]})
        title.decide(titles, title_search, client=client)
        keep('app.title', client, {'subrequest': 'sort', 'titles': titles, 'search': title_search}, 'src/ai/title_triage.py',
             'response = client.messages.create(model=MODEL, max_tokens=1500, system=',
             'src/ai/title_triage.py', 'fit = {int(n) for n in json.loads', action='title_triage',
             source_after='def decide(titles', validator_after='def decide(titles')
    return entries


def main():
    """Write deterministic offline snapshots and their source fingerprints, never a live mode."""
    read('tools/ai-format-python-capture.py')
    entries = capture_engine()
    result = dict(about='Engine request snapshots captured from real sender definitions with injected offline clients; refresh with tools/ai-format-python-capture.py.',
                  v=1, dependencies=DEPENDENCIES, entries=sorted(entries, key=lambda entry: entry['kind']))
    compact = lambda value: json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    dependencies = ',\n'.join(compact(key) + ':' + compact(value) for key, value in sorted(DEPENDENCIES.items()))
    DEST.write_text('{\n"about":' + compact(result['about']) + ',\n"dependencies":{\n' + dependencies
                    + '\n},\n"entries":[\n' + ',\n'.join(compact(entry) for entry in result['entries']) + '\n],\n"v":1\n}\n', encoding='utf-8')
    print(f'Captured {len(entries)} engine requests into {DEST.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
