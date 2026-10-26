"""The Strategy page's data (strategy()), the Calendar's jobs and the sites-to-visit list (a pure move out of desktop.py).

Guarded by tests/test_strategy_goals.py, tests/test_desktop_notion_list.py, tests/test_visit_ats_feed.py, tests/test_opportunity.py.
"""
import json
import re
import sys

from . import digest, levels, target_roles
from .ai import locations, score
from .desktop_jobs import stage_status


COMPONENTS = (('role_fit', 'Role fit'), ('location', 'Location fit'), ('compensation', 'Compensation'),
              ('growth', 'Growth'), ('risk', 'Low risk'))


def _previous_locations_ids(db, stage_map):
    """The ACTIVE jobs scored with other places than the ones saved now (src/ai/locations.py); none when it cannot be told."""
    try:
        return set(locations.previous(score.load(db), locations.current())) & locations.active_ids(db, stage_map)
    except Exception:  # noqa: BLE001
        return set()


def _previous_locations(db, stage_map):
    return len(_previous_locations_ids(db, stage_map))


def _outdated_ids(db, stage_map):
    return set(score.previous_method(db)), _previous_locations_ids(db, stage_map)


def outdated(db, stage_map):
    """Strategy's one "scored using previous search settings" notice (owner, 18 Oct 2026): each job once, whatever its reasons (an older scoring
    method, other places), read from the SAVED settings. Reading it queues nothing."""
    method, places = _outdated_ids(db, stage_map)
    return {'count': len(method | places), 'method': len(method), 'places': len(places)}


def rescore_outdated(db, stage_map):
    """The notice's Re-score: queue every outdated job once for a new score (the next searches do it, 60 per search). -> how many."""
    ids = set().union(*_outdated_ids(db, stage_map))
    db.executemany("UPDATE scores SET input_hash='' WHERE job_id=?", [(job_id,) for job_id in sorted(ids)])
    db.commit()
    return len(ids)


def _readable(fragment):
    """A search regex fragment as words ("z[uü]rich" -> "zürich", "\\bsre\\b" -> "sre", '"tax"' -> "tax"): src/fragment_words.py, the twin of
    desktop/renderer/fragment-words.js (one rule for every screen)."""
    from .fragment_words import fragment_words
    return fragment_words(fragment)


# Your details' sections on the Profile (desktop/lib/profile-sections.js SECTIONS, same titles): facts, not search goals. Strategy shows
# them read-only and never takes a search value from them (owner, 17 Oct 2026: the minimum salary and the expectation stay apart).
DETAILS_SECTIONS = (('eligibility', 'Work eligibility'), ('availability', 'Availability & compensation'), ('languages', 'Languages'))


def _details_key(heading):
    """The Your details section a heading names ('## 🛂 Work eligibility' -> 'eligibility'), or ''."""
    bare = re.sub(r'^\W+', '', heading.lstrip('#').strip()).strip().lower()
    return next((key for key, title in DETAILS_SECTIONS if title.lower() == bare), '')


def _details(profile):
    """Your details' sections as {key: [{label, value}]}: their "Label: value" lines."""
    out, current = {key: [] for key, _ in DETAILS_SECTIONS}, ''
    for line in (profile or '').splitlines():
        if line.lstrip().startswith('#'):
            current = _details_key(line)
            continue
        label, _, value = line.strip().lstrip('-* ').partition(':')
        label, value = label.replace('**', '').strip(), value.replace('**', '').strip()
        if current and label and value:
            out[current].append({'label': label, 'value': value})
    return out


def _section(profile, word):
    """The first line under the Profile heading that names `word` (e.g. Compensation), or ''; never a Your details section."""
    lines, inside = profile.splitlines(), False
    for line in lines:
        if line.lstrip().startswith('#'):
            inside = word.lower() in line.lower() and not _details_key(line)
            continue
        if inside and line.strip():
            return line.strip('- ').strip()
    return ''


# The setup goals as the Profile states them (desktop/renderer/markdown-edit.js GOAL_ROWS writes them): a table row "Work mode | …" or a
# line "Minimum acceptable: …". The Strategy page shows and corrects them as the setup review does (owner, 7 Oct 2026).
GOAL_ROWS = (('seniority', r'minimum seniority|seniority'), ('work_mode', r'^work mode$'), ('languages', r'languages i can work in'),
             ('minimum_salary', r'minimum acceptable|minimum salary'))


def _goals(profile):
    found = {}
    for line in (profile or '').splitlines():
        text = line.strip().strip('|').strip()
        cells = [cell.strip().strip('*').strip() for cell in text.split(' | ')] if ' | ' in text else None
        label, value = (cells[0], cells[1]) if cells and len(cells) > 1 else (text.lstrip('-* ').partition(':')[0], text.partition(':')[2])
        label = label.replace('**', '').strip()
        for key, pattern in GOAL_ROWS:
            if key not in found and value.strip() and re.search(pattern, label, re.I):
                found[key] = value.replace('**', '').strip()
    return found


def _quietly(call):
    try:
        return call()
    except Exception:  # noqa: BLE001
        return None


def feeds_remote_wanted(search):
    from .sources.feeds import remote_wanted
    return remote_wanted(search)


def strategy(db, tracker=None, stores=None):
    """What the Strategy page shows, all from the user's own data: search settings (the cache of ⚙️ Search settings),
    preferences, the average fit components of the scored open jobs, counts, the Profile's compensation line and
    the latest 💡 Insight. The data is the active store's; `tracker` is used only while that store is Notion (as before)."""
    if stores is None:
        from .store_access import run_stores
        stores, tracker = run_stores(tracker)
    from . import role_kinds
    from .paths import CONFIG, load_search_config
    # The user's own words: with the regions and AI place words the crawl adds, the page listed a regex of every city as one "place".
    search = load_search_config(matching=False)
    roles = target_roles.view(search)   # the one list: a title is its own key, the first target_roles.SEARCHED are also job board searches
    try:
        prefs = json.loads((CONFIG / 'preferences.json').read_text())
    except (OSError, ValueError):
        prefs = {}
    unique = lambda items: list(dict.fromkeys(i for i in (_readable(x) for x in items or []) if i))
    places = search.get('locations') or {}
    candidates, _ = digest.eligible_jobs(db)
    fits = score.load(db)
    scored = [fits[job['id']] for job in candidates if job['id'] in fits]
    components = []
    for key, label in COMPONENTS:
        # A part can be None (pay fit "N/A" when the posting states no salary, 6a3f5bb): averaged over the known ones, as insights.py does.
        values = [fit['components'][key] for fit in scored if isinstance(fit.get('components'), dict) and isinstance(fit['components'].get(key), (int, float))]
        if values:
            average = round(sum(values) / len(values))
            components.append({'key': key, 'label': label, 'value': 100 - average if key == 'risk' else average})  # risk: lower is better
    stages, stage_map = {}, {}   # stage -> how many; job url -> stage (read once, also for the refresh of older places)
    insight, compensation, goals, profile, details = None, '', {}, None, _details('')
    def latest_insight():
        """The newest insight in the active store, not the Interviews page's own row (Interview patterns)."""
        found = stores
        rows = [r for r in found.insights.list(limit=5) if r['category'] != 'Interview patterns'][:1]
        return [{**rows[0], 'url': found.link(rows[0]['id']) or ''}] if rows else []
    if tracker:
        from .notion.client import together
        quiet = lambda call: lambda: _quietly(call)  # a failed read leaves its part empty; the rest still shows
        url_stages, profile, rows = together(quiet(tracker.url_stages), quiet(tracker.page_text), quiet(latest_insight))
        stage_map = url_stages or {}
        for stage in stage_map.values():
            stages[stage] = stages.get(stage, 0) + 1
        goals, details = _goals(profile), _details(profile)
        compensation = goals.get('minimum_salary') or _section(profile or '', 'compensation') or _section(profile or '', 'salary')
    else:
        rows = _quietly(latest_insight)
        if stores.name != 'notion':   # this Mac's store: its applications and its Profile
            from .store_access import url_stages as stages_of
            stage_map = _quietly(lambda: stages_of(stores)) or {}
            for stage in stage_map.values():
                stages[stage] = stages.get(stage, 0) + 1
            profile = _quietly(lambda: stores.texts.get('profile')) or None
    if rows:
        insight = {'headline': rows[0]['title'] or '', 'action': (rows[0]['fields'] or {}).get('action') or '',
                   'url': rows[0]['url']}
    from .paths import local_profile
    # Trying (no Notion): the Profile is on this Mac. Also when Notion gave no Profile and the app passed a local one (only in Trying or the demo,
    # whose Notion is fictional: desktop/lib/pipeline.js), so the demo's goals show.
    if not tracker or (profile is None and local_profile()):
        own_text = local_profile() or ('' if tracker else profile or '')
        goals, details = _goals(own_text), _details(own_text)
        compensation = goals.get('minimum_salary') or _section(own_text, 'compensation')
    stale = 0
    if tracker or profile:  # jobs whose fit score waits for the new Profile ("Scores updating"), re-scored over the next searches
        try:
            from .paths import local_profile
            stale = score.stale_count(db, candidates, local_profile() or (tracker.page_text() if tracker else profile))
        except Exception:  # noqa: BLE001
            pass
    # The Profile still the empty template (an import or a new workspace): fit scores are paused (score.unfilled); the page says so.
    from .paths import local_profile
    own = local_profile()
    profile_empty = score.unfilled(own) if own else (score.unfilled(profile) if (tracker or stores.name != 'notion') and profile is not None else False)
    sent = sum(n for stage, n in stages.items() if stage not in ('Saved', 'Kit ready', 'Applying', 'Dismissed', 'Closed', 'Recruiter lead'))
    return {
        'roles': unique([role['title'] for role in roles]),
        # The top cities, the country, the cities abroad (the long lists of nearby towns and spellings stay out).
        'locations': unique((places.get('top_tier') or [])[:3] + (places.get('country_wide') or [])[:1] + (places.get('abroad') or [])),
        'stack': unique(search.get('quality_stack_keywords'))[:8],
        # The same lists in full, for editing them on the Strategy page: each entry as stored (removing sends it back) and as words.
        # Roles carry their kind (src/role_kinds.py), so the Strategy page groups them into families (Retail, Logistics…).
        'lists': {'roles': [{'fragment': role['title'], 'label': role['title'], 'kind': role_kinds.kind_of(role['title']), 'searched': i < target_roles.SEARCHED}
                            for i, role in enumerate(roles)],
                  **{name: [{'fragment': str(item), 'label': _readable(item), **({'kind': role_kinds.kind_of(_readable(item))} if name == 'roles' else {})}
                         for item in items or [] if _readable(item)]
                  for name, items in (('places', places.get('top_tier')),
                                      ('country', places.get('country_wide')), ('abroad', places.get('abroad')), ('searchOverride', places.get('search_override')),
                                      ('stack', search.get('quality_stack_keywords')), ('rights', prefs.get('work_rights')),
                                      ('remoteSkip', search.get('remote_excluded_regions')), ('titleSkip', search.get('title_exclude_keywords')), ('finders', search.get('board_discovery_keywords')))}},
        # Plain lists, shown as written: board search phrases and the languages that hide a job.
        'texts': {'languages': [str(q) for q in prefs.get('disqualifying_languages') or []],
                  # What only the ⚙️ Search settings page showed (desktop/lib/strategy-edit.js edits them): a Google Jobs place as the page writes it.
                  'skip': [str(q) for q in prefs.get('excluded_companies') or []],
                  'gqueries': [str(q) for q in (search.get('google_jobs') or {}).get('queries') or []],
                  'gplaces': [' · '.join(filter(None, (p.get('location'), p.get('language')))) for p in (search.get('google_jobs') or {}).get('locations') or []
                              if isinstance(p, dict) and p.get('location')]},
        'digest_min_score': prefs.get('digest_min_score'),
        'remote_jobs': feeds_remote_wanted(search),
        'relocation': locations.places(search)['relocation'],   # Yes / No / Not specified are all answers (Locations, 17 Oct 2026)
        'goals': goals,
        'details': details,   # Your details' facts, shown read-only ("Edit in Your details")
        'level': levels.level_of(search.get('level')),
        'compensation': compensation,
        'avoid': [f'Requires {language}' for language in prefs.get('disqualifying_languages') or []]
                 + [f'Company: {name}' for name in prefs.get('excluded_companies') or []]
                 + [f'Title: {word}' for word in unique(search.get('title_exclude_keywords'))[:6]]
                 + [f'Remote only from {region}' for region in unique(search.get('remote_excluded_regions'))[:3]],
        'components': components, 'scored': len(scored), 'stale': stale, 'previous': len(score.previous_method(db)), 'previous_locations': _previous_locations(db, stage_map), 'outdated': outdated(db, stage_map), 'profile_empty': profile_empty,
        'counts': {'matches': len(scored), 'kits': stages.get('Kit ready', 0), 'sent': sent},
        'insight': insight,
    }


def calendar_jobs(stores, tracker=None):
    """What the Calendar reads from a job: its Next interview, and the fields a meeting shows. Applications rows only, so it
    skips the Job Matches database (every job a search found), which made the page wait ~10 s for a list it barely used.
    The active store's applications; Notion's read through the tracker, as before."""
    if stores.name == 'notion' and not tracker:
        return {'jobs': [], 'error': 'Notion is not connected.'}
    try:
        found = tracker.notion_jobs(matches=False) if tracker else \
            [{**row, 'notion_url': stores.link(row['id']) or '', 'page_id': row['id']} for row in stores.applications.list()]
    except Exception as error:  # noqa: BLE001 — shown on the page; the saved copy stays
        where = 'Notion' if tracker else 'Your job tracker'
        return {'jobs': [], 'error': f'{where} could not be read ({type(error).__name__}).'}
    # page_id: the job's id in its store (Notion: its page), what a meeting is dismissed by and a recording matched to (renderer/calendar.js page).
    keep = ('url', 'title', 'company', 'stage', 'notion_url', 'next_interview', 'page_id')
    return {'jobs': [{**{key: job.get(key) or '' for key in keep}, 'status': stage_status(job.get('stage'))} for job in found]}


def _visits(search):
    """Sites only you can open, for the Strategy card and the "Few new jobs" chips (src/sources/visits.py)."""
    from . import role_kinds
    from .sources import visits
    try:
        return visits.visit_list(search, role_kinds.of_search(search))
    except Exception as error:  # noqa: BLE001 — said, then no chips
        print(f'Warning: sites to visit not listed ({type(error).__name__}: {error})', file=sys.stderr)
        return []
