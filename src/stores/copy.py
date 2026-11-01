"""Move the user's data from one store to another ("Move my data to Notion"): every entity, through the interface.

Works for any pair of adapters. Resumable: a journal ({entity: {source id: target id}}) is written after every record,
so a second run after a crash or a lost connection skips what is already there instead of adding it twice. The
source is never changed: the caller switches the active store only after `copy` returned without error, and keeps
the source as an archive (one copy in use, D2/D3 of docs/superpowers/specs/2026-10-09-store-adapters.md).
CLI: `python -m src.stores.copy --to notion [--journal PATH] [--source-texts-win]` (the source is the active store's env
with JOBADABRA_STORE=sqlite). --source-texts-win: the target workspace was just built (its pages hold only the template's
placeholder text), so the source's texts are written over it instead of being kept as "the target already had". Progress lines on stdout: `moving <entity> <done>/<total>`. Guarded by tests/test_store_copy.py.
"""
import argparse
import json
import os
import sys
from pathlib import Path

from . import base, open_stores

# Order matters: applications first (events and interviews point at them).
WITH_APP = ('events', 'interviews')
PLAIN = ('employers', 'insights', 'agent_runs', 'cron_runs')


class Journal:
    def __init__(self, path=None):
        self.path = Path(path) if path else None
        self.seen = json.loads(self.path.read_text()) if self.path and self.path.is_file() else {}

    def target(self, entity, source_id):
        return self.seen.get(entity, {}).get(source_id)

    def note(self, entity, source_id, target_id):
        self.seen.setdefault(entity, {})[source_id] = target_id
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix('.tmp')
            tmp.write_text(json.dumps(self.seen))
            tmp.replace(self.path)


def _all(table, entity):
    if entity == 'employers':
        return table.list(active=None)
    return table.list()


KEPT = 'kept'   # the journal's mark for a text the target already had (so a resumed move still says so)


def copy(source, target, journal=None, progress=lambda entity, done, total: None, source_texts_win=False):
    """Copy everything in `source` into `target`. Returns {entity: count copied this run, 'kept': [texts the target already had]}.
    source_texts_win: the target was just built, so what its text pages hold is the template's placeholder: the source's are written."""
    journal = journal or Journal()
    counts = {}

    for name in base.TEXTS:
        text = source.texts.get(name)
        if text and not journal.target('texts', name):
            # A text the target already has wins (a Notion workspace from before): the source's stays in the archive the
            # caller keeps, and is named in `kept` so the person is told (rule of 3 Oct 2026, "an existing workspace wins").
            if target.texts.get(name).strip() and not source_texts_win:
                journal.note('texts', name, KEPT)
            else:
                target.texts.set(name, text)
                counts['texts'] = counts.get('texts', 0) + 1
                journal.note('texts', name, name)
    # From the journal, so a move that was cut off after the texts still names them when it finishes.
    kept = [name for name in base.TEXTS if journal.target('texts', name) == KEPT]
    if kept:
        counts['kept'] = kept

    apps = source.applications.list()
    for done, app in enumerate(apps, 1):
        if not journal.target('applications', app['id']):
            # By URL too: a crash between put() and the journal line must not copy the job twice.
            copied = target.applications.get(app['url']) or target.applications.put(app)
            for section, markdown in source.applications.sections(app['id']).items():
                target.applications.set_section(copied['id'], section, markdown)
            for name, data, kind in source.applications.files(app['id']):
                target.applications.attach(copied['id'], name, data, kind)
            journal.note('applications', app['id'], copied['id'])
            counts['applications'] = counts.get('applications', 0) + 1
        progress('applications', done, len(apps))

    matches = source.matches.list()
    for done, match in enumerate(matches, 1):
        target.matches.upsert(match)  # keyed by URL: a second run changes nothing
        progress('matches', done, len(matches))
    counts['matches'] = len(matches)

    for entity in WITH_APP + PLAIN:
        rows = _all(getattr(source, entity), entity)
        for done, row in enumerate(rows, 1):
            if not journal.target(entity, row['id']):
                values = dict(row)
                if entity in WITH_APP and values.get('app_id'):
                    values['app_id'] = journal.target('applications', values['app_id']) or ''
                copied = getattr(target, entity).put(values)
                journal.note(entity, row['id'], copied['id'])
                counts[entity] = counts.get(entity, 0) + 1
            progress(entity, done, len(rows))
    return counts


def main(argv=None):
    parser = argparse.ArgumentParser(description='Move the user\'s data from the active store to another.')
    parser.add_argument('--from', dest='source', default='sqlite')
    parser.add_argument('--to', required=True)
    parser.add_argument('--journal', help='resume file (default: data/move-<from>-to-<to>.json)')
    parser.add_argument('--source-texts-win', action='store_true', help='the target was just built: write the source\'s texts')
    args = parser.parse_args(argv)
    if args.source == args.to:
        parser.error('--from and --to are the same store')
    source = open_stores({**os.environ, 'JOBADABRA_STORE': args.source})
    target = open_stores({**os.environ, 'JOBADABRA_STORE': args.to})
    from ..paths import DATA
    journal = Journal(args.journal or Path(DATA) / f'move-{args.source}-to-{args.to}.json')
    counts = copy(source, target, journal, lambda entity, done, total: print(f'moving {entity} {done}/{total}', flush=True),
                  source_texts_win=args.source_texts_win)
    print(json.dumps({'moved': counts}), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
