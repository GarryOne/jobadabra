# Tracker-backed command handlers for the desktop JSON dispatcher.


# -> the tracker only for commands that previously reached the tracker branch.
def _tracker():
    from .notion.client import Tracker
    return Tracker.from_env()


# -> the result of reverting an unfinished application.
def _unapply(db, args):
    tracker = _tracker()
    from .stores import open_stores, rules
    stores = open_stores(tracker=tracker)  # Notion when connected, else this Mac's store: no gate
    try:
        outcome = rules.revert_applying(stores, args.url)
    except Exception as error:  # noqa: BLE001 — shown to the user; nothing changed
        return {'ok': False, 'error': f'Your job tracker could not be updated ({type(error).__name__}); nothing changed. Try again.'}, True
    return {'ok': True, 'notion': outcome}, True


# -> the result of undoing an unconfirmed Applied and its events.
def _not_submitted(db, args):
    tracker = _tracker()
    from .stores import open_stores, rules
    stores = open_stores(tracker=tracker)  # Notion when connected, else this Mac's store: no gate
    # The owner says an Applied was wrong. Only a bare Applied is undone, and its false 📈 event goes with
    # it, so the application's timeline does not keep a submission that never happened (1 Oct 2026).
    try:
        outcome, row = rules.revert_unsubmitted(stores, args.url)
        dropped = stores.events.archive(row['id'], 'Applied') if outcome == rules.UPDATED and row else 0
    except Exception as error:  # noqa: BLE001 — shown to the user; nothing changed
        return {'ok': False, 'error': f'Your job tracker could not be updated ({type(error).__name__}); nothing changed. Try again.'}, True
    errors = {'unchanged': 'That job is not at Applied, so there is nothing to undo.',
              'past': 'That job is past Applied (a confirmation or an interview is recorded), so its stage is not changed here.'}
    return {'ok': outcome == rules.UPDATED, 'notion': outcome, 'events': dropped,
                      **({} if outcome == rules.UPDATED else {'error': errors[outcome]})}, True


# -> the fingerprint of the current search places.
def _places_now(db, args):
    _tracker()   # Why (qf 4/8): the old shared step built the tracker for every tracker command; kept, so the same calls and failures happen
    from .ai import locations
    return {'places': locations.fingerprint_now()}, True


# -> the clear-job plan or the requested clearing result.
def _clear_jobs(db, args):
    tracker = _tracker()
    from . import clear_jobs
    from .store_access import run_stores
    stores, _ = run_stores(tracker)
    keep = True   # the person's own dismissals always stay
    try:
        result = clear_jobs.plan(db, stores, keep) if args.dry_run else {'ok': True, **clear_jobs.clear(db, stores, keep)}
    except Exception as error:  # noqa: BLE001 — shown to the person; the store is written first, so a refusal changed nothing local
        result = {'ok': False, 'error': f'Your job list could not be cleared ({type(error).__name__}); nothing changed. Try again.'}
    return result, False


# -> the number of outdated scores queued for refresh.
# Strategy's one Re-score: every outdated job once (src/desktop_strategy.py outdated)
def _rescore_outdated(db, args):
    tracker = _tracker()
    from .desktop_strategy import rescore_outdated
    from .store_access import run_stores, url_stages
    stores, _ = run_stores(tracker)
    try:
        stages = url_stages(stores)
    except Exception:  # noqa: BLE001 (stages that cannot be read: every shown job counts as active)
        stages = {}
    return {'queued': rescore_outdated(db, stages)}, True


# -> the number of active jobs queued for a places refresh.
# the explicit refresh after a change of places: active jobs only (src/ai/locations.py)
def _refresh_locations(db, args):
    tracker = _tracker()
    from .ai import locations
    from .store_access import run_stores
    from .store_access import url_stages
    stores, _ = run_stores(tracker)
    try:
        stages = url_stages(stores)
    except Exception:  # noqa: BLE001 (stages that cannot be read: every shown job counts as active)
        stages = {}
    active = locations.active_ids(db, stages)
    if args.url:
        active &= locations.id_for_url(db, args.url)
    return {'queued': locations.refresh(db, locations.current(), active)}, True


# -> the strategy advice from the chosen store outcomes.
def _tune(db, args):
    tracker = _tracker()
    from .store_access import run_stores, url_stages
    stores, notion = run_stores(tracker)
    if stores.name == 'notion' and not notion:   # Notion chosen but not readable: as before
        return {'ok': False, 'error': 'Connect Notion first: your outcomes (dismissed, applied, interviews) live there.'}, True
    from . import tune
    from .paths import load_search_config
    return tune.run(db, notion, load_search_config(), stages=url_stages(stores)), False


