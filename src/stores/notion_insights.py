"""💡 Insights in Notion as the store's insights (base.Insights): one database row per insight, plain dicts out.

Its columns beyond the title, date and category are the record's `fields` (EXTRAS); the body is the page's blocks,
written from Markdown through notion_blocks (a listing reads the rows only, never the bodies: one call per row). A column
an older workspace lacks yet is dropped from that write, never the row (without_missing, as the engine did). Used by
src/stores/notion.py. Guarded by tests/test_store_notion_insights.py.
"""
import os

from . import base
from .notion_columns import without_missing
from . import notion_blocks
from . import notion_rows

# fields key → (Notion column, kind)
EXTRAS = {'basis': ('Basis', 'select'), 'confidence': ('Confidence', 'select'), 'sample_size': ('Sample size', 'number'),
          'evidence': ('Evidence', 'rich_text'), 'action': ('Action', 'rich_text'), 'feedback': ('Feedback', 'select'),
          'issue_detected': ('Issue detected', 'checkbox'), 'cost': ('Cost (USD)', 'number'), 'model': ('Model', 'rich_text'),
          'input_hash': ('Input hash', 'rich_text'), 'data': ('Data', 'rich_text'), 'state': ('State', 'select'),
          'hidden_until': ('Hidden until', 'date')}
assert set(EXTRAS) == set(base.INSIGHT_EXTRAS), 'every insight extra has its column'
MAIN = (('title', 'Insight', 'title'), ('day', 'Date', 'date'), ('category', 'Category', 'select'))
EMPTY = ('', None, False)


class NotionInsights:
    def __init__(self, tracker, database_id=None):
        self.tracker = tracker
        self.database_id = database_id if database_id is not None else os.getenv('NOTION_INSIGHTS_DB', '')

    def _record(self, page, body=''):
        props = page.get('properties') or {}
        fields = {key: notion_rows.read(props.get(col), kind) for key, (col, kind) in EXTRAS.items()}
        row = notion_rows.to_record(page, MAIN, base.INSIGHT_FIELDS)
        return {**row, 'day': row['day'][:10], 'body': body, 'fields': {k: v for k, v in fields.items() if v not in EMPTY}}

    def _properties(self, values):
        unknown = set(values) - set(base.INSIGHT_FIELDS)
        if unknown:
            raise KeyError(f'not a field: {", ".join(sorted(unknown))}')
        base.insight_values(values)
        props = notion_rows.to_properties(values, MAIN)
        for key, raw in (values.get('fields') or {}).items():
            props[EXTRAS[key][0]] = notion_rows.write(raw, EXTRAS[key][1])
        return props

    def _rows(self):
        return [r for r in self.tracker.query_database(self.database_id) if not r.get('archived') and not r.get('in_trash')]

    def list(self, since=None, category=None, limit=None):
        found = [self._record(r) for r in self._rows()]
        found = sorted((r for r in found if (since is None or r['day'] >= since) and (category is None or r['category'] == category)),
                       key=lambda r: (r['day'], r['created_at']), reverse=True)
        return found[:limit] if limit else found

    def add(self, record):
        values = {k: v for k, v in record.items() if k not in ('id', 'created_at')}
        props = self._properties(values)
        body = notion_blocks.to_blocks(values.get('body') or '')
        page = without_missing(lambda p: self.tracker._request('POST', 'pages', {
            'parent': {'database_id': self.database_id}, 'properties': p, 'children': body[:100]}), props)
        if len(body) > 100:
            self.tracker.append_blocks(page['id'], body[100:])
        return self._record(page, values.get('body') or '')

    def update(self, insight_id, fields):
        values = {k: v for k, v in fields.items() if k not in ('id', 'created_at')}
        props = self._properties(values)
        try:
            page = self.tracker._request('GET', f'pages/{insight_id}')
        except Exception as error:  # noqa: BLE001 - a deleted or unknown page
            raise KeyError(insight_id) from error
        if not page or page.get('archived') or page.get('in_trash'):
            raise KeyError(insight_id)
        if props:
            page = without_missing(lambda p: self.tracker._request('PATCH', f'pages/{insight_id}', {'properties': p}), props) or page
        if 'body' in values:
            for block in self.tracker._children(insight_id):
                self.tracker._request('DELETE', f"blocks/{block['id']}")
            if values['body']:
                self.tracker.append_blocks(insight_id, notion_blocks.to_blocks(values['body']))
        return self._record(page, values.get('body', ''))

    def save(self, day, category, title, body, fields=None):
        values = {'day': day, 'category': category, 'title': title, 'body': body, 'fields': dict(fields or {})}
        same = [r for r in self.list(category=category) if r['day'] == day]
        return self.update(same[0]['id'], values) if same else self.add(values)

    def put(self, record):
        """A record copied from another store (Notion sets its own created time)."""
        return self.add(record)
