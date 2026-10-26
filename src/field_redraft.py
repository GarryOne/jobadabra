"""A change of field redrafts the words the strategy derived from the old roles (owner, 26 Oct 2026: he changed only the role, developer to
pilot, and the board-discovery words (software, developer…), the Google Jobs queries ("software developer iasi") and the stack words stayed).
DERIVED lists every such list in config/search.json; one stamp (data/field_stamp.json) remembers which roles they were drafted for. When the
roles now move to another field (their kinds of work differ, or a kind we cannot place has no role word left in common), Claude redrafts
each from the new roles and the profile, in a fixed answer the code validates; words of the old field never survive. What Claude sees: the
roles, the places' names and the Profile text; never jobs. Tests: tests/test_field_redraft.py. CLI: `python -m src.field_redraft apply`."""
import json
import re
import sys

from . import role_kinds
from .paths import DATA

STAMP = DATA / 'field_stamp.json'
DERIVED = (('board_discovery_keywords',), ('quality_stack_keywords',), ('google_jobs', 'queries'))   # every list drafted from the roles
MAX_WORDS = 12
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': [name for name, in [('board_words',), ('stack_words',), ('queries',)]],
          'properties': {'board_words': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Words in job titles of this field, to find employers and job boards'},
                         'stack_words': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Skills, tools, licences or certificates that make a job fit this field'},
                         'queries': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Search phrases a person in this field types into a job search, without a place'}}}
SYSTEM = """You redraft a job search's word lists because the person moved to another field. You get their new roles, their places and their \
profile. Answer, for the new roles only: board_words (plain words in job titles of this field, in the language of their places), stack_words \
(skills, tools, licences or certificates that make a job fit), queries (phrases to type into a job search, no place). Nothing from the old \
field, no regex, at most 12 each."""


def _roles(search):
    return sorted({re.sub(r'[^\w ]+', ' ', str(word)).strip().lower() for word in search.get('role_keywords') or [] if str(word).strip()})


def field_of(search):
    """{'kinds': kinds of work (an unplaced one is 'other'), 'roles': role words}: what the lists were drafted for."""
    roles = _roles(search)
    kinds = sorted(set(role_kinds.kinds_of(roles[:30]).values())) if roles else []
    return {'kinds': kinds, 'roles': roles}


def moved(before, after):
    """True when the roles are now in another field: different kinds of work, or only unplaced kinds and no role word kept."""
    if not before or not after['roles']:
        return False
    if before['kinds'] != after['kinds']:
        return True
    return after['kinds'] in ([], ['other']) and not set(before['roles']) & set(after['roles'])


def _words(items, plain=False):
    """A validated list of short words; as match fragments (escaped, lower case) unless plain."""
    out = []
    for item in items if isinstance(items, list) else []:
        word = re.sub(r'\s+', ' ', str(item)).strip()
        if 2 <= len(word) <= 60 and word.lower() not in [w.lower() for w in out]:
            out.append(word)
    return [w if plain else re.escape(w.lower()).replace('\\ ', ' ') for w in out[:MAX_WORDS]]


def ask(search, profile, client=None):
    from .ai import cost, engine
    from .ai.models import SMALL_MODEL
    from .notion.search_settings import terms
    places = search.get('locations') or {}
    given = {'roles': terms(search.get('role_keywords'))[:20], 'places': terms((places.get('top_tier') or []) + (places.get('country_wide') or []))[:10],
             'profile': (profile or '')[:6000]}
    client = client or engine.client(action='field_redraft')
    response = client.messages.create(model=SMALL_MODEL, max_tokens=1500, system=[{'type': 'text', 'text': SYSTEM}],
                                      messages=[{'role': 'user', 'content': json.dumps(given, ensure_ascii=False)}],
                                      output_config=engine.structured(SCHEMA, SMALL_MODEL, 'low'))
    cost.side(SMALL_MODEL, response.usage)
    return json.loads(next(b.text for b in response.content if b.type == 'text'))


def redrafted(search, answer):
    """The search with every DERIVED list replaced by the validated answer; a list the answer lacks is emptied, never kept from the old field."""
    new = json.loads(json.dumps(search))
    fresh = {DERIVED[0]: _words(answer.get('board_words')), DERIVED[1]: _words(answer.get('stack_words')), DERIVED[2]: _words(answer.get('queries'), plain=True)}
    for path, words in fresh.items():
        if len(path) == 1:
            new[path[0]] = words
        elif path[0] in new or words:
            new.setdefault(path[0], {})[path[1]] = words
    return new


def _stamp():
    try:
        return json.loads(STAMP.read_text())
    except (OSError, ValueError):
        return None


def apply(search, profile='', asker=None, stamp=None, save=None):
    """(search, redrafted?): the search with its derived lists redrafted when its field moved since the stamp. No stamp yet: the lists are taken
    as drafted for these roles. A failed answer changes nothing and keeps the old stamp, so the next run tries again."""
    now, before = field_of(search), stamp if stamp is not None else _stamp()
    save = save or (lambda value: (DATA.mkdir(parents=True, exist_ok=True), STAMP.write_text(json.dumps(value))))
    if not moved(before, now):
        if before != now:
            save(now)
        return search, False
    try:
        answer = (asker or ask)(search, profile)
    except Exception as error:  # noqa: BLE001 — the roles change must still save; the redraft is retried next time
        print(f'Field change: the words were not redrafted ({type(error).__name__}).', file=sys.stderr)
        return search, False
    if not isinstance(answer, dict) or not any(_words(answer.get(key)) for key in ('board_words', 'stack_words', 'queries')):
        return search, False
    save(now)
    return redrafted(search, answer), True


def _publish(files):
    """The three redrafted sections on the Notion search settings page (the page is the source of truth: a sync would bring the old words back).
    Nothing to do without a page; an error is raised so the stamp stays and the next run redrafts again."""
    from .notion import search_settings
    if not search_settings.PAGE_ID:
        return
    from .notion.client import Tracker
    tracker = Tracker.from_env()
    if not tracker:
        return
    for heading, name, path, kind in search_settings.SECTIONS:
        if path in DERIVED:
            value = search_settings._get(files[name], path) or []
            items = [search_settings.readable(v) if kind == 'match' else str(v) for v in value]
            tracker.replace_after_heading(search_settings.PAGE_ID, heading, [
                {'object': 'block', 'type': 'bulleted_list_item', 'bulleted_list_item': {'rich_text': [{'type': 'text', 'text': {'content': item}}]}}
                for item in items])


def refresh(asker=None, profile=None, publish=_publish):
    """Before every jobs check, whatever changed the roles (the Strategy page, the Notion page, Telegram, setup, an import: they all end in the cached
    settings): redraft the derived lists when the roles' field moved since the stamp, keep them, put them on the Notion page, then stamp. True when it did."""
    from . import target_roles
    from .notion import search_settings
    from .paths import local_profile
    files = search_settings.load_cached()
    new, changed = apply(target_roles.with_derived(files['search']), local_profile() or '' if profile is None else profile, asker=asker, save=lambda value: None)
    if not changed:
        stamp = field_of(new)   # an unchanged field with a changed stamp (first run, a role added in the same field): keep the stamp current
        if _stamp() != stamp and not moved(_stamp(), stamp):
            STAMP.parent.mkdir(parents=True, exist_ok=True)
            STAMP.write_text(json.dumps(stamp))
        return False
    search_settings.apply({('search', path): (new[path[0]] if len(path) == 1 else new[path[0]][path[1]]) for path in DERIVED}, files)
    publish(search_settings.load_cached())
    STAMP.parent.mkdir(parents=True, exist_ok=True)
    STAMP.write_text(json.dumps(field_of(new)))
    print('Field change: your roles moved to another field, so the employer-finding words, skills and Google Jobs searches were redrafted for it.', flush=True)
    return True


def refresh_quietly(**kwargs):
    try:
        return refresh(**kwargs)
    except Exception as error:  # noqa: BLE001 — the search goes on with the lists it has; the next run tries again
        print(f'Field change: the words were not redrafted ({type(error).__name__}).', file=sys.stderr)
        return False


def main():
    """`python -m src.field_redraft apply` (the Strategy page's roles edit): prints {"redrafted": bool}."""
    print(json.dumps({'redrafted': refresh_quietly()}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
