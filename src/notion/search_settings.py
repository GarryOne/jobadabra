"""⚙️ Search settings: what Jobadabra looks for, as a readable Notion page (the source of truth).

The page has one heading per setting and one bullet per entry, e.g.

    ## Roles to look for
    - site reliability
    - sre
    ## Companies to skip
    - Acme Corp

Before each crawl (`python -m src daily|discover|scout|feeds`) the page is read and written to
config/search.json and config/preferences.json, which are only a cache of it (the code reads those files).
A heading that's missing keeps the cached value; a heading with no bullets means "none".

Matching entries (roles, titles, skills, places, regions, discovery words) match anywhere in the text, any
case, with or without accents, exactly like the cached regex fragments: "entwickler" also matches
"Softwareentwickler", "zürich" also matches "Zurich". "In quotes" means a whole word only ("sre" does not
match "Srebrenica"). /Like this/ is a regular expression. Rendering and parsing are exact inverses, so the
page never changes what a search matches. Pages written before this format (no "Format 2" in the intro)
treated every plain entry as a whole word; they are still read that way until `upgrade` rewrites them.

    python -m src.notion.search_settings render   # the page as markdown, from the cached files (to create it)
    python -m src.notion.search_settings sync     # Notion page -> cached files (what __main__ runs)
    python -m src.notion.search_settings upgrade  # an older page -> this format (prints the new page, or nothing)
"""
import json
import os
import re
import sys

from ..paths import CONFIG, whole_word

PAGE_ID = os.getenv('NOTION_SEARCH_SETTINGS_PAGE', '')
TITLE = '⚙️ Search settings'
FORMAT = 'Format 2'
INTRO = ('What Jobadabra looks for. Edit freely: one entry per bullet; the next search uses your changes. '
         'A word matches anywhere, any case, with or without accents ("entwickler" also finds "Softwareentwickler"). '
         '"In quotes" = whole word only. /…/ = a regular expression. ' + FORMAT + '.')

# (heading, file, path in that file, kind): 'match' entries become regex fragments; 'text' are used as written;
# 'number' is one number; 'place' is "Location · language" for Google Jobs.
SECTIONS = [
    ('Target roles', 'search', ('target_roles',), 'roles'),   # one list of titles, the first 5 also searched on job boards (src/target_roles.py)
    ('Your level', 'search', ('level',), 'text'),
    ('Job titles to skip', 'search', ('title_exclude_keywords',), 'match'),
    ('Skills that make a job a better match', 'search', ('quality_stack_keywords',), 'match'),
    ('Best places', 'search', ('locations', 'top_tier'), 'match'),
    ('Anywhere in the country', 'search', ('locations', 'country_wide'), 'match'),
    ('Places abroad', 'search', ('locations', 'abroad'), 'match'),
    ('Relocation', 'search', ('locations', 'relocation'), 'text'),   # one of yes / no / unspecified (17 Oct 2026: "No" is a value, an empty list is not)
    ('Places to search instead', 'search', ('locations', 'search_override'), 'match'),   # an explicit search-only list (Locations, Advanced)
    ('Remote jobs', 'search', ('remote_jobs',), 'text'),   # "No": only jobs in your places (7 Oct 2026); missing or "Yes": remote counts as a place
    ('Remote jobs: regions to skip', 'search', ('remote_excluded_regions',), 'match'),
    ('Companies to skip', 'preferences', ('excluded_companies',), 'text'),
    ('Where you can work without a visa', 'preferences', ('work_rights',), 'match'),
    ('Languages that rule a job out', 'preferences', ('disqualifying_languages',), 'text'),
    ('Minimum fit score for the digest', 'preferences', ('digest_min_score',), 'number'),
    ('Daily applications target', 'preferences', ('daily_applications_target',), 'number'),
    ('Words that find new employers', 'search', ('board_discovery_keywords',), 'match'),
    ('Google Jobs searches', 'search', ('google_jobs', 'queries'), 'text'),
    ('Google Jobs places', 'search', ('google_jobs', 'locations'), 'place'),
]
LEGACY = {'roles to look for': ('search', ('role_keywords',), 'match'), 'job board searches': ('search', ('jobs_board_search_queries',), 'text')}
ACCENTS = {'u': 'ü', 'o': 'ö', 'a': 'ä'}  # Swiss German umlauts: "zürich" also finds "Zurich"
META = set('\\^$.|?*+()[]{}')


def _accents_to_plain(text):
    for base, accent in ACCENTS.items():
        text = text.replace(f'[{base}{accent}]', accent).replace(f'[{accent}{base}]', accent)
    return text


def readable(fragment):
    """A regex fragment as the page shows it, exactly reversible by fragment():
    "site reliability" -> site reliability, "z[uü]rich" -> zürich, "\\bsre\\b" -> "sre", else /fragment/.
    A fragment stored with its quotes ("tax", from the first page format) is the whole word, as every list reader takes it (src/paths.whole_word):
    it is read as the page entry it is, so it shows as "tax" and the next page read stores \\btax\\b, the same match without the quotes."""
    if whole_word(fragment) != fragment:
        fragment = fragment_of(fragment)
    whole = re.fullmatch(r'\\b(.+)\\b', fragment)
    inner = _accents_to_plain(whole.group(1) if whole else fragment)
    if META & set(inner) or '"' in inner or inner != inner.strip() or not inner:
        return f'/{fragment}/'
    entry = f'"{inner}"' if whole else inner
    return entry if fragment_of(entry) == fragment else f'/{fragment}/'


def terms(fragments):
    """The plain words of a list of regex fragments, for sites that search by text ("site reliability", "zürich"):
    entries shown as /regex/ have no plain form and are left out."""
    out = []
    for fragment in fragments or []:
        entry = readable(fragment).strip('"')
        if not entry.startswith('/') and entry not in out:
            out.append(entry)
    return out


def fragment_of(entry):
    """Page entry -> regex fragment: plain = anywhere; "quoted" = whole word; /…/ = as written."""
    entry = entry.strip()
    if len(entry) > 2 and entry.startswith('/') and entry.endswith('/'):
        return entry[1:-1]
    quoted = len(entry) > 2 and entry.startswith('"') and entry.endswith('"')
    text = ''.join('\\' + c if c in META else c for c in (entry[1:-1] if quoted else entry))
    for base, accent in ACCENTS.items():
        text = text.replace(accent, f'[{base}{accent}]')
    return rf'\b{text}\b' if quoted else text


# Remove when: no Search settings page lacks "Format 2" (`upgrade` has rewritten every one), not when installs update.
def fragment_v1(entry):
    """How pages without "Format 2" were read: a plain entry was a whole word; a "quoted" one too, without its quotes (17 Oct 2026: kept them)."""
    entry = entry.strip()
    if len(entry) > 2 and entry.startswith('"') and entry.endswith('"'):
        return fragment_of(entry)
    if len(entry) > 2 and entry.startswith('/') and entry.endswith('/'):
        return entry[1:-1]
    text = re.escape(entry)
    for base, accent in ACCENTS.items():
        text = text.replace(accent, f'[{base}{accent}]')
    start = r'\b' if re.match(r'\w', entry) else ''
    end = r'\b' if re.search(r'\w$', entry) else ''
    return f'{start}{text}{end}'


fragment = fragment_of


def readable_v1(fragment):
    """How the first page format showed a fragment (every plain entry read as a whole word)."""
    plain = _accents_to_plain(fragment.replace('\\b', ''))
    return plain if not META & set(plain) else f'/{fragment}/'


def _get(data, path):
    for key in path:
        data = (data or {}).get(key)
    return data


def _without_notes(value):
    """The value without its notes ("_comment" in the repo's example files), at any depth: the same rule as desktop/lib/config-text.js."""
    if isinstance(value, dict):
        return {key: _without_notes(item) for key, item in value.items() if not str(key).startswith('_')}
    if isinstance(value, list):
        return [_without_notes(item) for item in value]
    return value


def _set(data, path, value):
    for key in path[:-1]:
        data = data.setdefault(key, {})
    data[path[-1]] = value


def load_cached():
    read = lambda name: json.loads((CONFIG / f'{name}.json').read_text()) if (CONFIG / f'{name}.json').exists() else {}
    return {'search': read('search'), 'preferences': read('preferences')}


def render(files=None, show=None, intro=None):
    """The page body as markdown (headings and bullets), from the cached settings."""
    files = files or load_cached()
    show = show or readable
    out = [intro or INTRO, '']
    for heading, name, path, kind in SECTIONS:
        value = _get(files[name], path)
        if kind == 'roles':
            from .. import target_roles
            value = target_roles.view(files[name]) or None
        if value is None:
            continue
        out.append(f'## {heading}')
        if kind == 'number':
            out.append(f'- {value}')
        elif kind == 'place':
            out += [f"- {p['location']} · {p.get('language', '')}".rstrip(' ·') for p in value]
        elif kind == 'roles':
            out += [f"- {role['title']}" for role in value]
        else:
            out += [f'- {show(v) if kind == "match" else v}' for v in value]
        out.append('')
    return '\n'.join(out).strip() + '\n'


def _unique(entries):
    """The entries once each (same text ignoring case and outer spaces), in page order."""
    seen, out = set(), []
    for entry in entries:
        key = ' '.join(str(entry).split()).lower()
        if key and key not in seen:
            seen.add(key)
            out.append(entry)
    return out


def parse(text, to_fragment=None, join_legacy=True):
    """Page text (as Tracker.page_text gives it: "## Heading" and "- entry" lines) -> {(file, path): value}.
    A page without "Format 2" is read with the older whole-word rule, so its meaning never changes silently."""
    to_fragment = to_fragment or (fragment_of if FORMAT in text else fragment_v1)
    by_heading = {heading.lower(): (name, path, kind) for heading, name, path, kind in SECTIONS}
    by_heading.update(LEGACY)   # a page from before the one list (21 Oct 2026): read, and joined into "Target roles" below
    found, current = {}, None
    for line in text.splitlines():
        line = line.strip()
        heading = re.match(r'^#+\s*(.+)$', line)
        if heading:
            current = by_heading.get(heading.group(1).strip().lower())
            if current:
                found.setdefault(current, [])
            continue
        if current and line.startswith('- ') and line[2:].strip():
            found[current].append(line[2:].strip())
    values = {}
    for (name, path, kind), entries in found.items():
        entries = _unique(entries)   # a page that shows a section twice (two writers at once) must not double a list
        if kind == 'number':
            numbers = [int(n) for n in re.findall(r'\d+', ' '.join(entries[:1]))]
            if numbers:
                values[(name, path)] = numbers[0]
        elif kind == 'place':
            places = []
            for entry in entries:
                location, _, language = entry.partition(' · ')
                places.append({'location': location.strip(), **({'language': language.strip()} if language.strip() else {})})
            values[(name, path)] = [p for i, p in enumerate(places) if p not in places[:i]]
        elif kind == 'roles':
            values[(name, path)] = _unique(entries)   # titles as typed; apply() joins them to the variants kept in the cache
        elif kind == 'match':
            values[(name, path)] = _unique([to_fragment(entry) for entry in entries])
        else:
            values[(name, path)] = entries
    legacy = {path: values.pop((name, path)) for (name, path) in [('search', ('role_keywords',)), ('search', ('jobs_board_search_queries',))] if (name, path) in values}
    if not join_legacy:
        values.update({('search', path): value for path, value in legacy.items()})   # sync() decides what a page that still shows the two old lists means
    elif legacy and ('search', ('target_roles',)) not in values:
        from .. import target_roles
        roles = target_roles.view({'role_keywords': legacy.get(('role_keywords',)), 'jobs_board_search_queries': legacy.get(('jobs_board_search_queries',))})
        values[('search', ('target_roles',))] = roles   # joined to the cached variants by apply()
    return values


def _is_tracked_example_dir():
    from ..paths import ROOT
    return (not os.getenv('JOB_PILOTTO_CONFIG_DIR') and not os.getenv('GITHUB_ACTIONS') and not os.getenv('JOB_PILOTTO_ALLOW_REPO_CONFIG')
            and 'unittest' not in sys.modules and CONFIG == ROOT / 'config')


def _roles_from_titles(search, titles):
    """The titles of the page's "Target roles" section as the stored list: a title already in the cache keeps its variants and its own fragment."""
    from .. import target_roles
    if titles and isinstance(titles[0], dict):
        return titles   # already the stored list (src/target_roles.py migrate)
    have = {' '.join(role['title'].split()).lower(): role for role in target_roles.view(search)}
    return [dict(have.get(' '.join(title.split()).lower()) or {'title': ' '.join(title.split()), 'also': []}, title=' '.join(title.split())) for title in titles]


def apply(values, files=None):
    """Merge parsed values into the cached settings and write them; returns the files."""
    files = {name: _without_notes(data) for name, data in (files or load_cached()).items()}   # a "_" key is a note of the example files, never a setting
    for (name, path), value in values.items():
        if path == ('target_roles',):
            value = _roles_from_titles(files[name], value)
        _set(files[name], path, value)
    if ('search', ('target_roles',)) in values:
        from .. import target_roles
        files['search'] = target_roles.with_derived(files['search'])   # role_keywords and the searches follow the one list
    if _is_tracked_example_dir():
        # A source checkout with no config folder of its own: config/ here is the example files the repo ships (public). The user's
        # real settings must never be written over them (1 Oct 2026: they were, then nearly committed). The desktop app and the
        # scheduled runs set their own folder, so they are not affected.
        print('Search settings: not written into the repo\'s example config/ (set JOB_PILOTTO_CONFIG_DIR to use your own).')
        return files
    CONFIG.mkdir(parents=True, exist_ok=True)
    for name in ('search', 'preferences'):
        (CONFIG / f'{name}.json').write_text(json.dumps(files[name], indent=2, ensure_ascii=False) + '\n')
    return files


def sync(tracker=None, page_id=PAGE_ID):
    """Notion page -> cached files. Without the page or Notion, the cache is used as it is."""
    if not page_id:
        return False
    if tracker is None:
        from .client import Tracker
        tracker = Tracker.from_env()
    if not tracker:
        return False
    text = tracker.page_text(page_id)
    if FORMAT not in text:  # first format: wait for `upgrade` (the app runs it) so no meaning changes silently
        print('Search settings: the Notion page is in the older format; using the last copy until the app updates it.')
        return False
    stale = '## Target roles' not in text   # a page still showing the two old lists
    values = parse(text, join_legacy=False)
    if stale and isinstance(load_cached()['search'].get('target_roles'), list):
        for path in (('role_keywords',), ('jobs_board_search_queries',)):
            values.pop(('search', path), None)   # behind the cache, which is merged already: the app republishes the page
    if values:
        before = load_cached()
        apply(values)
        for line in changed_lines(before, load_cached()):
            print(line, flush=True)
    return bool(values)


WATCHED = (('places', 'search', ('locations', 'top_tier')), ('places anywhere in', 'search', ('locations', 'country_wide')),
           ('places abroad', 'search', ('locations', 'abroad')), ('remote jobs', 'search', ('remote_jobs',)),
           ('roles', 'search', ('role_keywords',)), ('hidden languages', 'preferences', ('disqualifying_languages',)))


def changed_lines(before, after):
    """What the Notion page changed in the copy a search uses, said in the run's log (7 Oct 2026: places removed on this Mac came back from
    the page and 1,650 jobs from all over Switzerland were read; nothing said so). Entries are the user's own words, not their data."""
    out = []
    for label, name, path in WATCHED:
        old = [readable(v) for v in (_get(before.get(name) or {}, path) or [])]
        new = [readable(v) for v in (_get(after.get(name) or {}, path) or [])]
        added, gone = [v for v in new if v not in old], [v for v in old if v not in new]
        if added or gone:
            out.append(f'Search settings from Notion changed your {label}: ' + ', '.join([*(f'+{v}' for v in added), *(f'−{v}' for v in gone)]))
    return out


def upgrade(tracker=None, page_id=PAGE_ID):
    """A page in the first format -> the new page text (None when it's already current). Unedited (it still
    shows exactly what the cache holds): rebuilt from the cache, so every entry keeps its exact meaning.
    Edited: the edits are taken as they were read (whole words), written to the cache, then re-rendered."""
    if not page_id:
        return None
    if tracker is None:
        from .client import Tracker
        tracker = Tracker.from_env()
    text = tracker.page_text(page_id)
    if FORMAT in text:
        return None
    cached = load_cached()
    as_shown = parse(render(cached, show=readable_v1, intro='(first format)'), fragment_v1)
    on_page = parse(text, fragment_v1)
    if on_page != {key: value for key, value in as_shown.items() if key in on_page}:
        cached = apply(on_page, cached)
    return render(cached)


def publish_sections(files, paths, tracker=None, page_id=PAGE_ID):
    """Write these settings' sections (by path) to the Notion page, each under its heading; nothing without a page or Notion."""
    if not page_id:
        return
    tracker = tracker or Tracker_from_env()
    if not tracker:
        return
    for heading, name, path, kind in SECTIONS:
        if path in paths:
            items = [readable(v) if kind == 'match' else str(v) for v in _get(files[name], path) or []]
            tracker.replace_after_heading(page_id, heading, [
                {'object': 'block', 'type': 'bulleted_list_item', 'bulleted_list_item': {'rich_text': [{'type': 'text', 'text': {'content': item}}]}}
                for item in items])


def Tracker_from_env():
    from .client import Tracker
    return Tracker.from_env()


def sync_quietly():
    try:
        sync()
    except Exception as error:  # noqa: BLE001 — Notion down: the last cached settings are used
        print(f'Warning: search settings not read from Notion ({type(error).__name__}); using the last copy.')


def main(argv=None):
    command = (argv or sys.argv[1:] or ['render'])[0]
    if command == 'render':
        sys.stdout.write(render())
    elif command == 'upgrade':
        sys.stdout.write(upgrade() or '')
    elif command == 'sync':
        print('Search settings read from Notion.' if sync() else 'No Notion search settings page; nothing to read.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
