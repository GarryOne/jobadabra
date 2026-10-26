"""Reading every employer feed of a search (feeds.scan): download in parallel, place and sort the titles with AI once, keep the jobs of your
roles and places, record their seen history. Moved out of feeds.py (500-line rule); every name it uses is read from feeds at call time, so
tests patch feeds.* as before. A timed search reads best first and stops at its time (src/sources/read_budget.py). Tests: tests/test_read_budget.py, tests/test_feed_scan_parallel.py, tests/test_coverage.py, tests/test_non_it_crawl.py."""
import os
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

from . import ats, feed_facts, feeds, read_budget
from .. import read_methods, source_yield


def _item(source, job, status):
    return {"company": job.get("employer") or source["company"], "id": str(job["id"]),   # a portal's jobs keep their own employer (visits.py)
            "title": job["title"], "location": job["location"] or "Unspecified", "url": job["url"], "date_posted": job.get("date_posted") or "",
            "description": job.get("description") or "", "work_mode": "Remote (stated)" if job.get("remote") else "",
            "salary_text": job.get("salary") or "", "status": status}


def _sure(index, source, download, db, now, shown):
    """The jobs of one site that need no AI to be kept (role words in the title, one of your places): recorded now and kept in `shown`
    by (site, job id), so the full pass after the AI sort takes them as they are (still "new")."""
    jobs, failure = download
    if failure:
        return []
    board, found = f'{source.get("ats", "greenhouse")}:{source.get("slug") or source["board"]}', []
    with db:
        for job in jobs or []:
            if feeds.sure_title(job["title"]) and feeds.wanted_location(job):
                item = shown[(index, str(job["id"]))] = _item(source, job, feeds.record(db, board, job, now))
                found.append(item)
    return found


def scan(sources, db, fetcher=None, details=None, on_jobs=None):
    """Fetch every source, keep SRE-type titles in preferred locations, record seen history. report['funnel'] counts what the
    crawl saw and what the role keywords caught (src/coverage.py), so a search that is too narrow can be said out loud.
    on_jobs(jobs): called with each site's sure jobs as soon as that site is read (owner, 18 Oct 2026: jobs shown as quickly as possible;
    the driver's 133 of 134 sites were read by 61 s and the last held every job until 156 s). A job the AI later places outside your
    places leaves the list at the search's end (store.close_elsewhere)."""
    fetcher = fetcher or feeds.fetch
    now = feed_facts._now().isoformat(timespec="seconds")
    key = lambda source: f'{source.get("ats", "greenhouse")}:{source.get("slug") or source["board"]}'
    with db:   # the end-to-end journey's fixture feeds answer the same every run: nothing rests there, nothing is skipped as unchanged
        db.execute(feeds.REST_TABLE)
        fixtures = os.getenv('JOB_PILOTTO_FIXTURE_DIR')
        rest, facts = ({}, {}) if fixtures else (feeds.resting(db, now), feed_facts.load(db))
    rested = [source for source in sources if key(source) in rest]
    same = [source for source in sources if key(source) not in rest and feed_facts.fresh(facts.get(key(source)), now)]   # judged for this search minutes ago
    sources = [source for source in sources if key(source) not in rest and not feed_facts.fresh(facts.get(key(source)), now)]
    sources = read_budget.left_first(read_budget.ranked(sources), key)   # best first, then what the last timed read left
    total = len(sources)
    if rested:   # said every run, so a short list is never a mystery
        print(f'Employers resting: {len(rested)} gave no match for your roles in your places {feeds.REST_AFTER} checks in a row; checked again after '
              f'{min(rest[key(source)] for source in rested)[:10]}.')
    from ..progress import Ticker
    ticker, lock, read = Ticker('Reading employer job sites', len(sources)), threading.Lock(), [0, 0]   # [sites read, jobs listed]

    took, asked = {}, {}   # seconds per site read (src/source_yield.py timed: the shared ranking is per minute); each read's "changed since?" state

    def fetch(source):
        started = time.monotonic()
        with read_methods.reading(key(source), 'plain_page' if source.get('ats') == 'careers' else 'feed_api') as counted:   # a careers page is read as a page
            with ats.conditional(feed_facts.ask(facts.get(key(source)))) as asked[key(source)]:   # a 304 comes back as ats.Unchanged
                got = feeds._fetched(fetcher, source)
            counted.failed = got[1] is not None   # a failed read is not a source read
            counted.jobs = 0 if counted.failed else read_methods.in_places(got[0])
        took[key(source)] = round(time.monotonic() - started, 1)
        source_yield.timed('employer feed', source['company'], took[key(source)])
        if cut_off[0]:   # read after the cut: left for the next run, not counted in this one
            return got
        with lock:
            read[0] += 1
            read[1] += len(got[0] or [])
            ticker.tick(read[0], f' · {read[1]:,} jobs listed')
        feeds.run_counts.looked(got[0] or [])   # this search's own number, each job once (src/run_counts.py)
        return got
    downloads, shown = [None] * len(sources), {}
    stop, begun, cut, cut_off = read_budget.deadline(), [0], read_budget.cut_at(), [False]   # no new site past its read's time, no wait past the cut
    pool = ThreadPoolExecutor(max_workers=feeds.FETCH_WORKERS)   # a few hundred feeds must fit in the job's time; not waited for at the cut
    try:
        def submit():   # the next site, in read order, unless its time is up: sites are started as others end, never all at once
            if begun[0] < len(sources) and not read_budget.over(stop, begun[0]):
                pending[pool.submit(fetch, sources[begun[0]])] = begun[0]
                begun[0] += 1
        pending = {}
        for _ in range(feeds.FETCH_WORKERS * 2):
            submit()
        while pending:
            finished, _ = wait(pending, timeout=read_budget.seconds_left(cut), return_when=FIRST_COMPLETED)
            if not finished:   # the cut: the sites still open are left for the next run (src/sources/read_budget.py cut_at)
                cut_off[0] = True
                break
            for done in finished:   # the database work stays in this thread, one site at a time
                index = pending.pop(done)
                downloads[index] = done.result()
                if on_jobs and (found := _sure(index, sources[index], downloads[index], db, now, shown)):
                    feeds.run_counts.matched(found)   # counted as each site is read; the full pass after the AI sort adds the rest, never takes one back
                    on_jobs(found)
                submit()
    finally:
        pool.shutdown(wait=not cut_off[0], cancel_futures=True)
    kept = [index for index in range(begun[0]) if downloads[index] is not None]
    read_budget.keep_left([sources[index] for index in sorted(pending.values())] + sources[begun[0]:], key, len(kept), total)
    sources, downloads = [sources[index] for index in kept], [downloads[index] for index in kept]
    where = {old: new for new, old in enumerate(kept)}   # the jobs shown early follow their site to its place in the read list
    shown = {(where[index], job): item for (index, job), item in shown.items() if index in where}
    from .. import time_budget
    time_budget.restart()   # downloading is not AI time: the places, titles and scoring after it get the whole budget (src/time_budget.py)
    report = {"generated_at": now, "sources": [], "jobs": [], "rested": len(rested), "unchanged": [source['company'] for source in same]}
    tally = feeds.coverage.Tally()
    feeds.triage_places([job for jobs, failure in downloads if not failure for job in jobs or []])   # where the new locations are: Claude, once each
    feeds.triage([job for jobs, failure in downloads if not failure for job in jobs or []])   # titles the words miss: Claude sorts the new ones, once
    for index, (source, (jobs, failure)) in enumerate(zip(sources, downloads)):
        board = f'{source.get("ats", "greenhouse")}:{source.get("slug") or source["board"]}'
        try:
            if isinstance(failure, ats.Unchanged):   # the site's list is the one judged last time: nothing new, no miss
                with db:
                    feed_facts.still_same(db, board, now)
                report["unchanged"].append(source["company"])
                continue
            if failure:
                raise failure
            matched = []
            tally.feed()
            with db:
                for job in jobs:
                    in_place, hit = feeds.wanted_location(job), feeds.wanted_title(job["title"])
                    tally.add(job["title"], in_place, hit, excluded=feeds.excluded_title(job["title"]), location=job["location"],
                              dropped_by=feeds.dropped_by(job["title"]))
                    if hit and in_place:   # one shown early is taken as it is: recorded once, still "new"
                        matched.append(shown.get((index, str(job["id"]))) or _item(source, job, feeds.record(db, board, job, now)))
            # A board whose list has no description: fetch it for the jobs kept (a handful), so they can be scored.
            detail = (details if details is not None else feeds.ats.DETAILS).get(source.get("ats", "greenhouse"))
            for item in matched if detail else []:
                if not item["description"]:
                    try:
                        item["description"] = detail(source.get("slug") or source["board"], item["id"]) or ""
                    except Exception as error:  # one posting failing must not drop the others
                        print(f'Warning: {source["company"]} {item["id"]}: description not fetched: {type(error).__name__}')
            with db:
                feeds._after_check(db, board, bool(matched), now)
                if not fixtures:
                    feed_facts.keep(db, board, now, all(feed_facts.settled(job) for job in jobs), feed_facts.tag_of(asked.get(board)), jobs)
            feeds.run_counts.matched(matched)
            report["jobs"].extend(matched)
            report["sources"].append({"company": source["company"], "ok": True,
                                      "total": len(jobs), "matches": len(matched), "seconds": took.get(board)})
        except Exception as error:
            report["sources"].append({"company": source["company"], "ok": False, "ats": source.get("ats", "greenhouse"), "slug": source.get("slug") or source.get("board"),
                                      "error": f"{type(error).__name__}: {error}"})
    report["jobs"].sort(key=lambda j: ({"new": 0, "changed": 1, "seen": 2}[j["status"]], j["company"], j["title"]))
    report["funnel"] = tally.summary()
    # How much of the employer list still brings jobs (the "Your employers" meter, owner 7 Oct 2026): feeds read, and those with a match this run.
    read = [s for s in report["sources"] if s.get("ok")]
    report["funnel"]["employers"] = {"read": len(read), "matched": sum(1 for s in read if s.get("matches")), "unchanged": len(report["unchanged"])}
    if report["unchanged"]:   # said every run, so fewer employers read is never a mystery
        print(f'Employers unchanged since your last search: {len(report["unchanged"])} not read again ({len(same)} read under '
              f'{feed_facts.FRESH_HOURS} h ago, {len(report["unchanged"]) - len(same)} said their list is the same); their jobs stay listed.')
    return report
