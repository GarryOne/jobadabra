"""Shared fakes for the interview-insights tests (tests/test_interview_insights*.py): interview rows, review blocks, a Notion stand-in and a model client."""
from datetime import date, datetime, timezone
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import interview_insights as ii
from src.ai import insights, interviews


NOW = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def select(value):
    return {'type': 'select', 'select': {'name': value} if value else None}


def interview(page_id, round_, overall, date_, topics='', weak='', next_step='', app=None):
    props = {'Interview': {'type': 'title', 'title': [{'plain_text': f'Acme · {round_}'}]}, 'Round': text(round_),
             'Overall': select(overall), 'Topics': text(topics), 'Weak topics': text(weak), 'Next step': text(next_step),
             'Date': {'type': 'date', 'date': {'start': date_}},
             'Application': {'type': 'relation', 'relation': [{'id': app}] if app else []}}
    return {'id': page_id, 'url': f'https://notion.test/{page_id}', 'properties': props}


def block(kind, content):
    block.count = getattr(block, 'count', 0) + 1  # ids: the notion store finds the Transcript toggle and reads children by id
    return {'id': f'b-{block.count}', 'type': kind, kind: {'rich_text': [{'plain_text': content}]}}


def review_blocks(summary, strengths=(), weak=(), practice=(), questions=()):
    blocks = [block('paragraph', '🔗 Job: Acme · SRE'), block('paragraph', summary)]
    for title, items in (('Strengths', strengths), ('Weak spots', weak), ('Practise before the next round', practice)):
        if items:
            blocks += [block('heading_3', title)] + [block('bulleted_list_item', i) for i in items]
    blocks += [block('heading_3', 'Questions')] + [block('bulleted_list_item', q) for q in questions]
    blocks += [block('heading_3', 'Transcript'), block('paragraph', 'SECRET TRANSCRIPT TEXT')]
    return blocks


class FakeNotion:
    """🎤 Interviews rows with their pages, the 💡 Insights database, and Applications pages."""

    def __init__(self, rows, pages):
        self.rows, self.pages, self.insights, self.writes = rows, pages, [], []

    def query_database(self, database_id, filter_=None):
        if database_id == 'interviews-db':
            return self.rows
        if database_id == 'apps-db':  # the job every interview here belongs to
            return [{'id': 'app-1', 'properties': {'Company': text('Acme'), 'Job': {'type': 'title', 'title': [{'plain_text': 'SRE'}]},
                                                   'Job URL': {'type': 'url', 'url': 'https://x.test/acme'}}}]
        if database_id == 'insights-db':
            wanted = (filter_ or {}).get('select', {}).get('equals')
            return [r for r in self.insights if not wanted or r['properties']['Category']['select']['name'] == wanted]
        return []

    def _children(self, page_id):
        return self.pages.get(page_id, [])

    def _request(self, method, path, body=None):
        if method == 'GET':
            row = next((r for r in self.rows + self.insights if path == f"pages/{r['id']}"), None)
            return row or {'properties': {'Company': text('Acme'), 'Job': {'type': 'title', 'title': [{'plain_text': 'SRE'}]}}}
        self.writes.append((method, path, body))
        stored = {name: _as_read(value) for name, value in body['properties'].items()}
        if method == 'POST':
            row = {'id': f'ins-{len(self.insights) + 1}', 'url': 'https://notion.test/ins', 'properties': stored,
                   'last_edited_time': NOW.isoformat()}
            self.insights.append(row)
            return row
        row = next(r for r in self.insights if path == f"pages/{r['id']}")
        row['properties'].update(stored)
        return row


def _as_read(value):
    """A property as written -> as Notion returns it (enough for plain())."""
    for kind in ('title', 'rich_text'):
        if kind in value:
            return {'type': kind, kind: [{'plain_text': t['text']['content']} for t in value[kind]]}
    if 'select' in value:
        return {'type': 'select', 'select': value['select']}
    if 'number' in value:
        return {'type': 'number', 'number': value['number']}
    if 'date' in value:
        return {'type': 'date', 'date': value['date']}
    return value


class FakeClient:
    def __init__(self, result):
        self.result, self.calls = result, []
        self.messages = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(self.result))],
                               usage=SimpleNamespace(input_tokens=6000, output_tokens=1500, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))


ONE = [interview('iv-1', 'Technical 1', 'neutral', '2026-09-20', 'Kubernetes; Postgres', 'Postgres', 'System design next week', 'app-1')]
PAGES = {'iv-1': review_blocks('Solid on Kubernetes, vague on databases.', strengths=['Clear Kubernetes upgrade process'],
                               weak=['Postgres failover answer lacked RTO numbers'], practice=['Postgres HA with Patroni'],
                               questions=['⚠️ [Postgres] Explain failover — Vague', '✅ [Kubernetes] Upgrade? — Drain pools']),
         'iv-2': review_blocks('Good screen; salary question fumbled.', weak=['Postgres failover answer lacked RTO numbers again'],
                               practice=['Postgres HA with Patroni']),
         'iv-3': review_blocks('Recruiter liked the story.', strengths=['Motivation for SRE was clear'])}
RESULT = {'nothing_useful': False, 'headline': 'Database failover is your weak spot in technical rounds', 'confidence': 'high',
          'patterns': [{'round_type': 'Technical', 'pattern': 'Postgres failover answers lack numbers',
                        'evidence': [{'interview': 'I1', 'quote': 'Postgres failover answer lacked RTO numbers'},
                                     {'interview': 'I2', 'quote': 'Postgres failover answer lacked RTO numbers again'}]},
                       {'round_type': 'Technical', 'pattern': 'Invented pattern', 'evidence': [
                           {'interview': 'I1', 'quote': 'the interviewer hated your shoes'}, {'interview': 'I9', 'quote': 'Clear Kubernetes upgrade process'}]}],
          'next_steps': [{'action': 'Practise a Postgres failover story with RTO numbers', 'interviews': ['I1', 'I2']},
                         {'action': 'Something uncited', 'interviews': []}]}


def env():
    return mock.patch.multiple(interviews, INTERVIEWS_DATABASE_ID='interviews-db'), \
        mock.patch.dict(ii.os.environ, {'NOTION_INSIGHTS_DB': 'insights-db', 'NOTION_INTERVIEWS_DB': 'interviews-db', 'NOTION_APPLICATIONS_DB': 'apps-db',
                                        'JOBADABRA_STORE': 'notion'})


def of(fake):
    """The notion store over this fake Notion (call inside env(): it reads the database ids)."""
    from src.stores import notion
    return notion.open_store(ii.os.environ, tracker=fake)


def recs(fake, rows):
    """These interview rows as the store's records."""
    from src.stores.notion_interviews import NotionInterviews
    reader = NotionInterviews(fake, 'interviews-db')
    return [reader._record(row) for row in rows]
