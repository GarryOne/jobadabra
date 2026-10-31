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
import sys
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
        self.messages, self.request, self.headers = self, None, {}
        self.calls = 0
        self.answer = answer

    def create(self, **body):
        self.calls += 1
        if self.calls != 1:
            raise AssertionError('More than one sender call')
        self.headers = body.pop('extra_headers', {})
        self.request = copy.deepcopy(body)
        return NS(content=[NS(type='text', text=json.dumps(self.answer))], stop_reason='end_turn',
                  usage=NS(input_tokens=0, output_tokens=0, billing='subscription'))


def _capture_weekly(models, engine, keep):
    """Capture the weekly sender with empty fixture statistics, stopping before any reply is parsed."""
    learning = load('src/ai/learning.py', ['ISSUE_SCHEMA', 'RULES'])
    writing = load('src/ai/writing_rules.py', ['RULES'])
    doors = load('src/suggestions.py', ['DOORS', 'DOOR_LABEL_MAX'])
    weekly_text = load('src/ai/insights_text.py', ['HONEST', 'WEEKLY_SCHEMA', 'WEEKLY_SYSTEM'], learning=learning,
                       WRITING_RULES=writing.RULES, DOORS=doors.DOORS, DOOR_LABEL_MAX=doors.DOOR_LABEL_MAX)
    client = Client({})
    def capture_weekly(**body):
        client.create(**body)
        raise RuntimeError('offline weekly captured')
    data = dict(market={'total': 0}, applications={'total': 0}, interviews={}, week={}, learning={'evidence': []})
    weekly = load('src/ai/insights.py', ['weekly'], DEFAULT_MODEL=models.MAIN_MODEL, MAX_TOKENS=8000, MIN_GROUP=10,
                  WEEKLY_SYSTEM=weekly_text.WEEKLY_SYSTEM, WEEKLY_SCHEMA=weekly_text.WEEKLY_SCHEMA, engine=engine,
                  profile_of=lambda stores: 'Fictional SRE in Zurich.', market_stats=lambda *a: data['market'],
                  data_of=NS(application_stats=lambda *a: data['applications'], interview_stats=lambda *a: {}, week_stats=lambda *a: {}),
                  learning=NS(evidence=lambda *a: data['learning']))
    try:
        weekly.weekly(None, NS(), client=NS(messages=NS(create=capture_weekly)))
    except RuntimeError as error:
        if str(error) != 'offline weekly captured':
            raise
    keep('insight', client, {'stats': data}, 'src/ai/insights.py', 'response = client.messages.create(',
         'src/ai/insights.py', "report = json.loads", source_after='def weekly(')


def capture_engine(prompts=False):
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
        entries.append(dict(kind=kind, action=client.headers.get('x-jp-action') or action or kind.removeprefix('app.'), request=client.request, context=context,
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
    if prompts:
        entries[-1].update(kind='app.interview', baseSystem=interviews.SYSTEM)
    mail_config = load('src/ai/mail_config.py', ['OUTREACH', 'KINDS', 'BATCH', 'SCHEMA', 'SYSTEM'],
                       REPLY='Reply received', employer_feedback=NS(RECEIVED='Feedback received'))
    mail = load('src/ai/mail_read.py', ['classify'], SYSTEM=mail_config.SYSTEM, SCHEMA=mail_config.SCHEMA,
                BATCH=mail_config.BATCH, listing=lambda apps: '', engine=engine, cost=NS(add=lambda *a: None))
    client = Client({'results': []})
    mail_items = [dict(subject='Fixture subject', body='Fixture mail text',
                       date='2026-10-30', **{'from': 'sender@example.com'})]
    mail.classify(client, models.SMALL_MODEL, [], mail_items)
    keep('mail', client, {'apps': [], 'items': mail_items},
         'src/ai/mail_read.py', 'response = client.messages.create(', 'src/ai/mail_read.py', 'for result in json.loads')
    if prompts:
        entries[-1]['baseSystem'] = mail_config.SYSTEM

    opportunity = load('src/ai/opportunity.py', ['SCHEMA', 'SYSTEM', 'extract'], engine=engine, cost=NS(add=lambda *a: None))
    opportunity_text = 'Subject: Interview invitation: DevOps Engineer at Initech\n\nWe invite you to interview for the DevOps Engineer role at Initech.'
    client = Client({})
    opportunity.extract(client, models.SMALL_MODEL, opportunity_text, sender='recruiter@example.com')
    if client.headers != {'x-jp-action': 'opportunity'}:
        raise AssertionError('Opportunity extraction must override the shared mail action')
    keep('opportunity', client, {'text': opportunity_text, 'sender': 'recruiter@example.com'},
         'src/ai/opportunity.py', 'response = client.messages.create(', 'src/ai/opportunity.py', 'return json.loads')

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

    with tempfile.TemporaryDirectory(prefix='.ai-format-') as temporary:
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
    scorer = load('src/ai/score.py', ['_component', '_open_component', 'SCHEMA', 'SYSTEM', 'EFFORT', '_whole', '_ask'], engine=engine,
                  copy=copy, score_bands=bands, score_search=score_search, schema_notes=notes, locations=NS(block_now=lambda: ''),
                  hints=NS(load=lambda: {}, text=lambda value: ''))
    job = json.loads(read('desktop/e2e/fixtures/golden/truth.json'))[0]
    job['company'] = json.loads(read('desktop/e2e/fixtures/golden/sources.json'))[0]['company']
    client = Client(json.loads(table['answers']['app.score']['3001']['reply']['content'][0]['text']))
    scorer._ask(client, models.MAIN_MODEL, job, candidate, None, '', scorer.SCHEMA)
    keep('app.score', client, {'job': job, 'profile': candidate, 'roles': ['Site Reliability Engineer'], 'hints': {}, 'locations': ''},
         'src/ai/score.py', 'response = client.messages.create(**params)', 'src/ai/score.py', 'if response.stop_reason !=')
    if prompts:
        entries[-1]['baseSystem'] = scorer.SYSTEM
        for parts in [['compensation'], ['growth'], ['compensation', 'growth']]:
            client = Client(json.loads(table['answers']['app.score']['3001']['reply']['content'][0]['text']))
            scorer._ask(client, models.MAIN_MODEL, job, candidate, None, '', scorer._whole(parts))
            entries.append(dict(kind='app.score', action='score', variant='whole-' + ','.join(parts), request=client.request, baseSystem=scorer.SYSTEM))

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
    if prompts:
        entries[-1]['baseSystem'] = enrich.SYSTEM
        # Why (30 Oct 2026, a8, quality golden 3006): capture the engine's own slot rule and schema builder, never reconstruct the role request.
        role = load('src/ai/enrich.py', ['DUTIES_RULE', 'ROLE_SYSTEM', 'AGAIN', '_only', '_role_schema'], ROLE_FAMILIES=enrich.ROLE_FAMILIES, SCHEMA=enrich.SCHEMA)
        client = Client({})
        enrich._ask(client, models.SMALL_MODEL, job, role._role_schema(), system=role.ROLE_SYSTEM)
        entries.append(dict(kind='app.enrich', action='enrich', variant='role', request=client.request, baseSystem=role.ROLE_SYSTEM))
        fields = ['seniority', 'work_mode', 'technologies']
        for mask in range(1, 8):
            names = [field for index, field in enumerate(fields) if mask & (1 << index)]
            client = Client({})
            enrich._ask(client, models.SMALL_MODEL, job, role._only(names), note=role.AGAIN.format(fields=', '.join(names)))
            entries.append(dict(kind='app.enrich', action='enrich', variant='retry-' + ','.join(names), request=client.request, baseSystem=enrich.SYSTEM))

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

    with tempfile.TemporaryDirectory(prefix='.ai-format-') as temporary:
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
        if prompts:
            # Why (JOB-44, 30 Oct 2026, owner): one family stamp covers every fixed instruction variant, not just the manifest's first request.
            client = Client({'fit': [1]})
            title._second_look(client, titles, {titles[0]: False}, title_search, {'role_words': ['site reliability'], 'words_ruled_out': []})
            entries.append(dict(kind='app.title', variant='recheck', action='title_triage', request=client.request))
            client = Client({'keep': [1, 2]})
            visits.relevant(sites, visit_search, client=client, unsure='leave')
            entries.append(dict(kind='app.visit', variant='leave', action='visit_relevant', request=client.request))
            reading = load('src/ai/place_triage.py', ['MODEL', 'READ_BATCH', 'READ_SCHEMA', 'READ_SYSTEM', 'places_words', 'read'],
                           **bindings, _key=lambda search: 'fixture', read_known=lambda search: {}, read_verdict=lambda *a: None,
                           _preferences=lambda: {}, _load_read=lambda: {}, READ_STORE=temporary / 'read.json')
            client = Client({'jobs': []})
            reading.read([dict(url='fixture-posting', title='Fixture title', location='Country', description='Fixture posting text')],
                         place_search, client=client)
            entries.append(dict(kind='app.placeReading', action='place_reading', request=client.request))
    if not prompts:
        _capture_weekly(models, engine, keep)
    return entries


def mixed_prompt_template(entry, source, template, joins):
    """Capture a mixed sender and its auxiliary instructions with applicant values kept in data slots."""
    def strings(node):
        """Collect literal instruction boundaries, never evaluating a data expression or retaining docstrings."""
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            return []
        if isinstance(node, ast.JoinedStr):
            # Invariant: conditional labels and concatenated literal prefixes inside slots are instructions too.
            return [template(node)] + [text for part in node.values if isinstance(part, ast.FormattedValue) for text in strings(part.value)]
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return [template(node)]
        return [value for child in ast.iter_child_nodes(node) for value in strings(child)]
    file, function = source
    tree = ast.parse(read(file))
    scope = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == function)
    boundary = next(node for node in ast.walk(scope) if isinstance(node, ast.Call)
                    and any(kw.arg == 'messages' for kw in node.keywords))
    keywords = {kw.arg: kw.value for kw in boundary.keywords}
    system = keywords['system']
    if isinstance(system, ast.List):
        system = next(v for k, v in zip(system.elts[0].keys, system.elts[0].values) if k.value == 'text')
    def system_template(node):
        """Resolve only the captured fixed prefix; profile and helper outputs remain slots."""
        if isinstance(node, ast.Name) and node.id in ('SYSTEM', 'system'):
            return entry['baseSystem']
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            return system_template(node.left) + system_template(node.right)
        return template(node)
    entry['systemTemplate'] = system_template(system)
    content = next(v for k, v in zip(keywords['messages'].elts[0].keys, keywords['messages'].elts[0].values) if k.value == 'content')
    if isinstance(content, ast.Name):
        content = next(n.value for n in ast.walk(scope) if isinstance(n, ast.Assign)
                       and any(isinstance(t, ast.Name) and t.id == content.id for t in n.targets))
    entry['userTemplate'], entry['itemTemplates'] = template(content), joins(content)
    helpers = {'app.score': [('src/ai/score.py', '_score_once'), ('src/ai/score_not_a_job.py', 'RECHECK'),
                            ('src/ai/score_search.py', 'block'), ('src/ai/locations.py', 'block'),
                            ('src/ai/hints.py', 'TEMPLATES'), ('src/ai/hints.py', 'text')],
               'app.enrich': [('src/ai/enrich.py', 'AGAIN')],
               'app.interview': [('src/ai/interviews_ai.py', 'analyse')], 'mail': [('src/ai/mail_read.py', 'listing')]}
    entry['itemTemplates'] += [dict(instructions=strings(node)) for source, name in helpers[entry['kind']]
                              for node in ast.parse(read(source)).body if getattr(node, 'name', None) == name
                              or isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets)]
    return entry


def prompt_templates(entries):
    """Extract literal framing at real sender boundaries; every interpolation is a named data slot."""
    specs = {'app.decide': ('src/ai/decide.py', 'SYSTEM'), 'app.place': ('src/ai/place_triage.py', 'SYSTEM'),
             'app.places': ('src/places.py', 'SYSTEM'), 'app.geo': ('src/geo.py', 'SYSTEM'),
             'app.title': ('src/ai/title_triage.py', 'SYSTEM'), 'app.visit': ('src/sources/visits.py', 'RELEVANT_SYSTEM'),
             'app.visa': ('src/ai/place_triage.py', 'VISA_SYSTEM'), 'app.placeVague': ('src/ai/place_triage.py', 'VAGUE_SYSTEM'),
             'app.placeReading': ('src/ai/place_triage.py', 'READ_SYSTEM')}
    mixed = {'app.score': ('src/ai/score.py', '_ask'), 'app.interview': ('src/ai/interviews_ai.py', 'analyse'),
             'app.enrich': ('src/ai/enrich.py', '_ask'), 'mail': ('src/ai/mail_read.py', 'classify')}
    def template(node):
        """Keep literal framing, replacing interpolation expressions with named slots."""
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.JoinedStr):
            return ''.join(template(part) for part in node.values)
        if isinstance(node, ast.IfExp):
            return '[' + template(node.body) + '|' + template(node.orelse) + ']'
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            return template(node.left) + template(node.right)
        return '{' + (node.id if isinstance(node, ast.Name) else 'data') + '}'
    def joins(node):
        """Include list separators and item framing without retaining fixture values."""
        return [dict(separator=template(call.func.value), item=template(call.args[0].elt)) for call in ast.walk(node)
                if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == 'join'
                and call.args and isinstance(call.args[0], ast.GeneratorExp)]
    result = []
    for entry in entries:
        if entry['kind'] in mixed:
            result.append(mixed_prompt_template(entry, mixed[entry['kind']], template, joins))
            continue
        if entry['kind'] not in specs:
            continue
        file, system = specs[entry['kind']]
        if entry.get('variant') == 'recheck':
            system = 'RECHECK_SYSTEM'
        tree = ast.parse(read(file))
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                 and node.func.attr == 'create' and any(kw.arg == 'system' and any(isinstance(n, ast.Name) and n.id == system
                     for n in ast.walk(kw.value)) for kw in node.keywords)]
        if len(calls) != 1:
            raise AssertionError(f'Uncaptured sender variants: {entry["kind"]}')
        scope = min((node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and calls[0] in list(ast.walk(node))), key=lambda node: len(list(ast.walk(node))))
        messages = next(kw.value for kw in calls[0].keywords if kw.arg == 'messages')
        content = next(value for key, value in zip(messages.elts[0].keys, messages.elts[0].values) if key.value == 'content')
        if isinstance(content, ast.Name):
            content = next(node.value for node in ast.walk(scope) if isinstance(node, ast.Assign)
                           and any(isinstance(t, ast.Name) and t.id == content.id for t in node.targets))
        entry['userTemplate'] = template(content)
        # Invariant: list item labels are instructions too; data expressions and batch order are never retained.
        entry['itemTemplates'] = [item for assignment in ast.walk(scope) if isinstance(assignment, ast.Assign)
                                 and any(isinstance(t, ast.Name) and t.id == 'listed' for t in assignment.targets)
                                 and any(isinstance(n, ast.Name) and n.id == 'listed' for n in ast.walk(content))
                                 for item in joins(assignment.value)] + joins(content)
        result.append(entry)
    return result


def main():
    """Write deterministic offline snapshots and their source fingerprints, never a live mode."""
    if len(sys.argv) > 1:
        if sys.argv[1] != '--prompts' or len(sys.argv) > 3:
            raise ValueError('Expected --prompts [root]')
        global ROOT
        if len(sys.argv) == 3:
            ROOT = Path(sys.argv[2]).resolve()
        print(json.dumps(prompt_templates(capture_engine(prompts=True)), ensure_ascii=False))
        return
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
