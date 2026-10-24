#!/usr/bin/env python3
"""Build the public Jobadabra Notion template from the live workspace's schemas (no data).

    NOTION_TOKEN=... python3 tools/notion_template.py --parent <page id> [--dry-run]

Reads every Jobadabra database the code uses (properties, options, colours, relations, rollups,
formulas) and creates empty copies under one new page, plus the Profile, Application Answers
(from docs/notion-profile-template.md) and Pipeline pages. Publish that page with "Allow
duplicate as template"; new users duplicate it, and the desktop app finds each database by its
title (TEMPLATE_TITLES below). Re-run it when a schema changes to make a fresh template.
Views aren't in the public API: add them in Notion afterwards.
"""
import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

API = 'https://api.notion.com/v1/'
VERSION = '2022-06-28'

# env variable -> source database (the owner's live one; defaults in the code)
DATABASES = {
    'NOTION_APPLICATIONS_DB': 'f56b68942d3b43cbb85a7b1ebfe2df1b',
    'NOTION_MATCHES_DB': '2d8077c592fd45db8d6d5c8e2eea75cb',
    'NOTION_AGENT_RUNS_DB': '6a89d3b5faf44b6290f0108afcbf8ce9',
    'NOTION_CRON_RUNS_DB': '98543553a1024a61bd784ada69b2a45d',
    'NOTION_EVENTS_DB': '95ae2d6b81804e838985d0de5cbd945b',
    'NOTION_INSIGHTS_DB': '4c79aec091df4dcc8a8827cd4d43a5ef',
    'NOTION_INTERVIEWS_DB': '78fb76fd0f2c4b9ea0a9e040c48642ba',
    'NOTION_EMPLOYERS_DB': 'c7fe8570c2ff414086ae9bb1ee2dbf64',
}
# Pages with no code reading them: created from a docs file, for the user.
GUIDES = [('📖', 'How Jobadabra works', 'docs/job-pilotto-guide.md')]
PAGES = {
    'NOTION_PROFILE_PAGE_ID': ('👤', 'Profile — CV and Preferences'),
    'NOTION_ANSWERS_PAGE_ID': ('📝', 'Application Answers — Standard Form Fields'),
    'NOTION_PIPELINE_PAGE': ('🎯', 'Pipeline — Application Funnel'),
}
SIMPLE = {'title', 'rich_text', 'date', 'checkbox', 'url', 'email', 'phone_number', 'files', 'people',
          'created_time', 'last_edited_time', 'created_by', 'last_edited_by'}


def request(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        'Authorization': f'Bearer {token}', 'Notion-Version': VERSION, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'{method} {path}: {error.code} {error.read().decode()[:400]}') from None


def plain_property(prop):
    """Creatable definition of a property that needs no other property to exist first."""
    kind = prop['type']
    if kind in SIMPLE:
        return {kind: {}}
    if kind == 'number':
        return {'number': {'format': prop['number'].get('format', 'number')}}
    if kind in ('select', 'multi_select'):
        return {kind: {'options': [{'name': o['name'], 'color': o.get('color', 'default')} for o in prop[kind]['options']]}}
    if kind == 'status':
        return {'status': {}}
    if kind == 'unique_id':
        # Prefixes are unique per workspace, so the template's copy has none.
        return {'unique_id': {'prefix': None}}
    return None  # relation, rollup, formula: added in later passes


def build(token, parent, dry_run=False):
    sources = {env: request('GET', f'databases/{db}', token=token) for env, db in DATABASES.items()}
    titles = {env: ''.join(t['plain_text'] for t in src['title']) for env, src in sources.items()}
    plan = {'databases': titles, 'pages': {env: title for env, (_, title) in PAGES.items()}}
    if dry_run:
        return plan

    root = request('POST', 'pages', {
        'parent': {'page_id': parent}, 'icon': {'type': 'emoji', 'emoji': '✈️'},
        'properties': {'title': {'title': [{'text': {'content': 'Jobadabra'}}]}},
        'children': intro_blocks()}, token)
    created = {}
    # Pass 1: every database with its plain properties.
    for env, src in sources.items():
        props = {name: plain_property(p) for name, p in src['properties'].items() if plain_property(p)}
        body = {'parent': {'page_id': root['id']}, 'title': [{'text': {'content': titles[env]}}],
                'is_inline': False, 'properties': props}
        if src.get('icon'):
            body['icon'] = src['icon']
        if src.get('description'):
            body['description'] = src['description']
        created[env] = request('POST', 'databases', body, token)['id']
    by_source = {DATABASES[env]: created[env] for env in created}

    # Pass 2: relations, pointed at the new databases. A two-way pair is created once (from the
    # side listed first), then Notion's auto-named synced property is renamed to the source name.
    done = set()
    for env, src in sources.items():
        for name, prop in src['properties'].items():
            if prop['type'] != 'relation':
                continue
            rel = prop['relation']
            target_source = rel['database_id'].replace('-', '')
            pair = frozenset([(env, name), (target_source, rel.get('dual_property', {}).get('synced_property_name'))])
            if pair in done:
                continue
            target = by_source[target_source]
            if rel.get('type') == 'dual_property':
                before = set(request('GET', f'databases/{target}', token=token)['properties'])
                request('PATCH', f'databases/{created[env]}', {'properties': {name: {'relation': {
                    'database_id': target, 'type': 'dual_property', 'dual_property': {}}}}}, token)
                after = request('GET', f'databases/{target}', token=token)['properties']
                synced = next((n for n in after if n not in before), None)
                wanted = rel['dual_property'].get('synced_property_name')
                if synced and wanted and synced != wanted:
                    request('PATCH', f'databases/{target}', {'properties': {synced: {'name': wanted}}}, token)
                done.add(pair)
            else:
                request('PATCH', f'databases/{created[env]}', {'properties': {name: {'relation': {
                    'database_id': target, 'type': 'single_property', 'single_property': {}}}}}, token)

    # Pass 3: rollups, then formulas (a formula may read a rollup).
    for kind in ('rollup', 'formula'):
        for env, src in sources.items():
            props = {}
            for name, prop in src['properties'].items():
                if prop['type'] == 'rollup':
                    r = prop['rollup']
                    props[name] = {'rollup': {'relation_property_name': r['relation_property_name'],
                                              'rollup_property_name': r['rollup_property_name'], 'function': r['function']}}
                elif prop['type'] == 'formula':
                    props[name] = {'formula': {'expression': prop['formula']['expression']}}
            props = {n: p for n, p in props.items() if kind in p}
            if props:
                request('PATCH', f'databases/{created[env]}', {'properties': props}, token)

    for emoji, title, source in GUIDES:
        add_page(token, root['id'], emoji, title, markdown_blocks((ROOT / source).read_text()))
    # Pages: Profile and Answers from the template file; Pipeline is written by the code.
    sections = profile_sections()
    for env, (emoji, title) in PAGES.items():
        blocks = sections.get(env) or [paragraph('Filled in by Jobadabra after your first search: how many jobs '
                                                 'you applied to, replies, interviews, and the step to improve.')]
        page = request('POST', 'pages', {'parent': {'page_id': root['id']}, 'icon': {'type': 'emoji', 'emoji': emoji},
                                         'properties': {'title': {'title': [{'text': {'content': title}}]}},
                                         'children': blocks[:100]}, token)
        for start in range(100, len(blocks), 100):
            request('PATCH', f"blocks/{page['id']}/children", {'children': blocks[start:start + 100]}, token)
        created[env] = page['id']
    return {'root': root['id'], 'url': root['url'], 'ids': created, **plan}


def add_page(token, parent, emoji, title, blocks):
    page = request('POST', 'pages', {'parent': {'page_id': parent}, 'icon': {'type': 'emoji', 'emoji': emoji},
                                     'properties': {'title': {'title': [{'text': {'content': title}}]}},
                                     'children': blocks[:100]}, token)
    for start in range(100, len(blocks), 100):
        request('PATCH', f"blocks/{page['id']}/children", {'children': blocks[start:start + 100]}, token)
    return page


# ---------- page content ----------

def rich(text):
    """Markdown **bold** and `code` to Notion rich text."""
    parts = []
    for piece in re.split(r'(\*\*[^*]+\*\*|`[^`]+`)', text):
        if not piece:
            continue
        bold, code = piece.startswith('**'), piece.startswith('`')
        content = piece.strip('*`') if (bold or code) else piece
        parts.append({'type': 'text', 'text': {'content': content[:2000]}, 'annotations': {'bold': bold, 'code': code}})
    return parts


def paragraph(text):
    return {'type': 'paragraph', 'paragraph': {'rich_text': rich(text)}}


def markdown_blocks(text):
    blocks, table = [], []

    def flush():
        if table:
            rows = [r for r in table if not re.match(r'^\|\s*-', r)]
            cells = [[c.strip() for c in r.strip().strip('|').split('|')] for r in rows]
            width = max(len(c) for c in cells)
            blocks.append({'type': 'table', 'table': {'table_width': width, 'has_column_header': True, 'has_row_header': False,
                           'children': [{'type': 'table_row', 'table_row': {'cells': [rich(c) for c in row + [''] * (width - len(row))]}}
                                        for row in cells]}})
            table.clear()
    for line in text.splitlines():
        if line.startswith('|'):
            table.append(line)
            continue
        flush()
        if not line.strip():
            continue
        heading = re.match(r'^(#{1,3})\s+(.*)', line)
        if heading:
            level = len(heading.group(1))
            blocks.append({'type': f'heading_{level}', f'heading_{level}': {'rich_text': rich(heading.group(2))}})
        elif re.match(r'^\s*[-*]\s+', line):
            blocks.append({'type': 'bulleted_list_item', 'bulleted_list_item': {'rich_text': rich(re.sub(r'^\s*[-*]\s+', '', line))}})
        elif re.match(r'^\s*\d+\.\s+', line):
            blocks.append({'type': 'numbered_list_item', 'numbered_list_item': {'rich_text': rich(re.sub(r'^\s*\d+\.\s+', '', line))}})
        else:
            blocks.append(paragraph(line.strip()))
    flush()
    return blocks


def profile_sections():
    """The Profile and Application Answers sections of docs/notion-profile-template.md as blocks."""
    text = (ROOT / 'docs' / 'notion-profile-template.md').read_text()
    parts = re.split(r'^## ', text, flags=re.M)
    found = {}
    for part in parts:
        title, _, body = part.partition('\n')
        body = re.sub(r'^\s*\n', '', body)
        if 'Profile' in title and 'CV' in title:
            found['NOTION_PROFILE_PAGE_ID'] = markdown_blocks(body)
        elif 'Application Answers' in title:
            found['NOTION_ANSWERS_PAGE_ID'] = markdown_blocks(body)
    return found


def intro_blocks():
    return [
        {'type': 'callout', 'callout': {'icon': {'type': 'emoji', 'emoji': '✈️'}, 'color': 'blue_background', 'rich_text': rich(
            '**Your Jobadabra workspace.** The Jobadabra app fills these pages for you: jobs that fit you, '
            'your applications, replies, interviews and insights. Edit anything here; the app reads your changes.')}},
        paragraph('**Start here:** open the Jobadabra app and follow the setup; it connects to this page. '
                  'Your Profile and standard answers are drafted from your CV; mark anything wrong and the next '
                  'search uses your edits.'),
        paragraph('**New here?** Read **How Jobadabra works** below first: what each page is for, a normal week, '
                  'and what to edit.'),
        {'type': 'divider', 'divider': {}},
    ]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--parent', required=True, help='page to create the template under (shared with the integration)')
    parser.add_argument('--dry-run', action='store_true', help='print what would be created')
    args = parser.parse_args(argv)
    token = os.getenv('NOTION_TOKEN')
    if not token:
        parser.error('NOTION_TOKEN is required (the owner workspace integration)')
    print(json.dumps(build(token, args.parent.replace('-', ''), args.dry_run), indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
