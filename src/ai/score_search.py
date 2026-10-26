"""The fit score's second view: fit to the person's search apart from fit to their CV (owner, 26 Oct 2026: "Show them, flag the gap", for a
search in another field than the CV). The pilot search found 13 First Officer jobs; each was scored against a software CV, 0-25, "Unrelated
role: Pilot vs software developer", and none reached the digest: the scorer never saw the search. Now the engine writes the search's roles
into the request (block) and the scorer's fixed answer has a `search` part: the fit to those roles (whatever the CV shows), whether the search
is a career change (another field than the profile's experience) and one line on what the profile lacks. On a career change the job is ranked
and shown by its fit to the search (apply: the ring, the digest and the Jobs list read 'score'); the CV's own fit is kept as 'cv_fit'.
A score made before this part existed, under the digest's bar, for a title the current search wants, is scored again once (again_ids).
On a career change, a title the AI's title check says is a role of the search is shown at SEARCH_ROLE_FIT at least (owner's pick, 26 Oct
2026: "Use the title check"): Free AI's open model rated his 13 First Officer jobs 0-30 for his pilot search while Claude rated them 55-95;
the title check is one yes/no question open models answer well (src/sources/feeds.py judged_title; tests/test_score_title_floor.py).
That check reads the title alone and keeps what could fit, so it lifted "Spécialiste Support Pilotage et Comptabilité" (accounting) and a
flight-controls engineer into his digest (04:21 run, 26 Oct 2026; owner: "Yes, fix both"): a lift also needs the AI's yes to one fixed
question on the title and the posting's first lines (_role_check), and jobs tied at a score rank by the AI's own fit (own_fit;
tests/test_score_role_check.py).
The AI judges all of it; no word lists. Tests: tests/test_score_career_change.py."""

SEARCH_ROLE_FIT = 70   # the title check's yes on a career change: the searched role, with the CV's gap (tier B: shown, under a strong A)

PART = {
    'type': 'object', 'additionalProperties': False, 'required': ['fit', 'career_change', 'cv_gap'],
    'properties': {
        'fit': {'type': 'integer', 'description': "0-100: how well the posting's role matches the roles the person searches for (their search, "
                                                  'given below the profile), whatever their profile shows; the same bands as the overall score'},
        'career_change': {'type': 'boolean', 'description': "The searched roles are another field of work than the profile's experience "
                                                            '(a person changing careers); false when the profile is in the same field'},
        'cv_gap': {'type': 'string', 'description': 'One line, at most 90 characters: what the profile lacks for this role (a licence, hours, '
                                                    'years in the field); empty when the profile covers it'},
    },
}

RULE = """
- search: the person's search (their roles) is given after the profile. search.fit rates the posting's role against those roles alone, \
in the same bands, whatever the profile shows. search.career_change is true when the searched roles are another field than the profile's \
experience. Then also name in search.cv_gap what the profile lacks for this role, and write reason about the fit to the search."""


def extend(schema):
    """The scorer's answer form with the search part (a copy)."""
    import copy
    out = copy.deepcopy(schema)
    out['properties']['search'] = PART
    out['required'] = [*out['required'], 'search']
    return out


ROLE_TOPIC = 'search_role'   # src/ai/decide.py: kept per (topic, key), so a posting is asked once per set of roles
ROLE_ANSWERS = ['yes', 'no']
ROLE_TASK = ("Each item is a job posting (its title and first lines) and the roles a person searches for. Answer yes when this job hires "
             "someone to do one of those roles; no when it is other work that only shares a word with them (the word in another sense, or a "
             "job that designs, builds, sells or supports things for people in that role).")
FIRST_LINES = 400   # characters of the posting sent with its title


def _roles(search=None):
    """The current search's role titles (at most 12); [] when it has none or they cannot be read."""
    from .. import target_roles
    if search is None:
        try:
            from ..paths import load_search_config
            search = load_search_config(matching=False)
        except (OSError, ValueError):
            return []
    try:
        return [role['title'] for role in target_roles.view(search or {}) if role.get('title')][:12]
    except (TypeError, AttributeError, KeyError):   # an unreadable list: no roles
        return []


def block(search=None):
    """The search's roles as one fixed sentence the engine writes; '' when it has none."""
    roles = _roles(search)
    return f"\n\nThe person's search (the roles they look for): {', '.join(roles)}." if roles else ''


def tier(value):
    """The tier of a fit number, in the scorer's own bands."""
    return 'A' if value >= 85 else 'B' if value >= 50 else 'C'


def _role_check(job):
    """The AI's yes that this posting hires for one of the search's roles, read from its title and first lines (None or no: not a yes)."""
    import hashlib
    from . import decide
    roles = _roles()
    if not roles:
        return False
    lines = ' '.join(str(job.get('description') or '').split())[:FIRST_LINES]
    text = f"Roles searched: {', '.join(roles)}\nPosting: {job['title']}\n{lines}"
    key = hashlib.sha1(f"{'|'.join(roles)}\n{job['title']}\n{job.get('url') or ''}".encode()).hexdigest()[:16]
    return decide.one(ROLE_TOPIC, key, text, ROLE_ANSWERS, ROLE_TASK) == 'yes'


def _search_role(job):
    """The AI's title check said this posting's title is a role of the current search, and its role check on the title and first lines says
    yes too (True only on both yeses; unjudged is not a yes)."""
    if not job or not job.get('title'):
        return False
    from ..sources import feeds
    try:
        return feeds.judged_title(job['title']) is True and _role_check(job)
    except Exception:  # noqa: BLE001 — a check we cannot read lifts nothing
        return False


def apply(data, job=None):
    """On a career change, the job is ranked by its fit to the search: 'score' becomes that fit and the CV's own is kept as 'cv_fit'.
    That fit is at least SEARCH_ROLE_FIT when the AI's title check says the title is a role of the search (_search_role)."""
    part = data.get('search') or {}
    try:
        fit = max(0, min(100, int(part.get('fit'))))
    except (TypeError, ValueError):   # an answer without the part (an engine without the answer form): kept as asked, never asked again
        data['search'] = {}
        return data
    asked = fit   # the AI's own fit, kept: ties rank by it (own_fit) and its presence marks a score made with the role check (_low)
    if part.get('career_change') is True and fit < SEARCH_ROLE_FIT and _search_role(job):
        fit = SEARCH_ROLE_FIT
    data['search'] = {**part, 'fit': fit, 'asked': asked, 'cv_gap': str(part.get('cv_gap') or '')[:120]}
    if part.get('career_change') is True and fit > int(data.get('score') or 0):
        data.update(cv_fit=data['score'], score=fit, tier=tier(fit))
        missing = data['search']['cv_gap']
        # The one line every place shows (the Jobs row, the drawer, Job Matches, the Telegram card): a store's own field, no new column.
        data['reason'] = f'Fits your search · Your CV: {missing}' if missing else f"Fits your search · {data.get('reason') or ''}".rstrip(' ·')
        if missing:   # first among the gaps: the drawer's match panel and Job Matches show them
            data['gaps'] = [missing, *[gap for gap in data.get('gaps') or [] if gap != missing]][:3]
    return data


def own_fit(data):
    """The digest's second key among jobs tied at a score: the AI's own fit to the search (before any lift), else the score."""
    data = data or {}
    asked = (data.get('search') or {}).get('asked')
    return asked if isinstance(asked, int) else int(data.get('score') or 0)


def _low(data, bar):
    """A score to ask again: made before the search part existed and under the digest's bar, or a career change at SEARCH_ROLE_FIT or under
    made before the role check (no 'asked': his 03:15 re-score at fit 0-30 on Free AI, and the title-only lifts of his 04:21 run, 26 Oct
    2026). Once only: a score made now keeps 'asked', whatever the check answered."""
    if 'search' not in data:
        return int(data.get('score') or 0) < bar
    part = data.get('search') or {}
    return part.get('career_change') is True and 'asked' not in part and int(data.get('score') or 0) <= SEARCH_ROLE_FIT


def again_ids(jobs, rows, bar):
    """The jobs whose score was made before the search part existed, under the digest's bar, with a title the current search wants: scored
    once more (owner's pick, 26 Oct 2026: "Low ones the search wants"); a career change under SEARCH_ROLE_FIT too (_low). rows: {job id: its
    scores row}. The AI sorts their titles first, in one batch (feeds.triage); a failed sort keeps none on words (src/sources/feeds.py
    wanted_title). Once only: the next answer keeps the AI's own fit as 'asked' (apply, _low)."""
    import json
    low = []
    for job in jobs:
        row = rows.get(job['id'])
        try:
            data = json.loads(row['data_json'] or '{}') if row else None
        except ValueError:
            data = None
        if data is not None and _low(data, bar):
            low.append(job)
    if not low:
        return set()
    from ..sources import feeds
    feeds.triage(low)
    return {job['id'] for job in low if feeds.wanted_title(job.get('title'))}
