"""The shared pool end to end, for the e2e suite `pool` (desktop/e2e/suites/pool.mjs): the real engine's sharing and ranking code against a
local stand-in of the website (contribute, install token, index), for a fictional photographer in Geneva. No AI, no Notion, no real network.

Prints one JSON line: {"checks": [{"name", "ok", "detail"}]}. Each check stands alone, so one failure never hides the others. Run it from the repo
root with `python3 tools/pool_e2e.py`; it makes its own data and config folders and never touches the user's."""
import json
import os
import shutil
import sys
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
WORK = Path(tempfile.mkdtemp(prefix='jp-pool-e2e-'))
GENERATED = '2026-10-07T04:50:00Z'
STAGES = {'https://jobs.example/1': 'Interviewing'}   # the user's Applications stage of the one job the check found
PRIVATE = ('photographe', 'Genève', 'retoucheur', 'Vendeur photo', 'https://jobs.example/')   # the search's own words and a job: never sent

# The website, as far as the pool goes: what was posted, and an index with one feed per case.
POSTS, INDEX_ASKS = [], []
INDEX = {'generated': GENERATED, 'feeds': [
    {'company': 'Studio Lumière', 'ats': 'lever', 'slug': 'studio-lumiere', 'places': ['Geneva, Switzerland'], 'kinds': {'creative_media': 0.8},
     'fits': {'roles': ['creative_media'], 'families': ['photography'], 'metros': ['ch-geneva']},
     'pool': {'installs': 6, 'matched': 5, 'applied': 4, 'interview': 2}},
    {'company': 'Quiet Gallery', 'ats': 'lever', 'slug': 'quiet-gallery', 'places': ['Geneva, Switzerland'], 'kinds': {'creative_media': 0.6},
     'fits': {'quiet': {'families': ['photography']}}},
    {'company': 'Netflix', 'ats': 'lever', 'slug': 'netflix', 'places': ['Geneva, Switzerland'], 'kinds': {'software': 0.95}},
    {'company': 'Manor', 'ats': 'lever', 'slug': 'manor', 'places': ['Geneva, Switzerland'], 'kinds': {'sales_retail': 0.5, 'creative_media': 0.2},
     'fits': {'countries': ['ch']}, 'pool': {'installs': 9, 'matched': 4, 'applied': 3, 'interview': 1}},
], 'nofeed': [], 'boards': [{'board': 'jooble', 'installs': 12, 'matched': 6, 'by': {'families': {'photography': [5, 4]}, 'roles': {'creative_media': [10, 5]}}}]}


class Site(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, status, body=None):
        self.send_response(status)
        if body is not None:
            data = json.dumps(body).encode()
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self.end_headers()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
        if self.path.startswith('/api/install-token'):
            return self._send(200, {'token': 'test-token'})
        POSTS.append(body)
        return self._send(200, {'ok': True})

    def do_GET(self):
        if self.path.startswith('/api/index'):
            INDEX_ASKS.append(dict(self.headers))
            if self.headers.get('X-Index-Generated') == GENERATED:
                return self._send(304)
            return self._send(200, INDEX)
        return self._send(404, {'ok': False})


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Site)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    (WORK / 'config').mkdir()
    search = json.loads((REPO / 'config' / 'search.json').read_text())
    search.update({'role_keywords': ['photographe', 'photographer', 'retoucheur'], 'title_exclude_keywords': [],
                   'locations': {'top_tier': ['Genève', 'Lausanne'], 'country_wide': ['Suisse'], 'abroad': []}})
    (WORK / 'config' / 'search.json').write_text(json.dumps(search))
    for name in ('preferences.json', 'scout_seeds.json', 'sources.json'):
        shutil.copy(REPO / 'config' / name, WORK / 'config' / name)
    os.environ.update({'JOBADABRA_DATA_DIR': str(WORK / 'data'), 'JOBADABRA_CONFIG_DIR': str(WORK / 'config'), 'JOBADABRA_FOLLOW_APP': '0',
                       'JOBADABRA_SHARE_EMPLOYERS': '1', 'JOBADABRA_INSTALL_ID': 'e2e-pool-0001', 'JOBADABRA_CONTRIBUTE_URL': f'{base}/api/contribute',
                       'JOBADABRA_INDEX_URL': f'{base}/api/index', 'JOBADABRA_DISABLE': 'mail,notion,telegram,google_jobs'})
    os.environ.pop('JOBADABRA_LOCATIONS_FILE', None)
    sys.path.insert(0, str(REPO))
    from src import contribute, coverage, employer_index, role_kinds, scout, store
    from src.sources import feeds
    # The model's answers for this fictional search (src/ai/decide.py decides labels in any language): no model is called.
    from src.ai import decide
    answers = {'pool-country': {'genève': 'ch', 'lausanne': 'ch', 'suisse': 'ch'}, 'pool-metro': {'genève': 'ch-geneva', 'lausanne': 'ch-lausanne'},
               'pool-family': {'photographe': 'photography', 'photographer': 'photography', 'retoucheur': 'photography'},
               'pool-region': {'genève': 'europe', 'lausanne': 'europe', 'suisse': 'europe'}, 'job-region': {'geneva, switzerland': 'europe'}}
    from src.ai import meanings_pack   # as decide() does: the stand-in after the meanings pack, unknown left out
    decide.decide = lambda topic, items, *a, **k: {key: answer for key, text in items.items()
                                                   if (answer := answers.get(topic, {}).get(key) or meanings_pack.first(topic, text))}

    checks = []

    def check(name, test):
        try:
            detail = test()
            checks.append({'name': name, 'ok': True, 'detail': detail or ''})
        except Exception as error:  # noqa: BLE001 — reported as this check's failure
            checks.append({'name': name, 'ok': False, 'detail': f'{type(error).__name__}: {error}'})

    def private_words(body):
        # The posting addresses of the daily discovery batch (`candidates`, owner 17 Oct 2026: address, host and source only; tests/test_contribute_candidates.py) are the one place an address may leave.
        text = json.dumps([{k: v for k, v in part.items() if k != 'candidates'} for part in (body if isinstance(body, list) else [body])], ensure_ascii=False)
        return [word for word in PRIVATE if word in text]

    (WORK / 'data').mkdir()
    db = store.connect(WORK / 'data' / 'jobs.sqlite')
    seeds = {'excluded': [], 'tier1_known': [], 'tier1': [], 'manual_watch': [], 'regional': {}, 'tech_only': False}
    names = [dict(name='Atelier Photo SA', origin='AI idea 2026-10-07', priority=92, ats='lever', slug='atelier-photo'),
             dict(name='Nowhere Studio', origin='AI idea 2026-10-07', priority=91, website='https://nowhere-studio.example')]
    jobs = [{'title': 'Photographe de studio', 'location': 'Genève', 'url': 'https://jobs.example/1', 'description': ''}] * 3

    def scout_shares():
        before = len(POSTS)
        from unittest import mock
        with mock.patch.object(scout.careers, 'discover', lambda url: None), \
                mock.patch.object(scout, 'quality', lambda found: (80, {'preferred': 2, 'relevant': 3, 'jobs': len(found)})):
            scout.run(db, 5, None, seeds, lambda system, slug: jobs if slug == 'atelier-photo' else None, harvest_sources=[lambda: names])
        sent = POSTS[before:]
        finds = [feed for body in sent for feed in body.get('feeds') or []]
        dead = [item for body in sent for item in body.get('nofeed') or []]
        if [f['slug'] for f in finds] != ['atelier-photo'] or [d['company'] for d in dead] != ['Nowhere Studio']:
            raise AssertionError(f'sent finds {[f["slug"] for f in finds]} and dead ends {[d["company"] for d in dead]}, one of each expected')
        body = sent[0]
        wanted = {'countries': ['ch'], 'metros': ['ch-geneva', 'ch-lausanne'], 'families': ['photography']}
        got = {key: body.get(key) for key in wanted}
        if got != wanted or 'creative_media' not in body.get('roles', []):
            raise AssertionError(f'labels {got}, roles {body.get("roles")}')
        if private_words(sent):
            raise AssertionError(f'the search\'s own words left the machine: {private_words(sent)}')
        return f'{len(sent)} one-item shares, labels {got}'
    check('Find new employers sends each verified employer and each dead end at once, with fixed labels only', scout_shares)

    report = {'sources': [{'company': 'Atelier Photo SA', 'ok': True, 'total': 3, 'matches': 3}, {'company': 'Quiet Gallery', 'ok': True, 'total': 8, 'matches': 0},
                          {'company': 'jobs.ch', 'ok': True, 'total': 120, 'matches': 4}, {'company': 'Google Jobs: photographe / Genève', 'ok': True, 'total': 10, 'matches': 1}],
              'jobs': [{'source': 'jobs.ch', 'company': 'Atelier Photo SA', 'title': 'Vendeur photo'}]}
    feed_list = [{'ats': 'lever', 'slug': 'atelier-photo', 'company': 'Atelier Photo SA'}, {'ats': 'lever', 'slug': 'quiet-gallery', 'company': 'Quiet Gallery'}]

    def check_share():
        # What the jobs check led to (scored, then an interview), so the share carries outcomes and traits too.
        now = datetime.now(timezone.utc).isoformat(timespec='seconds')
        db.execute('CREATE TABLE IF NOT EXISTS scores (job_id INTEGER PRIMARY KEY, scorer_version INTEGER, input_hash TEXT, model TEXT, created_at TEXT, data_json TEXT)')
        db.execute('CREATE TABLE IF NOT EXISTS enrichments (job_id INTEGER PRIMARY KEY, extractor_version INTEGER, description_hash TEXT, model TEXT, created_at TEXT, data_json TEXT)')
        db.execute("INSERT OR IGNORE INTO companies (id, name, updated_at) VALUES (900, 'Atelier Photo SA', ?)", (now,))
        db.execute("INSERT OR IGNORE INTO sources (id, name, kind) VALUES (900, 'Atelier Photo SA', 'employer feed')")
        db.execute("INSERT INTO jobs (id, canonical_key, source_id, company_id, title, url, first_seen_at, last_seen_at) VALUES (900, 'k900', 900, 900, 'Photographe', 'https://jobs.example/1', ?, ?)", (now, now))
        db.execute('INSERT INTO scores (job_id, data_json) VALUES (900, ?)', (json.dumps({'score': 82}),))
        db.execute('INSERT INTO enrichments (job_id, data_json) VALUES (900, ?)', (json.dumps({'languages': [{'language': 'French', 'level': 'required'}], 'seniority': {'value': 'mid'}, 'work_mode': {'value': 'onsite'}}),))
        db.commit()
        before = len(POSTS)
        if not contribute.maybe_send(feed_list, report, None, db=db, stages=STAGES):
            raise AssertionError('the end-of-check share was not sent')
        body = POSTS[before]
        quiet = next((f for f in body['feeds'] if f['slug'] == 'quiet-gallery'), None)
        if not quiet or quiet.get('hits') != 0 or quiet.get('jobs') != 8:
            raise AssertionError(f'the feed read with no match: {quiet}')
        boards = {b['board']: b for b in body.get('boards') or []}
        if set(boards) != {'jobsch', 'google_jobs'} or boards['jobsch'].get('dup') != 1:
            raise AssertionError(f'boards {boards}')
        atelier = next((f for f in body['feeds'] if f['slug'] == 'atelier-photo'), {})
        if (atelier.get('out') or {}).get('interview') != 1 or (atelier.get('out') or {}).get('langs') != {'French': 1}:
            raise AssertionError(f"outcomes of the employer that led to an interview: {atelier.get('out')}")
        if private_words(body):
            raise AssertionError(f'the search\'s own words left the machine: {private_words(body)}')
        return f"{len(body['feeds'])} feeds, boards {sorted(boards)}, jobs.ch dup {boards['jobsch']['dup']}"
    check('Search for jobs sends every feed it read (also with no match) and each board by fixed id, with counts only', check_share)

    def only_changed():
        before = len(POSTS)
        sent = contribute.maybe_send(feed_list, report, None, db=db, stages=STAGES)
        if sent or len(POSTS) != before:
            raise AssertionError('an unchanged check was sent again')
        changed = {**report, 'sources': [*report['sources'][:1], {'company': 'Quiet Gallery', 'ok': True, 'total': 8, 'matches': 2}, *report['sources'][2:]]}
        if not contribute.maybe_send(feed_list, changed, None, db=db, stages=STAGES):
            raise AssertionError('a changed feed was not sent')
        slugs = [f['slug'] for f in POSTS[-1]['feeds']]
        if slugs != ['quiet-gallery']:
            raise AssertionError(f'sent {slugs}, only the changed feed expected')
        return 'unchanged: nothing; one feed changed: only it'
    check('A second check sends only what changed', only_changed)

    def opt_out():
        before = len(POSTS)
        os.environ['JOBADABRA_SHARE_EMPLOYERS'] = '0'
        try:
            contribute.share_now(feed={'ats': 'lever', 'slug': 'x', 'company': 'X'})
            contribute.maybe_send(feed_list, {**report, 'sources': []}, None, db=db)
        finally:
            os.environ['JOBADABRA_SHARE_EMPLOYERS'] = '1'
        if len(POSTS) != before:
            raise AssertionError(f'{len(POSTS) - before} shares sent with the switch off')
    check('With "Help the pool grow" off, nothing is sent', opt_out)

    me = employer_index.me_now()
    index_now = datetime.now(timezone.utc)

    def index_for_you():
        index = employer_index.load(now=index_now)
        if len(index) != 4:
            raise AssertionError(f'{len(index)} feeds downloaded, 4 expected')
        said = []
        shadow = sorted(f['company'] for f in employer_index.relevant(index, feeds.wanted_location, role_kinds.of_search(search), me=me, today='2026-10-08', said=said))
        if shadow != ['Manor', 'Quiet Gallery', 'Studio Lumière'] or said != [('Quiet Gallery', 'photography', 'shadow')]:
            raise AssertionError(f'shadow mode: crawls {shadow}, said {said}: Netflix (software) out, Quiet Gallery still read but named')
        kept = employer_index.relevant(index, feeds.wanted_location, role_kinds.of_search(search), me=me, today=employer_index.QUIET_FROM)
        names = sorted(f['company'] for f in kept)
        if names != ['Manor', 'Studio Lumière']:
            raise AssertionError(f'from {employer_index.QUIET_FROM} a photographer in Geneva crawls {names}: Quiet Gallery (no photographer ever found a job) must be left out')
        protected = employer_index.relevant(index, feeds.wanted_location, role_kinds.of_search(search), me=me, today=employer_index.QUIET_FROM, keep={'Quiet Gallery'})
        if 'Quiet Gallery' not in [f['company'] for f in protected]:
            raise AssertionError('an employer where the user already has a scored job was left out')
        ranked = [item['company'] for item in employer_index.for_you(index, me)]
        if ranked[:1] != ['Studio Lumière']:
            raise AssertionError(f'for you: {ranked}')
        return f'shadow: named {said[0][0]}; from {employer_index.QUIET_FROM}: crawled {names}; for you {ranked}'
    check('The central list: software left out; a feed quiet for photographers named in shadow mode, left out after it, never when the user matched it; employers for you ranked', index_for_you)

    def board_rate():
        text = coverage.people_like_you('aggregators', me)
        if text != 'gave a match to 8 in 10 people like you':
            raise AssertionError(f'said "{text}"')
        return text
    check('A job source suggestion says what it gave people like you (by the most specific label)', board_rate)

    def hourly():
        asked = len(INDEX_ASKS)
        employer_index.load(now=index_now + timedelta(minutes=20))
        if len(INDEX_ASKS) != asked:
            raise AssertionError('asked again within the hour')
        kept = employer_index.load(now=index_now + timedelta(minutes=70))
        if len(INDEX_ASKS) != asked + 1 or INDEX_ASKS[-1].get('X-Index-Generated') != GENERATED:
            raise AssertionError(f'the hourly check did not ask "still this publish?": {INDEX_ASKS[-1:]}')
        if len(kept) != 4:
            raise AssertionError('the 304 lost the cached list')
        return '20 min: cache; 70 min: one 304'
    check('The central list is checked about hourly, by its publish time, and kept on 304', hourly)

    if os.getenv('POOL_PAYLOADS_OUT'):   # the bodies the engine really sent: the site's contract test posts exactly these (test/pool-contract.test.js)
        Path(os.environ['POOL_PAYLOADS_OUT']).write_text(json.dumps(POSTS, indent=1, ensure_ascii=False, sort_keys=True) + '\n')
    server.shutdown()
    shutil.rmtree(WORK, ignore_errors=True)
    print(json.dumps({'checks': checks}))
    return 0 if all(c['ok'] for c in checks) else 1


if __name__ == '__main__':
    raise SystemExit(main())
