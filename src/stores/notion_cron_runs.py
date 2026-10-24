"""The notion store's CronRuns: ⏱️ Search runs rows as store records, the one run history wherever a run happened.

A row's columns hold the run's state and numbers (base.RUN_STATS ↔ New jobs, Scored, AI cost (USD)…); its page holds
what the desktop app reads today (desktop/lib/store/notion-runs.js): the report as bullets, a "Result" heading with the
message, and a "Technical log" toggle of code blocks. A row written before the stores has no Kind, Where, Progress or
Finished: kind is then its Mode, where comes from its Run URL and Trigger. `list()` reads columns only (report, result
and log come with `get()`). Guarded by tests/test_store_notion.py (the store contract on the Notion stand-in).
"""
from datetime import datetime, timezone
import json
import re

from ..notion.cron_report import _para, _result_paras
from . import base
from . import notion_blocks
from . import notion_rows as rows
from .notion_columns import KnownColumns

COLUMNS = (('kind', 'Kind', 'select'), ('where', 'Where', 'select'), ('status', 'Status', 'select'),
           ('started_at', 'Started', 'date'), ('finished_at', 'Finished', 'date'), ('summary', 'Summary', 'rich_text'),
           ('trigger', 'Trigger', 'select'), ('mode', 'Mode', 'select'), ('run_url', 'Run URL', 'url'),
           ('application', 'Application', 'relation1'), ('title', 'Run', 'title'), ('log_id', 'Run id', 'rich_text'))
STATS = {'new_jobs': ('New jobs', 'number'), 'changed_jobs': ('Changed jobs', 'number'), 'scored': ('Scored', 'number'),
         'kits': ('Kits', 'number'), 'emails': ('Emails', 'number'), 'updates': ('Updates', 'number'),
         'closed_stale': ('Closed stale', 'number'), 'feeds': ('Feeds', 'number'), 'feed_errors': ('Feed errors', 'number'),
         'top_new_score': ('Top new score', 'number'), 'duration_s': ('Duration (s)', 'number'),
         'ai_cost_usd': ('AI cost (USD)', 'number'), 'tokens_total': ('Tokens (total)', 'number'),
         'billed_to': ('Billed to', 'select'), 'telegram': ('Telegram', 'rich_text')}
PROGRESS_LINES = 40     # the last lines kept in the Progress column
LOG_CHUNK = 25          # log lines per code block, as src/notion/cron_report.py writes them
RESULT = 'Result'
LOG = 'Technical log'
DETAILS = 'Run details'   # a toggle of code blocks holding the details JSON (src/run_details.py)


def _now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _text(content, kind='paragraph'):
    return [{'object': 'block', 'type': kind, kind: {'rich_text': part}} for part in
            [rows.write(content, 'rich_text')['rich_text']]]


SECTIONS = re.compile(r'^#{1,3} ', re.M)


def _body(report='', result='', log='', details=None):
    """The page blocks of a finished run, in today's shapes: the report (Markdown with its sections, "### Report",
    "### Emails read", "### Stages", rendered by notion_blocks; or bare "- line" bullets), "Result" with the message (one
    paragraph a line, the end merged past RESULT_PARAS as src/notion/cron_report.py writes it), the Technical log toggle."""
    blocks = []
    if SECTIONS.search(report or ''):
        blocks += notion_blocks.to_blocks(report)
    else:
        for line in (report or '').split('\n'):
            if line.strip():
                blocks += _text(line[2:] if line.startswith('- ') else line, 'bulleted_list_item')
    if (result or '').strip():
        blocks.append(_para(RESULT, 'heading_3'))
        blocks += _result_paras([line for line in result.split('\n') if line.strip()])
    lines = (log or '').split('\n') if (log or '').strip() else []
    if lines:
        chunks = ['\n'.join(lines[i:i + LOG_CHUNK]) for i in range(0, len(lines), LOG_CHUNK)]
        blocks.append({'object': 'block', 'type': 'toggle', 'toggle': {
            'rich_text': rows.write(f'{LOG} (last {len(lines)} lines)', 'rich_text')['rich_text'],
            'children': [{'object': 'block', 'type': 'code', 'code': {
                'language': 'plain text', 'rich_text': rows.write(chunk, 'rich_text')['rich_text']}} for chunk in chunks]}})
    if details:
        text = json.dumps(details, ensure_ascii=False, separators=(',', ':'))
        blocks.append({'object': 'block', 'type': 'toggle', 'toggle': {
            'rich_text': rows.write(DETAILS, 'rich_text')['rich_text'],
            'children': [{'object': 'block', 'type': 'code', 'code': {
                'language': 'json', 'rich_text': rows.write(text[i:i + 1900], 'rich_text')['rich_text']}} for i in range(0, len(text), 1900)]}})
    return blocks


class NotionCronRuns:
    fields = base.CRON_RUN_FIELDS

    def __init__(self, tracker, database_id):
        self.tracker, self.database_id = tracker, database_id
        self._known = KnownColumns(tracker, database_id)

    def _writable(self, props):
        """Only the columns this workspace has: an older one (before the app repaired its schema) lacks Kind, Where, Progress,
        Finished…, and Notion would refuse the whole row."""
        return self._known.writable(props)

    def _record(self, page, body=None):
        props = page.get('properties') or {}
        found = rows.to_record(page, COLUMNS, [f for f in self.fields if f not in ('progress', 'stats')])
        found['kind'] = found['kind'] or found['mode']
        found['where'] = found['where'] or ('github' if found['run_url'] else 'mac' if found['trigger'].startswith('Mac') else '')
        progress = rows.read(props.get('Progress'), 'rich_text')
        stats = {key: rows.read(props.get(column), kind) for key, (column, kind) in STATS.items()}
        record = {**found, 'progress': progress.split('\n') if progress else [],
                  'stats': {key: value for key, value in stats.items() if value not in (None, '')}}
        return {**base.record(self.fields, record), **(body or {})}

    def _properties(self, values, stats=None):
        props = rows.to_properties(values, COLUMNS)
        if 'progress' in values:
            props['Progress'] = rows.write('\n'.join((values['progress'] or [])[-PROGRESS_LINES:]), 'rich_text')
        unknown = set(stats or {}) - set(STATS)
        if unknown:
            raise KeyError(f'not a run number: {", ".join(sorted(unknown))}')
        for key, value in (stats or {}).items():
            column, kind = STATS[key]
            props[column] = rows.write(value, kind)
        return props

    def _title(self, kind, started, summary=''):
        when = (started or _now())[:16].replace('T', ' ')
        return {'Run': rows.write(' · '.join(part for part in (when, kind, summary) if part)[:200], 'title')}

    def _body_of(self, run_id):
        blocks = [block for block in self.tracker._children(run_id) if not block.get('archived')]
        at = next((i for i, b in enumerate(blocks) if b['type'] == 'heading_3'
                   and rows.plain_text(b['heading_3']['rich_text']) == RESULT), None)
        head = [b for b in (blocks if at is None else blocks[:at]) if b['type'] != 'toggle']
        if any(b['type'].startswith('heading_') for b in head):  # a report with its sections: as Markdown
            report_md = notion_blocks.to_markdown(head, self.tracker._children)
        else:
            report_md = '\n'.join(f"- {rows.plain_text(b['bulleted_list_item']['rich_text'])}" for b in head
                                  if b['type'] == 'bulleted_list_item')
        result = [] if at is None else [rows.plain_text(b['paragraph']['rich_text']) for b in blocks[at + 1:] if b['type'] == 'paragraph']
        toggle = next((b for b in blocks if b['type'] == 'toggle' and rows.plain_text(b['toggle']['rich_text']).startswith(LOG)), None)
        saved = next((b for b in blocks if b['type'] == 'toggle' and rows.plain_text(b['toggle']['rich_text']) == DETAILS), None)
        log = [] if not toggle else [rows.plain_text(code['code']['rich_text']) for code in self.tracker._children(toggle['id'])
                                     if code['type'] == 'code']
        try:
            details = json.loads(''.join(rows.plain_text(code['code']['rich_text']) for code in self.tracker._children(saved['id'])
                                         if code['type'] == 'code')) if saved else ''
        except ValueError:
            details = ''
        return {'report': report_md, 'result': '\n'.join(result), 'log': '\n'.join(log), 'details': details}

    def _page(self, run_id):
        try:
            page = self.tracker._request('GET', f'pages/{run_id}')
        except Exception as error:  # noqa: BLE001 (a missing or foreign id: Notion answers 400/404)
            raise KeyError(run_id) from error
        if page.get('archived'):
            raise KeyError(run_id)
        return page

    def begin(self, kind, where, fields=None):
        fields = dict(fields or {})
        unknown = set(fields) - {'trigger', 'mode', 'run_url', 'application', 'title', 'log_id'}
        if unknown:
            raise KeyError(f'not a field: {", ".join(sorted(unknown))}')
        values = {'kind': kind, 'where': where, 'status': 'Running', 'started_at': _now(), 'progress': [], **fields}
        props = {**self._title(kind, values['started_at']), **self._properties(values)}  # the engine's title, when given
        return self._record(self.tracker.create_page(self.database_id, self._writable(props)))

    def progress(self, run_id, line):
        record = self._record(self._page(run_id))
        props = self._properties({'progress': [*record['progress'], line]})
        if record['status'] == 'Running':  # the app's ⏳ line while it runs (docs/rules/facts-and-layout.md: Summary is the report's first line)
            props['Summary'] = rows.write(f'⏳ {line}', 'rich_text')
        self.tracker.update_page(run_id, self._writable(props))

    def touch(self, run_id, stats=None):
        self._page(run_id)
        props = self._properties({}, stats)
        if props:
            self.tracker.update_page(run_id, self._writable(props))

    def finish(self, run_id, status, summary='', report='', result='', log='', stats=None, title='', details=None):
        record = self._record(self._page(run_id))
        props = {**self._properties({'status': status, 'summary': summary, 'finished_at': _now()}, stats),
                 **(self._properties({'title': title}) if title else self._title(record['kind'], record['started_at'], summary))}
        page = self.tracker.update_page(run_id, self._writable(props))
        blocks = _body(report, result, log, details)
        for start in range(0, len(blocks), 100):
            self.tracker.append_blocks(run_id, blocks[start:start + 100])
        return self._record(page, {'report': report, 'result': result, 'log': log, 'details': details or ''})

    def get(self, run_id):
        try:
            page = self._page(run_id)
        except KeyError:
            return None
        return self._record(page, self._body_of(run_id))

    def list(self, since=None, kind=None):
        parts = [part for part in (
            since is not None and {'property': 'Started', 'date': {'on_or_after': since}},
            kind is not None and {'or': [{'property': 'Kind', 'select': {'equals': kind}},
                                         {'and': [{'property': 'Kind', 'select': {'is_empty': True}},
                                                  {'property': 'Mode', 'select': {'equals': kind}}]}]}) if part]
        filter_ = {'and': parts} if len(parts) > 1 else (parts[0] if parts else None)
        pages = [page for page in self.tracker.query_database(self.database_id, filter_) if not page.get('archived')]
        return sorted((self._record(page) for page in pages), key=lambda run: run['started_at'], reverse=True)

    def put(self, record):
        values = dict(record)
        unknown = set(values) - set(self.fields)
        if unknown:
            raise KeyError(f'not a field: {", ".join(sorted(unknown))}')
        body = {key: values.pop(key, '') or '' for key in ('report', 'result', 'log')}
        details = values.pop('details', None)
        values.pop('id', None)
        stats = values.pop('stats', None) or {}
        values['started_at'] = values.get('started_at') or _now()
        props = {**self._title(values.get('kind', ''), values['started_at'], values.get('summary', '')),
                 **self._properties(values, stats)}  # the engine's title, when given
        page = self.tracker.create_page(self.database_id, self._writable(props))
        blocks = _body(**body, details=details)
        for start in range(0, len(blocks), 100):
            self.tracker.append_blocks(page['id'], blocks[start:start + 100])
        return self._record(page, body)
