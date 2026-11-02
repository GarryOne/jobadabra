"""The rows of a query on a persona install's `scores` table, or [] when the table does not exist yet. Shared by metrics.py and ttfr.py.
Why (2 Nov 2026, run 41373710207): the table is created by the first scored job, so a press the 180 s budget stopped before that has none; that is
"nothing scored", not an error (ttfr.py selected from it and killed run.mjs before it wrote the press row; Gitar on #2955: one helper, not two copies)."""


def scores_rows(db, sql):
    """db: an open sqlite3 connection; sql: a SELECT on `scores`. -> its rows, [] without the table."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scores'").fetchone():
        return []
    return db.execute(sql).fetchall()
