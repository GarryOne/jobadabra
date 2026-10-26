"""Command line entry point: python -m src <command> [options].

Commands:
  check     check for new jobs: crawl your sources, read and score new jobs, send the digest
            (modes: scheduled, run, today, more, apply); "daily" is the old name and still works
  scout     find new employers: probe a batch of candidate employers for public job feeds
  discover  crawl the job boards for employers (TechTree always; jobs.ch and SwissDevJobs when your places include Switzerland)
  feeds     crawl employer feeds only and write a local HTML report
  enrich    run AI stage 1 on pending jobs
  doctor    readiness checklist and the one next step (--next, --json)
  hosted    one hosted Always on run in the cloud container (run token in, new matches out; src/hosted_run.py)
  search_report  one finished search as counts and seconds (--since <time>; src/search_report.py)
  contribute  what "Help the pool grow" would send (--show); nothing is sent by this command
"""
import sys


def main():
    from . import crash_reporting
    crash_reporting.install()  # unhandled errors to Sentry, only when the app turned reports on (JOB_PILOTTO_SENTRY_DSN)
    commands = {
        'check': 'src.daily', 'daily': 'src.daily', 'scout': 'src.scout', 'discover': 'src.sources.boards',
        'hosted': 'src.hosted_run', 'search_report': 'src.search_report', 'feeds': 'src.sources.feeds', 'enrich': 'src.ai.enrich', 'doctor': 'src.doctor', 'contribute': 'src.contribute',
    }
    if len(sys.argv) < 2 or sys.argv[1] not in commands:
        print(__doc__)
        return 2
    name = sys.argv.pop(1)
    sys.argv[0] = f'python -m src {name}'
    import importlib
    if name == 'daily' and '--mode' in sys.argv[:-1] and sys.argv[sys.argv.index('--mode') + 1] == 'prepare' and '--job' in sys.argv:
        # Preparing one job's kit crawls and scores nothing and leaves the job cache alone (it reads it, asks the AI, writes the kit
        # to the store), so it never waits for a search and several run side by side. 10 Oct 2026: two kits sat 6+ min behind a scout run.
        return importlib.import_module(commands[name]).main() or 0
    if name == 'daily' and '--propose' in sys.argv:
        # The app's Log box, step 1: Claude reads a message and says what it would log; nothing is written (Notion or the job cache), so it
        # never waits for a search. 6 Oct 2026: it sat on "Starting… 200 s" behind a scheduled search holding the run lock.
        return importlib.import_module(commands[name]).main() or 0
    if name in ('check', 'daily', 'scout', 'discover', 'feeds'):
        # One search at a time: the app and the terminal share the job cache (src/paths.py run_lock).
        from .paths import LockTimeout, run_lock
        mode = sys.argv[sys.argv.index('--mode') + 1] if '--mode' in sys.argv[:-1] else ''
        try:
            with run_lock(label=f'{name} {mode}'.strip()):
                # ⚙️ Search settings in Notion are the source of truth: refresh the cached config before it's imported.
                if '--from-app' in sys.argv:   # the app's Log box lists the engine's steps live (desktop/lib/pipeline.js leadStepOf)
                    print('⏳ Checking your search settings in Notion', file=sys.stderr, flush=True)
                from .notion import search_settings
                search_settings.sync_quietly()
                from . import target_roles
                target_roles.migrate_quietly()   # an old file's roles and searches become one list (AI groups the short forms once)
                from . import field_redraft
                field_redraft.refresh_quietly()   # roles in another field: the words drawn from the old one are redrafted (src/field_redraft.py)
                from . import places
                places.refresh_quietly()   # "Germany", "Asia": the cities they stand for, worked out once and kept (src/places.py)
                return importlib.import_module(commands[name]).main() or 0
        except LockTimeout as error:   # the holder is stuck: say so plainly, not as a crash
            print(f'⚠️ {error}', file=sys.stderr)
            return 1
    return importlib.import_module(commands[name]).main() or 0


if __name__ == '__main__':
    from . import run_exit
    raise SystemExit(run_exit.finish(main()))   # a timed search ends at its deadline, not when its last late read does
