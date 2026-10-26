"""The fit score's second view: fit to the person's search apart from fit to their CV (owner, 26 Oct 2026: "Show them, flag the gap", for a
search in another field than the CV). The pilot search found 13 First Officer jobs; each was scored against a software CV, 0-25, "Unrelated
role: Pilot vs software developer", and none reached the digest: the scorer never saw the search. Now the engine writes the search's roles
into the request (block) and the scorer's fixed answer has a `search` part: the fit to those roles (whatever the CV shows), whether the search
is a career change (another field than the profile's experience) and one line on what the profile lacks. On a career change the job is ranked
and shown by its fit to the search (apply: the ring, the digest and the Jobs list read 'score'); the CV's own fit is kept as 'cv_fit'.
A score made before this part existed, under the digest's bar, for a title the current search wants, is scored again once (again_ids).
The AI judges all of it; no word lists. Tests: tests/test_score_career_change.py."""

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


def block(search=None):
    """The search's roles as one fixed sentence the engine writes; '' when it has none."""
    from .. import target_roles
    if search is None:
        try:
            from ..paths import load_search_config
            search = load_search_config(matching=False)
        except (OSError, ValueError):
            return ''
    try:
        roles = [role['title'] for role in target_roles.view(search or {}) if role.get('title')][:12]
    except (TypeError, AttributeError, KeyError):   # an unreadable list: no search sentence
        return ''
    return f"\n\nThe person's search (the roles they look for): {', '.join(roles)}." if roles else ''


def tier(value):
    """The tier of a fit number, in the scorer's own bands."""
    return 'A' if value >= 85 else 'B' if value >= 50 else 'C'


def apply(data):
    """On a career change, the job is ranked by its fit to the search: 'score' becomes that fit and the CV's own is kept as 'cv_fit'."""
    part = data.get('search') or {}
    try:
        fit = max(0, min(100, int(part.get('fit'))))
    except (TypeError, ValueError):   # an answer without the part (an engine without the answer form): kept as asked, never asked again
        data['search'] = {}
        return data
    data['search'] = {**part, 'fit': fit, 'cv_gap': str(part.get('cv_gap') or '')[:120]}
    if part.get('career_change') is True and fit > int(data.get('score') or 0):
        data.update(cv_fit=data['score'], score=fit, tier=tier(fit))
        missing = data['search']['cv_gap']
        # The one line every place shows (the Jobs row, the drawer, Job Matches, the Telegram card): a store's own field, no new column.
        data['reason'] = f'Fits your search · Your CV: {missing}' if missing else f"Fits your search · {data.get('reason') or ''}".rstrip(' ·')
        if missing:   # first among the gaps: the drawer's match panel and Job Matches show them
            data['gaps'] = [missing, *[gap for gap in data.get('gaps') or [] if gap != missing]][:3]
    return data


def again_ids(jobs, rows, bar):
    """The jobs whose score was made before the search part existed, under the digest's bar, with a title the current search wants: scored
    once more (owner's pick, 26 Oct 2026: "Low ones the search wants"). rows: {job id: its scores row}. The AI sorts their titles first, in
    one batch (feeds.triage); a failed sort keeps none on words (src/sources/feeds.py wanted_title)."""
    import json
    low = []
    for job in jobs:
        row = rows.get(job['id'])
        try:
            data = json.loads(row['data_json'] or '{}') if row else None
        except ValueError:
            data = None
        if data is not None and 'search' not in data and int(data.get('score') or 0) < bar:
            low.append(job)
    if not low:
        return set()
    from ..sources import feeds
    feeds.triage(low)
    return {job['id'] for job in low if feeds.wanted_title(job.get('title'))}
