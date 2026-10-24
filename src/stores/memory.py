"""The in-memory store: the reference adapter (what the contract means, in the fewest lines) and a fake for tests.

Nothing is kept after the process ends. Guarded by tests/test_store_memory.py (the contract suite).
"""
import itertools
from datetime import datetime, timezone

from . import base, matches_sync

_ids = itertools.count(1)


def _now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _new(fields, values):
    return base.record(fields, {**values, 'id': f'm{next(_ids)}', 'created_at': _now()})


def _known(fields, values):
    unknown = set(values) - set(fields)
    if unknown:
        raise KeyError(f'not a field: {", ".join(sorted(unknown))}')
    return values


def _stats(stats):
    unknown = set(stats or {}) - set(base.RUN_STATS)
    if unknown:
        raise KeyError(f'not a run stat: {", ".join(sorted(unknown))}')
    return dict(stats or {})


class _Table:
    fields = ()

    def __init__(self):
        self.rows = {}

    def _get(self, row_id):
        if row_id not in self.rows:
            raise KeyError(row_id)
        return self.rows[row_id]

    def put(self, record):
        values = _known(self.fields, dict(record))
        row = base.record(self.fields, {**values, 'id': f'm{next(_ids)}', 'created_at': values.get('created_at') or _now()})
        self.rows[row['id']] = row
        return dict(row)

    def _update(self, row_id, fields):
        row = self._get(row_id)
        row.update(_known(self.fields, {k: v for k, v in fields.items() if k not in ('id', 'created_at')}))
        return dict(row)


class Applications(_Table):
    fields = base.APPLICATION_FIELDS

    def update(self, app_id, fields):
        return self._update(app_id, fields)

    def _update(self, row_id, fields):  # every change stamps updated_at; a caller's own value is ignored
        return super()._update(row_id, {**{k: v for k, v in fields.items() if k != 'updated_at'}, 'updated_at': _now()})

    def __init__(self):
        super().__init__()
        self.sections_by_key, self.files_by_key = {}, {}

    def list(self, stages=None):
        return [dict(r) for r in self.rows.values() if stages is None or r['stage'] in stages]

    def stages(self):
        return {base.url_key(r['url']): r['stage'] for r in self.rows.values()}

    def set_stage(self, job, stage, today=None):
        found = self.get(job.get('url'))
        if found and found['stage'] == stage:
            return found, base.UNCHANGED
        stamp = {'applied_on': today or base.local_today()} if stage == 'Applied' and not (found or {}).get('applied_on') else {}
        if found:
            return self._update(found['id'], {'stage': stage, **stamp}), base.CHANGED
        return self.create({**job, **stamp}, stage), base.CREATED

    def get(self, url):
        key = base.url_key(url)
        return next((dict(r) for r in self.rows.values() if base.url_key(r['url']) == key), None)

    def by_id(self, app_id):
        row = self.rows.get(app_id)
        return dict(row) if row else None

    def create(self, job, stage):
        found = self.get(job.get('url'))
        if found:
            return self._update(found['id'], {'stage': stage})
        row = _new(self.fields, {**_known(self.fields, job), 'stage': stage, 'updated_at': _now()})
        self.rows[row['id']] = row
        return dict(row)

    def delete(self, app_id):
        self.rows.pop(app_id, None)
        for store in (self.sections_by_key, self.files_by_key):
            for key in [k for k in store if k[0] == app_id]:
                del store[key]

    def section(self, app_id, name):
        return self.sections_by_key.get((app_id, name))

    def set_section(self, app_id, name, markdown):
        self._get(app_id)
        self.sections_by_key[(app_id, name)] = markdown

    def attach(self, app_id, name, data, content_type):
        self._get(app_id)
        self.files_by_key[(app_id, name)] = (bytes(data), content_type)
        return f'memory:{app_id}/{name}'

    def sections(self, app_id):
        return {name: md for (row_id, name), md in self.sections_by_key.items() if row_id == app_id}

    def append_entry(self, app_id, section, title, markdown, files=()):
        self._get(app_id)
        markdown = base.entry_files(self, app_id, markdown, files)
        self.sections_by_key[(app_id, section)] = base.entry_appended(self.sections_by_key.get((app_id, section)), title, markdown)

    def files(self, app_id):
        return [(name, data, kind) for (row_id, name), (data, kind) in self.files_by_key.items() if row_id == app_id]


class Events(_Table):
    fields = base.EVENT_FIELDS

    def list(self, app_id=None, kind=None, source_id=None):
        return [dict(r) for r in self.rows.values() if r.get('archived') is not True
                and (app_id is None or r['app_id'] == app_id) and (kind is None or r['kind'] == kind)
                and (source_id is None or r['source_id'] == source_id)]

    def get(self, event_id):
        row = self.rows.get(event_id)
        return dict(row) if row and row.get('archived') is not True else None

    def add(self, app_id, kind, at, **fields):
        same = fields.get('source_id') and self.list(app_id=app_id, source_id=fields['source_id'])
        if same:
            return same[0]
        row = _new(self.fields, {**_known(self.fields, fields), 'app_id': app_id, 'kind': kind, 'at': at})
        self.rows[row['id']] = row
        return dict(row)

    def update(self, event_id, fields):
        return self._update(event_id, fields)

    def archive(self, app_id, kind):
        gone = [r['id'] for r in self.list(app_id=app_id, kind=kind)]
        for row_id in gone:
            del self.rows[row_id]
        return len(gone)


class Matches:
    def __init__(self):
        self.rows = {}

    def list(self, status=None):
        return [dict(r) for r in self.rows.values() if status is None or r['status'] == status]

    def get(self, url):
        row = self.rows.get(base.url_key(url))
        return dict(row) if row else None

    def upsert(self, job):
        key = base.url_key(job['url'])
        row = self.rows.get(key) or base.record(base.MATCH_FIELDS, {'id': f'm{next(_ids)}', 'first_seen': _now()})
        row.update(_known(base.MATCH_FIELDS, {k: v for k, v in job.items() if k not in ('id', 'last_update')}), last_update=_now())
        self.rows[key] = row
        return dict(row)

    def set_status(self, url, status):
        self.rows[base.url_key(url)].update(status=status, last_update=_now())

    def remove(self, url):
        self.rows.pop(base.url_key(url), None)

    def clear(self, keep_urls=()):
        keep = {base.url_key(url) for url in keep_urls}
        gone = [key for key in self.rows if key not in keep]
        for key in gone:
            del self.rows[key]
        return len(gone)

    def sync(self, db, scored_jobs, applied_urls=frozenset(), open_urls=None, dismissed_urls=frozenset(), partial=False):
        return matches_sync.sync(self, scored_jobs, applied_urls, open_urls, dismissed_urls, partial)


class Interviews(_Table):
    fields = base.INTERVIEW_FIELDS

    def list(self, app_id=None):
        return [dict(r) for r in self.rows.values() if app_id is None or r['app_id'] == app_id]

    def get(self, interview_id):
        row = self.rows.get(interview_id)
        return dict(row) if row else None

    def save(self, interview_id, fields):
        if interview_id:
            return self._update(interview_id, fields)
        row = _new(self.fields, _known(self.fields, fields))
        self.rows[row['id']] = row
        return dict(row)

    def archive(self, interview_id):
        self.rows.pop(interview_id, None)


class Insights(_Table):
    fields = base.INSIGHT_FIELDS

    def list(self, since=None, category=None, limit=None):
        found = sorted((dict(r) for r in self.rows.values() if (since is None or r['day'] >= since)
                        and (category is None or r['category'] == category)), key=lambda r: r['day'], reverse=True)
        return found[:limit] if limit else found

    def save(self, day, category, title, body, fields=None):
        same = next((r for r in self.rows.values() if r['day'] == day and r['category'] == category), None)
        values = base.insight_values({'day': day, 'category': category, 'title': title, 'body': body, 'fields': dict(fields or {})})
        if same:
            return self._update(same['id'], values)
        return self.add(values)

    def add(self, record):
        row = _new(self.fields, _known(self.fields, base.insight_values(record)))
        self.rows[row['id']] = row
        return dict(row)

    def update(self, insight_id, fields):
        return self._update(insight_id, base.insight_values(fields))


class Employers(_Table):
    fields = base.EMPLOYER_FIELDS

    def list(self, active=True):
        return [dict(r) for r in self.rows.values() if active is None or bool(r['active']) == active]

    def add(self, employer):
        same = next((r for r in self.rows.values() if r['name'].casefold() == employer['name'].casefold()), None)
        if same:
            return dict(same)
        row = _new(self.fields, {'active': True, **_known(self.fields, employer)})
        self.rows[row['id']] = row
        return dict(row)

    def upsert(self, employer):
        same = next((r for r in self.rows.values() if r['name'].casefold() == employer['name'].casefold()), None)
        if same:
            return self._update(same['id'], {k: v for k, v in employer.items() if k != 'name'})
        return self.add(employer)


class AgentRuns(_Table):
    fields = base.AGENT_RUN_FIELDS

    def update(self, run_id, fields):
        return self._update(run_id, base.check_extras(fields, base.AGENT_RUN_EXTRAS))

    def put(self, record):
        return super().put(base.check_extras(record, base.AGENT_RUN_EXTRAS))

    def get(self, run_id):
        try:
            return dict(self._get(run_id))
        except KeyError:
            return None

    def add(self, run):
        row = _new(self.fields, _known(self.fields, base.check_extras(run, base.AGENT_RUN_EXTRAS)))
        self.rows[row['id']] = row
        return dict(row)

    def list(self, ats=None, limit=None, transcript=True):
        found = [dict(r) for r in reversed(list(self.rows.values())) if ats is None or r['ats'] == ats]
        return [r if transcript else {**r, 'transcript': ''} for r in (found[:limit] if limit else found)]


class CronRuns(_Table):
    fields = base.CRON_RUN_FIELDS

    def begin(self, kind, where, fields=None):
        row = base.record(self.fields, {'id': f'm{next(_ids)}', 'kind': kind, 'where': where, 'status': 'Running',
                                        'started_at': _now(), 'progress': [], 'stats': {},
                                        **_known(self.fields, dict(fields or {}))})
        self.rows[row['id']] = row
        return dict(row)

    def progress(self, run_id, line):
        self._get(run_id)['progress'].append(line)

    def touch(self, run_id, stats=None):
        row = self._get(run_id)
        row['stats'] = {**(row.get('stats') or {}), **_stats(stats or {})}

    def finish(self, run_id, status, summary='', report='', result='', log='', stats=None, title='', details=None):
        return self._update(run_id, {'status': status, 'summary': summary, 'report': report, 'result': result,
                                    'log': log, 'finished_at': _now(), **({'title': title} if title else {}), **({'details': details} if details else {}),
                                    **({'stats': {**(self._get(run_id).get('stats') or {}), **_stats(stats)}} if stats else {})})

    def get(self, run_id):
        row = self.rows.get(run_id)
        return dict(row) if row else None

    def list(self, since=None, kind=None):
        return [dict(r) for r in reversed(list(self.rows.values())) if (since is None or r['started_at'] >= since)
                and (kind is None or r['kind'] == kind)]


class Texts:
    def __init__(self):
        self.texts = {}

    def get(self, name):
        if name not in base.TEXTS:
            raise KeyError(name)
        return self.texts.get(name, '')

    def set(self, name, markdown):
        if name not in base.TEXTS:
            raise KeyError(name)
        self.texts[name] = markdown

    def plain(self, name):
        return self.get(name)


def open_store(env=None):
    return base.Stores(name='memory', applications=Applications(), events=Events(), matches=Matches(),
                       interviews=Interviews(), insights=Insights(), employers=Employers(), agent_runs=AgentRuns(),
                       cron_runs=CronRuns(), texts=Texts())
