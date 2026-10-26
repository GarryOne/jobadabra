"""Optional features: what each one needs, what it costs, and one switch to turn any of them off.

The core (crawl jobs.ch, TechTree and employer feeds, rank them, print the digest) needs no keys.
Everything else switches itself on when the key or variable it needs is set, so a new developer
unlocks features one at a time. To turn one off without deleting its keys, list it in
JOB_PILOTTO_DISABLE (comma-separated, or "all"), e.g. JOB_PILOTTO_DISABLE=google_jobs,mail —
in .env locally, or as a GitHub repository variable for the scheduled runs.
A parked feature (PARKED) is off even when set up, until JOB_PILOTTO_ENABLE lists it; its code and tests stay.
"""
from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Feature:
    name: str
    label: str
    needs: tuple      # every one of these environment variables must be set (a nested tuple: any one of them)
    cost: str         # 'free', 'paid' or 'free tier'
    setup: str        # how to turn it on, one line


# AI: the user's API key (Anthropic or OpenAI), or their own Claude Code / Codex chosen in the app (src/ai/providers; runs on their plan).
# Any one of them; engine.ready() then checks the one the user chose.
AI = ('ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'JOB_PILOTTO_AI_ENGINE=cli', 'JOB_PILOTTO_AI_ENGINE=codex')


FEATURES = (
    Feature('discover', 'jobs.ch + TechTree discovery', (), 'free', 'on by default'),
    Feature('telegram', 'Telegram digest', ('TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'), 'free',
            'create a bot with @BotFather; README → Telegram'),
    Feature('notion', 'Notion tracking (applications, matches, run log)', ('NOTION_TOKEN',), 'free',
            'create a Notion integration and the pages in docs/notion-schema.md'),
    Feature('scout', 'Source scout (finds new employer feeds)', (), 'free', 'on by default'),
    Feature('index', 'Central employer index (downloaded feeds from the shared scout)', (), 'free', 'on by default'),
    Feature('pool_layouts', 'Page layouts other installs learned (at least 3 agree), used before asking the AI to learn a site', (), 'free',
            'on by default; JOB_PILOTTO_DISABLE=pool_layouts learns every site here'),
    Feature('enrich', 'AI stage 1: facts from each posting', (AI, 'JOB_PILOTTO_ENRICH_MODEL'),
            'paid', 'ANTHROPIC_API_KEY + JOB_PILOTTO_ENRICH_MODEL=claude-haiku-5-5'),
    Feature('score', 'AI stage 2: fit score against your Profile',
            (AI, 'JOB_PILOTTO_SCORE_MODEL', ('NOTION_TOKEN', 'JOB_PILOTTO_PROFILE_FILE')),
            'paid', 'ANTHROPIC_API_KEY + JOB_PILOTTO_SCORE_MODEL=claude-sonnet-5-5 (Profile from Notion or a local file)'),
    Feature('auto_kits', 'Auto-drafted application kits', (AI, 'JOB_PILOTTO_AUTO_KIT_MAX', 'NOTION_TOKEN'),
            'paid', 'JOB_PILOTTO_AUTO_KIT_MAX=5 (plus the AI key and Notion)'),
    Feature('insights', 'Daily insight + weekly report', (AI, 'JOB_PILOTTO_INSIGHT_MODEL', 'NOTION_TOKEN'),
            'paid', 'JOB_PILOTTO_INSIGHT_MODEL=claude-sonnet-5-5 (plus the AI key and Notion)'),
    Feature('web_search', "Web search for an employer's own job site: the user's own plan (Claude Code or Codex), else the Brave or SerpApi key while not parked", (('BRAVE_SEARCH_API_KEY', 'SERPAPI_API_KEY'),), 'free tier',
            'The plan engine\'s own web search first (Claude Code or Codex, when it is the AI engine or signed in); the Brave key (brave_search) and the SerpApi key (google_jobs) are parked'),
    Feature('brave_search', 'Brave Search API for the web search when no plan search is there', ('BRAVE_SEARCH_API_KEY',), 'free tier',
            'parked: JOB_PILOTTO_ENABLE=brave_search with BRAVE_SEARCH_API_KEY (brave.com/search/api, free 2,000/month)'),
    Feature('google_jobs', 'Google Jobs via SerpApi', ('SERPAPI_API_KEY',), 'free tier',
            'parked: JOB_PILOTTO_ENABLE=google_jobs with SERPAPI_API_KEY from serpapi.com (free plan: 250 searches/month)'),
    Feature('transcribe', 'Interview recordings -> transcript with speakers (on this machine)', (), 'free',
            'pip install -r requirements-transcribe.txt (the app installs it on the first recording, ~115 MB); models download once (~520 MB)'),
    Feature('focus', 'Focus: what to do next, and reminders against a daily target', ('NOTION_TOKEN',), 'free',
            'on with Notion (the Desktop App: Focus)'),
    Feature('feedback', 'Employer feedback requests, collection and learning', ('NOTION_TOKEN',), 'free',
            'on with Notion (Focus and Jobs → Add employer feedback; Gmail collection uses the existing mail check)'),
    Feature('rejection_review', 'Why each rejection happened (after the Gmail check, or on demand)',
            (AI, 'NOTION_TOKEN'), 'paid', 'on with the AI key and Notion (the main model, a few cents each)'),
    Feature('mail', 'Gmail + Calendar reading (application news, recruiter leads)', ('GOOGLE_REFRESH_TOKEN', 'NOTION_TOKEN', AI), 'paid',
            'python3 -m src.sources.google auth --github (the shared Jobadabra app: one browser consent); '
            'own Google app: python3 -m src.sources.google setup; README → Gmail and Calendar'),
    Feature('contribute', 'Help the pool grow: share employer career pages with coarse tags (opt-in)', ('JOB_PILOTTO_SHARE_EMPLOYERS',),
            'free', 'Settings → Help the pool grow (the app sets JOB_PILOTTO_SHARE_EMPLOYERS=1); `python -m src contribute --show` prints what is sent'),
    Feature('scout_ai', 'Scout ideas: the AI proposes employers and company lists to look at, learning from what was found', (AI,), 'paid',
            'on with the AI key (a few cents on every Find jobs run that grows the employer list); JOB_PILOTTO_DISABLE=scout_ai turns it off'),
    Feature('render', 'Headless browser for careers pages that only exist after JavaScript runs (optional add-on)', (), 'free',
            'pip install -r requirements-render.txt && playwright install chromium; JOB_PILOTTO_RENDER=0 turns it off'),
    Feature('page_reader', 'The AI reads careers pages that list jobs as plain text (cached until the page changes)', (AI,), 'paid',
            'on with the AI key (Haiku, a fraction of a cent per changed page); JOB_PILOTTO_DISABLE=page_reader turns it off'),
    Feature('title_triage', 'The AI sorts job titles in your places that your role words miss ("Client Advisor" for a shop seller), once per title', (AI,), 'paid',
            'on with the AI key (Haiku, about one call per 100 new titles); JOB_PILOTTO_DISABLE=title_triage keeps the exact role words only'),
    Feature('place_triage', 'The AI decides which job locations are in your places ("Wallisellen" is near Zürich, not in Valais), once per location', (AI,), 'paid',
            'on with the AI key (Haiku, about one call per 60 new locations); JOB_PILOTTO_DISABLE=place_triage keeps your place words as patterns'),
    Feature('role_ideas', 'Roles suggested from your Profile, with how many open jobs each has in your places (Strategy)', (AI,), 'paid',
            'on with the AI key (Sonnet, at most once a day); JOB_PILOTTO_DISABLE=role_ideas turns it off'),
    Feature('aggregators', 'Job aggregators with free public APIs: Arbeitnow, Himalayas, Jobicy (source named on every job)', (), 'free',
            'on by default; JOB_PILOTTO_DISABLE=aggregators turns it off'),
    Feature('found_boards', 'Job boards found for your countries and roles: the AI proposes them once, their public search pages are read', (AI,), 'paid',
            'on with the AI key (one main-model call when your places or roles change); JOB_PILOTTO_DISABLE=found_boards turns it off'),
    Feature('adzuna', 'Adzuna job search (19 countries incl. Switzerland)', ('ADZUNA_APP_ID', 'ADZUNA_APP_KEY'), 'free tier',
            'parked: JOB_PILOTTO_ENABLE=adzuna with free keys from developer.adzuna.com'),
    Feature('jooble', 'Jooble job search', ('JOOBLE_API_KEY',), 'free tier', 'parked: JOB_PILOTTO_ENABLE=jooble with a free key from jooble.org/api/about'),
    Feature('job_alerts', 'Jobs from your own job-alert emails (LinkedIn, jobs.ch, jobup.ch, Indeed, Glassdoor) in Gmail', ('GOOGLE_REFRESH_TOKEN', AI), 'paid',
            'parked: JOB_PILOTTO_ENABLE=job_alerts with Gmail connected and job alerts switched on at those sites; a fraction of a cent per alert email'),
)
BY_NAME = {f.name: f for f in FEATURES}

# Parked: off for everyone, and hidden in the app (index.html data-parked="<name>"), until listed in JOB_PILOTTO_ENABLE.
# job_alerts (owner, 26 Oct 2026): "let's park/disable/hid this functionality for now. It's too advanced."
# adzuna, jooble, google_jobs, brave_search (owner, 26 Oct 2026, the Adzuna and Jooble card): "let's hide/disable this functionality for noow. Is to
# hadr to use for my users." Each asks the user to register for an API key; a key already saved stays in the Keychain, unused. Web search itself is
# not parked: without a key it runs on the user's own plan (src/sources/web_search.py provider); only its Brave and SerpApi key paths are.
# Guard: tests/test_parked_features.py (off, and no visible entry in the app, for every name here).
PARKED = frozenset({'job_alerts', 'adzuna', 'jooble', 'google_jobs', 'brave_search'})


def disabled_names(env=None):
    env = os.environ if env is None else env
    return {n.strip().lower() for n in (env.get('JOB_PILOTTO_DISABLE') or '').split(',') if n.strip()}


def disabled(name, env=None):
    """True when JOB_PILOTTO_DISABLE lists this feature (or "all")."""
    names = disabled_names(env)
    return name in names or 'all' in names


def parked(name, env=None):
    """True for a parked feature not listed in JOB_PILOTTO_ENABLE (comma-separated)."""
    env = os.environ if env is None else env
    return name in PARKED and name not in {n.strip().lower() for n in (env.get('JOB_PILOTTO_ENABLE') or '').split(',')}


def off(name, env=None):
    """True when the feature is switched off (JOB_PILOTTO_DISABLE) or parked: the one check a source makes before it uses its key."""
    return disabled(name, env) or parked(name, env)


def _has(env, need):
    if isinstance(need, tuple):
        return any(_has(env, one) for one in need)
    if '=' in need:  # NAME=value: set to exactly that value
        name, value = need.split('=', 1)
        return (env.get(name) or '').strip().lower() == value
    return bool(env.get(need))


def _name(need):
    return ' or '.join(need) if isinstance(need, tuple) else need


def configured(name, env=None):
    env = os.environ if env is None else env
    return all(_has(env, need) for need in BY_NAME[name].needs)


def enabled(name, env=None):
    return configured(name, env) and not disabled(name, env) and not parked(name, env)


def status(env=None):
    """[(feature, 'on' | 'off' | 'disabled' | 'parked', missing variables)] for every optional feature."""
    env = os.environ if env is None else env
    rows = []
    for feature in FEATURES:
        missing = [_name(need) for need in feature.needs if not _has(env, need)]
        state = 'disabled' if disabled(feature.name, env) else 'parked' if parked(feature.name, env) else 'off' if missing else 'on'
        rows.append((feature, state, missing))
    return rows
