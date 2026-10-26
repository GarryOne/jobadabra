#!/usr/bin/env python3
"""Google Jobs through SerpApi's paid API (engine=google_jobs). Python 3.10+, no dependencies.

Google itself blocks scripted requests (a JavaScript wall for plain HTTP, a CAPTCHA for headless
browsers), so this uses SerpApi's JSON API instead of scraping. Google Jobs answers only in the
place's own language: Zurich with hl=en is "Fully empty", Zurich with hl=de has results (tested
27 Sep 2026). So every location carries a `language`, and `location` must be SerpApi's canonical
name (serpapi.com/locations.json, e.g. "Zurich,Zurich,Switzerland"). Every search costs one SerpApi
credit, so each run does only `searches_per_run` searches from config/search.json's `google_jobs`
block, rotating through query × location pairs (least recently searched first), and stops when
the account has fewer than `min_searches_left` credits. Checking the account costs nothing.
Off unless SERPAPI_API_KEY is set.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
import re
from urllib.parse import urlencode, urlsplit
import urllib.request

from . import feeds

SEARCH_URL = 'https://serpapi.com/search.json'
ACCOUNT_URL = 'https://serpapi.com/account.json'
SOURCE = 'Google Jobs'

# Apply links on these sites are other aggregators; the employer's own page is preferred.
AGGREGATORS = re.compile(r'linkedin\.|glassdoor\.|indeed\.|ziprecruiter\.|jooble\.|talent\.com|'
                         r'simplyhired\.|adzuna\.|jobrapido\.|careerjet\.|bebee\.|jobleads\.', re.I)

# No default place or country: a search in somewhere the user never chose would spend a credit on someone else's market
# (an install without ⚙️ Search settings → "Google Jobs places" used to search Zurich). No places, no searches.
DEFAULTS = {'queries': [], 'country': '', 'locations': [], 'searches_per_run': 1, 'min_searches_left': 20}


def places(config):
    """{location name: language}; a plain string location searches in English."""
    return {(loc if isinstance(loc, str) else loc['location']):
            ('en' if isinstance(loc, str) else loc.get('language', 'en')) for loc in config['locations']}


# SerpApi's canonical names for the countries src/sources/aggregators.py can tell from the user's places.
from .aggregators import ADZUNA_COUNTRIES as COUNTRY_NAMES   # code -> English name


def settings(search_config):
    return within_places({**DEFAULTS, **search_config.get('google_jobs', {})}, search_config)


def within_places(config, search_config):
    """The Google Jobs block kept inside the user's own places (search.json `locations`). The setup AI drafts it separately and can miss:
    a French CV with no address got "France" and gl=fr for a search in Geneva (6 Oct 2026). Places in no country the user chose are
    dropped; with none left, each of the user's countries is searched in the drafted language. Places we can't place leave it as drafted."""
    from .aggregators import _countries, place_countries
    countries = _countries(search_config)
    if not countries:
        return config
    name = lambda loc: loc if isinstance(loc, str) else str(loc.get('location', ''))
    # Which country each drafted place is in, in any language (AI, kept per place); without AI the pack's patterns ("France" for a Geneva search is left out).
    found = place_countries([name(loc) for loc in config['locations']])
    if found is None:   # nothing known (no AI and no pattern, or the AI failed with nothing kept): Switzerland, the first market, from its fixed table
        from .. import places
        found = {name(loc).lower(): 'ch' for loc in config['locations'] if places.in_switzerland(name(loc))}
    # a place the AI has not placed yet (past its cap this run) is left as drafted: unknown, never dropped on a guess
    locations = [loc for loc in config['locations'] if found.get(name(loc).lower(), countries[0]) in countries]
    if not locations and config['locations']:
        language = next((loc.get('language') for loc in config['locations'] if isinstance(loc, dict) and loc.get('language')), 'en')
        locations = [{'location': COUNTRY_NAMES[c], 'language': language} for c in countries]
    country = config['country'] if not config['country'] or config['country'] in countries else (countries[0] if len(countries) == 1 else '')
    if locations != config['locations'] or country != config['country']:
        print(f"Google Jobs: places outside your search left out ({', '.join(map(name, config['locations']))} -> "
              f"{', '.join(map(name, locations)) or 'none'}; country {config['country'] or '-'} -> {country or '-'})")
    return {**config, 'locations': locations, 'country': country}


def _get(url, params, opener=urllib.request.urlopen):
    request = urllib.request.Request(f'{url}?{urlencode(params)}', headers={'User-Agent': 'job-pilotto'})
    with opener(request, timeout=40) as response:
        return json.load(response)


def searches_left(api_key, opener=urllib.request.urlopen):
    """Credits left this month (the account endpoint is free)."""
    account = _get(ACCOUNT_URL, {'api_key': api_key}, opener)
    return account.get('total_searches_left', account.get('plan_searches_left', 0))


def apply_url(result):
    """The employer's own apply link when Google lists one, else the first link, else Google's."""
    links = [o.get('link') for o in result.get('apply_options', []) if o.get('link')]
    direct = [link for link in links if not AGGREGATORS.search(urlsplit(link).netloc)]
    return (direct or links or [result.get('share_link', '')])[0]


def normalise(result):
    """A SerpApi jobs_results entry in the shape feeds.scan produces."""
    extensions = result.get('detected_extensions', {})
    location = result.get('location', '').strip()
    return {
        'company': result.get('company_name') or 'Unknown employer',
        'id': hashlib.sha256((result.get('job_id') or json.dumps(result, sort_keys=True)).encode()).hexdigest()[:16],
        'title': result.get('title', 'Untitled'),
        'location': location,
        'url': apply_url(result),
        'date_posted': extensions.get('posted_at', ''),
        'description': feeds.plain_text(result.get('description', '')),
        'remote': bool(extensions.get('work_from_home')) or bool(re.search(r'remote|anywhere', location, re.I)),
        'salary': extensions.get('salary', ''),
        'via': result.get('via', ''),
    }


def next_searches(db, pairs, count):
    """The `count` query/location pairs searched longest ago (never-searched first)."""
    db.execute("""CREATE TABLE IF NOT EXISTS google_jobs_searches (
        query TEXT, location TEXT, searched_at TEXT, results INTEGER, PRIMARY KEY(query, location))""")
    last = {(q, loc): at for q, loc, at in db.execute("SELECT query, location, searched_at FROM google_jobs_searches")}
    return sorted(pairs, key=lambda pair: last.get(pair, ''))[:count]


def scan(db, api_key, config, opener=urllib.request.urlopen, now=None):
    """Run this turn's searches; return a feeds.scan-style report ({'jobs', 'sources'})."""
    now = now or datetime.now(timezone.utc).isoformat(timespec='seconds')
    report = {'jobs': [], 'sources': []}
    from . import read_budget
    if read_budget.past_cut():   # the run's read time is up: this turn's searches wait for the next search (tests/test_three_minutes.py)
        from .. import time_budget
        time_budget.later('Google Jobs', 1, 'turn of searches')
        return report
    languages = places(config)
    if not languages or not config['queries']:
        print('Google Jobs skipped: no Google Jobs searches or places are set in your Search settings')
        return report
    pairs = [(q, loc) for q in config['queries'] for loc in languages]
    try:
        left = searches_left(api_key, opener)
    except Exception as error:
        report['sources'].append({'company': SOURCE, 'ok': False, 'error': f'{type(error).__name__}: {error}'})
        return report
    budget = max(0, min(config['searches_per_run'], left - config['min_searches_left']))
    if not budget:
        print(f'Google Jobs skipped: {left} SerpApi searches left, keeping {config["min_searches_left"]} in reserve')
        return report
    seen = set()
    for query, location in next_searches(db, pairs, budget):
        name = f'{SOURCE}: {query} / {location}'
        try:
            params = {'engine': 'google_jobs', 'q': query, 'location': location, 'hl': languages[location], 'api_key': api_key}
            if config['country']:
                params['gl'] = config['country']
            data = _get(SEARCH_URL, params, opener)
            if data.get('error') and 'hasn\'t returned any results' not in data['error']:
                raise RuntimeError(data['error'])
            results = [normalise(r) for r in data.get('jobs_results', [])]
            matched = []
            feeds.triage(results)   # titles judged by the AI first (owner, 26 Oct 2026: "The AI decides")
            with db:
                for job in results:
                    if job['id'] in seen or not (feeds.wanted_title(job['title']) and feeds.wanted_location(job)):
                        continue
                    seen.add(job['id'])
                    matched.append({**{k: job[k] for k in ('company', 'id', 'title', 'url', 'date_posted',
                                                           'description')},
                                    'location': job['location'] or 'Unspecified',
                                    'work_mode': 'Remote (stated)' if job['remote'] else '',
                                    'salary_text': job['salary'],
                                    'notes': f"Found on Google Jobs via {job['via']}" if job['via'] else '',
                                    'source': SOURCE, 'source_kind': 'job board',
                                    'status': feeds.record(db, 'google', job, now)})
                db.execute("INSERT OR REPLACE INTO google_jobs_searches VALUES (?, ?, ?, ?)",
                           (query, location, now, len(results)))
            report['jobs'].extend(matched)
            report['sources'].append({'company': name, 'ok': True, 'total': len(results), 'matches': len(matched)})
        except Exception as error:
            report['sources'].append({'company': name, 'ok': False, 'error': f'{type(error).__name__}: {error}'})
    return report


def api_key():
    """The SerpApi key, or '' when unset or turned off with JOB_PILOTTO_DISABLE=google_jobs."""
    from ..features import disabled
    return '' if disabled('google_jobs') else os.getenv('SERPAPI_API_KEY', '').strip()
