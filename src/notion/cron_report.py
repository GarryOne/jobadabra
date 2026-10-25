#!/usr/bin/env python3
"""What a ⏰ Cronjob Runs row says: the run's title and subject, cost lines, mail lines, the report and the page
blocks (run_page), plus the blocks for what the run produced and its output log (extra_blocks). Pure rendering from the
run dict: no Notion calls, no process state. The run's lifecycle (begin / attach / log_run) stays in
src/notion/cron_runs.py, which re-exports every name here.

Guarded by tests/test_cron_runs.py and tests/test_ai_engine.py.
"""
import json
import re
from datetime import datetime, timezone
from html import unescape

from .. import run_result, tz


# (run key, the old per-step column (retired: each step's cost is on the run's page now), its label).
STAGES = (('enrich', 'Cost enrich (USD)', 'Enriched'), ('score', 'Cost score (USD)', 'Scored'),
          ('kits', 'Cost kits (USD)', 'Kits'), ('insight', 'Cost insight (USD)', 'Insights'),
          ('interview', 'Cost interview (USD)', 'Interviews'), ('mail', 'Cost mail (USD)', 'Emails'),
          ('sources', 'Cost sources (USD)', 'Source reads'))   # careers pages, link picks, alert emails, scout ideas (ai/cost.py SIDE)


def clip(value, limit=2000):
    """At most `limit` characters as Notion counts them: UTF-16 units, so an emoji is two (value[:2000] let a log with emoji through at 2002 and Notion refused the whole row)."""
    if len(value.encode('utf-16-le')) <= 2 * limit:
        return value
    return value.encode('utf-16-le')[:2 * limit].decode('utf-16-le', errors='ignore')


def _text(value):
    return {'rich_text': [{'text': {'content': clip(value)}}]} if value else {'rich_text': []}


def _para(content, kind='paragraph'):
    return {'object': 'block', 'type': kind, kind: {'rich_text': [{'text': {'content': clip(content)}}]}}


def _linked(link, content, kind='bulleted_list_item'):
    """A line whose first words open `link` (on a run's page: an email's subject opens that email in Gmail)."""
    rich = ([{'text': {'content': clip(content), 'link': {'url': link}}}] if link
            else [{'text': {'content': clip(content)}}])
    return {'object': 'block', 'type': kind, kind: {'rich_text': rich}}


def _sender(value):
    """The sender as a run's page shows it, never a full address: the name when there is one, else the domain
    ("no-reply@us.greenhouse-mail.io" -> "us.greenhouse-mail.io")."""
    name = re.sub(r'\s*<[^>]*>\s*', '', value or '').strip().strip('"')
    address = re.search(r'[\w.+-]+@([\w.-]+)', value or '')
    if name and '@' not in name:
        return name[:60]
    return address.group(1) if address else (value or '')[:60]


def _clock(value):
    """An email's time as this workspace shows every other time (its own time zone)."""
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).astimezone(TZ).strftime('%d %b %H:%M')
    except (TypeError, ValueError):
        return str(value or '')[:16]


# What each action means in words on the run's page: "recorded" is the one that changes an application.
EMAIL_ACTION = {'recorded': 'recorded', 'asked': 'needs you', 'tracked': 'tracked a new job',
                'skipped': 'not about your applications', 'duplicate': 'already known', 'reviewed': 'read'}


def email_lines(run):
    """Every email a Gmail check read: its subject (a link that opens it in Gmail), the sender, the time, what the check
    concluded, and what it did — recorded, asked about, tracked, skipped, already known. This is the evidence behind a
    check's "N update(s) recorded": before, a run's page said how many, never which, and never what changed."""
    lines = []
    for email in run.get('emails') or []:
        if email.get('action') == 'skipped':  # not about your applications: runs before 2 Oct 2026 listed these; they are noise
            continue
        head = f"{email.get('subject') or '(no subject)'} · {_sender(email.get('from'))} · {_clock(email.get('at'))}"
        what = EMAIL_ACTION.get(email.get('action'), email.get('action') or '')
        parts = [f"[{what}]"]
        label = str(email.get('label') or '')
        if label and label.lower() != what.lower():  # "not about your applications" is not said twice
            parts.append(label)
        if email.get('changes'):
            # "changed nothing to record" reads badly: the negative note stands on its own.
            parts.append(email['changes'] if email['changes'].startswith('nothing') else f"changed {email['changes']}")
        lines.append((email.get('link') or '', f"{head} — {' · '.join(parts)}"))
    return lines


def total_usd(run):
    return sum((run.get(stage) or {}).get('usd', 0.0) for stage, _, _ in STAGES)


def total_tokens(run):
    return sum((run.get(stage) or {}).get(key, 0) for stage, _, _ in STAGES
               for key in ('tokens_in', 'tokens_out', 'cache_read'))


PLAN_BILLED = {'claude': 'Claude subscription', 'openai': 'ChatGPT plan'}        # the user's own plan (Claude Code, Codex)
API_BILLED = {'claude': 'Anthropic API credits', 'openai': 'OpenAI API credits'}   # their API key
PLAN_WORDS = {'claude': 'Claude Code, your plan', 'openai': 'Codex, your ChatGPT plan'}


def _family(run):
    """'openai' when the run's AI was OpenAI's (a stage's provider, src/ai/cost.py), else 'claude'."""
    return 'openai' if any((run.get(stage) or {}).get('provider') == 'openai' for stage, _, _ in STAGES) else 'claude'


def billed_to(run):
    """How the run's AI was paid for (the "Billed to" column): the user's own plan (Claude Code, Codex), their API key (Anthropic,
    OpenAI), both (a fallback), or None when no AI ran (src/ai/providers)."""
    cli = any((run.get(stage) or {}).get('cli_calls') for stage, _, _ in STAGES)
    api = any((run.get(stage) or {}).get('api_calls') for stage, _, _ in STAGES)
    family = _family(run)
    return 'Both' if cli and api else PLAN_BILLED[family] if cli else API_BILLED[family] if api else None


def cost_text(run):
    """The run's AI cost in words: dollars for the API, "<CLI>, your plan" for the subscription."""
    billed, usd, plan = billed_to(run), f'AI cost ${total_usd(run):.3f}', PLAN_WORDS[_family(run)]
    return plan if billed in PLAN_BILLED.values() else f'{usd} + {plan.split(",")[0]}' if billed == 'Both' else usd


def status(run):
    if run.get('warnings') or run.get('feed_errors'):
        return 'Warnings'
    if run.get('headline'):
        return 'OK'
    if run.get('mode') in ('mail', 'rejection'):
        return 'OK' if run.get('updates') else 'Quiet'
    return 'OK' if run.get('new') or run.get('changed') else 'Quiet'


def mail_lines(run):
    """A Gmail check: what it read and each update it recorded in the application ledger."""
    info = run.get('mail') or {}
    updates = run.get('updates') or []
    lines = [f"Gmail check: {info.get('done', 0)} new email(s) read, {len(updates)} update(s) recorded; "
             f"{cost_text(run)}."]
    lines += updates
    lines += [f'Warning: {w}' for w in run.get('warnings', [])]
    return lines


# One-off jobs (not crawls): their name when they finish without a result line of their own.
ONE_OFF = {'visits': 'Find jobs using your browser', 'tailor': 'Tailor CVs for top matches', 'add': 'Logged activity', 'insight': 'Insight', 'weekly': 'Search analysis', 'interview': 'Interview review',
           'prepare': 'Application kit', 'kits': 'Prepare top matches', 'apply': 'Marked applied', 'scout': 'Find new employers', 'prep': 'Interview prep kit'}
# A job whose AI step has no queue needs a verb, not a column's label: the "Stages" line of a Gmail check.
STEP_NAME = {'mail': 'Read job emails'}


def report_lines(run):
    """The mini-report: a headline, then what stood out, most useful first."""
    if run.get('headline'):  # a one-off job (insight, weekly report, find employers…) says what it did
        return [f"{run['headline']} ({cost_text(run)})"] + [f'Warning: {w}' for w in run.get('warnings', [])]
    if run.get('mode') == 'mail':
        return mail_lines(run)
    if run.get('mode') in ONE_OFF:  # a one-off job without a result line: say which job, never a crawl's summary
        return [f"{ONE_OFF[run['mode']]} {'failed' if run.get('failed') else 'done'} ({cost_text(run)})"] + [f'Warning: {w}' for w in run.get('warnings', [])]
    if run.get('mode') == 'rejection':  # its AI cost is kept under "insight" (a review of your own search)
        return [f"Rejection review: {len(run.get('updates') or [])} application(s); {cost_text(run)}."] + \
            list(run.get('updates') or []) + [f'Warning: {w}' for w in run.get('warnings', [])]
    new, changed = run.get('new', 0), run.get('changed', 0)
    feeds, errors = run.get('feeds', 0), run.get('feed_errors', 0)
    cost = cost_text(run)
    lines = [f'{new} new and {changed} changed job(s) from {feeds} feed(s); {cost}.'
             if new or changed else f'Quiet run: nothing new from {feeds} feed(s); {cost}.']
    for title, company, score in run.get('top_new', [])[:3]:
        lines.append(f'Top new match: {title} at {company} (score {score}).')
    kits = run.get('kits') or {}
    if kits.get('done'):
        lines.append(f"Drafted {kits['done']} application kit(s): {', '.join(run.get('kit_titles', [])[:5])}.")
    for stage, _, label in STAGES:
        info = run.get(stage) or {}
        if info.get('failed'):
            lines.append(f"{label}: {info['failed']} of {info.get('pending', '?')} call(s) failed.")
        if info.get('pending') and info.get('done', 0) < info['pending'] and not info.get('failed'):
            lines.append(f"{label}: stopped at {info.get('done', 0)} of {info['pending']} (API unavailable).")
    scored = (run.get('score') or {}).get('done', 0)
    if scored and (run.get('score') or {}).get('usd'):
        lines.append(f"Scoring cost ${(run['score'].get('usd', 0) / scored):.4f} per job.")
    if errors:
        named = run.get('failing_feeds', [])[:6]
        rest = errors - len(named)   # never more failures than it names without saying so (owner's shot, 25 Oct 2026: 7 failed, 6 named)
        failing = ', '.join(named) + (f' and {rest} more' if named and rest > 0 else '')
        lines.append(f'{errors} feed(s) failed: {failing}.')
    if run.get('closed_stale'):
        lines.append(f"Closed {run['closed_stale']} job(s) not seen for a week.")
    if run.get('gone_titles'):
        lines.append(f"Posting taken down, moved to Closed: {', '.join(run['gone_titles'][:5])}.")
    lines += [f'Warning: {w}' for w in run.get('warnings', [])]
    return lines


# A jobs check crawls feeds; its counters (feeds, new, changed…) mean nothing on other runs, so those stay empty.
CRAWL_MODES = {'scheduled', 'run', 'today'}
# The row's kind, the second part of its title (its Mode column keeps the raw mode; nothing matches rows by title).
KINDS = {'scheduled': 'Refresh jobs', 'run': 'Refresh jobs', 'today': 'Refresh jobs', 'mail': 'Gmail check', 'scout': 'Find new employers',
         'add': 'Log activity', 'interview': 'Interview review', 'prepare': 'Application kit', 'prep': 'Interview prep',
         'rejection': 'Rejection review', 'insight': 'Insight', 'weekly': 'Search analysis', 'import': 'Add a job',
         'kits': 'Prepare top matches'}
TZ = tz.local_zone()
SUBJECT_MAX = 60


def counted(n, one, many=None, none='nothing new'):
    """'1 new job', '12 new jobs', or `none` for 0."""
    return f"{n} {one if n == 1 else many or one + 's'}" if n else none


def job_subject(row=None, company='', role='', via=''):
    """What a one-job run was about: "Company — Role" ("via Agency — Role" when only the agency is known), from its
    Applications row (a Notion page or its properties) or the given names. The role without a generated " · Company" /
    " · via Agency" suffix (titles.role_of), so the employer is never named twice."""
    from . import titles
    if row:
        props = row.get('properties', row) or {}
        company, via = titles.text_value(props.get('Company')), titles.text_value(props.get('Via'))
        role = titles.row_role(row)
    else:
        role = titles.role_of(role, company, via)
    who = titles.named(company) or (titles.VIA + titles.named(via) if titles.named(via) else '')
    return ' — '.join(part for part in (who, (role or '').strip()) if part)


def subject(run):
    """What the run was about, in a few words: set by the job itself (a job's "Company — Role", an interview's title, an
    insight's category), else from the run's own numbers (a jobs check's new jobs, a Gmail check's updates). '' when
    there's nothing to say (a weekly report). Never an email address or anything not already in Notion."""
    text = run.get('subject') or ''
    if not text and run.get('mode') in CRAWL_MODES and 'new' in run:
        text = counted(run['new'], 'new job')
    elif not text and run.get('mode') == 'mail' and 'mail' in run:
        updates, emails = len(run.get('updates') or []), (run.get('mail') or {}).get('done', 0)
        text = counted(updates, 'update') if updates else counted(emails, 'email checked', 'emails checked', 'no updates')
    text = ' '.join(str(text).split())
    return text if len(text) <= SUBJECT_MAX else text[:SUBJECT_MAX - 1].rstrip(' ,·-–—/|(') + '…'


def title(run, final=True):
    """'2026-09-29 16:02 · Interview prep · Huxley — Principal SRE': local time (as Started shows it), what ran, about
    what. The subject is known at the end: a row opened at the start (final=False) or a run that failed keeps
    'date · Kind'."""
    try:
        at = datetime.fromisoformat(run['started_at']).astimezone(TZ).strftime('%Y-%m-%d %H:%M')
    except (KeyError, ValueError):
        at = str(run.get('started_at', ''))[:16].replace('T', ' ')
    name = run.get('name') or KINDS.get(run['mode']) or ONE_OFF.get(run['mode']) or run['mode']  # a job may name itself
    return ' · '.join(part for part in (at, name, subject(run) if final else '') if part)[:200]


JOB_LINE = 'Job logged: '


def log_job(run, row, created):
    """A run that created or updated one job (a logged message, an application added from elsewhere): the run's
    Application relation, and a "Job logged: {…}" line in its output, from which the app links to that job (the
    run's detail in Recent activity, the Log box's result). Returns the job: page_id, url (its Notion page), title,
    job_url (the Jobs list's key), created (a new job, not an update of one you had)."""
    props = row.get('properties') or {}
    title = ''.join(part.get('plain_text') or (part.get('text') or {}).get('content', '')
                    for part in (props.get('Job') or {}).get('title') or [])
    job = {'page_id': row['id'], 'url': row.get('url') or f"https://www.notion.so/{row['id'].replace('-', '')}",
           'title': title, 'job_url': (props.get('Job URL') or {}).get('url') or '', 'created': bool(created)}
    run['application'] = row['id']
    run['subject'] = job_subject(row)  # the run's title names the job
    run_result.note_job(job)
    print(JOB_LINE + json.dumps(job, ensure_ascii=False))
    return job


def run_page(run, final=True):
    """(properties, children) for one Cronjob Runs row. The core columns every run fills; the rest belong to one kind
    of run and stay empty on the others (hidden in Notion): a jobs check's crawl numbers, a Gmail check's emails, the
    Application a one-job run was for. Each AI step (model, tokens, cost), the report and the log are on the page.
    final: the end-of-run write, whose title names what the run was about (title())."""
    lines = report_lines(run)
    crawl, mail = run['mode'] in CRAWL_MODES, run['mode'] == 'mail'
    only = lambda applies, value: {'number': value if applies else None}
    properties = {
        'Run': {'title': [{'text': {'content': title(run, final)}}]},
        'Started': {'date': {'start': run['started_at']}},
        'Duration (s)': {'number': run.get('seconds')},
        'Mode': {'select': {'name': run['mode']}},
        'Trigger': {'select': {'name': run.get('trigger', 'Local')}},
        'Status': {'select': {'name': status(run)}},
        'AI cost (USD)': {'number': round(total_usd(run), 4)},
        'Tokens (total)': {'number': total_tokens(run)},
        'Billed to': {'select': {'name': billed_to(run)} if billed_to(run) else None},
        'Telegram': _text(run.get('telegram', '')),
        'Summary': _text(lines[0]),
        # A jobs check
        'Feeds': only(crawl, run.get('feeds', 0)),
        'Feed errors': only(crawl, run.get('feed_errors', 0)),
        'New jobs': only(crawl, run.get('new', 0)),
        'Changed jobs': only(crawl, run.get('changed', 0)),
        'Closed stale': only(crawl, run.get('closed_stale', 0)),
        'Scored': only(crawl, (run.get('score') or {}).get('done', 0)),
        'Kits': only(crawl or run['mode'] in ('prepare', 'kits'), (run.get('kits') or {}).get('done', 0)),
        'Top new score': only(crawl and run.get('top_new'), run['top_new'][0][2] if run.get('top_new') else None),
        # A Gmail check
        'Emails': only(mail, (run.get('mail') or {}).get('done', 0)),
        'Updates': only(mail, len(run.get('updates') or [])),
    }
    if run.get('application'):  # a run about one job (prep kit, logged activity, interview review): its Applications row
        properties['Application'] = {'relation': [{'id': run['application']}]}
    if run.get('run_url'):
        properties['Run URL'] = {'url': run['run_url']}
    if run.get('run_id'):  # joins this row to logs/app.log, logs/engine.log, and the Actions log
        properties['Run id'] = _text(str(run['run_id']))
    children = [_para('Report', 'heading_3')] + [_para(line, 'bulleted_list_item') for line in lines]
    read = email_lines(run)
    if read:  # every email this check read, its subject linking to it, and what the check did about it
        children.append(_para('Emails read', 'heading_3'))
        children += [_linked(link, line) for link, line in read[:40]]
    children.append(_para('Stages', 'heading_3'))
    for stage, _, label in STAGES:
        info = run.get(stage)
        if info:
            done = f": {info.get('done', 0)} of {info.get('pending', 0)}" if info.get('pending') else ''  # no "0 of 0"
            # The step's name when it has a queue (or the job's own name), else what it read: "Read job emails with
            # claude-haiku-5-5", never "Emails with claude-haiku-5-5" (1 Oct 2026).
            queued = info.get('pending')
            heading = label if queued else (run.get('name') or STEP_NAME.get(run['mode']) or ONE_OFF.get(run['mode'], label))
            children.append(_para(
                f"{heading} with {info.get('model', '?')}{done}; "
                f"tokens in {info.get('tokens_in', 0)} (+{info.get('cache_read', 0)} cached), "
                f"out {info.get('tokens_out', 0)}; "
                + (PLAN_WORDS['openai' if info.get('provider') == 'openai' else 'claude'] if info.get('cli_calls') and not info.get('api_calls')
                   else f"${info.get('usd', 0.0):.4f}"),
                'bulleted_list_item'))
    if run.get('matches'):
        children.append(_para(f"Job Matches: {run['matches']}", 'bulleted_list_item'))
    return properties, children[:95]


def plain(html):
    """A Telegram HTML message as plain text; a link keeps its address after its words ("Title (https://…)"), as the
    app's Recent activity reads each job's link from it."""
    linked = re.sub(r'<a\s+href="([^"]+)"[^>]*>(.*?)</a>', lambda m: f'{m.group(2)} ({unescape(m.group(1))})', html, flags=re.S)
    return unescape(re.sub(r'<[^>]+>', '', linked)).strip()


RESULT_PARAS = 40   # the page's other blocks (50) + the heading + these + the log toggle stay under Notion's 100 per request


def _result_paras(lines):
    """One paragraph per line, the lines past RESULT_PARAS in the last one (line breaks inside it). The end of a long message is never dropped: a
    10-job digest is 49 lines and its counts ("10 open · 9 pinned · 5 applied") are the last block, so cutting at 40 showed "– open" on its card (#309)."""
    head, rest = lines[:RESULT_PARAS - 1], lines[RESULT_PARAS - 1:]
    paras = [_para(line) for line in head]
    if rest:
        text, rich = '\n'.join(rest), []
        while text and len(rich) < 100:   # Notion: 2000 units per text, 100 texts per block
            piece = clip(text)
            rich.append({'text': {'content': piece}})
            text = text[len(piece):]
        paras.append({'object': 'block', 'type': 'paragraph', 'paragraph': {'rich_text': rich}})
    return paras


def result_lines(messages, run):
    """What the run says it did: its last message, else the report's headline ("Quiet run: nothing new..."). Never empty: a finished run
    with no Result block left its card on Actions as skeleton bars (18 Oct 2026, a Find jobs run that found nothing)."""
    said = [line for line in plain(messages[-1]).split('\n') if line.strip()] if messages else []
    return said or [report_lines(run)[0]]


def extra_blocks(messages, lines, run=None):
    """What the run produced (its last message, else its headline when `run` is given) and a toggle with the last lines of its output."""
    blocks = []
    if messages or run:
        blocks.append(_para('Result', 'heading_3'))
        blocks += _result_paras(result_lines(messages, run) if run else [line for line in plain(messages[-1]).split('\n') if line.strip()])
    if lines:
        chunks = ['\n'.join(list(lines)[i:i + 25]) for i in range(0, len(lines), 25)]
        blocks.append({'object': 'block', 'type': 'toggle', 'toggle': {
            'rich_text': [{'text': {'content': f'Technical log (last {len(lines)} lines)'}}],
            'children': [{'object': 'block', 'type': 'code', 'code': {'language': 'plain text',
                          'rich_text': [{'text': {'content': clip(chunk)}}]}} for chunk in chunks]}})
    return blocks
