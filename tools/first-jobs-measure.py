#!/usr/bin/env python3
"""Measures a first search on a fresh fictional profile: seconds from the engine's start to the first job in the store and to the first scored job.
Offline feeds (the e2e fixture boards), this Mac's store in a temp folder, the CLI engine (the user's own Claude Code plan, no API key).
  tools/first-jobs-measure.py <repo-checkout> [--first-jobs] [--label name] [--log file] [--feeds N] [--delay S]
--feeds N: N employer feeds in all (the 2 fixture boards first, the rest answer with a board that has no match for the roles, as most feeds do);
--delay S: every feed answer takes S seconds (a real board answers in 1-3 s), so the crawl has a length to compare. Same patch on main and on the branch.
Run it once on main and once on the branch (the checkout is where `python -m src` runs from); the engine's own log goes to --log.
Spec: docs/superpowers/specs/2026-10-16-first-jobs-fast.md. Nothing of the owner's is read: data and config are temp, FOLLOW_APP is off."""
import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PROFILE = """# Candidate (fictional)
Senior site reliability engineer, 8 years. Kubernetes, Terraform, AWS, Datadog, on-call, incident response.
Looking for: senior SRE / platform roles, remote or Zurich. Salary target CHF 130,000. German B1, English C2.
"""


def count(db_path, table):
    try:
        db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=0.2)
        try:
            return db.execute(f'select count(*) from {table}').fetchone()[0]
        finally:
            db.close()
    except sqlite3.Error:
        return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('repo')
    parser.add_argument('--first-jobs', action='store_true')
    parser.add_argument('--label', default='run')
    parser.add_argument('--log', default='')
    parser.add_argument('--feeds', type=int, default=0)
    parser.add_argument('--delay', type=float, default=0.0)
    args = parser.parse_args()
    repo = Path(args.repo).resolve()
    work = Path(tempfile.mkdtemp(prefix='first-jobs-measure-'))
    config, data = work / 'config', work / 'data'
    shutil.copytree(repo / 'config', config)
    fixtures = repo / 'desktop' / 'e2e' / 'fixtures' / 'feeds'
    shutil.copy(fixtures / 'sources.json', config / 'sources.json')
    search = json.loads((config / 'search.json').read_text())   # the fictional SRE's search, not the repo's example (a data analyst in Amsterdam)
    search.update(role_keywords=['site reliability', r'\bsre\b', 'platform engineer', 'devops'], title_exclude_keywords=[r'\bintern(ship)?\b', r'\bsales\b'],
                  quality_stack_keywords=['kubernetes', 'terraform', 'aws', 'datadog'], locations={'top_tier': ['zurich'], 'country_wide': ['switzerland'], 'abroad': []})
    (config / 'search.json').write_text(json.dumps(search))
    data.mkdir()
    fixtures_copy = work / 'feeds'
    shutil.copytree(fixtures, fixtures_copy)
    fixtures = fixtures_copy
    if args.feeds > 2:   # filler boards: slugs the fixture routes answer with noise.json (no job for the roles)
        sources = json.loads((config / 'sources.json').read_text())
        routes = json.loads((fixtures / 'routes.json').read_text())
        for n in range(args.feeds - len(sources)):
            sources.append({'company': f'Filler {n}', 'ats': 'greenhouse', 'slug': f'e2e-filler{n}'})
            routes[f'/boards/e2e-filler{n}/jobs'] = 'employers/noise.json'
        (config / 'sources.json').write_text(json.dumps(sources))
        (fixtures / 'routes.json').write_text(json.dumps(routes))
    patch = work / 'patch'
    patch.mkdir()
    (patch / 'sitecustomize.py').write_text(
        'import time\nimport src.sources.ats as ats\n_read = ats._fixture\n'
        f'def _fixture(folder, url):\n    time.sleep({args.delay})\n    return _read(folder, url)\nats._fixture = _fixture\n') if args.delay else None
    (work / 'profile.md').write_text(PROFILE)
    env = {**os.environ, 'PYTHONUNBUFFERED': '1', 'PYTHONUTF8': '1', 'JOBADABRA_NO_DOTENV': '1', 'JOBADABRA_FOLLOW_APP': '0', 'JOBADABRA_E2E': '1',
           'JOBADABRA_CONFIG_DIR': str(config), 'JOBADABRA_DATA_DIR': str(data), 'JOBADABRA_FIXTURE_DIR': str(fixtures),
           'JOBADABRA_PROFILE_FILE': str(work / 'profile.md'), 'JOBADABRA_STORE': 'sqlite', 'JOBADABRA_AI_ENGINE': 'cli',
           'JOBADABRA_DISABLE': 'mail,notion,telegram,google_jobs,index,job_alerts'}
    if args.delay:
        env['PYTHONPATH'] = os.pathsep.join([str(work / 'patch'), str(repo)])
    for name in ('NOTION_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'TELEGRAM_BOT_TOKEN'):
        env.pop(name, None)
    command = [sys.executable, '-m', 'src', 'daily', '--mode', 'run', '--enrich-max', '100', '--score-max', '60', '--budget', '180'] + (['--first-jobs'] if args.first_jobs else [])
    log = open(args.log or work / 'engine.log', 'w')
    began = time.monotonic()
    process = subprocess.Popen(command, cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
    db = data / 'jobs.sqlite'
    found = scored = None
    while process.poll() is None:
        now = time.monotonic() - began
        if found is None and count(db, 'jobs') > 0:
            found = now
        if scored is None and count(db, 'scores') > 0:
            scored = now
        time.sleep(0.2)
    ended = time.monotonic() - began
    result = {'label': args.label, 'first_jobs_flag': args.first_jobs, 'repo': str(repo), 'first_job_in_store_s': found and round(found, 1),
              'first_scored_job_s': scored and round(scored, 1), 'engine_ended_s': round(ended, 1), 'exit': process.returncode,
              'jobs': count(db, 'jobs'), 'scores': count(db, 'scores'), 'log': log.name}
    print(json.dumps(result))
    shutil.rmtree(work, ignore_errors=True) if not args.log else None


if __name__ == '__main__':
    main()
