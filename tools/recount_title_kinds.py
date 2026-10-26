"""Re-count the employer index's job titles by kind of role on the owner's Mac, through his Claude plan ($0 API), into a file the central scout seeds from.

Owner, 26 Oct 2026: the kinds grew from 11 to 19 and Other held 42% of the index, mostly titles the scout's capped AI never judged; asked to
spend for the re-count he said "You can do that from local, to rely on subscription. not costs". So: read every index employer's public job
feed, let the plan's AI judge each title the meanings pack does not know (src/role_kinds.py judged, the same question the scout asks), and
write {title, lower case: kind} to --out. The scout loads it into its decisions at start (src/scout_title_seed.py) and counts every mix with it.

Runs only on the Claude Code engine (refuses an API key path), in its own --work folder (never the app's data): its decisions there make a
second run continue where the first stopped. Public feeds only, no login, at most --threads at once.
    python tools/recount_title_kinds.py --index <employer_index.json> --work <dir> --out <title_kinds.json.gz> [--threads 4] [--max-calls 2000]
Tests: tests/test_recount_title_kinds.py."""
import argparse
import gzip
import json
import os
import sqlite3
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BATCH = 150          # titles per plan call (decide.BATCH is 50 for the API; a plan call costs seconds whatever its size)
SKIP_READERS = ('careers', 'visit')   # page readers ask AI to read a page: the scout reads those itself


def prepare(work, env=os.environ):
    """Point the engine at the plan and the work folder before src is imported; no API key may be used."""
    work.mkdir(parents=True, exist_ok=True)
    for name in ('data', 'config'):
        (work / name).mkdir(exist_ok=True)
    env['JOB_PILOTTO_DATA_DIR'], env['JOB_PILOTTO_CONFIG_DIR'] = str(work / 'data'), str(work / 'config')
    env['JOB_PILOTTO_AI_ENGINE'] = 'cli'
    env.pop('JOB_PILOTTO_AI_FALLBACK', None)
    env.pop('ANTHROPIC_API_KEY', None)


def titles_of(feeds, work, threads, fetch, say=print):
    """{feed key: [titles]} of every feed with a public job API, cached in work/titles.json so a second run reads no feed twice."""
    cache = work / 'titles.json'
    have = json.loads(cache.read_text(encoding='utf-8')) if cache.exists() else {}
    todo = [f for f in feeds if f.get('ats') not in SKIP_READERS and f"{f.get('ats')}:{f.get('slug')}" not in have]

    def one(feed):
        try:
            return f"{feed['ats']}:{feed['slug']}", [str(j.get('title') or '').strip() for j in fetch(feed['ats'], feed['slug'])][:2000]
        except Exception as error:  # noqa: BLE001 — a dead feed is skipped, as the scout does
            return f"{feed.get('ats')}:{feed.get('slug')}", {'error': f'{type(error).__name__}'}
    with ThreadPoolExecutor(threads) as pool:
        for n, (key, titles) in enumerate(pool.map(one, todo), 1):
            have[key] = titles
            if n % 200 == 0 or n == len(todo):
                say(f'recount: read {n} of {len(todo)} feeds')
                cache.write_text(json.dumps(have), encoding='utf-8')
    return {key: titles for key, titles in have.items() if isinstance(titles, list)}


def to_judge(by_feed, known):
    """The distinct titles the pack does not know, in a stable order (the most frequent first)."""
    counts, first = {}, {}
    for titles in by_feed.values():
        for title in titles:
            if title and not known(title):
                counts[title.lower()] = counts.get(title.lower(), 0) + 1
                first.setdefault(title.lower(), title)
    return [first[key] for key in sorted(counts, key=lambda key: -counts[key])]


def judge(titles, threads, judged, say=print, chunk=BATCH * 4):
    """Ask the plan about these titles in parallel chunks; what is already kept is not asked again."""
    parts = [titles[start:start + chunk] for start in range(0, len(titles), chunk)]
    done = 0
    with ThreadPoolExecutor(threads) as pool:
        for found in pool.map(lambda part: judged(part, 'job-title-kind'), parts):
            done += 1
            say(f'recount: judged part {done} of {len(parts)} ({len(found)} titles)')


def export(db_path, since, out, kinds):
    """Every title kind kept since `since` into `out` (gzip JSON {title: kind}); returns how many."""
    with sqlite3.connect(db_path) as db:
        rows = db.execute("SELECT key, answer FROM decisions WHERE topic = 'job-title-kind' AND at >= ?", (since,)).fetchall()
    found = {key: answer for key, answer in rows if answer in kinds}
    out.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out, 'wt', encoding='utf-8') as handle:
        json.dump(found, handle, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    return len(found)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--index', required=True, type=Path)
    parser.add_argument('--work', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--max-calls', type=int, default=2000)
    parser.add_argument('--limit', type=int, default=0, help='judge at most this many titles (a measured first slice)')
    args = parser.parse_args(argv)
    prepare(args.work)
    sys.path.insert(0, str(ROOT))
    from src import role_kinds
    from src.ai import decide, meanings_pack
    from src.paths import JOBS_DB
    from src.sources import ats
    decide.BATCH, decide.MAX_CALLS_PER_RUN = BATCH, args.max_calls
    feeds = json.loads(args.index.read_text(encoding='utf-8'))['feeds']
    by_feed = titles_of(feeds, args.work, args.threads, ats.fetch)
    titles = to_judge(by_feed, lambda title: meanings_pack.first('job-title-kind', title))
    if args.limit:
        titles = titles[:args.limit]
    print(f'recount: {len(by_feed)} feeds, {len(titles)} titles the pack does not know; asking the Claude plan in parts of {BATCH}', flush=True)
    judge(titles, args.threads, role_kinds.judged)
    n = export(JOBS_DB, role_kinds.SINCE, args.out, role_kinds.KINDS)
    print(f'recount: wrote {n} title kinds to {args.out}', flush=True)


if __name__ == '__main__':
    main()
