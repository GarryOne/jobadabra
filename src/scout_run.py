# Named phases of the scout crawl, preserving its scheduling and write order.
"""Invariants: only the caller thread writes the database; results keep candidate order.
The scout argument is the public module's dependency seam, retaining its exported names
and the existing offline fakes. Worker-only notes are collected until probing ends.
"""
import json
import os
import re
from concurrent.futures import ALL_COMPLETED, FIRST_COMPLETED
from datetime import timedelta
from . import budget_tape, read_methods, run_exit, employer_index, scout_need, scout_queue, scout_role_search, scout_core
from .sources import ats, careers


# Announce the lists and return the origins this search leaves out.
def read_lists(scout, db, seeds):
    # Each step says so as it starts: a run takes minutes, and the app's live log shows these lines ("Nothing to show yet" for four
    # minutes was the owner's find of 5 Oct 2026).
    from .ai import scout_ideas
    skip = scout.skipped_origins(seeds, scout_ideas.technical(scout.load_search_config()))
    print('Scout: reading the employer lists…' if not skip else
          'Scout: reading the employer lists (your roles are outside IT, so the tech company lists are left out)…')
    scout.ensure_tables(db)
    return skip


# Start the shared deadline and decide whether this search needs more names.
def name_budget(scout, db, harvest_sources, budget):
    # The budget counts from here, not from the first check (19 Oct 2026: a driver's 180 s scout ran 638 s: a Wikidata timeout, the AI's ideas
    # and the role searches ran before the clock started). The steps that only add names start while half of it is left: the checks keep theirs.
    deadline = scout.time.monotonic() + budget if budget else None
    run_exit.until(None if scout_core.CENTRAL else deadline)   # the app's scout exits at it (the central one: scout_overrun)
    may_add = budget_tape.until('scout names', deadline - budget / 2 if budget else None)
    # Central + Mac only when thin (owner, 20 Oct 2026): a search the shared list already covers adds no names; only the person's own are checked.
    have = None if scout_core.CENTRAL or harvest_sources is not None else scout_need.covered(db=db)
    if have:
        print(f'Scout: the shared list already has {have} employers for your kind of work in your places, so no new names today; '
              'checking only the ones you added.')
        may_add = lambda: False   # noqa: E731
    return deadline, may_add, have


# Harvest the lists, met employers, ideas and role searches in their existing order.
def harvest_names(scout, db, seeds, stores, harvest_sources, skip, budget, deadline, may_add, have):
    # New names every run, however long the queue (owner, 18 Oct 2026: the old 100-name pause froze them for 12 days): the queue is worked in
    # order of each source's yield, and a source with no feed in many checks stops waiting (src/scout_queue.py).
    added = 0 if have else scout.harvest(db, seeds, harvest_sources, skip, until=None if scout_core.CENTRAL or not budget else deadline - budget / 2)   # Why (27 Oct 2026, in scout.run until qf 5/8): a list's 504 ran 93 s
    added += scout.harvest_met(db, seeds, stores, skip) if harvest_sources is None else 0   # the employers the person met: even on a day with no new names
    if not have:
        print(f'Scout: {added} new candidate(s) from the lists; asking the AI for ideas…')
    ideas = scout.ai_ideas(db, harvest_sources) if may_add() else None
    if ideas:
        added += scout.harvest(db, seeds, [lambda: ideas['candidates']], skip)
    searched = scout_role_search.guarded(db, scout.load_search_config(), harvest_sources) if may_add() else None
    if searched and searched['candidates']:
        added += scout.harvest(db, seeds, [lambda: searched['candidates']], skip)
    if budget and not may_add() and not have:
        print('Scout: half its time is gone, so no more new names this run; the checks get the rest.')
    return added, ideas


# Expire low-yield lists and replace shared dead ends with the next queued names.
def plan_candidates(scout, db, batch, skip, have):
    expired = scout_queue.expire(db)
    if expired:
        print('Scout: no longer waiting on ' + ', '.join(f'{n} from {kind} (no feed in its first checks)' for kind, n in expired.items()) + '.')
    batch = scout.batch_for(scout.pending_count(db), batch)
    candidates, left = [c for c in scout.next_batch(db, batch, skip) if not have or scout.counts_when_covered(c)], 0
    # Employers some install (or the central scout) found with no readable job site lately are not probed again here; the next names take
    # their places, so a run probes its whole batch (7 Oct 2026: 52 of 92 were left out and the run checked 40).
    dead = scout_core.SHARED_DEAD if scout_core.CENTRAL else employer_index.central_nofeed()
    for _ in range(10):
        skipped = [c for c in candidates if scout.key_for(c['name']) in dead and c['status'] != 'manual']
        if not skipped:
            break
        later = (scout.now() + timedelta(days=30)).isoformat(timespec='seconds')
        for c in skipped:
            db.execute("UPDATE scout_candidates SET status='none', checked_at=?, next_check=?, checked_with=? WHERE key=?",
                       (scout.now().isoformat(timespec='seconds'), later, scout.READERS, c['key']))
        db.commit()
        left += len(skipped)
        candidates = [c for c in scout.next_batch(db, batch, skip) if not have or scout.counts_when_covered(c)]   # those left out wait 30 days; the next come in
    if left and not scout_core.CENTRAL:
        from . import pool_served
        pool_served.count('names_tried', left)   # steps skipped thanks to other installs (owner's number)
    if left:
        print(f'Scout: {left} employer(s) left for 30 days: other installs found no readable job site there lately; others took their places.')
    print(f'Scout: checking {len(candidates)} employer(s)…')
    return candidates, left


# Prepare the active feed keys and optional fallback searches before checking.
def probe_options(scout, db, stores, static, harvest_sources):
    active = {(s.get('ats', 'greenhouse'), s.get('slug') or s['board']) for s in scout.active_sources(db, stores, static)}
    active |= {(r['ats'], r['slug']) for r in db.execute('SELECT ats, slug FROM feed_sources')}   # also one switched off: it is not new

    # A web search for an employer's own job site, when a key allows it (web_search.py); never for the end-to-end journey's fixtures.
    from .sources import web_search
    language = next((loc.get('language') for loc in (scout.load_search_config().get('google_jobs') or {}).get('locations') or [] if isinstance(loc, dict)), '')
    search = None if harvest_sources is not None or os.getenv('JOB_PILOTTO_FIXTURE_DIR') or not web_search.provider() else\
        (lambda name: web_search.job_sites(name, language))
    if search:
        print(f'Scout: employers with no job site found are looked up with a web search ({web_search.provider()}).')
    # jobs.ch for an employer with no job site we can read: Swiss places only (it lists Swiss employers), never for the fixtures.
    from .sources import boards as job_boards
    lookup = None if harvest_sources is not None or os.getenv('JOB_PILOTTO_FIXTURE_DIR') or job_boards.swiss_place_word(scout.load_search_config()) is None\
        else (lambda name: ats.jobsch_find(name, scout.key_for))
    return active, search, lookup


# Build worker checks and their unread-system and discovered-site notes.
def make_checks(scout, candidate_count, probe, active, search, lookup):
    unread = []   # job systems a careers page named that could not be read: (system, why, company)

    done = []
    read_methods.reset(persist=False)   # the run record's tally, never the search's saved one

    # Isolate one failed check and emit its locked completion count.
    def check(candidate):
        try:
            return check_one(candidate)
        except Exception as error:  # noqa: BLE001  one employer's odd site must not end the run (7 Oct 2026: a TypeError at 90 of 91 lost them all)
            print(f"Warning: {candidate['name']} could not be checked: {type(error).__name__}: {str(error)[:160]}; counted as no job site we can "
                  'read, and checked again when the readers change')
            return {'status': 'none', 'outcome': 'unreachable'}
        finally:
            with scout.PROGRESS_LOCK:
                done.append(candidate['name'])
                scout.progress_line(f"Scout: checked {len(done)} of {candidate_count()}: {candidate['name']}")

    note_site = []   # (candidate key, job site a web search found but nobody could read): saved as its careers address
    # Read and classify one employer without writing the database.
    def check_one(candidate):
        if candidate['status'] == 'manual':
            return {'status': 'manual'}
        with read_methods.reading(candidate['key'], 'feed_api') as read:   # how this employer's jobs were read (src/read_methods.py)
            found = scout.find_feed(candidate, probe, note=lambda system, slug, why: unread.append((system, why, candidate['name'])), search=search,
                              jobsch_lookup=lookup)
            read_methods.found(read, found)
        if not found:
            site = candidate.get('found_site') or candidate.get('careers') or candidate.get('website') or ''
            if candidate.get('found_site'):   # where a person would land from "<company> jobs": the address to open, for everyone after
                note_site.append((candidate['key'], candidate['found_site']))
            why = careers.REFUSALS.get(re.sub(r'^https?://(www\.)?', '', site).split('/')[0].lower()) if site else None
            if why:   # its site refuses automated visitors: a person can still open it (src/sources/visits.py)
                from .sources import visits
                visits.refused(candidate['name'], site if '//' in site else f'https://{site}', why)
            return {'status': 'none', 'outcome': 'refused' if why else 'no_feed'}
        system, slug, jobs = found
        if not jobs:
            return {'status': 'watch', 'ats': system, 'slug': slug}
        score, stats = scout.quality(jobs)
        useful = stats['preferred'] >= 1 or (candidate['tier'] == 'Tier 1' and stats['relevant'] >= scout.TIER1_MIN_RELEVANT)
        status = 'duplicate' if (system, slug) in active else ('found' if useful else 'low')
        return {'status': status, 'ats': system, 'slug': slug, 'quality': score, 'stats': stats}

    return check, note_site, unread


# Own the run timestamp and immediate-share tally for each sequential save.
def make_recorder(scout, db, stores):
    stamp = scout.now()
    shared = {'found': [], 'none': [], 'failed': 0}   # the instant shares of this run, said once at the end (7 Oct 2026)
    # Commit one completed check, share it, then update its employer store row.
    def save(candidate, outcome):
        """One checked employer, written at once: a run stopped halfway keeps what it checked (7 Oct 2026)."""
        status = 'found' if outcome['status'] == 'duplicate' else outcome['status']
        next_check = (stamp + timedelta(days=scout.RECHECK_DAYS[status])).isoformat(timespec='seconds')\
            if status in scout.RECHECK_DAYS else None
        db.execute("""UPDATE scout_candidates SET status=?, ats=COALESCE(?, ats), slug=COALESCE(?, slug), quality=?,
            stats_json=?, checked_at=?, next_check=?, checked_with=?, outcome=? WHERE key=?""",
                   (status, outcome.get('ats'), outcome.get('slug'), outcome.get('quality'),
                    json.dumps(outcome.get('stats')) if outcome.get('stats') else None,
                    stamp.isoformat(timespec='seconds'), next_check, scout.READERS, outcome.get('outcome'), candidate['key']))
        if outcome['status'] == 'found':
            db.execute("""INSERT OR IGNORE INTO feed_sources (ats, slug, company, tier, quality, added_at)
                VALUES (?, ?, ?, ?, ?, ?)""", (outcome['ats'], outcome['slug'], candidate['name'], candidate['tier'],
                                               outcome['quality'], stamp.isoformat(timespec='seconds')))
        db.commit()
        if not scout_core.CENTRAL and outcome['status'] in ('found', 'none'):   # to the central list right away (opt-in): closing the app loses nothing
            from . import contribute
            if outcome['status'] == 'found':
                ok = contribute.share_now(feed={'ats': outcome['ats'], 'slug': outcome['slug'], 'company': candidate['name'][:120],
                                           'how': contribute.how_of(candidate.get('origin')), 'site': candidate.get('careers') if str(candidate.get('careers') or '').startswith('https://') else None,
                                           'jobs': int((outcome.get('stats') or {}).get('jobs') or 0)})
            else:
                site = re.sub(r'^https?://(www\.)?', '', candidate.get('website') or '').split('/')[0].lower() or None
                ok = contribute.share_now(dead={'company': candidate['name'][:120], 'host': site, 'outcome': outcome.get('outcome') or 'no_feed'})
            if ok:
                shared[outcome['status']].append(candidate['name'])
            elif contribute.enabled():
                shared['failed'] += 1
        if stores and outcome['status'] != 'duplicate':
            try:
                scout.write_employer(stores, candidate, outcome)
                scout.mark_synced(db, candidate['key'], stores)
            except Exception as error:
                print(f"Warning: {scout.not_updated(stores, candidate['name'])}: {type(error).__name__}: {error}")


    return save, shared


# Submit up to the original worker limit while the budget permits another check.
def submit_more(scout, pool, check, todo, futures, began, workers, may_start):
    while len(futures) < workers and may_start():
        nxt = next(todo, None)
        if nxt is None:
            return
        future = pool.submit(check, nxt[1])
        futures[future], began[future] = nxt[0], scout.time.monotonic()


# Wait for the same completion set and discard checks still open at the deadline.
def wait_finished(scout, futures, deadline):
    remaining = 5 if deadline is None else deadline - scout.time.monotonic()   # Why (27 Oct 2026: 379 s of 180; run 40454138418: 181 s; in scout.run until qf 5/8): the end waits its
    late = remaining <= 1   # last second (0.25 s at least: a tape's check ends just after), what ends by then is kept; not named `left`, the set-aside count the summary returns ("-0.00025 set aside")
    finished, _ = scout.wait(list(futures), timeout=max(0.25, remaining) if late else min(5, remaining - 1), return_when=ALL_COMPLETED if late else FIRST_COMPLETED)
    futures = {f: i for f, i in futures.items() if f in finished} if late else futures
    return finished, futures


# Run the bounded worker pool and save each completion on the caller thread.
def probe_parallel(scout, candidates, check, save, workers, deadline):
    # Each employer is saved as it is checked, on this thread (the database is not shared); a stop (SIGTERM) leaves at once (cron_runs.py).
    # A time budget (SCOUT_BUDGET_S, owner 7 Oct 2026: "runs for too long"): no check starts after it; the rest wait for the next run.
    outcomes = [None] * len(candidates)
    may_start = budget_tape.until('scout', deadline)   # a tape's replay starts what its recording did
    pool = scout.ThreadPoolExecutor(max_workers=workers * 4)   # a check that outlives its limit keeps its thread, so there are spare ones
    try:
        todo, futures, began = iter(enumerate(candidates)), {}, {}
        submit_more(scout, pool, check, todo, futures, began, workers, may_start)
        while futures:
            finished, futures = wait_finished(scout, futures, deadline)
            for future in finished:
                i = futures.pop(future)
                outcomes[i] = future.result()
                save(candidates[i], outcomes[i])
            for future in [f for f in futures if scout.time.monotonic() - began[f] > scout_core.CHECK_LIMIT_S]:   # stop waiting; its thread ends when it ends
                i = futures.pop(future)
                print(f"Warning: {candidates[i]['name']} took over {scout_core.CHECK_LIMIT_S // 60} min to check; counted as unreachable, checked again in a week")
                outcomes[i] = {'status': 'none', 'outcome': 'unreachable'}
                save(candidates[i], outcomes[i])
            submit_more(scout, pool, check, todo, futures, began, workers, may_start)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return outcomes


# Report the elapsed budget and return only candidates whose checks were kept.
def keep_completed(candidates, outcomes, budget):
    if None in outcomes:
        done_now = sum(1 for o in outcomes if o is not None)
        span = f'{budget // 60} min' if budget >= 60 else f'{budget} s'
        print(f'Scout: its {span} are up: {done_now} of {len(candidates)} checked; the other {len(candidates) - done_now} wait for the next run.')
        kept = [(c, o) for c, o in zip(candidates, outcomes) if o is not None]
        candidates, outcomes = [c for c, _ in kept], [o for _, o in kept]
    return candidates, outcomes


# Save worker notes, report instant shares and return the unchanged run summary.
def finish_run(scout, db, candidates, outcomes, note_site, unread, shared, skip, left, added, ideas, have):
    for key, url in note_site:
        db.execute("UPDATE scout_candidates SET careers = ? WHERE key = ? AND COALESCE(careers, '') = ''", (url, key))
    scout.record_unread(db, unread)

    if shared['found'] or shared['none'] or shared['failed']:
        names = lambda items: ', '.join(items[:10]) + (f' and {len(items) - 10} more' if len(items) > 10 else '')  # noqa: E731
        print(f"Pool: shared {len(shared['found'])} new employers ({names(shared['found']) or 'none'}) and {len(shared['none'])} dead ends "
              f"({names(shared['none']) or 'none'}) as they were found" + (f"; {shared['failed']} not sent, the end-of-run share carries them" if shared['failed'] else ''))
    where, params = scout.skipping(skip)
    queued = db.execute(f"SELECT COUNT(*) FROM scout_candidates WHERE status = 'pending' {where}", params).fetchone()[0]
    total_feeds = db.execute('SELECT COUNT(*) FROM feed_sources WHERE active = 1').fetchone()[0]
    # Each run checks names it never checked before (pending), and only re-checks one whose wait is over (RECHECK_DAYS): said in the card, so
    # "15 checked" is never read as the same list again (6 Oct 2026).
    first = sum(1 for c in candidates if not c.get('checked_at'))
    return {'checked': len(candidates), 'first_time': first, 'left': left, 'harvested': added, 'queued': queued, 'total_feeds': total_feeds,
            'ideas': {k: ideas[k] for k in ('companies', 'directories', 'note')} if ideas else None, **({'covered': have} if have else {})},\
        list(zip(candidates, outcomes))


