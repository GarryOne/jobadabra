#!/usr/bin/env python3
"""Rejection review: why an application was turned down, and whether there's anything to improve.

After each rejection (the Gmail check runs it when a rejection email moves an application to Rejected), or on
demand (the Desktop App's job menu → "Why was I rejected?", or this command), Claude Sonnet 5 reads what Job
Pilotto keeps about the application:
- the job posting and the answers and cover letter sent (the frozen 🗂 Application record), the fit score and
  its reasons;
- the timeline (📈 Application Events: how far it got, how fast the answer came);
- the reviews of its interviews (🎤 Interviews), if any;
- the rejection email itself, when known;
- the owner's Profile (the CV).

It gives one verdict and says how sure it is:
- Presentation: the fit was there but the CV, answers or cover letter didn't show it.
- Hard skills: a missing skill, level or experience the role needed.
- Soft skills: communication, structure or seniority signals in an interview (only with interview evidence).
- Not a fit (not on you): they wanted a different profile (location, domain, level, language, a team change);
  nothing to improve.
- Unclear: not enough to tell.
The result goes on the application: "Rejection reason" and "Rejection lesson" columns and a "🔎 Why it was
rejected" section on its page (evidence, what to improve).

Usage:
  python -m src.ai.rejection --job <job URL> [--send]
  python -m src.ai.rejection --pending [--limit 3] [--send]   # every Rejected application without a review
"""
import argparse
from html import escape
import json
import os
import sys

from .. import run_log, telegram, tgcard
from ..notion import cron_runs
from ..notion.ledger import RECORD_HEADING
from ..stores import base, open_stores
from ..stores.notion_blocks import to_markdown
from ..stores.notion_interviews import COLUMNS as INTERVIEW_COLUMNS
from ..stores.notion_rows import APPLICATION_COLUMNS, EVENT_COLUMNS
from . import cost
from .models import MAIN_MODEL
from .writing_floors import scrub
from .writing_rules import RULES as WRITING_RULES

DEFAULT_MODEL = os.getenv('JOB_PILOTTO_REJECTION_MODEL', os.getenv('JOB_PILOTTO_INSIGHT_MODEL', MAIN_MODEL))
HEADING = '🔎 Why it was rejected'
NOT_ON_YOU = 'Not a fit (not on you)'
VERDICTS = ['Presentation', 'Hard skills', 'Soft skills', NOT_ON_YOU, 'Unclear']
EMOJI = {'Presentation': '📝', 'Hard skills': '🛠', 'Soft skills': '🗣', NOT_ON_YOU: '🤷', 'Unclear': '❔'}
MAX_DESCRIPTION = 12_000

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'description': 'Every text is written TO the owner: "you" and "your", never "the owner", "the candidate" or their name. Only facts from the material given; a figure not in it is left out.',
    'required': ['verdict', 'confidence', 'stage_reached', 'summary', 'evidence', 'improve'],
    'properties': {
        'verdict': {'type': 'string', 'enum': VERDICTS},
        'confidence': {'type': 'string', 'enum': ['low', 'medium', 'high']},
        'stage_reached': {'type': 'string', 'description': 'e.g. "CV screen (no call)", "After the recruiter screen", "After the technical round"'},
        'summary': {'type': 'string', 'description': 'One sentence: the most likely reason, max 160 characters'},
        'evidence': {'type': 'array', 'items': {'type': 'string'}, 'description': '2 to 5 facts from the material that point to the verdict'},
        'improve': {'type': 'array', 'items': {'type': 'string'},
                    'description': f'Up to 3 concrete changes for next time; empty when the verdict is "{NOT_ON_YOU}"'},
    },
}

SYSTEM = f"""You review one rejected job application for its candidate (the owner of Jobadabra) and say, honestly \
and kindly, why it most likely failed and whether there's anything they can do better. You get the job posting, \
what was sent (answers, cover letter), the fit analysis made before applying, the timeline, interview reviews if \
there were interviews, the rejection email, and the candidate's profile (CV).

Pick one verdict:
- "Presentation": the candidate had what the role needed, but the CV, answers or cover letter didn't show it \
(missing keywords the posting stresses, experience buried, generic answers, a weak or missing cover letter).
- "Hard skills": a skill, technology, level or amount of experience the role required and the candidate lacks.
- "Soft skills": communication, structure, seniority or culture signals. Only with interview evidence: an \
application rejected before any conversation can never be "Soft skills".
- "{NOT_ON_YOU}": they wanted a different profile and nothing the candidate could reasonably change would help: \
location or country the role is limited to, work permit, a language, a domain or industry background, a level far \
from theirs, an internal hire, the role closed or paused, very many applicants for a narrow profile.
- "Unclear": the material doesn't support any verdict.

How to judge:
- A rejection within about a day, before any call, is usually an automatic or quick screen: location, permit, \
level or a hard requirement. Say which requirement when you can see it.
- Compare the posting's must-haves with the profile. A must-have the profile truly lacks is "Hard skills"; one the \
profile has but the answers or CV didn't show is "Presentation".
- Use interview reviews (weak answers, signals) for rejections after a conversation.
- Several applications to the same company rejected together (other countries of one role) point to the same cause.
- Don't invent facts. When the evidence is thin, say so with confidence "low" (or "Unclear").
- evidence: short facts, citing the posting, the answers or the timeline. improve: concrete and doable (a CV \
bullet to add, a keyword, a story to prepare), never generic advice; empty for "{NOT_ON_YOU}".
The candidate's profile follows.

"""
SYSTEM = WRITING_RULES + "\n\n" + SYSTEM


def _labelled(record, columns):
    """A store record's fields under their Notion column names, as the prompt has always shown a job, an event and an
    interview (links between records left out, as the relations were)."""
    return {column: record.get(field) for field, column, kind in columns
            if kind not in ('relation1', 'created') and not kind.startswith('json') and record.get(field) not in (None, '', [], False)}


def material(stores, app, email_text=''):
    """Everything known about one application (`app`: its record in the active store), as text for the model."""
    props = _labelled(app, APPLICATION_COLUMNS)
    record = base.kit_from(stores.applications.section(app['id'], RECORD_HEADING) or '') or {}   # the frozen application record
    job = record.get('job') or {}
    events = sorted((_labelled(e, EVENT_COLUMNS) for e in stores.events.list(app_id=app['id'])), key=lambda e: e.get('At') or '')
    interviews = [_labelled(i, INTERVIEW_COLUMNS) for i in stores.interviews.list(app_id=app['id'])]
    same_company = [f"- {r.get('title') or ''} ({r.get('stage') or ''})" for r in stores.applications.list()
                    if r.get('company') == props.get('Company') and r['id'] != app['id']] if props.get('Company') else []
    keep = ('Job', 'Company', 'Location', 'Work mode', 'Seniority', 'Salary', 'Channel', 'Via', 'Applied on', 'Fit score',
            'Stage', 'Notes', 'Next step', 'Cover letter', 'Answers captured', 'CV version')
    parts = ['## Application', '\n'.join(f'{k}: {props[k]}' for k in keep if props.get(k))]
    if props.get('Employer feedback'):
        parts += ['## Employer feedback (verbatim, primary evidence)', props['Employer feedback'][:12000]]
    match = record.get('match') or {}
    if match:
        parts += ['## Fit analysis before applying', json.dumps({k: v for k, v in match.items() if v not in (None, '', [])},
                                                                 ensure_ascii=False)[:4000]]
    parts += ['## Job posting', (job.get('description') or '(not kept)')[:MAX_DESCRIPTION]]
    answers = record.get('answers') or []
    if answers:
        parts += ['## Answers sent', '\n\n'.join(f"Q: {a.get('question')}\nA: {a.get('answer') or '—'}" for a in answers[:40])]
    if record.get('cover_letter'):
        parts += ['## Cover letter sent', record['cover_letter'][:4000]]
    if not record:
        parts += ['## Note', 'No application record was kept (applied outside Jobadabra): the answers and cover letter are unknown.']
    parts += ['## Timeline', '\n'.join(f"- {e.get('At')}: {e.get('Kind')} — {e.get('Note') or ''}"[:300] for e in events) or '(none)']
    if interviews:
        parts += ['## Interview reviews', '\n\n'.join(json.dumps({k: v for k, v in i.items() if v}, ensure_ascii=False)[:3000]
                                                        for i in interviews)]
    if same_company:
        parts += ['## Other applications at this company', '\n'.join(same_company)]
    if email_text:
        parts += ['## Rejection email', email_text[:4000]]
    return '\n\n'.join(parts)


def analyse(client, model, profile, text, stats=None):
    response = client.messages.create(
        model=model, max_tokens=2000,
        system=[{'type': 'text', 'text': SYSTEM + (profile or '(no profile)'), 'cache_control': {'type': 'ephemeral'}}],
        messages=[{'role': 'user', 'content': text}],
        output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}},
    )
    cost.add(stats, model, response.usage)
    result, _ = scrub(json.loads(next(b.text for b in response.content if b.type == 'text')), f'{profile or ""}\n{text}')   # no sentence with a figure the material never states (writing_floors.py)
    return result, response.usage


def _block(kind, content, bold=False):
    return {'object': 'block', 'type': kind, kind: {'rich_text': [
        {'type': 'text', 'text': {'content': content[:1900]}, 'annotations': {'bold': bold}}]}}


def blocks(result, model):
    out = [_block('callout', f"{EMOJI[result['verdict']]} {result['verdict']} ({result['confidence']} confidence) · "
                             f"{result['stage_reached']}. {result['summary']}")]
    out[0]['callout']['icon'] = {'type': 'emoji', 'emoji': EMOJI[result['verdict']]}
    out.append(_block('paragraph', 'Evidence', bold=True))
    out += [_block('bulleted_list_item', e) for e in result['evidence'][:6]]
    if result['improve']:
        out.append(_block('paragraph', 'What to improve next time', bold=True))
        out += [_block('to_do', i) for i in result['improve'][:3]]
    else:
        out.append(_block('paragraph', 'Nothing to improve here: they were looking for a different profile.'))
    out.append(_block('paragraph', f'Reviewed by {model}. A best guess from what Jobadabra kept, not what the company said.'))
    return out


def review_markdown(result, model):
    """The review section's Markdown: today's blocks (callout, evidence, to-dos) through the store's codec, so a Notion
    page shows exactly what it did."""
    return to_markdown(blocks(result, model))


def write(stores, app, result, model):
    lesson = result['summary'] + (f" Next time: {result['improve'][0]}" if result['improve'] else '')
    try:
        stores.applications.update(app['id'], {'rejection': result['verdict'], 'rejection_lesson': lesson[:1900]})
    except Exception as error:  # noqa: BLE001 — columns added at the app's next start; the job's section still has it all
        print(f'Warning: rejection fields not set ({type(error).__name__}); the review is on the job.', file=sys.stderr)
    stores.applications.set_section(app['id'], HEADING, review_markdown(result, model))


def line(app, result):
    """One short line for Telegram and the desktop app's activity panel."""
    return (f"{EMOJI[result['verdict']]} Why rejected · {app.get('company') or ''} — "
            f"{(app.get('title') or '')[:60]}: {result['verdict']} ({result['confidence']}). {result['summary']}")


def review(stores, app, *, email_text='', client=None, model=DEFAULT_MODEL, stats=None, profile=None):
    """Review one rejected application and write the result on it. Returns (result, one-line summary)."""
    if client is None:
        from . import engine
        client = engine.client(action='review')
    profile = stores.texts.plain('profile') if profile is None else profile   # as the AI read it before the store (Notion: page_text)
    result, usage = analyse(client, model, profile, material(stores, app, email_text), stats)
    if result['verdict'] not in VERDICTS:
        result['verdict'] = 'Unclear'
    if result['verdict'] == NOT_ON_YOU:
        result['improve'] = []
    write(stores, app, result, cost.answered(model, usage))   # "Reviewed by" names the model that answered
    return result, line(app, result)


def pending(stores, limit=3):
    """Rejected applications with no review yet, the latest applied first."""
    todo = [app for app in stores.applications.list(stages=['Rejected']) if not app.get('rejection')]
    return sorted(todo, key=lambda app: app.get('applied_on') or '', reverse=True)[:limit]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument('--job', help='the application\'s Job URL')
    target.add_argument('--pending', action='store_true', help='every Rejected application without a review')
    parser.add_argument('--limit', type=int, default=3)
    parser.add_argument('--send', action='store_true', help='send the result to Telegram')
    args = parser.parse_args(argv)
    stores = open_stores()   # the active store: Notion, or this Mac's
    rows = [stores.applications.get(args.job)] if args.job else pending(stores, args.limit)
    if args.job and not rows[0]:
        raise SystemExit(f'No application for {args.job}')
    if not rows:
        print('No rejected application waits for a review.')
        return 0
    stats, profile, lines = {}, stores.texts.plain('profile'), []
    run_log.auto_begin(stores)  # the review's run opens when it starts, in the active store
    log = run_log.new_run('rejection')
    if len(rows) == 1:  # a review of one job: the run links to it (several: about none in particular)
        log['application'] = rows[0]['id']
    one = rows[0]
    log['subject'] = (cron_runs.job_subject(company=one.get('company') or '', role=one.get('title') or '', via=one.get('via') or '')
                      if len(rows) == 1 else cron_runs.counted(len(rows), 'application'))
    try:
        for row in rows:
            _, summary = review(stores, row, stats=stats, profile=profile)
            lines.append(summary)
            print(summary)
    finally:  # one ⏰ Cronjob Runs row per review run, like every AI job
        log.update(insight=stats, updates=lines)
        run_log.log_run(stores, log)
    if args.send and lines:
        token, chat_id = telegram.credentials()
        telegram.deliver(tgcard.card('Why it was rejected', f"{len(lines)} application{'s' if len(lines) != 1 else ''} reviewed",
                                  ['\n'.join(map(escape, lines))], emoji='🔎'), token, chat_id)
    print(f"Rejection review: {len(lines)} application(s) (${(stats or {}).get('usd', 0.0):.3f})")
    return 0


if __name__ == '__main__':
    sys.exit(main())
