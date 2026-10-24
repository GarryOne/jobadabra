"""One persona's job cache as numbers for the persona search check (tools/persona-search/run.mjs): open jobs, those in the places (the engine's own
place check), scored, fit 70+, the top 10 with their fit, and the last run's yield per source (src/source_yield.py). Prints one JSON line.
Run with the persona's JOB_PILOTTO_CONFIG_DIR / JOB_PILOTTO_DATA_DIR set (run.mjs does), from the repository root.
"""
import json
import sqlite3

from collections import Counter

from src import country_codes, source_yield
from src.paths import JOBS_DB
from src.sources import feeds

LIST_LOCATION = 60   # a longer location names many places: not counted as local


def main():
    db = sqlite3.connect(JOBS_DB)
    rows = db.execute("SELECT j.id, j.title, j.location, COALESCE(c.name, ''), j.url FROM jobs j LEFT JOIN companies c ON c.id = j.company_id "
                      "WHERE j.state = 'open'").fetchall()
    has_scores = db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scores'").fetchone()
    scores = {job_id: json.loads(data or '{}') for job_id, data in db.execute('SELECT job_id, data_json FROM scores')} if has_scores else {}
    source_names = dict(db.execute('SELECT j.id, COALESCE(s.name, \'\') FROM jobs j LEFT JOIN sources s ON s.id = j.source_id').fetchall())
    in_places = [row for row in rows if feeds.wanted_location({'location': row[2] or '', 'title': row[1]})]
    # Located in the user's places by their own words (a city or country in the job's place), never remote anywhere: what a place check counts (24 Oct 2026, memory feedback-local-jobs-only-no-worldwide-remote)
    local = [row for row in in_places if len(row[2] or '') <= LIST_LOCATION and feeds.mentions(feeds.PLACE, country_codes.name(row[2] or ''))]   # a place list ("Moldova, Romania, Poland") is not one place
    scored = sorted(((scores[row[0]].get('score') or 0, row) for row in in_places if row[0] in scores), key=lambda pair: -pair[0])
    print(json.dumps({
        'open': len(rows), 'in_places': len(in_places), 'local_jobs': len(local),
        'local_by_source': dict(Counter(source_names.get(row[0], '') for row in local)), 'scored_in_places': len(scored),
        'fit70_in_places': sum(1 for fit, _ in scored if fit >= source_yield.FIT),
        'top10': [{'fit': fit, 'title': row[1], 'company': row[3], 'location': row[2], 'url': row[4], 'reason': scores[row[0]].get('reason', '')}
                  for fit, row in scored[:10]],
        'sources': source_yield.latest(db)[:15],
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
