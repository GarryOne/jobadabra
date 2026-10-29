# Browser-reading command handlers for the desktop JSON dispatcher.
import json
import sys
from pathlib import Path

from .ai import providers


# -> acknowledgment after remembering browser visit outcomes.
def _visit_outcome(db, args):
    from .sources import visits
    visits.outcome(json.loads(Path(args.file).read_text()))
    return {'ok': True}, True


# -> acknowledgment after hiding a browser-only site.
def _visit_hide(db, args):
    from .sources import visits
    visits.hide(args.url)
    return {'ok': True}, True


# -> the open jobs whose posting needs the browser.
def _stuck_jobs(db, args):
    from .sources import describe
    return {'ok': True, 'jobs': describe.stuck(db)}, False


# -> acknowledgment after dismissing an unread job.
def _stuck_dismiss(db, args):
    from .sources import visits
    visits.dismiss(args.url)
    return {'ok': True}, True


# -> the result of saving browser-read posting text.
def _set_description(db, args):
    from .sources import describe
    data = json.loads(Path(args.file).read_text())
    return {'ok': True, 'saved': describe.save_text(db, data.get('url') or '', data.get('text') or '')}, True


# -> the search words and places for a browser session.
def _visit_context(db, args):
    from .notion.search_settings import terms
    from .paths import load_search_config
    search = load_search_config(matching=False)
    places = search.get('locations') or {}
    return {'role_words': terms(search.get('role_keywords'))[:10], 'places_first': terms(places.get('top_tier'))[:6],
                      'places_also': terms((places.get('country_wide') or []) + (places.get('abroad') or []))[:6],
                      'title_words_ruled_out': terms(search.get('title_exclude_keywords'))[:12]}, False


# -> the next steps toward a job list, or the planner error.
def _visit_unblock(db, args):
    from .ai import visit_unblock
    from .paths import load_search_config
    from .digest import PREFERENCES
    page = json.loads(Path(args.file).read_text())
    try:
        planned = visit_unblock.plan_twice(page, load_search_config(matching=False), PREFERENCES)
    except Exception as error:  # noqa: BLE001 — said to the extension, which stops the site with this reason
        return {'ok': False, 'error': f'{providers.who()} could not find a way to the jobs ({type(error).__name__})'}, True
    print(f"Visit unblock: {len(planned['steps'])} steps for {str(page.get('url') or '')[:80]}: "
          + '; '.join(f"{s['action']} {s['label'][:40]}{' = ' + s['value'] if s['value'] else ''}" for s in planned['steps'])
          + (f" (needs you: {planned['needs_person']})" if planned['needs_person'] else '')
          + (' (Sonnet, after Haiku found no way)' if planned.get('model') == visit_unblock.SECOND_MODEL else ''), file=sys.stderr)
    return {'ok': True, **planned}, False


# -> the search filter steps, or the planner error.
def _visit_filters(db, args):
    from .ai import visit_filters
    from .paths import load_search_config
    from .digest import PREFERENCES
    page = json.loads(Path(args.file).read_text())
    try:
        planned = visit_filters.plan(page, load_search_config(matching=False), PREFERENCES)
    except Exception as error:  # noqa: BLE001 — said to the extension, which then reads the page as it is
        return {'ok': False, 'error': f'{providers.who()} could not choose the filters ({type(error).__name__})'}, True
    print(f"Visit filters: {len(planned['steps'])} steps for {str(page.get('url') or '')[:80]}: "
          + '; '.join(f"{s['action']} {s['label'][:40]}{' = ' + s['value'] if s['value'] else ''}" for s in planned['steps']), file=sys.stderr)
    return {'ok': True, **planned}, False


# -> the kept recipe after any requested invalidation.
def _visit_recipe(db, args):
    from .sources import visits
    page = json.loads(Path(args.file).read_text())
    if page.get('forget'):
        visits.forget_recipe(page['url'])
    forgot = bool(page.get('missed')) and visits.recipe_missed(page['url'])
    return {'ok': True, 'forgot': forgot, 'recipe': None if page.get('forget') or forgot else visits.recipe_for(page['url'])}, True


# -> the learned page recipe, or the reader error.
def _visit_understand(db, args):
    from .sources import visits
    page = json.loads(Path(args.file).read_text())
    from .ai import visit_reader
    try:
        recipe, model = visit_reader.understand_twice(page)
        if model == visit_reader.SECOND_MODEL:   # said, so the log shows whether the second try pays off
            print(f"Visit: Haiku found no job list on {str(page.get('url') or '')[:80]}; Sonnet did", file=sys.stderr)
        elif not recipe and page.get('groups'):
            print(f"Visit: no job list on {str(page.get('url') or '')[:80]}, by Haiku nor Sonnet", file=sys.stderr)
    except Exception as error:  # noqa: BLE001 — said; the extension reads what its quick guess found
        return {'ok': False, 'error': f'{providers.who()} could not read this page ({type(error).__name__})'}, True
    if recipe:
        visits.save_recipe(page['url'], recipe)
    return {'ok': True, 'recipe': recipe}, False


# -> the results saved by a browser-reading session.
def _visit_session(db, args):
    from .sources import visits
    return {'ok': True, 'result': visits.session_result(args.session)}, False


# -> the job-list addresses for the requested sites.
def _visit_jobpages(db, args):
    from .sources import visits
    from . import employer_index
    sites = json.loads(Path(args.file).read_text())
    return {'ok': True, 'pages': visits.find_job_pages(sites, employer_index.me_now().get('countries') or [])}, True


# -> the job-list address found in a supplied page.
def _visit_jobpage(db, args):
    from .sources import visits
    page = json.loads(Path(args.file).read_text())
    return {'ok': True, 'url': visits.job_page(page['url'], page.get('html') or '')}, True


# -> the refused sites due for the requested browser read.
def _refused_queue(db, args):
    from .sources import refused_reads
    return {'ok': True, 'sites': refused_reads.queue(now_hosts=args.now, everything=args.all)}, False


# -> the state of the page read in the real browser tab.
def _refused_judge(db, args):
    from .sources import refused_state
    page = json.loads(Path(args.file).read_text())
    return {'ok': True, 'state': refused_state.page_state(page.get('status'), str(page.get('html') or ''), str(page.get('title') or ''), str(page.get('final') or ''))}, True


