"""Time to first relevant job (owner, 18 Oct 2026: "time to first relevant job as fast as possible"), from the first Find jobs press of a persona
install (tools/persona-search/run.mjs adds it to press 1's row): seconds until the 1st and 10th open job in the user's places appeared (the Jobs
list shows it then), and until the 1st and 10th scored fit 70+. Run from the repo root with PYTHONPATH=. and the persona's
JOBADABRA_CONFIG_DIR / JOBADABRA_DATA_DIR. Prints one JSON line. Optional argv[1]: the press-1 log, for step times."""
import json
import re
import sqlite3
import sys
from datetime import datetime

from src.paths import DATA, JOBS_DB
from src.sources import feeds


def ts(text):
    return datetime.fromisoformat(text.replace('Z', '+00:00')).timestamp()


def main():
    tracker = sqlite3.connect(DATA / 'tracker.sqlite')
    t0 = min(ts(r[0]) for r in tracker.execute('SELECT started_at FROM cron_runs') if r[0])
    db = sqlite3.connect(JOBS_DB)
    rows = db.execute("SELECT id, title, location, first_seen_at FROM jobs WHERE state = 'open'").fetchall()
    places = [r for r in rows if feeds.wanted_location({'location': r[2] or '', 'title': r[1]})]
    seen = sorted(ts(r[3]) - t0 for r in places if r[3])
    scores = {}
    # Why (2 Nov 2026, run 41373710207): a press the 180 s budget stopped before it scored a job has no `scores` table; that is "no fit jobs yet", not a crash
    # (metrics.py guards the same table; without this run.mjs died here and the check read "the press wrote no numbers").
    if db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scores'").fetchone():
        for job_id, created, data in db.execute('SELECT job_id, created_at, data_json FROM scores'):
            scores[job_id] = (created, (json.loads(data or '{}').get('score') or 0))
    fit = sorted(max(ts(scores[r[0]][0]), ts(r[3])) - t0 for r in places if r[0] in scores and scores[r[0]][1] >= 70 and scores[r[0]][0])
    at = lambda xs, n: round(xs[n - 1]) if len(xs) >= n else None
    out = {'first_in_places_s': at(seen, 1), 'tenth_in_places_s': at(seen, 10), 'first_fit70_s': at(fit, 1), 'tenth_fit70_s': at(fit, 10),
           'in_places': len(seen), 'fit70': len(fit)}
    if len(sys.argv) > 1:   # where the time went, from the press's own log lines ("[123s] ...")
        marks = {'first new job': r'New job: ', 'first jobs added': r'^Added \d+ new job', 'boards proposed': r'Job boards proposed',
                 'titles sorted (first)': r'^Titles: .* sorted', 'first digest': r'^Digest ready', 'scout start': r'Growing your sources|^Scout: reading'}
        steps = {}
        for line in open(sys.argv[1], encoding='utf-8', errors='replace'):
            m = re.match(r'\[(\d+)s\] (.*)', line)
            if not m:
                continue
            for name, pattern in marks.items():
                if name not in steps and re.search(pattern, m.group(2)):
                    steps[name] = int(m.group(1))
        out['steps_s'] = steps
    print(json.dumps(out))


if __name__ == '__main__':
    main()
