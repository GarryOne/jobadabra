"""What the Insights messages say: the honesty rules shared by both prompts, the weekly report's schema and prompt, and the weekly Telegram text and Notion page body.
Guarded by tests/test_insights.py."""
from html import escape

from .. import tgcard
from . import learning
from .writing_rules import RULES as WRITING_RULES
from ..suggestions import DOOR_LABEL_MAX, DOORS


HONEST = """
Say only what the statistics show:
- The headline is a finding with a number from the statistics. Never state a situation the statistics do not \
contain (for example that the search is paused or the market is empty): zero or very few rows means "not enough \
data yet", not a fact about the market or the owner.
- With a small sample or no applications, say so in the headline ("Not enough data yet: 3 jobs, 0 applications") \
and make the next step collecting data (run a search, send applications), not a strategy change.
- The next step is one sentence under 100 characters that starts with a verb and names where to act in the app \
(Strategy, Profile, Jobs, Applying). No "clarify with a recruiter", no advice that does not follow from the headline.
"""


WEEKLY_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'description': 'Every text is written TO the owner: "you" and "your", never "the owner", "the candidate" or their name. Only facts from the material given; a figure not in it is left out.',
    'required': ['headline', 'finding', 'summary', 'worked', 'change', 'focus', 'confidence'],
    'properties': {
        'headline': {'type': 'string', 'description': 'The week in one sentence, max 110 characters, with a number from the statistics; "Not enough data yet" when the sample is tiny'},
        'finding': {'type': 'string', 'description': 'The single most useful finding about the search right now, one sentence under 160 characters with a '
                    'number from the statistics: what the daily insight would say. Not a repeat of the headline or the focus'},
        'summary': {'type': 'string', 'description': '2-3 sentences: what happened this week, with numbers'},
        'worked': {'type': 'array', 'items': {'type': 'string'}, 'description': '0-3 things that worked, with evidence'},
        'change': {'type': 'array', 'items': {'type': 'string'},
                   'description': '1-3 concrete changes for next week (strategy, CV, skills, targets), with the reason'},
        'focus': {'type': 'string', 'description': 'The single most important focus for next week: one sentence under 100 characters, starting with a verb'},
        'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
    },
}
WEEKLY_SCHEMA['required'].append('issues')
WEEKLY_SCHEMA['properties']['issues'] = learning.ISSUE_SCHEMA
# Why (28 Oct 2026, owner; #insights PR 1a): Your week's button does the focus in one press; a button that only opens a screen "is noise".
WEEKLY_SCHEMA['required'].append('next_action')
WEEKLY_SCHEMA['properties']['next_action'] = {
    'type': 'object', 'additionalProperties': False, 'required': ['door', 'label'],
    'description': 'A button shown beside the focus, never instead of it (the focus still names where to act in the app): the one thing the '
                   'app can do for you in one press that best serves the focus, or "none"',
    'properties': {
        'door': {'type': 'string', 'enum': [*DOORS, 'none'],
                 'description': 'find_jobs: search for new jobs now. tune: review the changes to your search that your results support. '
                                'tailor: tailor CVs and cover letters for your top matches (several jobs at once, never one you name). '
                                'prep: prepare for an interview coming up. '
                                'none: none of these serves the focus; never pick one that only loosely fits'},
        'label': {'type': 'string', 'description': f'The button, at most {DOOR_LABEL_MAX} characters, starting with a verb ("Find jobs now"); '
                                                   'it says what the button does, never one job or employer; empty when door is none'}}}

WEEKLY_SYSTEM = """You write the owner's search analysis inside Jobadabra (on Mondays, or whenever they ask: "Analyze my job search"). Look back at the \
last 7 days (applications sent, replies, the market, the daily insights and how the owner rated them) \
and forward to next week. Same rules as the daily insight: only numbers from the statistics; no claims \
about why applications fail below {min_group} applications in a group; direct and specific, no filler, \
no emojis. "worked" may be empty in a quiet week; never pad it.

The owner's profile (their CV and preferences) follows.

"""
WEEKLY_SYSTEM = WRITING_RULES + '\n\n' + learning.RULES + '\n' + HONEST + '\n' + WEEKLY_SYSTEM


def weekly_message(report, page_url=''):
    blocks = [tgcard.block(escape(report['headline']), tgcard.fact('Finding', report.get('finding')), escape(report['summary']))]
    if report['worked']:
        blocks.append(tgcard.block('Worked', *[f'• {escape(item)}' for item in report['worked']]))
    blocks.append(tgcard.block('Change next week', *[f'• {escape(item)}' for item in report['change']]))
    blocks.append(tgcard.block('Focus', escape(report['focus'])))
    footer = f'<a href="{escape(page_url, quote=True)}">Full report in Notion</a>' if page_url else ''
    return tgcard.card('Search analysis', 'Last 7 days', blocks, emoji='📊', footer=footer)


def weekly_blocks(report, stats):
    """Page body: the written report, then the numbers behind it."""
    para = lambda kind, content: {'object': 'block', 'type': kind,
                                  kind: {'rich_text': [{'text': {'content': content[:1900]}}]}}
    blocks = ([para('callout', report['finding'])] if report.get('finding') else []) + [para('paragraph', report['summary'])]
    issues = report.get('issues') or []
    blocks += [para('heading_3', 'Priorities from recurring evidence')]
    if issues:
        for issue in issues:
            blocks += [para('paragraph', f"{issue['issue']} — {issue['applications']} applications, {issue['employers']} employers"),
                       para('bulleted_list_item', issue['action'])]
            blocks += [para('bulleted_list_item', f"{r['company']} · {r['source_type']}: {ref['quote']} · {r['url']}")
                       for r, ref in zip(issue['sources'], issue['support'])]
    else:
        blocks += [para('paragraph', 'Not enough independent evidence for global advice yet. '
                        'A recurring issue needs 3 applications, 2 employers and 2 source types, '
                        'with employer feedback or interview reviews from at least 2 applications. '
                        'Individual observations below remain tentative.')]
    if report['worked']:
        blocks += [para('heading_3', 'What worked')] + [para('bulleted_list_item', w) for w in report['worked']]
    blocks += [para('heading_3', 'Change next week')] + [para('bulleted_list_item', c) for c in report['change']]
    blocks += [para('heading_3', 'Focus'), para('paragraph', report['focus'])]
    apps, market, week = stats['applications'], stats['market'], stats['week']
    blocks += [para('heading_3', 'Numbers'),
               para('bulleted_list_item', f"Applications: {apps['applications']} total, {apps['applied_last_7_days']} this week; "
                                          f"outcomes {apps['outcomes']}; interview rate of decided {apps['interview_rate_of_decided']}"),
               para('bulleted_list_item', f"Replies this week: {week['event_counts'] or 'none'}"),
               para('bulleted_list_item', f"Market: {market['open_jobs']} open jobs, {market['eligible']} eligible, "
                                          f"{market['language_blocked']} need a language you don't have, "
                                          f"{market['new_last_7_days']} new this week"),
               para('bulleted_list_item', 'Top technologies in best-fit jobs: ' + ', '.join(
                   f"{t['tech']} {t['jobs']}{'' if t['in_profile'] else ' (not in profile)'}"
                   for t in market['technologies_in_good_fit_jobs'][:8]))]
    daily = [para('bulleted_list_item', f"{i['date']} · {i['category']}: {i['headline']} — {i['feedback'] or 'no feedback'}")
             for i in week['insights_last_7_days']]
    blocks += [para('heading_3', 'Daily insights this week')] + (daily or [para('paragraph', 'None.')])
    return blocks[:95]


def plural(count, singular):
    """'1 application', '4 applications' — a sample size of one is common, and "1 applications" read as a bug."""
    return f"{count} {singular if count == 1 else singular + 's'}"
