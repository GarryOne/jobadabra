#!/usr/bin/env python3
"""Interview prep kit: how to prepare for one interview, from the job's description, your Profile and how your past
interviews went. Written on the job's Notion page (🎤 Interview prep) and dated in the Interview prep column.

It needs to know the role first: the job's description (🧾 Job description, from a pasted message or screenshots, or
added here), a posting it can read, or a recruiter's message that describes the role. Without one it asks for it
(needs_description) instead of guessing.

    python -m src.ai.prep build <application page id>
    python -m src.ai.prep describe <application page id> [--text TEXT] [--url URL]
Prints one JSON line: {"ok": ..., "text": ..., "needs_description": ...}.
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

from ..notion import ledger, titles
from ..notion.ledger import _block
from ..stores import base, open_stores
from ..stores.notion_blocks import to_markdown
from . import cost, engine, mail
from .models import MAIN_MODEL, SMALL_MODEL
from .writing_floors import scrub
from .writing_rules import RULES as WRITING_RULES

DEFAULT_MODEL = os.getenv('JOB_PILOTTO_PREP_MODEL', MAIN_MODEL)
HEADING = '🎤 Interview prep'
DESCRIPTION_HEADING = '🧾 Job description'
MIN_ROLE = 400  # characters about the role before a kit is worth building
SECTIONS = ('🧾 Job description', '🤝 Recruiter message', base.LOGGED)   # base.LOGGED: the messages you logged (src/ai/inbox.py)

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'description': 'Every text is written TO the owner: "you" and "your", never "the owner", "the candidate" or their name. Only facts from the material given; a figure not in it is left out.',
    'required': ['interview_type', 'since_last_call', 'do_differently', 'assess', 'questions', 'stories', 'gaps', 'ask_them', 'plan', 'unknowns'],
    'properties': {
        'interview_type': {'type': 'string', 'description': 'recruiter screen, recruiter follow-up, hiring manager, technical, '
                                                            'system design, or other'},
        'since_last_call': {'type': 'array', 'items': {'type': 'string'},
                            'description': 'Follow-up only (else []): what the earlier calls established, and what they said '
                                           'would be discussed next (e.g. salary, contract setup, relocation), 3-6 items'},
        'do_differently': {'type': 'array', 'items': {'type': 'string'},
                           'description': 'Follow-up only (else []): what to do differently this round, from how the last call went'},
        'assess': {'type': 'array', 'items': {'type': 'string'}, 'description': '3-5 things this interview will likely assess'},
        'questions': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['question', 'answer_with'],
                      'properties': {'question': {'type': 'string'}, 'answer_with': {'type': 'string',
                                     'description': 'what from the owner\'s Profile to answer with (a concrete fact or story), 1-2 sentences'}}},
                      'description': '6-10 likely questions'},
        'stories': {'type': 'array', 'items': {'type': 'string'}, 'description': '3 stories from the Profile to have ready (situation, what you did, result)'},
        'gaps': {'type': 'array', 'items': {'type': 'string'}, 'description': 'where the role asks more than the Profile shows, and how to handle each honestly'},
        'ask_them': {'type': 'array', 'items': {'type': 'string'}, 'description': '4-6 good questions to ask them, incl. what the role leaves unclear'},
        'plan': {'type': 'array', 'items': {'type': 'string'}, 'description': 'a short prep plan, step by step, fitting the time left'},
        'unknowns': {'type': 'array', 'items': {'type': 'string'}, 'description': 'facts that matter but are unknown (employer, pay, …) to ask the recruiter'},
    },
}

SYSTEM = """You help the owner prepare for one job interview. Use only what the job text and the owner's Profile say;
never invent facts about the owner or the employer. For a recruiter or agency screen, focus on motivation, fit, the
owner's pitch, salary expectations, notice period and availability; for technical rounds, on depth in the role's stack,
incidents and trade-offs. What Jobadabra learned about the owner (weak topics, topics asked most, rejection lessons, employer feedback):
work those into the questions, the gaps and the plan, and say where a past lesson applies.
When "What already happened on THIS application" lists earlier interviews, this is a FOLLOW-UP round: don't repeat an
intro kit (the pitch, generic motivation questions they already heard). Fill since_last_call with what the last call
established and what they said would be discussed next; questions are the likely ones for THIS round (e.g. salary,
contract setup, relocation, start date for a recruiter follow-up; deeper stack and incidents for a technical round);
do_differently from the weak answers and how the last call went; ask_them only what is still open. The recruiter's
latest message says what this call is for. Without earlier interviews, since_last_call and do_differently are [].
Keep every item short and concrete."""
SYSTEM = SYSTEM + "\n\n" + WRITING_RULES


def role_of(record):
    """The job's role without a generated " · Acme" / " · via Huxley" (src/notion/titles.py), as mail._role does for a row."""
    return titles.role_of(record.get('title') or '', record.get('company') or '', record.get('via') or '')


def _sections(text):
    """The job page's text by section heading (the page's own headings)."""
    parts, current = {}, ''
    for line in (text or '').splitlines():
        heading = re.match(r'^#+\s*(.+)$', line.strip())
        if heading:
            current = heading.group(1).strip()
            continue
        parts.setdefault(current, []).append(line)
    return {name: '\n'.join(lines).strip() for name, lines in parts.items()}


def role_text(stores, record, db_path=None):
    """What's known about the role: the job's description, the posting in the job cache, the recruiter's message and the
    messages you logged on the job."""
    sections = stores.applications.sections(record['id'])
    known = [sections.get(name, '') for name in SECTIONS if sections.get(name)]
    url = record.get('url') or ''
    if url and not re.search(r'mail\.google|linkedin\.com/messaging|jobpilotto', url):
        try:
            from .. import store
            from ..paths import jobs_db
            with store.connect(db_path or jobs_db()) as db:
                hit = db.execute('SELECT description FROM jobs WHERE url=?', (url,)).fetchone()
            if hit and hit[0]:
                known.insert(0, hit[0])
        except Exception:  # noqa: BLE001 — the page is enough when the cache isn't there
            pass
    return '\n\n'.join(known).strip()


def about_role(text):
    """Characters that actually describe the role (a Teams invite or legal footer don't)."""
    noise = re.compile(r'teams\.microsoft|meeting id|passcode|dial in|confidential|registered|unsubscribe|https?://', re.I)
    return sum(len(line) for line in text.splitlines() if line.strip() and not noise.search(line))


def describe(stores, record, text='', url=''):
    """You gave the role: pasted text, or a posting link (read, except LinkedIn and the like)."""
    body = (text or '').strip()
    if url and not body:
        meta = ledger.page_meta(url)
        body = (meta.get('description') or '').strip()
        if not body:
            return {'ok': False, 'text': "That page can't be read (LinkedIn and some sites never are): paste the description instead."}
    if len(body) < 80:
        return {'ok': False, 'text': 'Paste the whole job description (what the role does, its stack, requirements).'}
    # The job's own section in every store: the blocks it always had (ledger.md_blocks: a "# Role" or a bold label alone
    # on its line heads what follows), as Markdown through the store's codec, so a Notion page shows the same.
    blocks = ledger.md_blocks(body)
    if url:
        blocks.insert(0, _block('paragraph', f'Posting: {url}'))
    stores.applications.set_section(record['id'], DESCRIPTION_HEADING, to_markdown(blocks))
    return {'ok': True, 'text': 'Job description saved on the job.'}


def what_you_learned(stores, record):
    """What Jobadabra has learned about you so far, for this kit: topics you answered weakly and the ones asked
    most (reviewed interviews), why past applications were rejected (rejection reviews), and what employers said
    (employer feedback). Lines for the prompt; each part is left out when there's nothing yet."""
    from .insights_data import interview_stats
    stats = interview_stats(stores)
    weak, asked = list(stats.get('topics_answered_weakly', {}))[:6], list(stats.get('topics_asked', {}))[:6]
    lines = [f"Topics you answered weakly in past interviews: {', '.join(weak) or 'none recorded yet'}"]
    if asked:
        lines.append(f"Topics interviewers asked most: {', '.join(asked)}")
    try:
        others = [r for r in stores.applications.list() if r['id'] != record['id'] and (r.get('rejection_lesson') or r.get('employer_feedback'))]
    except Exception:  # noqa: BLE001 — the kit is still useful without them
        others = []
    others.sort(key=lambda r: r.get('created_at') or '', reverse=True)
    who = lambda r: r.get('company') or r.get('via') or ''
    lessons = [f"{who(r)}: {r['rejection_lesson'][:240]}" for r in others if r.get('rejection_lesson')][:5]
    feedback = [f"{who(r)}: {r['employer_feedback'][:240]}" for r in others if r.get('employer_feedback')][:4]
    if lessons:
        lines.append('Lessons from your past rejections:\n- ' + '\n- '.join(lessons))
    if feedback:
        lines.append('What employers told you:\n- ' + '\n- '.join(feedback))
    return lines


MAX_EARLIER = 3  # earlier interviews of this application the kit reads (newest first)
REVIEW_PARTS = {'Weak spots': 3, 'Signals from them': 5, 'Could count against you': 3, 'Facts from the call': 6,
                'Practise before the next round': 3}


def review_of(review_markdown):
    """An interview's saved review (src/ai/interviews.py, its `review` Markdown), read back as
    {'summary', 'weak_answers': [question lines marked ⚠️/❌], <section title>: [lines]}; the transcript is not read."""
    from . import interviews
    review, section = {'summary': '', 'weak_answers': []}, None
    for raw in (review_markdown or '').splitlines():
        heading = re.match(r'^\s*#+\s+(?:▸\s+)?(.*)$', raw)
        if heading:
            if heading.group(1).strip() == 'Transcript':
                break
            section = heading.group(1).strip()
            continue
        text = re.sub(r'^\s*(?:[-*]\s+(?:\[[ x]\]\s+)?|\d+[.)]\s+|>\s*(?:\[![^\]]*\]\s*)?)', '', raw).strip()
        if not text or text == interviews.PLACEHOLDER or text.startswith('🔗'):
            continue
        if section is None and not review['summary']:
            review['summary'] = text
        elif section == 'Questions' and text[:1] in ('⚠', '❌'):
            review['weak_answers'].append(text)
        elif section in REVIEW_PARTS:
            review.setdefault(section, []).append(text)
    return review


def earlier_interviews(stores, record):
    """What already happened on THIS application: its reviewed interviews (newest first, at most MAX_EARLIER) with each
    review's summary, next step, weak answers, what they said, and facts from the call. [] when none."""
    from .. import focus
    try:
        found = stores.interviews.list(app_id=record['id'])
    except Exception as error:  # noqa: BLE001 — the kit is still useful without them
        print(f'Warning: interviews of this job unreadable: {type(error).__name__}: {error}', file=sys.stderr)
        return []
    reviews = {one['id']: one.get('review') or '' for one in found}
    found = [{**one, 'link': stores.link(one['id']) or ''} for one in found]   # its page (Notion), for Focus's url
    picked = focus.reviewed_interviews(found, record['id'])[:MAX_EARLIER]
    for one in picked:
        one['review'] = review_of(reviews.get(one['id'], ''))
    return picked


def latest_events(stores, record, limit=3):
    """The application's latest events with a note (newest first): e.g. the recruiter asking to confirm a follow-up
    time. Lines for the prompt."""
    try:
        events = stores.events.list(app_id=record['id'])
    except Exception as error:  # noqa: BLE001
        print(f'Warning: events of this job unreadable: {type(error).__name__}: {error}', file=sys.stderr)
        return []
    events = [e for e in sorted(events, key=lambda e: e.get('at') or '', reverse=True) if e.get('note')]
    return [f"- {(e.get('at') or '')[:16].replace('T', ' ')} · {e.get('kind') or 'Event'}: {e['note'][:400]}" for e in events[:limit]]


def follow_up_text(earlier, events):
    """The prompt's "What already happened on THIS application" section, or '' with no earlier interview."""
    if not earlier:
        return ''
    parts = ['# What already happened on THIS application (a follow-up round)']
    for one in earlier:
        review = one.get('review') or {}
        lines = [f"## {one['day']} · {one['round'] or 'Interview'} · went {one['overall'] or '—'}"]
        if review.get('summary'):
            lines.append(f"Summary: {review['summary'][:600]}")
        lines.append(f"Next step they said: {one['next_step'] or 'not stated'}")
        if one['weak_topics']:
            lines.append(f"Topics answered weakly: {one['weak_topics']}")
        for answer in review.get('weak_answers', [])[:4]:
            lines.append(f'- {answer[:300]}')
        for title, most in REVIEW_PARTS.items():
            if review.get(title):
                lines.append(f'{title}:\n' + '\n'.join(f'- {x[:300]}' for x in review[title][:most]))
        parts.append('\n'.join(lines)[:3000])
    if events:
        parts.append("## The recruiter's latest messages on this job (newest first)\n" + '\n'.join(events))
    return '\n\n'.join(parts)


READ_MODEL = os.getenv('JOB_PILOTTO_INBOX_MODEL') or SMALL_MODEL
MAX_SHOTS = 5


def _ask():
    return {'ok': False, 'needs_description': True,
            'text': 'To prepare you, Jobadabra needs the job description: paste it, or the posting link.'}


def screenshots(stores, record, fetch=True):
    """The images kept on the job (logged screenshots), newest last, as (name, bytes, media type); with fetch=False only
    their names (whether there are any)."""
    try:
        found = [f for f in stores.applications.files(record['id']) if str(f[2]).startswith('image/')][-MAX_SHOTS:]
    except Exception as error:  # noqa: BLE001 — no screenshot is no reason to fail the kit
        print(f'Warning: screenshots not read: {type(error).__name__}: {error}', file=sys.stderr)
        return []
    return found if fetch else [name for name, _, _ in found]


def role_from_screenshots(stores, record, client, stats=None):
    """What the job's screenshots say about the role, transcribed (Claude reads them together), else ''."""
    shots = screenshots(stores, record)
    if not shots:
        return ''
    print(f'⏳ Reading the {len(shots)} screenshots on the job for its description', file=sys.stderr, flush=True)
    import base64
    content = [{'type': 'image', 'source': {'type': 'base64', 'media_type': kind, 'data': base64.b64encode(data).decode()}}
               for _, data, kind in shots]
    content.append({'type': 'text', 'text': 'These screenshots are about one job (e.g. a chat with a recruiter). Transcribe '
                    'everything they say about the role itself: company or client, responsibilities, stack, team, '
                    'requirements, location, work mode, contract, pay, interview process. Plain text, no commentary; '
                    'nothing if they say nothing about the role.'})
    effort = engine.effort_for(READ_MODEL, None)   # only Haiku 5.5 sets one (low); other models keep their default
    response = client.messages.create(model=READ_MODEL, max_tokens=2000, messages=[{'role': 'user', 'content': content}],
                                      **({'output_config': {'effort': effort}} if effort else {}))
    cost.add(stats, READ_MODEL, response.usage)
    return next((b.text for b in response.content if b.type == 'text'), '').strip()


def build(stores, record, client=None, model=DEFAULT_MODEL, stats=None, now=None, db_path=None):
    """A prep kit for the job (`record`, from the active store): saved as its 🎤 Interview prep section."""
    now = now or datetime.now(timezone.utc)
    role = role_text(stores, record, db_path)
    if client is None and about_role(role) < MIN_ROLE and not screenshots(stores, record, fetch=False):
        return _ask()
    if client is None:
        client = engine.client(action='prep')
    if about_role(role) < MIN_ROLE:
        # Screenshots you logged on the job (e.g. a LinkedIn chat, before the Log box kept its text) say what the
        # role is: read them, keep that as the job's description, and go on instead of asking you again.
        read = role_from_screenshots(stores, record, client, stats)
        if about_role(read) >= MIN_ROLE // 2:
            describe(stores, record, text=read)
            role = f'{read}\n\n{role}'.strip()
    if about_role(role) < MIN_ROLE // 2:
        return _ask()
    profile = stores.texts.plain('profile')   # as the AI read it before the store (Notion: page_text)
    history = what_you_learned(stores, record)
    earlier = earlier_interviews(stores, record)
    follow_up = follow_up_text(earlier, latest_events(stores, record) if earlier else [])
    coming = mail._when(record.get('next_interview') or '')
    field = lambda name: record.get(name) or ''
    facts = [f"Role: {role_of(record)}", f"Employer: {field('company') or 'not named'}",
             f"Via: {field('via') or '—'} (contact: {field('contact') or '—'})",
             f"Stage: {field('stage')}", f"Salary: {field('salary') or 'unknown'}",
             f"Interview: {coming.astimezone(mail.TZ):%a %d %b %H:%M} ({round((coming - now).total_seconds() / 3600)} h from now)"
             if coming else 'Interview: time unknown',
             ] + history
    response = client.messages.create(
        # Room for the model's thinking plus a full kit (3000 cut one off mid-answer); medium effort, as the kits.
        model=model, max_tokens=8000, system=SYSTEM,
        messages=[{'role': 'user', 'content': '\n'.join(facts) + (f'\n\n{follow_up}' if follow_up else '')
                   + f'\n\n# The job\n{role[:12000]}\n\n# Owner\'s Profile\n{profile[:12000]}'}],
        output_config=engine.structured(SCHEMA, model))
    cost.add(stats, model, response.usage)
    if getattr(response, 'stop_reason', None) == 'max_tokens':  # a cut-off answer is no kit: say so, not a JSON error
        raise RuntimeError('The prep kit came back cut off (too long for one answer). Try again; if it repeats, the job text is very long.')
    kit = json.loads(next(b.text for b in response.content if b.type == 'text'))
    kit, _ = scrub(kit, f'{role}\n{profile}\n' + '\n'.join(facts))   # no sentence with a figure the job text and the Profile never state (writing_floors.py)
    usd = cost.usd(model, response.usage)
    write_kit(stores, record['id'], kit_markdown(kit, now, usd), earlier_day=record.get('interview_prep') or '')
    try:  # with the time: Focus compares it with the interviews reviewed since (src/focus.py prep_state)
        stores.applications.update(record['id'], {'interview_prep': now.isoformat(timespec='seconds')})
    except Exception as error:  # noqa: BLE001 — a workspace without the column yet (the app adds it)
        print(f'Warning: Interview prep date not set: {type(error).__name__}: {error}', file=sys.stderr)
    after = f", after {len(earlier)} earlier interview{'s' if len(earlier) != 1 else ''}" if earlier else ''
    return {'ok': True, 'text': f"Prep kit ready on the job's page ({kit['interview_type']}{after}, ${usd:.2f}).", 'usd': usd}


KIT_TITLES = ('Since your last call', 'Do differently this time', 'What they will likely assess', 'Likely questions',
              'Stories to have ready', 'Gaps and how to handle them', 'Ask them', 'Still unknown: ask the recruiter',
              'Your prep plan')
EARLIER = 'Earlier kit'
MAX_BLOCKS = 95  # a kit, and the earlier kit inside its toggle: within Notion's 100 blocks per request


def blocks(kit, now, usd):
    bullet = lambda text: _block('bulleted_list_item', text)
    out = [_block('paragraph', f"{kit['interview_type'].capitalize()} · built {now:%d %b %Y} · ${usd:.2f}", bold=True)]
    if kit.get('since_last_call'):
        out += [_block('heading_3', 'Since your last call')] + [bullet(x) for x in kit['since_last_call']]
    if kit.get('do_differently'):
        out += [_block('heading_3', 'Do differently this time')] + [bullet(x) for x in kit['do_differently']]
    out += [_block('heading_3', 'What they will likely assess')] + [bullet(x) for x in kit['assess']]
    out += [_block('heading_3', 'Likely questions')] + [bullet(f"{q['question']} → {q['answer_with']}") for q in kit['questions']]
    out += [_block('heading_3', 'Stories to have ready')] + [bullet(x) for x in kit['stories']]
    if kit['gaps']:
        out += [_block('heading_3', 'Gaps and how to handle them')] + [bullet(x) for x in kit['gaps']]
    out += [_block('heading_3', 'Ask them')] + [bullet(x) for x in kit['ask_them']]
    if kit['unknowns']:
        out += [_block('heading_3', 'Still unknown: ask the recruiter')] + [bullet(x) for x in kit['unknowns']]
    out += [_block('heading_3', 'Your prep plan')] + [_block('numbered_list_item', x) for x in kit['plan']]
    return out[:MAX_BLOCKS]


def kit_markdown(kit, now, usd):
    """The kit as the section's Markdown: today's blocks through the store's codec, so a Notion page shows the same."""
    return to_markdown(blocks(kit, now, usd))


def _current_kit(markdown):
    """The kit in a prep section's Markdown, without its folded Earlier kit (only the latest earlier one is kept). A page
    rebuilt before 30 Sep 2026 has older kits stacked below the newest: only the newest kit (up to its second "What they
    will likely assess") counts."""
    lines, kept, inside, assess = (markdown or '').splitlines(), [], False, 0
    for line in lines:
        if line.startswith(f'▸ {EARLIER}'):
            inside = True
            continue
        if inside and (line.startswith('  ') or not line.strip()):
            continue
        inside = False
        if line.strip() == f'### {KIT_TITLES[2]}':
            assess += 1
            if assess > 1:
                break
        kept.append(line)
    return '\n'.join(kept).strip()


def write_kit(stores, app_id, kit_md, earlier_day=''):
    """The new kit under 🎤 Interview prep; the kit it replaces is kept below it, folded: "▸ Earlier kit · built <date>"
    (only the latest earlier one: an older folded kit is dropped). The section is made when the job has none."""
    old = _current_kit(stores.applications.section(app_id, HEADING))
    if old:
        built = re.search(r'built (\d{1,2} \w{3} \d{4})', old.splitlines()[0])
        when = built.group(1) if built else (f'{int(earlier_day[8:10])} {datetime.fromisoformat(earlier_day[:10]):%b %Y}'
                                             if re.match(r'\d{4}-\d{2}-\d{2}', earlier_day or '') else 'earlier')
        folded = '\n'.join(f'  {line}' if line.strip() else '' for line in old.splitlines())
        kit_md = f'{kit_md.rstrip()}\n\n▸ {EARLIER} · built {when}\n{folded}'
    stores.applications.set_section(app_id, HEADING, kit_md)


def logged_build(stores, record, client=None, now=None):
    """build(), recorded as a run like every AI job (⏰ Cronjob Runs): its row opens as Running when it starts (Recent
    activity shows it while it works, tagged "By you") and is completed with its result, AI cost and duration, or as
    Failed with the error, so nothing only lives in the dialog. It counts toward the month's AI budget."""
    from .. import run_log
    from ..notion import cron_runs   # the report's words only (job_subject); the run is logged in the store (run_log)
    run = run_log.new_run('prep')
    run['subject'] = cron_runs.job_subject(company=record.get('company') or '', role=record.get('title') or '', via=record.get('via') or '')
    run['application'] = record['id']  # the run links to the job it was for
    run['headline'] = f"{record.get('company') or record.get('via') or ''} · {role_of(record)}"[:200]
    started = datetime.now(timezone.utc)
    run_log.begin(stores, run)
    try:
        result = build(stores, record, client=client, stats=run.setdefault('interview', {}), now=now)
    except Exception as error:  # noqa: BLE001 — recorded as failed, then shown in the dialog
        result = {'ok': False, 'text': f'{type(error).__name__}: {error}'[:300]}
    run['headline'] = f"{run['headline']}: {result.get('text', '')}"[:300]
    run['seconds'] = int((datetime.now(timezone.utc) - started).total_seconds())
    try:
        run_log.log_run(stores, run, failed=not result.get('ok') and not result.get('needs_description'))
    except Exception as error:  # noqa: BLE001 — the kit matters more than its log line
        print(f'Warning: run not recorded: {type(error).__name__}: {error}', file=sys.stderr)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('build').add_argument('page_id')
    about = sub.add_parser('describe')
    about.add_argument('page_id')
    about.add_argument('--text', default='')
    about.add_argument('--url', default='')
    args = parser.parse_args(argv)
    try:
        stores = open_stores()   # Notion (its token) or this Mac's store, as JOB_PILOTTO_STORE / the token choose
        record = stores.applications.by_id(args.page_id)
        if record is None:
            result = {'ok': False, 'text': 'That job is no longer tracked.'}
        elif args.command == 'describe':
            result = describe(stores, record, args.text, args.url)
        else:
            print('⏳ Reading the job and your Profile', file=sys.stderr, flush=True)
            result = logged_build(stores, record)
    except Exception as error:  # noqa: BLE001 — the app shows the reason
        result = {'ok': False, 'text': f'{type(error).__name__}: {error}'[:300]}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get('ok') or result.get('needs_description') else 1


if __name__ == '__main__':
    sys.exit(main())
