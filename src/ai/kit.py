#!/usr/bin/env python3
"""Application kit: a drafted cover letter and form answers for one job, on request.

Triggered by the 📝 Prepare button. Reads the Notion Profile and Application
Answers pages, the posting and its stage 1/2 results, and (for Greenhouse) the
real application form, then asks Claude for a cover letter plus one answer per
form question. The kit goes to the job's Notion page (readable text plus a JSON
block a form filler can use) and to Telegram as copyable blocks.

Nothing here submits anything: the owner reviews and applies.
"""
from datetime import datetime, timezone
from html import escape
import json
import os
import re
import urllib.request

from .. import paths as _paths  # noqa: F401 (import side effect: loads .env before getenv below)
from . import cost, engine
from ..stores import base, rules
from ..stores.notion_blocks import to_markdown
from .models import MAIN_MODEL
from .writing_floors import kit_floors
from .writing_rules import RULES as WRITING_RULES

DEFAULT_MODEL = os.getenv('JOB_PILOTTO_KIT_MODEL', MAIN_MODEL)
KIT_VERSION = 1
KIT_HEADING = '📝 Application kit'
KIT_SECTION = base.KIT_SECTION   # the job's section the kit is kept in, on every store
ANSWERS_PAGE_ID = os.getenv('NOTION_ANSWERS_PAGE_ID', '')
DEFAULT_AUTO_MIN_SCORE = 50
DEFAULT_AUTO_MAX = 5

AUTO_TABLE = """
CREATE TABLE IF NOT EXISTS auto_kits (
    job_id INTEGER PRIMARY KEY REFERENCES jobs(id),
    created_at TEXT NOT NULL
);
"""
PRICES = cost.PRICES  # USD per million tokens; see cost.py

# Filled from the owner's contact details or the CV file, not drafted.
PERSONAL_FIELDS = {'first_name', 'last_name', 'preferred_name', 'email', 'phone', 'resume', 'resume_text',
                   'cover_letter', 'cover_letter_text', 'longitude', 'latitude'}
GREENHOUSE_JOB = re.compile(r'greenhouse\.io/([\w-]+)/jobs/(\d+)')

SCHEMA = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['eligible', 'eligibility_note', 'cover_letter', 'answers', 'highlights', 'check_before_sending'],
    'properties': {
        'eligible': {'type': 'boolean', 'description': 'False when the posting clearly rules the candidate out or the job is in a field the profile shows nothing for (no match)'},
        'eligibility_note': {'type': 'string', 'description': 'Why not eligible, one sentence; "" when eligible'},
        'cover_letter': {'type': 'string', 'description': 'Plain text in the first person ("I", never the name in the third person), paragraphs separated by blank lines, the name alone on the last line; no salary; "" when eligible is false'},
        'answers': {
            'type': 'array',
            'items': {
                'type': 'object', 'additionalProperties': False,
                'required': ['field', 'question', 'answer', 'needs_review', 'category'],
                'properties': {
                    'field': {'type': 'string', 'description': 'Form field name as given, or "" if not from a form'},
                    'question': {'type': 'string'},
                    'answer': {'type': 'string', 'description': 'For select fields: one option label, verbatim'},
                    'needs_review': {'type': 'boolean',
                                     'description': 'True when the answer rests on a guess or a ❓ field'},
                    'category': {'type': 'string', 'enum': ['knockout', 'legal', 'demographic', 'contact', 'normal'],
                                 'description': 'What kind of question, in any language (the extension never fills a legal one)'},
                },
            },
        },
        'highlights': {'type': 'array', 'items': {'type': 'string'},
                       'description': '3-5 CV points to lead with for this job'},
        'check_before_sending': {'type': 'array', 'items': {'type': 'string'},
                                 'description': 'Facts the owner must confirm (sponsorship, salary, language, ...)'},
    },
}

SYSTEM = """You prepare job applications for one candidate. Their profile, standard \
answers and (when given) CV follow. You draft; the candidate reviews and submits.

Rules:
- Use only the applicant details given here; never a name, e-mail address, phone number, country, city, street address or other location from any other context (such as an account you are signed in with): when a detail is not given, leave it empty.
- Use only facts from the profile, the standard answers, the CV and the posting. Never invent \
experience, numbers, employers, certifications or links. The CV is the main CV with the bullets of the candidate's other CV \
versions added to its roles: an answer about their experience may rest on any bullet that fits the question.
- Cover letter: follow the style in the standard answers; by default 130-170 words, two short \
paragraphs of uneven length (not three symmetric ones), in the posting's language (see Language below), \
plain and slightly terse, first \
person, occasional short sentence or fragment. It is personal, not a CV summary: the CV is attached \
and already lists projects and numbers, so don't repeat them. First paragraph: who the candidate is \
and how they work, in a sentence or two, at the level of the role. Second paragraph: why this \
company/role (one concrete detail from the posting) and any honest gap, then stop — no closing \
"I look forward to..." paragraph. No \
clichés ("I am writing to express", "passionate", "team player", "wear many hats", "perfect fit"), \
no greeting line; sign off with just the name, no "Best regards" formality. Avoid rigid, uniform \
paragraph structure and generic phrasing — these are the biggest tells that a letter is AI-drafted.
- Voice: write in the candidate's own voice as described in the standard answers' cover letter
style (direct, personal, openly says what excites them, plain words, short sentences), and match
its example answer. Never polished marketing or AI-sounding phrasing.
- Pick achievements per question and per role, not the same headline everywhere. An achievement belongs only where the question is about that kind of work
or "a big initiative you drove" is what's asked. "Why this company / why this role" questions are
about motivation: answer why this company and role, don't recap the CV.
- Answers: one entry per form question you are given, in order, using its field name. For select \
fields answer with exactly one of the listed options. Work authorisation and sponsorship depend \
on the job's country: use the standard answers for that country. Demographic questions: use the \
standard answer (default: decline). Consent/acknowledge questions: answer with the acknowledging \
option and set needs_review.
- Language: write the cover letter and the free-text answers in the language the posting is written in when the profile shows \
the candidate speaks it well (a French posting gets French for a French speaker); otherwise in English, which the candidate can read \
and defend in an interview. A language the standard answers name for applications wins over both. Keep option values of select \
fields exactly as listed. If the posting asks for a language the profile doesn't show, add it to check_before_sending.
- category of each answer, in whatever language the form is: knockout = the employer can reject on it alone (work authorisation, \
visa or sponsorship, location, relocation, on-site days, a required licence or language); legal = a consent, terms, privacy notice, \
certification or acknowledgement (the extension never ticks these: the candidate does); demographic = gender, ethnicity, disability, \
veteran or similar voluntary questions; contact = name, email, phone, address; normal = anything else.
- With no form given, answer the questions this posting's application most likely asks \
(why this company, why this role, relevant experience), field "".
- Where the standard answer is marked ❓ or missing, write your best short draft and set \
needs_review; never state a guess as fact. Salary: only a figure from the standard answers.
- check_before_sending: short items the candidate must verify, e.g. a required language, a \
sponsorship answer, a ❓ field you relied on.
- highlights: always 3 to 5 points from the candidate's profile to lead with for this job, even when eligible is false or the fit is poor; never an empty list.
- eligible: false when the posting clearly rules the candidate out (a work location, residence or \
authorization the profile says they can't meet, or a required language they don't speak) or the job is in another field \
the profile shows nothing for; say why in eligibility_note, one sentence starting "Not a match:". Then cover_letter is "" \
(no letter is written for a job that is no match). Otherwise eligible is true and eligibility_note is "". Still draft every answer.

{WRITING_RULES}

Candidate profile:
"""
SYSTEM = SYSTEM.replace('{WRITING_RULES}', WRITING_RULES)


def greenhouse_ref(url):
    match = GREENHOUSE_JOB.search(url or '')
    return match.groups() if match else None


def form_questions(url, opener=None):
    """Questions of the job's application form, or [] when the form isn't readable (non-Greenhouse)."""
    ref = greenhouse_ref(url)
    if not ref:
        return []
    api = f'https://boards-api.greenhouse.io/v1/boards/{ref[0]}/jobs/{ref[1]}?questions=true'
    request = urllib.request.Request(api, headers={'User-Agent': 'JobPilotto/0.1 (personal job search)'})
    with (opener or urllib.request.urlopen)(request, timeout=20) as response:
        data = json.load(response)
    groups = [('', data.get('questions') or []), ('', data.get('location_questions') or [])]
    for block in data.get('compliance') or []:
        groups.append(('Demographic', block.get('questions') or []))
    questions = []
    for kind, items in groups:
        for item in items:
            fields = [f for f in item.get('fields', []) if f.get('name') not in PERSONAL_FIELDS
                      and f.get('type') != 'input_hidden']
            for field in fields[:1]:
                questions.append({
                    'field': field['name'], 'label': item.get('label', ''), 'required': bool(item.get('required')),
                    'type': field.get('type', ''), 'kind': kind,
                    'options': [v.get('label', '') for v in field.get('values') or []],
                })
    # What Greenhouse keeps outside its question list, so the kit covers it too and the form fills without asking Claude
    # at fill time: the education section (a flag, not questions; the form's fields are school--0, degree--0,
    # discipline--0, searchable lists), the Hispanic/Latino question that comes with Race, and Country.
    if data.get('education') in ('education_optional', 'education_required'):
        required = data['education'] == 'education_required'
        for field, label in (('school--0', 'School (your highest degree)'), ('degree--0', 'Degree'), ('discipline--0', 'Discipline')):
            questions.append({'field': field, 'label': label, 'required': required, 'type': 'education', 'kind': 'Education', 'options': []})
    if any(q['field'] == 'race' for q in questions) and not any(q['field'] == 'hispanic_ethnicity' for q in questions):
        questions.append({'field': 'hispanic_ethnicity', 'label': 'Are you Hispanic/Latino?', 'required': False, 'type': 'multi_value_single_select',
                          'kind': 'Demographic', 'options': ['Yes', 'No', 'Decline to self identify']})
    if not any(q['field'] == 'country' for q in questions):
        questions.append({'field': 'country', 'label': 'Country (where you live now)', 'required': False, 'type': 'country',
                          'kind': 'Contact', 'options': []})
    return questions


def _question_text(questions):
    if not questions:
        return 'No form available: answer the likely questions.'
    lines = []
    for q in questions:
        options = f" Options: {' | '.join(q['options'])}" if q['options'] else ''
        tag = f"{q['kind']}, " if q['kind'] else ''
        lines.append(f"- field {q['field']} ({tag}{'required' if q['required'] else 'optional'}, {q['type']}): "
                     f"{q['label']}.{options}")
    return '\n'.join(lines)


def about_you():
    """The kit's part of About you (desktop/lib/about-you.js READERS.kit): the main CV with the Experience bank's bullets, as the app wrote it for this
    run (JOB_PILOTTO_ABOUT_YOU_FILE). -> (CV as JSON text, the parts lacked). A cloud run, or a Mac with no CV imported, has none: the kit is drafted
    from the Profile and standard answers, and the lacked part is named (spec 2026-10-28-about-you-everywhere-design.md, criterion 6)."""
    path = os.environ.get('JOB_PILOTTO_ABOUT_YOU_FILE', '')
    try:
        with open(path, encoding='utf-8') as file:
            bundle = json.load(file)
    except (OSError, ValueError):
        bundle = {}
    cv = (bundle.get('parts') or {}).get('cv')
    lacked = list(bundle.get('lacked') or ([] if cv else ['cv']))
    if lacked:
        print(f"About you: kits drafted without {', '.join(lacked)} (none on this run)")
    return (json.dumps(cv, ensure_ascii=False) if cv else ''), lacked


def draft(client, model, job, profile, answers, questions, cv=''):
    """One Claude call; returns (kit dict, usage). cv: about_you()'s CV text, '' when the run has none."""
    context = {'stage_1_facts': job.get('ai') or {}, 'fit': job.get('fit') or {}}
    params = dict(
        model=model,
        max_tokens=8000,
        # Profile + standard answers are the same for every job: cached across kits.
        system=[{'type': 'text', 'text': SYSTEM + profile + '\n\nStandard answers:\n' + answers + (f'\n\nCV:\n{cv}' if cv else ''),
                 'cache_control': {'type': 'ephemeral'}}],
        messages=[{'role': 'user', 'content': (
            f"Title: {job['title']}\nCompany: {job['company']}\nLocation: {job.get('location') or ''}\n"
            f"URL: {job['url']}\nAnalysis so far: {json.dumps(context, ensure_ascii=False)}\n\n"
            f"Application form questions:\n{_question_text(questions)}\n\nPosting:\n{job.get('description') or ''}")}],
        output_config=engine.structured(SCHEMA, model),
    )
    response = client.messages.create(**params)
    if response.stop_reason != 'end_turn':
        raise RuntimeError(f'stopped with {response.stop_reason}')
    kit = json.loads(next(block.text for block in response.content if block.type == 'text'))
    options = {q['field']: q['options'] for q in questions}
    for item in kit['answers']:
        # A select answer that isn't one of the options can't be filled in; flag it.
        if options.get(item['field']) and item['answer'] not in options[item['field']]:
            item['needs_review'] = True
    facts = f"{job['title']} {job['company']} {job.get('location') or ''} {job.get('description') or ''}"
    kit_floors(kit, f'{profile}\n{answers}\n{cv}\n{facts}')   # no letter for a no-match job; a figure nothing given supports is flagged (writing_floors.py)
    return kit, response.usage


def _is_style(title):
    """The app's own "Cover letter style" heading (desktop/renderer/writing-preferences-model.js isStyle), never an applicant's line."""
    return re.sub(r'^[^\w]+', '', title).strip().lower() == 'cover letter style'


def with_style(answers, path=None):
    """The answers text with the cover letter style as its one "Cover letter style" section, read from the file beside the letter
    (the app's letter writers read the rules as the About you voice part instead). Why (PR B1b, owner 28 Oct 2026: "everything about the cover letter should be
    only in Cover Letter tab"): the rules left the answers page. Why (Gitar on #2328): a section still on the page (the Strategy draft or the
    organizer wrote it before the app moved it) joins the file's rules, de-duplicated, as the app's letterStyle.read returns them; never doubled."""
    path = path or os.getenv('JOB_PILOTTO_LETTER_STYLE_FILE', '')
    try:
        with open(path, encoding='utf-8') as handle:
            lines = [str(line).strip() for line in json.load(handle).get('lines') or [] if str(line).strip()]
    except (OSError, ValueError, AttributeError):
        return answers
    kept, inside, page = [], False, []
    for line in (answers or '').split('\n'):
        heading = re.match(r'^#{1,6}\s+(.*)$', line)
        if heading:
            inside = _is_style(heading.group(1))
        elif inside and line.strip():
            page.append(re.sub(r'^[-*]\s+', '', line).strip())
        if not inside:
            kept.append(line)
    lines = list(dict.fromkeys(lines + page))
    text = '\n'.join(kept).rstrip()
    return f'{text}\n\n## Cover letter style\n' + '\n'.join(f'- {line}' for line in lines) if lines else text


def standard_answers(stores):
    """The standard answers from the active store, with the cover letter style beside the letter (with_style). Why (PR B1, owner
    28 Oct 2026 "Retire now, no replay"): 🧠 Form knowledge is no longer appended; what you typed on a form is a line of the standard
    answers (desktop/lib/learned.js)."""
    return with_style(stores.texts.get('answers'))


def kit_markdown(job, kit, questions, model):
    """The kit section's Markdown, on every store: today's Notion blocks read through the store's codec, so a Notion
    page shows exactly what it did and readers take the kit from its last ```json fence (base.kit_from)."""
    return to_markdown(notion_blocks(job, kit, questions, model)['heading_2']['children'])


def prepare_one(client, model, job, stores, profile, answers, opener=None, cv=''):
    """Draft and save one kit in the active store; returns (kit dict, questions, page, usage). Marks the row Kit ready.
    page: {'id', 'url'}: the job's record id and its page link (Notion), or '' where the store has none."""
    try:
        questions = form_questions(job['url'], opener)
    except Exception as error:  # An unreadable form still gets a kit, with likely questions.
        print(f'Warning: form questions unavailable: {type(error).__name__}: {error}')
        questions = []
    drafted, usage = draft(client, model, job, profile, answers, questions, cv)
    record, _ = rules.mark(stores, job, 'Kit ready')
    stores.applications.set_section(record['id'], KIT_SECTION, kit_markdown(job, drafted, questions, model))
    page = {'id': record['id'], 'url': stores.link(record['id']) or ''}
    record_next_step(stores, page, drafted)
    record_cost(stores, page, model, usage)
    from . import provenance  # which CV, Profile and answers it came from ("Drafted with earlier inputs" later)
    provenance.record_kit(stores, page, profile, answers)
    return drafted, questions, page, usage


def pending_for_auto(db, candidates, min_score, max_jobs):
    """Best-scored eligible jobs with no auto-kit yet, highest score first."""
    db.executescript(AUTO_TABLE)
    done = {row['job_id'] for row in db.execute('SELECT job_id FROM auto_kits')}
    scored = [j for j in candidates if j['id'] not in done and (j.get('fit') or {}).get('score', 0) >= min_score]
    return sorted(scored, key=lambda j: j['fit']['score'], reverse=True)[:max_jobs]


def mark_auto(db, job_id):
    db.executescript(AUTO_TABLE)
    db.execute('INSERT OR IGNORE INTO auto_kits (job_id, created_at) VALUES (?, ?)',
               (job_id, datetime.now(timezone.utc).isoformat(timespec='seconds')))
    db.commit()


def auto_run(db, candidates, stores, model, max_jobs, min_score, client=None, opener=None, stats=None):
    """Draft kits for the best-scored jobs that don't have one yet.

    Returns (summary line, list of (job, page) for jobs drafted this run) for the digest to mention.
    Runs after AI stage 2; a job never in `candidates` (ineligible) is never auto-kitted."""
    pending = pending_for_auto(db, candidates, min_score, max_jobs)
    if not pending:
        return '0 kit(s) auto-drafted', []
    from .. import time_budget
    if time_budget.ended():   # the search's time is up: the kits are drafted by the next search (tests/test_three_minutes.py)
        time_budget.later('kits', len(pending), 'kits' if len(pending) != 1 else 'kit')
        return '0 kit(s) auto-drafted', []
    if client is None:
        client = engine.client(action='kit')
    profile, answers = stores.texts.plain('profile'), standard_answers(stores)
    cv, _ = about_you()
    drafted_jobs, failures = [], 0
    for number, job in enumerate(pending, 1):
        print(f"Kits: drafting {number} of {len(pending)}: {job['title']}")
        try:
            _, _, page, usage = prepare_one(client, model, job, stores, profile, answers, opener, cv)
            cost.add(stats, model, usage)
            mark_auto(db, job['id'])
            drafted_jobs.append((job, page))
        except Exception as error:
            failures += 1
            print(f"Warning: auto kit failed for job {job['id']}: {type(error).__name__}: {error}")
    if stats is not None:
        stats.update(pending=len(pending), done=len(drafted_jobs), failed=failures)
    return f'Auto-drafted {len(drafted_jobs)} of {len(pending)} kit(s); {failures} failed', drafted_jobs


def next_step(kit):
    """The Applications row's Next step after a kit: the eligibility verdict first (the desktop app shows it)."""
    if kit.get('eligible') is False:
        return f"⛔ Not eligible: {kit.get('eligibility_note') or 'see the kit'}"
    return '📝 Kit ready: review it, then Apply'


def record_next_step(stores, page, kit):
    try:
        stores.applications.update(page['id'], {'next_step': next_step(kit)[:2000]})
    except Exception as error:  # a template without the column still gets the kit
        print(f'Warning: Next step not set: {type(error).__name__}: {error}')


def usd(model, usage):
    return cost.usd(model, usage)


def record_cost(stores, page, model, usage):
    """Write the kit's API cost on the job (Notion: "Kit cost (USD)"); never fails a kit."""
    try:
        stores.applications.update(page['id'], {'kit_cost': round(usd(model, usage), 4)})
    except Exception as error:  # older database without the column, or a fake tracker in tests
        print(f'Warning: kit cost not recorded: {type(error).__name__}: {error}')


def cost_line(model, usage):
    cached = getattr(usage, 'cache_read_input_tokens', 0) or 0
    written = getattr(usage, 'cache_creation_input_tokens', 0) or 0
    amount = usd(model, usage)
    return (f'Kit drafted with {cost.answered(model, usage)}; tokens in {usage.input_tokens} (+{cached} cached, {written} cache write), '
            f'out {usage.output_tokens}; ~USD {amount:.3f}')


def telegram_messages(job, kit, questions, notion_url=None, limit=3800):
    """Copyable Telegram HTML messages: header, cover letter, answers (split to fit 4096 chars)."""
    title = f"<a href=\"{escape(job['url'], quote=True)}\"><b>{escape(job['title'])}</b></a> — {escape(job['company'])}"
    source = 'form questions from Greenhouse' if questions else 'no form read; likely questions'
    header = [f"📝 <b>Application kit</b>\n{escape(source[0].upper() + source[1:])} · tap a block to copy it · nothing was sent",
              f'<b>Job</b>\n{title}']
    if notion_url:
        header.append(f'<a href="{escape(notion_url, quote=True)}">Open in Notion</a>')
    if kit.get('eligible') is False:
        header.append(f"<b>Not eligible</b>\n{escape(kit.get('eligibility_note') or '')}")
    if kit['check_before_sending']:
        header.append('<b>Check before sending</b>\n' + '\n'.join(f'• {escape(c)}' for c in kit['check_before_sending']))
    if kit['highlights']:
        header.append('<b>Lead with</b>\n' + '\n'.join(f'• {escape(h)}' for h in kit['highlights']))
    blocks = ['\n\n'.join(header), f"<b>Cover letter</b>\n<pre>{escape(kit['cover_letter'])}</pre>"]
    for item in kit['answers']:
        flag = ' · check this answer' if item['needs_review'] else ''
        blocks.append(f"<b>{escape(item['question'])}{flag}</b>\n<code>{escape(item['answer'])}</code>")
    messages, current = [], ''
    for block in blocks:
        if len(block) > limit:  # a very long cover letter: cut the block, the full text is in Notion
            block = block[:limit - 20] + '…</pre>' if block.endswith('</pre>') else block[:limit]
        if current and len(current) + len(block) + 2 > limit:
            messages.append(current)
            current = ''
        current = f'{current}\n\n{block}' if current else block
    if current:
        messages.append(current)
    return messages


def notion_blocks(job, kit, questions, model):
    """One toggle heading with the kit: readable sections plus a JSON code block for a form filler."""
    def text(content, bold=False):
        chunks = [content[i:i + 1900] for i in range(0, len(content), 1900)] or ['']
        return [{'type': 'text', 'text': {'content': c}, 'annotations': {'bold': bold}} for c in chunks]

    def block(kind, content, bold=False):
        return {'object': 'block', 'type': kind, kind: {'rich_text': text(content, bold)}}

    blocks = [block('paragraph', f"Drafted by {model} for {job['title']} — {job['company']}. "
                                 f"{'Form questions read from Greenhouse.' if questions else 'No form read.'} "
                                 'Review before sending; nothing was submitted.')]
    if kit.get('eligible') is False:
        blocks.append(block('paragraph', f"⛔ Not eligible: {kit.get('eligibility_note') or ''}", bold=True))
    if kit['check_before_sending']:
        blocks.append(block('heading_3', '⚠️ Check before sending'))
        blocks += [block('bulleted_list_item', c) for c in kit['check_before_sending']]
    if kit['highlights']:
        blocks.append(block('heading_3', '💡 Lead with'))
        blocks += [block('bulleted_list_item', h) for h in kit['highlights']]
    blocks.append(block('heading_3', '✉️ Cover letter'))
    blocks += [block('paragraph', p) for p in kit['cover_letter'].split('\n\n') if p.strip()]
    blocks.append(block('heading_3', '🧾 Form answers'))
    for item in kit['answers']:
        blocks.append(block('paragraph', item['question'] + (' · check this answer' if item['needs_review'] else ''), bold=True))
        blocks.append(block('paragraph', item['answer']))
    payload = json.dumps({'version': KIT_VERSION, 'url': job['url'], 'model': model, **kit},
                         ensure_ascii=False, indent=1)
    blocks.append(block('heading_3', 'Machine-readable kit'))
    blocks.append({'object': 'block', 'type': 'code',
                   'code': {'language': 'json', 'rich_text': text(payload)}})
    # One toggle heading holds the kit, so a new kit replaces it without touching the owner's notes.
    heading = block('heading_2', KIT_HEADING)
    heading['heading_2'].update(is_toggleable=True, children=blocks)
    return heading
