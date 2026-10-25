#!/usr/bin/env python3
"""Copy a Jobadabra Notion workspace into another one: every database row (all fields, page body, links
between databases) and the Profile / Standard answers pages. Used to move a real job search into the
workspace the Desktop App uses, or to keep a test copy. Safe to re-run: rows already copied are updated,
not duplicated (the source -> target page map is kept in data/notion-copy/).

Tokens are read from the macOS Keychain by service name (never printed), e.g. job-pilotto.notion.token.

    # 1. Find a workspace's databases and pages (by their titles, as the app does); --env prints .env lines
    python3 tools/notion_copy.py ids --token job-pilotto.notion-app.token [--env]
    # 2. Optional: build an empty workspace from config/notion_schema.json under a page the token can see
    python3 tools/notion_copy.py create --token job-pilotto.notion-test.token --parent <page id>
    # 3. Copy (--replace: target rows that didn't come from this source go to Notion's trash first,
    #    and the target's Profile / Standard answers are replaced; --dry-run: only count)
    python3 tools/notion_copy.py copy --from job-pilotto.notion.token --from-ids ~/jobadabra/.env \
        --to job-pilotto.notion-app.token [--replace] [--dry-run]
    # (one token that sees both workspaces: --to the same token, --to-ids "~/Library/Application Support/Jobadabra/settings.json")
    # 4. Optional: write ⚙️ Search settings from a config folder (search.json + preferences.json)
    python3 tools/notion_copy.py settings --token job-pilotto.notion-app.token --config ~/jobadabra/config

What isn't copied: people fields (user ids differ per workspace), formulas and rollups (Notion computes them),
files uploaded to Notion (their links expire; external links are kept), database views (not in the API).
The full procedure is in .claude/skills/notion-copy/SKILL.md.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
API = 'https://api.notion.com/v1/'
VERSION = '2022-06-28'
SCHEMA = json.loads((ROOT / 'config' / 'notion_schema.json').read_text())
STATE = ROOT / 'data' / 'notion-copy'
SKIP_TYPES = {'formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by',
              'unique_id', 'people', 'button', 'verification'}
TEXT_BLOCKS = {'paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item',
               'to_do', 'toggle', 'quote', 'callout', 'code'}


def keychain(service):
    # "env:NAME": the token is in that environment variable (the twin's helper hands the app's own token this way: never argv, never a file)
    if service.startswith('env:'):
        token = os.environ.get(service[4:], '').strip()
        if not token:
            raise SystemExit(f'No token in the environment variable {service[4:]}')
        return token
    token = subprocess.run(['security', 'find-generic-password', '-s', service, '-w'], capture_output=True, text=True).stdout.strip()
    if not token:
        raise SystemExit(f'No Keychain item {service}')
    return token


class Notion:
    RATE = 3  # Notion allows ~3 requests a second per connection; shared by every thread using this client

    def __init__(self, token):
        self.token = token
        self._lock, self._next = threading.Lock(), 0.0

    def _wait_turn(self):  # start requests 1/RATE s apart (no pause after a reply: threads keep the pipe full)
        with self._lock:
            now = time.monotonic()
            start = max(now, self._next)
            self._next = start + 1 / self.RATE
        time.sleep(start - now)

    def __call__(self, method, path, body=None):
        for attempt in range(6):
            self._wait_turn()
            request = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                             headers={'Authorization': f'Bearer {self.token}', 'Notion-Version': VERSION,
                                                      'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                if error.code in (429, 500, 502, 503, 504) and attempt < 5:
                    time.sleep(float(error.headers.get('Retry-After') or 2 ** attempt))
                    continue
                raise RuntimeError(f'{method} {path}: {error.code} {error.read().decode()[:300]}') from None
            except (TimeoutError, urllib.error.URLError, ConnectionError) as error:   # a slow or dropped connection: one reply must not end a long copy
                if attempt < 5:
                    print(f'{method} {path}: {error!r}, retrying', file=sys.stderr)
                    time.sleep(2 ** attempt)
                    continue
                raise

    def pages(self, database_id):
        body, cursor = {'page_size': 100}, None
        while True:
            result = self('POST', f'databases/{database_id}/query', {**body, **({'start_cursor': cursor} if cursor else {})})
            yield from result['results']
            if not result.get('has_more'):
                return
            cursor = result['next_cursor']

    def children(self, block_id):
        cursor = None
        while True:
            result = self('GET', f'blocks/{block_id}/children?page_size=100' + (f'&start_cursor={cursor}' if cursor else ''))
            yield from result['results']
            if not result.get('has_more'):
                return
            cursor = result['next_cursor']


# ---------- finding a workspace's parts (by title, like the app) ----------
def norm(title):
    import re
    import unicodedata
    return re.sub(r'[^\w]+', ' ', unicodedata.normalize('NFKD', title), flags=re.U).strip().lower()


def title_of(item):
    if item['object'] == 'database':
        return ''.join(t['plain_text'] for t in item['title'])
    prop = next((p for p in item.get('properties', {}).values() if p['type'] == 'title'), None)
    return ''.join(t['plain_text'] for t in prop['title']) if prop else ''


def ids_from_env_file(path):
    """{ENV: id} from a .env file's NOTION_* lines, or from the Desktop App's settings.json (its "notionIds"):
    use it when a token sees several copies with the same titles (e.g. the old workspace next to the app's
    new one, or the public template's source next to the real databases), so the right ones are used."""
    ids = {}
    text = Path(path).expanduser().read_text()
    if Path(path).suffix == '.json':
        return {k: str(v).replace('-', '') for k, v in (json.loads(text).get('notionIds') or {}).items() if v}
    for line in text.splitlines():
        key, _, val = line.strip().partition('=')
        if key.startswith('NOTION_') and key != 'NOTION_TOKEN' and val.strip():
            ids[key] = val.strip().strip('"\'').replace('-', '')
    return ids


def find_ids(notion):
    """{ENV: id} for every database and page of the schema the token can see (newest when several)."""
    wanted = {norm(db['title']): env for env, db in SCHEMA['databases'].items()}
    # A workspace made before a rename still has the old title ("Applications — Job Tracker" → "Job Tracker").
    wanted.update({norm(old): env for env, db in SCHEMA['databases'].items() for old in db.get('former_titles', [])})
    wanted.update({norm(page['title']): env for env, page in SCHEMA['pages'].items()})
    found, newest = {}, {}
    for kind in ('database', 'page'):
        cursor = None
        while True:
            result = notion('POST', 'search', {'filter': {'property': 'object', 'value': kind}, 'page_size': 100,
                                               **({'start_cursor': cursor} if cursor else {})})
            for item in result['results']:
                env = wanted.get(norm(title_of(item)))
                if env and not item.get('archived') and item['last_edited_time'] > newest.get(env, ''):
                    found[env], newest[env] = item['id'].replace('-', ''), item['last_edited_time']
            if not result.get('has_more'):
                break
            cursor = result['next_cursor']
    return found


# ---------- building an empty workspace from the schema ----------
def api_property(column, target=None):
    sys.path.insert(0, str(ROOT / 'tools'))
    from notion_schema import api_property as definition
    return definition(column, target)


def create(notion, parent):
    """Every database and page of config/notion_schema.json under `parent`; returns {ENV: id}."""
    ids = {}
    for env, page in SCHEMA['pages'].items():
        made = notion('POST', 'pages', {'parent': {'page_id': parent}, 'icon': {'type': 'emoji', 'emoji': page['emoji']},
                                        'properties': {'title': {'title': [{'text': {'content': page['title']}}]}}})
        ids[env] = made['id'].replace('-', '')
    passes = [lambda t: t not in ('relation', 'rollup', 'formula'), lambda t: t == 'relation', lambda t: t == 'rollup',
              lambda t: t == 'formula']
    have = {}
    for env, db in SCHEMA['databases'].items():
        props = {name: api_property(c) for name, c in db['columns'].items() if passes[0](c['type'])}
        made = notion('POST', 'databases', {'parent': {'page_id': parent}, 'title': [{'text': {'content': db['title']}}],
                                            **({'icon': {'type': 'emoji', 'emoji': db['icon']}} if db.get('icon') else {}),
                                            'properties': props})
        ids[env], have[env] = made['id'].replace('-', ''), set(props)
    for check in passes[1:]:
        for env, db in SCHEMA['databases'].items():
            for name, column in db['columns'].items():
                if not check(column['type']) or name in have[env]:
                    continue
                if column['type'] == 'relation':
                    target = ids[column['database']]
                    before = set(notion('GET', f'databases/{target}')['properties'])
                    notion('PATCH', f'databases/{ids[env]}', {'properties': {name: api_property(column, target)}})
                    if 'synced_property' in column:
                        synced = next((n for n in notion('GET', f'databases/{target}')['properties'] if n not in before), None)
                        if synced and column['synced_property'] and synced != column['synced_property']:
                            notion('PATCH', f'databases/{target}', {'properties': {synced: {'name': column['synced_property']}}})
                        have[column['database']].add(column['synced_property'])
                else:
                    notion('PATCH', f'databases/{ids[env]}', {'properties': {name: api_property(column)}})
                have[env].add(name)
    return ids


# ---------- copying ----------
def rich(items):
    """Rich text as plain text runs (mentions of the source workspace's pages become their text)."""
    out = []
    for item in items or []:
        text = item.get('plain_text', '')
        for start in range(0, len(text), 2000):
            run = {'type': 'text', 'text': {'content': text[start:start + 2000]}, 'annotations': item.get('annotations', {})}
            if item.get('href'):
                run['text']['link'] = {'url': item['href']}
            out.append(run)
    return out[:100]


def value(prop, target_type):
    """A source property value -> the target's, or None to skip it (relations are set in a second pass)."""
    kind = prop['type']
    if kind != target_type or kind in SKIP_TYPES or kind == 'relation':
        return None
    body = prop.get(kind)
    if kind in ('title', 'rich_text'):
        return {kind: rich(body)}
    if kind in ('number', 'checkbox', 'url', 'email', 'phone_number'):
        return {kind: body}
    if kind in ('select', 'status'):
        return {kind: {'name': body['name']} if body else None}
    if kind == 'multi_select':
        return {kind: [{'name': o['name']} for o in body]}
    if kind == 'date':
        return {kind: {k: v for k, v in body.items() if v is not None} if body else None}
    if kind == 'files':
        return {kind: [f for f in body if f.get('type') == 'external']}
    return None


def blocks_of(source, notion):
    """A source block -> creatable blocks, each with its children in "_children" (added after it's made).
    Columns and synced blocks are flattened into their content; what can't be copied becomes a short note."""
    kind = source['type']
    body = source.get(kind, {})
    kids = lambda: [b for child in notion.children(source['id']) for b in blocks_of(child, notion)] if source.get('has_children') else []
    if kind in ('column_list', 'column', 'synced_block'):
        return kids()
    if kind in TEXT_BLOCKS:
        new = {'rich_text': rich(body.get('rich_text'))}
        for key in ('checked', 'language', 'is_toggleable', 'color'):
            if key in body:
                new[key] = body[key]
        if kind == 'callout' and (body.get('icon') or {}).get('type') == 'emoji':
            new['icon'] = body['icon']
        return [{'object': 'block', 'type': kind, kind: new, '_children': kids()}]
    if kind == 'divider':
        return [{'object': 'block', 'type': 'divider', 'divider': {}}]
    if kind in ('bookmark', 'embed', 'link_preview') and body.get('url'):
        return [{'object': 'block', 'type': 'bookmark', 'bookmark': {'url': body['url']}}]
    if kind == 'table':  # a table is created with its rows
        rows = [{'object': 'block', 'type': 'table_row', 'table_row': {'cells': [rich(cell) for cell in c['table_row']['cells']]}}
                for c in notion.children(source['id'])]
        return [{'object': 'block', 'type': 'table', 'table': {'table_width': body['table_width'],
                 'has_column_header': body.get('has_column_header', False), 'has_row_header': body.get('has_row_header', False),
                 'children': rows}}]
    if kind in ('image', 'file', 'pdf', 'video') and body.get('type') == 'external':
        return [{'object': 'block', 'type': kind, kind: {'type': 'external', 'external': body['external']}}]
    note = {'child_page': f"(page: {body.get('title', '')})", 'child_database': f"(database: {body.get('title', '')})"}.get(
        kind, f'({kind} not copied)')
    return [{'object': 'block', 'type': 'paragraph', 'paragraph': {'rich_text': rich([{'plain_text': note}])}}]


def append(notion, parent, blocks):
    """Append blocks 100 at a time; each block's children are added under it once it exists (any depth)."""
    for start in range(0, len(blocks), 100):
        batch = blocks[start:start + 100]
        made = notion('PATCH', f'blocks/{parent}/children', {'children': [{k: v for k, v in b.items() if k != '_children'}
                                                                         for b in batch]})['results']
        for original, created in zip(batch, made):
            if original.get('_children'):
                append(notion, created['id'], original['_children'])


def page_blocks(notion, page_id):
    return [b for child in notion.children(page_id) for b in blocks_of(child, notion)]


def replace_body(notion, page_id, source_id, source):
    for old in list(notion.children(page_id)):
        if old['type'] not in ('child_database', 'child_page'):
            notion('DELETE', f"blocks/{old['id']}")
    append(notion, page_id, page_blocks(source, source_id))


def copy(src, dst, src_ids, dst_ids, state_file, replace=False, dry_run=False, log=print):
    state = json.loads(state_file.read_text()) if state_file.exists() else {}
    # Incremental (8 Oct 2026, the live-test mirror synced at each twin start): each source row's last_edited_time at its last copy. A row whose
    # time is unchanged is skipped; Notion's times have minute precision, so rows stamped within 2 minutes of the previous sync are checked again.
    stamps_file = state_file.with_name(state_file.stem + '.edited.json')
    stamps = json.loads(stamps_file.read_text()) if stamps_file.exists() else {}
    started = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())
    previous = stamps.get('_synced_at', '')
    fence = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(time.mktime(time.strptime(previous, '%Y-%m-%dT%H:%M:%S.000Z')) - time.timezone - 120)) if previous else ''
    unchanged = lambda page: (bool(page.get('last_edited_time')) and stamps.get(page['id']) == page['last_edited_time']
                              and (not fence or page['last_edited_time'] < fence))

    def keep():
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps(state, indent=1))
        stamps_file.write_text(json.dumps(stamps, indent=1))
    report = {}
    envs = [env for env in SCHEMA['databases'] if src_ids.get(env) and dst_ids.get(env)]
    rows = {env: list(src.pages(src_ids[env])) for env in envs}
    if dry_run:
        return {env: len(r) for env, r in rows.items()}
    target_types = {env: {n: p['type'] for n, p in dst('GET', f'databases/{dst_ids[env]}')['properties'].items()} for env in envs}
    if replace:  # the target's own rows (not copied from this source) go to Notion's trash
        mine = set(state.values())
        for env in envs:
            for page in dst.pages(dst_ids[env]):
                if page['id'] not in mine:
                    dst('PATCH', f"pages/{page['id']}", {'archived': True})
                    report[f'{env} trashed'] = report.get(f'{env} trashed', 0) + 1
    # Pass 1: rows with their fields and page body.
    changed = set()
    for env in envs:
        for page in rows[env]:
            if state.get(page['id']) and unchanged(page):
                report[f'{env} unchanged'] = report.get(f'{env} unchanged', 0) + 1
                continue
            props = {name: v for name, p in page['properties'].items()
                     if name in target_types[env] and (v := value(p, target_types[env][name])) is not None}
            made = state.get(page['id'])
            if made:
                dst('PATCH', f'pages/{made}', {'properties': props})
                replace_body(dst, made, page['id'], src)   # its body may have changed too
                report[f'{env} updated'] = report.get(f'{env} updated', 0) + 1
            else:
                icon = page.get('icon') if (page.get('icon') or {}).get('type') == 'emoji' else None
                made = dst('POST', 'pages', {'parent': {'database_id': dst_ids[env]}, 'properties': props,
                                             **({'icon': icon} if icon else {})})['id']
                state[page['id']] = made
                append(dst, made, page_blocks(src, page['id']))
                report[f'{env} copied'] = report.get(f'{env} copied', 0) + 1
            changed.add(page['id'])
            if page.get('last_edited_time'):
                stamps[page['id']] = page['last_edited_time']
            keep()  # after each row: an interrupted copy resumes
        log(f'{env}: {len(rows[env])} rows')
    # Rows gone from the source (deleted or trashed there): trashed in the target too. Only rows this map copied.
    seen = {page['id'] for env in envs for page in rows[env]}
    for source_id, made in list(state.items()):
        if source_id not in seen:
            dst('PATCH', f'pages/{made}', {'archived': True})
            del state[source_id]
            stamps.pop(source_id, None)
            report['removed'] = report.get('removed', 0) + 1
    # Pass 2: links between rows (one side of each two-way pair; Notion fills the other), for the rows this run wrote.
    for env in envs:
        pairs = {name: c for name, c in SCHEMA['databases'][env]['columns'].items() if c['type'] == 'relation'}
        for page in rows[env]:
            if page['id'] not in changed:
                continue
            links = {}
            for name, column in pairs.items():
                prop = page['properties'].get(name)
                if not prop or target_types[env].get(name) != 'relation':
                    continue
                if column.get('synced_property') is not None and env > column['database']:
                    continue  # set from the other side
                targets = [state[r['id']] for r in prop['relation'] if r['id'] in state]
                links[name] = {'relation': [{'id': t} for t in targets]}
            if links:
                dst('PATCH', f"pages/{state[page['id']]}", {'properties': links})
    # Pages: Profile, Standard answers, Form knowledge (replaced when the source has them).
    for env in ('NOTION_PROFILE_PAGE_ID', 'NOTION_ANSWERS_PAGE_ID', 'NOTION_KNOWLEDGE_PAGE'):
        if not (src_ids.get(env) and dst_ids.get(env)):
            continue
        edited = src('GET', f'pages/{src_ids[env]}').get('last_edited_time', '')
        if replace or not list(dst.children(dst_ids[env])) or stamps.get(env) != edited or (fence and edited >= fence):
            replace_body(dst, dst_ids[env], src_ids[env], src)
            report[f'{env} page'] = 'replaced'
            stamps[env] = edited
    stamps['_synced_at'] = started
    keep()
    return report


def settings_page(notion, page_id, config):
    from src.notion import search_settings
    from notion_template import markdown_blocks
    files = {name: json.loads((Path(config) / f'{name}.json').read_text()) for name in ('search', 'preferences')}
    for old in list(notion.children(page_id)):
        notion('DELETE', f"blocks/{old['id']}")
    blocks = markdown_blocks(search_settings.render(files))
    for start in range(0, len(blocks), 100):
        notion('PATCH', f'blocks/{page_id}/children', {'children': blocks[start:start + 100]})


def main(argv=None):
    sys.path.insert(0, str(ROOT / 'tools'))
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    listing = sub.add_parser('ids')
    listing.add_argument('--token', required=True)
    listing.add_argument('--env', action='store_true', help='print NOTION_*=id lines for a .env file')
    making = sub.add_parser('create')
    making.add_argument('--token', required=True)
    making.add_argument('--parent', required=True)
    copying = sub.add_parser('copy')
    copying.add_argument('--from', dest='source', required=True)
    copying.add_argument('--from-ids', dest='source_ids', help='a .env file naming the source databases and pages (else found by title)')
    copying.add_argument('--to', dest='target', required=True)
    copying.add_argument('--state', help='where the source -> target page map is kept (default data/notion-copy/): the live-test twin keeps one for every checkout')
    copying.add_argument('--to-ids', dest='target_ids', help='the same for the target, e.g. the Desktop App\'s settings.json')
    copying.add_argument('--replace', action='store_true')
    copying.add_argument('--dry-run', action='store_true')
    writing = sub.add_parser('settings')
    writing.add_argument('--token', required=True)
    writing.add_argument('--config', required=True)
    writing.add_argument('--ids', help='the target\'s .env or the Desktop App\'s settings.json (when the token sees several copies)')
    args = parser.parse_args(argv)
    if args.command == 'ids':
        found = find_ids(Notion(keychain(args.token)))
        print('\n'.join(f'{k}={v}' for k, v in sorted(found.items())) if args.env else json.dumps(found, indent=1))
    elif args.command == 'create':
        print(json.dumps(create(Notion(keychain(args.token)), args.parent.replace('-', '')), indent=1))
    elif args.command == 'copy':
        src, dst = Notion(keychain(args.source)), Notion(keychain(args.target))
        src_ids = ids_from_env_file(args.source_ids) if args.source_ids else find_ids(src)
        dst_ids = ids_from_env_file(args.target_ids) if args.target_ids else find_ids(dst)
        if src_ids.get('NOTION_APPLICATIONS_DB') == dst_ids.get('NOTION_APPLICATIONS_DB'):
            raise SystemExit('Source and target are the same workspace: pass --from-ids / --to-ids')
        key = hashlib.sha1(f"{src_ids.get('NOTION_APPLICATIONS_DB')}>{dst_ids.get('NOTION_APPLICATIONS_DB')}".encode()).hexdigest()[:12]
        print(json.dumps(copy(src, dst, src_ids, dst_ids, (Path(args.state).expanduser() if args.state else STATE) / f'{key}.json', args.replace, args.dry_run), indent=1))
    else:
        dst = Notion(keychain(args.token))
        page = (ids_from_env_file(args.ids) if args.ids else find_ids(dst)).get('NOTION_SEARCH_SETTINGS_PAGE')
        if not page:
            raise SystemExit('No ⚙️ Search settings page in that workspace (the app creates it at start-up)')
        settings_page(dst, page, args.config)
        print('Search settings written.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
