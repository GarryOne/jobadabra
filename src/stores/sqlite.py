"""The SQLite store: the user's data on this Mac, the default adapter when Notion isn't chosen.

One file, data/tracker.sqlite (the user's records; data/jobs.sqlite stays a rebuildable crawl cache), files under
data/files/<app_id>/, texts as Markdown files (the desktop app's JOB_PILOTTO_PROFILE_FILE / _ANSWERS_FILE /
_KNOWLEDGE_FILE when set, else data/texts/<name>.md). Each table keeps the whole record as JSON in `data` (so an int
stays an int and a list a list) plus the few columns it is looked up or ordered by. Spec: docs/superpowers/specs/2026-10-09-store-adapters.md.
Guarded by tests/test_store_sqlite.py (the contract suite plus what is SQLite's own: reopening, the file layout).
"""
import json
import os
import shutil
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import base, matches_sync
from .locked import unlocked as _unlocked

# PRAGMA user_version: add a step to MIGRATIONS (never edit a shipped one) when the layout changes.
MIGRATIONS = (
    """
    CREATE TABLE applications (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, url_key TEXT NOT NULL UNIQUE,
                               stage TEXT NOT NULL DEFAULT '', data TEXT NOT NULL);
    CREATE TABLE sections (app_id TEXT NOT NULL, name TEXT NOT NULL, markdown TEXT NOT NULL, PRIMARY KEY (app_id, name));
    CREATE TABLE files (seq INTEGER PRIMARY KEY AUTOINCREMENT, app_id TEXT NOT NULL, name TEXT NOT NULL,
                        content_type TEXT NOT NULL DEFAULT '', UNIQUE (app_id, name));
    CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, app_id TEXT NOT NULL DEFAULT '',
                         kind TEXT NOT NULL DEFAULT '', source_id TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0,
                         data TEXT NOT NULL);
    CREATE INDEX events_app_idx ON events(app_id);
    CREATE INDEX events_source_idx ON events(source_id);
    CREATE TABLE matches (seq INTEGER PRIMARY KEY AUTOINCREMENT, url_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT '',
                          data TEXT NOT NULL);
    CREATE TABLE interviews (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, app_id TEXT NOT NULL DEFAULT '',
                             archived INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
    CREATE TABLE insights (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, day TEXT NOT NULL,
                           category TEXT NOT NULL, data TEXT NOT NULL, UNIQUE (day, category));
    CREATE TABLE employers (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, name_key TEXT NOT NULL UNIQUE,
                            active INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL);
    CREATE TABLE agent_runs (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, ats TEXT NOT NULL DEFAULT '',
                             data TEXT NOT NULL);
    CREATE TABLE cron_runs (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT '',
                            started_at TEXT NOT NULL DEFAULT '', data TEXT NOT NULL);
    """,
    # 2: insights may share a day and category (learning's issues); save() keeps one per day+category itself.
    """
    CREATE TABLE insights_2 (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, day TEXT NOT NULL,
                             category TEXT NOT NULL, data TEXT NOT NULL);
    INSERT INTO insights_2 (seq, id, day, category, data) SELECT seq, id, day, category, data FROM insights;
    DROP TABLE insights;
    ALTER TABLE insights_2 RENAME TO insights;
    CREATE INDEX insights_day_idx ON insights(day, category);
    """,
)


def _version(db):
    return db.execute('PRAGMA user_version').fetchone()[0]


def connect(path):
    """The tracker database at `path`, created or migrated to the latest layout."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # The engine and the desktop app may both have it open: WAL lets one read while the other writes.
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    _unlocked(lambda: db.execute('PRAGMA journal_mode=WAL'))
    # Two processes can open a new file at the same moment (the app and a call of the engine): both read version 0, the first
    # creates the tables, and the second's CREATE TABLE would fail. IMMEDIATE makes it wait for the first; when the first has
    # done the step, the version has moved: carry on from there instead of failing (10 Oct 2026: Windows e2e, "table applications already exists").
    while (version := _unlocked(lambda: _version(db))) < len(MIGRATIONS):
        try:
            with db:
                _unlocked(lambda: db.executescript(f'BEGIN IMMEDIATE; {MIGRATIONS[version]}; PRAGMA user_version = {version + 1}; COMMIT;'))
        except sqlite3.OperationalError as error:
            if 'already exists' not in str(error) or _version(db) <= version:
                raise
    return db


def _now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


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
    """A table of records with an `id`: `columns(record)` gives the looked-up columns kept beside `data`."""
    table, fields, live = '', (), ''

    def __init__(self, db):
        self.db = db

    def columns(self, row):
        return {}

    def _rows(self, where='', args=(), order='seq', limit=None):
        clauses = [c for c in (self.live, where) if c]
        sql = f'SELECT data FROM {self.table}' + (f' WHERE {" AND ".join(clauses)}' if clauses else '') + f' ORDER BY {order}'
        if limit:
            sql += f' LIMIT {int(limit)}'
        return [base.record(self.fields, json.loads(r['data'])) for r in self.db.execute(sql, args)]

    def _get(self, row_id):
        found = self.db.execute(f'SELECT data FROM {self.table} WHERE id = ?', (row_id,)).fetchone()
        if not found:
            raise KeyError(row_id)
        return base.record(self.fields, json.loads(found['data']))

    def _write(self, row):
        cols = {'id': row['id'], **self.columns(row), 'data': json.dumps(row, ensure_ascii=False)}
        names = ', '.join(cols)
        updates = ', '.join(f'{n} = excluded.{n}' for n in cols if n != 'id')
        with self.db:
            self.db.execute(f'INSERT INTO {self.table} ({names}) VALUES ({", ".join("?" * len(cols))}) '
                            f'ON CONFLICT(id) DO UPDATE SET {updates}', tuple(cols.values()))
        return dict(row)

    def _new(self, values):
        return self._write(base.record(self.fields, {**values, 'id': uuid.uuid4().hex, 'created_at': _now()}))

    def put(self, record):
        """A record copied from another store, as it is (its dates too), under a new id: only the move calls it."""
        values = _known(self.fields, dict(record))
        return self._write(base.record(self.fields, {**values, 'id': uuid.uuid4().hex,
                                                     'created_at': values.get('created_at') or _now()}))

    def _update(self, row_id, fields):
        row = self._get(row_id)
        row.update(_known(self.fields, {k: v for k, v in fields.items() if k not in ('id', 'created_at')}))
        return self._write(row)


class Applications(_Table):
    table, fields = 'applications', base.APPLICATION_FIELDS

    def __init__(self, db, files):
        super().__init__(db)
        self.file_root = files

    def columns(self, row):
        return {'url_key': base.url_key(row['url']), 'stage': row['stage'] or ''}

    def update(self, app_id, fields):
        return self._update(app_id, fields)

    def _update(self, row_id, fields):  # every change stamps updated_at; a caller's own value is ignored
        return super()._update(row_id, {**{k: v for k, v in fields.items() if k != 'updated_at'}, 'updated_at': _now()})

    def list(self, stages=None):
        if stages is None:
            return self._rows()
        stages = list(stages)
        return self._rows(f'stage IN ({", ".join("?" * len(stages))})', stages) if stages else []

    def get(self, url):
        found = self._rows('url_key = ?', (base.url_key(url),))
        return found[0] if found else None

    def stages(self):
        return {r['url_key']: r['stage'] for r in self.db.execute('SELECT url_key, stage FROM applications')}

    def by_id(self, app_id):
        try:
            return self._get(app_id)
        except KeyError:
            return None

    def create(self, job, stage):
        found = self.get(job.get('url'))
        if found:
            return self._update(found['id'], {'stage': stage})
        return self._new({**_known(self.fields, job), 'stage': stage, 'updated_at': _now()})

    def set_stage(self, job, stage, today=None):
        found = self.get(job.get('url'))
        if found and found['stage'] == stage:
            return found, base.UNCHANGED
        stamp = {'applied_on': today or base.local_today()} if stage == 'Applied' and not (found or {}).get('applied_on') else {}
        if found:
            return self._update(found['id'], {'stage': stage, **stamp}), base.CHANGED
        return self.create({**job, **stamp}, stage), base.CREATED

    def delete(self, app_id):
        with self.db:
            self.db.execute('DELETE FROM sections WHERE app_id = ?', (app_id,))
            self.db.execute('DELETE FROM files WHERE app_id = ?', (app_id,))
            self.db.execute('DELETE FROM applications WHERE id = ?', (app_id,))
        shutil.rmtree(self._folder(app_id), ignore_errors=True)

    def section(self, app_id, name):
        found = self.db.execute('SELECT markdown FROM sections WHERE app_id = ? AND name = ?', (app_id, name)).fetchone()
        return found['markdown'] if found else None

    def set_section(self, app_id, name, markdown):
        self._get(app_id)
        with self.db:
            self.db.execute('INSERT INTO sections (app_id, name, markdown) VALUES (?, ?, ?) '
                            'ON CONFLICT(app_id, name) DO UPDATE SET markdown = excluded.markdown', (app_id, name, markdown))

    def _folder(self, app_id):
        return self.file_root / Path(app_id).name

    def attach(self, app_id, name, data, content_type):
        """Keeps the bytes under data/files/<app_id>/<name> and returns that path (no FILES capability)."""
        self._get(app_id)
        path = self._folder(app_id) / (Path(name).name or 'file')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(bytes(data))
        with self.db:
            self.db.execute('INSERT INTO files (app_id, name, content_type) VALUES (?, ?, ?) ON CONFLICT(app_id, name) '
                            'DO UPDATE SET content_type = excluded.content_type', (app_id, path.name, content_type or ''))
        return str(path)

    def append_entry(self, app_id, section, title, markdown, files=()):
        markdown = base.entry_files(self, app_id, markdown, files)
        self.set_section(app_id, section, base.entry_appended(self.section(app_id, section), title, markdown))

    def sections(self, app_id):
        return {r['name']: r['markdown'] for r in
                self.db.execute('SELECT name, markdown FROM sections WHERE app_id = ? ORDER BY rowid', (app_id,))}

    def files(self, app_id):
        """[(name, bytes, content_type)] of the job's files still on disk."""
        found = self.db.execute('SELECT name, content_type FROM files WHERE app_id = ? ORDER BY seq', (app_id,))
        folder = self._folder(app_id)
        return [(r['name'], (folder / r['name']).read_bytes(), r['content_type']) for r in found
                if (folder / r['name']).is_file()]


class Events(_Table):
    table, fields, live = 'events', base.EVENT_FIELDS, 'archived = 0'

    def columns(self, row):
        return {'app_id': row['app_id'] or '', 'kind': row['kind'] or '', 'source_id': row['source_id'] or ''}

    def list(self, app_id=None, kind=None, source_id=None):
        wanted = {k: v for k, v in (('app_id', app_id), ('kind', kind), ('source_id', source_id)) if v is not None}
        return self._rows(' AND '.join(f'{k} = ?' for k in wanted), tuple(wanted.values()))

    def get(self, event_id):
        found = self._rows('id = ?', (event_id,))
        return found[0] if found else None

    def add(self, app_id, kind, at, **fields):
        same = fields.get('source_id') and self.list(app_id=app_id, source_id=fields['source_id'])
        if same:
            return same[0]
        return self._new({**_known(self.fields, fields), 'app_id': app_id, 'kind': kind, 'at': at})

    def update(self, event_id, fields):
        return self._update(event_id, fields)

    def archive(self, app_id, kind):
        with self.db:
            return self.db.execute('UPDATE events SET archived = 1 WHERE archived = 0 AND app_id = ? AND kind = ?',
                                   (app_id, kind)).rowcount


class Matches:
    fields = base.MATCH_FIELDS

    def __init__(self, db):
        self.db = db

    # A match's id: stable, from its job's key (base.url_key), so a row written before matches had ids reads with the same one.
    @staticmethod
    def _id(key):
        return uuid.uuid5(uuid.NAMESPACE_URL, key).hex

    def _row(self, key, data):
        return base.record(self.fields, {**json.loads(data), 'id': self._id(key)})

    def _one(self, key):
        found = self.db.execute('SELECT url_key, data FROM matches WHERE url_key = ?', (key,)).fetchone()
        return self._row(found['url_key'], found['data']) if found else None

    def _write(self, key, row):
        with self.db:
            self.db.execute('INSERT INTO matches (url_key, status, data) VALUES (?, ?, ?) ON CONFLICT(url_key) DO UPDATE '
                            'SET status = excluded.status, data = excluded.data',
                            (key, row['status'] or '', json.dumps(row, ensure_ascii=False)))
        return dict(row)

    def list(self, status=None):
        sql, args = ('SELECT url_key, data FROM matches ORDER BY seq', ()) if status is None else \
            ('SELECT url_key, data FROM matches WHERE status = ? ORDER BY seq', (status,))
        return [self._row(r['url_key'], r['data']) for r in self.db.execute(sql, args)]

    def get(self, url):
        return self._one(base.url_key(url))

    def upsert(self, job):
        key = base.url_key(job['url'])
        row = self._one(key) or base.record(self.fields, {'id': self._id(key), 'first_seen': _now()})
        row.update(_known(self.fields, {k: v for k, v in job.items() if k not in ('id', 'last_update')}), last_update=_now())
        return self._write(key, row)

    def set_status(self, url, status):
        key = base.url_key(url)
        row = self._one(key)
        if row is None:
            raise KeyError(url)
        self._write(key, {**row, 'status': status, 'last_update': _now()})

    def remove(self, url):
        with self.db:
            self.db.execute('DELETE FROM matches WHERE url_key = ?', (base.url_key(url),))

    def clear(self, keep_urls=()):
        keep = {base.url_key(url) for url in keep_urls}
        gone = [r['url_key'] for r in self.db.execute('SELECT url_key FROM matches') if r['url_key'] not in keep]
        with self.db:
            self.db.executemany('DELETE FROM matches WHERE url_key = ?', [(key,) for key in gone])
        return len(gone)

    def sync(self, db, scored_jobs, applied_urls=frozenset(), open_urls=None, dismissed_urls=frozenset(), partial=False):
        return matches_sync.sync(self, scored_jobs, applied_urls, open_urls, dismissed_urls, partial)


class Interviews(_Table):
    table, fields, live = 'interviews', base.INTERVIEW_FIELDS, 'archived = 0'

    def columns(self, row):
        return {'app_id': row['app_id'] or ''}

    def list(self, app_id=None):
        return self._rows() if app_id is None else self._rows('app_id = ?', (app_id,))

    def get(self, interview_id):
        found = self._rows('id = ?', (interview_id,))
        return found[0] if found else None

    def save(self, interview_id, fields):
        if interview_id:
            return self._update(interview_id, fields)
        return self._new(_known(self.fields, fields))

    def archive(self, interview_id):
        with self.db:
            self.db.execute('UPDATE interviews SET archived = 1 WHERE id = ?', (interview_id,))


class Insights(_Table):
    table, fields = 'insights', base.INSIGHT_FIELDS

    def columns(self, row):
        return {'day': row['day'], 'category': row['category']}

    def list(self, since=None, category=None, limit=None):
        wanted = [(c, v) for c, v in (('day >= ?', since), ('category = ?', category)) if v is not None]
        return self._rows(' AND '.join(c for c, _ in wanted), tuple(v for _, v in wanted), 'day DESC, seq DESC', limit)

    def save(self, day, category, title, body, fields=None):
        values = base.insight_values({'day': day, 'category': category, 'title': title, 'body': body, 'fields': dict(fields or {})})
        same = self.db.execute('SELECT id FROM insights WHERE day = ? AND category = ? ORDER BY seq DESC',
                               (day, category)).fetchone()
        return self._update(same['id'], values) if same else self._new(values)

    def add(self, record):
        return self._new(_known(self.fields, base.insight_values(record)))

    def update(self, insight_id, fields):
        return self._update(insight_id, base.insight_values(fields))


class Employers(_Table):
    table, fields = 'employers', base.EMPLOYER_FIELDS

    def columns(self, row):
        return {'name_key': row['name'].casefold(), 'active': 1 if row['active'] else 0}

    def list(self, active=True):
        return self._rows() if active is None else self._rows('active = ?', (1 if active else 0,))

    def add(self, employer):
        same = self.db.execute('SELECT id FROM employers WHERE name_key = ?', (employer['name'].casefold(),)).fetchone()
        if same:
            return self._get(same['id'])
        return self._new({'active': True, **_known(self.fields, employer)})

    def upsert(self, employer):
        same = self.db.execute('SELECT id FROM employers WHERE name_key = ?', (employer['name'].casefold(),)).fetchone()
        if same:
            return self._update(same['id'], {k: v for k, v in employer.items() if k != 'name'})
        return self.add(employer)


class AgentRuns(_Table):
    table, fields = 'agent_runs', base.AGENT_RUN_FIELDS

    def columns(self, row):
        return {'ats': row['ats'] or ''}

    def add(self, run):
        return self._new(_known(self.fields, base.check_extras(run, base.AGENT_RUN_EXTRAS)))

    def update(self, run_id, fields):
        return self._update(run_id, base.check_extras(fields, base.AGENT_RUN_EXTRAS))

    def put(self, record):
        return super().put(base.check_extras(record, base.AGENT_RUN_EXTRAS))

    def get(self, run_id):
        try:
            return dict(self._get(run_id))
        except KeyError:
            return None

    def list(self, ats=None, limit=None, transcript=True):
        found = self._rows(*(('ats = ?', (ats,)) if ats is not None else ('', ())), order='seq DESC', limit=limit)
        return found if transcript else [{**r, 'transcript': ''} for r in found]


class CronRuns(_Table):
    table, fields = 'cron_runs', base.CRON_RUN_FIELDS

    def columns(self, row):
        return {'kind': row['kind'] or '', 'started_at': row['started_at'] or ''}

    def begin(self, kind, where, fields=None):
        return self._write(base.record(self.fields, {'id': uuid.uuid4().hex, 'kind': kind, 'where': where,
                                                     'status': 'Running', 'started_at': _now(), 'progress': [], 'stats': {},
                                        **_known(self.fields, dict(fields or {}))}))

    def progress(self, run_id, line):
        row = self._get(run_id)
        self._write({**row, 'progress': [*(row['progress'] or []), line]})

    def touch(self, run_id, stats=None):
        row = self._get(run_id)
        self._write({**row, 'stats': {**(row.get('stats') or {}), **_stats(stats or {})}})

    def finish(self, run_id, status, summary='', report='', result='', log='', stats=None, title='', details=None):
        return self._update(run_id, {'status': status, 'summary': summary, 'report': report, 'result': result,
                                    'log': log, 'finished_at': _now(), **({'title': title} if title else {}), **({'details': details} if details else {}),
                                    **({'stats': {**(self._get(run_id).get('stats') or {}), **_stats(stats)}} if stats else {})})

    def get(self, run_id):
        found = self._rows('id = ?', (run_id,))
        return found[0] if found else None

    def list(self, since=None, kind=None):
        wanted = [(c, v) for c, v in (('started_at >= ?', since), ('kind = ?', kind)) if v is not None]
        return self._rows(' AND '.join(c for c, _ in wanted), tuple(v for _, v in wanted), 'seq DESC')


class Texts:
    """Whole Markdown files: the app's Profile and standard answers where it keeps them, else data/texts/<name>.md."""
    VARIABLES = {'profile': 'JOB_PILOTTO_PROFILE_FILE', 'answers': 'JOB_PILOTTO_ANSWERS_FILE',
                 'knowledge': 'JOB_PILOTTO_KNOWLEDGE_FILE'}

    def __init__(self, folder, env):
        self.folder, self.env = Path(folder), env

    def path(self, name):
        if name not in base.TEXTS:
            raise KeyError(name)
        return Path(self.env.get(self.VARIABLES.get(name, '')) or self.folder / f'{name}.md')

    def get(self, name):
        path = self.path(name)
        return path.read_text(encoding='utf-8') if path.is_file() else ''

    def set(self, name, markdown):
        path = self.path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(markdown, encoding='utf-8')

    def plain(self, name):
        return self.get(name)


def root(env):
    """The data folder: JOB_PILOTTO_DATA_DIR (the app's, a test's temp folder) when set, else the engine's data/."""
    from .. import paths
    return Path(env.get('JOB_PILOTTO_DATA_DIR') or paths.DATA)


def open_store(env=None):
    env = os.environ if env is None else env
    folder = root(env)
    db = connect(folder / 'tracker.sqlite')
    return base.Stores(name='sqlite', applications=Applications(db, folder / 'files'), events=Events(db),
                       matches=Matches(db), interviews=Interviews(db), insights=Insights(db), employers=Employers(db),
                       agent_runs=AgentRuns(db), cron_runs=CronRuns(db), texts=Texts(folder / 'texts', env))
