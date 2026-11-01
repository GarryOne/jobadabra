"""The search PR check's blind judge: per job found, "right role?" and "right place?" for the persona, from title, employer and place only (no URL,
no source, no score), shuffled. The same prompt and rules as the benchmark round's judge (jobadabra-benchmarks search-bench/judge.py, 27 Oct 2026),
on the Codex subscription through the same local broker relay as the press; no API key or CLI sign-in is used.
Why (owner, 27 Oct 2026, "Right role + place"): the engine's own "in places" count called 16 jobs right for p3 that the blind judge called 0
(an interior architect for a carpenter); a check that trusts the engine's count can't see the engine get it wrong.
  node tools/persona-search/codex.mjs -- python3 tools/persona-search/gate_judge.py <persona n> <jobs.json> <judged.json>      Tests: tests/test_search_personas_gate.py"""
import json
import random
import re
import os
import sys
from urllib.request import Request, urlopen
from urllib.parse import urlparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from gate import PERSONAS  # noqa: E402

BATCH = 60
MODEL = 'claude-haiku-5-5'   # Why (30 Oct 2026, owner): retain the small tier; the broker maps Haiku to Codex on the ChatGPT plan.
SYSTEM = ('You check a job search for one job seeker. You get their short profile and a numbered list of jobs (title, employer, place). For EACH job decide two things on their own. '
          'role: would a person with this profile see it as their kind of job? yes = same occupation (any seniority, any employer, any language of the title); no = a different occupation. '
          'place: yes = in their city or a short commute from it, or remote and the text names their country; remote = says remote and names no country, or names many countries (a list such as "Remote - Moldova; Remote - Canada; ..." is worldwide remote, never yes); no = another city or country (including remote limited to another country); unknown = no place given. '
          'Judge only from the title, employer and place shown; do not guess beyond them. Answer with JSON only: {"jobs":[{"n":1,"role":"yes|no","place":"yes|remote|no|unknown"}, ...]} covering every number.')


def key(row):
    return (row['title'].strip().lower(), (row.get('company') or '').strip().lower(), (row.get('location') or '').strip().lower())


def ask(profile, jobs, open_url=urlopen, env=None):
    """One blind batch through the wrapper's loopback Codex relay; missing relay or a refused reply fails without another provider."""
    env = os.environ if env is None else env
    base = env.get('ANTHROPIC_BASE_URL', '')
    address = urlparse(base)
    if env.get('JOBADABRA_PERSONA_CODEX') != '1' or address.scheme != 'http' or address.hostname != '127.0.0.1':
        raise ValueError('the judge requires the local Codex relay')
    prompt = profile + '\n\nJOBS\n' + '\n'.join(f'{j["n"]}. {j["title"]} | {j["company"] or "?"} | {j["location"] or "(no place)"}' for j in jobs)
    body = {'model': MODEL, 'max_tokens': 8000, 'system': SYSTEM, 'messages': [{'role': 'user', 'content': prompt}]}
    request = Request(base + '/v1/messages', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with open_url(request, timeout=600) as response:
        reply = json.loads(response.read())
    text = ''.join(part.get('text', '') for part in reply['content'] if part.get('type') == 'text')
    data = json.loads(re.search(r'\{.*\}', text, re.S).group(0))
    return complete({r['n']: r for r in data['jobs']}, jobs)


def complete(got, jobs):
    """The verdicts, or ValueError when the reply left jobs out. Why (gitar on #2243): a left-out job counted as wrong and showed as a search
    drop ("below main's lowest"); now the judge step fails and the result says the judge wrote no verdicts."""
    missing = [j['n'] for j in jobs if j['n'] not in got]
    if missing:
        raise ValueError(f'the judge left out {len(missing)} of {len(jobs)} jobs: {missing[:5]}')
    return got


def judge(n, pool, asker=ask):
    """The pool with role and place set on every row: one verdict per distinct job, in a seeded shuffle."""
    p = PERSONAS[int(n) - 1]
    profile = f'Profile: {p["title"]}, 6 years of experience, living in {p["city"]}, {p["country"]}; on-site or hybrid; speaks {p["language"]} and English.'
    unique = {}
    for row in pool:
        unique.setdefault(key(row), row)
    jobs = list(unique.values())
    random.Random(f'bench-judge-{n}').shuffle(jobs)
    verdicts = {}
    for start in range(0, len(jobs), BATCH):
        chunk = jobs[start:start + BATCH]
        got = asker(profile, [{'n': i + 1, **{k: j.get(k, '') for k in ('title', 'company', 'location')}} for i, j in enumerate(chunk)])
        for i, j in enumerate(chunk):
            v = got.get(i + 1, {})
            verdicts[key(j)] = (v.get('role', 'missing'), v.get('place', 'missing'))
    for row in pool:
        row['role'], row['place'] = verdicts.get(key(row), ('not-judged', 'not-judged'))
    return {'persona': p, 'judged_jobs': len(jobs), 'model': 'Codex small tier', 'billing': 'subscription', 'usd': 0, 'rows': pool}


def main(argv):
    n, jobs_path, out = argv[:3]
    pool = json.loads(Path(jobs_path).read_text(encoding='utf-8'))
    verdict = judge(n, pool)
    Path(out).write_text(json.dumps(verdict, ensure_ascii=False, indent=1), encoding='utf-8')
    local = sum(1 for r in verdict['rows'] if r['role'] == 'yes' and r['place'] == 'yes')
    print(f"p{n}: judge cost ${verdict['usd']:.3f}; judged {verdict['judged_jobs']} distinct jobs, {local} right role and place")


if __name__ == '__main__':
    main(sys.argv[1:])
