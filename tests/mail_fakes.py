"""Shared fakes for the Gmail-check tests (tests/test_mail*.py): tracker, Google, model client and the row/email builders.
Imported by test_mail*.py and by test_feedback, test_follow_up, test_inbox, test_opportunity, test_rejection."""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import mail
from src.notion import ledger
from src.stores import open_stores

_SCHEMA = json.loads((Path(__file__).resolve().parents[1] / 'config' / 'notion_schema.json').read_text())['databases']
SCHEMA_COLUMNS = {'apps': set(_SCHEMA['NOTION_APPLICATIONS_DB']['columns']), 'events': set(_SCHEMA['NOTION_EVENTS_DB']['columns'])}


def stores_for(tracker):
    """The Notion store over a fake tracker, as the Gmail check opens it: chosen explicitly, whatever the environment says."""
    return open_stores({**os.environ, 'JOBADABRA_STORE': 'notion'}, tracker=tracker)


def content(prop):
    """The text a written Notion property holds (its parts joined), whatever request shape wrote it."""
    return ''.join((part.get('text') or {}).get('content', part.get('plain_text', '')) for part in (prop or {}).get('rich_text') or [])


def record_of(row):
    """A fake Notion row as the job record the Notion store reads from it (its codec, no store needed)."""
    from src.stores import notion as notion_store
    return notion_store.Applications(None, 'db')._record(row)


def rec(stores, row):
    """A fake Notion row as the store's record (what the check's internals take)."""
    return stores.applications._record(row)


NOW = datetime(2026, 9, 26, 16, 0, tzinfo=timezone.utc)  # 18:00 in Zurich


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def app(page_id, company, job, stage='Applied', via='', contact='', applied='2026-09-26'):
    return {'id': page_id, 'url': f'https://notion.test/{page_id}', 'properties': {
        'Company': text(company), 'Job': {'type': 'title', 'title': [{'plain_text': job}]},
        'Stage': {'type': 'select', 'select': {'name': stage}}, 'Via': text(via), 'Contact': text(contact),
        'Applied on': {'type': 'date', 'date': {'start': applied}}, 'Next step': text(''),
        'Next interview': {'type': 'date', 'date': None}, 'Job URL': {'type': 'url', 'url': f'https://x.test/{page_id}'}}}


def event_row(page_id, kind, at, source_id=''):
    return {'id': f'ev-{kind}-{at}', 'properties': {
        'Kind': {'type': 'select', 'select': {'name': kind}}, 'At': {'type': 'date', 'date': {'start': at}},
        'Source ID': text(source_id), 'Application': {'type': 'relation', 'relation': [{'id': page_id}]}}}


def _stored(properties):
    """Properties as Notion returns them: every text part also has plain_text, each value its type."""
    out = {}
    for name, value in properties.items():
        value = dict(value)
        for kind in ('rich_text', 'title'):
            if kind in value:
                value[kind] = [{**part, 'plain_text': (part.get('text') or {}).get('content', part.get('plain_text', ''))}
                               for part in value[kind] or []]
        kind = next((k for k in value if k != 'type'), None)
        out[name] = {'type': value.get('type') or kind, **value}
    return out


def _matches_filter(page, filter_):
    """The few Notion filters the stores send: and/or, select/rich_text/url equals, relation contains."""
    if not filter_:
        return True
    if 'and' in filter_:
        return all(_matches_filter(page, part) for part in filter_['and'])
    if 'or' in filter_:
        return any(_matches_filter(page, part) for part in filter_['or'])
    prop = page['properties'].get(filter_['property']) or {}
    if 'relation' in filter_:
        if filter_['relation'].get('is_empty'):
            return not prop.get('relation')
        return any(link['id'].replace('-', '') == filter_['relation']['contains'].replace('-', '')
                   for link in prop.get('relation') or [])
    kind = next(k for k in filter_ if k != 'property')
    have = ledger.plain(prop) or ''
    return have == filter_[kind].get('equals')


# The Job Tracker's id as the store will name it: the suite's fake id (tests/test_0_notion_ids.py) when it is set.
APPS_DB = os.environ.get('NOTION_APPLICATIONS_DB') or 'apps'


class FakeTracker:
    """The Notion client the Gmail check holds: the stores' Notion adapter reads and writes through it (schema, pages,
    filtered queries), and every write is kept (created, updates) and applied to the rows a test holds."""
    database_id = APPS_DB
    # Columns a workspace lacks (an older one): writes to them are dropped, as the Notion store does.
    missing = ()

    def __init__(self, apps, events=()):
        self.apps, self.events, self.created, self.updates = apps, list(events), [], []
        self.blocks = {}  # parent id -> its child blocks (a page's sections, written by the store)

    def _children(self, block_id):
        return list(self.blocks.get(block_id, []))

    def written_under(self, page_id):
        """Everything written under a page, nested blocks included, as one JSON string (for assertIn)."""
        found = self._children(page_id)
        return json.dumps(found + [child for block in found for child in self._children(block['id'])], ensure_ascii=False)

    def _table(self, database_id):
        if database_id == ledger.EVENTS_DATABASE_ID:
            return self.events
        if database_id == 'interviews' or 'Interviews' in str(database_id):
            return []
        return self.apps if database_id == self.database_id else []

    def query_database(self, database_id, filter_=None):
        return [page for page in self._table(database_id) if _matches_filter(page, filter_)]

    def _request(self, method, path, body=None):
        kind, _, key = path.partition('/')
        if kind == 'blocks' and method == 'PATCH' and key.endswith('/children'):
            parent, siblings = key[:-len('/children')], None
            siblings = self.blocks.setdefault(parent, [])
            at = next((i + 1 for i, block in enumerate(siblings) if block['id'] == body.get('after')), len(siblings))
            made = [{**block, 'id': f'b{sum(map(len, self.blocks.values())) + n}'} for n, block in enumerate(body['children'], 1)]
            siblings[at:at] = made
            return {'results': made}
        if kind == 'blocks' and method == 'DELETE':
            for siblings in self.blocks.values():
                siblings[:] = [block for block in siblings if block['id'] != key]
            return {}
        if kind == 'databases':
            names = SCHEMA_COLUMNS['events' if key == ledger.EVENTS_DATABASE_ID else 'apps']
            return {'properties': {name: {} for name in names if name not in self.missing}}
        if kind == 'pages':
            for database_id, rows in ((self.database_id, self.apps), (ledger.EVENTS_DATABASE_ID, self.events)):
                for page in rows:
                    if page['id'] == key:
                        return {'parent': {'database_id': database_id}, **page}
            # A row a test's own create_page made without keeping it: a job of this workspace, as Notion would answer.
            return {'parent': {'database_id': self.database_id}, 'id': key, 'properties': {}}
        raise KeyError(path)

    def create_page(self, database_id, properties):
        self.created.append(properties)
        page = {'id': f'new-{len(self.created)}', 'url': f'https://notion.test/new-{len(self.created)}',
                'properties': _stored(properties)}
        if database_id == ledger.EVENTS_DATABASE_ID:
            self.events.append(page)
        elif database_id == self.database_id:
            self.apps.append(page)
        return page

    def update_page(self, page_id, properties):
        self.updates.append((page_id, properties))
        for page in self.apps + self.events:
            if page['id'] == page_id:
                page['properties'].update(_stored(properties))
                return page
        return {'id': page_id, 'properties': _stored(properties)}


class FakeGoogle:
    def __init__(self, emails=(), events=()):
        self.emails, self.cal, self.queries = {e['id']: e for e in emails}, list(events), []

    def search(self, query, limit=50):
        self.queries.append(query)
        return list(self.emails)

    def message(self, message_id):
        return self.emails[message_id]

    def events(self, start, end):
        return self.cal


class FakeClient:
    def __init__(self, results):
        self.results, self.calls, self.messages = results, [], self

    def create(self, **params):
        self.calls.append(params)
        answer = {'results': self.results.pop(0)}
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))],
                               usage=SimpleNamespace(input_tokens=3000, output_tokens=300, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))


def email(message_id, subject, date='2026-09-26T09:00:00+02:00', sender='no-reply@us.greenhouse-mail.io', body='Hello Sam ...'):
    return {'id': message_id, 'from': sender, 'to': 'me', 'subject': subject, 'date': date, 'body': body}


def result(index, application, kind, summary='s', relevant=True, interview_at='', company='Acme'):
    return {'index': index, 'relevant': relevant, 'application': application, 'company': company, 'kind': kind,
            'interview_at': interview_at, 'summary': summary}


class MailCase(unittest.TestCase):
    """setUp, tearDown and run_mail shared by the Gmail-check test classes."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / 'state.json'

    def tearDown(self):
        self.tmp.cleanup()

    def run_mail(self, tracker, google, results, calendar=False):
        sent = []
        with mock.patch('src.ai.mail_calendar.interview_stats', lambda s: {'topics_answered_weakly': {'Postgres': 2}}):
            summary = mail.run(tracker, google, client=FakeClient(results), days=2, send=sent.append, calendar=calendar,
                               now=NOW, state_path=self.state, stats={})
        return summary, sent
