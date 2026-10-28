#!/usr/bin/env python3
"""Daily insight: one finding a day about the job search, sent to Telegram and kept in Notion 💡 Insights.

Code computes the numbers for free: the market (every open job's AI stage 1 facts and stage 2 fit,
including the jobs hidden for a required language) and the owner's own applications with their
outcomes (📈 Application Events). Claude then picks the single most useful finding that hasn't been
said recently, checks it against the Profile (the CV), and writes it with its evidence and one action.

Market findings are facts about postings ("Prometheus is in 45% of your best-fit jobs"). Claims
about why applications fail need enough applications in the group (MIN_GROUP); until then the
model is told to say what the market shows, not what caused a rejection.

On Mondays the weekly report replaces the daily insight: the week's applications and replies, how
the market moved, how the week's insights were rated, and up to three changes for the coming week.
It is kept as a 💡 Insights row (Category "Weekly report") whose page body holds the full report.

Runs with the first scheduled crawl of the day (at or after SEND_HOUR_UTC), or on demand with
`--mode insight` / `--mode weekly` (Telegram /insight, /weekly). Off unless JOB_PILOTTO_INSIGHT_MODEL
names a model.
"""
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from html import escape
import json
import os
import re
from statistics import mean

from .. import digest, store, tgcard
from ..notion.ledger import REPLY
from . import cost, engine, enrich, score
from . import insights_data as data_of
from . import learning, quality
from .writing_rules import RULES as WRITING_RULES
from .insights_text import (  # noqa: F401 — moved; kept importable from here
    HONEST, WEEKLY_SCHEMA, WEEKLY_SYSTEM, weekly_message, weekly_blocks, plural,
)
from .models import MAIN_MODEL
from ..stores import open_stores
from ..stores.notion_blocks import to_markdown
from ..suggestions import door_field


DEFAULT_MODEL = os.getenv('JOB_PILOTTO_INSIGHT_MODEL', MAIN_MODEL)
INSIGHTS_DATABASE_ID = os.getenv('NOTION_INSIGHTS_DB', '')  # focus.py and desktop.py still read Notion's insights by it
SEND_HOUR_UTC = 4
GOOD_FIT = 60
NEAR_MISS = 45
# Groups smaller than this are shown to the model but flagged as too small to explain outcomes.
MIN_GROUP = 10
# Room for the model's thinking plus the whole answer: output_config effort 'medium' makes it think, and thinking
# is drawn from max_tokens like the answer itself. 3000 cut both insight answers off (stop_reason 'max_tokens') and
# failed the run; as in prep.py, 8000 fits. The cap costs nothing when unused.
MAX_TOKENS = 8000
CATEGORIES = data_of.CATEGORIES   # moved to insights_data (is_finding reads it); kept importable from here
WEEKLY = 'Weekly report'
WEEKLY_DAY = 0  # Monday
INTERVIEW_PATTERNS = 'Interview patterns'  # interview_insights.CATEGORY: one upserted row, not a daily insight
INTERVIEW_STAGES, RESPONSE_KINDS = data_of.INTERVIEW_STAGES, data_of.RESPONSE_KINDS
TECH_ALIASES = {'k8s': 'kubernetes', 'amazon web services': 'aws', 'gcp': 'google cloud',
                'google cloud platform': 'google cloud', 'golang': 'go', 'postgres': 'postgresql',
                'microsoft azure': 'azure', 'ci/cd': 'ci/cd pipelines', 'grafana labs': 'grafana'}

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['skip', 'category', 'headline', 'evidence', 'action', 'confidence', 'basis', 'sample_size'],
    'properties': {
        'skip': {'type': 'boolean', 'description': 'true only when nothing new and useful can be said today'},
        'category': {'type': 'string', 'enum': CATEGORIES},
        'headline': {'type': 'string', 'description': 'One sentence, max 110 characters, with the key number'},
        'evidence': {'type': 'array', 'items': {'type': 'string'},
                     'description': '2-4 short lines, each with numbers taken from the statistics'},
        'action': {'type': 'string', 'description': 'One concrete next step, max 100 characters, starting with a verb'},
        'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
        'basis': {'type': 'string', 'enum': ['Market', 'Applications', 'Both']},
        'sample_size': {'type': 'integer', 'description': 'Number of jobs or applications behind the finding'},
    },
}
SCHEMA['required'].append('issues')
SCHEMA['properties']['issues'] = learning.ISSUE_SCHEMA


SYSTEM = """You are the job-search analyst inside Jobadabra. Each day you send the owner ONE \
insight that could change what they do: which skills to learn or put on the CV, where to look, \
which roles or seniority to target, salary expectations, timing, or how many applications to send.

Rules:
- Use only numbers that appear in the statistics. Never invent figures, companies or trends.
- Market statistics describe postings. Application statistics describe the owner's results.
- Do not claim why applications were rejected unless the application group has at least \
{min_group} applications; below that, state what the market shows and say the sample is small.
- Interview statistics (topics asked, topics answered weakly) come from the owner's own interview \
transcripts. A topic that keeps coming up, or keeps being answered weakly, is worth an insight: \
what to practise, or what to add to the CV so it is expected.
- A technology often required but absent from the profile is either a CV gap (the owner may have \
it and not show it) or a skill gap. Say which the profile suggests; if unclear, ask them to check.
- Do not repeat a finding from the recent insights unless the numbers moved clearly; prefer a \
category that hasn't been covered lately. Findings marked "Not useful" should not come back in \
that form; build on ones marked "Acting on it" (for example, follow up on their progress).
- Be direct and specific, like a sharp colleague. No filler, no encouragement, no emojis.
- Set skip=true only when nothing new and useful can be said; the other fields may then be empty.

The owner's profile (their CV and preferences) follows.

"""
SYSTEM = WRITING_RULES + '\n\n' + learning.RULES + '\n' + HONEST + '\n' + SYSTEM


def _norm_tech(name):
    name = re.sub(r'\s+', ' ', (name or '').strip().lower())
    return TECH_ALIASES.get(name, name)


def in_profile(tech, profile_text):
    """True if the technology (or a known alias) appears as a word in the profile text."""
    names = {tech} | {alias for alias, canon in TECH_ALIASES.items() if canon == tech}
    return any(re.search(rf'(?<![\w]){re.escape(n)}(?![\w])', profile_text) for n in names)


def region(job):
    where = f"{job.get('location') or ''} {job.get('city') or ''}"
    rank = digest.place_rank(job)   # the same answer as the digest's (Claude's when it placed the location)
    if rank == 'best':
        return 'Best places'
    if rank == 'in':
        return 'Your country'
    from ..sources import feeds
    match = feeds.mention_of(digest.PREFERRED_ABROAD, where)
    if match:
        return match.group(0).title()
    if (job.get('ai') or {}).get('work_mode', {}).get('value') == 'remote':
        return 'Remote'
    return 'Other'


def _share(n, total):
    return f'{n}/{total} ({round(100 * n / total)}%)' if total else '0/0'


def market_stats(db, profile, now):
    """The market as the crawl sees it: every open job, including language-blocked ones."""
    facts, fits = enrich.load(db), score.load(db)
    jobs = [dict(j, ai=facts.get(j['id']), fit=fits.get(j['id'])) for j in store.digest_jobs(db, limit=10_000)]
    with_facts = [j for j in jobs if j['ai']]
    eligible = [j for j in with_facts if not digest.hard_filtered(j)]
    scored = [j for j in eligible if j['fit']]
    good = [j for j in scored if j['fit']['score'] >= GOOD_FIT]
    near = [j for j in scored if NEAR_MISS <= j['fit']['score'] < GOOD_FIT]
    profile_text = profile.lower()

    regions = defaultdict(Counter)
    for job in with_facts:
        place = region(job)
        regions[place]['open'] += 1
        regions[place]['language_blocked'] += digest.language_blocked(job)
        regions[place]['eligible'] += job in eligible
        regions[place]['good_fit'] += job in good

    def tech_table(group, top=20):
        counts = Counter(t for j in group for t in {_norm_tech(x) for x in j['ai'].get('technologies') or []} if t)
        return [{'tech': t, 'jobs': _share(n, len(group)), 'in_profile': in_profile(t, profile_text)}
                for t, n in counts.most_common(top)]

    def components(group):
        keys = ('role_fit', 'location', 'compensation', 'growth', 'risk')
        # A part the AI left out (pay with no salary stated) is not averaged in.
        known = lambda k: [v for j in group if (v := j['fit']['components'][k]) is not None]
        return {k: round(mean(known(k))) if known(k) else None for k in keys} if group else {}

    salaried = [j for j in eligible if j['ai']['salary']['stated']]
    return {
        'open_jobs': len(jobs), 'with_ai_facts': len(with_facts), 'eligible': len(eligible),
        'language_blocked': sum(digest.language_blocked(j) for j in with_facts),
        'scored': len(scored), 'good_fit (score>=%d)' % GOOD_FIT: len(good),
        'near_miss (score %d-%d)' % (NEAR_MISS, GOOD_FIT - 1): len(near),
        'new_last_7_days': sum((j.get('first_seen_at') or '') >= (now - timedelta(days=7)).isoformat() for j in jobs),
        'by_region': {place: dict(c) for place, c in sorted(regions.items(), key=lambda kv: -kv[1]['open'])},
        'technologies_in_eligible_jobs': tech_table(eligible),
        'technologies_in_good_fit_jobs': tech_table(good, 15),
        'seniority_eligible': dict(Counter(j['ai']['seniority']['value'] for j in eligible)),
        'role_family_eligible': dict(Counter(j['ai'].get('role_family') for j in eligible)),
        'role_family_good_fit': dict(Counter(j['ai'].get('role_family') for j in good)),
        'salary_stated': _share(len(salaried), len(eligible)),
        'salary_samples': [f"{j['title']} · {region(j)}: {j['ai']['salary']['text'][:80]}" for j in salaried[:15]],
        'fit_components_avg_all_scored': components(scored),
        'fit_components_avg_near_miss': components(near),
        'gaps_named_in_good_and_near_fit_jobs': [g for j in good + near for g in j['fit'].get('gaps', [])][:60],
    }


def _log_quality(kind, headline, action, sample_size=None):
    """A line in the run's output (a 'Warning' is never shown as a step) when the AI's words break the HONEST rules."""
    found = quality.problems(headline, action, sample_size)
    if found:
        print(f"Warning: {kind} quality: {'; '.join(found)}")


def generate(client, model, profile, stats):
    """(insight dict, usage) from one schema-constrained call."""
    response = client.messages.create(
        model=model, max_tokens=MAX_TOKENS,
        system=[{'type': 'text', 'text': SYSTEM.format(min_group=MIN_GROUP) + profile}],
        messages=[{'role': 'user', 'content': 'Statistics as of today (JSON):\n' + json.dumps(stats, ensure_ascii=False)}],
        output_config=engine.structured(SCHEMA, model),
    )
    if response.stop_reason != 'end_turn':
        raise RuntimeError(f'stopped with {response.stop_reason}')
    return json.loads(next(block.text for block in response.content if block.type == 'text')), response.usage


def weekly(db, stores=None, model=DEFAULT_MODEL, *, send=None, now=None, client=None, stats=None):
    """Make, save and send the weekly report; returns a one-line summary."""
    now = now or datetime.now(timezone.utc)
    stores = stores or open_stores()
    print('Search analysis: reading your numbers…')   # each step says so: the app shows the latest line while the run works
    profile = profile_of(stores)
    data = {'market': market_stats(db, profile, now), 'applications': data_of.application_stats(stores, now),
            'interviews': data_of.interview_stats(stores), 'week': data_of.week_stats(stores, now),
            'learning': learning.evidence(stores, now)}
    if client is None:
        client = engine.client(action='insight')
    print('Search analysis: asking the AI to write the report…')
    response = client.messages.create(
        model=model, max_tokens=MAX_TOKENS,
        system=[{'type': 'text', 'text': WEEKLY_SYSTEM.format(min_group=MIN_GROUP) + profile}],
        messages=[{'role': 'user', 'content': 'Statistics as of today (JSON):\n' + json.dumps(data, ensure_ascii=False)}],
        output_config=engine.structured(WEEKLY_SCHEMA, model),
    )
    if response.stop_reason != 'end_turn':
        raise RuntimeError(f'stopped with {response.stop_reason}')
    report = json.loads(next(block.text for block in response.content if block.type == 'text'))
    report['issues'] = learning.validate(report.get('issues') or [], data['learning'])
    _log_quality('weekly report', report['headline'], report.get('focus'))
    cost.add(stats, model, response.usage)
    usd = cost.usd(model, response.usage)
    model = cost.answered(model, response.usage)   # the Model column and the learning rows name the model that answered
    if stats is not None:
        stats.update(pending=1, done=1)
    print('Search analysis: saving it…')
    row = stores.insights.add({'day': now.date().isoformat(), 'category': WEEKLY, 'title': report['headline'][:200],
                               'body': to_markdown(weekly_blocks(report, data)), 'fields': {
        'basis': 'Both', 'confidence': report['confidence'], 'sample_size': data['applications']['applications'],
        'evidence': report['summary'], 'action': report['focus'], 'cost': round(usd, 4), 'model': model,
        **door_field(report.get('next_action'))}})
    learning.publish(stores, report['issues'], now, model)
    if send:
        send(weekly_message(report, stores.link(row['id']) or ''), keyboard(row['id']))
    return f"Weekly report sent: {report['headline']} ({usd:.3f} USD)"


def message(insight):
    basis = 'application' if insight['basis'] == 'Applications' else 'job'
    blocks = [tgcard.block(escape(insight['headline']), *[f'• {escape(line)}' for line in insight['evidence']]),
              tgcard.block('Next step', escape(insight['action'])),
              tgcard.block(f"Confidence: {escape(insight['confidence'].lower())}",
                           escape(f"Based on {insight['basis'].lower()} data, {plural(insight['sample_size'], basis)}."))]
    return tgcard.card('Insight', insight['category'], blocks, emoji='💡')


def keyboard(insight_id):
    """The feedback buttons: ins:<u|n|a>:<the insight's store id> (a Notion page id without dashes)."""
    page = insight_id.replace('-', '')
    return {'inline_keyboard': [[{'text': '👍 Useful', 'callback_data': f'ins:u:{page}'},
                                 {'text': '👎 Not useful', 'callback_data': f'ins:n:{page}'},
                                 {'text': "✅ I'll act on it", 'callback_data': f'ins:a:{page}'}]]}


def record(insight, today, model, usd):
    """Today's insight as a store record (💡 Insights: title, date, category, the rest as its fields)."""
    return {'day': today.isoformat(), 'category': insight['category'], 'title': insight['headline'][:200], 'fields': {
        'basis': insight['basis'], 'confidence': insight['confidence'], 'sample_size': insight['sample_size'],
        'evidence': '\n'.join(insight['evidence']), 'action': insight['action'], 'cost': round(usd, 4), 'model': model}}


def profile_of(stores):
    """The Profile as the AI reads it, from the active store (texts.plain: on Notion the page as Tracker.page_text reads it, as before)."""
    return stores.texts.plain('profile')


SENT = 'Insight sent: '


def category_of(summary):
    """The category of the insight run() sent, from its summary line ('' when none was sent)."""
    return summary[len(SENT):].split(' — ')[0].strip() if (summary or '').startswith(SENT) and ' — ' in summary else ''


def run(db, stores=None, model=DEFAULT_MODEL, *, send=None, now=None, force=False, client=None, stats=None):
    """Make and send today's insight unless one exists already (or it's before SEND_HOUR_UTC).
    send(text, keyboard) delivers it; returns a one-line summary. The data comes from the active store (stores, else
    open_stores())."""
    now = now or datetime.now(timezone.utc)
    stores = stores or open_stores()
    if not force and (now.hour < SEND_HOUR_UTC or data_of.sent_today(stores, now.date())):
        return 'Insight: not due'
    if not force and now.weekday() == WEEKLY_DAY:
        return weekly(db, stores, model, send=send, now=now, client=client, stats=stats)
    print('Insight: reading your numbers…')
    profile = profile_of(stores)
    data = {'market': market_stats(db, profile, now), 'applications': data_of.application_stats(stores, now),
            'interviews': data_of.interview_stats(stores), 'recent_insights': data_of.recent_insights(stores, now.date()),
            'learning': learning.evidence(stores, now)}
    if client is None:
        from . import engine
        client = engine.client(action='insight')
    print('Insight: asking the AI for today\'s finding…')
    insight, usage = generate(client, model, profile, data)
    insight['issues'] = learning.validate(insight.get('issues') or [], data['learning'])
    _log_quality('insight', insight['headline'], insight.get('action'), insight.get('sample_size'))
    cost.add(stats, model, usage)
    usd = cost.usd(model, usage)
    model = cost.answered(model, usage)   # the Model column and the learning rows name the model that answered
    if stats is not None:
        stats.update(pending=1, done=1)
    if insight['skip']:
        return f'Insight: nothing new today ({usd:.3f} USD)'
    row = stores.insights.add(record(insight, now.date(), model, usd))
    learning.publish(stores, insight['issues'], now, model)
    if send:
        send(message(insight), keyboard(row['id']))
    return f"{SENT}{insight['category']} — {insight['headline']} ({usd:.3f} USD)"
