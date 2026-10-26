"""The product brain's plumbing (.github/workflows/product-brain.yml): Claude decides, this script reads and writes.

  signals  --out signals.md      what the brief reads: website + app numbers (/api/signals), GitHub (issues, failing
                                 workflows, releases, commits), and the brain's own past decisions (Notion)
  post     --brief brief.json    one recommendation -> a row in "🧭 Product Brain · Decisions" + a Telegram card
                                 with ✅ Explore / ⏭ Not now / 🔁 Another idea
  decision --id <page>           a decision as text (the explore step's input)
  plan     --id <page> --file plan.md   the explored plan -> the decision's page, Telegram: ✅ Approve / ✖ Drop
  status   --id <page> --status <name> [--note text]   a button's answer, recorded (and acknowledged in Telegram)
  sync                           every Decisions row -> the site's log (D1 brain_messages, /admin/intelligence/brain); safe to re-run:
                                 rows it already has are skipped. Filled the log once; re-run if a log write was missed.

post, plan and status also write each message to that log (POST /api/brain/log); a failed log write is said, never fatal.

Nothing here decides or builds: the two approval gates are the owner's taps in the "Job Pilotto Brain" Telegram bot
(api/brain.js). Needs NOTION_BRAIN_TOKEN (a Notion connection that sees only the Decisions database),
BRAIN_DATABASE_ID, BRAIN_BOT_TOKEN, BRAIN_CHAT_ID, JOB_PILOTTO_TELEMETRY_KEY (the site's STATS_KEY) and GH_TOKEN.
Standard library only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

DATABASE = os.environ.get('BRAIN_DATABASE_ID', '')  # repository variable; Notion IDs never default in code
SIGNALS_URL = 'https://www.jobpilotto.top/api/signals?days={days}'
LOG_URL = 'https://www.jobpilotto.top/api/brain/log'
NOTION = 'https://api.notion.com/v1'
LENSES = ['Growth', 'Product', 'Quality', 'UX', 'Business']  # Monday..Friday; the weekend picks by evidence
STATUSES = ['Proposed', 'Exploring', 'Plan ready', 'Approved', 'Not now', 'Done']


def lens_of_the_day(day: dt.date) -> str:
    return LENSES[day.weekday()] if day.weekday() < 5 else 'any (pick by evidence)'


# ---- HTTP ----

def _request(url: str, method: str = 'GET', body: dict | None = None, headers: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={  # Cloudflare blocks the default Python agent (1010)
        'Content-Type': 'application/json', 'User-Agent': 'job-pilotto-product-brain', **(headers or {})})
    for attempt in (1, 2):  # one retry: a reset connection now and then shouldn't cost the brief
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read() or b'{}')
        except urllib.error.HTTPError as error:
            raise SystemExit(f'{method} {url.split("?")[0]} failed: {error.code} {error.read()[:300]!r}')
        except (urllib.error.URLError, OSError) as error:
            if attempt == 2:
                raise SystemExit(f'{method} {url.split("?")[0]} failed: {error}')


def notion(path: str, method: str = 'GET', body: dict | None = None) -> dict:
    token = os.environ.get('NOTION_BRAIN_TOKEN')
    if not DATABASE:
        raise SystemExit('BRAIN_DATABASE_ID is missing: the repository variable with the Decisions database id.')
    if not token:
        raise SystemExit('NOTION_BRAIN_TOKEN is missing: create the "Job Pilotto Brain" Notion connection (RELEASE.md, Product brain).')
    return _request(f'{NOTION}/{path}', method, body, {'Authorization': f'Bearer {token}', 'Notion-Version': '2022-06-28'})


def telegram(text: str, buttons: list[list[dict]] | None = None) -> int | None:
    """Sends to the Brain bot; returns the Telegram message id (None when not sent)."""
    token, chat = os.environ.get('BRAIN_BOT_TOKEN'), os.environ.get('BRAIN_CHAT_ID')  # the Brain bot, not the job bot
    if not token or not chat:
        print('Telegram not configured: message not sent.', file=sys.stderr)
        return None
    body = {'chat_id': chat, 'text': text[:4000], 'parse_mode': 'HTML', 'disable_web_page_preview': True}
    if buttons:
        body['reply_markup'] = {'inline_keyboard': buttons}
    return (_request(f'https://api.telegram.org/bot{token}/sendMessage', 'POST', body).get('result') or {}).get('message_id')


def site_log(messages: list[dict]) -> int:
    """Messages -> the site's log (D1 brain_messages, read by /admin/intelligence/brain). Never fails the step: Notion stays the record."""
    key = os.environ.get('JOB_PILOTTO_TELEMETRY_KEY')
    if not key or not messages:
        print('Brain log: not written (JOB_PILOTTO_TELEMETRY_KEY missing).' if not key else 'Brain log: nothing to write.', file=sys.stderr)
        return 0
    saved = 0
    for start in range(0, len(messages), 200):
        try:
            saved += _request(LOG_URL, 'POST', {'messages': messages[start:start + 200]}, {'Authorization': f'Bearer {key}'}).get('saved', 0)
        except SystemExit as error:
            print(f'Brain log: not written: {error}', file=sys.stderr)
    print(f'Brain log: {saved} of {len(messages)} written.', file=sys.stderr)
    return saved


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')


def esc(text: str) -> str:
    return str(text or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def plain(prop: dict) -> str:
    kind = prop.get('type')
    if kind in ('title', 'rich_text'):
        return ''.join(part.get('plain_text', '') for part in prop.get(kind) or [])
    if kind == 'select':
        return (prop.get('select') or {}).get('name', '')
    if kind == 'date':
        return (prop.get('date') or {}).get('start', '')
    return ''


def text(value: str) -> list[dict]:
    return [{'type': 'text', 'text': {'content': value[:1990]}}] if value else []


# ---- Markdown -> Notion blocks (headings, bullets, numbered, to-dos, paragraphs: what the prompts ask for) ----

def blocks(markdown: str) -> list[dict]:
    out = []
    for line in markdown.splitlines():
        line = line.rstrip()
        if not line.strip():
            continue
        for prefix, kind in (('### ', 'heading_3'), ('## ', 'heading_2'), ('# ', 'heading_2')):
            if line.startswith(prefix):
                out.append({'type': kind, kind: {'rich_text': text(line[len(prefix):])}})
                break
        else:
            todo = re.match(r'^\s*[-*] \[( |x)\] (.*)', line)
            bullet = re.match(r'^\s*[-*] (.*)', line)
            number = re.match(r'^\s*\d+[.)] (.*)', line)
            if todo:
                out.append({'type': 'to_do', 'to_do': {'rich_text': text(todo.group(2)), 'checked': todo.group(1) == 'x'}})
            elif bullet:
                out.append({'type': 'bulleted_list_item', 'bulleted_list_item': {'rich_text': text(bullet.group(1))}})
            elif number:
                out.append({'type': 'numbered_list_item', 'numbered_list_item': {'rich_text': text(number.group(1))}})
            else:
                out.append({'type': 'paragraph', 'paragraph': {'rich_text': text(line)}})
    return out


def append(page: str, markdown: str) -> None:
    items = blocks(markdown)
    for start in range(0, len(items), 90):  # Notion takes at most 100 blocks per call
        notion(f'blocks/{page}/children', 'PATCH', {'children': items[start:start + 90]})


# ---- signals ----

def _run(args: list[str]) -> str:
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=60, check=False).stdout.strip()
    except (OSError, subprocess.TimeoutExpired) as error:
        return f'(not available: {error})'


def past_decisions(limit: int = 30) -> list[dict]:
    found = notion(f'databases/{DATABASE}/query', 'POST',
                   {'page_size': limit, 'sorts': [{'property': 'Date', 'direction': 'descending'}]})
    return [{'id': row['id'], **{name: plain(prop) for name, prop in row['properties'].items()}} for row in found.get('results', [])]


def page_lines(page: str, limit: int = 8000) -> list[tuple[str, str]]:
    """A page's lines as (block created time, text), one level of nested blocks (toggles, lists) included, about `limit` characters."""
    lines, size = [], 0
    def walk(block_id: str, depth: int) -> None:
        nonlocal size
        for block in notion(f'blocks/{block_id}/children?page_size=100').get('results', []):
            if size > limit:
                return
            line = ''.join(part.get('plain_text', '') for part in (block.get(block['type']) or {}).get('rich_text', []))
            if line:
                lines.append((block.get('created_time', ''), '  ' * depth + line))
                size += len(line)
            if block.get('has_children') and depth < 1 and block['type'] not in ('child_page', 'child_database'):
                walk(block['id'], depth + 1)
    walk(page, 0)
    return lines


def page_text(page: str, limit: int = 8000) -> str:
    """A page's text, one level of nested blocks (toggles, lists) included, cut at `limit` characters."""
    return '\n'.join(line for _, line in page_lines(page, limit))[:limit]


def find_compass() -> str | None:
    found = notion('search', 'POST', {'query': 'Product Compass', 'filter': {'property': 'object', 'value': 'page'}}).get('results', [])
    return found[0]['id'] if found else None


# Strategy first, the Compass above all; help pages and the workspace template (shared with their section) last.
PRIORITY = ['compass', 'marketing strategy', 'market & competitors', 'decision log', 'run log', 'feature catalog',
            'first customer onboarding', 'release stages']


def rank(title: str) -> int:
    lower = title.lower()
    return next((i for i, word in enumerate(PRIORITY) if word in lower), len(PRIORITY))


def strategy_pages(limit: int = 6) -> str:
    """Every page the owner shared with the Brain connection (the Product Compass first): the strategy it must serve."""
    found = notion('search', 'POST', {'filter': {'property': 'object', 'value': 'page'}, 'page_size': 100}).get('results', [])
    pages = [p for p in found if p.get('parent', {}).get('type') != 'database_id']  # not the Decisions rows
    title = lambda p: ''.join(t.get('plain_text', '') for prop in p['properties'].values() if prop.get('type') == 'title' for t in prop['title'])
    pages.sort(key=lambda p: rank(title(p)))
    if not pages:
        return '(No strategy page is shared with the Brain connection: ask the owner to share the 📍 Product Compass.)'
    return '\n\n'.join(f'### {title(p)}\n{page_text(p["id"])}' for p in pages[:limit])


def signals(out: str, today: dt.date, days: int = 7) -> None:
    key = os.environ.get('JOB_PILOTTO_TELEMETRY_KEY')
    try:  # one missing source is said in the signals, not a failed brief
        numbers = _request(SIGNALS_URL.format(days=days), headers={'Authorization': f'Bearer {key}'}) if key else {'error': 'JOB_PILOTTO_TELEMETRY_KEY missing'}
    except SystemExit as error:
        numbers = {'error': f'website/app numbers not available: {error}'}
    since = (today - dt.timedelta(days=days)).isoformat()
    sections = [
        f'# Signals for {today.isoformat()} ({today.strftime("%A")}) · lens of the day: {lens_of_the_day(today)}',
        '## Product Compass and strategy (the owner\'s pages: phase, goal, bets; serve them)', strategy_pages(),
        f'## Website and app (last {days} days, /api/signals: counts only)', '```json', json.dumps(numbers, indent=1)[:12000], '```',
        '## Open GitHub issues (newest 30)',
        _run(['gh', 'issue', 'list', '--state', 'open', '--limit', '30', '--json', 'number,title,labels,createdAt',
              '-q', '.[] | "#\\(.number) \\(.createdAt[:10]) \\(.title) [\\([.labels[].name] | join(","))]"']),
        f'## Workflow runs that failed in the last {days} days',
        _run(['gh', 'run', 'list', '--limit', '200', '--status', 'failure', '--created', f'>={since}', '--json', 'workflowName,createdAt',
              '-q', 'group_by(.workflowName)[] | "\\(.[0].workflowName): \\(length) failed"']),
        '## Releases (newest 5)', _run(['gh', 'release', 'list', '--limit', '5']),
        '## GitHub reach (stars, forks, watchers)',
        _run(['gh', 'api', 'repos/{owner}/{repo}', '-q', '"stars \\(.stargazers_count) · forks \\(.forks_count) · watchers \\(.subscribers_count)"']),
        f'## Commits in the last {days} days', _run(['git', 'log', f'--since={since}', '--format=%ad %h %s', '--date=short']),
        '## Past decisions of the brain (newest first; do not repeat one marked Not now within 14 days)',
        json.dumps(past_decisions(), indent=1, ensure_ascii=False),
    ]
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    with open(out, 'w', encoding='utf-8') as file:
        file.write('\n\n'.join(sections) + '\n')
    print(f'Signals written to {out}')


# ---- post / decision / plan / status ----

def card(brief: dict, page_url: str) -> str:
    """Blocks separated by a blank line: evidence, the action (+ what it serves), why, effort, link."""
    action = f'→ <b>{esc(brief["action"])}</b>'
    if brief.get('serves'):
        action += f'\n🎯 Serves: {esc(brief["serves"])}'
    blocks = [f'🧭 <b>Today\'s one action · {esc(brief["lens"])}</b>\n{esc(brief.get("evidence", ""))}',
              action, esc(brief.get('why', '')),
              f'⏱ Effort {esc(brief.get("effort", "?"))} · expected {esc(brief.get("expected", "?"))}',
              f'<a href="{page_url}">Details</a>']
    return '\n\n'.join(b for b in blocks if b)


def brief_text(brief: dict) -> str:
    """The recommendation as plain text, for the log: what the card says, then the details."""
    rows = [('Lens', brief.get('lens')), ('Evidence', brief.get('evidence')), ('Action', brief.get('action')), ('Serves', brief.get('serves')),
            ('Why', brief.get('why')), ('Effort', brief.get('effort')), ('Expected', brief.get('expected'))]
    text = '\n'.join(f'{name}: {value}' for name, value in rows if value)
    return text + (f'\n\n{brief["details"]}' if brief.get('details') else '')


def post(path: str, today: dt.date) -> str:
    brief = json.load(open(path, encoding='utf-8'))
    for field in ('action', 'lens'):
        if not brief.get(field):
            raise SystemExit(f'brief.json has no "{field}"')
    lens = brief['lens'] if brief['lens'] in LENSES + ['Fire', 'Strategy'] else 'Product'
    check = today + dt.timedelta(days=int(brief.get('check_in_days') or 7))
    page = notion('pages', 'POST', {'parent': {'database_id': DATABASE}, 'properties': {
        'Action': {'title': text(brief['action'])}, 'Date': {'date': {'start': today.isoformat()}},
        'Lens': {'select': {'name': lens}}, 'Status': {'select': {'name': 'Proposed'}},
        'Why now': {'rich_text': text(' · '.join(filter(None, [brief.get('serves', ''), brief.get('why', '')])))}, 'Effort': {'rich_text': text(brief.get('effort', ''))},
        'Expected': {'rich_text': text(brief.get('expected', ''))}, 'Check on': {'date': {'start': check.isoformat()}}}})
    append(page['id'], brief.get('details', ''))
    ident = page['id'].replace('-', '')
    if lens == 'Strategy':  # the weekly review: its proposal is the plan; approving writes it into the Compass
        buttons = [[{'text': '✅ Update the compass', 'callback_data': f'pb:ok:{ident}'},
                    {'text': '⏭ Keep it as is', 'callback_data': f'pb:n:{ident}'}]]
    else:
        buttons = [[{'text': '✅ Explore it', 'callback_data': f'pb:x:{ident}'},
                    {'text': '⏭ Not now', 'callback_data': f'pb:n:{ident}'},
                    {'text': '🔁 Another idea', 'callback_data': f'pb:a:{ident}'}]]
    message = telegram(card({**brief, 'lens': lens}, page['url']), buttons)
    site_log([{'decision': ident, 'kind': 'recommendation', 'title': brief['action'], 'text': brief_text({**brief, 'lens': lens}),
               'status': 'Proposed', 'notion_url': page['url'], 'telegram_id': message, 'at': now_iso()}])
    print(page['url'])
    return page['id']


def decision(page: str) -> str:
    row = notion(f'pages/{page}')
    props = {name: plain(prop) for name, prop in row['properties'].items()}
    children = notion(f'blocks/{page}/children?page_size=100').get('results', [])
    body = '\n'.join(''.join(part.get('plain_text', '') for part in (block.get(block['type']) or {}).get('rich_text', []))
                     for block in children)
    return '\n'.join(f'{name}: {value}' for name, value in props.items() if value) + f'\n\nDetails:\n{body}\n'


def plan(page: str, path: str) -> None:
    markdown = open(path, encoding='utf-8').read()
    append(page, '## Explored plan\n' + markdown)
    row = notion(f'pages/{page}', 'PATCH', {'properties': {'Status': {'select': {'name': 'Plan ready'}}}})
    summary = next((line.strip('# ').strip() for line in markdown.splitlines() if line.strip()), 'Plan ready')
    ident = page.replace('-', '')
    message = telegram(f'🧭 <b>Plan ready</b>: {esc(plain(row["properties"]["Action"]))}\n{esc(summary)}\n<a href="{row["url"]}">Read the plan</a>',
                       [[{'text': '✅ Approve plan', 'callback_data': f'pb:ok:{ident}'}, {'text': '✖ Drop it', 'callback_data': f'pb:n:{ident}'}]])
    site_log([{'decision': ident, 'kind': 'plan', 'title': summary, 'text': markdown, 'status': 'Plan ready',
               'notion_url': row['url'], 'telegram_id': message, 'at': now_iso()}])


def status(page: str, name: str, note: str = '') -> None:
    if name not in STATUSES:
        raise SystemExit(f'unknown status {name}: one of {", ".join(STATUSES)}')
    props = {'Status': {'select': {'name': name}}}
    if note:
        props['Result'] = {'rich_text': text(note)}
    row = notion(f'pages/{page}', 'PATCH', {'properties': props})
    print(f'{plain(row["properties"]["Action"])}: {name}')
    site_log([{'decision': page.replace('-', ''), 'kind': 'status', 'title': f'Status → {name}', 'text': note, 'status': name,
               'notion_url': row['url'], 'at': now_iso()}])
    if name == 'Approved' and plain(row['properties'].get('Lens', {})) == 'Strategy':
        compass = find_compass()
        if compass:  # the owner approved the weekly review: its proposal goes into the Compass, dated
            append(compass, f'## Approved changes ({dt.date.today().isoformat()})\n' + page_text(page))
            telegram('📍 Compass updated with the approved changes. Edit the page to fold them in.')


# ---- sync: the Decisions rows -> the site's log ----

PLAN_HEADING = 'Explored plan'


def all_decisions() -> list[dict]:
    rows, cursor = [], None
    while True:
        found = notion(f'databases/{DATABASE}/query', 'POST', {'page_size': 100, **({'start_cursor': cursor} if cursor else {}),
                                                               'sorts': [{'timestamp': 'created_time', 'direction': 'ascending'}]})
        rows += found.get('results', [])
        if not found.get('has_more'):
            return rows
        cursor = found.get('next_cursor')


def row_messages(row: dict, lines: list[tuple[str, str]]) -> list[dict]:
    """One Decisions row and its page lines -> its log messages: the recommendation, the plan if explored, its status now."""
    props = {name: plain(prop) for name, prop in row['properties'].items()}
    ident, url = row['id'].replace('-', ''), row.get('url', '')
    at = next((i for i, (_, line) in enumerate(lines) if line.strip() == PLAN_HEADING), None)
    details, plan_lines = (lines, []) if at is None else (lines[:at], lines[at + 1:])
    fields = [f'{name}: {props[name]}' for name in ('Lens', 'Why now', 'Effort', 'Expected', 'Check on') if props.get(name)]
    out = [{'decision': ident, 'kind': 'recommendation', 'title': props.get('Action', ''), 'status': 'Proposed', 'notion_url': url,
            'text': '\n'.join(fields) + ('\n\n' + '\n'.join(line for _, line in details) if details else ''),
            'at': row.get('created_time'), 'source': 'backfill'}]
    if at is not None:
        plan_text = '\n'.join(line for _, line in plan_lines)
        summary = next((line.strip('# ').strip() for _, line in plan_lines if line.strip()), 'Plan ready')
        out.append({'decision': ident, 'kind': 'plan', 'title': summary, 'text': plan_text, 'status': 'Plan ready', 'notion_url': url,
                    'at': lines[at][0] or row.get('last_edited_time'), 'source': 'backfill'})
    now = props.get('Status', '')
    if now and now not in ('Proposed', 'Plan ready' if at is not None else ''):
        out.append({'decision': ident, 'kind': 'status', 'title': f'Status → {now}', 'text': props.get('Result', ''), 'status': now,
                    'notion_url': url, 'at': row.get('last_edited_time'), 'source': 'backfill'})
    return out


def sync() -> int:
    messages = []
    for row in all_decisions():
        messages += row_messages(row, page_lines(row['id'], 20000))
    return site_log(messages)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='cmd', required=True)
    g = sub.add_parser('signals')
    g.add_argument('--out', default='signals.md')
    g.add_argument('--days', type=int, default=7, choices=[7, 30])
    sub.add_parser('post').add_argument('--brief', default='brief.json')
    sub.add_parser('decision').add_argument('--id', required=True)
    p = sub.add_parser('plan')
    p.add_argument('--id', required=True)
    p.add_argument('--file', default='plan.md')
    s = sub.add_parser('status')
    s.add_argument('--id', required=True)
    s.add_argument('--status', required=True)
    s.add_argument('--note', default='')
    sub.add_parser('sync')
    args = parser.parse_args(argv)
    today = dt.datetime.now(dt.timezone.utc).date()
    if args.cmd == 'signals':
        signals(args.out, today, args.days)
    elif args.cmd == 'post':
        post(args.brief, today)
    elif args.cmd == 'decision':
        print(decision(args.id))
    elif args.cmd == 'plan':
        plan(args.id, args.file)
    elif args.cmd == 'sync':
        sync()
    else:
        status(args.id, args.status, args.note)


if __name__ == '__main__':
    main()
